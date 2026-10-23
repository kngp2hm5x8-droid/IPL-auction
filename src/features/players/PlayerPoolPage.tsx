import { useDeferredValue, useMemo, useState } from 'react';
import { Plus, Search, Trash2, UserRound, SearchX } from 'lucide-react';
import type { CustomPlayerInput, Player, Role, Tier } from '@shared/types';
import { allPlayers } from '@shared/data/players';
import { COUNTRIES, FRANCHISE_IDS, TIER_BASE_PRICE, TIERS } from '@shared/data/reference';
import { formatLakhs } from '@shared/engine/core';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, SectionLabel, Segmented, Select, cn } from '@/components/ui';
import { Country, OverseasTag, PlayerAvatar, RatingPill, RoleBadge, TeamChip, TierBadge, ROLE_NAME } from '@/components/game';
import { run } from '@/services/api';
import { useRoomCtx } from '@/features/rooms/RoomContext';

type RoleF = 'ALL' | Role | 'OVS';
type StatusF = 'all' | 'available' | 'sold' | 'unsold';
type SortK = 'rating' | 'price' | 'name';

export default function PlayerPoolPage() {
  const { room, isController, code } = useRoomCtx();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim().toLowerCase());
  const [role, setRole] = useState<RoleF>('ALL');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [status, setStatus] = useState<StatusF>('all');
  const [sort, setSort] = useState<SortK>('rating');
  const [open, setOpen] = useState<Player | null>(null);
  const [adding, setAdding] = useState(false);
  const a = room.auction;
  const players = useMemo(() => allPlayers(room.customPlayers), [room.customPlayers]);

  const stateOf = (p: Player): 'sold' | 'unsold' | 'available' => (a?.sold[p.id] ? 'sold' : a?.unsold.includes(p.id) ? 'unsold' : 'available');

  const list = useMemo(() => {
    const out = players.filter((p) => {
      if (query && !p.name.toLowerCase().includes(query) && !(COUNTRIES[p.country]?.name.toLowerCase().includes(query)) && !p.previousTeams.some((t) => t.toLowerCase() === query)) return false;
      if (role === 'OVS' ? !p.overseas : role !== 'ALL' && p.role !== role) return false;
      if (tier !== 'all' && p.tier !== tier) return false;
      if (status !== 'all' && stateOf(p) !== status) return false;
      return true;
    });
    out.sort((x, y) => sort === 'name' ? x.name.localeCompare(y.name) : sort === 'price' ? y.basePrice - x.basePrice || y.rating - x.rating : y.rating - x.rating || x.name.localeCompare(y.name));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, query, role, tier, status, sort, a]);

  const counts = Object.fromEntries(TIERS.map((t) => [t, players.filter((p) => p.tier === t).length]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>Player pool</SectionLabel>
          <h1 className="mt-1 font-display text-4xl font-extrabold uppercase">{players.length} players</h1>
          <p className="text-sm text-muted">Ratings are fictional simulation values. Previous franchises are from the v2 database.</p>
        </div>
        {isController && room.meta.status === 'lobby' && <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>Custom player</Button>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTier('all')} className={cn('rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wider', tier === 'all' ? 'border-gold-400/60 text-gold-300' : 'border-white/10 text-muted')}>All tiers · {players.length}</button>
        {TIERS.map((t) => (
          <button key={t} onClick={() => setTier(tier === t ? 'all' : t)} aria-pressed={tier === t} className={cn('rounded-lg border px-2 py-1 transition-opacity', tier === t ? 'border-white/30' : 'border-transparent opacity-80 hover:opacity-100')}>
            <TierBadge tier={t} /> <span className="text-xs text-muted">{counts[t]} · {formatLakhs(TIER_BASE_PRICE[t])}</span>
          </button>
        ))}
      </div>

      <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, country or franchise (e.g. CSK)" className="pl-9" aria-label="Search players" />
        </div>
        <Segmented ariaLabel="Role filter" value={role} onChange={setRole} options={[{ value: 'ALL', label: 'All' }, { value: 'BAT', label: 'BAT' }, { value: 'WK', label: 'WK' }, { value: 'AR', label: 'AR' }, { value: 'BOWL', label: 'BOWL' }, { value: 'OVS', label: 'Overseas' }]} />
        <div className="flex gap-2">
          {a && (
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusF)} aria-label="Status filter" className="w-36">
              <option value="all">Any status</option><option value="available">Available</option><option value="sold">Sold</option><option value="unsold">Unsold</option>
            </Select>
          )}
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortK)} aria-label="Sort" className="w-36">
            <option value="rating">Top rated</option><option value="price">Base price</option><option value="name">Name A–Z</option>
          </Select>
        </div>
      </Card>

      <p className="text-xs text-subtle" aria-live="polite">Showing {list.length} of {players.length}</p>

      {list.length === 0 ? (
        <EmptyState icon={<SearchX className="size-5" />} title="No players match">Try clearing a filter.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((p) => {
            const st = stateOf(p);
            const owner = a?.sold[p.id];
            return (
              <button key={p.id} onClick={() => setOpen(p)} className={cn('surface group flex flex-col gap-3 rounded-2xl p-4 text-left transition-colors hover:border-gold-400/40', st === 'sold' && 'opacity-70')}>
                <div className="flex items-start gap-3">
                  <PlayerAvatar player={p} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold group-hover:text-gold-200">{p.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5"><RoleBadge role={p.role} /><Country code={p.country} />{p.overseas && <span className="text-[10px] font-bold text-fuchsia-300">OVS</span>}</div>
                  </div>
                  <RatingPill value={p.rating} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <TierBadge tier={p.tier} />
                  {st === 'sold' && owner ? <TeamChip teamId={owner} name={room.teams[owner]?.short} className="text-xs" /> : st === 'unsold' ? <Badge tone="danger">Unsold</Badge> : <span className="tabular font-semibold text-gold-300">{formatLakhs(p.basePrice)}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <PlayerProfile player={open} onClose={() => setOpen(null)} canRemove={isController && room.meta.status === 'lobby'} onRemove={(id) => { run({ action: 'removeCustomPlayer', code, playerId: id }, 'Custom player removed'); setOpen(null); }} />
      <AddPlayerDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function PlayerProfile({ player, onClose, canRemove, onRemove }: { player: Player | null; onClose: () => void; canRemove: boolean; onRemove: (id: string) => void }) {
  const { room } = useRoomCtx();
  if (!player) return null;
  const owner = room.auction?.sold[player.id];
  const entry = owner ? room.teams[owner]?.squad[player.id] : null;
  return (
    <Dialog open={!!player} onOpenChange={(o) => !o && onClose()} title={player.name} description={`${ROLE_NAME[player.role]} · ${COUNTRIES[player.country]?.name ?? player.country}`}
      footer={canRemove && player.custom ? <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => onRemove(player.id)}>Remove custom player</Button> : undefined}>
      <div className="flex items-center gap-4">
        <PlayerAvatar player={player} size="lg" />
        <div className="flex flex-wrap gap-1.5"><TierBadge tier={player.tier} /><RoleBadge role={player.role} long />{player.overseas && <OverseasTag />}{player.custom && <Badge>Custom</Badge>}</div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        {[
          ['Base price', formatLakhs(player.basePrice)],
          ['Sim rating', `${player.rating}${entry?.ratingAdj ? ` (${entry.ratingAdj > 0 ? '+' : ''}${entry.ratingAdj})` : ''}`],
          ['Bowling', player.bowlingType ? (player.bowlingType === 'pace' ? 'Pace' : 'Spin') : '—'],
          ['Batting slot', player.battingSlot],
          ['Last IPL team', player.lastTeam ?? '—'],
          ['Status', owner ? `Sold to ${room.teams[owner]?.short} for ${formatLakhs(entry?.price)}` : room.auction?.unsold.includes(player.id) ? 'Unsold' : 'Available'],
        ].map(([k, v]) => <div key={k} className="rounded-xl bg-ink-900/60 p-3"><dt className="text-[10px] font-semibold uppercase tracking-widest text-subtle">{k}</dt><dd className="mt-0.5 font-semibold capitalize">{v}</dd></div>)}
      </dl>
      <div className="mt-4 text-sm">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-subtle">IPL franchises</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{player.previousTeams.length ? player.previousTeams.map((t) => <span key={t} className="rounded-md bg-white/6 px-2 py-0.5 text-xs font-semibold">{t}</span>) : <span className="text-muted">None recorded</span>}</div>
      </div>
      <p className="mt-4 text-xs text-subtle">Rating, batting slot and bowling type are fictional gameplay parameters, not official statistics.</p>
    </Dialog>
  );
}

function AddPlayerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { code } = useRoomCtx();
  const [form, setForm] = useState<CustomPlayerInput>({ name: '', country: 'IND', role: 'BAT', tier: 'silver', bowlingType: null, previousTeams: [] });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<CustomPlayerInput>) => setForm((f) => ({ ...f, ...p }));
  const bowls = form.role === 'BOWL' || form.role === 'AR';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add custom player" description="Custom players join the pool for this room only."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={form.name.trim().length < 2} loading={busy} icon={<UserRound className="size-4" />} onClick={async () => {
          setBusy(true);
          const ok = await run({ action: 'addCustomPlayer', code, player: { ...form, bowlingType: bowls ? form.bowlingType ?? 'pace' : null } }, `${form.name} added to the pool`);
          setBusy(false);
          if (ok) { onOpenChange(false); setForm({ ...form, name: '' }); }
        }}>Add player</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="cp-name"><Input id="cp-name" value={form.name} maxLength={24} onChange={(e) => set({ name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" htmlFor="cp-role">
            <Select id="cp-role" value={form.role} onChange={(e) => set({ role: e.target.value as Role })}>
              {(['BAT', 'WK', 'AR', 'BOWL'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
            </Select>
          </Field>
          <Field label="Tier" htmlFor="cp-tier" hint={`Base ${formatLakhs(TIER_BASE_PRICE[form.tier])}`}>
            <Select id="cp-tier" value={form.tier} onChange={(e) => set({ tier: e.target.value as Tier })}>
              {TIERS.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </Select>
          </Field>
          <Field label="Country" htmlFor="cp-country" hint={form.country === 'IND' ? 'Indian player' : 'Overseas player'}>
            <Select id="cp-country" value={form.country} onChange={(e) => set({ country: e.target.value })}>
              {Object.entries(COUNTRIES).map(([c, v]) => <option key={c} value={c}>{v.name}</option>)}
            </Select>
          </Field>
          {bowls && (
            <Field label="Bowling" htmlFor="cp-bowl">
              <Select id="cp-bowl" value={form.bowlingType ?? 'pace'} onChange={(e) => set({ bowlingType: e.target.value as 'pace' | 'spin' })}>
                <option value="pace">Pace</option><option value="spin">Spin</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Previous franchises (optional, most recent last)">
          <div className="flex flex-wrap gap-1.5">
            {FRANCHISE_IDS.map((t) => {
              const on = form.previousTeams?.includes(t);
              return <button key={t} type="button" aria-pressed={on} onClick={() => set({ previousTeams: on ? form.previousTeams!.filter((x) => x !== t) : [...(form.previousTeams ?? []), t] })}
                className={cn('rounded-md border px-2 py-1 text-xs font-bold', on ? 'border-gold-400/60 bg-gold-400/10 text-gold-300' : 'border-white/10 text-muted')}>{t}</button>;
            })}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
