import type { Player, PlayingXI, Room, RoomSettings, Team, BattingSlot } from '../types';
import { findPlayer } from '../data/players';
import { assert } from './core';
import { requireOwnTeam } from './room';
import type { Ctx } from './auction';

export interface XIValidation {
  ok: boolean;
  errors: string[];
  counts: { players: number; overseas: number; keepers: number; bowlingOptions: number };
}

export type XIRules = Pick<RoomSettings, 'maxOverseasXI' | 'minBowlingOptionsXI'>;

export const isBowlingOption = (p: Player) => p.role === 'BOWL' || p.role === 'AR';

/** Single source of truth for Playing XI validity (used by the UI and the server). */
export function validateXI(
  squadIds: string[], xi: { playerIds: string[]; captainId: string; wicketKeeperId: string },
  rules: XIRules, custom?: Record<string, Player>,
): XIValidation {
  const errors: string[] = [];
  const ids = xi.playerIds ?? [];
  const players = ids.map((id) => findPlayer(id, custom));
  const valid = players.filter((p): p is Player => !!p);
  const counts = {
    players: ids.length,
    overseas: valid.filter((p) => p.overseas).length,
    keepers: valid.filter((p) => p.role === 'WK').length,
    bowlingOptions: valid.filter(isBowlingOption).length,
  };
  if (ids.length !== 11) errors.push(`Select exactly 11 players (currently ${ids.length}).`);
  if (new Set(ids).size !== ids.length) errors.push('A player is selected twice.');
  if (valid.length !== ids.length) errors.push('Unknown player in XI.');
  const squad = new Set(squadIds);
  if (ids.some((id) => !squad.has(id))) errors.push('Every XI player must belong to your squad.');
  if (counts.overseas > rules.maxOverseasXI) errors.push(`At most ${rules.maxOverseasXI} overseas players (currently ${counts.overseas}).`);
  if (counts.keepers < 1) errors.push('Include at least one wicket-keeper.');
  if (counts.bowlingOptions < rules.minBowlingOptionsXI) errors.push(`Include at least ${rules.minBowlingOptionsXI} bowling options — bowlers or all-rounders (currently ${counts.bowlingOptions}).`);
  if (!xi.captainId || !ids.includes(xi.captainId)) errors.push('Choose a captain from the XI.');
  const wk = findPlayer(xi.wicketKeeperId, custom);
  if (!xi.wicketKeeperId || !ids.includes(xi.wicketKeeperId) || wk?.role !== 'WK') errors.push('Designate a wicket-keeper (a WK in the XI).');
  return { ok: errors.length === 0, errors, counts };
}

/** Simulation rating = fictional base rating + card adjustments, clamped. */
export function effectiveRating(room: Room, team: Team, playerId: string): number {
  const p = findPlayer(playerId, room.customPlayers);
  const adj = team.squad[playerId]?.ratingAdj ?? 0;
  return Math.max(30, Math.min(99, (p?.rating ?? 60) + adj));
}

const SLOT_ORDER: Record<BattingSlot, number> = { opener: 0, top: 1, middle: 2, finisher: 3, tail: 4 };

/** Sorts XI players into a sensible batting order using the gameplay archetypes. */
export function battingOrder(players: Player[], ratings: Record<string, number>): Player[] {
  return [...players].sort((a, b) => {
    const s = SLOT_ORDER[a.battingSlot] - SLOT_ORDER[b.battingSlot];
    if (s !== 0) return s;
    if (a.battingSlot === 'tail') return (a.rating >= b.rating ? 1 : -1); // weaker tail-enders bat last
    return (ratings[b.id] ?? b.rating) - (ratings[a.id] ?? a.rating);
  });
}

/**
 * Deterministic best-XI picker used for teams that have not saved a selection.
 * Greedy by rating while satisfying keeper, bowling and overseas constraints.
 */
export function autoPickXI(room: Room, team: Team): PlayingXI | null {
  const rules = room.settings;
  const squad = Object.keys(team.squad)
    .map((id) => findPlayer(id, room.customPlayers))
    .filter((p): p is Player => !!p);
  if (squad.length < 11) return null;
  const ratings = Object.fromEntries(squad.map((p) => [p.id, effectiveRating(room, team, p.id)]));
  const byRating = [...squad].sort((a, b) => ratings[b.id] - ratings[a.id] || a.id.localeCompare(b.id));
  const chosen: Player[] = [];
  let overseas = 0;
  const add = (p: Player) => { chosen.push(p); if (p.overseas) overseas++; };
  const canAdd = (p: Player) => !chosen.includes(p) && (!p.overseas || overseas < rules.maxOverseasXI);

  const keeper = byRating.find((p) => p.role === 'WK' && canAdd(p)) ?? byRating.find((p) => p.role === 'WK');
  if (keeper) add(keeper);
  for (const p of byRating) {
    if (chosen.filter(isBowlingOption).length >= rules.minBowlingOptionsXI) break;
    if (isBowlingOption(p) && canAdd(p)) add(p);
  }
  for (const p of byRating) {
    if (chosen.length >= 11) break;
    if (canAdd(p)) add(p);
  }
  // If overseas limits left us short, fill with anyone remaining (validation will report it).
  for (const p of byRating) {
    if (chosen.length >= 11) break;
    if (!chosen.includes(p)) add(p);
  }
  const ordered = battingOrder(chosen.slice(0, 11), ratings);
  const captain = [...ordered].sort((a, b) => ratings[b.id] - ratings[a.id])[0];
  const wk = ordered.find((p) => p.role === 'WK') ?? ordered[0];
  return { playerIds: ordered.map((p) => p.id), captainId: captain.id, wicketKeeperId: wk.id, locked: false, savedAt: 0 };
}

export function saveXI(
  room: Room, ctx: Ctx,
  args: { playerIds: string[]; captainId: string; wicketKeeperId: string; lock: boolean },
): void {
  assert(room.meta.status === 'squads' || room.meta.status === 'tournament', 'bad-state', 'Playing XIs are chosen after the auction.');
  const team = requireOwnTeam(room, ctx.uid);
  assert(!team.xi?.locked, 'xi-locked', 'Your Playing XI is locked.');
  const ids = Array.isArray(args.playerIds) ? args.playerIds.map(String) : [];
  const v = validateXI(Object.keys(team.squad), { playerIds: ids, captainId: String(args.captainId ?? ''), wicketKeeperId: String(args.wicketKeeperId ?? '') }, room.settings, room.customPlayers);
  assert(v.ok, 'invalid-xi', v.errors.join(' '));
  team.xi = { playerIds: ids, captainId: args.captainId, wicketKeeperId: args.wicketKeeperId, locked: !!args.lock, savedAt: ctx.now };
}

/* ───────────── Team chemistry (v2 formula, fixed field names) ───────────── */

/** +2 per same-country pair, +5 per franchise two players have both represented. */
export function chemistry(players: Player[]): number {
  let score = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (a.country === b.country) score += 2;
      score += a.previousTeams.filter((t) => b.previousTeams.includes(t)).length * 5;
    }
  }
  return score;
}

export function chemistryLabel(score: number): string {
  if (score >= 80) return 'Elite';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Good';
  if (score >= 10) return 'Average';
  return 'Building';
}

export function squadComposition(room: Room, team: Team) {
  const players = Object.keys(team.squad).map((id) => findPlayer(id, room.customPlayers)).filter((p): p is Player => !!p);
  return {
    total: players.length,
    overseas: players.filter((p) => p.overseas).length,
    BAT: players.filter((p) => p.role === 'BAT').length,
    WK: players.filter((p) => p.role === 'WK').length,
    AR: players.filter((p) => p.role === 'AR').length,
    BOWL: players.filter((p) => p.role === 'BOWL').length,
    spent: Object.values(team.squad).reduce((s, e) => s + e.price, 0),
    chemistry: chemistry(players),
  };
}
