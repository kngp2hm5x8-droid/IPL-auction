/** Domain components shared by many pages. */
import type { Player, Role, Team, Tier } from '@shared/types';
import { COUNTRIES, FRANCHISES } from '@shared/data/reference';
import { formatLakhs } from '@shared/engine/core';
import { Gem, Medal, Plane, Shield } from 'lucide-react';
import { cn } from './ui';

const FR = Object.fromEntries(FRANCHISES.map((f) => [f.id, f]));

export function franchiseColor(teamId: string | null | undefined): string {
  return (teamId && FR[teamId]?.color) || '#64748b';
}

/** Monogram crest in the franchise colours. */
export function TeamCrest({ teamId, size = 'md', className }: { teamId: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const f = FR[teamId];
  const dims = { sm: 'size-7 text-[10px]', md: 'size-10 text-xs', lg: 'size-14 text-base', xl: 'size-20 text-xl' }[size];
  return (
    <div
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full font-display font-bold tracking-wide text-white ring-2 ring-white/10', dims, className)}
      style={{ background: `linear-gradient(140deg, ${f?.color ?? '#475569'} 0%, ${f?.accent ?? '#1e293b'} 140%)`, textShadow: '0 1px 2px rgb(0 0 0 / 0.5)' }}
    >
      {f?.short ?? teamId}
    </div>
  );
}

export function TeamChip({ teamId, name, className }: { teamId: string; name?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-semibold', className)}>
      <span className="size-2.5 rounded-full" style={{ background: franchiseColor(teamId) }} aria-hidden />
      {name ?? FR[teamId]?.short ?? teamId}
    </span>
  );
}

const TIER_STYLE: Record<Tier, string> = {
  diamond: 'text-tier-diamond border-tier-diamond/40 bg-tier-diamond/10',
  platinum: 'text-tier-platinum border-tier-platinum/40 bg-tier-platinum/10',
  gold: 'text-tier-gold border-tier-gold/40 bg-tier-gold/10',
  silver: 'text-tier-silver border-tier-silver/40 bg-tier-silver/10',
  bronze: 'text-tier-bronze border-tier-bronze/40 bg-tier-bronze/10',
};
export const TIER_RING: Record<Tier, string> = {
  diamond: '#b69cff', platinum: '#cfd8e6', gold: '#f5b841', silver: '#a3abb9', bronze: '#d58d55',
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const Icon = tier === 'diamond' ? Gem : Medal;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', TIER_STYLE[tier], className)}>
      <Icon className="size-3" aria-hidden />{tier}
    </span>
  );
}

export const ROLE_NAME: Record<Role, string> = { BAT: 'Batter', BOWL: 'Bowler', AR: 'All-rounder', WK: 'Wicket-keeper' };
const ROLE_STYLE: Record<Role, string> = {
  BAT: 'bg-sky-400/12 text-sky-300',
  BOWL: 'bg-rose-400/12 text-rose-300',
  AR: 'bg-emerald-400/12 text-emerald-300',
  WK: 'bg-amber-400/12 text-amber-300',
};

export function RoleBadge({ role, long, className }: { role: Role; long?: boolean; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', ROLE_STYLE[role], className)} title={ROLE_NAME[role]}>{long ? ROLE_NAME[role] : role}</span>;
}

export function Country({ code, showName, className }: { code: string; showName?: boolean; className?: string }) {
  const c = COUNTRIES[code];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted', className)} title={c?.name ?? code}>
      <span aria-hidden>{c?.flag ?? '🏳'}</span>
      {showName ? c?.name ?? code : code}
    </span>
  );
}

export function OverseasTag() {
  return <span className="inline-flex items-center gap-1 rounded-md bg-fuchsia-400/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-300"><Plane className="size-3" aria-hidden />Overseas</span>;
}

export function Money({ lakhs, className }: { lakhs: number | null | undefined; className?: string }) {
  return <span className={cn('tabular', className)}>{formatLakhs(lakhs)}</span>;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** Monogram avatar with a tier-coloured ring (no external images). */
export function PlayerAvatar({ player, size = 'md' }: { player: Pick<Player, 'name' | 'tier'>; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const dims = { sm: 'size-8 text-xs', md: 'size-11 text-sm', lg: 'size-16 text-xl', xl: 'size-24 text-3xl' }[size];
  return (
    <div
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full bg-ink-700 font-display font-bold text-fg', dims)}
      style={{ boxShadow: `0 0 0 2px ${TIER_RING[player.tier]}, 0 0 24px -6px ${TIER_RING[player.tier]}` }}
    >
      {initials(player.name)}
    </div>
  );
}

export function RatingPill({ value, adj = 0 }: { value: number; adj?: number }) {
  const v = value + adj;
  const tone = v >= 90 ? 'text-gold-300' : v >= 84 ? 'text-emerald-300' : v >= 78 ? 'text-sky-300' : 'text-muted';
  return (
    <span className={cn('tabular inline-flex items-baseline gap-1 font-display text-lg font-bold', tone)} title="Fictional simulation rating">
      {v}
      {adj !== 0 && <span className={cn('text-[10px]', adj > 0 ? 'text-success' : 'text-danger')}>{adj > 0 ? `+${adj}` : adj}</span>}
    </span>
  );
}

export function PresenceDot({ online }: { online: boolean | undefined }) {
  return <span className={cn('inline-block size-2 rounded-full', online ? 'bg-success shadow-[0_0_8px] shadow-success/70' : 'bg-ink-500')} aria-label={online ? 'Online' : 'Offline'} />;
}

/** SVG countdown ring. */
export function CountdownRing({ msLeft, totalMs, size = 92, label }: { msLeft: number; totalMs: number; size?: number; label?: string }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = totalMs > 0 ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const secs = Math.ceil(msLeft / 1000);
  const urgent = msLeft <= 5000;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="timer" aria-live="off" aria-label={`${secs} seconds left`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={urgent ? '#f87171' : '#f5b841'} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 200ms linear, stroke 300ms' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className={cn('tabular font-display text-3xl font-bold leading-none', urgent && 'text-danger')}>{secs}</div>
          {label && <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-widest text-subtle">{label}</div>}
        </div>
      </div>
    </div>
  );
}

export function RtmTag({ count }: { count: number }) {
  return <span className="inline-flex items-center gap-1 rounded-md bg-gold-400/12 px-1.5 py-0.5 text-[10px] font-bold text-gold-300" title="Right-to-Match cards"><Shield className="size-3" aria-hidden />{count}</span>;
}

export function teamShort(teams: Record<string, Team>, id: string | null | undefined): string {
  return id ? teams[id]?.short ?? FR[id]?.short ?? id : '—';
}
