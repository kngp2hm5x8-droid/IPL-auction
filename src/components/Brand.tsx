import { Link } from 'react-router-dom';
import { cn } from './ui';

export function Brand({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link to="/" className={cn('group inline-flex items-center gap-2.5', className)} aria-label="IPL Auction Simulator home">
      <svg viewBox="0 0 64 64" className="size-9 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#111a30" stroke="rgb(245 184 65 / 0.35)" />
        <path d="M19 45 44 15" stroke="#f5b841" strokeWidth="7" strokeLinecap="round" />
        <circle cx="44" cy="44" r="7" fill="#f5b841" />
      </svg>
      {!compact && (
        <span className="leading-none">
          <span className="block font-display text-xl font-bold uppercase tracking-wider text-gold-gradient">IPL Auction</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.3em] text-subtle">Simulator 3.0</span>
        </span>
      )}
    </Link>
  );
}
