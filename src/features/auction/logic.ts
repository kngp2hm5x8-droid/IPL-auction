import type { Lot, Room, Team } from '@shared/types';
import { formatLakhs, nextBidAmount } from '@shared/engine/core';
import { maxBidFor } from '@shared/engine/auction';
import { overseasInSquad, playerOf } from '@shared/engine/room';

/** Total timer length for the current state of a lot (for the countdown ring). */
export function lotTimerMs(room: Room, lot: Lot): number {
  const s = room.settings;
  if (lot.status === 'rtm') return s.rtmWindowSec * 1000;
  return 1000 * (lot.bid != null && lot.bid >= s.highBidThreshold ? s.highBidTimerSec : s.bidTimerSec);
}

export function lotDeadline(lot: Lot): number {
  return lot.status === 'rtm' && lot.rtm ? lot.rtm.deadline : lot.deadline;
}

/**
 * Mirrors the server's bid validation so the UI can explain why bidding is unavailable.
 * The server remains the authority; this is only for feedback.
 */
export function bidBlocker(room: Room, team: Team, lot: Lot, now: number): string | null {
  const a = room.auction!;
  if (a.status === 'paused') return 'Auction paused';
  if (lot.status === 'rtm') return 'RTM decision pending';
  if (now < lot.opensAt) return 'Bidding opens shortly';
  if (now >= lot.deadline) return 'Time is up';
  if (lot.leader === team.id) return 'You hold the highest bid';
  if ((a.frozenUntil[team.id] ?? 0) > now) return 'Frozen by a power card';
  const p = playerOf(room, lot.playerId);
  if (Object.keys(team.squad).length >= room.settings.maxSquad) return 'Squad is full';
  if (p.overseas && overseasInSquad(room, team) >= room.settings.maxOverseasSquad) return 'Overseas limit reached';
  const next = nextBidAmount(lot.bid, lot.basePrice);
  const max = maxBidFor(room, team);
  if (next > max) return `Max you can bid is ${formatLakhs(max)}`;
  return null;
}

/** Purse as seen by `viewerTeamId`, honouring Hidden Purse / Purse Leak cards. */
export function visiblePurse(team: Team, viewerTeamId: string | null): number | null {
  if (team.id === viewerTeamId) return team.purse;
  if (team.effects.hiddenPurse > 0 && team.effects.purseLeak <= 0) return null;
  return team.purse;
}
