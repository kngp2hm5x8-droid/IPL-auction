/**
 * Emulator integration tests for the authoritative handlers.
 * Run with: npm run test:integration   (starts the Realtime Database emulator)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from 'firebase-admin/database';
import { sweepExpiredLots } from '../../functions/src/handlers';
import { call, closeAll, errorCode, readRoom, rid, roomWithOwners, serverInstance, waitForOpenLot } from './setup';

let s1: Database, s2: Database, s3: Database;
beforeAll(() => {
  s1 = serverInstance('fn-a');
  s2 = serverInstance('fn-b');
  s3 = serverInstance('fn-c');
});
afterAll(closeAll);

describe('rooms', () => {
  it('creates unique room codes and restores state for a reconnecting user', async () => {
    const codes = await Promise.all([1, 2, 3, 4, 5].map(() => call(s1, 'host', { action: 'createRoom', name: 'Host' })));
    expect(new Set(codes.map((c) => c.code)).size).toBe(5);

    const code = await roomWithOwners(s1, ['alice', 'bob']);
    // "Refresh": a brand new connection reads persistent state only.
    const fresh = serverInstance('reconnect');
    const room = await readRoom(fresh, code);
    expect(room.members.alice.teamId).toBe('CSK');
    expect(room.teams.CSK.ownerUid).toBe('alice');
    expect((await fresh.ref(`users/alice/rooms/${code}`).get()).exists()).toBe(true);
    // Re-joining is idempotent and keeps the franchise.
    const same = await call(fresh, 'alice', { action: 'joinRoom', code, name: 'Owner 1' });
    expect(same.duplicate).toBe(true);
    const again = await call(fresh, 'alice', { action: 'joinRoom', code, name: 'Alice Again' });
    expect(again.data).toMatchObject({ rejoined: true, teamId: 'CSK' });
    expect((await readRoom(fresh, code)).teams.CSK.ownerName).toBe('Alice Again');
  });

  it('two users claiming the same franchise at the same time: exactly one wins', async () => {
    const code = await roomWithOwners(s1, []);
    await call(s1, 'u1', { action: 'joinRoom', code, name: 'One' });
    await call(s1, 'u2', { action: 'joinRoom', code, name: 'Two' });
    const results = await Promise.allSettled([
      call(s1, 'u1', { action: 'claimTeam', code, teamId: 'MI' }),
      call(s2, 'u2', { action: 'claimTeam', code, teamId: 'MI' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('team-taken');
    const room = await readRoom(s3, code);
    const winner = room.teams.MI.ownerUid!;
    expect(['u1', 'u2']).toContain(winner);
    expect(room.members[winner].teamId).toBe('MI');
    expect(room.members[winner === 'u1' ? 'u2' : 'u1'].teamId).toBeNull();
  });

  it('rejects unknown rooms, malformed codes and non-members', async () => {
    expect(await errorCode(call(s1, 'x', { action: 'joinRoom', code: 'IPL-ZZZZ', name: 'Nobody' }))).toBe('no-room');
    expect(await errorCode(call(s1, 'x', { action: 'joinRoom', code: 'hello', name: 'Nobody' }))).toBe('bad-code');
    const code = await roomWithOwners(s1, ['a1', 'a2']);
    expect(await errorCode(call(s1, 'intruder', { action: 'startAuction', code }))).toBe('not-member');
    expect(await errorCode(call(s1, 'a1', { action: 'startAuction', code }))).toBe('forbidden');
  });
});

describe('auction concurrency', () => {
  it('two owners bidding simultaneously cannot both win the same price', async () => {
    const code = await roomWithOwners(s1, ['p1', 'p2', 'p3']);
    await call(s1, 'host', { action: 'startAuction', code });
    const lot = await waitForOpenLot(s1, code);
    const results = await Promise.allSettled([
      call(s1, 'p1', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() }),
      call(s2, 'p2', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() }),
      call(s3, 'p3', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason.code).toBe('stale-bid');
    const room = await readRoom(s1, code);
    expect(room.auction!.lot!.bids).toHaveLength(1);
    expect(room.auction!.lot!.bid).toBe(lot.basePrice);
    // Purses are untouched by bidding (charge-on-hammer model).
    for (const t of Object.values(room.teams)) expect(t.purse).toBe(room.settings.purse);
  });

  it('a bidding war across instances stays consistent and charges the winner exactly once', async () => {
    const code = await roomWithOwners(s1, ['w1', 'w2']);
    await call(s1, 'host', { action: 'startAuction', code });
    let lot = await waitForOpenLot(s1, code);
    const servers = [s1, s2];
    const owners = ['w1', 'w2'];
    for (let i = 0; i < 12; i++) {
      const room = await readRoom(s1, code);
      lot = room.auction!.lot!;
      const amount = lot.bid == null ? lot.basePrice : lot.bid + (lot.bid < 100 ? 5 : lot.bid < 300 ? 10 : lot.bid < 1000 ? 25 : 50);
      await call(servers[i % 2], owners[i % 2], { action: 'placeBid', code, lotSeq: lot.seq, amount, requestId: rid() });
    }
    const before = await readRoom(s1, code);
    const { bid, leader, seq, playerId } = before.auction!.lot!;
    // Duplicate finalisation attempts: two hammers and a tick racing each other.
    const res = await Promise.allSettled([
      call(s1, 'host', { action: 'hammer', code, lotSeq: seq, sold: true }),
      call(s2, 'host', { action: 'hammer', code, lotSeq: seq, sold: true }),
      call(s3, 'w1', { action: 'tick', code }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(2);
    const after = await readRoom(s1, code);
    expect(after.teams[leader!].purse).toBe(before.teams[leader!].purse - bid!);
    expect(after.teams[leader!].squad[playerId].price).toBe(bid);
    expect(after.auction!.lastResult!.seq).toBe(seq);
    expect(after.auction!.lot!.seq).toBe(seq + 1); // advanced exactly one player
    const ledger = (await s1.ref(`roomLogs/${code}/ledger/${leader}`).get()).val();
    expect(Object.values(ledger)).toHaveLength(1);
    const bids = (await s1.ref(`roomLogs/${code}/bids`).get()).val();
    expect(Object.values(bids)).toHaveLength(12); // persistent bid history
  });

  it('retried bid / card requests are idempotent', async () => {
    const code = await roomWithOwners(s1, ['r1', 'r2'], { features: { rtm: false, powerCards: true } });
    await call(s1, 'host', { action: 'startAuction', code });
    const lot = await waitForOpenLot(s1, code);
    const requestId = rid();
    const r = await Promise.all([s1, s2, s3].map((s) => call(s, 'r1', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId }).catch((e) => e)));
    expect(r.filter((x) => x.ok && !x.duplicate)).toHaveLength(1);
    expect((await readRoom(s1, code)).auction!.lot!.bids).toHaveLength(1);

    const cardReq = rid();
    const purse = (await readRoom(s1, code)).teams.CSK.purse;
    await Promise.all([s1, s2, s3].map((s) => call(s, 'r1', { action: 'buyCard', code, requestId: cardReq }).catch(() => null)));
    const room = await readRoom(s1, code);
    expect(Object.keys(room.teams.CSK.cards)).toHaveLength(1);
    const card = Object.values(room.teams.CSK.cards)[0];
    expect(room.teams.CSK.purse).toBe(purse - 500 - (card.type === 'tax_audit' ? 1000 : 0));
  });

  it('a player can never be sold twice even when relisted', async () => {
    const code = await roomWithOwners(s1, ['d1', 'd2']);
    await call(s1, 'host', { action: 'startAuction', code });
    const lot = await waitForOpenLot(s1, code);
    await call(s1, 'd1', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() });
    await call(s1, 'host', { action: 'hammer', code, lotSeq: lot.seq, sold: true });
    // Stale client re-submits a bid / hammer for the sold lot.
    expect(await errorCode(call(s2, 'd2', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice + 5, requestId: rid() }))).toBe('stale-lot');
    const dup = await call(s2, 'host', { action: 'hammer', code, lotSeq: lot.seq, sold: true });
    expect(dup.duplicate).toBe(true);
    const room = await readRoom(s1, code);
    const owners = Object.values(room.teams).filter((t) => t.squad[lot.playerId]);
    expect(owners).toHaveLength(1);
  });
});

describe('server-authoritative timer', () => {
  it('expires on the server clock without the host (owner nudges tick)', async () => {
    const code = await roomWithOwners(s1, ['t1', 't2'], { bidTimerSec: 5 });
    await call(s1, 'host', { action: 'startAuction', code });
    const lot = await waitForOpenLot(s1, code);
    await call(s1, 't1', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() });
    // Early ticks change nothing.
    expect((await call(s2, 't2', { action: 'tick', code })).message).toBe('noop');
    await new Promise((r) => setTimeout(r, 5200));
    await call(s2, 't2', { action: 'tick', code }); // the host is "disconnected": never calls anything
    const room = await readRoom(s1, code);
    expect(room.auction!.lastResult).toMatchObject({ seq: lot.seq, outcome: 'sold', teamId: 'CSK' });
  }, 20_000);

  it('the scheduled sweeper finalises overdue lots when nobody is connected', async () => {
    const code = await roomWithOwners(s1, ['z1', 'z2']);
    await call(s1, 'host', { action: 'startAuction', code });
    const lot = await waitForOpenLot(s1, code);
    await call(s1, 'z2', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() });
    const swept = await sweepExpiredLots(s3, Date.now() + 60_000); // pretend a minute passed
    expect(swept).toBeGreaterThanOrEqual(0);
    // The handler re-checks the real server clock, so nothing was finalised early:
    expect((await readRoom(s1, code)).auction!.lot!.seq).toBe(lot.seq);
    // Force the deadline into the past (as if 15s elapsed) and sweep for real.
    await s1.ref(`rooms/${code}/auction/lot/deadline`).set(Date.now() - 1);
    await sweepExpiredLots(s3);
    const room = await readRoom(s1, code);
    expect(room.auction!.lastResult).toMatchObject({ seq: lot.seq, outcome: 'sold', teamId: 'MI' });
  });

  it('pause persists across reconnects and blocks expiry', async () => {
    const code = await roomWithOwners(s1, ['q1', 'q2']);
    await call(s1, 'host', { action: 'startAuction', code });
    const lot = await waitForOpenLot(s1, code);
    await call(s1, 'host', { action: 'pause', code, paused: true });
    await s1.ref(`rooms/${code}/auction/lot/deadline`).set(Date.now() - 1);
    expect((await call(s2, 'q1', { action: 'tick', code })).message).toBe('noop');
    expect(await errorCode(call(s2, 'q1', { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() }))).toBe('paused');
    await call(s1, 'host', { action: 'pause', code, paused: false });
    const room = await readRoom(s3, code);
    expect(room.auction!.status).toBe('running');
    expect(room.auction!.lot!.deadline).toBeGreaterThan(Date.now());
  });
});

describe('end to end through the server', () => {
  it('auction → squads → tournament → champion, with duplicate match submissions rejected', async () => {
    const code = await roomWithOwners(s1, ['e1', 'e2', 'e3', 'e4']);
    await call(s1, 'host', { action: 'startAuction', code });
    // A few real sales, then close the auction (supplementary draft completes squads).
    for (let i = 0; i < 3; i++) {
      const lot = await waitForOpenLot(s1, code);
      await call(s1, ['e1', 'e2', 'e3', 'e4'][i], { action: 'placeBid', code, lotSeq: lot.seq, amount: lot.basePrice, requestId: rid() });
      await call(s1, 'host', { action: 'hammer', code, lotSeq: lot.seq, sold: true });
      const r = await readRoom(s1, code);
      if (r.auction!.lot?.status === 'rtm') await call(s1, r.teams[r.auction!.lot!.rtm!.teamId].ownerUid!, { action: 'rtmDecision', code, lotSeq: r.auction!.lot!.seq, accept: false });
    }
    await call(s1, 'host', { action: 'completeAuction', code });
    let room = await readRoom(s1, code);
    expect(room.meta.status).toBe('squads');
    for (const t of Object.values(room.teams)) expect(Object.keys(t.squad).length).toBeGreaterThanOrEqual(11);

    await call(s1, 'host', { action: 'startTournament', code });
    room = await readRoom(s1, code);
    const first = Object.values(room.tournament!.fixtures).sort((a, b) => a.number - b.number)[0];
    const sims = await Promise.allSettled([
      call(s1, 'host', { action: 'simulateMatch', code, fixtureId: first.id }),
      call(s2, 'host', { action: 'simulateMatch', code, fixtureId: first.id }),
    ]);
    expect(sims.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await errorCode(call(s1, 'e1', { action: 'simulateMatch', code, fixtureId: first.id }))).toBe('forbidden');

    await call(s1, 'host', { action: 'simulateAll', code, stage: 'all' });
    room = await readRoom(s1, code);
    expect(room.meta.status).toBe('completed');
    expect(room.tournament!.championId).toBeTruthy();
    const matches = (await s1.ref(`roomMatches/${code}`).get()).val();
    expect(Object.keys(matches)).toHaveLength(6 + 4);
    const final = matches.F;
    expect(final.winnerId).toBe(room.tournament!.championId);
  }, 60_000);
});
