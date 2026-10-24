# Implementation report — IPL Auction Simulator 3.0

Date: 2026-10-23. Scope: full rebuild of the v2 single-file app (see AUDIT_REPORT.md for
the 60+ confirmed v2 issues and how each was addressed).

## Test results (all run locally against the Firebase Emulator Suite)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 warnings, 0 errors |
| Type check (app, engine, tests, functions) | `npm run typecheck` | ✅ |
| Player data validation | `npm run validate:players` | ✅ 179 players valid |
| Unit tests | `npm test` | ✅ **62 passed** |
| Emulator integration + security rules | `npm run test:integration` | ✅ **16 passed** |
| End-to-end (desktop + Pixel 7) | `npm run test:e2e` | ✅ **2 passed** |
| Production build | `npm run build` | ✅ |

Beyond the automated suites, I verified the flow by hand in a browser with two separate
identities, on desktop and at 375 px: create → join → claim → start → bid → timer expiry
finalised by the server (no host action) → RTM accepted by the other device → end auction →
auto-pick and lock XI → start season → ball-by-ball replay → simulate to champion. That pass
found eight bugs (emulator namespace, stuck overlay, lost confirm dialog, replay crash, mobile overflow, target spoiler, dismissal text, over-generous supplementary picks), all fixed.

### What the tests cover

* **Unit:** bid increments and integer money; affordability reserve; squad and overseas caps;
  simultaneous-bid serialisation; idempotent bids; charge-exactly-once on hammer; duplicate
  hammer; undo; pause and resume; timer expiry without the host; full 2-round auction with
  money conservation and no double sales; RTM eligibility (5 cases), RTM charge and refund
  correctness, RTM timeout; every power card plus idempotent use and purchase; XI validation
  (size, overseas, keeper, bowling options, ownership, captain) and locking; match-engine
  scorecard consistency over 120 matches (runs reconcile, 6-ball overs, 4-over cap, no
  consecutive overs, dismissed batters never return, chase stops at target); engine
  calibration; strength influence without determinism; tie handling; NRR; points; fixtures for
  2–10 teams (single and double round-robin); playoff progression for 2, 3 and ≥4 teams;
  duplicate result rejection; full tournament through the reducers.
* **Integration (emulator, three independent Admin connections acting as separate function
  instances):** unique room codes; reconnection restores franchise; two users claiming the same
  franchise at once; three users bidding simultaneously; a 12-bid war across instances with
  racing hammer, hammer and tick (charged once, advanced once, ledger has one entry); retried
  bid and card requests; never sold twice; real 5 s timer expiry triggered by a non-host;
  scheduled sweeper with nobody connected; pause blocks expiry; auction → tournament → champion
  with concurrent duplicate `simulateMatch`; security rules (no client writes to purses,
  squads, bids, results, settings or logs; presence only for yourself; own profile only).
* **E2E:** the 20-step acceptance workflow with two browser contexts, including a mid-auction
  refresh and a final reload; mobile viewport (no horizontal scroll, pinned bid button,
  bottom navigation).

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1–3 | Create room; join from another device; synchronised state | ✅ E2E + manual |
| 4–5 | Claim available franchises; duplicates prevented atomically | ✅ integration race test |
| 6–7 | Host starts; current player on every screen | ✅ |
| 8–10 | Valid bids; instant display everywhere; invalid or unaffordable rejected | ✅ |
| 11–14 | Auctioneer finalises; squad updated; exact purse; next player | ✅ |
| 15 | No duplicated players or corrupted balances | ✅ money-conservation test |
| 16 | Valid Playing XIs | ✅ |
| 17–19 | Fixtures, saved results, points table and playoffs | ✅ |
| 20 | Refresh or reconnect keeps state | ✅ |

## Delivered

* Redesigned React frontend: home, create, join, lobby, live auction, player pool (search,
  filters, sorting, profiles, host custom players), squads with ledger and chemistry, XI
  builder (tap-to-select, reorder, mobile-friendly), season hub (table, fixtures, playoffs,
  trophy ceremony), match centre (live replay at Normal / Fast / Instant, resumable,
  scorecards). Error boundaries, loading, empty and error states, toasts.
* Integrated backend: Anonymous Auth, a single transactional `api` callable, a scheduled
  sweeper, and locked-down security rules.
* Shared, unit-tested engine for auction, cards, squads, matches and tournament.
* Migrated and validated player database (duplicate removed, countries normalised, RTM
  history fixed).
* `.env.example`, README (setup, emulators, deploy, rules, functions, troubleshooting), audit
  report, this report.

## Not done / limitations (honest list)

1. **Not deployed.** A free path now exists (Firebase Spark + Vercel Hobby, see README → *Free deployment*); its E2E suite passes against the emulators (`npm run test:e2e:free`). Deploying needs your Firebase login and the **Blaze** plan for Cloud
   Functions and Scheduler. The exact steps are in README → *Deploying to Firebase*. Deploying
   the new rules will (intentionally) stop the v2 page from writing to the same database.
2. **Player trades** (a v2 toggle that had no implementation) were not built.
3. **Hidden Purse** is UI-level concealment: members can read room data, so a technical user
   could see a hidden purse via dev tools. True secrecy would need per-team private nodes.
4. **Anyone with a room code can read that room** (rules require sign-in only). Codes have
   about 1M combinations. Fine for casual play; add membership-gated reads or longer codes for
   public use.
5. No rate limiting on the callable beyond Firebase defaults, and no automatic clean-up of old
   rooms. Consider App Check and a TTL job before a public launch.
6. **No-result** matches (rain) are not simulated; the standings type supports the column.
7. Match ratings and archetypes are fictional by design. No real statistics were invented;
   the optional `stats` field is empty for all seeded players.
8. The scheduled sweeper does not run inside the local emulator (Pub/Sub not emulated). Live
   rooms rely on clients' `tick`; the sweeper is covered by an integration test that calls it
   directly.
9. Functions were exercised on the local Node 26 runtime (the emulator uses the host Node);
   production targets Node 22.
