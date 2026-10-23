# Audit report — IPL Auction Simulator 2.0

Source audited: `IPL_auctionfull2.0 (1).html` (5,865 lines; preserved unchanged as
commit `888515b` in this repository's history; recover it with
`git show 888515b:IPL_auctionfull2.0.html`). Line numbers below refer to that file.

Every finding was confirmed by reading the code; many were also reproduced while building
the replacement. **Severity:** Critical = corrupts money or game state, or is a security hole ·
High = core feature broken · Medium = wrong behaviour in some cases · Low = quality or UX.

The 3.0 rewrite fixes every item. The "Fix" column says where.

## 1. Security and architecture

| # | Sev | Finding | Root cause | Fix in 3.0 |
|---|-----|---------|-----------|-----------|
| S1 | Critical | **Any visitor can rewrite any room.** All writes (`set`/`update` on `rooms/…`) are made directly from the browser, e.g. purses at L5092–5097, squads at L5145, tournament results at L4030. | No authentication, no security rules, and no trusted backend. All game logic runs on the client. | Firebase Anonymous Auth plus a single Cloud Function (`api`) performs every mutation inside a transaction. `database.rules.json` denies **all** client writes to `rooms`, `roomLogs` and `roomMatches`. Rules are covered by tests (`tests/integration/rules.test.ts`). |
| S2 | Critical | **Identity is a random string per page load** (`uid: 'u_' + Math.random()…`, L4397). A refresh loses your franchise and role; anyone can impersonate any uid in writes. | No auth. | Firebase Auth uid, persisted by the SDK across refreshes. Membership and franchise ownership are stored server-side and checked on every action. |
| S3 | High | Firebase web config hard-coded in the page (L3588–3596). | No environment separation. | Config read from `VITE_FIREBASE_*` env vars (`.env.example`). No service-account credentials anywhere in client code. |
| S4 | Medium | Commentary uses `innerHTML` with team and player names (L3625; also lobby and dashboard templates). A host-defined custom player or team name can inject HTML. | String-built DOM. | React escapes everything. Names are sanitised and length-limited on the server (`sanitizeName`). |
| S5 | High | The auction **depends on the host's browser**: only the controller's tab finalises expired lots (`isCont || isBot || S.botMode`, L5053). If the host closes the tab, the auction freezes. Bot mode (`auctioneerId: 'bot'`) has no process behind it at all. | Client-side timer is authoritative. | Server-authoritative deadlines. Any member's client nudges `tick`, and the server finalises only when its own clock says the deadline has passed. A scheduled function (`sweepAuctions`, every minute) finalises overdue lots when nobody is connected. Tested with a "disconnected host" and with the sweeper. |
| S6 | Medium | The monolithic 5,865-line file mixes CSS, markup and five overlapping "engines" (L3613–4121 plus L4123–5865). | No module structure. | Split into `shared/engine` (pure, unit-tested), `functions/` (trusted backend) and `src/` (React feature folders). |

## 2. Money and auction integrity

| # | Sev | Finding | Root cause | Fix |
|---|-----|---------|-----------|-----|
| M1 | Critical | **Purse corruption on every bid.** `placeBid` charges the bidder and refunds the previous leader with two separate, non-transactional `update`s computed from a **stale local snapshot** (L5088–5097). Two near-simultaneous bids, or one failed write, permanently create or destroy money. | Read-modify-write outside the transaction; only `auction/current` was transactional (L5080). | **Charge-on-hammer model:** bids never touch purses. The purse is debited exactly once, inside the same transaction that marks the player sold. A money-conservation invariant (purses + spent = constant) is asserted over a full simulated auction (`auction.test.ts`). |
| M2 | Critical | Purses stored as **floating-point crores** (`parseFloat((…).toFixed(2))`) while bids are in lakhs, with conversions `* 100` / `/ 100` everywhere (L5075, L5092, L5137). | Mixed units. | All money is integer lakhs end to end (`shared/types` header, `isIntegerLakhs`). |
| M3 | High | `undoBid` refunds only one *increment* (L5236–5240), although under v2's model the bidder had been charged the *whole* bid. Every undo leaks money. | Wrong arithmetic. | Undo pops the bid stack and restores the previous leader and amount. No purse effect (charge-on-hammer). Tested. |
| M4 | High | Affordability is checked against the client's cached purse only (L5075). There is no squad-size, overseas-cap or reserve check. A team can spend its whole purse on one player and be unable to field a side. | No server validation. | Server checks max squad, overseas squad cap, and a **squad-completion reserve** (`maxBidFor`). |
| M5 | High | A player can be sold twice. `finalizePlayer` and `handleRTMDecision` can both run from timers on several tabs, and `moveToNextPlayer` is scheduled with `setTimeout` from each tab (L5161, L5198). `soldPlayerIds` is a local `Set` (L4335) that other clients never see. | No idempotency; side effects run outside transactions. | `auction.sold` map in the room transaction. `hammer`, `tick` and RTM decisions are keyed by `lotSeq` and are idempotent. Integration test races two hammers and a tick across three server instances. |
| M6 | Medium | Cashback refund and Form Surge / Scout Error flags are applied with separate writes before the sale is recorded (L5132–5140), so they can apply without a sale or twice. | Same as M1. | Applied inside `completeSale`, in the same transaction, then cleared. |
| M7 | Medium | Effect counters (shield, hidden purse, purse leak) are decremented with `forEach(async …)`, unawaited writes from stale data (L5151). | Same as M1. | `tickEffectCounters` inside the transaction. |
| M8 | Medium | Bid-conflict retry (`version` checks, L5081–5084) only covers `current`; purse writes still happen after a conflict was reported. | Partial transaction. | Single transaction over the whole room. |

## 3. Right to Match (RTM)

| # | Sev | Finding | Root cause | Fix |
|---|-----|---------|-----------|-----|
| R1 | High | **RTM never triggers.** `finalizePlayer` reads `player.previousTeams` (L5113), but `allPlayers()` renames that field to `iplTeams` (L4347). The RTM badge has the same bug (L4902). | Inconsistent player schema. | Normalised `previousTeams` plus explicit `lastTeam`. Unit tests cover eligibility. |
| R2 | High | Under v2's purse model the RTM path refunds the original winner and charges the RTM team with separate stale writes (L5176–5196), and it does not check the RTM team's purse, squad space or overseas cap. | As M1 and M4. | Eligibility (`rtmCandidate`) checks the feature flag, card count, affordability, squad size and overseas cap. Charge-on-hammer means the original winner is never charged, so there is nothing to refund. |
| R3 | Medium | RTM decision timeouts are resolved by whichever client's timer fires (L5056). | Client clock. | Server RTM deadline, resolved by `tick` or the sweeper. |
| R4 | Low | RTM only offered in mega auctions regardless of the room toggle (L5112). | Hard-coded. | Governed by `settings.features.rtm` and `rtmCardsPerTeam`. |

## 4. Power cards

| # | Sev | Finding | Root cause | Fix |
|---|-----|---------|-----------|-----|
| C1 | High | Cards are identified by **array index** (`removeCardFromInventory(index)`, L5534). Network retries or two clicks remove the wrong card or activate a card twice. | No card identity. | Every card has an id and a status. Using a `used` card is a no-op. Purchases are idempotent per `requestId`. |
| C2 | High | Sniper charges the purse directly (L5410–5417) and ignores transaction failure. | As M1. | Sniper goes through the normal `placeBid` validation. |
| C3 | Medium | "Bad luck" cards sit in the inventory waiting for the victim to click them voluntarily. | Design bug. | Bad cards trigger immediately when drawn from the mystery box. |
| C4 | Medium | Freeze and self-freeze rewrite the whole `activeEffects` array from local state, losing concurrent effects. Freeze checks use the client clock. | Stale array writes. | `frozenUntil` map per team, set and checked inside the transaction. |
| C5 | Low | Injury penalises a player who has not been bought yet (`teams/{leader}/players/{current}`, L5497). | Wrong target. | Injury targets an opponent's latest *signing* and is blocked by Shield. |

## 5. Rooms, roles and navigation

| # | Sev | Finding | Root cause | Fix |
|---|-----|---------|-----------|-----|
| N1 | High | **`checkAvailableTeams` throws `ReferenceError: teamList is not defined`** (L4573). `teamList` is only declared inside `joinRoom` (L4644). Availability never shows. | Undefined variable. | Live availability from a room subscription (`JoinForm`). |
| N2 | High | **Duplicate element IDs:** `toggle-rtm`, `toggle-cards`, `toggle-trade` exist twice (L2746–2752 and L2928–2943). `toggleFeature` updates whichever comes first, so the create page toggles do nothing visible. | Two copies of the create UI. | Single `SettingsForm` component. |
| N3 | High | **Role inconsistency:** the landing form uses `player` / `auctioneer` (L4458), the join page uses `owner` (L4543). `joinRoom` reads only the landing `<select>`, and `joinRole` is never used. Joining "as auctioneer" overwrites the room's auctioneer for anyone (L4521). | Two parallel join flows. | One join flow. Roles are host, auctioneer (host-assigned), owner (claim franchise) and spectator, all enforced server-side. |
| N4 | Medium | Joining is impossible after the auction starts (L4621), even for reconnecting owners. | Status check before membership. | Reconnecting members are restored; new arrivals can spectate. |
| N5 | Medium | `runTransaction` on a team returns a fabricated team when the snapshot is null (L4670), which can resurrect deleted slots. | Misuse of the transaction null-first-call. | Server transaction handles the null first pass correctly (see `functions/src/handlers.ts`). |
| N6 | Medium | Navigation mixes `.active` classes (L4426) with inline `style.display` (L3450, L3507, L4118, L5646). After visiting Tournament or Match, `showPage` cannot show other pages again because the inline `display:none` persists. | Two navigation systems. | React Router with URL per screen (refresh-safe deep links). |
| N7 | Medium | The tournament hub contains a stray "Auction Lobby / Start Auction" block (L3453–3460) wired to a second `updateHubUI` path that can start the auction with 2 of N teams. | Leftover code. | Removed; a single start control with server rules. |
| N8 | Low | Room-code input fires availability checks for codes of length 8+ but the code format is `IPL-XXXX` (exactly 8) on one input and `≥ 8` vs `< 8` on another (L4556, L2999). | Inconsistent validation. | `ROOM_CODE_RE` shared by client and server. |
| N9 | Low | Pause/settings/emoji/colour writes swallow errors (`.catch(() => {})`) so failures are invisible. | No error handling. | Toast errors from typed API errors, plus error boundaries. |

## 6. Player data

| # | Sev | Finding | Root cause | Fix |
|---|-----|---------|-----------|-----|
| D1 | Medium | **Duplicate player:** Ramandeep Singh appears as id 59 and id 179 (L4189, L4327). | Data entry. | Migration merges duplicates by normalised name (`scripts/migrate-players.ts`); the validator rejects duplicate ids or names. |
| D2 | High | **Overseas counting is wrong.** XI validation compares `data-nation !== 'India'` (L5704), but countries are codes (`IND`), so **every player counts as overseas** and no XI with more than 4 players is valid. Custom players default to `country: 'India'` and are marked overseas unless a toggle is set (L4834). | Two country formats. | Canonical 3-letter codes (`SA`→`RSA`, `WI`→`WIN`, `NZ`→`NZL`, `SL`→`SRI`). `overseas` is derived from the code, and the validator enforces it. |
| D3 | Medium | Rating fields are inconsistent: `rating` (DB), `points` (transformed, L4351), `data-rating` computed from **base price** (L5671), and opponents are hard-coded to `80` (L5742). The tournament quick-sim uses `points`. | Several schemas. | One `rating` (documented as a fictional gameplay value) plus per-squad `ratingAdj`. |
| D4 | Medium | Custom players exist only in the creating browser's memory (`customPlayers.push`, L4837). Other clients' `getPlayer` returns `null` and their UIs break when such a player is up. | Not persisted. | Stored in `rooms/{code}/customPlayers`, validated server-side. |
| D5 | Low | Fields shown in the UI that do not exist in the data: `age`, `batAvg`, `bowlAvg` (L5004–5007), always displayed as "—". | Schema drift. | Removed. The new schema has optional `stats` that must come from a cited source; seeded players carry none (no invented statistics). |
| D6 | Low | `previousTeams` contains repeats (`["MI","GT","MI"]`) and defunct franchises (GL, RPS). | Raw history. | De-duplicated keeping chronology; `lastTeam` kept explicitly; defunct codes allowed in history only. |

## 7. Squads, match engine and tournament

| # | Sev | Finding | Root cause | Fix |
|---|-----|---------|-----------|-----|
| T1 | High | **Match engine is not a T20:** each ball is a uniform draw from 20 outcomes (L3653). There are no extras, no bowling limits ("rotate to next designated bowler", so 5 bowlers each bowl 4 overs but in a fixed cycle), no ratings influence, and a new batter is `undefined` after 10 wickets in some paths. Strike swaps on 3 but never on leg byes or wides. Overs display `0.6` (L3744). | Prototype logic. | Seeded ball-by-ball engine (`shared/engine/match.ts`) with phases, ratings, pitch, extras (wides, no-balls, free hits, byes, leg byes), dismissal types, a 4-over cap with no consecutive overs (feasibility check), correct strike rotation, chase logic, super overs and full scorecards. 120-match consistency test plus calibration test. |
| T2 | High | **Results are written by whichever client clicks "Save Result"** (L3702), and quick-sim is a third, unrelated random generator (L4081). Duplicate submissions overwrite each other. | Client-side results. | Server simulates each fixture once (deterministic seed), and a transaction rejects duplicates (`already-played`). The same engine runs league and playoffs. |
| T3 | High | **Playoff progression bug:** `saveMatchResult` pushes all playoffs with `update(…/playoffs, S.roomData…playoffs)` from stale local state (L4030). Concurrent viewers race, and a playoff tie is decided with `Math.random()` and `alert()` (L4002–4003). | Stale writes; no super over. | Bracket advanced inside the room transaction. Playoff ties go to super overs. |
| T4 | Medium | **"NRR" is actually total run difference** (L3869–3870), and points ignore ties (a tie awards nothing). | Wrong formula. | Cricket NRR with the all-out rule. Ties award 1 point each. Tested. |
| T5 | Medium | Tournaments with fewer than 4 teams cannot start playoffs (`alert("Not enough teams")`, L3961). | Missing formats. | 3 teams: Eliminator (2v3), then a Final against the table-topper. 2 teams: straight to the Final. |
| T6 | Medium | XI rules: "min 5 bowlers" counts only BOWL and AR, but the counter label says bowlers. There is no keeper designation, no ownership check, and the captain is optional. Drag and drop has no mobile alternative (L5679–5700). | Prototype. | `validateXI` (shared by UI and server): 11 players, overseas cap, keeper designated, minimum bowling options, captain, ownership. Tap-to-select builder with reordering; locking. |
| T7 | Medium | "Test Tournament" cheat (`superTournamentCheat`, L5586) monkey-patches `tournamentEngine.generateSchedule` globally, after which real rooms can no longer generate schedules in that tab. | Debug code in production. | Removed. Emulator-based tests replace it. |
| T8 | Low | Chemistry uses `p1.id - p2.id` sort on mixed id types and the `previousTeams || iplTeams` fallback. | Schema drift. | `chemistry()` on normalised players; unit-tested. |

## 8. CSS, markup and UX

| # | Sev | Finding | Root cause | Fix |
|---|-----|---------|-----------|-----|
| U1 | High | **CSS custom properties are declared with no selector** (`--bg: …` directly inside `<style>`, L12–38, with a stray `}` at L38). The whole block is invalid, so every `var(--…)` falls back. | Missing `:root {`. | Tailwind v4 `@theme` tokens (`src/styles/index.css`). |
| U2 | Medium | Classes used but never defined: `btn-pink`, `btn-gold`, `btn-sm`, `my-team-row`; `var(--danger)` is undefined. | Dead references. | Component library (`src/components/ui.tsx`). |
| U3 | Medium | Two commentary panels (`#commentary-feed` and `#commentary-box`, L3318–3325) fed by different code paths. Commentary is local per tab, so devices see different feeds. | Duplicate features. | One persisted commentary log (`roomLogs/{code}/commentary`). |
| U4 | Medium | `alert()` used for errors and game events (L3961, L4003, L5637, L5651). | Prototype. | Toasts, dialogs and empty or error states. |
| U5 | Low | Fixed-width layouts and hover-only interactions; no focus styles; emoji used as the icon system. | — | Responsive layouts verified at 375 px (no horizontal scroll, asserted in E2E), focus-visible rings, ARIA roles, Lucide icons. |
| U6 | Low | "Player Trades" toggle exists but no trade feature was ever implemented. | Placeholder. | Not carried forward as a toggle (see *Remaining limitations* in IMPLEMENTATION_REPORT.md). |

## Issues found while building 3.0 (and fixed)

These were found while building and testing the new code, not in v2 itself. They are listed for transparency.

* Realtime Database drops empty arrays and `null`s: room and match documents are re-hydrated with `normalizeRoom` / `normalizeMatch`. This was caught when a match without super overs crashed the replay.
* The Functions emulator used a different database namespace than the client; fixed in `functions/src/index.ts`.
* An aborted Admin-SDK transaction is decided on cached data; error paths now write the unchanged value back so the server confirms against fresh state.
* Card ids could collide within one millisecond, which also defeated duplicate detection. They are now sequence plus request-hash ids.
* The supplementary draft could leave a squad unable to field a legal XI (too few Indian players), and it handed out top-rated leftovers. It now satisfies XI constraints with replacement-level players.
