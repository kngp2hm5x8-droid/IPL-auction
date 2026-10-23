import { describe, expect, it } from 'vitest';
import { BASE_PLAYERS, simulateMatch, simulateInnings, oversFeasible, seededRng, toSimPlayer, type TeamSheet } from '../../shared/engine/index';
import type { InningsResult, Player } from '../../shared/types';

function sheet(id: string, players: Player[]): TeamSheet {
  const sims = players.map((p) => toSimPlayer(p, p.rating));
  return { teamId: id, name: id, short: id, players: sims, captainId: sims[0].id, wicketKeeperId: (players.find((p) => p.role === 'WK') ?? players[0]).id };
}

/** Balanced XI: 2 openers/top, 1 WK, 2 AR, 6th-11th bowlers. */
function xi(offset: number): Player[] {
  const by = (r: string) => BASE_PLAYERS.filter((p) => p.role === r);
  return [...by('BAT').slice(offset * 4, offset * 4 + 4), by('WK')[offset], ...by('AR').slice(offset * 2, offset * 2 + 2), ...by('BOWL').slice(offset * 4, offset * 4 + 4)];
}

function checkInnings(inn: InningsResult, maxOvers = 20, maxWkts = 10) {
  const legal = inn.balls.filter((b) => b.legal);
  expect(legal.length).toBe(inn.legalBalls);
  expect(inn.legalBalls).toBeLessThanOrEqual(maxOvers * 6);
  expect(inn.wickets).toBeLessThanOrEqual(maxWkts);
  // Runs reconcile: every run is attributed to the bat or to extras.
  const fromBalls = inn.balls.reduce((s, b) => s + b.runsBat + b.extras, 0);
  expect(fromBalls).toBe(inn.runs);
  const batRuns = inn.batting.reduce((s, b) => s + b.runs, 0);
  const ex = inn.extras.wides + inn.extras.noballs + inn.extras.legbyes + inn.extras.byes;
  expect(batRuns + ex).toBe(inn.runs);
  expect(inn.bowling.reduce((s, b) => s + b.runs, 0)).toBe(inn.runs - inn.extras.legbyes - inn.extras.byes);
  expect(inn.bowling.reduce((s, b) => s + b.balls, 0)).toBe(inn.legalBalls);
  expect(inn.batting.filter((b) => b.out).length).toBe(inn.wickets);
  // Six legal balls per over and max 4 overs per bowler (1 in a super over), never consecutive overs.
  const overs = new Map<number, string>();
  for (const b of inn.balls) {
    if (overs.has(b.over)) expect(overs.get(b.over)).toBe(b.bowlerId);
    overs.set(b.over, b.bowlerId);
  }
  for (const o of overs.keys()) {
    const n = legal.filter((b) => b.over === o).length;
    if (o < Math.floor(inn.legalBalls / 6)) expect(n).toBe(6);
    if (overs.has(o + 1)) expect(overs.get(o + 1)).not.toBe(overs.get(o));
  }
  for (const bw of inn.bowling) expect(bw.balls).toBeLessThanOrEqual(maxOvers === 1 ? 6 : 24);
  // The running score in the ball log is consistent.
  const last = inn.balls.at(-1);
  if (last) { expect(last.totalRuns).toBe(inn.runs); expect(last.totalWickets).toBe(inn.wickets); }
  // A batter dismissed never faces again.
  const outAt = new Map<string, number>();
  inn.balls.forEach((b, i) => {
    expect(outAt.has(b.batterId)).toBe(false);
    expect(outAt.has(b.nonStrikerId)).toBe(false);
    if (b.wicket) outAt.set(b.wicket.playerOutId, i);
  });
  // A chase stops as soon as the target is reached.
  if (inn.target != null && inn.runs >= inn.target) {
    expect(inn.balls.at(-2)!.totalRuns).toBeLessThan(inn.target);
  }
}

describe('match engine', () => {
  const A = sheet('AAA', xi(0));
  const B = sheet('BBB', xi(1));

  it('is deterministic for a seed', () => {
    const r1 = simulateMatch(A, B, { matchId: 'm', seed: 42, superOverOnTie: false });
    const r2 = simulateMatch(A, B, { matchId: 'm', seed: 42, superOverOnTie: false });
    expect(r2).toEqual(r1);
    const r3 = simulateMatch(A, B, { matchId: 'm', seed: 43, superOverOnTie: false });
    expect(r3.innings[0].balls).not.toEqual(r1.innings[0].balls);
  });

  it('produces internally consistent scorecards over many matches', () => {
    for (let s = 1; s <= 120; s++) {
      const r = simulateMatch(A, B, { matchId: 'm', seed: s, superOverOnTie: true });
      checkInnings(r.innings[0]);
      checkInnings(r.innings[1]);
      for (const [x, y] of r.superOvers) { checkInnings(x, 1, 2); checkInnings(y, 1, 2); }
      expect(r.innings[1].target).toBe(r.innings[0].runs + 1);
      const [i1, i2] = r.innings;
      if (i2.runs > i1.runs) expect(r.winnerId).toBe(i2.battingTeamId);
      else if (i1.runs > i2.runs) expect(r.winnerId).toBe(i1.battingTeamId);
      else expect(r.tiedInRegulation).toBe(true);
      expect(r.winnerId).not.toBeNull(); // super overs always decide
      // Batting first innings ends only by overs or all out
      expect(i1.legalBalls === 120 || i1.allOut).toBe(true);
    }
  });

  it('produces plausible T20 totals (fictional calibration)', () => {
    const totals: number[] = [];
    const wkts: number[] = [];
    for (let s = 1; s <= 400; s++) {
      const inn = simulateInnings(A, B, { target: null, maxOvers: 20, maxWickets: 10, pitch: 'Balanced', rng: seededRng(s), battingCaptainId: A.captainId, keeperId: B.wicketKeeperId });
      totals.push(inn.runs); wkts.push(inn.wickets);
    }
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const meanW = wkts.reduce((a, b) => a + b, 0) / wkts.length;
    expect(mean).toBeGreaterThan(145);
    expect(mean).toBeLessThan(205);
    expect(meanW).toBeGreaterThan(4.5);
    expect(meanW).toBeLessThan(8.5);
    expect(Math.min(...totals)).toBeLessThan(mean - 30); // real variance
    expect(Math.max(...totals)).toBeGreaterThan(mean + 30);
  });

  it('rewards stronger teams without making results deterministic', () => {
    const strong = sheet('STR', [...BASE_PLAYERS].sort((a, b) => b.rating - a.rating).filter((p, i, arr) => arr.indexOf(p) === i).slice(0, 11));
    const weakPlayers = [...BASE_PLAYERS].sort((a, b) => a.rating - b.rating).slice(0, 11);
    const weak = sheet('WEK', weakPlayers);
    let wins = 0;
    for (let s = 1; s <= 300; s++) if (simulateMatch(strong, weak, { matchId: 'm', seed: s, superOverOnTie: true }).winnerId === 'STR') wins++;
    expect(wins / 300).toBeGreaterThan(0.6);
    expect(wins / 300).toBeLessThan(0.98);
  });

  it('league ties stand when super overs are disabled', () => {
    let found = false;
    for (let s = 1; s < 3000 && !found; s++) {
      const r = simulateMatch(A, B, { matchId: 'm', seed: s, superOverOnTie: false });
      if (r.tiedInRegulation) { found = true; expect(r.winnerId).toBeNull(); expect(r.margin).toBe('Match tied'); }
    }
    expect(found).toBe(true);
  });

  it('over-allocation feasibility check', () => {
    // 5 bowlers × 4 overs can always cover 20 overs
    expect(oversFeasible(new Map([['a', 4], ['b', 4], ['c', 4], ['d', 4], ['e', 4]]), null, 20)).toBe(true);
    // one bowler with 2 overs left cannot bowl the last 2 overs back-to-back
    expect(oversFeasible(new Map([['a', 2]]), null, 2)).toBe(false);
    expect(oversFeasible(new Map([['a', 1], ['b', 1]]), 'a', 2)).toBe(true);
    expect(oversFeasible(new Map([['a', 4], ['b', 0]]), null, 3)).toBe(false);
  });
});
