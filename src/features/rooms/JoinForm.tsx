import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, LogIn, Lock } from 'lucide-react';
import type { Room } from '@shared/types';
import { formatLakhs } from '@shared/engine/core';
import { Button, Field, Input, cn } from '@/components/ui';
import { TeamCrest } from '@/components/game';
import { api } from '@/services/api';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toast';

/** Name + franchise picker with live availability. Used by /join and by the room gate. */
export function JoinForm({ room, code }: { room: Room; code: string }) {
  const nav = useNavigate();
  const { displayName, setDisplayName } = useSession();
  const [name, setName] = useState(displayName);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lobby = room.meta.status === 'lobby';
  const teams = Object.values(room.teams);
  const chosen = teamId ? room.teams[teamId] : null;
  const chosenTaken = !!chosen?.ownerUid;

  async function join() {
    setBusy(true);
    try {
      setDisplayName(name.trim());
      await api({ action: 'joinRoom', code, name: name.trim() });
      if (teamId && lobby) {
        try {
          await api({ action: 'claimTeam', code, teamId });
        } catch (e) {
          toast.error(`${(e as Error).message} You joined as a spectator — pick another franchise in the lobby.`);
        }
      }
      nav(`/room/${code}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Your display name" htmlFor="join-name">
        <Input id="join-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arjun" autoComplete="nickname" />
      </Field>

      {lobby && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Franchise</span>
            <span className="text-xs text-subtle">{teams.filter((t) => !t.ownerUid).length} of {teams.length} open · purse {formatLakhs(room.settings.purse)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Choose a franchise">
            {teams.map((t) => {
              const taken = !!t.ownerUid;
              const sel = teamId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  disabled={taken}
                  onClick={() => setTeamId(sel ? null : t.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
                    sel ? 'border-gold-400/80 bg-gold-400/8' : 'border-white/10 hover:border-white/25',
                    taken && 'cursor-not-allowed opacity-45 hover:border-white/10',
                  )}
                >
                  <TeamCrest teamId={t.id} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{t.name}</span>
                    <span className="block truncate text-[11px] text-subtle">{taken ? <span className="inline-flex items-center gap-1"><Lock className="size-3" />{t.ownerName}</span> : 'Available'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={name.trim().length < 2 || chosenTaken}
        loading={busy}
        onClick={join}
        icon={teamId ? <LogIn className="size-5" /> : <Eye className="size-5" />}
      >
        {teamId && chosen ? `Join as ${chosen.short}` : 'Join as spectator'}
      </Button>
    </div>
  );
}
