import { Link, useNavigate, useParams } from 'react-router-dom';
import { ListChecks, Receipt, Shield, Users } from 'lucide-react';
import { findPlayer } from '@shared/data/players';
import { formatLakhs } from '@shared/engine/core';
import { chemistryLabel, squadComposition } from '@shared/engine/squad';
import type { Player } from '@shared/types';
import { Badge, Button, Card, CardHeader, EmptyState, SectionLabel, Stat, cn } from '@/components/ui';
import { Country, PlayerAvatar, RatingPill, RoleBadge, TeamCrest, TierBadge } from '@/components/game';
import { useLedger } from '@/hooks/realtime';
import { useRoomCtx } from '@/features/rooms/RoomContext';
import { visiblePurse } from '@/features/auction/logic';

const ROLE_ORDER = { WK: 0, BAT: 1, AR: 2, BOWL: 3 } as const;

export default function SquadPage() {
  const { room, myTeam, code } = useRoomCtx();
  const nav = useNavigate();
  const teamIds = Object.keys(room.teams);
  const teamId = useParams().teamId ?? myTeam?.id ?? teamIds[0];
  const team = room.teams[teamId];
  const ledger = useLedger(code, team?.id ?? null);
  if (!team) return <EmptyState icon={<Users className="size-5" />} title="No such franchise" />;
  const comp = squadComposition(room, team);
  const entries = Object.values(team.squad)
    .map((e) => ({ e, p: findPlayer(e.playerId, room.customPlayers) }))
    .filter((x): x is { e: typeof x.e; p: Player } => !!x.p)
    .sort((x, y) => ROLE_ORDER[x.p.role] - ROLE_ORDER[y.p.role] || y.e.price - x.e.price);
  const purse = visiblePurse(team, myTeam?.id ?? null);
  const xiSet = new Set(team.xi?.playerIds ?? []);

  return (
    <div className="space-y-5">
      <div className="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Franchises">
        {teamIds.map((id) => (
          <button key={id} role="tab" aria-selected={id === team.id} onClick={() => nav(`/room/${code}/squad/${id}`)}
            className={cn('flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold', id === team.id ? 'border-gold-400/60 bg-gold-400/8' : 'border-white/10 text-muted hover:text-fg')}>
            <TeamCrest teamId={id} size="sm" />{room.teams[id].short}{id === myTeam?.id && <span className="text-[10px] text-gold-300">YOU</span>}
          </button>
        ))}
      </div>

      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-20" style={{ background: `radial-gradient(circle at 80% 30%, ${team.color}, transparent 60%)` }} />
        <div className="relative flex flex-wrap items-center gap-5">
          <TeamCrest teamId={team.id} size="xl" />
          <div className="min-w-0 flex-1">
            <SectionLabel>Squad</SectionLabel>
            <h1 className="font-display text-4xl font-extrabold uppercase">{team.name}</h1>
            <p className="text-sm text-muted">Owner: {team.ownerName ?? '—'}</p>
          </div>
          {team.id === myTeam?.id && (room.meta.status === 'squads' || room.meta.status === 'tournament') && (
            <Link to="../xi"><Button variant="primary" icon={<ListChecks className="size-4" />}>{team.xi?.locked ? 'View XI' : 'Pick Playing XI'}</Button></Link>
          )}
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Purse left" value={purse == null ? 'Hidden' : formatLakhs(purse)} />
          <Stat label="Spent" value={formatLakhs(comp.spent)} />
          <Stat label="Players" value={`${comp.total}/${room.settings.maxSquad}`} sub={`min ${room.settings.minSquad}`} />
          <Stat label="Overseas" value={`${comp.overseas}/${room.settings.maxOverseasSquad}`} />
          <Stat label="Chemistry" value={comp.chemistry} sub={chemistryLabel(comp.chemistry)} />
        </div>
        <div className="relative mt-5 flex h-2.5 overflow-hidden rounded-full bg-white/6" aria-label="Role mix">
          {(['WK', 'BAT', 'AR', 'BOWL'] as const).map((r) => comp[r] > 0 && (
            <div key={r} className={cn('h-full', { WK: 'bg-amber-400', BAT: 'bg-sky-400', AR: 'bg-emerald-400', BOWL: 'bg-rose-400' }[r])} style={{ width: `${(comp[r] / Math.max(1, comp.total)) * 100}%` }} title={`${r}: ${comp[r]}`} />
          ))}
        </div>
        <div className="relative mt-2 flex flex-wrap gap-3 text-xs text-muted">
          {(['WK', 'BAT', 'AR', 'BOWL'] as const).map((r) => <span key={r}><RoleBadge role={r} /> {comp[r]}</span>)}
          {room.settings.features.rtm && <span className="inline-flex items-center gap-1"><Shield className="size-3" />RTM left {team.rtmCards}</span>}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Players" subtitle="Chemistry: +2 per same-country pair, +5 per shared IPL franchise" />
          {entries.length === 0 ? <EmptyState title="No signings yet">Players appear here the moment the hammer falls.</EmptyState> : (
            <ul className="divide-y divide-white/6">
              {entries.map(({ e, p }) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <PlayerAvatar player={p} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      {xiSet.has(p.id) && <Badge tone="success">XI</Badge>}
                      {team.xi?.captainId === p.id && <Badge tone="gold">C</Badge>}
                      {e.viaRtm && <Badge tone="gold">RTM</Badge>}
                      {e.supplementary && <Badge>Supp.</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2"><RoleBadge role={p.role} /><Country code={p.country} /><TierBadge tier={p.tier} className="hidden sm:inline-flex" /></div>
                  </div>
                  <RatingPill value={p.rating} adj={e.ratingAdj} />
                  <span className="tabular w-20 text-right text-sm font-semibold text-gold-300">{formatLakhs(e.price)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Receipt className="size-4 text-gold-400" />Ledger</span>} subtitle="Every purse movement, written by the server" />
          {ledger.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No transactions yet.</p> : (
            <ul className="scrollbar-thin max-h-[28rem] divide-y divide-white/6 overflow-y-auto">
              {ledger.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-muted">{l.reason}</span>
                  <span className={cn('tabular shrink-0 font-semibold', l.delta < 0 ? 'text-red-300' : 'text-emerald-300')}>{l.delta > 0 ? '+' : '−'}{formatLakhs(Math.abs(l.delta))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
