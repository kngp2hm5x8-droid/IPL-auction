import { useState } from 'react';
import { Sparkles, Crosshair, Snowflake, EyeOff, Zap, Ambulance, BadgeIndianRupee, TrendingUp, Shield, Hourglass, Receipt, FileWarning, Brain, Search, Eye, HelpCircle, type LucideIcon } from 'lucide-react';
import type { CardType, HeldCard } from '@shared/types';
import { CARD_DEFS } from '@shared/engine/cards';
import { formatLakhs } from '@shared/engine/core';
import { Button, Dialog, cn } from '@/components/ui';
import { TeamCrest } from '@/components/game';
import { requestId, run } from '@/services/api';
import { toast } from '@/stores/toast';
import { useRoomCtx } from '@/features/rooms/RoomContext';

export const CARD_ICON: Record<CardType, LucideIcon> = {
  sniper: Crosshair, freeze: Snowflake, hidden_purse: EyeOff, form_surge: Zap, injury: Ambulance,
  sponsorship: BadgeIndianRupee, interest: TrendingUp, shield: Shield, time_warp: Hourglass, cashback: Receipt,
  tax_audit: FileWarning, self_freeze: Brain, scout_error: Search, purse_leak: Eye,
};

export function CardsPanel() {
  const { room, myTeam, code } = useRoomCtx();
  const team = myTeam!;
  const held = Object.values(team.cards).filter((c) => c.status === 'held');
  const [buying, setBuying] = useState(false);
  const [target, setTarget] = useState<HeldCard | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const lot = room.auction?.lot;
  const full = held.length >= room.settings.maxCardsHeld;

  async function buy() {
    setBuying(true);
    const r = await run({ action: 'buyCard', code, requestId: requestId() });
    setBuying(false);
    const type = r?.data?.type as CardType | undefined;
    if (type) {
      const d = CARD_DEFS[type];
      (d.kind === 'bad' ? toast.error : toast.success)(`${d.kind === 'bad' ? 'Bad luck! ' : 'You drew '}${d.name}: ${d.description}`);
    }
  }

  async function use(card: HeldCard, targetTeamId?: string) {
    setUsing(card.id);
    await run({ action: 'useCard', code, cardId: card.id, targetTeamId, lotSeq: lot?.seq }, `${CARD_DEFS[card.type].name} played`);
    setUsing(null);
    setTarget(null);
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-ink-900/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gold-300"><Sparkles className="size-3.5" />Power cards {held.length}/{room.settings.maxCardsHeld}</div>
        <Button size="sm" variant="outline" disabled={full} loading={buying} onClick={buy} icon={<HelpCircle className="size-3.5" />}>Mystery {formatLakhs(room.settings.cardCost)}</Button>
      </div>
      {held.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {held.map((c) => {
            const d = CARD_DEFS[c.type];
            const Icon = CARD_ICON[c.type];
            return (
              <Button key={c.id} size="sm" variant="secondary" loading={using === c.id} title={d.description}
                onClick={() => (d.target ? setTarget(c) : use(c))} icon={<Icon className="size-3.5 text-gold-300" />}>
                {d.name}
              </Button>
            );
          })}
        </div>
      ) : <p className="mt-2 text-xs text-subtle">No cards held. Mystery cards may be good — or bad.</p>}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)} title={target ? `Play ${CARD_DEFS[target.type].name}` : ''} description={target ? CARD_DEFS[target.type].description : undefined}>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(room.teams).filter((t) => t.id !== team.id).map((t) => (
            <button key={t.id} onClick={() => target && use(target, t.id)} disabled={!!using}
              className={cn('flex items-center gap-2 rounded-xl border border-white/10 p-2.5 text-left hover:border-gold-400/60')}>
              <TeamCrest teamId={t.id} size="sm" />
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{t.short}</span><span className="block text-[11px] text-subtle">{t.effects.shield > 0 ? 'Shielded' : t.ownerName}</span></span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
