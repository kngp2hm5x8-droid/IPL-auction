/**
 * Vercel serverless function: POST /api  (free Hobby plan; no Firebase Blaze plan needed).
 * Same authoritative handlers as the Firebase Cloud Function — see server/httpApi.ts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CORS_HEADERS, handleHttp } from '../server/httpApi';

export const config = { maxDuration: 30 };

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const out = await handleHttp(req.method ?? 'GET', req.headers.authorization, body);
  res.writeHead(out.status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(out.body == null ? '' : JSON.stringify(out.body));
}
