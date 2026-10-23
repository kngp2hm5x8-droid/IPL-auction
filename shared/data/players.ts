import type { Player } from '../types';
import { COUNTRIES, FRANCHISE_IDS, TIER_BASE_PRICE, TIERS } from './reference';
import db from './players.json';

export const BASE_PLAYERS: Player[] = (db as { players: Player[] }).players;

const BY_ID = new Map(BASE_PLAYERS.map((p) => [p.id, p]));

/** Look up a player from the seeded DB first, then the room's custom players. */
export function findPlayer(id: string, custom?: Record<string, Player> | null): Player | null {
  return BY_ID.get(id) ?? custom?.[id] ?? null;
}

export function allPlayers(custom?: Record<string, Player> | null): Player[] {
  return [...BASE_PLAYERS, ...Object.values(custom ?? {})];
}

/** Defunct franchises that may legitimately appear in playing history. */
const HISTORIC_TEAMS = ['GL', 'RPS', 'DCH', 'KTK', 'PWI'];

/** Returns a list of human-readable problems; empty means the data set is valid. */
export function validatePlayers(players: Player[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const p of players) {
    const tag = `${p.id} ${p.name}`;
    if (!p.id || ids.has(p.id)) errors.push(`${tag}: duplicate or missing id`);
    ids.add(p.id);
    const n = p.name.trim().toLowerCase();
    if (!n) errors.push(`${tag}: empty name`);
    if (names.has(n)) errors.push(`${tag}: duplicate name`);
    names.add(n);
    if (!COUNTRIES[p.country]) errors.push(`${tag}: non-canonical country "${p.country}"`);
    if (p.overseas !== (p.country !== 'IND')) errors.push(`${tag}: overseas flag disagrees with country`);
    if (!['BAT', 'BOWL', 'AR', 'WK'].includes(p.role)) errors.push(`${tag}: bad role ${p.role}`);
    if (!TIERS.includes(p.tier)) errors.push(`${tag}: bad tier ${p.tier}`);
    if (!p.custom && p.basePrice !== TIER_BASE_PRICE[p.tier]) errors.push(`${tag}: base price ≠ tier price`);
    if (!Number.isInteger(p.basePrice) || p.basePrice <= 0) errors.push(`${tag}: base price must be a positive integer (lakhs)`);
    if (!Number.isInteger(p.rating) || p.rating < 40 || p.rating > 99) errors.push(`${tag}: rating out of range`);
    if ((p.role === 'BOWL' || p.role === 'AR') && !p.bowlingType) errors.push(`${tag}: bowler without bowlingType`);
    if ((p.role === 'BAT' || p.role === 'WK') && p.bowlingType) errors.push(`${tag}: specialist batter has bowlingType`);
    for (const t of p.previousTeams) {
      if (!FRANCHISE_IDS.includes(t as never) && !HISTORIC_TEAMS.includes(t)) errors.push(`${tag}: unknown franchise ${t}`);
    }
    if (new Set(p.previousTeams).size !== p.previousTeams.length) errors.push(`${tag}: duplicate previousTeams`);
    if (p.lastTeam && !p.previousTeams.includes(p.lastTeam)) errors.push(`${tag}: lastTeam not in previousTeams`);
    if (p.stats && Object.keys(p.stats).length && !p.custom) errors.push(`${tag}: seeded stats present – stats must come from a cited source`);
  }
  return errors;
}
