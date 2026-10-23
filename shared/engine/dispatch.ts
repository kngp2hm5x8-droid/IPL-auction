import type { ApiAction, Room } from '../types';
import { fail } from './core';
import * as A from './auction';
import { buyCard, useCard } from './cards';
import { saveXI } from './squad';
import { startTournament } from './tournament';
import { getMember } from './room';

/** Actions that mutate a single room and can run inside one transaction on rooms/{code}. */
export type RoomAction = Exclude<ApiAction, { action: 'createRoom' } | { action: 'simulateMatch' } | { action: 'simulateAll' }>;

export function applyAction(room: Room, ctx: A.Ctx, act: RoomAction): A.Events {
  const ev = A.newEvents();
  // Everything except joining requires membership.
  if (act.action !== 'joinRoom' && act.action !== 'tick') getMember(room, ctx.uid);
  switch (act.action) {
    case 'joinRoom': A.joinRoom(room, ctx, act.name, ev); break;
    case 'claimTeam': A.claimTeam(room, ctx, String(act.teamId), ev); break;
    case 'releaseTeam': A.releaseTeam(room, ctx, ev); break;
    case 'setReady': A.setReady(room, ctx, !!act.ready); break;
    case 'updateSettings': A.updateSettings(room, ctx, act.settings ?? {}); break;
    case 'setAuctioneer': A.setAuctioneer(room, ctx, act.uid ?? null); break;
    case 'addCustomPlayer': ev.data = { player: A.addCustomPlayer(room, ctx, act.player, ev) }; break;
    case 'removeCustomPlayer': A.removeCustomPlayer(room, ctx, String(act.playerId)); break;
    case 'startAuction': A.startAuction(room, ctx, ev); break;
    case 'placeBid': A.placeBid(room, ctx, { lotSeq: Number(act.lotSeq), amount: Number(act.amount), requestId: String(act.requestId ?? '') }, ev); break;
    case 'hammer': A.hammer(room, ctx, Number(act.lotSeq), !!act.sold, ev); break;
    case 'tick': {
      // Anyone in the room may nudge the server clock; outsiders get a no-op.
      if (!room.members[ctx.uid] && ctx.uid !== 'system') { ev.noop = true; break; }
      A.tick(room, ctx, ev);
      break;
    }
    case 'rtmDecision': A.rtmDecision(room, ctx, Number(act.lotSeq), !!act.accept, ev); break;
    case 'undoBid': A.undoBid(room, ctx, Number(act.lotSeq), ev); break;
    case 'pause': A.setPaused(room, ctx, !!act.paused, ev); break;
    case 'relistUnsold': A.relistUnsold(room, ctx, ev); break;
    case 'completeAuction': A.completeAuction(room, ctx, ev); break;
    case 'buyCard': buyCard(room, ctx, String(act.requestId ?? ''), ev); break;
    case 'useCard': useCard(room, ctx, { cardId: String(act.cardId), targetTeamId: act.targetTeamId, lotSeq: act.lotSeq }, ev); break;
    case 'saveXI': saveXI(room, ctx, act); break;
    case 'startTournament': startTournament(room, ctx, ev); break;
    default: fail('bad-action', 'Unknown action.');
  }
  if (!ev.noop && !ev.duplicate) room.meta.updatedAt = ctx.now;
  return ev;
}
