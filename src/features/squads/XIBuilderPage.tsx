import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckCircle2, Crown, Hand, Lock, Minus, Plus, Save, Wand2, XCircle, Eraser, ListChecks } from 'lucide-react';
import type { Player } from '@shared/types';
import { findPlayer } from '@shared/data/players';
import { autoPickXI, isBowlingOption, validateXI } from '@shared/engine/squad';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, SectionLabel, cn } from '@/components/ui';
import { Country, PlayerAvatar, RatingPill, RoleBadge } from '@/components/game';
import { run } from '@/services/api';
import { useRoomCtx } from '@/features/rooms/RoomContext';

export default function XIBuilderPage() {
  const { room, myTeam, code } = useRoomCtx();
  const team = myTeam;
  const [ids, setIds] = useState<string[]>([]);
  const [captainId, setCaptain] = useState('');
  const [keeperId, setKeeper] = useState('');
  const [saving, setSaving] = useState<'draft' | 'lock' | null>(null);
  const [confirmLock, setConfirmLock] = useState(false);
  const savedAt = team?.xi?.savedAt;

  // Load the saved XI (also when it changes on the server, e.g. auto-picked at season start).
  useEffect(() => {
    if (!team?.xi) return;
    setIds(team.xi.playerIds);
    setCaptain(team.xi.captainId);
    setKeeper(team.xi.wicketKeeperId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAt, team?.id]);

  const squad = useMemo(() => Object.keys(team?.squad ?? {}).map((id) => findPlayer(id, room.customPlayers)).filter((p): p is Player => !!p)
    .sort((a, b) => ({ WK: 0, BAT: 1, AR: 2, BOWL: 3 })[a.role] - ({ WK: 0, BAT: 1, AR: 2, BOWL: 3 })[b.role] || b.rating - a.rating), [team?.squad, room.customPlayers]);

  if (!team) return <EmptyState icon={<ListChecks className="size-5" />} title="No franchise">Only franchise owners pick a Playing XI.</EmptyState>;
  if (room.meta.status === 'lobby' || room.meta.status === 'auction') {
    return <EmptyState icon={<ListChecks className="size-5" />} title="Not yet" action={<Link to="../auction"><Button variant="primary">Back to auction</Button></Link>}>You can pick your XI once the auction is complete.</EmptyState>;
  }

  const locked = !!team.xi?.locked;
  const v = validateXI(Object.keys(team.squad), { playerIds: ids, captainId, wicketKeeperId: keeperId }, room.settings, room.customPlayers);
  const players = ids.map((id) => findPlayer(id, room.customPlayers)!).filter(Boolean);
  const dirty = !team.xi || team.xi.playerIds.join() !== ids.join() || team.xi.captainId !== captainId || team.xi.wicketKeeperId !== keeperId;

  const toggle = (p: Player) => {
    if (locked) return;
    if (ids.includes(p.id)) {
      setIds(ids.filter((x) => x !== p.id));
      if (captainId === p.id) setCaptain('');
      if (keeperId === p.id) setKeeper('');
    } else if (ids.length < 11) {
      setIds([...ids, p.id]);
      if (!keeperId && p.role === 'WK') setKeeper(p.id);
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setIds(next);
  };
  const auto = () => {
    const xi = autoPickXI(room, team);
    if (!xi) return;
    setIds(xi.playerIds); setCaptain(xi.captainId); setKeeper(xi.wicketKeeperId);
  };
  const save = async (lock: boolean) => {
    setSaving(lock ? 'lock' : 'draft');
    await run({ action: 'saveXI', code, playerIds: ids, captainId, wicketKeeperId: keeperId, lock }, lock ? 'Playing XI locked in' : 'Playing XI saved');
    setSaving(null);
    setConfirmLock(false);
  };

  const checks = [
    { ok: v.counts.players === 11, label: `${v.counts.players}/11 players` },
    { ok: v.counts.overseas <= room.settings.maxOverseasXI, label: `${v.counts.overseas}/${room.settings.maxOverseasXI} overseas` },
    { ok: v.counts.keepers >= 1 && !!keeperId, label: 'Wicket-keeper' },
    { ok: v.counts.bowlingOptions >= room.settings.minBowlingOptionsXI, label: `${v.counts.bowlingOptions}/${room.settings.minBowlingOptionsXI}+ bowling options` },
    { ok: !!captainId && ids.includes(captainId), label: 'Captain' },
  ];

  return (
    <div className="space-y-5 pb-20 md:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>{team.name}</SectionLabel>
          <h1 className="mt-1 font-display text-4xl font-extrabold uppercase">Playing XI</h1>
          <p className="text-sm text-muted">{locked ? 'Your XI is locked for the season.' : 'Tap players to add them. Order = batting order. Pick a captain (C) and keeper (WK).'}</p>
        </div>
        {locked ? <Badge tone="gold"><Lock className="size-3" />Locked</Badge> : (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setIds([]); setCaptain(''); setKeeper(''); }} icon={<Eraser className="size-4" />}>Clear</Button>
            <Button variant="outline" onClick={auto} icon={<Wand2 className="size-4" />}>Auto-pick</Button>
          </div>
        )}
      </div>

      <Card className="flex flex-wrap gap-2 p-3" aria-live="polite">
        {checks.map((c) => (
          <span key={c.label} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold', c.ok ? 'bg-success/10 text-emerald-300' : 'bg-white/5 text-muted')}>
            {c.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{c.label}
          </span>
        ))}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Playing XI (${ids.length}/11)`} subtitle={locked ? 'Batting order' : 'Batting order — use the arrows to reorder'} />
          {players.length === 0 ? <EmptyState title="Empty XI">Add players from your squad, or use Auto-pick.</EmptyState> : (
            <ol className="divide-y divide-white/6">
              {players.map((p, i) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 sm:flex-nowrap sm:px-4">
                  <span className="tabular w-5 text-center font-display text-lg font-bold text-subtle">{i + 1}</span>
                  <PlayerAvatar player={p} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="flex items-center gap-1.5"><RoleBadge role={p.role} />{p.overseas && <span className="text-[10px] font-bold text-fuchsia-300">OVS</span>}</div>
                  </div>
                  {!locked && (
                    <div className="ml-auto flex items-center gap-0.5 max-sm:w-full max-sm:justify-end max-sm:border-t max-sm:border-white/5 max-sm:pt-1">
                      <Button size="icon" variant={captainId === p.id ? 'primary' : 'ghost'} aria-pressed={captainId === p.id} aria-label={`Make ${p.name} captain`} onClick={() => setCaptain(p.id)}><Crown className="size-4" /></Button>
                      {p.role === 'WK' && <Button size="icon" variant={keeperId === p.id ? 'primary' : 'ghost'} aria-pressed={keeperId === p.id} aria-label={`Make ${p.name} wicket-keeper`} onClick={() => setKeeper(p.id)}><Hand className="size-4" /></Button>}
                      <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === players.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => toggle(p)}><Minus className="size-4" /></Button>
                    </div>
                  )}
                  {locked && <div className="flex gap-1">{captainId === p.id && <Badge tone="gold">C</Badge>}{keeperId === p.id && <Badge tone="info">WK</Badge>}</div>}
                </li>
              ))}
            </ol>
          )}
          {!v.ok && ids.length > 0 && (
            <ul className="space-y-1 border-t border-white/6 px-5 py-3 text-xs text-red-300">{v.errors.map((e) => <li key={e}>• {e}</li>)}</ul>
          )}
        </Card>

        <Card>
          <CardHeader title={`Squad (${squad.length})`} subtitle={`${squad.filter(isBowlingOption).length} bowling options · ${squad.filter((p) => p.overseas).length} overseas`} />
          <ul className="divide-y divide-white/6">
            {squad.map((p) => {
              const inXI = ids.includes(p.id);
              const full = ids.length >= 11 && !inXI;
              return (
                <li key={p.id}>
                  <button disabled={locked || full} onClick={() => toggle(p)} aria-pressed={inXI}
                    className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors', inXI ? 'bg-gold-400/6' : 'hover:bg-white/3', (locked || full) && 'cursor-default opacity-60')}>
                    <PlayerAvatar player={p} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="flex items-center gap-1.5"><RoleBadge role={p.role} /><Country code={p.country} /></div>
                    </div>
                    <RatingPill value={p.rating} adj={team.squad[p.id]?.ratingAdj} />
                    {!locked && <span className={cn('grid size-7 place-items-center rounded-full', inXI ? 'bg-gold-400 text-ink-950' : 'bg-white/6 text-muted')}>{inXI ? <CheckCircle2 className="size-4" /> : <Plus className="size-4" />}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {!locked && (
        <div className="max-md:fixed max-md:inset-x-0 max-md:bottom-[4.4rem] max-md:z-20 max-md:border-t max-md:border-white/8 max-md:bg-ink-900/95 max-md:px-4 max-md:py-2 max-md:backdrop-blur-xl">
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={!v.ok || !dirty} loading={saving === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save</Button>
            <Button variant="primary" disabled={!v.ok} loading={saving === 'lock'} onClick={() => setConfirmLock(true)} icon={<Lock className="size-4" />} data-testid="lock-xi">Save &amp; lock</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirmLock} onOpenChange={setConfirmLock} title="Lock your Playing XI?" confirmLabel="Lock XI" loading={saving === 'lock'}
        description="Locked XIs cannot be edited. Unlocked XIs are locked automatically when the season starts (owners without a saved XI get an auto-picked one)."
        onConfirm={() => save(true)} />
    </div>
  );
}
