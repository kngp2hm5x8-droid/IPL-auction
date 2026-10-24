/**
 * Plain-HTTP entry point for the authoritative game API, for hosts without Firebase Cloud
 * Functions (the free Spark plan). It runs the exact same handlers as functions/src/index.ts:
 * every action is verified against the caller's Firebase ID token and applied inside a
 * Realtime Database transaction with the Admin SDK.
 *
 * Used by api/index.ts (Vercel) and scripts/api-dev-server.ts (local).
 *
 * Environment:
 *   FIREBASE_SERVICE_ACCOUNT  JSON of a service-account key (Firebase console → Project settings
 *                             → Service accounts → Generate new private key). Keep it secret.
 *   FIREBASE_DATABASE_URL     e.g. https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app
 *   (emulators)               FIREBASE_AUTH_EMULATOR_HOST + FIREBASE_DATABASE_EMULATOR_HOST + GCLOUD_PROJECT
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { ApiError, handle } from '../functions/src/handlers';

const HTTP_STATUS: Record<ApiError['status'], number> = {
  'invalid-argument': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'failed-precondition': 409,
  aborted: 409,
};

let app: App | null = null;

function adminApp(): App {
  if (app) return app;
  const existing = getApps().find((a) => a.name === 'game-api');
  if (existing) return (app = existing);
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    const projectId = process.env.GCLOUD_PROJECT || 'demo-ipl-auction';
    app = initializeApp({ projectId, databaseURL: databaseURL || `https://${projectId}-default-rtdb.firebaseio.com` }, 'game-api');
    return app;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !databaseURL) throw new Error('Server is missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL.');
  const sa = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
  app = initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }),
    databaseURL,
  }, 'game-api');
  return app;
}

export interface HttpResult { status: number; body: unknown }

/** Mirrors the callable protocol: success → { result }, failure → { error: { status, code, message } }. */
export async function handleHttp(method: string, authorization: string | undefined, body: unknown): Promise<HttpResult> {
  if (method === 'OPTIONS') return { status: 204, body: null };
  if (method !== 'POST') return { status: 405, body: { error: { status: 'invalid-argument', code: 'method', message: 'Use POST.' } } };
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) return { status: 401, body: { error: { status: 'unauthenticated', code: 'no-token', message: 'Sign in to play.' } } };
  let uid: string;
  try {
    uid = (await getAuth(adminApp()).verifyIdToken(token)).uid;
  } catch {
    return { status: 401, body: { error: { status: 'unauthenticated', code: 'bad-token', message: 'Your session expired. Please reload.' } } };
  }
  const data = (body as { data?: unknown } | null)?.data;
  try {
    return { status: 200, body: { result: await handle(getDatabase(adminApp()), uid, data) } };
  } catch (e) {
    if (e instanceof ApiError) return { status: HTTP_STATUS[e.status] ?? 400, body: { error: { status: e.status, code: e.code, message: e.message } } };
    console.error('api failure', e);
    return { status: 500, body: { error: { status: 'internal', code: 'internal', message: 'Something went wrong. Please retry.' } } };
  }
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
