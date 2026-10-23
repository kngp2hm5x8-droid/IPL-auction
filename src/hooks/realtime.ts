import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  limitToLast, onDisconnect, onValue, query, ref, serverTimestamp, set, orderByChild,
} from 'firebase/database';
import type { MatchResult, Room } from '@shared/types';
import { normalizeRoom } from '@shared/engine/room';
import { normalizeMatch } from '@shared/engine/match';
import { db } from '@/services/firebase';

export type Loadable<T> = { status: 'loading' } | { status: 'missing' } | { status: 'error'; error: string } | { status: 'ready'; data: T };

/** Live, normalized room state from rooms/{code}. */
export function useRoom(code: string | undefined): Loadable<Room> {
  const [state, setState] = useState<Loadable<Room>>({ status: 'loading' });
  useEffect(() => {
    if (!code) return;
    setState({ status: 'loading' });
    return onValue(
      ref(db, `rooms/${code}`),
      (snap) => setState(snap.exists() ? { status: 'ready', data: normalizeRoom(snap.val()) } : { status: 'missing' }),
      (err) => setState({ status: 'error', error: err.message }),
    );
  }, [code]);
  return state;
}

export interface CommentaryLine { id: string; text: string; at: number }

export function useCommentary(code: string, limit = 40): CommentaryLine[] {
  const [lines, setLines] = useState<CommentaryLine[]>([]);
  useEffect(() => {
    return onValue(query(ref(db, `roomLogs/${code}/commentary`), orderByChild('at'), limitToLast(limit)), (snap) => {
      const out: CommentaryLine[] = [];
      snap.forEach((c) => { out.push({ id: c.key!, ...(c.val() as { text: string; at: number }) }); });
      setLines(out.reverse());
    });
  }, [code, limit]);
  return lines;
}

export interface LedgerLine { id: string; delta: number; reason: string; at: number }
export function useLedger(code: string, teamId: string | null): LedgerLine[] {
  const [lines, setLines] = useState<LedgerLine[]>([]);
  useEffect(() => {
    if (!teamId) { setLines([]); return; }
    return onValue(query(ref(db, `roomLogs/${code}/ledger/${teamId}`), limitToLast(100)), (snap) => {
      const out: LedgerLine[] = [];
      snap.forEach((c) => { out.push({ id: c.key!, ...(c.val() as Omit<LedgerLine, 'id'>) }); });
      setLines(out.reverse());
    });
  }, [code, teamId]);
  return lines;
}

/** uid → online for everyone in the room. */
export function usePresence(code: string): Record<string, boolean> {
  const [map, setMap] = useState<Record<string, boolean>>({});
  useEffect(() => onValue(ref(db, `presence/${code}`), (snap) => {
    const m: Record<string, boolean> = {};
    snap.forEach((c) => { m[c.key!] = !!c.child('online').val(); });
    setMap(m);
  }), [code]);
  return map;
}

/** Marks the current user online while connected; Firebase flips it offline on disconnect. */
export function useAnnouncePresence(code: string, uid: string | null, isMember: boolean) {
  useEffect(() => {
    if (!uid || !isMember) return;
    const mine = ref(db, `presence/${code}/${uid}`);
    return onValue(ref(db, '.info/connected'), (snap) => {
      if (snap.val() !== true) return;
      onDisconnect(mine).set({ online: false, lastChanged: serverTimestamp() })
        .then(() => set(mine, { online: true, lastChanged: serverTimestamp() }))
        .catch(() => { /* rules reject non-members; nothing to show */ });
    });
  }, [code, uid, isMember]);
}

export function useConnected(): boolean {
  const [c, setC] = useState(true);
  useEffect(() => onValue(ref(db, '.info/connected'), (s) => setC(s.val() === true)), []);
  return c;
}

export function useMatch(code: string, fixtureId: string | undefined): Loadable<MatchResult> {
  const [state, setState] = useState<Loadable<MatchResult>>({ status: 'loading' });
  useEffect(() => {
    if (!fixtureId) return;
    return onValue(ref(db, `roomMatches/${code}/${fixtureId}`), (snap) =>
      setState(snap.exists() ? { status: 'ready', data: normalizeMatch(snap.val()) } : { status: 'missing' }),
      (e) => setState({ status: 'error', error: e.message }));
  }, [code, fixtureId]);
  return state;
}

export function useMyRooms(uid: string | null): string[] {
  const [codes, setCodes] = useState<string[]>([]);
  useEffect(() => {
    if (!uid) return;
    return onValue(ref(db, `users/${uid}/rooms`), (snap) => {
      const list: { code: string; at: number }[] = [];
      snap.forEach((c) => { list.push({ code: c.key!, at: c.child('joinedAt').val() ?? 0 }); });
      setCodes(list.sort((a, b) => b.at - a.at).slice(0, 5).map((x) => x.code));
    }, () => setCodes([]));
  }, [uid]);
  return codes;
}

/* ───────────── Server clock ───────────── */

let offset = 0;
const listeners = new Set<() => void>();
let started = false;
function startOffset() {
  if (started) return;
  started = true;
  onValue(ref(db, '.info/serverTimeOffset'), (s) => {
    offset = Number(s.val()) || 0;
    listeners.forEach((l) => l());
  });
}

/** Current time on the server's clock (local clock + measured offset). */
export function serverNow(): number {
  return Date.now() + offset;
}

/** Re-renders every `intervalMs` with server time; used for countdowns. */
export function useServerNow(intervalMs = 200): number {
  startOffset();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => offset);
  return now;
}

/** Remembers the previous value of something across renders. */
export function usePrevious<T>(v: T): T | undefined {
  const r = useRef<T | undefined>(undefined);
  useEffect(() => { r.current = v; }, [v]);
  return r.current;
}
