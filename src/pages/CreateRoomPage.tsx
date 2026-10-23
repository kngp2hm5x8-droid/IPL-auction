import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Gavel, Users } from 'lucide-react';
import type { RoomSettings } from '@shared/types';
import { defaultSettings, sanitizeSettings } from '@shared/engine/room';
import { formatLakhs } from '@shared/engine/core';
import { Brand } from '@/components/Brand';
import { Button, Card, CardHeader, Field, Input, SectionLabel, cn } from '@/components/ui';
import { SettingsForm } from '@/features/rooms/SettingsForm';
import { api } from '@/services/api';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toast';

export function CreateRoomPage() {
  const nav = useNavigate();
  const { displayName, setDisplayName } = useSession();
  const [name, setName] = useState(displayName);
  const [asAuctioneer, setAsAuctioneer] = useState(true);
  const [settings, setSettings] = useState<RoomSettings>(() => defaultSettings('mega', 10));
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<RoomSettings>) => setSettings((s) => sanitizeSettings(s, p));
  const nameOk = name.trim().length >= 2;

  async function create() {
    if (!nameOk) return;
    setBusy(true);
    try {
      setDisplayName(name.trim());
      const res = await api({ action: 'createRoom', name: name.trim(), settings, asAuctioneer });
      nav(`/room/${res.code}/lobby`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <header className="flex h-16 items-center justify-between">
        <Brand />
        <Button variant="ghost" size="sm" onClick={() => nav('/')} icon={<ArrowLeft className="size-4" />}>Back</Button>
      </header>
      <SectionLabel className="mt-6">New room</SectionLabel>
      <h1 className="mt-1 font-display text-5xl font-extrabold uppercase">Create auction</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="You" subtitle="Your display name and role in this room" />
            <div className="space-y-5 p-5">
              <Field label="Display name" htmlFor="host-name">
                <Input id="host-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" autoComplete="nickname" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Your role">
                {[
                  { v: true, icon: Gavel, t: 'Run the auction', d: 'You are the auctioneer: call SOLD / UNSOLD, pause, re-list. You can still own a franchise.' },
                  { v: false, icon: Users, t: 'Just host', d: 'You manage the room; assign someone else as auctioneer in the lobby.' },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    role="radio"
                    aria-checked={asAuctioneer === o.v}
                    onClick={() => setAsAuctioneer(o.v)}
                    className={cn('rounded-xl border p-4 text-left transition-colors', asAuctioneer === o.v ? 'border-gold-400/70 bg-gold-400/8' : 'border-white/10 hover:border-white/20')}
                  >
                    <o.icon className={cn('size-5', asAuctioneer === o.v ? 'text-gold-300' : 'text-muted')} aria-hidden />
                    <div className="mt-2 font-semibold">{o.t}</div>
                    <div className="mt-1 text-xs text-muted">{o.d}</div>
                  </button>
                ))}
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Room settings" subtitle="You can change these in the lobby until the auction starts" />
            <div className="p-5"><SettingsForm value={settings} onChange={patch} /></div>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <SectionLabel>Preview</SectionLabel>
            <dl className="mt-3 divide-y divide-white/6 text-sm">
              {[
                ['Type', settings.auctionType === 'mega' ? 'Mega auction' : 'Mini auction'],
                ['Franchises', settings.teamCount],
                ['Purse', formatLakhs(settings.purse)],
                ['Squad size', `${settings.minSquad}–${settings.maxSquad}`],
                ['RTM', settings.features.rtm ? `${settings.rtmCardsPerTeam} per team` : 'Off'],
                ['Power cards', settings.features.powerCards ? 'On' : 'Off'],
                ['League', settings.leagueRounds === 2 ? 'Double round-robin' : 'Single round-robin'],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between py-2"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
            <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!nameOk} loading={busy} onClick={create} icon={<Gavel className="size-5" />}>
              Create room
            </Button>
            {!nameOk && <p className="mt-2 text-center text-xs text-subtle">Enter a display name (2+ characters).</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
