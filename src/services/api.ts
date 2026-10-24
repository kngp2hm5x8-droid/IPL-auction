import { httpsCallable, type FunctionsError } from 'firebase/functions';
import type { ApiAction, ApiResult } from '@shared/types';
import { auth, functions } from './firebase';
import { toast } from '@/stores/toast';

/**
 * Two interchangeable transports to the same authoritative server code:
 *  - VITE_API_URL set   → plain HTTPS endpoint (Vercel function; works on the free Spark plan)
 *  - otherwise          → Firebase callable Cloud Function `api` (needs the Blaze plan)
 */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const callable = httpsCallable<ApiAction, ApiResult>(functions, 'api', { timeout: 30_000 });

export class GameApiError extends Error {
  code: string;
  transient: boolean;
  constructor(code: string, message: string, transient = false) {
    super(message);
    this.code = code;
    this.transient = transient;
  }
}

/** Transient failures worth retrying with the SAME request id (server de-duplicates). */
const RETRYABLE = new Set(['functions/unavailable', 'functions/deadline-exceeded', 'functions/aborted', 'functions/internal']);

async function viaCallable(action: ApiAction): Promise<ApiResult> {
  try {
    return (await callable(action)).data;
  } catch (e) {
    const fe = e as FunctionsError;
    const details = fe.details as { code?: string } | undefined;
    throw new GameApiError(details?.code ?? fe.code ?? 'error', fe.message || 'Request failed', RETRYABLE.has(fe.code) && !details?.code);
  }
}

async function viaHttp(action: ApiAction): Promise<ApiResult> {
  const user = auth.currentUser;
  if (!user) throw new GameApiError('unauthenticated', 'Still signing you in — try again in a moment.', true);
  let res: Response;
  try {
    res = await fetch(API_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ data: action }),
    });
  } catch {
    throw new GameApiError('network', 'Network problem — check your connection.', true);
  }
  const body = (await res.json().catch(() => null)) as { result?: ApiResult; error?: { status: string; code: string; message: string } } | null;
  if (res.ok && body?.result) return body.result;
  const err = body?.error;
  const transient = res.status >= 500 || err?.status === 'aborted' || (res.status === 401 && err?.code === 'bad-token');
  throw new GameApiError(err?.code ?? `http-${res.status}`, err?.message ?? 'Request failed', transient);
}

export async function api(action: ApiAction, opts: { retries?: number } = {}): Promise<ApiResult> {
  const retries = opts.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return await (API_URL ? viaHttp(action) : viaCallable(action));
    } catch (e) {
      if (e instanceof GameApiError && e.transient && attempt < retries) {
        if (e.code === 'bad-token') await auth.currentUser?.getIdToken(true);
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

/** Runs an action and reports failures as a toast. Returns null on failure. */
export async function run(action: ApiAction, success?: string): Promise<ApiResult | null> {
  try {
    const r = await api(action);
    if (success) toast.success(success);
    return r;
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  }
}

export const requestId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).slice(0, 40);
