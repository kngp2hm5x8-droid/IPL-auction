import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Pause, Play, Undo2, Gavel, XCircle, CheckCircle2, Snowflake, Eye, RotateCcw, Flag, ShieldCheck, Timer, ListOrdered, History, Radio,
} from 'lucide-react';
import type { LotResult, Room } from '@shared/types';
import { formatLakhs, nextBidAmount } from '@shared/engine/core';
import { maxBidFor } from '@shared/engine/auction';
import { findPlayer } from '@shared/data/players';
import { overseasInSquad, playerOf } from '@shared/engine/room';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, SectionLabel, cn } from '@/components/ui';
import {
  Country, CountdownRing, Money, OverseasTag, PlayerAvatar, RatingPill, RoleBadge, RtmTag, TeamChip, TeamCrest, TierBadge, franchiseColor, teamShort, ROLE_NAME,
} from '@/components/game';
import { useCommentary, useServerNow } from '@/hooks/realtime';
import { api, requestId, run } from '@/services/api';
import { toast } from '@/stores/toast';
import { useRoomCtx } from '@/features/rooms/RoomContext';
import { bidBlocker, lotDeadline, lotTimerMs, visiblePurse } from './logic';
import { CardsPanel } from './CardsPanel';

export default function AuctionPage() {
  const { room, code } = useRoomCtx();
  const a = room.auction;
  if (!a) {
    return <EmptyState icon={<Gavel className="size-5" />} title="The auction hasn’t started" action={<Link to="../lobby"><Button variant="primary">Go to lobby</Button></Link>}>The host starts the auction from the lobby.</EmptyState>;
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-5">
        <AuctionHeader room={room} />
        {a.status === 'completed' ? <AuctionComplete /> : a.status === 'round_end' ? <RoundEnd /> : <LiveLot />}
        <div className="grid gap-5 lg:grid-cols-2">
          {a.status !== 'completed' && <UpNext />}
          <Commentary code={code} />
        </div>
      </div>
      <aside className="space-y-5"><TeamsBoard /></aside>
      <ResultOverlay result={a.lastResult} />
    </div>
  );
}

function AuctionHeader({ room }: { room: Room }) {
  const a = room.auction!;
  const sold = Object.keys(a.sold).length;
  const pct = a.queue.length ? Math.min(100, (Math.min(a.cursor + 1, a.queue.length) / a.queue.length) * 100) : 100;
  const pill = a.status === 'paused' ? <Badge tone="warn"><Pause className="size-3" />Paused</Badge>
    : a.status === 'completed' ? <Badge tone="gold">Complete</Badge>
      : a.status === 'round_end' ? <Badge tone="info">Round {a.round} ended</Badge>
        : <Badge tone="danger"><Radio className="size-3" />Live</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <h1 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">Live auction</h1>
      {pill}
      <div className="flex min-w-48 flex-1 items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Auction progress">
          <div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular text-xs text-muted">Round {a.round} · Lot {Math.min(a.cursor + 1, a.queue.length)}/{a.queue.length} · {sold} sold · {a.unsold.length} unsold</span>
      </div>
    </div>
  );
}

function LiveLot() {
  const ctx = useRoomCtx();
  const { room, myTeam, isController } = ctx;
  const a = room.auction!;
  const lot = a.lot;
  const now = useServerNow(150);
  if (!lot) return null;
  const player = playerOf(room, lot.playerId);
  const paused = a.status === 'paused';
  const opening = now < lot.opensAt && !paused;
  const total = lotTimerMs(room, lot);
  const msLeft = paused ? a.pausedRemainingMs ?? 0 : opening ? total : Math.max(0, lotDeadline(lot) - now);
  const leader = lot.leader ? room.teams[lot.leader] : null;
  const rtmTeam = lot.status === 'rtm' && lot.rtm ? room.teams[lot.rtm.teamId] : null;
  const prevTeamInRoom = player.lastTeam && room.teams[player.lastTeam] ? room.teams[player.lastTeam] : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      {/* Spotlight */}
      <Card className="relative overflow-hidden p-6" data-testid="spotlight">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-25 blur-3xl" style={{ background: franchiseColor(player.lastTeam) }} />
        <div className="relative flex flex-wrap items-center gap-2">
          <TierBadge tier={player.tier} />
          <RoleBadge role={player.role} long />
          {player.overseas && <OverseasTag />}
          {player.custom && <Badge>Custom</Badge>}
          <span className="ml-auto font-display text-sm tracking-widest text-subtle">LOT {lot.seq}</span>
        </div>
        <div className="relative mt-6 flex items-center gap-5">
          <PlayerAvatar player={player} size="xl" />
          <div className="min-w-0">
            <motion.h2 key={player.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="font-display text-4xl font-extrabold uppercase leading-none sm:text-5xl" data-testid="lot-player">
              {player.name}
            </motion.h2>
            <div className="mt-2 flex flex-wrap items-center gap-3"><Country code={player.country} showName /><span className="text-xs text-muted">{ROLE_NAME[player.role]}{player.bowlingType ? ` · ${player.bowlingType}` : ''}</span></div>
          </div>
        </div>
        <dl className="relative mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-ink-900/60 p-3"><dt className="text-[10px] font-semibold uppercase tracking-widest text-subtle">Base price</dt><dd className="font-display text-2xl font-bold text-gold-300"><Money lakhs={lot.basePrice} /></dd></div>
          <div className="rounded-xl bg-ink-900/60 p-3"><dt className="text-[10px] font-semibold uppercase tracking-widest text-subtle">Sim rating</dt><dd><RatingPill value={player.rating} /></dd></div>
          <div className="rounded-xl bg-ink-900/60 p-3"><dt className="text-[10px] font-semibold uppercase tracking-widest text-subtle">Last IPL team</dt><dd className="font-display text-2xl font-bold">{player.lastTeam ?? '—'}</dd></div>
        </dl>
        {player.previousTeams.length > 0 && (
          <div className="relative mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="mr-1 font-semibold uppercase tracking-wider text-subtle">IPL history</span>
            {player.previousTeams.map((t) => <span key={t} className="rounded-md bg-white/5 px-1.5 py-0.5 font-semibold">{t}</span>)}
          </div>
        )}
        {room.settings.features.rtm && prevTeamInRoom && prevTeamInRoom.rtmCards > 0 && (
          <div className="relative mt-4 flex items-center gap-2 rounded-xl border border-gold-400/25 bg-gold-400/6 px-3 py-2 text-xs text-gold-200">
            <ShieldCheck className="size-4" aria-hidden />{prevTeamInRoom.short} may use a Right to Match card on this player.
          </div>
        )}
      </Card>

      {/* Bid stage */}
      <Card className="flex flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <SectionLabel>{rtmTeam ? 'Final bid · RTM window' : lot.bid == null ? 'Opening bid' : 'Current bid'}</SectionLabel>
            <AnimatePresence mode="popLayout">
              <motion.div key={lot.bid ?? 'base'} initial={{ scale: 1.08, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                className="tabular mt-1 font-display text-6xl font-extrabold leading-none text-gold-gradient sm:text-7xl" data-testid="current-bid">
                {formatLakhs(lot.bid ?? lot.basePrice)}
              </motion.div>
            </AnimatePresence>
            <div className="mt-3 min-h-7" aria-live="polite">
              {leader ? (
                <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold" style={{ borderColor: `${leader.color}88`, background: `${leader.color}22` }} data-testid="leader">
                  <TeamCrest teamId={leader.id} size="sm" />{leader.name} {leader.id === myTeam?.id ? '(you)' : ''} lead
                </span>
              ) : <span className="text-sm text-muted">No bids yet</span>}
            </div>
          </div>
          <CountdownRing msLeft={msLeft} totalMs={total} label={paused ? 'paused' : opening ? 'opening' : rtmTeam ? 'rtm' : 'secs'} />
        </div>

        {rtmTeam && (
          <div className="mt-4 rounded-xl border border-gold-400/30 bg-gold-400/8 p-3 text-sm">
            <ShieldCheck className="mr-1.5 inline size-4 text-gold-300" aria-hidden />
            Waiting for <strong>{rtmTeam.name}</strong> to decide on Right to Match at {formatLakhs(lot.bid)}.
          </div>
        )}

        <BidLadder />

        <div className="mt-auto pt-5">
          {myTeam && <OwnerControls />}
          {isController && <AuctioneerControls />}
          {!myTeam && !isController && <div className="flex items-center gap-2 rounded-xl bg-white/4 px-4 py-3 text-sm text-muted"><Eye className="size-4" />You are spectating. Enjoy the show!</div>}
        </div>
      </Card>
      {myTeam && lot.status === 'rtm' && lot.rtm?.teamId === myTeam.id && <RtmPrompt />}
    </div>
  );
}

function BidLadder() {
  const { room } = useRoomCtx();
  const bids = room.auction!.lot!.bids;
  if (!bids.length) return null;
  return (
    <ol className="scrollbar-thin mt-4 max-h-36 space-y-1 overflow-y-auto pr-1" aria-label="Bids on this player">
      {[...bids].reverse().map((b, i) => (
        <li key={`${b.requestId}`} className={cn('flex items-center justify-between rounded-lg px-3 py-1.5 text-sm', i === 0 ? 'bg-white/6' : 'text-muted')}>
          <TeamChip teamId={b.teamId} name={room.teams[b.teamId]?.short} />
          <span className="tabular font-semibold">{formatLakhs(b.amount)}{b.viaCard && <span className="ml-1.5 text-[10px] uppercase text-gold-300">sniper</span>}</span>
        </li>
      ))}
    </ol>
  );
}

function OwnerControls() {
  const { room, myTeam, code } = useRoomCtx();
  const team = myTeam!;
  const lot = room.auction!.lot!;
  const now = useServerNow(250);
  const [pending, setPending] = useState(false);
  const next = nextBidAmount(lot.bid, lot.basePrice);
  const blocker = bidBlocker(room, team, lot, now);
  const frozenFor = Math.max(0, (room.auction!.frozenUntil[team.id] ?? 0) - now);

  async function bid() {
    if (blocker || pending) return;
    setPending(true);
    try {
      await api({ action: 'placeBid', code, lotSeq: lot.seq, amount: next, requestId: requestId() });
    } catch (e) {
      const c = (e as { code?: string }).code;
      toast.error(c === 'stale-bid' ? 'Someone bid first — the price moved. Try again.' : (e as Error).message);
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !e.repeat) bid();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-ink-900/60 p-2"><div className="text-[10px] font-semibold uppercase tracking-widest text-subtle">Purse</div><div className="font-display text-xl font-bold"><Money lakhs={team.purse} /></div></div>
        <div className="rounded-xl bg-ink-900/60 p-2"><div className="text-[10px] font-semibold uppercase tracking-widest text-subtle">Max bid</div><div className="font-display text-xl font-bold"><Money lakhs={maxBidFor(room, team)} /></div></div>
        <div className="rounded-xl bg-ink-900/60 p-2"><div className="text-[10px] font-semibold uppercase tracking-widest text-subtle">Squad</div><div className="font-display text-xl font-bold">{Object.keys(team.squad).length}<span className="text-sm text-subtle">/{room.settings.maxSquad}</span> <span className="text-xs text-fuchsia-300">{overseasInSquad(room, team)}✈</span></div></div>
      </div>
      {frozenFor > 0 && <div className="flex items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-200"><Snowflake className="size-4" />Frozen for {Math.ceil(frozenFor / 1000)}s</div>}
      <div className="max-md:fixed max-md:inset-x-3 max-md:bottom-[4.6rem] max-md:z-20">
        <Button
          variant="primary"
          size="xl"
          className={cn('w-full', !blocker && 'animate-pulse-ring')}
          disabled={!!blocker}
          loading={pending}
          onClick={bid}
          data-testid="bid-button"
          aria-describedby="bid-hint"
          icon={<Gavel className="size-6" />}
        >
          {blocker && lot.leader === team.id ? 'Leading' : `Bid ${formatLakhs(next)}`}
        </Button>
      </div>
      <p id="bid-hint" className="text-center text-xs text-subtle">{blocker ?? 'Press B to bid from the keyboard'}</p>
      {/* keeps the fixed mobile bid bar from covering the last controls */}
      <div className="h-20 md:hidden" aria-hidden />
      {room.settings.features.powerCards && <CardsPanel />}
    </div>
  );
}

function AuctioneerControls() {
  const { room, code } = useRoomCtx();
  const a = room.auction!;
  const lot = a.lot!;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const paused = a.status === 'paused';
  const go = async (k: string, fn: () => Promise<unknown>) => { setBusy(k); try { await fn(); } finally { setBusy(null); } };
  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-info/20 bg-info/5 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-sky-300"><Gavel className="size-3.5" />Auctioneer</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="success" disabled={!lot.leader || lot.status !== 'bidding' || paused} loading={busy === 'sold'} onClick={() => go('sold', () => run({ action: 'hammer', code, lotSeq: lot.seq, sold: true }))} icon={<CheckCircle2 className="size-4" />} data-testid="sold-button">Sold</Button>
        <Button variant="danger" disabled={lot.status !== 'bidding' || paused} loading={busy === 'unsold'} onClick={() => go('unsold', () => run({ action: 'hammer', code, lotSeq: lot.seq, sold: false }))} icon={<XCircle className="size-4" />}>Unsold</Button>
        <Button variant="outline" disabled={!lot.bids.length || lot.status !== 'bidding' || paused} loading={busy === 'undo'} onClick={() => go('undo', () => run({ action: 'undoBid', code, lotSeq: lot.seq }))} icon={<Undo2 className="size-4" />}>Undo bid</Button>
        <Button variant="outline" loading={busy === 'pause'} onClick={() => go('pause', () => run({ action: 'pause', code, paused: !paused }))} icon={paused ? <Play className="size-4" /> : <Pause className="size-4" />}>{paused ? 'Resume' : 'Pause'}</Button>
      </div>
      <button className="w-full text-center text-xs text-subtle underline-offset-2 hover:text-fg hover:underline" onClick={() => setConfirmEnd(true)}>End auction early…</button>
      <ConfirmDialog open={confirmEnd} onOpenChange={setConfirmEnd} danger title="End the auction now?" confirmLabel="End auction" loading={busy === 'end'}
        description="Remaining players go unsold. Any franchise short of a legal XI gets supplementary picks at the minimum price. The current player must have no bids."
        onConfirm={() => go('end', async () => { await run({ action: 'completeAuction', code }); setConfirmEnd(false); })} />
    </div>
  );
}

function RtmPrompt() {
  const { room, code } = useRoomCtx();
  const lot = room.auction!.lot!;
  const now = useServerNow(200);
  const [busy, setBusy] = useState<boolean | null>(null);
  const player = playerOf(room, lot.playerId);
  const left = Math.max(0, (lot.rtm?.deadline ?? 0) - now);
  const decide = async (accept: boolean) => {
    setBusy(accept);
    await run({ action: 'rtmDecision', code, lotSeq: lot.seq, accept }, accept ? `${player.name} retained via RTM!` : undefined);
    setBusy(null);
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="alertdialog" aria-labelledby="rtm-title" aria-describedby="rtm-desc">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="surface-strong w-full max-w-md rounded-3xl p-6 text-center">
        <ShieldCheck className="mx-auto size-10 text-gold-300" aria-hidden />
        <div id="rtm-title" className="mt-2 font-display text-3xl font-extrabold uppercase">Right to Match</div>
        <p id="rtm-desc" className="mt-2 text-sm text-muted">
          {teamShort(room.teams, lot.leader)} won <strong className="text-fg">{player.name}</strong> for <strong className="text-gold-300">{formatLakhs(lot.bid)}</strong>. Match the bid to keep this player?
        </p>
        <div className="mt-2 flex items-center justify-center gap-2 text-sm text-subtle"><Timer className="size-4" />{Math.ceil(left / 1000)}s to decide</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" loading={busy === false} onClick={() => decide(false)}>Pass</Button>
          <Button variant="primary" size="lg" loading={busy === true} onClick={() => decide(true)} data-testid="rtm-accept">Match {formatLakhs(lot.bid)}</Button>
        </div>
      </motion.div>
    </div>
  );
}

function RoundEnd() {
  const { room, code, isController } = useRoomCtx();
  const a = room.auction!;
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card className="p-8 text-center">
      <RotateCcw className="mx-auto size-8 text-gold-300" aria-hidden />
      <h2 className="mt-3 font-display text-3xl font-bold uppercase">Round {a.round} complete</h2>
      <p className="mt-2 text-muted">{a.unsold.length} player(s) went unsold.</p>
      {isController ? (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" size="lg" loading={busy === 'relist'} onClick={async () => { setBusy('relist'); await run({ action: 'relistUnsold', code }); setBusy(null); }} icon={<RotateCcw className="size-5" />}>Re-list unsold</Button>
          <Button variant="outline" size="lg" loading={busy === 'done'} onClick={async () => { setBusy('done'); await run({ action: 'completeAuction', code }); setBusy(null); }} icon={<Flag className="size-5" />}>Close auction</Button>
        </div>
      ) : <p className="mt-4 text-sm text-subtle">Waiting for the auctioneer…</p>}
    </Card>
  );
}

function AuctionComplete() {
  const { myTeam } = useRoomCtx();
  return (
    <Card className="p-8 text-center">
      <Flag className="mx-auto size-8 text-gold-300" aria-hidden />
      <h2 className="mt-3 font-display text-3xl font-bold uppercase">Auction complete</h2>
      <p className="mt-2 text-muted">Squads are final. {myTeam ? 'Pick your Playing XI before the season starts.' : 'Owners are picking their Playing XIs.'}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {myTeam && <Link to="../xi"><Button variant="primary" size="lg">Pick Playing XI</Button></Link>}
        <Link to="../squad"><Button variant="outline" size="lg">View squads</Button></Link>
      </div>
    </Card>
  );
}

function UpNext() {
  const { room } = useRoomCtx();
  const a = room.auction!;
  const upcoming = a.queue.slice(a.cursor + 1).filter((id) => !a.sold[id]).slice(0, 6);
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><ListOrdered className="size-4 text-gold-400" />Up next</span>} subtitle={`${Math.max(0, a.queue.length - a.cursor - 1)} remaining this round`} />
      {upcoming.length ? (
        <ul className="divide-y divide-white/6 px-5 py-1">
          {upcoming.map((id, i) => {
            const p = findPlayer(id, room.customPlayers);
            if (!p) return null;
            return (
              <li key={id} className="flex items-center gap-3 py-2.5">
                <span className="tabular w-5 text-xs text-subtle">{i + 1}</span>
                <PlayerAvatar player={p} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                <RoleBadge role={p.role} />
                <span className="tabular w-16 text-right text-xs text-muted">{formatLakhs(p.basePrice)}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="px-5 py-6 text-sm text-muted">No more players in this round.</p>}
    </Card>
  );
}

function Commentary({ code }: { code: string }) {
  const lines = useCommentary(code, 30);
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><History className="size-4 text-gold-400" />Commentary</span>} />
      <ul className="scrollbar-thin max-h-80 space-y-2 overflow-y-auto px-5 py-3 text-sm" aria-live="polite" aria-relevant="additions">
        {lines.length === 0 && <li className="text-muted">Waiting for the first call…</li>}
        {lines.map((l, i) => <li key={l.id} className={cn(i === 0 ? 'text-fg' : 'text-muted')}>{l.text}</li>)}
      </ul>
    </Card>
  );
}

function TeamsBoard() {
  const { room, myTeam } = useRoomCtx();
  const lot = room.auction?.lot;
  const now = useServerNow(1000);
  const teams = Object.values(room.teams).sort((x, y) => x.id.localeCompare(y.id));
  return (
    <Card>
      <CardHeader title="Franchises" subtitle="Purse · squad · overseas" />
      <ul className="divide-y divide-white/6">
        {teams.map((t) => {
          const leading = lot?.leader === t.id && lot.status === 'bidding';
          const purse = visiblePurse(t, myTeam?.id ?? null);
          const frozen = (room.auction?.frozenUntil[t.id] ?? 0) > now;
          return (
            <li key={t.id} className={cn('flex items-center gap-3 px-4 py-3 transition-colors', leading && 'bg-gold-400/8')} data-testid={`board-${t.id}`}>
              <TeamCrest teamId={t.id} size="md" className={leading ? 'ring-gold-400' : undefined} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{t.short}</span>
                  {t.id === myTeam?.id && <Badge tone="gold">You</Badge>}
                  {frozen && <Snowflake className="size-3.5 text-sky-300" aria-label="Frozen" />}
                </div>
                <div className="truncate text-xs text-subtle">{t.ownerName}</div>
              </div>
              <div className="text-right">
                <div className="tabular text-sm font-bold" data-testid={`purse-${t.id}`}>{purse == null ? <span className="text-subtle">Hidden</span> : formatLakhs(purse)}</div>
                <div className="flex items-center justify-end gap-1.5 text-[11px] text-subtle">
                  <span>{Object.keys(t.squad).length}/{room.settings.maxSquad}</span>
                  <span className="text-fuchsia-300">{overseasInSquad(room, t)}✈</span>
                  {room.settings.features.rtm && <RtmTag count={t.rtmCards} />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ResultOverlay({ result }: { result: LotResult | null }) {
  const { room } = useRoomCtx();
  // The result already on screen when the page mounts is history, not news.
  const seen = useRef<number | null | undefined>(undefined);
  const [show, setShow] = useState<LotResult | null>(null);
  const seq = result?.seq ?? null;
  useEffect(() => {
    if (seen.current === undefined) { seen.current = seq; return; }
    if (seq === null || seq === seen.current) return;
    seen.current = seq;
    setShow(result);
    const id = setTimeout(() => setShow(null), 2300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the lot sequence only
  }, [seq]);
  const p = show ? findPlayer(show.playerId, room.customPlayers) : null;
  return (
    <AnimatePresence>
      {show && p && (
        <motion.div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ scale: 0.7, rotate: -4 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className={cn('surface-strong rounded-3xl px-10 py-8 text-center', show.outcome === 'sold' ? 'border-success/40' : 'border-danger/40')} role="status">
            <div className={cn('font-display text-7xl font-extrabold uppercase', show.outcome === 'sold' ? 'text-success' : 'text-danger')}>{show.outcome === 'sold' ? (show.viaRtm ? 'RTM!' : 'Sold!') : 'Unsold'}</div>
            <div className="mt-2 text-lg font-semibold">{p.name}</div>
            {show.outcome === 'sold' && show.teamId && (
              <div className="mt-1 flex items-center justify-center gap-2 text-muted"><TeamChip teamId={show.teamId} name={room.teams[show.teamId]?.name} /> · <Money lakhs={show.price} className="font-bold text-gold-300" /></div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
