import { httpsCallable, type FunctionsError } from 'firebase/functions';
import type { ApiAction, ApiResult } from '@shared/types';
import { functions } from './firebase';
import { toast } from '@/stores/toast';

const callable = httpsCallable<ApiAction, ApiResult>(functions, 'api', { timeout: 30_000 });

export class GameApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Transient failures worth retrying with the SAME request id (server de-duplicates). */
const RETRYABLE = new Set(['functions/unavailable', 'functions/deadline-exceeded', 'functions/aborted', 'functions/internal']);

export async function api(action: ApiAction, opts: { retries?: number } = {}): Promise<ApiResult> {
  const retries = opts.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await callable(action);
      return res.data;
    } catch (e) {
      const fe = e as FunctionsError;
      const details = fe.details as { code?: string } | undefined;
      if (RETRYABLE.has(fe.code) && attempt < retries && !details?.code) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw new GameApiError(details?.code ?? fe.code ?? 'error', fe.message || 'Request failed');
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
