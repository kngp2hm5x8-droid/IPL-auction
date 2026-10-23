/** Security-rules tests: ordinary clients must not be able to change game state directly. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, get, set, update, remove, serverTimestamp } from 'firebase/database';
import { PROJECT } from './setup';

let env: RulesTestEnvironment;
const CODE = 'IPL-RULE';

beforeAll(async () => {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    database: { host, port: Number(port), rules: readFileSync(resolve(__dirname, '../../database.rules.json'), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `rooms/${CODE}`), {
      meta: { code: CODE, status: 'auction', hostUid: 'host' },
      members: { alice: { name: 'Alice', teamId: 'CSK' }, host: { name: 'Host', isHost: true } },
      teams: { CSK: { purse: 8000, ownerUid: 'alice' }, MI: { purse: 8000 } },
      auction: { lot: { bid: 200, leader: 'MI' } },
    });
    await set(ref(ctx.database(), `roomLogs/${CODE}/commentary/x`), { text: 'hi', at: 1 });
  });
});
afterAll(() => env?.cleanup());

describe('database rules', () => {
  it('authenticated users can read rooms and logs; anonymous visitors cannot', async () => {
    const alice = env.authenticatedContext('alice').database();
    await assertSucceeds(get(ref(alice, `rooms/${CODE}`)));
    await assertSucceeds(get(ref(alice, `roomLogs/${CODE}/commentary`)));
    const anon = env.unauthenticatedContext().database();
    await assertFails(get(ref(anon, `rooms/${CODE}`)));
    await assertFails(get(ref(alice, 'rooms'))); // no listing of every room
  });

  it('owners cannot edit purses, squads, bids, results or room settings', async () => {
    const alice = env.authenticatedContext('alice').database();
    await assertFails(set(ref(alice, `rooms/${CODE}/teams/CSK/purse`), 999999));
    await assertFails(update(ref(alice, `rooms/${CODE}/teams/CSK/squad`), { P001: { price: 0 } }));
    await assertFails(update(ref(alice, `rooms/${CODE}/auction/lot`), { leader: 'CSK', bid: 1 }));
    await assertFails(set(ref(alice, `rooms/${CODE}/tournament/championId`), 'CSK'));
    await assertFails(set(ref(alice, `rooms/${CODE}/meta/hostUid`), 'alice'));
    await assertFails(set(ref(alice, `roomMatches/${CODE}/L01`), { winnerId: 'CSK' }));
    await assertFails(set(ref(alice, `roomLogs/${CODE}/commentary/y`), { text: 'fake', at: 2 }));
    await assertFails(remove(ref(alice, `rooms/${CODE}`)));
    await assertFails(set(ref(alice, 'rooms/IPL-NEWW'), { meta: { hostUid: 'alice' } }));
  });

  it('even the host cannot bypass the server', async () => {
    const host = env.authenticatedContext('host').database();
    await assertFails(set(ref(host, `rooms/${CODE}/teams/MI/purse`), 0));
  });

  it('members may only write their own presence', async () => {
    const alice = env.authenticatedContext('alice').database();
    await assertSucceeds(set(ref(alice, `presence/${CODE}/alice`), { online: true, lastChanged: serverTimestamp() }));
    await assertFails(set(ref(alice, `presence/${CODE}/host`), { online: false, lastChanged: serverTimestamp() }));
    await assertFails(set(ref(alice, `presence/${CODE}/alice`), { online: true, lastChanged: serverTimestamp(), purse: 1 }));
    const stranger = env.authenticatedContext('stranger').database();
    await assertFails(set(ref(stranger, `presence/${CODE}/stranger`), { online: true, lastChanged: serverTimestamp() }));
  });

  it('users manage only their own profile; room membership index is server-written', async () => {
    const alice = env.authenticatedContext('alice').database();
    await assertSucceeds(set(ref(alice, 'users/alice/profile'), { name: 'Alice' }));
    await assertFails(set(ref(alice, 'users/alice/profile'), { name: 'A' }));
    await assertFails(set(ref(alice, 'users/bob/profile'), { name: 'Bobby' }));
    await assertFails(set(ref(alice, `users/alice/rooms/${CODE}`), { joinedAt: 1 }));
    await assertFails(get(ref(alice, 'users/bob')));
  });
});
