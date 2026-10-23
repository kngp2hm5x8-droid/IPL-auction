import { useEffect, useMemo, useRef } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Copy, Gavel, LayoutGrid, ListChecks, Trophy, Users, WifiOff, Shirt, SearchX } from 'lucide-react';
import type { Room } from '@shared/types';
import { Brand } from '@/components/Brand';
import { Badge, Button, Card, CardHeader, EmptyState, Spinner, cn } from '@/components/ui';
import { useAnnouncePresence, useConnected, usePresence, useRoom, serverNow } from '@/hooks/realtime';
import { useSession } from '@/stores/session';
import { api } from '@/services/api';
import { toast } from '@/stores/toast';
import { RoomContext, roleLabel, useRoomCtx as useCtxSafe, type RoomCtx } from './RoomContext';
import { JoinForm } from './JoinForm';

const STATUS_LABEL: Record<Room['meta']['status'], { text: string; tone: 'gold' | 'success' | 'info' | 'danger' | 'neutral' }> = {
  lobby: { text: 'Lobby', tone: 'info' },
  auction: { text: 'Auction live', tone: 'danger' },
  squads: { text: 'Squad selection', tone: 'gold' },
  tournament: { text: 'Season live', tone: 'success' },
  completed: { text: 'Season complete', tone: 'gold' },
};

export function RoomLayout() {
  const code = (useParams().code ?? '').toUpperCase();
  const uid = useSession((s) => s.uid)!;
  const state = useRoom(code);
  const presence = usePresence(code);
  const connected = useConnected();
  const location = useLocation();
  const room = state.status === 'ready' ? state.data : null;
  const me = room?.members[uid] ?? null;
  useAnnouncePresence(code, uid, !!me);

  const ctx = useMemo<RoomCtx | null>(() => {
    if (!room) return null;
    const myTeam = me?.teamId && room.teams[me.teamId]?.ownerUid === uid ? room.teams[me.teamId] : null;
    return { code, room, uid, me, myTeam, isHost: !!me?.isHost, isController: !!(me?.isHost || me?.isAuctioneer), presence };
  }, [room, me, uid, code, presence]);

  if (state.status === 'loading') return <Spinner label="Connecting to room…" className="min-h-dvh" />;
  if (state.status === 'missing') {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <EmptyState icon={<SearchX className="size-5" />} title={`Room ${code} not found`} action={<NavLink to="/"><Button variant="primary">Home</Button></NavLink>}>
          Check the code or ask the host for a new link.
        </EmptyState>
      </div>
    );
  }
  if (state.status === 'error') return <EmptyState title="Could not load the room">{state.error}</EmptyState>;
  if (!ctx) return null;

  if (!me) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Brand />
        <Card className="mt-8">
          <CardHeader title={`Join room ${code}`} subtitle="You are not in this room yet." />
          <div className="p-5"><JoinForm room={ctx.room} code={code} /></div>
        </Card>
      </div>
    );
  }

  const status = STATUS_LABEL[ctx.room.meta.status];
  return (
    <RoomContext.Provider value={ctx}>
      <AuctionClockDriver />
      <div className="min-h-dvh pb-24 md:pb-10">
        <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/85 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
            <Brand compact />
            <button
              onClick={() => navigator.clipboard?.writeText(code).then(() => toast.success('Room code copied'))}
              className="group inline-flex items-center gap-2 rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1 font-display text-lg tracking-[0.2em] text-gold-300 hover:border-gold-400/50"
              aria-label={`Room code ${code}. Copy`}
            >
              {code}<Copy className="size-3.5 text-subtle group-hover:text-gold-300" aria-hidden />
            </button>
            <Badge tone={status.tone} className="hidden sm:inline-flex">{status.text}</Badge>
            {!connected && <Badge tone="danger"><WifiOff className="size-3" />Reconnecting</Badge>}
            <div className="ml-auto flex items-center gap-2 text-right">
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-semibold">{me.name}</div>
                <div className="text-[11px] text-subtle">{roleLabel(ctx)}{ctx.myTeam ? ` · ${ctx.myTeam.short}` : ''}</div>
              </div>
            </div>
          </div>
          <RoomTabs className="mx-auto hidden max-w-7xl px-4 md:flex" />
        </header>
        <main className="mx-auto min-w-0 max-w-7xl px-4 pt-5">
          <ErrorBoundary resetKey={location.pathname}><Outlet /></ErrorBoundary>
        </main>
        <RoomTabs mobile className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-ink-900/95 px-1 pt-1.5 backdrop-blur-xl md:hidden" />
      </div>
    </RoomContext.Provider>
  );
}

function RoomTabs({ className, mobile }: { className?: string; mobile?: boolean }) {
  const { room, myTeam } = useCtxSafe();
  const s = room.meta.status;
  const after = (states: Room['meta']['status'][]) => states.includes(s);
  const tabs = [
    { to: 'lobby', label: 'Lobby', icon: Users, show: true },
    { to: 'auction', label: 'Auction', icon: Gavel, show: after(['auction', 'squads', 'tournament', 'completed']) },
    { to: 'players', label: 'Players', icon: LayoutGrid, show: true },
    { to: 'squad', label: 'Squads', icon: Shirt, show: after(['auction', 'squads', 'tournament', 'completed']) },
    { to: 'xi', label: 'Playing XI', icon: ListChecks, show: !!myTeam && after(['squads', 'tournament', 'completed']) },
    { to: 'tournament', label: 'Season', icon: Trophy, show: after(['squads', 'tournament', 'completed']) },
  ].filter((t) => t.show);
  return (
    <nav className={cn(mobile ? 'grid' : 'flex gap-1', className)} style={mobile ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined} aria-label="Room sections">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => cn(
            mobile
              ? 'flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold'
              : 'inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold',
            isActive ? (mobile ? 'text-gold-300' : 'border-gold-400 text-fg') : (mobile ? 'text-subtle' : 'border-transparent text-muted hover:text-fg'),
          )}
        >
          <t.icon className={mobile ? 'size-5' : 'size-4'} aria-hidden />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}


/** Sends the room to the right section for its current phase. */
export function RoomIndex() {
  const { room, myTeam } = useCtxSafe();
  const s = room.meta.status;
  const to = s === 'lobby' ? 'lobby' : s === 'auction' ? 'auction' : s === 'squads' ? (myTeam ? 'xi' : 'squad') : 'tournament';
  return <Navigate to={to} replace />;
}

/**
 * The auction clock is server-authoritative: deadlines live in the database and only the
 * server decides when a lot is over. Every connected member nudges the server (`tick`) once
 * when a deadline passes; duplicate nudges are harmless no-ops. A scheduled function covers
 * rooms where nobody is connected.
 */
function AuctionClockDriver() {
  const { room, code } = useCtxSafe();
  const a = room.auction;
  const lot = a?.status === 'running' ? a.lot : null;
  const due = lot ? (lot.status === 'rtm' && lot.rtm ? lot.rtm.deadline : lot.deadline) : null;
  const key = lot ? `${lot.seq}:${lot.status}:${due}` : null;
  const sent = useRef<string | null>(null);
  const nav = useNavigate();
  const prevStatus = useRef(room.meta.status);

  useEffect(() => {
    if (!key || due == null) return;
    const jitter = 150 + Math.random() * 450;
    const wait = Math.max(0, due - serverNow()) + jitter;
    const id = setTimeout(() => {
      if (sent.current === key) return;
      sent.current = key;
      api({ action: 'tick', code }).catch(() => { /* another client or the sweeper will finish it */ });
    }, wait);
    return () => clearTimeout(id);
  }, [key, due, code]);

  // Follow phase changes (lobby → auction, auction → squads, …) for everyone in the room.
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = room.meta.status;
    if (prev === room.meta.status) return;
    if (room.meta.status === 'auction') nav('auction');
    if (room.meta.status === 'squads') toast.info('The auction is complete — time to pick your Playing XI.');
    if (room.meta.status === 'tournament') nav('tournament');
  }, [room.meta.status, nav]);
  return null;
}
