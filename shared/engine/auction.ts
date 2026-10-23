/**
 * Authoritative auction engine. Every function here is a pure reducer over a mutable
 * draft `Room` (the Cloud Function runs it inside an RTDB transaction on rooms/{code}).
 *
 * PURSE ACCOUNTING MODEL — "charge on hammer":
 *   A bid is only a commitment. Purses are debited exactly once, when a lot is finalised
 *   as SOLD (to the winning bidder or to the RTM franchise). Being outbid, undoing a bid,
 *   or losing to an RTM never touches a purse, so there is nothing to refund. The only
 *   credits are explicit card effects (cashback, sponsorship, interest).
 *
 *   Affordability: a franchise may only bid up to
 *     purse − (remaining minimum-squad slots after this player) × MIN_BASE_PRICE
 *   which guarantees every franchise can still complete a minimum squad.
 */
import type { CustomPlayerInput, Lakhs, Lot, Player, Room, RoomSettings, Team, Tier } from '../types';
import { FRANCHISE_IDS, MIN_BASE_PRICE, TIER_BASE_PRICE, TIER_DEFAULT_RATING, TIERS, normalizeCountry } from '../data/reference';
import { allPlayers, findPlayer } from '../data/players';
import { assert, formatLakhs, isIntegerLakhs, nextBidAmount, pick, shuffle, clamp, type Rng } from './core';
import {
  buildTeams, getMember, isController, overseasInSquad, playerOf, requireController, requireHost,
  requireOwnTeam, sanitizeName, sanitizeSettings,
} from './room';

export interface Ctx {
  uid: string;
  now: number;
  rng: Rng;
}

export interface LedgerEvent { teamId: string; delta: Lakhs; reason: string; at: number }
export interface BidEvent { key: string; lotSeq: number; playerId: string; teamId: string; amount: Lakhs; at: number; viaCard?: string }
export interface Events {
  commentary: string[];
  bids: BidEvent[];
  ledger: LedgerEvent[];
  /** True when the action was a safe re-delivery of something already applied. */
  duplicate?: boolean;
  /** True when nothing needed to change (the transaction should be aborted, not written). */
  noop?: boolean;
  data?: Record<string, unknown>;
}

export const newEvents = (): Events => ({ commentary: [], bids: [], ledger: [] });

/** Delay between a lot being created and bidding opening (lets every screen show the SOLD banner). */
export const LOT_REVEAL_MS = 2500;
/** Supplementary-draft replacement fee for teams short of a playing XI when the auction ends. */
export const SUPPLEMENTARY_FEE: Lakhs = MIN_BASE_PRICE;
export const PLAYING_MINIMUM = 11;

/* ─────────────────────────── Lobby ─────────────────────────── */

export function joinRoom(room: Room, ctx: Ctx, name: string, ev: Events): void {
  const clean = sanitizeName(name);
  const existing = room.members[ctx.uid];
  if (existing) {
    // Reconnecting member: keep their role and franchise, only refresh the display name.
    ev.data = { rejoined: true, teamId: existing.teamId };
    if (existing.name === clean) { ev.duplicate = true; return; }
    existing.name = clean;
    if (existing.teamId && room.teams[existing.teamId]?.ownerUid === ctx.uid) room.teams[existing.teamId].ownerName = clean;
    return;
  }
  assert(Object.keys(room.members).length < 60, 'room-full', 'This room is full.');
  room.members[ctx.uid] = { uid: ctx.uid, name: clean, joinedAt: ctx.now, isHost: false, isAuctioneer: false, teamId: null, ready: false };
  ev.commentary.push(`${clean} joined the room.`);
}

export function claimTeam(room: Room, ctx: Ctx, teamId: string, ev: Events): void {
  assert(room.meta.status === 'lobby', 'not-lobby', 'Franchises can only be claimed in the lobby.');
  const member = getMember(room, ctx.uid);
  const team = room.teams[teamId];
  assert(team, 'unknown-team', 'That franchise is not part of this room.');
  if (team.ownerUid === ctx.uid) { ev.duplicate = true; return; }
  assert(!team.ownerUid, 'team-taken', `${team.name} is already owned by ${team.ownerName}.`);
  if (member.teamId && room.teams[member.teamId]?.ownerUid === ctx.uid) {
    room.teams[member.teamId].ownerUid = null;
    room.teams[member.teamId].ownerName = null;
  }
  team.ownerUid = ctx.uid;
  team.ownerName = member.name;
  member.teamId = teamId;
  member.ready = false;
  ev.commentary.push(`${member.name} claimed ${team.name}.`);
}

export function releaseTeam(room: Room, ctx: Ctx, ev: Events): void {
  assert(room.meta.status === 'lobby', 'not-lobby', 'Franchises can only be released in the lobby.');
  const member = getMember(room, ctx.uid);
  if (!member.teamId) { ev.duplicate = true; return; }
  const team = room.teams[member.teamId];
  if (team?.ownerUid === ctx.uid) { team.ownerUid = null; team.ownerName = null; }
  member.teamId = null;
  member.ready = false;
}

export function setReady(room: Room, ctx: Ctx, ready: boolean): void {
  assert(room.meta.status === 'lobby', 'not-lobby', 'Not in the lobby.');
  getMember(room, ctx.uid).ready = !!ready;
}

export function updateSettings(room: Room, ctx: Ctx, patch: Partial<RoomSettings>): void {
  requireHost(room, ctx.uid);
  assert(room.meta.status === 'lobby', 'not-lobby', 'Settings are locked once the auction starts.');
  const next = sanitizeSettings(room.settings, patch);
  const fresh = buildTeams(next);
  for (const [id, t] of Object.entries(fresh)) {
    const old = room.teams[id];
    if (old) { t.ownerUid = old.ownerUid; t.ownerName = old.ownerName; }
  }
  for (const m of Object.values(room.members)) if (m.teamId && !fresh[m.teamId]) { m.teamId = null; m.ready = false; }
  room.settings = next;
  room.teams = fresh;
}

export function setAuctioneer(room: Room, ctx: Ctx, target: string | null): void {
  requireHost(room, ctx.uid);
  if (target) assert(room.members[target], 'not-member', 'That user is not in the room.');
  for (const m of Object.values(room.members)) m.isAuctioneer = m.uid === target;
}

export function addCustomPlayer(room: Room, ctx: Ctx, input: CustomPlayerInput, ev: Events): Player {
  requireController(room, ctx.uid);
  assert(room.meta.status === 'lobby', 'not-lobby', 'Custom players can only be added in the lobby.');
  assert(Object.keys(room.customPlayers).length < 60, 'limit', 'Custom player limit reached (60).');
  const name = sanitizeName(input?.name);
  const country = normalizeCountry(String(input?.country ?? ''));
  assert(country, 'bad-country', 'Unknown country.');
  assert(['BAT', 'BOWL', 'AR', 'WK'].includes(input.role), 'bad-role', 'Unknown role.');
  assert(TIERS.includes(input.tier as Tier), 'bad-tier', 'Unknown tier.');
  const lower = name.toLowerCase();
  assert(!allPlayers(room.customPlayers).some((p) => p.name.toLowerCase() === lower), 'duplicate-player', 'A player with that name already exists.');
  const bowls = input.role === 'BOWL' || input.role === 'AR';
  const bowlingType = bowls ? (input.bowlingType === 'spin' ? 'spin' : 'pace') : null;
  const prev = (input.previousTeams ?? []).filter((t) => FRANCHISE_IDS.includes(t as never)).slice(0, 10);
  const id = 'C-' + Math.floor(ctx.rng() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
  const player: Player = {
    id, name, country, role: input.role,
    battingSlot: input.role === 'BOWL' ? 'tail' : input.role === 'AR' ? 'middle' : 'top',
    bowlingType,
    tier: input.tier,
    rating: clamp(Math.round(input.rating ?? TIER_DEFAULT_RATING[input.tier]), 40, 99),
    basePrice: TIER_BASE_PRICE[input.tier],
    previousTeams: [...new Set(prev)],
    lastTeam: prev.length ? prev[prev.length - 1] : null,
    overseas: country !== 'IND',
    custom: true,
  };
  room.customPlayers[id] = player;
  ev.commentary.push(`Custom player ${name} added to the pool.`);
  return player;
}

export function removeCustomPlayer(room: Room, ctx: Ctx, playerId: string): void {
  requireController(room, ctx.uid);
  assert(room.meta.status === 'lobby', 'not-lobby', 'Custom players can only be removed in the lobby.');
  assert(room.customPlayers[playerId], 'unknown-player', 'No such custom player.');
  delete room.customPlayers[playerId];
}

/* ─────────────────────────── Auction lifecycle ─────────────────────────── */

export function buildQueue(room: Room, rng: Rng): string[] {
  const players = allPlayers(room.customPlayers);
  return TIERS.flatMap((tier) => shuffle(players.filter((p) => p.tier === tier).map((p) => p.id), rng));
}

export function startAuction(room: Room, ctx: Ctx, ev: Events): void {
  requireController(room, ctx.uid);
  assert(room.meta.status === 'lobby', 'not-lobby', 'The auction has already started.');
  const owned = Object.values(room.teams).filter((t) => t.ownerUid);
  assert(owned.length >= 2, 'not-enough-teams', 'At least two franchises need owners to start.');
  // Unclaimed franchises are removed so every team in the tournament has a human owner.
  for (const t of Object.values(room.teams)) if (!t.ownerUid) delete room.teams[t.id];
  room.settings.teamCount = owned.length;
  const queue = buildQueue(room, ctx.rng);
  assert(queue.length > 0, 'empty-pool', 'The player pool is empty.');
  room.meta.status = 'auction';
  room.auction = {
    status: 'running', queue, cursor: 0, round: 1, lot: null, pausedRemainingMs: null,
    unsold: [], sold: {}, lastResult: null, frozenUntil: {}, lotSeq: 0,
  };
  ev.commentary.push(`The ${room.settings.auctionType === 'mega' ? 'mega' : 'mini'} auction is underway with ${owned.length} franchises!`);
  openLot(room, queue[0], ctx.now, 1000, ev);
}

function timerFor(settings: RoomSettings, amount: Lakhs | null): number {
  return 1000 * (amount != null && amount >= settings.highBidThreshold ? settings.highBidTimerSec : settings.bidTimerSec);
}

function openLot(room: Room, playerId: string, now: number, revealMs: number, ev: Events): void {
  const a = room.auction!;
  const p = playerOf(room, playerId);
  a.lotSeq += 1;
  const opensAt = now + revealMs;
  a.lot = {
    seq: a.lotSeq, playerId, basePrice: p.basePrice, bid: null, leader: null, bids: [],
    opensAt, deadline: opensAt + timerFor(room.settings, null), status: 'bidding', rtm: null,
  };
  ev.commentary.push(pick(OPEN_LINES, Math.random)(p.name, formatLakhs(p.basePrice)));
}

function requireRunningLot(room: Room, lotSeq?: number): Lot {
  const a = room.auction;
  assert(a && room.meta.status === 'auction', 'no-auction', 'The auction is not in progress.');
  assert(a.status !== 'paused', 'paused', 'The auction is paused.');
  assert(a.status === 'running' && a.lot, 'no-lot', 'No player is currently on the block.');
  if (lotSeq !== undefined) assert(a.lot.seq === lotSeq, 'stale-lot', 'That player is no longer on the block.');
  return a.lot;
}

/** The most a franchise can bid on the current player while keeping enough to fill a minimum squad. */
export function maxBidFor(room: Room, team: Team): Lakhs {
  const squadAfter = Object.keys(team.squad).length + 1;
  const reserve = Math.max(0, room.settings.minSquad - squadAfter) * MIN_BASE_PRICE;
  return Math.max(0, team.purse - reserve);
}

/** Throws unless `team` is allowed to acquire `player` for `amount`. */
export function assertCanAcquire(room: Room, team: Team, player: Player, amount: Lakhs): void {
  assert(Object.keys(team.squad).length < room.settings.maxSquad, 'squad-full', `${team.short} already has the maximum ${room.settings.maxSquad} players.`);
  if (player.overseas) {
    assert(overseasInSquad(room, team) < room.settings.maxOverseasSquad, 'overseas-limit', `${team.short} has reached the overseas limit (${room.settings.maxOverseasSquad}).`);
  }
  assert(amount <= maxBidFor(room, team), 'insufficient-purse', `${team.short} cannot afford ${formatLakhs(amount)} (max ${formatLakhs(maxBidFor(room, team))}).`);
}

export function placeBid(
  room: Room, ctx: Ctx,
  args: { lotSeq: number; amount: Lakhs; requestId: string; viaCard?: 'sniper' },
  ev: Events,
): void {
  assert(typeof args.requestId === 'string' && args.requestId.length >= 6 && args.requestId.length <= 64, 'bad-request', 'Missing request id.');
  assert(isIntegerLakhs(args.amount), 'bad-amount', 'Bid amount must be a whole number of lakhs.');
  const team = requireOwnTeam(room, ctx.uid);
  const a = room.auction;
  // Idempotency: a retried request that already landed is acknowledged, not re-applied.
  if (a?.lot && a.lot.seq === args.lotSeq && a.lot.bids.some((b) => b.requestId === args.requestId)) { ev.duplicate = true; return; }
  const lot = requireRunningLot(room, args.lotSeq);
  assert(lot.status === 'bidding', 'rtm-pending', 'Bidding is closed while the RTM decision is pending.');
  assert(ctx.now >= lot.opensAt, 'not-open', 'Bidding has not opened yet.');
  assert(ctx.now < lot.deadline, 'expired', 'Time is up for this player.');
  assert((a!.frozenUntil[team.id] ?? 0) <= ctx.now, 'frozen', `${team.short} is frozen and cannot bid right now.`);
  assert(lot.leader !== team.id, 'already-leading', 'You already hold the highest bid.');
  const expected = args.viaCard === 'sniper' ? (lot.bid ?? lot.basePrice) + 500 : nextBidAmount(lot.bid, lot.basePrice);
  assert(args.amount === expected, 'stale-bid', `The bid has moved on — the next bid is ${formatLakhs(expected)}.`);
  const player = playerOf(room, lot.playerId);
  assertCanAcquire(room, team, player, args.amount);

  lot.bid = args.amount;
  lot.leader = team.id;
  lot.bids.push({ teamId: team.id, amount: args.amount, at: ctx.now, requestId: args.requestId, ...(args.viaCard ? { viaCard: args.viaCard } : {}) });
  lot.deadline = ctx.now + timerFor(room.settings, args.amount);
  ev.bids.push({ key: `${lot.seq}_${lot.bids.length}`, lotSeq: lot.seq, playerId: lot.playerId, teamId: team.id, amount: args.amount, at: ctx.now, ...(args.viaCard ? { viaCard: args.viaCard } : {}) });
  ev.commentary.push(pick(BID_LINES, ctx.rng)(team.short, formatLakhs(args.amount), player.name));
}

/** Auctioneer hammer: SOLD (to the current leader) or UNSOLD. */
export function hammer(room: Room, ctx: Ctx, lotSeq: number, sold: boolean, ev: Events): void {
  requireController(room, ctx.uid);
  const a = room.auction;
  if (a?.lastResult?.seq === lotSeq) { ev.duplicate = true; return; }
  if (a?.lot?.seq === lotSeq && a.lot.status === 'rtm') { ev.duplicate = true; return; }
  const lot = requireRunningLot(room, lotSeq);
  assert(lot.status === 'bidding', 'rtm-pending', 'Waiting for the RTM decision.');
  if (sold) assert(lot.leader, 'no-bids', 'Nobody has bid on this player — mark them UNSOLD instead.');
  finalizeLot(room, ctx, sold, ev);
}

/**
 * Server clock check, callable by ANY room member (and by the scheduled sweeper).
 * Expired lots are finalised; expired RTM windows are treated as "decline".
 * Safe to call repeatedly: when nothing is due it is a no-op.
 */
export function tick(room: Room, ctx: Ctx, ev: Events): void {
  const a = room.auction;
  if (!a || room.meta.status !== 'auction' || a.status !== 'running' || !a.lot) { ev.noop = true; return; }
  const lot = a.lot;
  if (lot.status === 'bidding' && ctx.now >= lot.deadline) {
    ev.commentary.push('⏱ Time!');
    finalizeLot(room, ctx, !!lot.leader, ev);
  } else if (lot.status === 'rtm' && lot.rtm && ctx.now >= lot.rtm.deadline) {
    const t = room.teams[lot.rtm.teamId];
    ev.commentary.push(`${t?.short ?? 'The franchise'} let the RTM window lapse.`);
    completeSale(room, ctx, lot.leader!, lot.bid!, false, ev);
    advance(room, ctx, ev);
  } else {
    ev.noop = true;
  }
}

/** Which franchise (if any) may exercise RTM on the current lot. */
export function rtmCandidate(room: Room, lot: Lot): Team | null {
  if (!room.settings.features.rtm || !lot.leader || lot.bid == null) return null;
  const player = playerOf(room, lot.playerId);
  if (!player.lastTeam) return null;
  const team = room.teams[player.lastTeam];
  if (!team || !team.ownerUid || team.id === lot.leader || team.rtmCards <= 0) return null;
  try {
    assertCanAcquire(room, team, player, lot.bid);
  } catch {
    return null;
  }
  return team;
}

function finalizeLot(room: Room, ctx: Ctx, sold: boolean, ev: Events): void {
  const a = room.auction!;
  const lot = a.lot!;
  if (sold && lot.leader && lot.bid != null) {
    const rtmTeam = rtmCandidate(room, lot);
    if (rtmTeam) {
      lot.status = 'rtm';
      lot.rtm = { teamId: rtmTeam.id, deadline: ctx.now + room.settings.rtmWindowSec * 1000 };
      ev.commentary.push(`🛡 ${rtmTeam.short} can use a Right to Match card at ${formatLakhs(lot.bid)}!`);
      return;
    }
    completeSale(room, ctx, lot.leader, lot.bid, false, ev);
  } else {
    a.unsold.push(lot.playerId);
    a.lastResult = { seq: lot.seq, playerId: lot.playerId, outcome: 'unsold', teamId: null, price: null, viaRtm: false, at: ctx.now };
    ev.commentary.push(pick(UNSOLD_LINES, ctx.rng)(playerOf(room, lot.playerId).name));
    tickEffectCounters(room);
  }
  advance(room, ctx, ev);
}

export function rtmDecision(room: Room, ctx: Ctx, lotSeq: number, accept: boolean, ev: Events): void {
  const a = room.auction;
  if (a?.lastResult?.seq === lotSeq) { ev.duplicate = true; return; }
  const lot = requireRunningLot(room, lotSeq);
  assert(lot.status === 'rtm' && lot.rtm, 'no-rtm', 'There is no RTM decision pending.');
  const team = requireOwnTeam(room, ctx.uid);
  assert(team.id === lot.rtm.teamId, 'forbidden', 'Only the eligible franchise can decide on RTM.');
  assert(ctx.now < lot.rtm.deadline, 'rtm-expired', 'The RTM window has closed.');
  if (accept) {
    const player = playerOf(room, lot.playerId);
    assert(team.rtmCards > 0, 'no-rtm-cards', 'No RTM cards left.');
    assertCanAcquire(room, team, player, lot.bid!);
    team.rtmCards -= 1;
    completeSale(room, ctx, team.id, lot.bid!, true, ev);
  } else {
    ev.commentary.push(`${team.short} declined to match.`);
    completeSale(room, ctx, lot.leader!, lot.bid!, false, ev);
  }
  advance(room, ctx, ev);
}

/** Debits the purse exactly once and moves the player into the squad. */
function completeSale(room: Room, ctx: Ctx, teamId: string, price: Lakhs, viaRtm: boolean, ev: Events): void {
  const a = room.auction!;
  const lot = a.lot!;
  const team = room.teams[teamId];
  const player = playerOf(room, lot.playerId);
  assert(!a.sold[player.id], 'already-sold', `${player.name} has already been sold.`);
  assert(team.purse >= price, 'insufficient-purse', 'Purse check failed at hammer.');
  team.purse -= price;
  ev.ledger.push({ teamId, delta: -price, reason: `Bought ${player.name}${viaRtm ? ' (RTM)' : ''}`, at: ctx.now });
  let ratingAdj = 0;
  if (team.effects.formSurge) { ratingAdj += 12; team.effects.formSurge = false; }
  if (team.effects.scoutError) { ratingAdj -= 10; team.effects.scoutError = false; }
  if (team.effects.cashback) {
    const refund = Math.floor(price / 10);
    team.purse += refund;
    team.effects.cashback = false;
    ev.ledger.push({ teamId, delta: refund, reason: `Cashback on ${player.name}`, at: ctx.now });
  }
  team.squad[player.id] = { playerId: player.id, price, viaRtm, ratingAdj, boughtAt: ctx.now };
  a.sold[player.id] = teamId;
  a.lastResult = { seq: lot.seq, playerId: player.id, outcome: 'sold', teamId, price, viaRtm, at: ctx.now };
  ev.commentary.push(viaRtm
    ? `🛡 RTM! ${team.short} match and keep ${player.name} for ${formatLakhs(price)}.`
    : pick(SOLD_LINES, ctx.rng)(player.name, team.short, formatLakhs(price)));
  tickEffectCounters(room);
}

/** Lot-based effects count down once per finalised lot. */
function tickEffectCounters(room: Room): void {
  for (const t of Object.values(room.teams)) {
    if (t.effects.shield > 0) t.effects.shield -= 1;
    if (t.effects.hiddenPurse > 0) t.effects.hiddenPurse -= 1;
    if (t.effects.purseLeak > 0) t.effects.purseLeak -= 1;
  }
}

function advance(room: Room, ctx: Ctx, ev: Events): void {
  const a = room.auction!;
  a.lot = null;
  while (a.cursor + 1 < a.queue.length) {
    a.cursor += 1;
    const id = a.queue[a.cursor];
    if (!a.sold[id] && findPlayer(id, room.customPlayers)) {
      openLot(room, id, ctx.now, LOT_REVEAL_MS, ev);
      return;
    }
  }
  a.cursor = a.queue.length;
  if (a.unsold.length) {
    a.status = 'round_end';
    ev.commentary.push(`End of round ${a.round}. ${a.unsold.length} player(s) unsold — the auctioneer can re-list them or close the auction.`);
  } else {
    finishAuction(room, ctx, ev);
  }
}

export function undoBid(room: Room, ctx: Ctx, lotSeq: number, ev: Events): void {
  requireController(room, ctx.uid);
  const lot = requireRunningLot(room, lotSeq);
  assert(lot.status === 'bidding', 'rtm-pending', 'Cannot undo during an RTM decision.');
  const popped = lot.bids.pop();
  assert(popped, 'no-bids', 'There is no bid to undo.');
  const prev = lot.bids[lot.bids.length - 1];
  lot.bid = prev?.amount ?? null;
  lot.leader = prev?.teamId ?? null;
  lot.deadline = Math.max(ctx.now, lot.opensAt) + timerFor(room.settings, lot.bid);
  ev.commentary.push(`↩ Auctioneer withdrew ${room.teams[popped.teamId]?.short}'s ${formatLakhs(popped.amount)} bid. Back to ${lot.bid == null ? 'base price' : formatLakhs(lot.bid)}.`);
}

export function setPaused(room: Room, ctx: Ctx, paused: boolean, ev: Events): void {
  requireController(room, ctx.uid);
  const a = room.auction;
  assert(a && room.meta.status === 'auction', 'no-auction', 'The auction is not in progress.');
  if (paused) {
    if (a.status === 'paused') { ev.duplicate = true; return; }
    assert(a.status === 'running', 'bad-state', 'Nothing to pause.');
    a.status = 'paused';
    if (a.lot) {
      const end = a.lot.status === 'rtm' && a.lot.rtm ? a.lot.rtm.deadline : a.lot.deadline;
      a.pausedRemainingMs = Math.max(0, end - Math.max(ctx.now, a.lot.opensAt));
    }
    ev.commentary.push('⏸ The auctioneer has paused proceedings.');
  } else {
    if (a.status !== 'paused') { ev.duplicate = true; return; }
    a.status = 'running';
    if (a.lot) {
      const remaining = Math.max(3000, a.pausedRemainingMs ?? 0);
      a.lot.opensAt = Math.min(a.lot.opensAt, ctx.now);
      if (a.lot.status === 'rtm' && a.lot.rtm) a.lot.rtm.deadline = ctx.now + remaining;
      else a.lot.deadline = ctx.now + remaining;
    }
    a.pausedRemainingMs = null;
    // Freezes do not tick while paused.
    ev.commentary.push('▶ Bidding resumes!');
  }
}

export function relistUnsold(room: Room, ctx: Ctx, ev: Events): void {
  requireController(room, ctx.uid);
  const a = room.auction;
  assert(a && a.status === 'round_end', 'bad-state', 'Re-listing is only possible at the end of a round.');
  assert(a.unsold.length, 'nothing-unsold', 'There are no unsold players.');
  a.queue = [...a.unsold];
  a.unsold = [];
  a.cursor = 0;
  a.round += 1;
  a.status = 'running';
  ev.commentary.push(`🔄 Round ${a.round}: unsold players are back on the block!`);
  openLot(room, a.queue[0], ctx.now, 1000, ev);
}

export function completeAuction(room: Room, ctx: Ctx, ev: Events): void {
  requireController(room, ctx.uid);
  const a = room.auction;
  if (room.meta.status !== 'auction' && a?.status === 'completed') { ev.duplicate = true; return; }
  assert(a && room.meta.status === 'auction', 'no-auction', 'The auction is not in progress.');
  if (a.lot) {
    assert(a.lot.bids.length === 0 && a.lot.status === 'bidding', 'lot-active', 'Finalise the current player before closing the auction.');
    a.unsold.push(a.lot.playerId);
    a.lot = null;
  }
  finishAuction(room, ctx, ev);
}

/**
 * Ends the auction. Any franchise without a full playing XI is topped up from the unsold
 * pool (supplementary draft) at the minimum base price, respecting the overseas limit.
 */
function finishAuction(room: Room, ctx: Ctx, ev: Events): void {
  const a = room.auction!;
  a.status = 'completed';
  a.lot = null;
  room.meta.status = 'squads';
  const pool = allPlayers(room.customPlayers)
    .filter((p) => !a.sold[p.id])
    // Replacement-level players first, so closing the auction early is never a cheap way to stars.
    .sort((x, y) => x.rating - y.rating || x.id.localeCompare(y.id));
  const s = room.settings;
  for (const team of Object.values(room.teams).sort((x, y) => x.id.localeCompare(y.id))) {
    for (;;) {
      const need = xiShortfall(room, team);
      if (!need || Object.keys(team.squad).length >= s.maxSquad) break;
      const osFull = overseasInSquad(room, team) >= s.maxOverseasSquad;
      // Score each candidate by how many unmet needs it fixes; ties go to the lower rating.
      let best = -1, bestScore = -1;
      pool.forEach((p, i) => {
        if (p.overseas && (osFull || need.indian > 0)) return;
        const score = (need.keeper && p.role === 'WK' ? 4 : 0) + (need.bowling > 0 && (p.role === 'BOWL' || p.role === 'AR') ? 2 : 0) + 1;
        if (score > bestScore) { best = i; bestScore = score; }
      });
      if (best < 0) break;
      const [p] = pool.splice(best, 1);
      const fee = Math.min(SUPPLEMENTARY_FEE, team.purse);
      team.purse -= fee;
      team.squad[p.id] = { playerId: p.id, price: fee, viaRtm: false, ratingAdj: 0, boughtAt: ctx.now, supplementary: true };
      a.sold[p.id] = team.id;
      a.unsold = a.unsold.filter((id) => id !== p.id);
      ev.ledger.push({ teamId: team.id, delta: -fee, reason: `Supplementary pick ${p.name}`, at: ctx.now });
      ev.commentary.push(`📋 Supplementary pick: ${p.name} joins ${team.short} for ${formatLakhs(fee)}.`);
    }
  }
  ev.commentary.push('🏁 The auction is complete! Owners can now pick their Playing XI.');
}

/**
 * What a squad still lacks before a legal Playing XI can be picked from it, or null if
 * nothing: 11 players, enough Indian players to stay within the XI overseas cap, a keeper,
 * and the minimum number of bowling options.
 */
export function xiShortfall(room: Room, team: Team): { total: number; indian: number; keeper: boolean; bowling: number } | null {
  const players = Object.keys(team.squad).map((id) => playerOf(room, id));
  const s = room.settings;
  const need = {
    total: Math.max(0, PLAYING_MINIMUM - players.length),
    indian: Math.max(0, PLAYING_MINIMUM - s.maxOverseasXI - players.filter((p) => !p.overseas).length),
    keeper: !players.some((p) => p.role === 'WK'),
    bowling: Math.max(0, s.minBowlingOptionsXI - players.filter((p) => p.role === 'BOWL' || p.role === 'AR').length),
  };
  return need.total || need.indian || need.keeper || need.bowling ? need : null;
}

export { isController };

/* ─────────────────────────── Commentary templates ─────────────────────────── */

const OPEN_LINES = [
  (p: string, b: string) => `🎙 Next up — ${p}! Starting at ${b}.`,
  (p: string, b: string) => `👀 ${p} enters the ring. Base price ${b}.`,
  (p: string, b: string) => `🏟 The room stirs for ${p}! Opening at ${b}.`,
];
const BID_LINES = [
  (t: string, a: string) => `${t} raises the paddle — ${a}!`,
  (t: string, a: string) => `${t} goes to ${a}.`,
  (t: string, a: string, p: string) => `${t} want ${p}: ${a}!`,
  (t: string, a: string) => `${t} not backing down — ${a}.`,
];
const SOLD_LINES = [
  (p: string, t: string, a: string) => `🔨 SOLD! ${p} to ${t} for ${a}!`,
  (p: string, t: string, a: string) => `🔨 ${t} snap up ${p} for ${a}.`,
  (p: string, t: string, a: string) => `🔨 What a signing — ${p} joins ${t} at ${a}!`,
];
const UNSOLD_LINES = [
  (p: string) => `No takers for ${p}. Unsold.`,
  (p: string) => `${p} goes to the unsold pile.`,
];
