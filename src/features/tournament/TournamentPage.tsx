import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { CalendarDays, FastForward, Play, PlayCircle, Trophy, Medal, Lock, CheckCircle2, CircleDashed, Eye, ListChecks } from 'lucide-react';
import type { Fixture, Room } from '@shared/types';
import { computeStandings, nextPlayable, STAGE_LABEL } from '@shared/engine/tournament';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, SectionLabel, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@/components/ui';
import { TeamCrest, franchiseColor } from '@/components/game';
import { run } from '@/services/api';
import { useRoomCtx } from '@/features/rooms/RoomContext';

export default function TournamentPage() {
  const { room } = useRoomCtx();
  if (room.meta.status === 'lobby' || room.meta.status === 'auction') {
    return <EmptyState icon={<Trophy className="size-5" />} title="Season not started">The season begins after the auction.</EmptyState>;
  }
  if (room.meta.status === 'squads' || !room.tournament) return <PreSeason />;
  return <Season />;
}

function PreSeason() {
  const { room, code, isController, myTeam } = useRoomCtx();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const teams = Object.values(room.teams);
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Pre-season</SectionLabel>
        <h1 className="mt-1 font-display text-4xl font-extrabold uppercase">Squad selection</h1>
        <p className="text-sm text-muted">Owners save their Playing XI. When the host starts the season, any franchise without one gets an auto-picked XI.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((t) => (
          <Card key={t.id} className="flex items-center gap-3 p-4">
            <TeamCrest teamId={t.id} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{t.name}</div>
              <div className="text-xs text-subtle">{Object.keys(t.squad).length} players · {t.ownerName}</div>
            </div>
            {t.xi?.locked ? <Badge tone="success"><Lock className="size-3" />Locked</Badge> : t.xi ? <Badge tone="info"><CheckCircle2 className="size-3" />Saved</Badge> : <Badge><CircleDashed className="size-3" />Pending</Badge>}
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {myTeam && <Link to="../xi"><Button variant="outline" size="lg" icon={<ListChecks className="size-5" />}>Pick my XI</Button></Link>}
        {isController && <Button variant="primary" size="lg" onClick={() => setConfirm(true)} icon={<Play className="size-5" />} data-testid="start-season">Start the season</Button>}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Start the season?" confirmLabel="Start season" loading={busy}
        description={`${teams.filter((t) => !t.xi).length} franchise(s) without a saved XI will get an auto-picked one. All XIs lock.`}
        onConfirm={async () => { setBusy(true); await run({ action: 'startTournament', code }, 'The season is underway!'); setBusy(false); setConfirm(false); }} />
    </div>
  );
}

function Season() {
  const { room, code, isController } = useRoomCtx();
  const nav = useNavigate();
  const t = room.tournament!;
  const [busy, setBusy] = useState<string | null>(null);
  const fixtures = Object.values(t.fixtures).sort((a, b) => a.number - b.number);
  const league = fixtures.filter((f) => f.stage === 'league');
  const playoffs = fixtures.filter((f) => f.stage !== 'league');
  const next = nextPlayable(t);
  const played = fixtures.filter((f) => f.status === 'completed').length;

  async function playMatch(f: Fixture) {
    setBusy(f.id);
    const ok = await run({ action: 'simulateMatch', code, fixtureId: f.id });
    setBusy(null);
    if (ok) nav(`../match/${f.id}`);
  }
  async function simAll(stage: 'league' | 'all') {
    setBusy(stage);
    await run({ action: 'simulateAll', code, stage }, stage === 'league' ? 'League stage simulated' : 'Season simulated');
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      {t.status === 'completed' && t.championId && <Champion room={room} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>{t.status === 'league' ? 'League stage' : t.status === 'playoffs' ? 'Playoffs' : 'Season complete'}</SectionLabel>
          <h1 className="mt-1 font-display text-4xl font-extrabold uppercase">Season hub</h1>
          <p className="text-sm text-muted">{played} match{played === 1 ? '' : 'es'} played · {league.length} league fixture{league.length === 1 ? '' : 's'}{t.status === 'league' ? ', then playoffs' : ''}</p>
        </div>
        {isController && t.status !== 'completed' && (
          <div className="flex flex-wrap gap-2">
            {next && <Button variant="primary" loading={busy === next.id} onClick={() => playMatch(next)} icon={<PlayCircle className="size-4" />} data-testid="play-next">Play {STAGE_LABEL[next.stage]} #{next.number}</Button>}
            {t.status === 'league' && <Button variant="outline" loading={busy === 'league'} onClick={() => simAll('league')} icon={<FastForward className="size-4" />}>Sim league</Button>}
            <Button variant="ghost" loading={busy === 'all'} onClick={() => simAll('all')} icon={<FastForward className="size-4" />}>Sim to the end</Button>
          </div>
        )}
      </div>

      <Tabs defaultValue={t.status === 'league' ? 'table' : 'playoffs'}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="table">Points table</TabsTrigger>
          <TabsTrigger value="fixtures">Fixtures</TabsTrigger>
          <TabsTrigger value="playoffs">Playoffs</TabsTrigger>
        </TabsList>
        <TabsContent value="table" className="mt-4"><StandingsTable /></TabsContent>
        <TabsContent value="fixtures" className="mt-4">
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><CalendarDays className="size-4 text-gold-400" />League fixtures</span>} subtitle={`${league.filter((f) => f.status === 'completed').length}/${league.length} played`} />
            <ul className="divide-y divide-white/6">{league.map((f) => <FixtureRow key={f.id} f={f} busy={busy === f.id} onPlay={() => playMatch(f)} />)}</ul>
          </Card>
        </TabsContent>
        <TabsContent value="playoffs" className="mt-4">
          {playoffs.length === 0 ? (
            <Card><EmptyState icon={<Trophy className="size-5" />} title="Playoffs pending">The top {Math.min(4, Object.keys(room.teams).length)} after the league stage qualify. {Object.keys(room.teams).length < 4 && 'With fewer than four teams the format is shortened (see README).'}</EmptyState></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {playoffs.map((f) => (
                <Card key={f.id} className={cn('overflow-hidden', f.stage === 'final' && 'md:col-span-2 border-gold-400/30')}>
                  <div className={cn('px-4 py-2 text-[11px] font-bold uppercase tracking-widest', f.stage === 'final' ? 'bg-gold-400/12 text-gold-300' : 'bg-white/4 text-muted')}>{STAGE_LABEL[f.stage]}</div>
                  <ul><FixtureRow f={f} busy={busy === f.id} onPlay={() => playMatch(f)} /></ul>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FixtureRow({ f, onPlay, busy }: { f: Fixture; onPlay: () => void; busy: boolean }) {
  const { room, isController, myTeam } = useRoomCtx();
  const side = (id: string | null, line?: { runs: number; wickets: number; balls: number }) => (
    <div className={cn('flex min-w-0 items-center gap-2', f.summary && f.summary.winnerId === id && 'font-bold')}>
      {id ? <TeamCrest teamId={id} size="sm" /> : <span className="grid size-7 place-items-center rounded-full border border-dashed border-white/20 text-[9px] text-subtle">TBD</span>}
      <span className={cn('truncate text-sm', id === myTeam?.id && 'text-gold-300')}>{id ? room.teams[id]?.short : 'TBD'}</span>
      {line && <span className="tabular ml-auto text-sm">{line.runs}/{line.wickets} <span className="text-[11px] font-normal text-subtle">({Math.floor(line.balls / 6)}.{line.balls % 6})</span></span>}
    </div>
  );
  return (
    <li className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-4 py-3" data-testid={`fixture-${f.id}`}>
      <span className="tabular font-display text-lg font-bold text-subtle">#{f.number}</span>
      <div className="min-w-0 space-y-1">
        {side(f.teamA, f.summary?.teamA)}
        {side(f.teamB, f.summary?.teamB)}
        {f.summary && <div className="text-xs text-muted">{f.summary.winnerId ? `${room.teams[f.summary.winnerId]?.short} ${f.summary.margin}` : 'Match tied — 1 point each'}</div>}
      </div>
      {f.status === 'completed' ? (
        <Link to={`../match/${f.id}`}><Button size="sm" variant="outline" icon={<Eye className="size-3.5" />}>Watch</Button></Link>
      ) : isController && f.teamA && f.teamB ? (
        <Button size="sm" variant="primary" loading={busy} onClick={onPlay} icon={<Play className="size-3.5" />}>Play</Button>
      ) : <span className="text-xs text-subtle">{f.teamA && f.teamB ? 'Scheduled' : 'Awaiting'}</span>}
    </li>
  );
}

function StandingsTable() {
  const { room, myTeam } = useRoomCtx();
  const rows = computeStandings(room.tournament, Object.keys(room.teams));
  const cut = Math.min(4, rows.length);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm" aria-label="Points table">
        <thead>
          <tr className="border-b border-white/8 text-left text-[11px] uppercase tracking-wider text-subtle">
            <th className="px-4 py-3 font-semibold">#</th><th className="px-2 py-3 font-semibold">Team</th>
            {['P', 'W', 'L', 'T', 'NRR', 'Pts'].map((h) => <th key={h} className="px-3 py-3 text-right font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.teamId} className={cn('border-b border-white/5', r.teamId === myTeam?.id && 'bg-gold-400/6', i === cut - 1 && 'border-b-2 border-b-gold-400/40')} data-testid={`row-${r.teamId}`}>
              <td className="px-4 py-3"><span className={cn('tabular font-display text-lg font-bold', i < cut ? 'text-gold-300' : 'text-subtle')}>{i + 1}</span></td>
              <td className="px-2 py-3"><div className="flex items-center gap-2.5"><TeamCrest teamId={r.teamId} size="sm" /><span className="font-semibold">{room.teams[r.teamId]?.name}</span></div></td>
              <td className="tabular px-3 py-3 text-right">{r.played}</td>
              <td className="tabular px-3 py-3 text-right">{r.won}</td>
              <td className="tabular px-3 py-3 text-right">{r.lost}</td>
              <td className="tabular px-3 py-3 text-right">{r.tied}</td>
              <td className={cn('tabular px-3 py-3 text-right', r.nrr > 0 ? 'text-emerald-300' : r.nrr < 0 ? 'text-red-300' : '')}>{r.nrr > 0 ? '+' : ''}{r.nrr.toFixed(3)}</td>
              <td className="tabular px-3 py-3 text-right font-display text-lg font-bold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-subtle">Win 2 pts · Tie 1 pt each · Top {cut} qualify · NRR counts an all-out innings as 20 overs.</p>
    </Card>
  );
}

function Champion({ room }: { room: Room }) {
  const t = room.tournament!;
  const champ = room.teams[t.championId!];
  const runner = t.runnerUpId ? room.teams[t.runnerUpId] : null;
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ i, x: Math.random() * 100, d: 2 + Math.random() * 2.5, delay: Math.random() * 1.2, c: [champ.color, '#f5b841', '#ffffff', '#ffd27a'][i % 4] })), [champ.color]);
  return (
    <Card className="relative overflow-hidden border-gold-400/40 p-8 text-center" data-testid="champion">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {pieces.map((p) => (
          <motion.span key={p.i} className="absolute top-0 block h-2.5 w-1.5 rounded-sm" style={{ left: `${p.x}%`, background: p.c }}
            initial={{ y: -20, rotate: 0, opacity: 1 }} animate={{ y: 360, rotate: 540, opacity: 0 }} transition={{ duration: p.d, delay: p.delay, repeat: Infinity, ease: 'easeIn' }} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 50% 0%, ${franchiseColor(champ.id)}, transparent 65%)` }} />
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }} className="relative">
        <Trophy className="mx-auto size-16 text-gold-300 drop-shadow-[0_0_24px_rgb(245_184_65/0.6)]" aria-hidden />
        <SectionLabel className="mt-3">Champions</SectionLabel>
        <div className="mt-2 flex items-center justify-center gap-3"><TeamCrest teamId={champ.id} size="lg" /><h2 className="font-display text-5xl font-extrabold uppercase text-gold-gradient">{champ.name}</h2></div>
        <p className="mt-2 text-muted">Owned by {champ.ownerName}{runner && <> · Runners-up <Medal className="inline size-4 text-tier-silver" /> {runner.name}</>}</p>
      </motion.div>
    </Card>
  );
}
