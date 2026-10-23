import type {
  AuctionState, AuctionType, Member, Player, Room, RoomSettings, Team, TeamEffects, TournamentState, Lot,
} from '../types';
import { DEFAULT_PURSE, FRANCHISES, MIN_BASE_PRICE } from '../data/reference';
import { findPlayer } from '../data/players';
import { assert, clamp, fail } from './core';

export function defaultSettings(auctionType: AuctionType = 'mega', teamCount = 10): RoomSettings {
  return {
    auctionType,
    teamCount,
    purse: DEFAULT_PURSE[auctionType][teamCount] ?? 8000,
    minSquad: 11,
    maxSquad: 25,
    maxOverseasSquad: 8,
    maxOverseasXI: 4,
    minBowlingOptionsXI: 5,
    features: { rtm: auctionType === 'mega', powerCards: false },
    rtmCardsPerTeam: auctionType === 'mega' ? 3 : 0,
    bidTimerSec: 15,
    highBidTimerSec: 8,
    highBidThreshold: 1500,
    rtmWindowSec: 12,
    leagueRounds: 1,
    cardCost: 500,
    maxCardsHeld: 5,
  };
}

const int = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : dflt;

/** Merge a client-supplied partial into existing settings, clamping every field to a legal range. */
export function sanitizeSettings(base: RoomSettings, patch: Partial<RoomSettings> = {}): RoomSettings {
  const auctionType: AuctionType = patch.auctionType === 'mini' || patch.auctionType === 'mega' ? patch.auctionType : base.auctionType;
  const teamCount = int(patch.teamCount, 2, 10, base.teamCount);
  const typeOrCountChanged = auctionType !== base.auctionType || teamCount !== base.teamCount;
  const s: RoomSettings = {
    ...base,
    auctionType,
    teamCount,
    purse: patch.purse !== undefined
      ? int(patch.purse, 200, 20000, base.purse)
      : typeOrCountChanged ? DEFAULT_PURSE[auctionType][teamCount] : base.purse,
    minSquad: int(patch.minSquad, 11, 18, base.minSquad),
    maxSquad: int(patch.maxSquad, 15, 25, base.maxSquad),
    maxOverseasSquad: int(patch.maxOverseasSquad, 4, 10, base.maxOverseasSquad),
    maxOverseasXI: int(patch.maxOverseasXI, 0, 6, base.maxOverseasXI),
    minBowlingOptionsXI: int(patch.minBowlingOptionsXI, 5, 7, base.minBowlingOptionsXI),
    features: {
      rtm: typeof patch.features?.rtm === 'boolean' ? patch.features.rtm : base.features.rtm,
      powerCards: typeof patch.features?.powerCards === 'boolean' ? patch.features.powerCards : base.features.powerCards,
    },
    rtmCardsPerTeam: int(patch.rtmCardsPerTeam, 0, 6, base.rtmCardsPerTeam),
    bidTimerSec: int(patch.bidTimerSec, 5, 60, base.bidTimerSec),
    highBidTimerSec: int(patch.highBidTimerSec, 3, 60, base.highBidTimerSec),
    highBidThreshold: int(patch.highBidThreshold, 200, 5000, base.highBidThreshold),
    rtmWindowSec: int(patch.rtmWindowSec, 5, 60, base.rtmWindowSec),
    leagueRounds: patch.leagueRounds === 2 ? 2 : patch.leagueRounds === 1 ? 1 : base.leagueRounds,
    cardCost: int(patch.cardCost, 0, 2000, base.cardCost),
    maxCardsHeld: int(patch.maxCardsHeld, 1, 10, base.maxCardsHeld),
  };
  if (s.maxSquad < s.minSquad) s.maxSquad = s.minSquad;
  // A team must be able to afford a full minimum squad at the lowest base price.
  if (s.purse < s.minSquad * MIN_BASE_PRICE) s.purse = s.minSquad * MIN_BASE_PRICE;
  return s;
}

export function emptyEffects(): TeamEffects {
  return { shield: 0, hiddenPurse: 0, purseLeak: 0, formSurge: false, scoutError: false, cashback: false };
}

export function buildTeams(settings: RoomSettings): Record<string, Team> {
  const teams: Record<string, Team> = {};
  for (const f of FRANCHISES.slice(0, settings.teamCount)) {
    teams[f.id] = {
      id: f.id, name: f.name, short: f.short, color: f.color,
      ownerUid: null, ownerName: null,
      purse: settings.purse,
      rtmCards: settings.features.rtm ? settings.rtmCardsPerTeam : 0,
      squad: {}, effects: emptyEffects(), cards: {}, cardPurchases: {}, xi: null,
    };
  }
  return teams;
}

export function createRoomState(code: string, hostUid: string, hostName: string, now: number, patch?: Partial<RoomSettings>, asAuctioneer = true): Room {
  const base = defaultSettings(patch?.auctionType ?? 'mega', patch?.teamCount ?? 10);
  const settings = sanitizeSettings(base, patch);
  return {
    meta: { code, createdAt: now, hostUid, status: 'lobby', updatedAt: now },
    settings,
    members: {
      [hostUid]: { uid: hostUid, name: hostName, joinedAt: now, isHost: true, isAuctioneer: asAuctioneer, teamId: null, ready: true },
    },
    teams: buildTeams(settings),
    customPlayers: {},
    auction: null,
    tournament: null,
  };
}

/**
 * Firebase RTDB drops empty objects/arrays and null fields. Re-hydrate a raw snapshot value
 * into a fully-shaped Room so engine code never has to null-check collections.
 */
export function normalizeRoom(raw: unknown): Room {
  const r = (raw ?? {}) as Partial<Room>;
  const settings = { ...defaultSettings(), ...r.settings } as RoomSettings;
  settings.features = { ...defaultSettings().features, ...r.settings?.features };
  const teams: Record<string, Team> = {};
  for (const [id, t] of Object.entries(r.teams ?? {})) {
    teams[id] = {
      ...t,
      ownerUid: t.ownerUid ?? null,
      ownerName: t.ownerName ?? null,
      squad: t.squad ?? {},
      effects: { ...emptyEffects(), ...t.effects },
      cards: t.cards ?? {},
      cardPurchases: t.cardPurchases ?? {},
      xi: t.xi ? { ...t.xi, playerIds: toArray(t.xi.playerIds) } : null,
    };
  }
  const members: Record<string, Member> = {};
  for (const [uid, m] of Object.entries(r.members ?? {})) {
    members[uid] = { ...m, uid, teamId: m.teamId ?? null, isHost: !!m.isHost, isAuctioneer: !!m.isAuctioneer, ready: !!m.ready };
  }
  return {
    meta: r.meta as Room['meta'],
    settings,
    members,
    teams,
    customPlayers: r.customPlayers ?? {},
    auction: r.auction ? normalizeAuction(r.auction) : null,
    tournament: r.tournament ? normalizeTournament(r.tournament) : null,
  };
}

function toArray<T>(v: T[] | Record<string, T> | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter((x) => x != null) : Object.values(v);
}

function normalizeAuction(a: AuctionState): AuctionState {
  const lot: Lot | null = a.lot
    ? { ...a.lot, bid: a.lot.bid ?? null, leader: a.lot.leader ?? null, bids: toArray(a.lot.bids), rtm: a.lot.rtm ?? null }
    : null;
  return {
    ...a,
    queue: toArray(a.queue),
    unsold: toArray(a.unsold),
    sold: a.sold ?? {},
    frozenUntil: a.frozenUntil ?? {},
    lot,
    lastResult: a.lastResult ?? null,
    pausedRemainingMs: a.pausedRemainingMs ?? null,
  };
}

function normalizeTournament(t: TournamentState): TournamentState {
  const fixtures: TournamentState['fixtures'] = {};
  for (const [id, f] of Object.entries(t.fixtures ?? {})) {
    fixtures[id] = { ...f, teamA: f.teamA ?? null, teamB: f.teamB ?? null, summary: f.summary ?? null };
  }
  return { ...t, fixtures, championId: t.championId ?? null, runnerUpId: t.runnerUpId ?? null };
}

/* ───────────── Membership & permissions ───────────── */

export function getMember(room: Room, uid: string): Member {
  const m = room.members[uid];
  if (!m) fail('not-member', 'You are not a member of this room.');
  return m;
}

export function isController(room: Room, uid: string): boolean {
  const m = room.members[uid];
  return !!m && (m.isHost || m.isAuctioneer);
}

export function requireHost(room: Room, uid: string): void {
  assert(room.members[uid]?.isHost, 'forbidden', 'Only the host can do that.');
}

export function requireController(room: Room, uid: string): void {
  assert(isController(room, uid), 'forbidden', 'Only the host or auctioneer can do that.');
}

/** Returns the team the caller owns, or throws. */
export function requireOwnTeam(room: Room, uid: string): Team {
  const m = getMember(room, uid);
  assert(m.teamId, 'no-team', 'You do not own a franchise in this room.');
  const team = room.teams[m.teamId];
  assert(team && team.ownerUid === uid, 'no-team', 'You do not own that franchise.');
  return team;
}

export function playerOf(room: Room, id: string): Player {
  const p = findPlayer(id, room.customPlayers);
  if (!p) fail('unknown-player', `Unknown player ${id}`);
  return p;
}

export function overseasInSquad(room: Room, team: Team): number {
  return Object.keys(team.squad).filter((id) => playerOf(room, id).overseas).length;
}

export function sanitizeName(name: unknown): string {
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : '';
  assert(s.length >= 2, 'bad-name', 'Display name must be 2–24 characters.');
  return s;
}
