/** Prints calibration statistics for the (fictional) match engine: npx tsx scripts/sim-stats.ts [matches] */
import { BASE_PLAYERS, simulateMatch, toSimPlayer, type TeamSheet } from '../shared/engine/index';

const by = (r: string) => BASE_PLAYERS.filter((p) => p.role === r);
const sheet = (o: number, id: string): TeamSheet => {
  const ps = [...by('BAT').slice(o * 4, o * 4 + 4), by('WK')[o], ...by('AR').slice(o * 2, o * 2 + 2), ...by('BOWL').slice(o * 4, o * 4 + 4)]
    .map((p) => toSimPlayer(p, p.rating));
  return { teamId: id, name: id, short: id, players: ps, captainId: ps[0].id, wicketKeeperId: ps[4].id };
};
const A = sheet(2, 'A'), B = sheet(3, 'B');
const n = Number(process.argv[2] ?? 1000);
let r1 = 0, w1 = 0, r2 = 0, extras = 0, sixes = 0, fours = 0, chase = 0, ties = 0;
for (let s = 1; s <= n; s++) {
  const r = simulateMatch(A, B, { matchId: 'x', seed: s, superOverOnTie: false });
  const [i1, i2] = r.innings;
  r1 += i1.runs; w1 += i1.wickets; r2 += i2.runs;
  extras += i1.extras.wides + i1.extras.noballs + i1.extras.legbyes + i1.extras.byes;
  sixes += i1.batting.reduce((a, b) => a + b.sixes, 0);
  fours += i1.batting.reduce((a, b) => a + b.fours, 0);
  if (r.winnerId === i2.battingTeamId) chase++;
  if (r.tiedInRegulation) ties++;
}
const f = (x: number) => (x / n).toFixed(1);
console.log(`matches=${n}  1st-inns avg ${f(r1)}/${f(w1)}  2nd-inns avg ${f(r2)}  extras ${f(extras)}  4s ${f(fours)}  6s ${f(sixes)}  chasing wins ${(chase / n * 100).toFixed(0)}%  ties ${ties}`);
