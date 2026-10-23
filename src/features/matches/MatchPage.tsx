import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pause, Play, SkipForward, Trophy, Award, Radio, Gauge, CloudSun } from 'lucide-react';
import type { Ball, InningsResult, MatchResult, Room } from '@shared/types';
import { findPlayer } from '@shared/data/players';
import { STAGE_LABEL } from '@shared/engine/tournament';
import { Badge, Button, Card, CardHeader, EmptyState, Segmented, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@/components/ui';
import { TeamCrest } from '@/components/game';
import { useMatch } from '@/hooks/realtime';
import { useRoomCtx } from '@/features/rooms/RoomContext';

type Speed = 'normal' | 'fast' | 'instant';
const DELAY: Record<Exclude<Speed, 'instant'>, number> = { normal: 650, fast: 120 };

const pname = (room: Room, id: string | undefined) => (id ? findPlayer(id, room.customPlayers)?.name ?? id : '');
const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

export default function MatchPage() {
  const { fixtureId } = useParams();
  const { room, code } = useRoomCtx();
  const m = useMatch(code, fixtureId);
  const fixture = fixtureId ? room.tournament?.fixtures[fixtureId] : undefined;
  if (!fixture) return <EmptyState title="Match not found" action={<Link to="../tournament"><Button variant="primary">Season hub</Button></Link>} />;
  if (m.status === 'loading') return <Spinner label="Loading match…" />;
  if (m.status === 'missing') return <EmptyState title="Not played yet" action={<Link to="../tournament"><Button variant="primary">Season hub</Button></Link>}>This fixture has not been simulated.</EmptyState>;
  if (m.status === 'error') return <EmptyState title="Could not load match">{m.error}</EmptyState>;
  return <Replay result={m.data} code={code} stage={STAGE_LABEL[fixture.stage]} number={fixture.number} />;
}

function Replay({ result, code, stage, number }: { result: MatchResult; code: string; stage: string; number: number }) {
  const { room } = useRoomCtx();
  const inns: InningsResult[] = useMemo(() => [...result.innings, ...result.superOvers.flat()], [result]);
  const timeline = useMemo(() => inns.flatMap((inn, ii) => inn.balls.map((_, bi) => ({ ii, bi }))), [inns]);
  const storeKey = `replay:${code}:${result.matchId}`;
  const [pos, setPos] = useState<number>(() => {
    try { return Math.min(Number(sessionStorage.getItem(storeKey) ?? 0), timeline.length); } catch { return 0; }
  });
  const [speed, setSpeed] = useState<Speed>('normal');
  const [playing, setPlaying] = useState(true);
  const done = pos >= timeline.length;

  // Resume support: progress survives refreshes and interruptions.
  useEffect(() => { try { sessionStorage.setItem(storeKey, String(pos)); } catch { /* ignore */ } }, [pos, storeKey]);

  useEffect(() => {
    if (!playing || done) return;
    if (speed === 'instant') { setPos(timeline.length); return; }
    const id = setTimeout(() => setPos((p) => Math.min(p + 1, timeline.length)), DELAY[speed]);
    return () => clearTimeout(id);
  }, [pos, playing, speed, done, timeline.length]);

  const cur = timeline[Math.max(0, Math.min(pos, timeline.length) - 1)];
  const innIdx = done ? Math.min(1, inns.length - 1) : cur?.ii ?? 0;
  const inn = inns[innIdx];
  const shownBalls = done ? inn.balls : inn.balls.slice(0, (cur?.ii === innIdx ? cur.bi + 1 : 0));
  const last = shownBalls[shownBalls.length - 1];
  const isSuper = innIdx >= 2;

  const scoreOf = (i: number) => {
    const n = inns[i];
    if (!n) return null;
    const startedAt = timeline.findIndex((t) => t.ii === i);
    if (!done && (startedAt < 0 || pos <= startedAt)) return null;
    const upto = done || (cur && cur.ii > i) ? n.balls : n.balls.slice(0, cur && cur.ii === i ? cur.bi + 1 : 0);
    const b = upto[upto.length - 1];
    return { runs: b?.totalRuns ?? 0, wkts: b?.totalWickets ?? 0, balls: upto.filter((x) => x.legal).length };
  };

  const recent = useMemo(() => {
    const lines: { key: string; b: Ball; ii: number }[] = [];
    for (let i = Math.min(pos, timeline.length) - 1; i >= 0 && lines.length < 40; i--) {
      const t = timeline[i];
      lines.push({ key: `${t.ii}-${t.bi}`, b: inns[t.ii].balls[t.bi], ii: t.ii });
    }
    return lines;
  }, [pos, timeline, inns]);

  const batting = useMemo(() => liveBatting(shownBalls), [shownBalls]);
  const bowling = useMemo(() => liveBowling(shownBalls), [shownBalls]);
  const thisOver = last ? shownBalls.filter((b) => b.over === last.over) : [];
  const target = inn.target;
  const legalSoFar = shownBalls.filter((b) => b.legal).length;
  const need = target != null && last ? target - last.totalRuns : null;
  const ballsLeft = (isSuper ? 6 : 120) - legalSoFar;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="../tournament"><Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />}>Season</Button></Link>
        <Badge tone={done ? 'gold' : 'danger'}>{done ? 'Result' : <><Radio className="size-3" />Live replay</>}</Badge>
        <span className="text-sm text-muted">{stage} · Match #{number}</span>
        <span className="inline-flex items-center gap-1 text-sm text-muted"><CloudSun className="size-4" />{result.pitch}</span>
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-px bg-white/5 sm:grid-cols-2">
          {[0, 1].map((i) => {
            const n = result.innings[i];
            const s = scoreOf(i);
            const t = room.teams[n.battingTeamId];
            return (
              <div key={i} className={cn('flex items-center gap-4 bg-ink-850 p-5', innIdx === i && !done && 'bg-ink-750')}>
                <TeamCrest teamId={n.battingTeamId} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t?.name}</div>
                  <div className="text-xs text-subtle">{i === 0 ? 'Batting first' : s ? `Chasing ${result.innings[0].runs + 1}` : 'Bowling first'}</div>
                </div>
                <div className="text-right">
                  <div className="tabular font-display text-4xl font-extrabold leading-none" data-testid={`score-${i}`}>{s ? `${s.runs}/${s.wkts}` : '—'}</div>
                  <div className="tabular text-xs text-muted">{s ? `${overs(s.balls)} ov` : 'Yet to bat'}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/6 px-5 py-3 text-sm">
          <span className="text-muted">Toss: <strong className="text-fg">{room.teams[result.toss.winnerId]?.short}</strong> chose to {result.toss.decision}</span>
          {!done && need != null && need > 0 && <span className="font-semibold text-gold-300">{isSuper ? 'Super over: ' : ''}Need {need} from {ballsLeft} ball{ballsLeft === 1 ? '' : 's'}{!isSuper && ballsLeft > 0 ? ` · RRR ${((need / ballsLeft) * 6).toFixed(2)}` : ''}</span>}
          {isSuper && !done && <Badge tone="warn">Super over</Badge>}
        </div>
      </Card>

      {done ? <ResultBanner result={result} /> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <Card className="p-5">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-subtle">At the crease</div>
            <div className="mt-3 space-y-2">
              {last && [last.batterId, last.nonStrikerId].map((id, i) => {
                const b = batting.get(id);
                const out = last.wicket?.playerOutId === id;
                return (
                  <div key={id} className={cn('flex items-center justify-between rounded-xl px-3 py-2', i === 0 ? 'bg-white/6' : '')}>
                    <span className={cn('font-medium', out && 'text-red-300 line-through')}>{pname(room, id)}{i === 0 && !out && <span className="text-gold-300"> *</span>}</span>
                    <span className="tabular font-semibold">{b?.runs ?? 0} <span className="text-xs font-normal text-subtle">({b?.balls ?? 0})</span></span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-subtle">Bowling</div>
            {last && (() => {
              const w = bowling.get(last.bowlerId);
              return (
                <div className="mt-2 flex items-center justify-between rounded-xl bg-white/4 px-3 py-2">
                  <span className="font-medium">{pname(room, last.bowlerId)}</span>
                  <span className="tabular font-semibold">{w?.wickets ?? 0}-{w?.runs ?? 0} <span className="text-xs font-normal text-subtle">({overs(w?.balls ?? 0)})</span></span>
                </div>
              );
            })()}
            <div className="mt-4 flex flex-wrap gap-1.5" aria-label="This over">
              {thisOver.map((b, i) => <BallChip key={i} b={b} />)}
            </div>
          </Card>
          <Card className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
              <Segmented ariaLabel="Replay speed" value={speed} onChange={setSpeed} options={[{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }, { value: 'instant', label: 'Instant' }]} />
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPos(timeline.length)} icon={<SkipForward className="size-4" />} data-testid="skip">Result</Button>
              </div>
            </div>
            <ul className="scrollbar-thin max-h-72 flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
              {recent.map(({ key, b, ii }) => (
                <li key={key} className="flex gap-3">
                  <span className="tabular w-10 shrink-0 text-xs text-subtle">{ii >= 2 ? 'SO ' : ''}{b.over}.{b.ballInOver}</span>
                  <span className={cn(b.wicket ? 'font-semibold text-red-300' : b.runsBat >= 4 ? 'font-semibold text-gold-200' : 'text-muted')}>{b.commentary}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {done && <Scorecards result={result} />}
    </div>
  );
}

function BallChip({ b }: { b: Ball }) {
  const label = b.wicket ? 'W' : b.extraKind === 'wide' ? 'wd' : b.extraKind === 'noball' ? `nb${b.runsBat ? '+' + b.runsBat : ''}` : b.extraKind ? `${b.extras}${b.extraKind === 'legbye' ? 'lb' : 'b'}` : String(b.runsBat);
  return (
    <span className={cn('grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-xs font-bold',
      b.wicket ? 'bg-danger text-white' : b.runsBat === 6 ? 'bg-gold-400 text-ink-950' : b.runsBat === 4 ? 'bg-info text-ink-950' : b.extraKind ? 'bg-white/10 text-amber-200' : 'bg-white/8 text-fg')}>
      {label}
    </span>
  );
}

function liveBatting(balls: Ball[]) {
  const m = new Map<string, { runs: number; balls: number }>();
  for (const b of balls) {
    const s = m.get(b.batterId) ?? { runs: 0, balls: 0 };
    if (b.extraKind !== 'wide') s.balls += 1;
    s.runs += b.runsBat;
    m.set(b.batterId, s);
    if (!m.has(b.nonStrikerId)) m.set(b.nonStrikerId, { runs: 0, balls: 0 });
  }
  return m;
}

function liveBowling(balls: Ball[]) {
  const m = new Map<string, { runs: number; balls: number; wickets: number }>();
  for (const b of balls) {
    const s = m.get(b.bowlerId) ?? { runs: 0, balls: 0, wickets: 0 };
    if (b.legal) s.balls += 1;
    if (b.extraKind !== 'legbye' && b.extraKind !== 'bye') s.runs += b.runsBat + b.extras;
    if (b.wicket && b.wicket.kind !== 'run out') s.wickets += 1;
    m.set(b.bowlerId, s);
  }
  return m;
}

function ResultBanner({ result }: { result: MatchResult }) {
  const { room } = useRoomCtx();
  const w = result.winnerId ? room.teams[result.winnerId] : null;
  return (
    <Card className="flex flex-wrap items-center gap-4 border-gold-400/30 p-5" data-testid="match-result">
      <Trophy className="size-8 text-gold-300" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-display text-3xl font-extrabold uppercase">{w ? `${w.name} ${result.margin}` : 'Match tied'}</div>
        {result.superOvers.length > 0 && <div className="text-sm text-muted">Decided by {result.superOvers.length} super over{result.superOvers.length > 1 ? 's' : ''}.</div>}
      </div>
      {result.playerOfMatchId && <div className="flex items-center gap-2 rounded-xl bg-gold-400/10 px-3 py-2 text-sm"><Award className="size-4 text-gold-300" />Player of the match: <strong>{pname(room, result.playerOfMatchId)}</strong></div>}
    </Card>
  );
}

function Scorecards({ result }: { result: MatchResult }) {
  const { room } = useRoomCtx();
  const all = [...result.innings, ...result.superOvers.flat()];
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Gauge className="size-4 text-gold-400" />Scorecard</span>} subtitle="Batting and bowling figures for every innings" />
      <Tabs defaultValue="0" className="p-4">
        <TabsList>
          {all.map((inn, i) => <TabsTrigger key={i} value={String(i)}>{i >= 2 ? 'SO · ' : ''}{room.teams[inn.battingTeamId]?.short} {inn.runs}/{inn.wickets}</TabsTrigger>)}
        </TabsList>
        {all.map((inn, i) => (
          <TabsContent key={i} value={String(i)} className="mt-4 space-y-5">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-subtle"><th className="py-2 font-semibold">Batter</th><th className="font-semibold"></th>{['R', 'B', '4s', '6s', 'SR'].map((h) => <th key={h} className="px-2 text-right font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {inn.batting.map((b) => (
                    <tr key={b.playerId} className="border-t border-white/5">
                      <td className="py-2 font-medium">{pname(room, b.playerId)}</td>
                      <td className="text-xs text-muted">{b.dismissal}</td>
                      <td className="tabular px-2 text-right font-semibold">{b.runs}</td>
                      <td className="tabular px-2 text-right">{b.balls}</td>
                      <td className="tabular px-2 text-right">{b.fours}</td>
                      <td className="tabular px-2 text-right">{b.sixes}</td>
                      <td className="tabular px-2 text-right text-muted">{b.balls ? ((b.runs / b.balls) * 100).toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/5 text-muted"><td className="py-2">Extras</td><td className="text-xs" colSpan={6}>{inn.extras.wides + inn.extras.noballs + inn.extras.legbyes + inn.extras.byes} (wd {inn.extras.wides}, nb {inn.extras.noballs}, lb {inn.extras.legbyes}, b {inn.extras.byes})</td></tr>
                  <tr className="border-t border-white/8 font-semibold"><td className="py-2">Total</td><td colSpan={6} className="tabular">{inn.runs}/{inn.wickets} ({overs(inn.legalBalls)} ov){inn.allOut ? ' · all out' : ''}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-subtle"><th className="py-2 font-semibold">Bowler</th>{['O', 'R', 'W', 'Econ', '0s', 'Wd', 'Nb'].map((h) => <th key={h} className="px-2 text-right font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {inn.bowling.map((b) => (
                    <tr key={b.playerId} className="border-t border-white/5">
                      <td className="py-2 font-medium">{pname(room, b.playerId)}</td>
                      <td className="tabular px-2 text-right">{overs(b.balls)}</td>
                      <td className="tabular px-2 text-right">{b.runs}</td>
                      <td className="tabular px-2 text-right font-semibold">{b.wickets}</td>
                      <td className="tabular px-2 text-right text-muted">{b.balls ? ((b.runs / b.balls) * 6).toFixed(2) : '—'}</td>
                      <td className="tabular px-2 text-right">{b.dots}</td>
                      <td className="tabular px-2 text-right">{b.wides}</td>
                      <td className="tabular px-2 text-right">{b.noballs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
