/**
 * Ball-by-ball T20 simulation.
 *
 * Deterministic for a given seed, so the server computes the authoritative result once and
 * every client can replay the stored ball log at any speed (and resume after a refresh).
 *
 * All probabilities below are FICTIONAL simulation parameters tuned to produce plausible
 * modern-T20 totals (≈150–200, ≈6–7 wickets per innings). They are not derived from, and do
 * not claim to be, official IPL statistics. Player ratings shift the probabilities without
 * making outcomes deterministic.
 */
import type {
  Ball, BattingCard, BowlingCard, BowlingType, Dismissal, InningsResult, MatchResult, Player, Role,
} from '../types';
import { clamp, pick, seededRng, type Rng } from './core';

export interface SimPlayer {
  id: string;
  name: string;
  role: Role;
  bowlingType: BowlingType | null;
  /** Effective gameplay rating (base rating + card adjustments). */
  rating: number;
}

export interface TeamSheet {
  teamId: string;
  name: string;
  short: string;
  /** Batting order. Exactly 11. */
  players: SimPlayer[];
  captainId: string;
  wicketKeeperId: string;
}

export const PITCHES = {
  'Batting Paradise': { runs: 1.12, wickets: 0.88, spin: 0, pace: 0 },
  Balanced: { runs: 1.0, wickets: 1.0, spin: 0, pace: 0 },
  Dustbowl: { runs: 0.93, wickets: 1.05, spin: 6, pace: -2 },
  'Green Top': { runs: 0.94, wickets: 1.08, spin: -2, pace: 6 },
} as const;
export type PitchName = keyof typeof PITCHES;

type Outcome = 0 | 1 | 2 | 3 | 4 | 6 | 'W';
type Dist = Record<'0' | '1' | '2' | '3' | '4' | '6' | 'W', number>;

/** Base probabilities for a legal delivery by phase (each row sums to 1). */
const PHASE: Record<'pp' | 'mid' | 'death', Dist> = {
  pp: { '0': 0.39, '1': 0.3, '2': 0.07, '3': 0.01, '4': 0.135, '6': 0.045, W: 0.05 },
  mid: { '0': 0.325, '1': 0.41, '2': 0.09, '3': 0.005, '4': 0.095, '6': 0.04, W: 0.035 },
  death: { '0': 0.29, '1': 0.33, '2': 0.09, '3': 0.005, '4': 0.13, '6': 0.085, W: 0.07 },
};
const WIDE_P = { pace: 0.032, spin: 0.018, none: 0.04 };
const NOBALL_P = 0.006;
const BYE_SHARE_OF_DOTS = 0.05;

export function battingSkill(p: SimPlayer): number {
  if (p.role === 'BAT' || p.role === 'WK') return p.rating;
  if (p.role === 'AR') return p.rating - 4;
  return p.rating - 28;
}

export function bowlingSkill(p: SimPlayer): number {
  if (p.role === 'BOWL') return p.rating;
  if (p.role === 'AR') return p.rating - 5;
  return 40;
}

interface BatState extends BattingCard { name: string; skill: number }
interface BowlState extends BowlingCard { name: string; skill: number; type: BowlingType | null; overs: number; deathSpecialist: boolean }

const oversStr = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

/**
 * Can `slots` remaining overs still be bowled given per-bowler remaining quotas, with no
 * bowler bowling consecutive overs and `prev` having just bowled?
 * Each bowler can bowl at most ceil(slots/2) of the remaining overs (floor if they bowled the last one).
 */
export function oversFeasible(quota: Map<string, number>, prev: string | null, slots: number): boolean {
  if (slots <= 0) return true;
  let capacity = 0;
  for (const [id, q] of quota) {
    const limit = id === prev ? Math.floor(slots / 2) : Math.ceil(slots / 2);
    capacity += Math.min(q, limit);
  }
  return capacity >= slots;
}

interface InningsOpts {
  target: number | null;
  maxOvers: number;
  maxWickets: number;
  pitch: PitchName;
  rng: Rng;
  battingCaptainId: string;
  keeperId: string;
}

export function simulateInnings(bat: TeamSheet, bowl: TeamSheet, o: InningsOpts): InningsResult {
  const rng = o.rng;
  const pitch = PITCHES[o.pitch];
  const batters: BatState[] = bat.players.map((p) => ({
    playerId: p.id, name: p.name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: null,
    skill: battingSkill(p) + (p.id === o.battingCaptainId ? 3 : 0),
  }));
  const paceRanked = bowl.players.filter((p) => p.bowlingType === 'pace').sort((a, b) => bowlingSkill(b) - bowlingSkill(a));
  const deathIds = new Set(paceRanked.slice(0, 2).map((p) => p.id));
  const bowlers: BowlState[] = bowl.players.map((p) => ({
    playerId: p.id, name: p.name, balls: 0, runs: 0, wickets: 0, dots: 0, wides: 0, noballs: 0, overs: 0,
    skill: bowlingSkill(p) + (p.bowlingType === 'spin' ? pitch.spin : p.bowlingType === 'pace' ? pitch.pace : 0),
    type: p.bowlingType, deathSpecialist: deathIds.has(p.id),
  }));
  const quota = new Map(bowlers.map((b) => [b.playerId, o.maxOvers === 1 ? 1 : Math.min(4, Math.ceil(o.maxOvers / 5))]));

  let runs = 0, wickets = 0, legal = 0;
  const extras = { wides: 0, noballs: 0, legbyes: 0, byes: 0 };
  const balls: Ball[] = [];
  let striker = 0, nonStriker = 1, nextIn = 2;
  let prevBowler: string | null = null;
  let freeHit = false;
  const done = () => wickets >= o.maxWickets || legal >= o.maxOvers * 6 || (o.target != null && runs >= o.target);

  for (let over = 0; over < o.maxOvers && !done(); over++) {
    const bowler = chooseBowler(bowlers, quota, prevBowler, o.maxOvers - over, over, o.maxOvers, rng);
    quota.set(bowler.playerId, quota.get(bowler.playerId)! - 1);
    bowler.overs += 1;
    prevBowler = bowler.playerId;
    let legalInOver = 0;

    while (legalInOver < 6 && !done()) {
      const s = batters[striker];
      const ns = batters[nonStriker];
      const phase = o.maxOvers < 20 ? 'death' : over < 6 ? 'pp' : over < 15 ? 'mid' : 'death';
      const ball: Ball = {
        over, ballInOver: legalInOver, batterId: s.playerId, nonStrikerId: ns.playerId, bowlerId: bowler.playerId,
        runsBat: 0, extras: 0, extraKind: null, wicket: null, legal: true, freeHit, totalRuns: 0, totalWickets: 0, commentary: '',
      };
      const r = rng();
      const wideP = bowler.type ? WIDE_P[bowler.type] : WIDE_P.none;
      if (r < wideP) {
        ball.legal = false; ball.extraKind = 'wide'; ball.extras = 1;
        extras.wides += 1; bowler.wides += 1; bowler.runs += 1; runs += 1;
        ball.commentary = `Wide from ${bowler.name}.`;
      } else {
        const isNoBall = r < wideP + NOBALL_P;
        const outcome = drawOutcome(s, bowler, phase, { runs, wickets, legal, target: o.target, maxBalls: o.maxOvers * 6 }, pitch, rng);
        if (isNoBall) {
          ball.legal = false; ball.extraKind = 'noball'; ball.extras = 1;
          extras.noballs += 1; bowler.noballs += 1; bowler.runs += 1; runs += 1;
        }
        s.balls += 1; // batters are credited with no-balls faced
        if (outcome === 'W' && (freeHit || isNoBall)) {
          ball.commentary = `${isNoBall ? 'No-ball! ' : 'Free hit! '}${s.name} survives — no wicket.`;
          if (!isNoBall) bowler.dots += 1;
        } else if (outcome === 'W') {
          const kind = dismissalKind(bowler, rng);
          const fielder = kind === 'stumped' ? o.keeperId : kind === 'caught' ? (rng() < 0.2 ? o.keeperId : pick(bowl.players, rng).id) : kind === 'run out' ? pick(bowl.players, rng).id : undefined;
          s.out = true;
          s.dismissal = describeDismissal(kind, bowler.name, fielder ? bowl.players.find((p) => p.id === fielder)?.name : undefined);
          wickets += 1;
          if (kind !== 'run out') bowler.wickets += 1;
          bowler.dots += 1;
          ball.wicket = { kind, playerOutId: s.playerId, ...(fielder ? { fielderId: fielder } : {}) };
          ball.commentary = `OUT! ${s.name} ${s.dismissal} for ${s.runs} (${s.balls}).`;
          if (wickets < o.maxWickets && nextIn < batters.length) striker = nextIn++;
        } else {
          let r2: number = outcome;
          if (r2 === 0 && !isNoBall && rng() < BYE_SHARE_OF_DOTS) {
            const kind = rng() < 0.7 ? 'legbye' : 'bye';
            ball.extraKind = kind; ball.extras = 1; runs += 1;
            if (kind === 'legbye') extras.legbyes += 1; else extras.byes += 1;
            ball.commentary = `${kind === 'legbye' ? 'Leg bye' : 'Bye'}, they scamper one.`;
            [striker, nonStriker] = [nonStriker, striker];
            r2 = -1;
          }
          if (r2 >= 0) {
            ball.runsBat = r2;
            s.runs += r2; runs += r2; bowler.runs += r2;
            if (r2 === 4) s.fours += 1;
            if (r2 === 6) s.sixes += 1;
            if (r2 === 0 && !isNoBall) bowler.dots += 1;
            ball.commentary = (isNoBall ? 'No-ball! ' : '') + runCommentary(r2, s.name, bowler.name, rng);
            if (r2 % 2 === 1) [striker, nonStriker] = [nonStriker, striker];
          }
        }
        if (!isNoBall) {
          legal += 1; legalInOver += 1; bowler.balls += 1;
          freeHit = false;
        } else {
          freeHit = true;
        }
      }
      ball.ballInOver = legalInOver;
      ball.totalRuns = runs;
      ball.totalWickets = wickets;
      balls.push(ball);
    }
    if (legalInOver === 6) [striker, nonStriker] = [nonStriker, striker];
  }

  // Everyone who walked out to bat (the openers plus one new batter per dismissal).
  const batting: BattingCard[] = batters
    .slice(0, nextIn)
    .map(({ playerId, runs: r, balls: bl, fours, sixes, out, dismissal }) => ({ playerId, runs: r, balls: bl, fours, sixes, out, dismissal: out ? dismissal : 'not out' }));
  const bowling: BowlingCard[] = bowlers
    .filter((b) => b.overs > 0)
    .map(({ playerId, balls: bl, runs: r, wickets: w, dots, wides, noballs }) => ({ playerId, balls: bl, runs: r, wickets: w, dots, wides, noballs }));

  return {
    battingTeamId: bat.teamId, bowlingTeamId: bowl.teamId,
    runs, wickets, legalBalls: legal, allOut: wickets >= o.maxWickets, extras, batting, bowling, balls,
    target: o.target,
  };
}

function chooseBowler(bowlers: BowlState[], quota: Map<string, number>, prev: string | null, slotsLeft: number, over: number, maxOvers: number, rng: Rng): BowlState {
  const phase = maxOvers < 20 ? 'death' : over < 6 ? 'pp' : over < 15 ? 'mid' : 'death';
  const scored = bowlers
    .filter((b) => b.playerId !== prev && (quota.get(b.playerId) ?? 0) > 0)
    .map((b) => {
      let score = b.skill + rng() * 4;
      if (b.type === 'pace' && phase !== 'mid') score += 5;
      if (b.type === 'spin' && phase === 'mid') score += 5;
      if (b.deathSpecialist && phase !== 'death' && b.overs >= 2) score -= 25; // save death overs
      return { b, score };
    })
    .sort((x, y) => y.score - x.score);
  for (const { b } of scored) {
    const q = new Map(quota);
    q.set(b.playerId, q.get(b.playerId)! - 1);
    if (oversFeasible(q, b.playerId, slotsLeft - 1)) return b;
  }
  // Unreachable while the XI has ≥ 5 players (any 11-player side can always complete 20 overs).
  return scored[0].b;
}

function drawOutcome(
  s: BatState, bowler: BowlState, phase: 'pp' | 'mid' | 'death',
  st: { runs: number; wickets: number; legal: number; target: number | null; maxBalls: number },
  pitch: (typeof PITCHES)[PitchName], rng: Rng,
): Outcome {
  const base = PHASE[phase];
  const diff = clamp((s.skill - bowler.skill) / 20, -2.5, 2.5);
  let boundary = Math.exp(0.28 * diff) * pitch.runs;
  let wicket = Math.exp(-0.38 * diff) * pitch.wickets;
  let rotate = Math.exp(0.08 * diff);

  const ballsLeft = st.maxBalls - st.legal;
  if (st.target != null && ballsLeft > 0) {
    const rrr = ((st.target - st.runs) / ballsLeft) * 6;
    const aggression = clamp((rrr - 8.5) / 4, -0.6, 1.6);
    boundary *= 1 + 0.22 * aggression;
    wicket *= 1 + 0.35 * Math.max(0, aggression) - 0.15 * Math.max(0, -aggression);
    rotate *= 1 + 0.05 * aggression;
  } else if (phase === 'death' && st.wickets <= 5) {
    boundary *= 1.08;
    wicket *= 1.05;
  }
  if (st.wickets >= 7 && ballsLeft > 24) { boundary *= 0.85; wicket *= 0.9; }

  const w: Record<string, number> = {
    '1': base['1'] * rotate, '2': base['2'] * rotate, '3': base['3'],
    '4': base['4'] * boundary, '6': base['6'] * boundary, W: base.W * wicket,
  };
  const used = Object.values(w).reduce((a, b) => a + b, 0);
  w['0'] = Math.max(0.12, 1 - used);
  const total = used + w['0'];
  let r = rng() * total;
  for (const k of ['0', '1', '2', '3', '4', '6', 'W'] as const) {
    r -= w[k];
    if (r < 0) return k === 'W' ? 'W' : (Number(k) as Outcome);
  }
  return 0;
}

function dismissalKind(bowler: BowlState, rng: Rng): Dismissal {
  const r = rng();
  if (bowler.type === 'spin' && r < 0.07) return 'stumped';
  if (r < 0.62) return 'caught';
  if (r < 0.79) return 'bowled';
  if (r < 0.92) return 'lbw';
  return 'run out';
}

function describeDismissal(kind: Dismissal, bowler: string, fielder?: string): string {
  switch (kind) {
    case 'caught': return fielder && fielder !== bowler ? `c ${fielder} b ${bowler}` : `c & b ${bowler}`;
    case 'bowled': return `b ${bowler}`;
    case 'lbw': return `lbw b ${bowler}`;
    case 'stumped': return `st ${fielder ?? 'keeper'} b ${bowler}`;
    case 'run out': return `run out (${fielder ?? 'direct hit'})`;
  }
}

function runCommentary(r: number, bat: string, bowl: string, rng: Rng): string {
  const lines: Record<number, string[]> = {
    0: [`Dot ball. ${bowl} beats ${bat}.`, `Defended solidly by ${bat}.`, `Good length, no run.`],
    1: [`${bat} works it away for a single.`, `Pushed into the gap, one run.`, `Quick single taken.`],
    2: [`${bat} comes back for two.`, `Driven into the deep, they run two.`],
    3: [`Three runs — superb running.`],
    4: [`FOUR! ${bat} finds the gap.`, `FOUR! Cracking shot off ${bowl}.`, `FOUR! Races away to the fence.`],
    6: [`SIX! ${bat} launches it into the stands!`, `SIX! Huge hit off ${bowl}.`, `SIX! That's out of the ground.`],
  };
  return pick(lines[r] ?? [`${r} runs.`], rng);
}

/* ─────────────────────────── Full match ─────────────────────────── */

export interface MatchOptions {
  matchId: string;
  seed: number;
  /** Playoff matches must produce a winner, so ties go to super overs. */
  superOverOnTie: boolean;
}

export function simulateMatch(a: TeamSheet, b: TeamSheet, opts: MatchOptions): MatchResult {
  const rng = seededRng(opts.seed);
  const pitch = pick(Object.keys(PITCHES) as PitchName[], rng);
  const tossWinner = rng() < 0.5 ? a : b;
  const chaseBias = pitch === 'Green Top' ? 0.7 : pitch === 'Batting Paradise' ? 0.45 : 0.6;
  const decision: 'bat' | 'bowl' = rng() < chaseBias ? 'bowl' : 'bat';
  const first = decision === 'bat' ? tossWinner : tossWinner === a ? b : a;
  const second = first === a ? b : a;

  const inn1 = simulateInnings(first, second, { target: null, maxOvers: 20, maxWickets: 10, pitch, rng, battingCaptainId: first.captainId, keeperId: second.wicketKeeperId });
  const inn2 = simulateInnings(second, first, { target: inn1.runs + 1, maxOvers: 20, maxWickets: 10, pitch, rng, battingCaptainId: second.captainId, keeperId: first.wicketKeeperId });

  let winner: TeamSheet | null = null;
  let margin = '';
  const superOvers: [InningsResult, InningsResult][] = [];
  if (inn2.runs > inn1.runs) {
    winner = second;
    const ballsLeft = 120 - inn2.legalBalls;
    margin = `won by ${10 - inn2.wickets} wicket${10 - inn2.wickets === 1 ? '' : 's'} (${ballsLeft} ball${ballsLeft === 1 ? '' : 's'} left)`;
  } else if (inn1.runs > inn2.runs) {
    winner = first;
    const d = inn1.runs - inn2.runs;
    margin = `won by ${d} run${d === 1 ? '' : 's'}`;
  } else if (opts.superOverOnTie) {
    // IPL convention: the side that batted second bats first in the super over.
    let bf = second, bs = first;
    for (let i = 0; i < 10 && !winner; i++) {
      const so1 = simulateInnings(superOverSheet(bf), superOverSheet(bs), { target: null, maxOvers: 1, maxWickets: 2, pitch, rng, battingCaptainId: bf.captainId, keeperId: bs.wicketKeeperId });
      const so2 = simulateInnings(superOverSheet(bs), superOverSheet(bf), { target: so1.runs + 1, maxOvers: 1, maxWickets: 2, pitch, rng, battingCaptainId: bs.captainId, keeperId: bf.wicketKeeperId });
      superOvers.push([so1, so2]);
      if (so2.runs > so1.runs) winner = bs;
      else if (so1.runs > so2.runs) winner = bf;
      else [bf, bs] = [bs, bf];
    }
    if (!winner) winner = rng() < 0.5 ? a : b; // practically unreachable after 10 tied super overs
    margin = `won the super over${superOvers.length > 1 ? ` (after ${superOvers.length})` : ''}`;
  } else {
    margin = 'Match tied';
  }

  return {
    matchId: opts.matchId,
    seed: opts.seed,
    pitch,
    toss: { winnerId: tossWinner.teamId, decision },
    innings: [inn1, inn2],
    superOvers,
    winnerId: winner?.teamId ?? null,
    tiedInRegulation: inn1.runs === inn2.runs,
    margin,
    playerOfMatchId: playerOfMatch([inn1, inn2], winner?.teamId ?? null),
  };
}

/** Super over: the three best batters and the best bowler-led attack. */
function superOverSheet(t: TeamSheet): TeamSheet {
  const batters = [...t.players].sort((x, y) => battingSkill(y) - battingSkill(x)).slice(0, 3);
  const rest = t.players.filter((p) => !batters.includes(p));
  return { ...t, players: [...batters, ...rest] };
}

function playerOfMatch(inns: InningsResult[], winnerId: string | null): string | null {
  const impact = new Map<string, number>();
  for (const inn of inns) {
    const bonus = (teamId: string) => (teamId === winnerId ? 1.15 : 1);
    for (const b of inn.batting) {
      const sr = b.balls ? (b.runs / b.balls) * 100 : 0;
      impact.set(b.playerId, (impact.get(b.playerId) ?? 0) + (b.runs + Math.max(0, sr - 130) * 0.1) * bonus(inn.battingTeamId));
    }
    for (const b of inn.bowling) {
      const econ = b.balls ? (b.runs / b.balls) * 6 : 12;
      impact.set(b.playerId, (impact.get(b.playerId) ?? 0) + (b.wickets * 22 + Math.max(0, 9 - econ) * 4) * bonus(inn.bowlingTeamId));
    }
  }
  let best: string | null = null, bestV = -1;
  for (const [id, v] of impact) if (v > bestV) { best = id; bestV = v; }
  return best;
}

export function toSimPlayer(p: Player, rating: number): SimPlayer {
  return { id: p.id, name: p.name, role: p.role, bowlingType: p.bowlingType, rating };
}

export { oversStr };

/** Re-hydrates a stored MatchResult (Realtime Database drops empty arrays and null fields). */
export function normalizeMatch(raw: unknown): MatchResult {
  const r = raw as MatchResult;
  const arr = <T>(v: T[] | Record<string, T> | undefined | null): T[] => (!v ? [] : Array.isArray(v) ? v : Object.values(v));
  const inn = (i: InningsResult): InningsResult => ({
    ...i,
    batting: arr(i.batting),
    bowling: arr(i.bowling),
    balls: arr(i.balls).map((b) => ({ ...b, extraKind: b.extraKind ?? null, wicket: b.wicket ?? null })),
    extras: Object.assign({ wides: 0, noballs: 0, legbyes: 0, byes: 0 }, i.extras),
    target: i.target ?? null,
  });
  return {
    ...r,
    innings: arr(r.innings).map(inn) as [InningsResult, InningsResult],
    superOvers: arr(r.superOvers).map((pair) => arr(pair).map(inn) as [InningsResult, InningsResult]),
    winnerId: r.winnerId ?? null,
    playerOfMatchId: r.playerOfMatchId ?? null,
  };
}
