import { describe, expect, it } from 'vitest';
import { bidIncrement, nextBidAmount, formatLakhs, maxBidFor, findPlayer, BASE_PLAYERS, MIN_BASE_PRICE } from '../../shared/engine/index';
import { FRANCHISES } from '../../shared/data/reference';
import { act, bid, expectGameError, HOST, lobby, rid, started, totalMoney, U, Clock } from './helpers';
import type { Room } from '../../shared/types';

const C = 'IPL-TEST';

/** Puts a specific player on the block by rewriting the queue (test-only shortcut). */
function forceLot(room: Room, playerId: string) {
  const p = findPlayer(playerId)!;
  room.auction!.lot = { ...room.auction!.lot!, playerId, basePrice: p.basePrice, bid: null, leader: null, bids: [], status: 'bidding', rtm: null };
}

describe('money & increments', () => {
  it('uses the v2 increment ladder in integer lakhs', () => {
    expect([bidIncrement(20), bidIncrement(95), bidIncrement(100), bidIncrement(299), bidIncrement(300), bidIncrement(999), bidIncrement(1000), bidIncrement(1999), bidIncrement(2000)])
      .toEqual([5, 5, 10, 10, 25, 25, 50, 50, 100]);
    expect(nextBidAmount(null, 200)).toBe(200);
    expect(nextBidAmount(200, 200)).toBe(210);
    expect(nextBidAmount(1950, 200)).toBe(2000);
  });
  it('never produces floating point amounts across a long bidding war', () => {
    let b: number | null = null;
    for (let i = 0; i < 200; i++) { b = nextBidAmount(b, 20); expect(Number.isInteger(b)).toBe(true); }
  });
  it('formats lakhs and crores', () => {
    expect(formatLakhs(50)).toBe('₹50 L');
    expect(formatLakhs(200)).toBe('₹2 Cr');
    expect(formatLakhs(1525)).toBe('₹15.25 Cr');
    expect(formatLakhs(12000)).toBe('₹120 Cr');
  });
});

describe('lobby & ownership', () => {
  it('prevents two users owning the same franchise', () => {
    const { room, clock, teamIds } = lobby(1);
    act(room, U[1], { action: 'joinRoom', code: C, name: 'Second' }, clock);
    expectGameError(() => act(room, U[1], { action: 'claimTeam', code: C, teamId: teamIds[0] }, clock), 'team-taken');
    expect(room.teams[teamIds[0]].ownerUid).toBe(U[0]);
  });
  it('switching franchise releases the previous one', () => {
    const { room, clock } = lobby(1);
    act(room, U[0], { action: 'claimTeam', code: C, teamId: 'RCB' }, clock);
    expect(room.teams.CSK.ownerUid).toBeNull();
    expect(room.teams.RCB.ownerUid).toBe(U[0]);
    expect(room.members[U[0]].teamId).toBe('RCB');
  });
  it('re-claiming your own team is an idempotent no-op', () => {
    const { room, clock } = lobby(1);
    const ev = act(room, U[0], { action: 'claimTeam', code: C, teamId: 'CSK' }, clock);
    expect(ev.duplicate).toBe(true);
  });
  it('only the host can change settings; non-members cannot act', () => {
    const { room, clock } = lobby(2);
    expectGameError(() => act(room, U[0], { action: 'updateSettings', code: C, settings: { purse: 5000 } }, clock), 'forbidden');
    expectGameError(() => act(room, 'stranger', { action: 'startAuction', code: C }, clock), 'not-member');
    act(room, HOST, { action: 'updateSettings', code: C, settings: { purse: 5000, bidTimerSec: 999 } }, clock);
    expect(room.settings.purse).toBe(5000);
    expect(room.settings.bidTimerSec).toBe(60); // clamped
    expect(room.teams.CSK.purse).toBe(5000);
    expect(room.teams.CSK.ownerUid).toBe(U[0]); // ownership survives settings change
  });
  it('needs two owners to start and removes unclaimed franchises', () => {
    const { room, clock } = lobby(1);
    expectGameError(() => act(room, HOST, { action: 'startAuction', code: C }, clock), 'not-enough-teams');
    act(room, U[1], { action: 'joinRoom', code: C, name: 'Bee' }, clock);
    act(room, U[1], { action: 'claimTeam', code: C, teamId: 'MI' }, clock);
    act(room, HOST, { action: 'startAuction', code: C }, clock);
    expect(Object.keys(room.teams).sort()).toEqual(['CSK', 'MI']);
    expect(room.auction!.queue.length).toBe(BASE_PLAYERS.length);
    expect(new Set(room.auction!.queue).size).toBe(BASE_PLAYERS.length);
  });
  it('custom players are stored on the room and enter the queue', () => {
    const { room, clock } = lobby(2);
    const ev = act(room, HOST, { action: 'addCustomPlayer', code: C, player: { name: 'Gully Star', country: 'India', role: 'AR', tier: 'silver', bowlingType: 'spin' } }, clock);
    const id = (ev.data!.player as { id: string }).id;
    expect(room.customPlayers[id].country).toBe('IND');
    expect(room.customPlayers[id].overseas).toBe(false); // v2 bug: "India" was treated as overseas
    expect(room.customPlayers[id].basePrice).toBe(50);
    expectGameError(() => act(room, HOST, { action: 'addCustomPlayer', code: C, player: { name: 'virat kohli', country: 'IND', role: 'BAT', tier: 'gold', bowlingType: null } }, clock), 'duplicate-player');
    act(room, HOST, { action: 'startAuction', code: C }, clock);
    expect(room.auction!.queue).toContain(id);
  });
});

describe('bidding', () => {
  it('accepts the base price first, then exact increments only', () => {
    const { room, clock } = started(2);
    const lot = room.auction!.lot!;
    bid(room, U[0], clock);
    expect(room.auction!.lot!.bid).toBe(lot.basePrice);
    expect(room.auction!.lot!.leader).toBe('CSK');
    expectGameError(() => act(room, U[1], { action: 'placeBid', code: C, lotSeq: lot.seq, amount: lot.basePrice + 1, requestId: rid() }, clock), 'stale-bid');
    bid(room, U[1], clock);
    expect(room.auction!.lot!.bid).toBe(lot.basePrice + bidIncrement(lot.basePrice));
  });
  it('rejects bidding against yourself, before opening and after the deadline', () => {
    const { room, clock } = started(2);
    bid(room, U[0], clock);
    expectGameError(() => bid(room, U[0], clock), 'already-leading');
    clock.advance(60_000);
    expectGameError(() => bid(room, U[1], clock), 'expired');
  });
  it('rejects bids from spectators and the auctioneer', () => {
    const { room, clock } = started(2);
    act(room, 'spec', { action: 'joinRoom', code: C, name: 'Watcher' }, clock);
    expectGameError(() => bid(room, 'spec', clock), 'no-team');
    expectGameError(() => bid(room, HOST, clock), 'no-team');
  });
  it('resolves simultaneous bids: the second request for the same amount is stale', () => {
    const { room, clock } = started(3);
    const lot = room.auction!.lot!;
    // Both clients saw bid=null and submitted the base price; the transaction serialises them.
    act(room, U[0], { action: 'placeBid', code: C, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() }, clock);
    expectGameError(() => act(room, U[1], { action: 'placeBid', code: C, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() }, clock), 'stale-bid');
    expect(room.auction!.lot!.leader).toBe('CSK');
    expect(room.auction!.lot!.bids).toHaveLength(1);
  });
  it('a retried bid request is idempotent', () => {
    const { room, clock } = started(2);
    const lot = room.auction!.lot!;
    const requestId = rid();
    act(room, U[0], { action: 'placeBid', code: C, lotSeq: lot.seq, amount: lot.basePrice, requestId }, clock);
    const again = act(room, U[0], { action: 'placeBid', code: C, lotSeq: lot.seq, amount: lot.basePrice, requestId }, clock);
    expect(again.duplicate).toBe(true);
    expect(room.auction!.lot!.bids).toHaveLength(1);
  });
  it('bidding never touches purses; only the hammer charges, exactly once', () => {
    const { room, clock } = started(2);
    const start = { CSK: room.teams.CSK.purse, MI: room.teams.MI.purse };
    for (let i = 0; i < 10; i++) bid(room, U[i % 2], clock);
    expect(room.teams.CSK.purse).toBe(start.CSK);
    expect(room.teams.MI.purse).toBe(start.MI);
    const { bid: price, leader, seq, playerId } = room.auction!.lot!;
    act(room, HOST, { action: 'hammer', code: C, lotSeq: seq, sold: true }, clock);
    const again = act(room, HOST, { action: 'hammer', code: C, lotSeq: seq, sold: true }, clock);
    expect(again.duplicate).toBe(true);
    expect(room.teams[leader!].purse).toBe(start[leader as 'CSK' | 'MI'] - price!);
    expect(room.teams[leader!].squad[playerId].price).toBe(price);
    expect(room.auction!.sold[playerId]).toBe(leader);
    const other = leader === 'CSK' ? 'MI' : 'CSK';
    expect(room.teams[other].purse).toBe(start[other]);
  });
  it('enforces the squad-completion reserve', () => {
    const { room, clock } = started(2, { purse: 400, minSquad: 11 });
    // purse 400, 10 more players needed at ≥20 → 200 reserved, max bid 200
    expect(maxBidFor(room, room.teams.CSK)).toBe(400 - 10 * MIN_BASE_PRICE);
    forceLot(room, 'P001'); // diamond, base 200
    bid(room, U[0], clock); // exactly the max is allowed
    expect(room.auction!.lot!.bid).toBe(200);
  });
  it('rejects unaffordable bids', () => {
    const { room, clock } = started(2, { purse: 400, minSquad: 11 });
    forceLot(room, 'P001');
    bid(room, U[0], clock);
    expectGameError(() => bid(room, U[1], clock), 'insufficient-purse');
  });
  it('enforces the overseas squad limit', () => {
    const { room, clock } = started(2, { maxOverseasSquad: 4 });
    const overseas = BASE_PLAYERS.filter((p) => p.overseas).slice(0, 4);
    for (const p of overseas) room.teams.CSK.squad[p.id] = { playerId: p.id, price: 20, viaRtm: false, ratingAdj: 0, boughtAt: 1 };
    forceLot(room, BASE_PLAYERS.filter((p) => p.overseas)[10].id);
    expectGameError(() => bid(room, U[0], clock), 'overseas-limit');
    forceLot(room, 'P001'); // Indian
    bid(room, U[0], clock);
  });
  it('enforces the maximum squad size', () => {
    const { room, clock } = started(2, { maxSquad: 15 });
    BASE_PLAYERS.filter((p) => !p.overseas).slice(50, 65).forEach((p) => {
      room.teams.CSK.squad[p.id] = { playerId: p.id, price: 20, viaRtm: false, ratingAdj: 0, boughtAt: 1 };
    });
    forceLot(room, 'P001');
    expectGameError(() => bid(room, U[0], clock), 'squad-full');
  });
});

describe('timer, hammer and lifecycle', () => {
  it('tick is a no-op before the deadline and finalises after it (no host needed)', () => {
    const { room, clock } = started(2);
    bid(room, U[0], clock);
    const seq = room.auction!.lot!.seq;
    expect(act(room, U[1], { action: 'tick', code: C }, clock).noop).toBe(true);
    clock.advance(16_000);
    act(room, U[1], { action: 'tick', code: C }, clock); // an owner, not the host, triggers expiry
    expect(room.auction!.lastResult).toMatchObject({ seq, outcome: 'sold', teamId: 'CSK' });
    expect(room.auction!.lot!.seq).toBe(seq + 1);
    // A second tick for the same expiry cannot finalise anything again.
    expect(act(room, U[0], { action: 'tick', code: C }, clock).noop).toBe(true);
  });
  it('expired lots with no bids go unsold', () => {
    const { room, clock } = started(2);
    const pid = room.auction!.lot!.playerId;
    clock.advance(20_000);
    act(room, U[0], { action: 'tick', code: C }, clock);
    expect(room.auction!.unsold).toContain(pid);
  });
  it('high bids use the shorter timer', () => {
    const { room, clock } = started(2);
    room.auction!.lot!.bid = 1490; room.auction!.lot!.leader = 'MI';
    bid(room, U[0], clock); // 1540 ≥ 1500
    expect(room.auction!.lot!.deadline - clock.t).toBe(room.settings.highBidTimerSec * 1000);
  });
  it('pause freezes the clock and resume restores the remaining time', () => {
    const { room, clock } = started(2);
    bid(room, U[0], clock);
    clock.advance(5000);
    act(room, HOST, { action: 'pause', code: C, paused: true }, clock);
    expectGameError(() => bid(room, U[1], clock), 'paused');
    clock.advance(120_000);
    expect(act(room, U[1], { action: 'tick', code: C }, clock).noop).toBe(true);
    act(room, HOST, { action: 'pause', code: C, paused: false }, clock);
    expect(room.auction!.lot!.deadline - clock.t).toBe(10_000);
  });
  it('only controllers may hammer, undo or pause', () => {
    const { room, clock } = started(2);
    bid(room, U[0], clock);
    const seq = room.auction!.lot!.seq;
    expectGameError(() => act(room, U[0], { action: 'hammer', code: C, lotSeq: seq, sold: true }, clock), 'forbidden');
    expectGameError(() => act(room, U[0], { action: 'undoBid', code: C, lotSeq: seq }, clock), 'forbidden');
    expectGameError(() => act(room, U[0], { action: 'pause', code: C, paused: true }, clock), 'forbidden');
  });
  it('the host can delegate the auctioneer role', () => {
    const { room, clock } = started(2);
    act(room, 'auc', { action: 'joinRoom', code: C, name: 'Auctioneer' }, clock);
    act(room, HOST, { action: 'setAuctioneer', code: C, uid: 'auc' }, clock);
    bid(room, U[0], clock);
    act(room, 'auc', { action: 'hammer', code: C, lotSeq: room.auction!.lot!.seq, sold: true }, clock);
    expect(Object.keys(room.teams.CSK.squad)).toHaveLength(1);
  });
  it('undo restores the previous leader and amount without touching purses', () => {
    const { room, clock } = started(2);
    bid(room, U[0], clock); bid(room, U[1], clock);
    const purses = [room.teams.CSK.purse, room.teams.MI.purse];
    act(room, HOST, { action: 'undoBid', code: C, lotSeq: room.auction!.lot!.seq }, clock);
    expect(room.auction!.lot!.leader).toBe('CSK');
    expect(room.auction!.lot!.bid).toBe(room.auction!.lot!.basePrice);
    act(room, HOST, { action: 'undoBid', code: C, lotSeq: room.auction!.lot!.seq }, clock);
    expect(room.auction!.lot!.leader).toBeNull();
    expect(room.auction!.lot!.bid).toBeNull();
    expectGameError(() => act(room, HOST, { action: 'undoBid', code: C, lotSeq: room.auction!.lot!.seq }, clock), 'no-bids');
    expect([room.teams.CSK.purse, room.teams.MI.purse]).toEqual(purses);
  });
  it('cannot SOLD a player with no bids; stale lot numbers are rejected', () => {
    const { room, clock } = started(2);
    const seq = room.auction!.lot!.seq;
    expectGameError(() => act(room, HOST, { action: 'hammer', code: C, lotSeq: seq, sold: true }, clock), 'no-bids');
    act(room, HOST, { action: 'hammer', code: C, lotSeq: seq, sold: false }, clock);
    clock.advance(3000);
    expectGameError(() => act(room, U[0], { action: 'placeBid', code: C, lotSeq: seq, amount: 20, requestId: rid() }, clock), 'stale-lot');
  });
  it('runs a full auction with re-listing and never sells a player twice or leaks money', () => {
    const { room, clock } = started(4, { purse: 6000 });
    const initial = totalMoney(room).sum;
    let guard = 0;
    while (room.meta.status === 'auction' && guard++ < 2000) {
      const a = room.auction!;
      if (a.status === 'round_end') {
        if (a.round < 2) act(room, HOST, { action: 'relistUnsold', code: C }, clock);
        else act(room, HOST, { action: 'completeAuction', code: C }, clock);
        continue;
      }
      clock.advance(3000);
      const lot = a.lot!;
      if (lot.status === 'rtm') {
        clock.advance(room.settings.rtmWindowSec * 1000);
        act(room, U[0], { action: 'tick', code: C }, clock);
        continue;
      }
      // deterministic pseudo-bidding: 0–3 bids by rotating owners
      const n = (lot.seq * 7) % 4;
      for (let i = 0; i < n; i++) {
        try { bid(room, U[(lot.seq + i) % 4], clock); } catch { /* unaffordable / full */ }
      }
      act(room, HOST, { action: 'hammer', code: C, lotSeq: lot.seq, sold: !!room.auction!.lot!.leader }, clock);
    }
    expect(room.meta.status).toBe('squads');
    const owners = Object.values(room.auction!.sold);
    const allSquadIds = Object.values(room.teams).flatMap((t) => Object.keys(t.squad));
    expect(new Set(allSquadIds).size).toBe(allSquadIds.length);
    expect(allSquadIds.length).toBe(owners.length);
    for (const t of Object.values(room.teams)) {
      expect(Object.keys(t.squad).length).toBeGreaterThanOrEqual(11);
      expect(t.purse).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(t.purse)).toBe(true);
    }
    expect(totalMoney(room).sum).toBe(initial);
  });
});

describe('RTM', () => {
  /** Kohli's lastTeam is RCB. */
  function rtmSetup() {
    const clock = new Clock();
    const l = lobby(3, { teamCount: 3 }, clock); // CSK, MI, RCB
    act(l.room, HOST, { action: 'startAuction', code: C }, clock);
    clock.advance(1100);
    forceLot(l.room, 'P001');
    return { ...l, clock };
  }
  it('offers RTM to the previous franchise and charges only the RTM franchise on match', () => {
    const { room, clock } = rtmSetup();
    expect(findPlayer('P001')!.lastTeam).toBe('RCB');
    bid(room, U[0], clock); // CSK 200
    bid(room, U[1], clock); // MI 210
    const seq = room.auction!.lot!.seq;
    const before = { MI: room.teams.MI.purse, RCB: room.teams.RCB.purse, cards: room.teams.RCB.rtmCards };
    act(room, HOST, { action: 'hammer', code: C, lotSeq: seq, sold: true }, clock);
    expect(room.auction!.lot!.status).toBe('rtm');
    expect(room.auction!.lot!.rtm!.teamId).toBe('RCB');
    expectGameError(() => act(room, U[1], { action: 'rtmDecision', code: C, lotSeq: seq, accept: true }, clock), 'forbidden');
    act(room, U[2], { action: 'rtmDecision', code: C, lotSeq: seq, accept: true }, clock);
    expect(room.teams.RCB.squad.P001).toMatchObject({ price: 210, viaRtm: true });
    expect(room.teams.RCB.purse).toBe(before.RCB - 210);
    expect(room.teams.RCB.rtmCards).toBe(before.cards - 1);
    expect(room.teams.MI.purse).toBe(before.MI); // original winner never charged → nothing to refund
    expect(room.teams.MI.squad.P001).toBeUndefined();
    const dup = act(room, U[2], { action: 'rtmDecision', code: C, lotSeq: seq, accept: true }, clock);
    expect(dup.duplicate).toBe(true);
    expect(room.teams.RCB.purse).toBe(before.RCB - 210);
  });
  it('declining or letting the window lapse sells to the highest bidder', () => {
    const { room, clock } = rtmSetup();
    bid(room, U[0], clock);
    act(room, HOST, { action: 'hammer', code: C, lotSeq: room.auction!.lot!.seq, sold: true }, clock);
    clock.advance(room.settings.rtmWindowSec * 1000);
    expectGameError(() => act(room, U[2], { action: 'rtmDecision', code: C, lotSeq: room.auction!.lot!.seq, accept: true }, clock), 'rtm-expired');
    act(room, U[1], { action: 'tick', code: C }, clock);
    expect(room.teams.CSK.squad.P001.price).toBe(200);
    expect(room.teams.RCB.rtmCards).toBe(room.settings.rtmCardsPerTeam);
  });
  it('is not offered when the previous franchise is the winner, has no cards, cannot afford, or RTM is off', () => {
    let s = rtmSetup();
    bid(s.room, U[2], s.clock); // RCB itself wins
    act(s.room, HOST, { action: 'hammer', code: C, lotSeq: s.room.auction!.lot!.seq, sold: true }, s.clock);
    expect(s.room.teams.RCB.squad.P001).toBeDefined();

    s = rtmSetup();
    s.room.teams.RCB.rtmCards = 0;
    bid(s.room, U[0], s.clock);
    act(s.room, HOST, { action: 'hammer', code: C, lotSeq: s.room.auction!.lot!.seq, sold: true }, s.clock);
    expect(s.room.teams.CSK.squad.P001).toBeDefined();

    s = rtmSetup();
    s.room.teams.RCB.purse = 250; // reserve leaves < 200
    bid(s.room, U[0], s.clock);
    act(s.room, HOST, { action: 'hammer', code: C, lotSeq: s.room.auction!.lot!.seq, sold: true }, s.clock);
    expect(s.room.teams.CSK.squad.P001).toBeDefined();

    s = rtmSetup();
    s.room.settings.features.rtm = false;
    bid(s.room, U[0], s.clock);
    act(s.room, HOST, { action: 'hammer', code: C, lotSeq: s.room.auction!.lot!.seq, sold: true }, s.clock);
    expect(s.room.teams.CSK.squad.P001).toBeDefined();
  });
  it('previous-team data uses the normalized lastTeam field (v2 used a field that did not exist)', () => {
    for (const p of BASE_PLAYERS) if (p.previousTeams.length) expect(p.lastTeam).toBe(p.previousTeams.at(-1));
    expect(FRANCHISES.map((f) => f.id)).toContain(findPlayer('P001')!.lastTeam);
  });
});
