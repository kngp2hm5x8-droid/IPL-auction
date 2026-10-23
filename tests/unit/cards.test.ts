import { describe, expect, it } from 'vitest';
import { buyCard, seededRng, newEvents, findPlayer, CARD_DEFS, FREEZE_MS } from '../../shared/engine/index';
import type { CardType, Room } from '../../shared/types';
import { act, bid, expectGameError, rid, started, U, Clock } from './helpers';

const C = 'IPL-TEST';

function withCards() {
  return started(2, { features: { rtm: false, powerCards: true }, bidTimerSec: 60 });
}

/** Gives `uid` a specific card through the real purchase path. */
function give(room: Room, uid: string, type: CardType, clock: Clock): string {
  const ev = newEvents();
  const card = buyCard(room, { uid, now: clock.t, rng: seededRng(1) }, rid(), ev, type);
  return card.id;
}

describe('power cards', () => {
  it('are rejected when disabled for the room', () => {
    const { room, clock } = started(2);
    expectGameError(() => act(room, U[0], { action: 'buyCard', code: C, requestId: rid() }, clock), 'cards-disabled');
  });

  it('purchases charge the purse once and are idempotent per request id', () => {
    const { room, clock } = withCards();
    const purse = room.teams.CSK.purse;
    const requestId = rid();
    act(room, U[0], { action: 'buyCard', code: C, requestId }, clock);
    const dup = act(room, U[0], { action: 'buyCard', code: C, requestId }, clock);
    expect(dup.duplicate).toBe(true);
    expect(Object.keys(room.teams.CSK.cards)).toHaveLength(1);
    const card = Object.values(room.teams.CSK.cards)[0];
    const penalty = card.type === 'tax_audit' ? 1000 : 0;
    expect(room.teams.CSK.purse).toBe(purse - room.settings.cardCost - penalty);
  });

  it('caps the number of held cards', () => {
    const { room, clock } = withCards();
    for (let i = 0; i < 5; i++) give(room, U[0], 'shield', clock);
    expectGameError(() => act(room, U[0], { action: 'buyCard', code: C, requestId: rid() }, clock), 'cards-full');
  });

  it('bad cards trigger immediately on purchase', () => {
    const { room, clock } = withCards();
    const purse = room.teams.CSK.purse;
    const id = give(room, U[0], 'tax_audit', clock);
    expect(room.teams.CSK.cards[id].status).toBe('used');
    expect(room.teams.CSK.purse).toBe(purse - 500 - 1000);
    give(room, U[0], 'self_freeze', clock);
    expectGameError(() => bid(room, U[0], clock), 'frozen');
    give(room, U[0], 'scout_error', clock);
    expect(room.teams.CSK.effects.scoutError).toBe(true);
    give(room, U[0], 'purse_leak', clock);
    expect(room.teams.CSK.effects.purseLeak).toBe(3);
  });

  it('a used card cannot be activated twice (network retry safe)', () => {
    const { room, clock } = withCards();
    const id = give(room, U[0], 'sponsorship', clock);
    const purse = room.teams.CSK.purse;
    act(room, U[0], { action: 'useCard', code: C, cardId: id }, clock);
    const dup = act(room, U[0], { action: 'useCard', code: C, cardId: id }, clock);
    expect(dup.duplicate).toBe(true);
    expect(room.teams.CSK.purse).toBe(purse + 1000);
  });

  it('cards belong to their owner', () => {
    const { room, clock } = withCards();
    const id = give(room, U[0], 'interest', clock);
    expectGameError(() => act(room, U[1], { action: 'useCard', code: C, cardId: id }, clock), 'unknown-card');
  });

  it('sniper jumps ₹5 Cr and takes the lead through normal bid validation', () => {
    const { room, clock } = withCards();
    bid(room, U[1], clock);
    const before = room.auction!.lot!.bid!;
    const id = give(room, U[0], 'sniper', clock);
    act(room, U[0], { action: 'useCard', code: C, cardId: id }, clock);
    expect(room.auction!.lot!.bid).toBe(before + 500);
    expect(room.auction!.lot!.leader).toBe('CSK');
    // A leader cannot snipe themselves; the card stays unused.
    const id2 = give(room, U[0], 'sniper', clock);
    expectGameError(() => act(room, U[0], { action: 'useCard', code: C, cardId: id2 }, clock), 'already-leading');
    expect(room.teams.CSK.cards[id2].status).toBe('held');
  });

  it('freeze blocks an opponent for 15s and shield absorbs it', () => {
    const { room, clock } = withCards();
    const f1 = give(room, U[0], 'freeze', clock);
    expectGameError(() => act(room, U[0], { action: 'useCard', code: C, cardId: f1, targetTeamId: 'CSK' }, clock), 'bad-target');
    act(room, U[0], { action: 'useCard', code: C, cardId: f1, targetTeamId: 'MI' }, clock);
    expect(room.auction!.frozenUntil.MI).toBe(clock.t + FREEZE_MS);
    expectGameError(() => bid(room, U[1], clock), 'frozen');
    clock.advance(FREEZE_MS);
    bid(room, U[1], clock);

    const s = give(room, U[1], 'shield', clock);
    act(room, U[1], { action: 'useCard', code: C, cardId: s }, clock);
    const f2 = give(room, U[0], 'freeze', clock);
    act(room, U[0], { action: 'useCard', code: C, cardId: f2, targetTeamId: 'MI' }, clock);
    expect(room.teams.MI.effects.shield).toBe(1);
    expect(room.auction!.frozenUntil.MI).toBeLessThanOrEqual(clock.t);
  });

  it('cashback refunds 10% and form surge / scout error adjust the next signing once', () => {
    const { room, clock } = withCards();
    act(room, U[0], { action: 'useCard', code: C, cardId: give(room, U[0], 'cashback', clock) }, clock);
    act(room, U[0], { action: 'useCard', code: C, cardId: give(room, U[0], 'form_surge', clock) }, clock);
    const purse = room.teams.CSK.purse;
    bid(room, U[0], clock);
    const { bid: price, playerId, seq } = room.auction!.lot!;
    act(room, 'host', { action: 'hammer', code: C, lotSeq: seq, sold: true }, clock);
    expect(room.teams.CSK.purse).toBe(purse - price! + Math.floor(price! / 10));
    expect(room.teams.CSK.squad[playerId].ratingAdj).toBe(12);
    expect(room.teams.CSK.effects.cashback).toBe(false);
    expect(room.teams.CSK.effects.formSurge).toBe(false);
  });

  it('injury hits the target team\'s latest signing', () => {
    const { room, clock } = withCards();
    bid(room, U[1], clock);
    const { playerId, seq } = room.auction!.lot!;
    act(room, 'host', { action: 'hammer', code: C, lotSeq: seq, sold: true }, clock);
    const id = give(room, U[0], 'injury', clock);
    act(room, U[0], { action: 'useCard', code: C, cardId: id, targetTeamId: 'MI' }, clock);
    expect(room.teams.MI.squad[playerId].ratingAdj).toBe(-10);
    expect(findPlayer(playerId)).toBeTruthy();
  });

  it('time warp resets the clock; shield and hidden purse count down per lot', () => {
    const { room, clock } = withCards();
    clock.advance(10_000);
    act(room, U[0], { action: 'useCard', code: C, cardId: give(room, U[0], 'time_warp', clock) }, clock);
    expect(room.auction!.lot!.deadline - clock.t).toBe(60_000);
    act(room, U[0], { action: 'useCard', code: C, cardId: give(room, U[0], 'hidden_purse', clock) }, clock);
    act(room, U[0], { action: 'useCard', code: C, cardId: give(room, U[0], 'shield', clock) }, clock);
    act(room, 'host', { action: 'hammer', code: C, lotSeq: room.auction!.lot!.seq, sold: false }, clock);
    expect(room.teams.CSK.effects.hiddenPurse).toBe(1);
    expect(room.teams.CSK.effects.shield).toBe(1);
  });

  it('documents all 14 card types', () => {
    expect(Object.keys(CARD_DEFS)).toHaveLength(14);
    for (const d of Object.values(CARD_DEFS)) expect(d.description.length).toBeGreaterThan(10);
  });
});
