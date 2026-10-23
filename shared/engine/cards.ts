/**
 * Power cards. Cards are bought blind ("mystery box") for `settings.cardCost`.
 * GOOD cards go to the inventory and are played later; BAD cards trigger the moment they
 * are drawn (that is the risk of the mystery box). Every card instance has an id and a
 * `status`, so a retried "use" request can never apply an effect twice.
 */
import type { CardType, HeldCard, Room, Team } from '../types';
import { assert, fail, formatLakhs, hashSeed, pick } from './core';
import { maxBidFor, placeBid, type Ctx, type Events } from './auction';
import { playerOf, requireOwnTeam } from './room';

export interface CardDef {
  type: CardType;
  name: string;
  kind: 'good' | 'bad';
  /** Needs an opponent franchise as target. */
  target?: boolean;
  /** Only playable while a player is being bid for. */
  duringBidding?: boolean;
  description: string;
}

export const FREEZE_MS = 15_000;
export const SELF_FREEZE_MS = 10_000;

export const CARD_DEFS: Record<CardType, CardDef> = {
  sniper: { type: 'sniper', name: 'Sniper', kind: 'good', duringBidding: true, description: 'Jump the current bid by ₹5 Cr in one move and take the lead.' },
  freeze: { type: 'freeze', name: 'Freeze', kind: 'good', target: true, description: 'Block an opponent from bidding for 15 seconds. Blocked by Shield.' },
  hidden_purse: { type: 'hidden_purse', name: 'Hidden Purse', kind: 'good', description: 'Your purse is hidden on other screens for the next 2 players.' },
  form_surge: { type: 'form_surge', name: 'Form Surge', kind: 'good', description: 'Your next signing gets +12 simulation rating.' },
  injury: { type: 'injury', name: 'Injury', kind: 'good', target: true, description: "An opponent's most recent signing gets −10 simulation rating. Blocked by Shield." },
  sponsorship: { type: 'sponsorship', name: 'Sponsorship', kind: 'good', description: 'Instantly adds ₹10 Cr to your purse.' },
  interest: { type: 'interest', name: 'Interest', kind: 'good', description: 'Instantly adds ₹5 Cr to your purse.' },
  shield: { type: 'shield', name: 'Shield', kind: 'good', description: 'Blocks Freeze / Injury attacks for the next 2 players.' },
  time_warp: { type: 'time_warp', name: 'Time Warp', kind: 'good', duringBidding: true, description: 'Resets the bidding clock to the full timer.' },
  cashback: { type: 'cashback', name: 'Cashback', kind: 'good', description: '10% of the price of your next signing is refunded.' },
  tax_audit: { type: 'tax_audit', name: 'Tax Audit', kind: 'bad', description: 'Bad luck: ₹10 Cr penalty, taken immediately.' },
  self_freeze: { type: 'self_freeze', name: 'Brain Freeze', kind: 'bad', description: 'Bad luck: your franchise is frozen for 10 seconds.' },
  scout_error: { type: 'scout_error', name: "Scout's Error", kind: 'bad', description: 'Bad luck: your next signing gets −10 simulation rating.' },
  purse_leak: { type: 'purse_leak', name: 'Purse Leak', kind: 'bad', description: 'Bad luck: your purse is visible to all for 3 players, even if hidden.' },
};

export const CARD_TYPES = Object.keys(CARD_DEFS) as CardType[];

function requireCardsPhase(room: Room): void {
  assert(room.settings.features.powerCards, 'cards-disabled', 'Power cards are disabled in this room.');
  assert(room.meta.status === 'auction' && room.auction && room.auction.status !== 'completed', 'no-auction', 'Cards can only be used during the auction.');
}

export function heldCount(team: Team): number {
  return Object.values(team.cards).filter((c) => c.status === 'held').length;
}

export function buyCard(room: Room, ctx: Ctx, requestId: string, ev: Events, forced?: CardType): HeldCard {
  requireCardsPhase(room);
  assert(typeof requestId === 'string' && requestId.length >= 6 && requestId.length <= 64, 'bad-request', 'Missing request id.');
  const team = requireOwnTeam(room, ctx.uid);
  const already = team.cardPurchases[requestId];
  if (already && team.cards[already]) { ev.duplicate = true; return team.cards[already]; }
  assert(heldCount(team) < room.settings.maxCardsHeld, 'cards-full', `You can hold at most ${room.settings.maxCardsHeld} cards.`);
  const cost = room.settings.cardCost;
  // Buying a card counts against the same squad-completion reserve as bidding.
  const spendable = maxBidFor(room, team) - (room.auction?.lot?.leader === team.id ? room.auction.lot.bid ?? 0 : 0);
  assert(cost <= spendable, 'insufficient-purse', `A mystery card costs ${formatLakhs(cost)}.`);
  const type = forced ?? pick(CARD_TYPES, ctx.rng);
  // Unique within the team (sequence number) and tied to the purchase request.
  const id = `K${Object.keys(team.cards).length + 1}-${hashSeed(team.id, requestId).toString(36).toUpperCase()}`;
  team.purse -= cost;
  ev.ledger.push({ teamId: team.id, delta: -cost, reason: 'Mystery power card', at: ctx.now });
  const card: HeldCard = { id, type, status: 'held', acquiredAt: ctx.now };
  team.cards[id] = card;
  team.cardPurchases[requestId] = id;
  const def = CARD_DEFS[type];
  if (def.kind === 'bad') {
    applyBadCard(room, ctx, team, type, ev);
    card.status = 'used';
    card.usedAt = ctx.now;
  } else {
    ev.commentary.push(`🃏 ${team.short} bought a mystery card.`);
  }
  ev.data = { cardId: id, type };
  return card;
}

function applyBadCard(room: Room, ctx: Ctx, team: Team, type: CardType, ev: Events): void {
  switch (type) {
    case 'tax_audit': {
      const penalty = Math.min(1000, team.purse);
      team.purse -= penalty;
      ev.ledger.push({ teamId: team.id, delta: -penalty, reason: 'Tax Audit card', at: ctx.now });
      ev.commentary.push(`📉 Tax Audit! ${team.short} lose ${formatLakhs(penalty)}.`);
      break;
    }
    case 'self_freeze':
      room.auction!.frozenUntil[team.id] = Math.max(room.auction!.frozenUntil[team.id] ?? 0, ctx.now) + SELF_FREEZE_MS;
      ev.commentary.push(`🧊 Brain Freeze! ${team.short} froze themselves.`);
      break;
    case 'scout_error':
      team.effects.scoutError = true;
      ev.commentary.push(`🩹 Scout's Error hits ${team.short}.`);
      break;
    case 'purse_leak':
      team.effects.purseLeak = 3;
      ev.commentary.push(`🕵 Purse Leak! ${team.short}'s finances are public.`);
      break;
    default:
      fail('bad-card', 'Not a bad card.');
  }
}

export function useCard(
  room: Room, ctx: Ctx,
  args: { cardId: string; targetTeamId?: string; lotSeq?: number },
  ev: Events,
): void {
  requireCardsPhase(room);
  const team = requireOwnTeam(room, ctx.uid);
  const card = team.cards[args.cardId];
  assert(card, 'unknown-card', 'You do not hold that card.');
  if (card.status === 'used') { ev.duplicate = true; return; }
  const def = CARD_DEFS[card.type];
  assert(def.kind === 'good', 'bad-card', 'That card cannot be played.');
  const a = room.auction!;
  if (def.duringBidding) {
    assert(a.status === 'running' && a.lot && a.lot.status === 'bidding', 'no-lot', 'This card can only be played while a player is being bid for.');
    if (args.lotSeq !== undefined) assert(a.lot.seq === args.lotSeq, 'stale-lot', 'That player is no longer on the block.');
  }
  let target: Team | null = null;
  if (def.target) {
    assert(args.targetTeamId && room.teams[args.targetTeamId], 'bad-target', 'Choose an opponent franchise.');
    assert(args.targetTeamId !== team.id, 'bad-target', 'You cannot target your own franchise.');
    target = room.teams[args.targetTeamId];
  }
  switch (card.type) {
    case 'sniper': {
      const lot = a.lot!;
      placeBid(room, ctx, { lotSeq: lot.seq, amount: (lot.bid ?? lot.basePrice) + 500, requestId: 'card-' + card.id, viaCard: 'sniper' }, ev);
      ev.commentary.push(`🎯 SNIPER! ${team.short} jump to ${formatLakhs(lot.bid)}.`);
      break;
    }
    case 'freeze':
      if (target!.effects.shield > 0) {
        target!.effects.shield -= 1;
        ev.commentary.push(`🛡 ${target!.short}'s Shield blocked a Freeze from ${team.short}!`);
      } else {
        a.frozenUntil[target!.id] = Math.max(a.frozenUntil[target!.id] ?? 0, ctx.now) + FREEZE_MS;
        ev.commentary.push(`🧊 FREEZE! ${team.short} froze ${target!.short} for 15 seconds.`);
      }
      break;
    case 'injury': {
      const latest = Object.values(target!.squad).sort((x, y) => y.boughtAt - x.boughtAt)[0];
      assert(latest, 'bad-target', `${target!.short} have not signed anyone yet.`);
      if (target!.effects.shield > 0) {
        target!.effects.shield -= 1;
        ev.commentary.push(`🛡 ${target!.short}'s Shield blocked an Injury card!`);
      } else {
        latest.ratingAdj -= 10;
        ev.commentary.push(`🤕 Injury! ${playerOf(room, latest.playerId).name} (${target!.short}) loses 10 rating.`);
      }
      break;
    }
    case 'hidden_purse':
      team.effects.hiddenPurse = 2;
      ev.commentary.push(`🫙 ${team.short} have hidden their purse.`);
      break;
    case 'form_surge':
      team.effects.formSurge = true;
      ev.commentary.push(`⚡ ${team.short} activate Form Surge.`);
      break;
    case 'sponsorship':
      team.purse += 1000;
      ev.ledger.push({ teamId: team.id, delta: 1000, reason: 'Sponsorship card', at: ctx.now });
      ev.commentary.push(`💰 ${team.short} land a ₹10 Cr sponsorship!`);
      break;
    case 'interest':
      team.purse += 500;
      ev.ledger.push({ teamId: team.id, delta: 500, reason: 'Interest card', at: ctx.now });
      ev.commentary.push(`📈 ${team.short} earn ₹5 Cr interest.`);
      break;
    case 'shield':
      team.effects.shield = Math.max(team.effects.shield, 2);
      ev.commentary.push(`🛡 ${team.short} raise a Shield.`);
      break;
    case 'time_warp':
      a.lot!.deadline = Math.max(ctx.now, a.lot!.opensAt) + room.settings.bidTimerSec * 1000;
      ev.commentary.push(`⏳ Time Warp! ${team.short} reset the clock.`);
      break;
    case 'cashback':
      team.effects.cashback = true;
      ev.commentary.push(`💸 ${team.short} activate Cashback.`);
      break;
    default:
      fail('bad-card', 'Unknown card.');
  }
  card.status = 'used';
  card.usedAt = ctx.now;
}
