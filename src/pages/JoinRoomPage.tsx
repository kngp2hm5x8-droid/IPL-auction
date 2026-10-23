import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, LogIn, SearchX, CheckCircle2 } from 'lucide-react';
import { ROOM_CODE_RE } from '@shared/engine/core';
import { Brand } from '@/components/Brand';
import { Button, Card, CardHeader, EmptyState, Field, Input, SectionLabel, Spinner } from '@/components/ui';
import { useRoom } from '@/hooks/realtime';
import { useSession } from '@/stores/session';
import { JoinForm } from '@/features/rooms/JoinForm';

export function JoinRoomPage() {
  const params = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const valid = ROOM_CODE_RE.test(code);

  useEffect(() => { if (params.code) setCode(params.code.toUpperCase()); }, [params.code]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <header className="flex h-16 items-center justify-between">
        <Brand />
        <Button variant="ghost" size="sm" onClick={() => nav('/')} icon={<ArrowLeft className="size-4" />}>Back</Button>
      </header>
      <SectionLabel className="mt-6">Join</SectionLabel>
      <h1 className="mt-1 font-display text-5xl font-extrabold uppercase">Enter the room</h1>
      <p className="mt-2 text-muted">Ask your host for the room code, or open the link they shared.</p>

      <Card className="mt-8 p-5">
        <Field label="Room code" htmlFor="join-code">
          <Input
            id="join-code"
            value={code}
            autoFocus={!params.code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8))}
            placeholder="IPL-7K3X"
            className="h-14 font-display text-3xl tracking-[0.3em]"
            aria-describedby="code-hint"
          />
        </Field>
        <p id="code-hint" className="mt-2 text-xs text-subtle">Codes look like IPL- followed by 4 letters/numbers.</p>
      </Card>

      {valid && <RoomJoinPanel code={code} />}
    </div>
  );
}

function RoomJoinPanel({ code }: { code: string }) {
  const room = useRoom(code);
  const uid = useSession((s) => s.uid)!;
  const nav = useNavigate();
  if (room.status === 'loading') return <Spinner label="Looking up room…" />;
  if (room.status === 'missing') return <EmptyState icon={<SearchX className="size-5" />} title="Room not found">Check the code — it may have a typo, or the room may have been closed.</EmptyState>;
  if (room.status === 'error') return <EmptyState title="Could not load room">{room.error}</EmptyState>;
  const r = room.data;
  const me = r.members[uid];
  if (me) {
    return (
      <Card className="mt-6 p-6 text-center">
        <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
        <div className="mt-2 font-display text-2xl font-bold uppercase">Welcome back, {me.name}</div>
        <p className="mt-1 text-sm text-muted">{me.teamId ? `You own ${r.teams[me.teamId]?.name ?? me.teamId}.` : 'You are in this room.'}</p>
        <Button variant="primary" size="lg" className="mt-5" onClick={() => nav(`/room/${code}`)} icon={<LogIn className="size-5" />}>Enter room</Button>
      </Card>
    );
  }
  return (
    <Card className="mt-6">
      <CardHeader
        title={`Room ${code}`}
        subtitle={r.meta.status === 'lobby' ? 'Pick an open franchise, or join as a spectator.' : 'The auction has started — you can join as a spectator.'}
        action={r.meta.status !== 'lobby' ? <span className="inline-flex items-center gap-1 text-xs text-muted"><Eye className="size-3.5" />Spectating</span> : undefined}
      />
      <div className="p-5"><JoinForm room={r} code={code} /></div>
    </Card>
  );
}
