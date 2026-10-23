import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Crown, Gavel, Link2, Play, Settings2, Share2, UserPlus, LogOut, CircleCheck, Circle, UserCog } from 'lucide-react';
import type { RoomSettings } from '@shared/types';
import { formatLakhs } from '@shared/engine/core';
import { sanitizeSettings } from '@shared/engine/room';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, SectionLabel, cn } from '@/components/ui';
import { PresenceDot, TeamCrest } from '@/components/game';
import { run } from '@/services/api';
import { toast } from '@/stores/toast';
import { useRoomCtx } from './RoomContext';
import { SettingsForm } from './SettingsForm';

export default function LobbyPage() {
  const ctx = useRoomCtx();
  const { room, code, me, isHost, isController, presence, uid } = ctx;
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const lobby = room.meta.status === 'lobby';
  const teams = Object.values(room.teams);
  const owned = teams.filter((t) => t.ownerUid);
  const ready = owned.filter((t) => room.members[t.ownerUid!]?.ready || room.members[t.ownerUid!]?.isHost);
  const shareUrl = `${window.location.origin}/join/${code}`;

  async function act<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  }

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my IPL auction', text: `Room ${code}`, url: shareUrl }); return; } catch { /* cancelled */ }
    }
    await navigator.clipboard?.writeText(shareUrl);
    toast.success('Invite link copied');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>{lobby ? 'Waiting room' : 'Room'}</SectionLabel>
          <h1 className="mt-1 font-display text-4xl font-extrabold uppercase sm:text-5xl">Auction lobby</h1>
          <p className="mt-1 text-sm text-muted">{lobby ? 'Invite friends, claim franchises, then the host starts the auction.' : 'The auction has started. Franchise ownership is locked.'}</p>
        </div>
        <Card className="flex w-full items-center gap-2 p-2 sm:w-auto">
          <Link2 className="ml-2 size-4 shrink-0 text-subtle" aria-hidden />
          <input readOnly value={shareUrl} aria-label="Invite link" className="min-w-0 flex-1 bg-transparent text-sm text-muted outline-none sm:w-64" onFocus={(e) => e.target.select()} />
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => toast.success('Invite link copied'))} icon={<Copy className="size-3.5" />}>Copy</Button>
          <Button size="sm" variant="primary" onClick={share} icon={<Share2 className="size-3.5" />}>Share</Button>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="slots-h">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="slots-h" className="font-display text-2xl font-bold uppercase">Franchises <span className="text-gold-400">{owned.length}/{teams.length}</span></h2>
            <Badge tone="gold">{room.settings.auctionType === 'mega' ? 'Mega auction' : 'Mini auction'}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((t) => {
              const mine = t.ownerUid === uid;
              const owner = t.ownerUid ? room.members[t.ownerUid] : null;
              return (
                <Card key={t.id} className={cn('relative overflow-hidden p-4', mine && 'ring-1 ring-gold-400/60')} data-testid={`slot-${t.id}`}>
                  <div className="absolute inset-y-0 left-0 w-1" style={{ background: t.color }} aria-hidden />
                  <div className="flex items-center gap-3">
                    <TeamCrest teamId={t.id} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{t.name}</div>
                      {owner ? (
                        <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                          <PresenceDot online={presence[t.ownerUid!]} />
                          <span className="truncate">{owner.name}</span>
                          {mine && <Badge tone="gold">You</Badge>}
                          {(owner.ready || owner.isHost) && <CircleCheck className="size-4 text-success" aria-label="Ready" />}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-sm text-subtle">Open slot</div>
                      )}
                    </div>
                    {lobby && !t.ownerUid && (
                      <Button size="sm" variant={me?.teamId ? 'outline' : 'primary'} loading={busy === `claim-${t.id}`} icon={<UserPlus className="size-3.5" />}
                        onClick={() => act(`claim-${t.id}`, () => run({ action: 'claimTeam', code, teamId: t.id }, `You own ${t.short}!`))}>
                        {me?.teamId ? 'Switch' : 'Claim'}
                      </Button>
                    )}
                    {lobby && mine && (
                      <Button size="sm" variant="ghost" loading={busy === 'release'} icon={<LogOut className="size-3.5" />} onClick={() => act('release', () => run({ action: 'releaseTeam', code }))}>Leave</Button>
                    )}
                  </div>
                  <div className="mt-3 flex gap-4 text-xs text-subtle">
                    <span>Purse <strong className="text-fg">{formatLakhs(t.purse)}</strong></span>
                    {room.settings.features.rtm && <span>RTM <strong className="text-fg">{t.rtmCards}</strong></span>}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          {lobby && me?.teamId && !me.isHost && (
            <Card className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-semibold">{me.ready ? 'You are ready' : 'Ready up'}</div>
                <div className="text-xs text-muted">Lets the host know you are set.</div>
              </div>
              <Button variant={me.ready ? 'success' : 'primary'} size="sm" loading={busy === 'ready'} icon={me.ready ? <Check className="size-4" /> : <Circle className="size-4" />}
                onClick={() => act('ready', () => run({ action: 'setReady', code, ready: !me.ready }))}>
                {me.ready ? 'Ready' : 'I’m ready'}
              </Button>
            </Card>
          )}

          {lobby && isController && (
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <SectionLabel>Start</SectionLabel>
                <span className="text-xs text-muted">{owned.length} owners · {ready.length} ready</span>
              </div>
              <Button variant="primary" size="lg" className="mt-3 w-full" disabled={owned.length < 2} onClick={() => setConfirmStart(true)} icon={<Play className="size-5" />} data-testid="start-auction">
                Start auction
              </Button>
              <p className="mt-2 text-center text-xs text-subtle">{owned.length < 2 ? 'At least two franchises need owners.' : `${teams.length - owned.length} unclaimed franchise(s) will be removed.`}</p>
            </Card>
          )}

          <Card>
            <CardHeader title="Settings" action={lobby && isHost ? <Button size="sm" variant="outline" icon={<Settings2 className="size-3.5" />} onClick={() => setEditOpen(true)}>Edit</Button> : undefined} />
            <dl className="divide-y divide-white/6 px-5 py-1 text-sm">
              {[
                ['Purse', formatLakhs(room.settings.purse)],
                ['Squad', `${room.settings.minSquad}–${room.settings.maxSquad} (≤${room.settings.maxOverseasSquad} overseas)`],
                ['Bid timer', `${room.settings.bidTimerSec}s (${room.settings.highBidTimerSec}s above ${formatLakhs(room.settings.highBidThreshold)})`],
                ['RTM', room.settings.features.rtm ? `${room.settings.rtmCardsPerTeam} cards per team` : 'Off'],
                ['Power cards', room.settings.features.powerCards ? `On · ${formatLakhs(room.settings.cardCost)} each` : 'Off'],
                ['Custom players', Object.keys(room.customPlayers).length],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-3 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
            <div className="px-5 pb-4">
              <Link to="../players"><Button variant="ghost" size="sm" className="w-full">{isController && lobby ? 'Manage player pool' : 'Browse player pool'}</Button></Link>
            </div>
          </Card>

          <Card>
            <CardHeader title={`People (${Object.keys(room.members).length})`} />
            <ul className="divide-y divide-white/6 px-5 py-1">
              {Object.values(room.members).sort((a, b) => a.joinedAt - b.joinedAt).map((m) => (
                <li key={m.uid} className="flex items-center gap-2.5 py-2.5">
                  <PresenceDot online={presence[m.uid]} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}{m.uid === uid && <span className="text-subtle"> (you)</span>}</span>
                  {m.isHost && <Badge tone="gold"><Crown className="size-3" />Host</Badge>}
                  {m.isAuctioneer && <Badge tone="info"><Gavel className="size-3" />Auctioneer</Badge>}
                  {m.teamId && <Badge>{room.teams[m.teamId]?.short ?? m.teamId}</Badge>}
                  {!m.isHost && !m.isAuctioneer && !m.teamId && <Badge>Spectator</Badge>}
                  {isHost && !m.isAuctioneer && (
                    <Button size="icon" variant="ghost" aria-label={`Make ${m.name} auctioneer`} title="Make auctioneer" onClick={() => run({ action: 'setAuctioneer', code, uid: m.uid }, `${m.name} is now the auctioneer`)}>
                      <UserCog className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      <EditSettingsDialog open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={confirmStart}
        onOpenChange={setConfirmStart}
        title="Start the auction?"
        description={`${owned.length} franchises will take part. Settings and ownership lock once bidding begins.`}
        confirmLabel="Start auction"
        loading={busy === 'start'}
        onConfirm={() => act('start', async () => { await run({ action: 'startAuction', code }); setConfirmStart(false); })}
      />
    </div>
  );
}

function EditSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { room, code } = useRoomCtx();
  const [draft, setDraft] = useState<RoomSettings>(room.settings);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the draft each time the dialog opens
  useEffect(() => { if (open) setDraft(room.settings); }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Room settings"
      description="Changing the number of franchises keeps existing owners where possible."
      className="max-w-2xl"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={async () => {
          setSaving(true);
          const ok = await run({ action: 'updateSettings', code, settings: draft }, 'Settings saved');
          setSaving(false);
          if (ok) onOpenChange(false);
        }}>Save</Button>
      </>}
    >
      <SettingsForm value={draft} onChange={(p) => setDraft((d) => sanitizeSettings(d, p))} />
    </Dialog>
  );
}
