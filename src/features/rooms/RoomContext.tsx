import { createContext, useContext } from 'react';
import type { Member, Room, Team } from '@shared/types';

export interface RoomCtx {
  code: string;
  room: Room;
  uid: string;
  me: Member | null;
  myTeam: Team | null;
  isHost: boolean;
  isController: boolean;
  presence: Record<string, boolean>;
}

export const RoomContext = createContext<RoomCtx | null>(null);

export function useRoomCtx(): RoomCtx {
  const c = useContext(RoomContext);
  if (!c) throw new Error('useRoomCtx must be used inside a room route');
  return c;
}

export function roleLabel(ctx: Pick<RoomCtx, 'me'>): string {
  const m = ctx.me;
  if (!m) return 'Visitor';
  const parts: string[] = [];
  if (m.isHost) parts.push('Host');
  if (m.isAuctioneer) parts.push('Auctioneer');
  if (m.teamId) parts.push('Owner');
  return parts.length ? parts.join(' · ') : 'Spectator';
}
