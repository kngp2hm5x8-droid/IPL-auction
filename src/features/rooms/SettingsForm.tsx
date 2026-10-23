import type { RoomSettings } from '@shared/types';
import { DEFAULT_PURSE } from '@shared/data/reference';
import { formatLakhs } from '@shared/engine/core';
import { Field, Input, Segmented, Switch } from '@/components/ui';

/** Host-configurable room settings. Values are re-validated and clamped on the server. */
export function SettingsForm({ value, onChange, disabled }: { value: RoomSettings; onChange: (patch: Partial<RoomSettings>) => void; disabled?: boolean }) {
  const s = value;
  const num = (k: keyof RoomSettings) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [k]: Number(e.target.value) } as Partial<RoomSettings>);
  return (
    <fieldset disabled={disabled} className="space-y-6">
      <Field label="Auction type">
        <Segmented
          ariaLabel="Auction type"
          value={s.auctionType}
          onChange={(v) => onChange({ auctionType: v, purse: DEFAULT_PURSE[v][s.teamCount], features: { ...s.features, rtm: v === 'mega' ? s.features.rtm : false } })}
          options={[{ value: 'mega', label: 'Mega auction' }, { value: 'mini', label: 'Mini auction' }]}
        />
        <p className="text-xs text-subtle">{s.auctionType === 'mega' ? 'Bigger purses and RTM cards — build from scratch.' : 'Smaller purses for a quicker session.'}</p>
      </Field>

      <Field label={`Franchises (${s.teamCount})`} hint="Unclaimed franchises are removed when the auction starts.">
        <Segmented
          ariaLabel="Number of franchises"
          value={s.teamCount}
          onChange={(v) => onChange({ teamCount: v, purse: DEFAULT_PURSE[s.auctionType][v] })}
          options={[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: n }))}
        />
      </Field>

      <Field label={`Purse per franchise — ${formatLakhs(s.purse)}`} htmlFor="purse" hint="Default depends on auction type and team count.">
        <input id="purse" type="range" min={2000} max={20000} step={500} value={s.purse} onChange={num('purse')} className="w-full accent-gold-400" />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Min squad" htmlFor="minSquad"><Input id="minSquad" type="number" min={11} max={18} value={s.minSquad} onChange={num('minSquad')} /></Field>
        <Field label="Max squad" htmlFor="maxSquad"><Input id="maxSquad" type="number" min={15} max={25} value={s.maxSquad} onChange={num('maxSquad')} /></Field>
        <Field label="Overseas in squad" htmlFor="maxOs"><Input id="maxOs" type="number" min={4} max={10} value={s.maxOverseasSquad} onChange={num('maxOverseasSquad')} /></Field>
        <Field label="Bid timer (s)" htmlFor="timer"><Input id="timer" type="number" min={5} max={60} value={s.bidTimerSec} onChange={num('bidTimerSec')} /></Field>
      </div>

      <div className="divide-y divide-white/6 rounded-xl border border-white/8 px-4">
        <Switch id="f-rtm" label="Right to Match (RTM)" description="A player's previous franchise may match the winning bid." checked={s.features.rtm} onChange={(rtm) => onChange({ features: { ...s.features, rtm }, rtmCardsPerTeam: rtm && !s.rtmCardsPerTeam ? 3 : s.rtmCardsPerTeam })} />
        {s.features.rtm && (
          <div className="flex items-center justify-between gap-3 py-2.5">
            <label htmlFor="rtmCards" className="text-sm text-muted">RTM cards per franchise</label>
            <Input id="rtmCards" type="number" min={0} max={6} value={s.rtmCardsPerTeam} onChange={num('rtmCardsPerTeam')} className="h-9 w-20" />
          </div>
        )}
        <Switch id="f-cards" label="Power cards" description={`Mystery cards cost ${formatLakhs(s.cardCost)}; some are bad luck!`} checked={s.features.powerCards} onChange={(powerCards) => onChange({ features: { ...s.features, powerCards } })} />
        <Switch id="f-double" label="Double round-robin league" description="Every pair of teams plays twice." checked={s.leagueRounds === 2} onChange={(v) => onChange({ leagueRounds: v ? 2 : 1 })} />
      </div>
    </fieldset>
  );
}
