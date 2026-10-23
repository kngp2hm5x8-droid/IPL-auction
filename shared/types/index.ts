/**
 * Shared domain types for IPL Auction Simulator 3.0.
 *
 * MONEY: every monetary amount in this codebase is an integer number of
 * LAKHS (1 Cr = 100 lakhs). There are no floating-point currency values.
 */

export type Lakhs = number;

export type Role = 'BAT' | 'BOWL' | 'AR' | 'WK';
export type Tier = 'diamond' | 'platinum' | 'gold' | 'silver' | 'bronze';
export type BowlingType = 'pace' | 'spin';
/** Fictional gameplay archetype used only to order batting line-ups. */
export type BattingSlot = 'opener' | 'top' | 'middle' | 'finisher' | 'tail';
export type FranchiseId =
  | 'CSK' | 'MI' | 'RCB' | 'KKR' | 'SRH' | 'RR' | 'DC' | 'PBKS' | 'LSG' | 'GT';

export interface Player {
  /** Stable unique id, e.g. "P001" for seeded players, "C-xxxx" for custom players. */
  id: string;
  name: string;
  /** Three-letter country code from shared/data/countries.ts */
  country: string;
  role: Role;
  battingSlot: BattingSlot;
  /** null for specialist batters / keepers who do not bowl in the simulation. */
  bowlingType: BowlingType | null;
  tier: Tier;
  /** FICTIONAL gameplay rating 40–99. Not an official statistic. */
  rating: number;
  basePrice: Lakhs;
  /** Franchises the player has represented, most recent last (factual, as supplied in v2 data). */
  previousTeams: string[];
  /** Most recent franchise; drives RTM eligibility. */
  lastTeam: string | null;
  overseas: boolean;
  custom?: boolean;
  image?: string;
  /** Optional real-world statistics. Empty for all seeded players – we do not invent statistics. */
  stats?: Record<string, number>;
}

/* ───────────────────────────── Rooms ───────────────────────────── */

export type AuctionType = 'mega' | 'mini';
export type RoomStatus = 'lobby' | 'auction' | 'squads' | 'tournament' | 'completed';

export interface RoomSettings {
  auctionType: AuctionType;
  teamCount: number;
  purse: Lakhs;
  minSquad: number;
  maxSquad: number;
  maxOverseasSquad: number;
  maxOverseasXI: number;
  minBowlingOptionsXI: number;
  features: { rtm: boolean; powerCards: boolean };
  rtmCardsPerTeam: number;
  bidTimerSec: number;
  highBidTimerSec: number;
  highBidThreshold: Lakhs;
  rtmWindowSec: number;
  leagueRounds: 1 | 2;
  cardCost: Lakhs;
  maxCardsHeld: number;
}

export interface Member {
  uid: string;
  name: string;
  joinedAt: number;
  isHost: boolean;
  isAuctioneer: boolean;
  teamId: string | null;
  ready: boolean;
}

export interface SquadEntry {
  playerId: string;
  price: Lakhs;
  viaRtm: boolean;
  /** Gameplay rating adjustment from power cards (form surge / scout error / injury). */
  ratingAdj: number;
  boughtAt: number;
  supplementary?: boolean;
}

export type CardType =
  | 'sniper' | 'freeze' | 'hidden_purse' | 'form_surge' | 'injury' | 'sponsorship'
  | 'interest' | 'shield' | 'time_warp' | 'cashback'
  | 'tax_audit' | 'self_freeze' | 'scout_error' | 'purse_leak';

export interface HeldCard {
  id: string;
  type: CardType;
  status: 'held' | 'used';
  acquiredAt: number;
  usedAt?: number;
}

export interface TeamEffects {
  shield: number;
  hiddenPurse: number;
  purseLeak: number;
  formSurge: boolean;
  scoutError: boolean;
  cashback: boolean;
}

export interface PlayingXI {
  /** Batting order. */
  playerIds: string[];
  captainId: string;
  wicketKeeperId: string;
  locked: boolean;
  savedAt: number;
}

export interface Team {
  id: FranchiseId;
  name: string;
  short: string;
  color: string;
  ownerUid: string | null;
  ownerName: string | null;
  purse: Lakhs;
  rtmCards: number;
  squad: Record<string, SquadEntry>;
  effects: TeamEffects;
  cards: Record<string, HeldCard>;
  /** requestId → cardId, for idempotent purchases. */
  cardPurchases: Record<string, string>;
  xi: PlayingXI | null;
}

export interface BidEntry {
  teamId: string;
  amount: Lakhs;
  at: number;
  requestId: string;
  viaCard?: CardType;
}

export interface Lot {
  seq: number;
  playerId: string;
  basePrice: Lakhs;
  bid: Lakhs | null;
  leader: string | null;
  bids: BidEntry[];
  opensAt: number;
  deadline: number;
  status: 'bidding' | 'rtm';
  rtm: { teamId: string; deadline: number } | null;
}

export interface LotResult {
  seq: number;
  playerId: string;
  outcome: 'sold' | 'unsold';
  teamId: string | null;
  price: Lakhs | null;
  viaRtm: boolean;
  at: number;
}

export interface AuctionState {
  status: 'running' | 'paused' | 'round_end' | 'completed';
  queue: string[];
  cursor: number;
  round: number;
  lot: Lot | null;
  /** Remaining ms on the lot clock when the auction was paused. */
  pausedRemainingMs: number | null;
  unsold: string[];
  /** playerId → teamId; the single source of truth that a player has been sold. */
  sold: Record<string, string>;
  lastResult: LotResult | null;
  /** teamId → epoch ms until which the team cannot bid. */
  frozenUntil: Record<string, number>;
  lotSeq: number;
}

export interface RoomMeta {
  code: string;
  createdAt: number;
  hostUid: string;
  status: RoomStatus;
  updatedAt: number;
}

export interface Room {
  meta: RoomMeta;
  settings: RoomSettings;
  members: Record<string, Member>;
  teams: Record<string, Team>;
  customPlayers: Record<string, Player>;
  auction: AuctionState | null;
  tournament: TournamentState | null;
}

/* ───────────────────────────── Matches ───────────────────────────── */

export type Dismissal = 'bowled' | 'caught' | 'lbw' | 'run out' | 'stumped';
export type ExtraKind = 'wide' | 'noball' | 'legbye' | 'bye';

export interface Ball {
  /** Over index 0–19. */
  over: number;
  /** Legal ball number within the over after this delivery (1–6), unchanged on wides / no-balls. */
  ballInOver: number;
  batterId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsBat: number;
  extras: number;
  extraKind: ExtraKind | null;
  wicket: { kind: Dismissal; playerOutId: string; fielderId?: string } | null;
  legal: boolean;
  freeHit: boolean;
  totalRuns: number;
  totalWickets: number;
  commentary: string;
}

export interface BattingCard {
  playerId: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  dismissal: string | null;
}

export interface BowlingCard {
  playerId: string;
  balls: number;
  runs: number;
  wickets: number;
  dots: number;
  wides: number;
  noballs: number;
}

export interface InningsResult {
  battingTeamId: string;
  bowlingTeamId: string;
  runs: number;
  wickets: number;
  legalBalls: number;
  allOut: boolean;
  extras: { wides: number; noballs: number; legbyes: number; byes: number };
  batting: BattingCard[];
  bowling: BowlingCard[];
  balls: Ball[];
  target: number | null;
}

export interface MatchResult {
  matchId: string;
  seed: number;
  pitch: string;
  toss: { winnerId: string; decision: 'bat' | 'bowl' };
  innings: [InningsResult, InningsResult];
  superOvers: [InningsResult, InningsResult][];
  winnerId: string | null;
  /** True when the scores finished level after 20 overs each (before any super over). */
  tiedInRegulation: boolean;
  margin: string;
  playerOfMatchId: string | null;
}

/* ───────────────────────────── Tournament ───────────────────────────── */

export type FixtureStage = 'league' | 'qualifier1' | 'eliminator' | 'qualifier2' | 'final';

export interface FixtureSummary {
  winnerId: string | null;
  tie: boolean;
  teamA: { runs: number; wickets: number; balls: number; allOut: boolean };
  teamB: { runs: number; wickets: number; balls: number; allOut: boolean };
  margin: string;
  decidedBySuperOver: boolean;
  playerOfMatchId: string | null;
}

export interface Fixture {
  id: string;
  number: number;
  stage: FixtureStage;
  /** Team ids, or null while a playoff slot is still to be decided. */
  teamA: string | null;
  teamB: string | null;
  status: 'scheduled' | 'completed';
  /** teamA bats first if they won the toss and chose to bat, etc. — detail lives in MatchResult. */
  summary: FixtureSummary | null;
  completedAt?: number;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  runsFor: number;
  ballsFaced: number;
  runsAgainst: number;
  ballsBowled: number;
  nrr: number;
}

export interface TournamentState {
  status: 'league' | 'playoffs' | 'completed';
  fixtures: Record<string, Fixture>;
  championId: string | null;
  runnerUpId: string | null;
  createdAt: number;
}

/* ───────────────────────────── API ───────────────────────────── */

export type ApiAction =
  | { action: 'createRoom'; name: string; settings?: Partial<RoomSettings>; asAuctioneer?: boolean }
  | { action: 'joinRoom'; code: string; name: string }
  | { action: 'claimTeam'; code: string; teamId: string }
  | { action: 'releaseTeam'; code: string }
  | { action: 'setReady'; code: string; ready: boolean }
  | { action: 'updateSettings'; code: string; settings: Partial<RoomSettings> }
  | { action: 'setAuctioneer'; code: string; uid: string | null }
  | { action: 'addCustomPlayer'; code: string; player: CustomPlayerInput }
  | { action: 'removeCustomPlayer'; code: string; playerId: string }
  | { action: 'startAuction'; code: string }
  | { action: 'placeBid'; code: string; lotSeq: number; amount: Lakhs; requestId: string }
  | { action: 'hammer'; code: string; lotSeq: number; sold: boolean }
  | { action: 'tick'; code: string }
  | { action: 'rtmDecision'; code: string; lotSeq: number; accept: boolean }
  | { action: 'undoBid'; code: string; lotSeq: number }
  | { action: 'pause'; code: string; paused: boolean }
  | { action: 'relistUnsold'; code: string }
  | { action: 'completeAuction'; code: string }
  | { action: 'buyCard'; code: string; requestId: string }
  | { action: 'useCard'; code: string; cardId: string; targetTeamId?: string; lotSeq?: number }
  | { action: 'saveXI'; code: string; playerIds: string[]; captainId: string; wicketKeeperId: string; lock: boolean }
  | { action: 'startTournament'; code: string }
  | { action: 'simulateMatch'; code: string; fixtureId: string }
  | { action: 'simulateAll'; code: string; stage: 'league' | 'all' };

export interface CustomPlayerInput {
  name: string;
  country: string;
  role: Role;
  tier: Tier;
  bowlingType: BowlingType | null;
  rating?: number;
  previousTeams?: string[];
}

export interface ApiResult {
  ok: boolean;
  code?: string;
  duplicate?: boolean;
  message?: string;
  data?: Record<string, unknown>;
}
