/**
 * One-off migration: extracts PLAYERS_DB from the v2 single-file app and writes the
 * normalized player database to shared/data/players.json.
 *
 *   npm run migrate:players -- path/to/v2.html
 *
 * The v2 file is no longer in the working tree; recover it from git history with
 *   git show 888515b:IPL_auctionfull2.0.html > v2.html
 *
 * Normalization performed:
 *  - numeric ids → stable string ids ("P001")
 *  - emoji tier labels ("💎 Diamond") → tier keys ("diamond")
 *  - country codes → canonical 3-letter codes (SA→RSA, WI→WIN, NZ→NZL, SL→SRI)
 *  - duplicate players (same normalized name) merged, keeping the first record
 *  - previousTeams de-duplicated keeping chronological order of most recent stint;
 *    lastTeam = the final entry of the original list
 *  - battingSlot / bowlingType: FICTIONAL gameplay classifications from the maps below
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { normalizeCountry, TIER_BASE_PRICE } from '../shared/data/reference';
import type { Player, Tier, BattingSlot, BowlingType, Role } from '../shared/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('Usage: npm run migrate:players -- path/to/v2.html  (see header comment)');
  process.exit(1);
}
const html = readFileSync(source, 'utf8');

const start = html.indexOf('const PLAYERS_DB = [');
const end = html.indexOf('];', start);
if (start < 0 || end < 0) throw new Error('PLAYERS_DB not found in ' + source);
const literal = html.slice(start + 'const PLAYERS_DB = '.length, end + 1);
type Legacy = { id: number; name: string; role: Role; tier: string; rating: number; country: string; previousTeams: string[] };
const legacy = vm.runInNewContext('(' + literal + ')') as Legacy[];

const TIER_MAP: Record<string, Tier> = {
  '💎 Diamond': 'diamond',
  '🪙 Platinum': 'platinum',
  '🥇 Gold': 'gold',
  '🥈 Silver': 'silver',
  '🥉 Bronze': 'bronze',
};

/** Gameplay archetypes (fictional) used to build sensible batting orders. */
const OPENERS = new Set([
  'Virat Kohli', 'Rohit Sharma', 'Shubman Gill', 'Yashasvi Jaiswal', 'Ruturaj Gaikwad', 'Ishan Kishan',
  'Abhishek Sharma', 'Sai Sudharsan', 'Prabhsimran Singh', 'Travis Head', 'Jake Fraser-McGurk', 'Jos Buttler',
  'Phil Salt', 'Jonny Bairstow', 'Quinton de Kock', 'Rahmanullah Gurbaz', 'Devon Conway', 'Ben Duckett',
  'Faf du Plessis', 'KL Rahul', 'Prithvi Shaw', 'Paul Stirling', 'Kyle Mayers', 'Ryan Rickelton', 'Josh Inglis',
  'Rachin Ravindra', 'Sunil Narine', 'Devdutt Padikkal', 'Shai Hope', 'Kusal Mendis', 'Matthew Short',
]);
const FINISHERS = new Set([
  'Rinku Singh', 'Tim David', 'David Miller', 'Andre Russell', 'Shimron Hetmyer', 'Rovman Powell',
  'Shashank Singh', 'Ashutosh Sharma', 'MS Dhoni', 'Rahul Tewatia', 'Shahrukh Khan', 'Abdul Samad',
  'Sherfane Rutherford', 'Tristan Stubbs', 'Heinrich Klaasen', 'Dhruv Jurel', 'Jitesh Sharma', 'Hardik Pandya',
  'Romario Shepherd', 'Shivam Dube', 'Liam Livingstone', 'Glenn Maxwell', 'Marcus Stoinis', 'Nicholas Pooran',
  'Ramandeep Singh', 'Naman Dhir', 'Abhinav Manohar', 'Donovan Ferreira', 'Dasun Shanaka', 'Najibullah Zadran',
]);
/** Players whose bowling the simulation treats as spin; every other BOWL/AR is pace. */
const SPINNERS = new Set([
  'Kuldeep Yadav', 'Ravi Bishnoi', 'Yuzvendra Chahal', 'Ravichandran Ashwin', 'Suyash Sharma', 'Mayank Markande',
  'Adam Zampa', 'Rashid Khan', 'Noor Ahmad', 'Mujeeb Ur Rahman', 'Mohammad Nabi', 'Wanindu Hasaranga',
  'Maheesh Theekshana', 'Akeal Hosein', 'Sunil Narine', 'Mitchell Santner', 'Rachin Ravindra', 'Axar Patel',
  'Ravindra Jadeja', 'Washington Sundar', 'Krunal Pandya', 'Moeen Ali', 'Liam Livingstone', 'Adil Rashid',
  'Glenn Maxwell', 'Harpreet Brar', 'Mahedi Hasan', 'Sikandar Raza', 'Aiden Markram', 'Rahul Tewatia',
  'Deepak Hooda', 'Will Jacks', 'Matthew Short', 'Naman Dhir',
]);

function battingSlot(name: string, role: Role): BattingSlot {
  if (OPENERS.has(name)) return 'opener';
  if (FINISHERS.has(name)) return 'finisher';
  if (role === 'BOWL') return 'tail';
  if (role === 'AR') return 'middle';
  return 'top';
}

function bowlingType(name: string, role: Role): BowlingType | null {
  if (role === 'BAT' || role === 'WK') return null;
  return SPINNERS.has(name) ? 'spin' : 'pace';
}

function dedupeTeams(list: string[]): string[] {
  // keep the most recent appearance of each franchise, preserving chronology
  const out: string[] = [];
  for (let i = list.length - 1; i >= 0; i--) if (!out.includes(list[i])) out.unshift(list[i]);
  return out;
}

const seen = new Map<string, number>();
const merged: string[] = [];
const players: Player[] = [];
for (const p of legacy) {
  const key = p.name.trim().toLowerCase();
  if (seen.has(key)) {
    merged.push(`${p.name} (v2 id ${p.id} merged into v2 id ${seen.get(key)})`);
    continue;
  }
  seen.set(key, p.id);
  const tier = TIER_MAP[p.tier];
  if (!tier) throw new Error(`Unknown tier "${p.tier}" for ${p.name}`);
  const country = normalizeCountry(p.country);
  if (!country) throw new Error(`Unknown country "${p.country}" for ${p.name}`);
  const prev = p.previousTeams ?? [];
  players.push({
    id: 'P' + String(p.id).padStart(3, '0'),
    name: p.name.trim(),
    country,
    role: p.role,
    battingSlot: battingSlot(p.name, p.role),
    bowlingType: bowlingType(p.name, p.role),
    tier,
    rating: p.rating,
    basePrice: TIER_BASE_PRICE[tier],
    previousTeams: dedupeTeams(prev),
    lastTeam: prev.length ? prev[prev.length - 1] : null,
    overseas: country !== 'IND',
  });
}

const out = resolve(root, 'shared/data/players.json');
writeFileSync(
  out,
  JSON.stringify(
    {
      source: 'Migrated from IPL Auction Simulator v2 PLAYERS_DB',
      note: 'rating, battingSlot and bowlingType are FICTIONAL gameplay parameters, not official statistics.',
      players,
    },
    null,
    1,
  ) + '\n',
);
console.log(`Wrote ${players.length} players to ${out}`);
if (merged.length) console.log('Merged duplicates:\n  ' + merged.join('\n  '));
