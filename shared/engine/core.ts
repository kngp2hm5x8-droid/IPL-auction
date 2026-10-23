import type { Lakhs } from '../types';

/** A rule violation. `code` is machine-readable and surfaced to clients. */
export class GameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'GameError';
  }
}

export function fail(code: string, message: string): never {
  throw new GameError(code, message);
}

export function assert(cond: unknown, code: string, message: string): asserts cond {
  if (!cond) fail(code, message);
}

/* ───────────── Money (integer lakhs) ───────────── */

/** Bid increment for the *current* bid, in lakhs (v2 ladder preserved). */
export function bidIncrement(current: Lakhs): Lakhs {
  if (current < 100) return 5;
  if (current < 300) return 10;
  if (current < 1000) return 25;
  if (current < 2000) return 50;
  return 100;
}

/** The only legal next bid: base price when nobody has bid, else current + increment. */
export function nextBidAmount(current: Lakhs | null, basePrice: Lakhs): Lakhs {
  return current == null ? basePrice : current + bidIncrement(current);
}

export function formatLakhs(l: Lakhs | null | undefined): string {
  if (l == null) return '—';
  if (Math.abs(l) >= 100) {
    const cr = l / 100;
    return `₹${Number.isInteger(cr) ? cr : cr.toFixed(2).replace(/0$/, '')} Cr`;
  }
  return `₹${l} L`;
}

export function isIntegerLakhs(v: unknown): v is Lakhs {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1_000_000;
}

/* ───────────── Deterministic RNG ───────────── */

export type Rng = () => number;

/** mulberry32 – small, fast, deterministic; good enough for game simulation. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash → 32-bit seed. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRoomCode(rng: Rng): string {
  let s = 'IPL-';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}
export const ROOM_CODE_RE = /^IPL-[A-HJ-NP-Z2-9]{4}$/;
