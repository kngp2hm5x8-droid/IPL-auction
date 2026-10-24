/**
 * Local stand-in for the Vercel function: serves POST http://localhost:8787/api.
 *   npm run api:dev        (against the emulators; started for you by `npm run dev:free`)
 */
import { createServer } from 'node:http';
import { CORS_HEADERS, handleHttp } from '../server/httpApi';

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIREBASE_DATABASE_EMULATOR_HOST ??= '127.0.0.1:9000';
process.env.GCLOUD_PROJECT ??= 'demo-ipl-auction';
const port = Number(process.env.PORT ?? 8787);

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    let body: unknown = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* handled as bad request */ }
    const out = req.url?.startsWith('/api')
      ? await handleHttp(req.method ?? 'GET', req.headers.authorization, body)
      : { status: 404, body: { error: { status: 'not-found', code: 'route', message: 'Not found' } } };
    res.writeHead(out.status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(out.body == null ? '' : JSON.stringify(out.body));
  });
}).listen(port, () => console.log(`Game API listening on http://localhost:${port}/api (emulators)`));
