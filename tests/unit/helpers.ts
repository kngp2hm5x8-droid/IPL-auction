import type { Room, RoomSettings } from '../../shared/types';
import { applyAction, createRoomState, seededRng, type Ctx, type RoomAction, normalizeRoom } from '../../shared/engine';

export const HOST = 'host';
export const U = ['u1', 'u2', 'u3', 'u4'];

export class Clock {
  t = 1_700_000_000_000;
  advance(ms: number) { this.t += ms; return this.t; }
}

/** Runs an action the way the Cloud Function does: on a deep copy, committed only on success. */
export function act(room: Room, uid: string, a: RoomAction, clock: Clock, seed = 7) {
  const draft = structuredClone(room);
  const ctx: Ctx = { uid, now: clock.t, rng: seededRng(seed) };
  const ev = applyAction(draft, ctx, a);
  // Mimic RTDB storage (drops null / empty collections) and re-normalize, as the server does.
  const stored = normalizeRoom(rtdb(JSON.parse(JSON.stringify(draft))));
  Object.assign(room, stored);
  return ev;
}

/** Emulates how Realtime Database stores a value: nulls and empty objects/arrays disappear. */
export function rtdb(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const arr = v.map(rtdb);
    return arr.some((x) => x !== undefined) ? arr.map((x) => (x === undefined ? null : x)) : undefined;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as object)) {
      const r = rtdb(x);
      if (r !== undefined) out[k] = r;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

export function expectGameError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c !== code) throw new Error(`Expected GameError "${code}" but got "${c}": ${(e as Error).message}`);
    return;
  }
  throw new Error(`Expected GameError "${code}" but nothing was thrown`);
}

/** Lobby with host as auctioneer and `owners` users each owning a franchise (CSK, MI, RCB, …). */
export function lobby(owners = 2, settings: Partial<RoomSettings> = {}, clock = new Clock()) {
  const room = createRoomState('IPL-TEST', HOST, 'Host', clock.t, { teamCount: Math.max(owners, 3), ...settings });
  const teamIds = Object.keys(room.teams);
  for (let i = 0; i < owners; i++) {
    act(room, U[i], { action: 'joinRoom', code: 'IPL-TEST', name: `Owner ${i + 1}` }, clock);
    act(room, U[i], { action: 'claimTeam', code: 'IPL-TEST', teamId: teamIds[i] }, clock);
  }
  return { room, clock, teamIds: teamIds.slice(0, owners) };
}

export function started(owners = 2, settings: Partial<RoomSettings> = {}) {
  const l = lobby(owners, settings);
  act(l.room, HOST, { action: 'startAuction', code: 'IPL-TEST' }, l.clock);
  l.clock.advance(1100); // past the reveal window of the first lot
  return l;
}

let reqN = 0;
export const rid = () => `req-${++reqN}-${Math.random().toString(36).slice(2, 8)}`;

export function bid(room: Room, uid: string, clock: Clock, amount?: number) {
  const lot = room.auction!.lot!;
  const next = amount ?? (lot.bid == null ? lot.basePrice : undefined);
  const amt = next ?? lot.bid! + (lot.bid! < 100 ? 5 : lot.bid! < 300 ? 10 : lot.bid! < 1000 ? 25 : lot.bid! < 2000 ? 50 : 100);
  return act(room, uid, { action: 'placeBid', code: 'IPL-TEST', lotSeq: lot.seq, amount: amt, requestId: rid() }, clock);
}

export function totalMoney(room: Room) {
  const purses = Object.values(room.teams).reduce((s, t) => s + t.purse, 0);
  const spent = Object.values(room.teams).reduce((s, t) => s + Object.values(t.squad).reduce((x, e) => x + e.price, 0), 0);
  return { purses, spent, sum: purses + spent };
}
