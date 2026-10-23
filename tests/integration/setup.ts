import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';
import { handle } from '../../functions/src/handlers';
import type { ApiAction, Room } from '../../shared/types';
import { normalizeRoom } from '../../shared/engine';

export const PROJECT = 'demo-ipl-auction';
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000';
export const DB_URL = `http://${host}?ns=${PROJECT}-default-rtdb`;

const apps: App[] = [];

/** Each call = an independent Admin connection, standing in for a separate Cloud Function instance. */
export function serverInstance(name: string): Database {
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = host;
  const app = initializeApp({ projectId: PROJECT, databaseURL: DB_URL }, `${name}-${Math.random().toString(36).slice(2)}`);
  apps.push(app);
  return getDatabase(app);
}

export async function closeAll() {
  await Promise.all(apps.splice(0).map((a) => deleteApp(a)));
}

export async function call(db: Database, uid: string, a: ApiAction) {
  return handle(db, uid, a);
}

export async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  return 'no-error';
}

export async function readRoom(db: Database, code: string): Promise<Room> {
  return normalizeRoom((await db.ref(`rooms/${code}`).get()).val());
}

let n = 0;
export const rid = () => `it-${Date.now().toString(36)}-${++n}`;

/** Creates a room with the host as auctioneer and N owners holding the first N franchises. */
export async function roomWithOwners(db: Database, owners: string[], settings: Record<string, unknown> = {}) {
  // RTM is off by default here so hammer outcomes are predictable; RTM has its own tests.
  const { code } = await call(db, 'host', { action: 'createRoom', name: 'Host', settings: { teamCount: Math.max(3, owners.length), features: { rtm: false, powerCards: false }, ...settings } });
  const ids = ['CSK', 'MI', 'RCB', 'KKR', 'SRH', 'RR', 'DC', 'PBKS', 'LSG', 'GT'];
  for (let i = 0; i < owners.length; i++) {
    await call(db, owners[i], { action: 'joinRoom', code: code!, name: `Owner ${i + 1}` });
    await call(db, owners[i], { action: 'claimTeam', code: code!, teamId: ids[i] });
  }
  return code!;
}

/** Waits until the current lot accepts bids (lots open after a short reveal delay). */
export async function waitForOpenLot(db: Database, code: string) {
  const room = await readRoom(db, code);
  const lot = room.auction!.lot!;
  const wait = lot.opensAt - Date.now() + 50;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return lot;
}
