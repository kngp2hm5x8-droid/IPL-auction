/** Validates shared/data/players.json. Exits non-zero on any problem. */
import { BASE_PLAYERS, validatePlayers } from '../shared/data/players';
import { TIERS } from '../shared/data/reference';

const errors = validatePlayers(BASE_PLAYERS);
const byTier = Object.fromEntries(TIERS.map((t) => [t, BASE_PLAYERS.filter((p) => p.tier === t).length]));
const byRole = Object.fromEntries(['BAT', 'WK', 'AR', 'BOWL'].map((r) => [r, BASE_PLAYERS.filter((p) => p.role === r).length]));
console.log(`Players: ${BASE_PLAYERS.length}  overseas: ${BASE_PLAYERS.filter((p) => p.overseas).length}`);
console.log('By tier:', byTier);
console.log('By role:', byRole);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log('✔ player database is valid');
