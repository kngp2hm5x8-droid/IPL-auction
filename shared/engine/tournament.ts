/**
 * League + playoffs. One authoritative match engine (match.ts) is used for every fixture.
 *
 * Playoff formats
 *   ≥4 teams: Qualifier 1 (1v2), Eliminator (3v4), Qualifier 2 (loser Q1 v winner EL), Final (winner Q1 v winner Q2)
 *    3 teams: Eliminator (2v3), Final (1 v winner EL)
 *    2 teams: Final (1v2)
 * League ties: 1 point each, no super over. Playoff ties: decided by super over(s).
 * NRR: (runs scored / overs faced) − (runs conceded / overs bowled); a side bowled out is
 * deemed to have faced its full 20 overs. Super-over runs are excluded.
 */
import type { Fixture, FixtureStage, FixtureSummary, MatchResult, Room, StandingRow, TournamentState, Team } from '../types';
import { findPlayer } from '../data/players';
import { assert, hashSeed, type Rng, shuffle } from './core';
import { autoPickXI, effectiveRating } from './squad';
import { simulateMatch, toSimPlayer, type TeamSheet } from './match';
import { requireController } from './room';
import type { Ctx, Events } from './auction';

export const FULL_INNINGS_BALLS = 120;

/** Circle-method round robin: every pair meets `rounds` times, spread across match-days. */
export function generateLeagueFixtures(teamIds: string[], rounds: 1 | 2, rng: Rng): Record<string, Fixture> {
  const ids = shuffle(teamIds, rng);
  if (ids.length % 2) ids.push('BYE');
  const n = ids.length;
  const pairs: [string, string][] = [];
  for (let r = 0; r < rounds; r++) {
    const rot = [...ids];
    for (let day = 0; day < n - 1; day++) {
      for (let i = 0; i < n / 2; i++) {
        const x = rot[i], y = rot[n - 1 - i];
        if (x === 'BYE' || y === 'BYE') continue;
        pairs.push(((day + r) % 2 === 0) === (i % 2 === 0) ? [x, y] : [y, x]);
      }
      rot.splice(1, 0, rot.pop()!);
    }
  }
  const fixtures: Record<string, Fixture> = {};
  pairs.forEach(([x, y], i) => {
    const id = `L${String(i + 1).padStart(2, '0')}`;
    fixtures[id] = { id, number: i + 1, stage: 'league', teamA: x, teamB: y, status: 'scheduled', summary: null };
  });
  return fixtures;
}

export function emptyRow(teamId: string): StandingRow {
  return { teamId, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, runsFor: 0, ballsFaced: 0, runsAgainst: 0, ballsBowled: 0, nrr: 0 };
}

export function computeStandings(t: TournamentState | null, teamIds: string[]): StandingRow[] {
  const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
  for (const f of Object.values(t?.fixtures ?? {})) {
    if (f.stage !== 'league' || f.status !== 'completed' || !f.summary || !f.teamA || !f.teamB) continue;
    const A = rows.get(f.teamA), B = rows.get(f.teamB);
    if (!A || !B) continue;
    const s = f.summary;
    const faced = (x: FixtureSummary['teamA']) => (x.allOut ? FULL_INNINGS_BALLS : x.balls);
    A.played++; B.played++;
    A.runsFor += s.teamA.runs; A.ballsFaced += faced(s.teamA); A.runsAgainst += s.teamB.runs; A.ballsBowled += faced(s.teamB);
    B.runsFor += s.teamB.runs; B.ballsFaced += faced(s.teamB); B.runsAgainst += s.teamA.runs; B.ballsBowled += faced(s.teamA);
    if (s.winnerId === f.teamA) { A.won++; A.points += 2; B.lost++; }
    else if (s.winnerId === f.teamB) { B.won++; B.points += 2; A.lost++; }
    else { A.tied++; B.tied++; A.points++; B.points++; }
  }
  for (const r of rows.values()) r.nrr = netRunRate(r.runsFor, r.ballsFaced, r.runsAgainst, r.ballsBowled);
  return [...rows.values()].sort(compareRows);
}

export function netRunRate(runsFor: number, ballsFaced: number, runsAgainst: number, ballsBowled: number): number {
  if (!ballsFaced || !ballsBowled) return 0;
  const v = (runsFor / (ballsFaced / 6)) - (runsAgainst / (ballsBowled / 6));
  return Math.round(v * 1000) / 1000;
}

export function compareRows(a: StandingRow, b: StandingRow): number {
  return b.points - a.points || b.nrr - a.nrr || b.won - a.won || a.teamId.localeCompare(b.teamId);
}

export const STAGE_LABEL: Record<FixtureStage, string> = {
  league: 'League', qualifier1: 'Qualifier 1', eliminator: 'Eliminator', qualifier2: 'Qualifier 2', final: 'Final',
};

function playoffFixtures(seeds: string[], startNumber: number): Record<string, Fixture> {
  const mk = (id: string, stage: FixtureStage, n: number, a: string | null, b: string | null): Fixture =>
    ({ id, number: n, stage, teamA: a, teamB: b, status: 'scheduled', summary: null });
  if (seeds.length >= 4) {
    return {
      Q1: mk('Q1', 'qualifier1', startNumber, seeds[0], seeds[1]),
      EL: mk('EL', 'eliminator', startNumber + 1, seeds[2], seeds[3]),
      Q2: mk('Q2', 'qualifier2', startNumber + 2, null, null),
      F: mk('F', 'final', startNumber + 3, null, null),
    };
  }
  if (seeds.length === 3) {
    return { EL: mk('EL', 'eliminator', startNumber, seeds[1], seeds[2]), F: mk('F', 'final', startNumber + 1, seeds[0], null) };
  }
  return { F: mk('F', 'final', startNumber, seeds[0], seeds[1]) };
}

/** Applies a completed match to the bracket. Pure; throws on duplicates or mismatched teams. */
export function applyResult(t: TournamentState, teamIds: string[], fixtureId: string, summary: FixtureSummary, now: number): void {
  const f = t.fixtures[fixtureId];
  assert(f, 'unknown-fixture', 'No such fixture.');
  assert(f.status === 'scheduled', 'already-played', 'That match has already been played.');
  assert(f.teamA && f.teamB, 'tbd', 'Teams for this fixture are not decided yet.');
  if (f.stage !== 'league') assert(summary.winnerId, 'no-winner', 'Playoff matches need a winner.');
  f.status = 'completed';
  f.summary = summary;
  f.completedAt = now;
  const winner = summary.winnerId;
  const loser = winner === f.teamA ? f.teamB : f.teamA;
  const fx = t.fixtures;
  switch (f.stage) {
    case 'league': {
      const league = Object.values(fx).filter((x) => x.stage === 'league');
      if (league.every((x) => x.status === 'completed')) {
        const seeds = computeStandings(t, teamIds).map((r) => r.teamId).slice(0, 4);
        Object.assign(fx, playoffFixtures(seeds, league.length + 1));
        t.status = 'playoffs';
      }
      break;
    }
    case 'qualifier1':
      fx.F.teamA = winner; fx.Q2.teamA = loser;
      break;
    case 'eliminator':
      if (fx.Q2) fx.Q2.teamB = winner; else fx.F.teamB = winner;
      break;
    case 'qualifier2':
      fx.F.teamB = winner;
      break;
    case 'final':
      t.championId = winner;
      t.runnerUpId = loser;
      t.status = 'completed';
      break;
  }
}

/* ─────────────────────────── Room-level reducers ─────────────────────────── */

export function teamSheet(room: Room, team: Team): TeamSheet {
  const xi = team.xi ?? autoPickXI(room, team);
  assert(xi, 'short-squad', `${team.short} does not have 11 players.`);
  const players = xi.playerIds.map((id) => {
    const p = findPlayer(id, room.customPlayers);
    assert(p, 'unknown-player', `Unknown player ${id}`);
    return toSimPlayer(p, effectiveRating(room, team, id) + (id === xi.captainId ? 2 : 0));
  });
  return { teamId: team.id, name: team.name, short: team.short, players, captainId: xi.captainId, wicketKeeperId: xi.wicketKeeperId };
}

export function startTournament(room: Room, ctx: Ctx, ev: Events): void {
  requireController(room, ctx.uid);
  assert(room.meta.status === 'squads', 'bad-state', 'The tournament starts after the auction is complete.');
  const teams = Object.values(room.teams);
  assert(teams.length >= 2, 'not-enough-teams', 'Need at least two teams.');
  for (const team of teams) {
    if (!team.xi) {
      const xi = autoPickXI(room, team);
      assert(xi, 'short-squad', `${team.short} does not have 11 players.`);
      team.xi = { ...xi, savedAt: ctx.now };
      ev.commentary.push(`${team.short}'s Playing XI was auto-selected.`);
    }
    // Owner-saved XIs were validated on save; auto-picked XIs are best-effort for squads that
    // cannot satisfy every constraint (e.g. no keeper bought), so they are not re-validated.
    team.xi.locked = true;
  }
  room.tournament = {
    status: 'league',
    fixtures: generateLeagueFixtures(teams.map((t) => t.id), room.settings.leagueRounds, ctx.rng),
    championId: null, runnerUpId: null, createdAt: ctx.now,
  };
  room.meta.status = 'tournament';
  ev.commentary.push(`🏏 The league is on! ${Object.keys(room.tournament.fixtures).length} league matches scheduled.`);
}

/** Deterministic seed: concurrent requests for the same fixture always produce identical results. */
export function fixtureSeed(room: Room, f: Fixture): number {
  const sig = (id: string | null) => (id ? (room.teams[id]?.xi?.playerIds ?? []).join(',') : '');
  return hashSeed(room.meta.code, f.id, f.teamA ?? '', f.teamB ?? '', sig(f.teamA), sig(f.teamB));
}

export function runFixture(room: Room, fixtureId: string): { result: MatchResult; summary: FixtureSummary } {
  const t = room.tournament;
  assert(t && room.meta.status === 'tournament', 'bad-state', 'No tournament in progress.');
  const f = t.fixtures[fixtureId];
  assert(f, 'unknown-fixture', 'No such fixture.');
  assert(f.status === 'scheduled', 'already-played', 'That match has already been played.');
  assert(f.teamA && f.teamB, 'tbd', 'Teams for this fixture are not decided yet.');
  const A = teamSheet(room, room.teams[f.teamA]);
  const B = teamSheet(room, room.teams[f.teamB]);
  const result = simulateMatch(A, B, { matchId: f.id, seed: fixtureSeed(room, f), superOverOnTie: f.stage !== 'league' });
  return { result, summary: summarize(f, result) };
}

export function summarize(f: Fixture, r: MatchResult): FixtureSummary {
  const innFor = (teamId: string) => r.innings.find((i) => i.battingTeamId === teamId)!;
  const line = (teamId: string) => {
    const i = innFor(teamId);
    return { runs: i.runs, wickets: i.wickets, balls: i.legalBalls, allOut: i.allOut };
  };
  return {
    winnerId: r.winnerId,
    tie: r.tiedInRegulation,
    teamA: line(f.teamA!),
    teamB: line(f.teamB!),
    margin: r.margin,
    decidedBySuperOver: r.superOvers.length > 0,
    playerOfMatchId: r.playerOfMatchId,
  };
}

/** Records a simulated result inside the room transaction. Rejects duplicates. */
export function recordFixture(room: Room, ctx: Ctx, fixtureId: string, summary: FixtureSummary, ev: Events): void {
  requireController(room, ctx.uid);
  const t = room.tournament;
  assert(t, 'bad-state', 'No tournament in progress.');
  assert(t.fixtures[fixtureId]?.status !== 'completed', 'already-played', 'That match has already been played.');
  assert(room.meta.status === 'tournament', 'bad-state', 'No tournament in progress.');
  const before = t.status;
  applyResult(t, Object.keys(room.teams), fixtureId, summary, ctx.now);
  const f = t.fixtures[fixtureId];
  const name = (id: string | null) => (id ? room.teams[id]?.short ?? id : 'TBD');
  ev.commentary.push(summary.winnerId ? `${name(summary.winnerId)} ${summary.margin} vs ${name(summary.winnerId === f.teamA ? f.teamB : f.teamA)}.` : `${name(f.teamA)} v ${name(f.teamB)}: match tied.`);
  if (before === 'league' && t.status === 'playoffs') ev.commentary.push('🔥 League stage complete — the playoffs are set!');
  if (t.status === 'completed') {
    room.meta.status = 'completed';
    ev.commentary.push(`🏆 ${room.teams[t.championId!]?.name} are the champions!`);
  }
}

/** Next fixture that can be played, in schedule order. */
export function nextPlayable(t: TournamentState | null): Fixture | null {
  if (!t) return null;
  return Object.values(t.fixtures)
    .filter((f) => f.status === 'scheduled' && f.teamA && f.teamB)
    .sort((a, b) => a.number - b.number)[0] ?? null;
}
