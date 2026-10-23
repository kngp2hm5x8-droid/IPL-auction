import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { logger } from 'firebase-functions';
import { ApiError, handle, sweepExpiredLots } from './handlers';

// In production FIREBASE_CONFIG carries the real database URL. In the emulator it points at a
// namespace named after the project id, not the "<project>-default-rtdb" instance that the web
// client and the security rules use, so target that explicitly when emulating.
const fbConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}') as { projectId?: string; databaseURL?: string };
const projectId = fbConfig.projectId || process.env.GCLOUD_PROJECT;
const emulating = process.env.FUNCTIONS_EMULATOR === 'true';
const databaseURL = process.env.DATABASE_URL
  || (emulating && projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : fbConfig.databaseURL);
initializeApp(databaseURL ? { databaseURL } : undefined);

/** Keep functions next to the Realtime Database instance (asia-southeast1 for the existing project). */
setGlobalOptions({ region: process.env.FUNCTIONS_REGION || 'asia-southeast1', maxInstances: 20 });

/**
 * Single callable entry point: `api({ action, ...payload })`.
 * Requires Firebase Authentication (anonymous guests are fine).
 */
export const api = onCall({ cors: true, concurrency: 80 }, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to play.');
  try {
    return await handle(getDatabase(), req.auth.uid, req.data);
  } catch (e) {
    if (e instanceof ApiError) throw new HttpsError(e.status, e.message, { code: e.code });
    logger.error('api failure', { action: (req.data as { action?: string })?.action, error: String(e) });
    throw new HttpsError('internal', 'Something went wrong. Please retry.');
  }
});

/**
 * Safety net for the server-authoritative timer: clients nudge `tick` the moment a deadline
 * passes, and this sweeper finalises anything still overdue once a minute (e.g. if every
 * browser in the room was closed).
 */
export const sweepAuctions = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 50 }, async () => {
  const swept = await sweepExpiredLots(getDatabase());
  if (swept) logger.info(`finalised ${swept} overdue lot(s)`);
});
