import { describe, expect, it } from 'vitest';
import {
  applyResult, computeStandings, generateLeagueFixtures, netRunRate, seededRng, validateXI, autoPickXI,
  BASE_PLAYERS, runFixture, nextPlayable, chemistry, findPlayer, recordFixture, newEvents,
} from '../../shared/engine/index';
import type { FixtureSummary, Room, TournamentState } from '../../shared/types';
import { act, expectGameError, HOST, started, U } from './helpers';

const C = 'IPL-TEST';
const line = (runs: number, wickets: number, balls: number) => ({ runs, wickets, balls, allOut: wickets === 10 });
const sum = (winnerId: string | null, a: ReturnType<typeof line>, b: ReturnType<typeof line>): FixtureSummary =>
  ({ winnerId, tie: winnerId === null, teamA: a, teamB: b, margin: '', decidedBySuperOver: false, playerOfMatchId: null });

function tournament(ids: string[], rounds: 1 | 2 = 1): TournamentState {
  return { status: 'league', fixtures: generateLeagueFixtures(ids, rounds, seededRng(3)), championId: null, runnerUpId: null, createdAt: 0 };
}

describe('fixtures', () => {
  it('round robin: every pair meets once (twice for double), no self-matches', () => {
    for (const n of [2, 3, 4, 5, 8, 10]) {
      const ids = Array.from({ length: n }, (_, i) => `T${i}`);
      for (const rounds of [1, 2] as const) {
        const fx = Object.values(generateLeagueFixtures(ids, rounds, seededRng(n)));
        expect(fx.length).toBe((n * (n - 1) / 2) * rounds);
        const pairCount = new Map<string, number>();
        for (const f of fx) {
          expect(f.teamA).not.toBe(f.teamB);
          const k = [f.teamA, f.teamB].sort().join('-');
          pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
        }
        expect([...pairCount.values()].every((c) => c === rounds)).toBe(true);
        expect(new Set(fx.map((f) => f.number)).size).toBe(fx.length);
      }
    }
  });
});

describe('points & NRR', () => {
  it('computes NRR with the all-out rule', () => {
    // scored 180 in 20 overs, conceded 150 all out in 18 overs (counts as 20)
    expect(netRunRate(180, 120, 150, 120)).toBeCloseTo(1.5, 3);
    expect(netRunRate(0, 0, 0, 0)).toBe(0);
  });

  it('awards 2 for a win, 1 each for a tie, and sorts by points then NRR', () => {
    const t = tournament(['A', 'B', 'C']);
    const fx = Object.values(t.fixtures);
    const teams = (f: typeof fx[number]) => [f.teamA!, f.teamB!];
    // play all three: A beats both; B v C tie
    for (const f of fx) {
      const [x, y] = teams(f);
      if (x === 'A' || y === 'A') {
        const aIsA = x === 'A';
        applyResult(t, ['A', 'B', 'C'], f.id, sum('A', aIsA ? line(200, 4, 120) : line(150, 10, 100), aIsA ? line(150, 10, 100) : line(200, 4, 120)), 1);
      } else {
        applyResult(t, ['A', 'B', 'C'], f.id, sum(null, line(160, 6, 120), line(160, 8, 120)), 1);
      }
    }
    const rows = computeStandings({ ...t, fixtures: Object.fromEntries(Object.entries(t.fixtures).filter(([, f]) => f.stage === 'league')) }, ['A', 'B', 'C']);
    expect(rows[0]).toMatchObject({ teamId: 'A', played: 2, won: 2, points: 4 });
    expect(rows[1].points).toBe(1);
    expect(rows[1].tied).toBe(1);
    expect(rows[0].nrr).toBeCloseTo(10 - 7.5, 3);
  });

  it('rejects duplicate result submissions', () => {
    const t = tournament(['A', 'B']);
    const f = Object.values(t.fixtures)[0];
    applyResult(t, ['A', 'B'], f.id, sum(f.teamA, line(150, 5, 120), line(120, 10, 110)), 1);
    expectGameError(() => applyResult(t, ['A', 'B'], f.id, sum(f.teamB, line(150, 5, 120), line(160, 3, 100)), 2), 'already-played');
  });
});

describe('playoffs', () => {
  function playLeague(ids: string[]) {
    const t = tournament(ids);
    // Lower index always wins → standings = ids order
    for (const f of Object.values(t.fixtures).sort((a, b) => a.number - b.number)) {
      const w = ids.indexOf(f.teamA!) < ids.indexOf(f.teamB!) ? f.teamA! : f.teamB!;
      applyResult(t, ids, f.id, sum(w, line(170, 5, 120), line(150, 9, 120)), 1);
    }
    return t;
  }
  const win = (t: TournamentState, ids: string[], id: string, winner: 'A' | 'B') => {
    const f = t.fixtures[id];
    applyResult(t, ids, id, sum(winner === 'A' ? f.teamA : f.teamB, line(170, 5, 120), line(150, 9, 120)), 2);
  };

  it('≥4 teams: Q1, Eliminator, Q2, Final with correct progression', () => {
    const ids = ['T1', 'T2', 'T3', 'T4', 'T5'];
    const t = playLeague(ids);
    expect(t.status).toBe('playoffs');
    expect([t.fixtures.Q1.teamA, t.fixtures.Q1.teamB]).toEqual(['T1', 'T2']);
    expect([t.fixtures.EL.teamA, t.fixtures.EL.teamB]).toEqual(['T3', 'T4']);
    expect(nextPlayable(t)!.id).toBe('Q1');
    win(t, ids, 'Q1', 'B'); // T2 wins Q1
    expect(t.fixtures.F.teamA).toBe('T2');
    expect(t.fixtures.Q2.teamA).toBe('T1');
    expectGameError(() => win(t, ids, 'Q2', 'A'), 'tbd');
    win(t, ids, 'EL', 'A'); // T3
    expect(t.fixtures.Q2.teamB).toBe('T3');
    win(t, ids, 'Q2', 'B'); // T3
    expect(t.fixtures.F.teamB).toBe('T3');
    win(t, ids, 'F', 'B');
    expect(t.status).toBe('completed');
    expect(t.championId).toBe('T3');
    expect(t.runnerUpId).toBe('T2');
  });

  it('3 teams: Eliminator (2v3) then Final against the table-topper', () => {
    const ids = ['T1', 'T2', 'T3'];
    const t = playLeague(ids);
    expect(Object.keys(t.fixtures).filter((k) => !k.startsWith('L')).sort()).toEqual(['EL', 'F']);
    expect([t.fixtures.EL.teamA, t.fixtures.EL.teamB]).toEqual(['T2', 'T3']);
    win(t, ids, 'EL', 'B');
    expect([t.fixtures.F.teamA, t.fixtures.F.teamB]).toEqual(['T1', 'T3']);
    win(t, ids, 'F', 'A');
    expect(t.championId).toBe('T1');
  });

  it('2 teams: straight to the final', () => {
    const ids = ['T1', 'T2'];
    const t = playLeague(ids);
    expect(Object.keys(t.fixtures).filter((k) => !k.startsWith('L'))).toEqual(['F']);
    win(t, ids, 'F', 'B');
    expect(t.championId).toBe('T2');
  });

  it('playoff matches require a winner', () => {
    const t = playLeague(['T1', 'T2']);
    expectGameError(() => applyResult(t, ['T1', 'T2'], 'F', sum(null, line(150, 5, 120), line(150, 5, 120)), 3), 'no-winner');
  });
});

describe('squads & Playing XI', () => {
  function auctioned(): Room {
    const { room, clock } = started(2);
    act(room, HOST, { action: 'completeAuction', code: C }, clock); // supplementary draft gives 11 each
    return room;
  }

  it('validates XI size, overseas, keeper, bowling options, ownership and captain', () => {
    const room = auctioned();
    const team = room.teams.CSK;
    const squad = Object.keys(team.squad);
    const xi = autoPickXI(room, team)!;
    expect(validateXI(squad, xi, room.settings).ok).toBe(true);
    const r = validateXI(squad, { ...xi, playerIds: xi.playerIds.slice(0, 10) }, room.settings);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/exactly 11/);
    const foreign = Object.keys(room.teams.MI.squad)[0];
    expect(validateXI(squad, { ...xi, playerIds: [...xi.playerIds.slice(0, 10), foreign] }, room.settings).errors.join()).toMatch(/belong/);
    expect(validateXI(squad, { ...xi, captainId: 'nobody' }, room.settings).errors.join()).toMatch(/captain/);
    const overseas = BASE_PLAYERS.filter((p) => p.overseas).slice(0, 5).map((p) => p.id);
    const r2 = validateXI([...squad, ...overseas], { ...xi, playerIds: [...overseas, ...xi.playerIds.filter((id) => !findPlayer(id)!.overseas).slice(0, 6)] }, room.settings);
    expect(r2.errors.join()).toMatch(/overseas/);
    const batters = BASE_PLAYERS.filter((p) => p.role === 'BAT' && !p.overseas).slice(0, 10).map((p) => p.id);
    const wk = BASE_PLAYERS.find((p) => p.role === 'WK')!.id;
    const r3 = validateXI([...batters, wk], { playerIds: [...batters, wk], captainId: wk, wicketKeeperId: wk }, room.settings);
    expect(r3.errors.join()).toMatch(/bowling options/);
    const r4 = validateXI([...batters, wk], { playerIds: [...batters, wk], captainId: wk, wicketKeeperId: batters[0] }, room.settings);
    expect(r4.errors.join()).toMatch(/wicket-keeper/);
  });

  it('saveXI is server-validated, owner-only and respects locking', () => {
    const room = auctioned();
    const clock = { t: Date.now(), advance() { return 0; } };
    const xi = autoPickXI(room, room.teams.CSK)!;
    expectGameError(() => act(room, U[1], { action: 'saveXI', code: C, ...xi, lock: false }, clock as never), 'invalid-xi');
    act(room, U[0], { action: 'saveXI', code: C, ...xi, lock: true }, clock as never);
    expect(room.teams.CSK.xi!.locked).toBe(true);
    expectGameError(() => act(room, U[0], { action: 'saveXI', code: C, ...xi, lock: false }, clock as never), 'xi-locked');
  });

  it('runs a whole tournament through the room reducers', () => {
    const { room, clock } = started(4);
    act(room, HOST, { action: 'completeAuction', code: C }, clock);
    expectGameError(() => act(room, U[0], { action: 'startTournament', code: C }, clock), 'forbidden');
    act(room, HOST, { action: 'startTournament', code: C }, clock);
    expect(Object.values(room.teams).every((t) => t.xi?.locked)).toBe(true);
    let guard = 0;
    const played = new Set<string>();
    while (room.meta.status === 'tournament' && guard++ < 50) {
      const f = nextPlayable(room.tournament)!;
      const { summary, result } = runFixture(room, f.id);
      // Same seed for the same fixture & XIs → a concurrent duplicate simulation is identical.
      expect(runFixture(room, f.id).result).toEqual(result);
      recordFixture(room, { uid: HOST, now: clock.t, rng: seededRng(1) }, f.id, summary, newEvents());
      expectGameError(() => recordFixture(room, { uid: HOST, now: clock.t, rng: seededRng(1) }, f.id, summary, newEvents()), 'already-played');
      played.add(f.id);
    }
    expect(room.meta.status).toBe('completed');
    expect(played.size).toBe(6 + 4);
    const t = room.tournament!;
    expect(t.championId).toBe(t.fixtures.F.summary!.winnerId);
    const finalists = [t.fixtures.F.teamA, t.fixtures.F.teamB];
    expect(finalists).toContain(t.championId);
    expect(finalists).toContain(t.runnerUpId);
    const rows = computeStandings(t, Object.keys(room.teams));
    expect(rows.reduce((s, r) => s + r.played, 0)).toBe(12);
    expect(rows.reduce((s, r) => s + r.won, 0)).toBe(rows.reduce((s, r) => s + r.lost, 0));
  });

  it('chemistry rewards shared country and franchise history', () => {
    const a = findPlayer('P001')!, b = findPlayer('P020')!; // Kohli & Patidar: IND + RCB
    expect(chemistry([a, b])).toBe(2 + 5);
  });
});
