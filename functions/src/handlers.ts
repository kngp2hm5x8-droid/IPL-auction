/**
 * Authoritative server-side handlers. Every game-changing operation runs here, inside a
 * Realtime Database transaction on rooms/{code}, using the shared engine. Clients have no
 * write access to rooms/* at all (see database.rules.json).
 *
 * Handlers take an Admin `Database` so they can be exercised directly against the emulator.
 */
import { randomInt } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { ApiAction, ApiResult, Room } from '../../shared/types';
import {
  GameError, ROOM_CODE_RE, applyAction, createRoomState, generateRoomCode, newEvents, nextPlayable,
  normalizeRoom, recordFixture, runFixture, sanitizeName, seededRng, type Events, type RoomAction,
} from '../../shared/engine';

export class ApiError extends Error {
  constructor(public status: 'not-found' | 'invalid-argument' | 'failed-precondition' | 'permission-denied' | 'aborted' | 'unauthenticated', public code: string, message: string) {
    super(message);
  }
}

const ROOM_ACTIONS = new Set<string>([
  'joinRoom', 'claimTeam', 'releaseTeam', 'setReady', 'updateSettings', 'setAuctioneer', 'addCustomPlayer',
  'removeCustomPlayer', 'startAuction', 'placeBid', 'hammer', 'tick', 'rtmDecision', 'undoBid', 'pause',
  'relistUnsold', 'completeAuction', 'buyCard', 'useCard', 'saveXI', 'startTournament',
]);

const PERMISSION_CODES = new Set(['forbidden', 'not-member', 'no-team']);

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof GameError) return new ApiError(PERMISSION_CODES.has(e.code) ? 'permission-denied' : 'failed-precondition', e.code, e.message);
  throw e;
}

/** JSON round-trip strips `undefined`, which the RTDB SDK rejects. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function requireCode(code: unknown): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!ROOM_CODE_RE.test(c)) throw new ApiError('invalid-argument', 'bad-code', 'Room codes look like IPL-7K3X.');
  return c;
}

export async function handle(db: Database, uid: string, data: unknown): Promise<ApiResult> {
  const act = data as ApiAction;
  if (!act || typeof act !== 'object' || typeof act.action !== 'string') throw new ApiError('invalid-argument', 'bad-action', 'Missing action.');
  try {
    if (act.action === 'createRoom') return await createRoom(db, uid, act);
    if (act.action === 'simulateMatch') return await simulateFixture(db, uid, requireCode(act.code), String(act.fixtureId));
    if (act.action === 'simulateAll') return await simulateAll(db, uid, requireCode(act.code), act.stage === 'all' ? 'all' : 'league');
    if (!ROOM_ACTIONS.has(act.action)) throw new ApiError('invalid-argument', 'bad-action', `Unknown action ${act.action}.`);
    return await runRoomAction(db, requireCode((act as { code: string }).code), uid, act as RoomAction);
  } catch (e) {
    throw toApiError(e);
  }
}

/**
 * Runs one engine action atomically. The update function may be re-run by the SDK on
 * contention; only the run that commits produces side effects (logs).
 */
export async function runRoomAction(db: Database, code: string, uid: string, act: RoomAction): Promise<ApiResult> {
  let ev: Events | null = null;
  let err: unknown = null;
  const seed = randomInt(0, 2 ** 31);
  const ref = db.ref(`rooms/${code}`);
  const res = await ref.transaction((current) => {
    ev = null; err = null;
    // The Admin SDK's first pass often runs with no cached value; returning null lets it
    // fetch the real value and retry (and commits a harmless null if the room truly is absent).
    if (current === null) return null;
    const room = normalizeRoom(current);
    try {
      ev = applyAction(room, { uid, now: Date.now(), rng: seededRng(seed) }, act);
    } catch (e) {
      err = e;
      // Not `undefined`: an aborted transaction is decided on possibly-stale cached data.
      // Writing the unchanged value back makes the server confirm we judged the latest state
      // (if not, the SDK re-runs this function with fresh data).
      return current;
    }
    if (ev.noop || ev.duplicate) return current;
    return clean(room);
  }, undefined, false);
  if (!res.snapshot.exists()) throw new ApiError('not-found', 'no-room', `Room ${code} does not exist.`);
  if (err) throw err;
  const events = ev as Events | null;
  if (!events || !res.committed) throw new ApiError('aborted', 'retry', 'The room was busy, please try again.');
  if (!events.noop && !events.duplicate) await writeLogs(db, code, events);
  if (act.action === 'joinRoom' && !events.noop) {
    await db.ref(`users/${uid}/rooms/${code}`).set({ joinedAt: Date.now() });
  }
  return { ok: true, code, duplicate: !!events.duplicate, ...(events.noop ? { message: 'noop' } : {}), ...(events.data ? { data: clean(events.data) } : {}) };
}

async function writeLogs(db: Database, code: string, ev: Events): Promise<void> {
  const at = Date.now();
  const updates: Record<string, unknown> = {};
  const push = (path: string, v: unknown) => { updates[`${path}/${db.ref(path).push().key}`] = clean(v); };
  ev.commentary.forEach((text, i) => push(`roomLogs/${code}/commentary`, { text, at: at + i }));
  ev.bids.forEach((b) => push(`roomLogs/${code}/bids`, b));
  ev.ledger.forEach((l) => push(`roomLogs/${code}/ledger/${l.teamId}`, l));
  if (Object.keys(updates).length) await db.ref().update(updates);
}

async function createRoom(db: Database, uid: string, act: Extract<ApiAction, { action: 'createRoom' }>): Promise<ApiResult> {
  const name = sanitizeName(act.name);
  const rng = seededRng(randomInt(0, 2 ** 31));
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateRoomCode(rng);
    const now = Date.now();
    const room: Room = createRoomState(code, uid, name, now, act.settings ?? {}, act.asAuctioneer !== false);
    let collided = false;
    const res = await db.ref(`rooms/${code}`).transaction((cur) => {
      if (cur !== null) { collided = true; return undefined; }
      collided = false;
      return clean(room);
    }, undefined, false);
    if (res.committed && !collided) {
      await db.ref().update({
        [`users/${uid}/rooms/${code}`]: { joinedAt: now },
        [`roomLogs/${code}/commentary/${db.ref().push().key}`]: { text: `${name} opened room ${code}.`, at: now },
      });
      return { ok: true, code };
    }
  }
  throw new ApiError('aborted', 'code-collision', 'Could not allocate a room code, please retry.');
}

async function loadRoom(db: Database, code: string): Promise<Room> {
  const snap = await db.ref(`rooms/${code}`).get();
  if (!snap.exists()) throw new ApiError('not-found', 'no-room', `Room ${code} does not exist.`);
  return normalizeRoom(snap.val());
}

/**
 * Simulates one fixture with the shared engine and records it exactly once.
 * The seed is derived from the fixture and the (locked) XIs, so two concurrent requests
 * compute the identical match; the transaction lets only one of them record it.
 */
export async function simulateFixture(db: Database, uid: string, code: string, fixtureId: string): Promise<ApiResult> {
  const room = await loadRoom(db, code);
  if (!room.members[uid]?.isHost && !room.members[uid]?.isAuctioneer) throw new ApiError('permission-denied', 'forbidden', 'Only the host or auctioneer can run matches.');
  const { result, summary } = runFixture(room, fixtureId);
  await db.ref(`roomMatches/${code}/${fixtureId}`).set(clean(result));
  const ev = await runInRoom(db, code, (r, ctx) => {
    const e = newEvents();
    recordFixture(r, ctx(uid), fixtureId, summary, e);
    return e;
  });
  await writeLogs(db, code, ev);
  return { ok: true, code, data: { fixtureId, winnerId: summary.winnerId, margin: summary.margin } };
}

async function simulateAll(db: Database, uid: string, code: string, stage: 'league' | 'all'): Promise<ApiResult> {
  let played = 0;
  for (let i = 0; i < 120; i++) {
    const room = await loadRoom(db, code);
    const f = nextPlayable(room.tournament);
    if (!f || (stage === 'league' && f.stage !== 'league')) break;
    await simulateFixture(db, uid, code, f.id);
    played++;
  }
  return { ok: true, code, data: { played } };
}

async function runInRoom(db: Database, code: string, fn: (room: Room, ctx: (uid: string) => { uid: string; now: number; rng: () => number }) => Events): Promise<Events> {
  let ev: Events | null = null;
  let err: unknown = null;
  const res = await db.ref(`rooms/${code}`).transaction((cur) => {
    ev = null; err = null;
    if (cur === null) return null;
    const room = normalizeRoom(cur);
    try {
      ev = fn(room, (uid) => ({ uid, now: Date.now(), rng: seededRng(randomInt(0, 2 ** 31)) }));
    } catch (e) {
      err = e;
      return cur; // see runRoomAction: confirm against fresh server state
    }
    return clean(room);
  }, undefined, false);
  if (!res.snapshot.exists()) throw new ApiError('not-found', 'no-room', `Room ${code} does not exist.`);
  if (err) throw err;
  return ev ?? newEvents();
}

/** Finalises every lot whose deadline has passed, even when no browser is connected. */
export async function sweepExpiredLots(db: Database, now = Date.now()): Promise<number> {
  const snap = await db.ref('rooms').orderByChild('meta/status').equalTo('auction').get();
  let swept = 0;
  const jobs: Promise<unknown>[] = [];
  snap.forEach((child) => {
    const lot = child.child('auction/lot').val();
    const status = child.child('auction/status').val();
    const due = lot && status === 'running' && ((lot.status === 'bidding' && lot.deadline <= now) || (lot.status === 'rtm' && lot.rtm?.deadline <= now));
    if (due) {
      swept++;
      jobs.push(runRoomAction(db, child.key!, 'system', { action: 'tick', code: child.key! }).catch(() => undefined));
    }
  });
  await Promise.all(jobs);
  return swept;
}
