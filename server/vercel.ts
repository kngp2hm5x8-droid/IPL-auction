/**
 * Vercel serverless function source: POST /api (free Hobby plan; no Firebase Blaze plan needed).
 * Same authoritative handlers as the Firebase Cloud Function — see server/httpApi.ts.
 *
 * Vercel compiles api/* files one by one as ES modules, which breaks this project's
 * extension-less imports and JSON import. So this file is bundled into a single,
 * self-contained api/index.js by `npm run api:bundle` (run by `npm run build`), and that
 * bundle is committed. Edit this file, never api/index.js.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CORS_HEADERS, handleHttp } from './httpApi';

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body !== 'string') return req.body;
    try { return JSON.parse(req.body); } catch { return null; }
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const out = await handleHttp(req.method ?? 'GET', req.headers.authorization, await readBody(req));
  res.writeHead(out.status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(out.body == null ? '' : JSON.stringify(out.body));
}
