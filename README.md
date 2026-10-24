# IPL Auction Simulator 3.0

A multiplayer IPL auction and T20 tournament simulator. Friends join a room from any device,
claim franchises, bid live against a server-authoritative clock, pick a Playing XI and play a
full season (league, Qualifiers, Eliminator and Final) with a ball-by-ball match engine.

*Unofficial fan project, not affiliated with the IPL, BCCI or any franchise. Player ratings are
fictional gameplay values, not official statistics.*

| | |
|---|---|
| Frontend | React 19 · TypeScript · Vite 8 · Tailwind CSS v4 · Radix primitives (shadcn-style, in `src/components/ui.tsx`) · Lucide icons · React Router 7 · Zustand · Motion |
| Backend | Firebase Anonymous Auth · Realtime Database · Cloud Functions v2 (TypeScript, bundled with esbuild) · Security Rules |
| Tests | Vitest (unit + emulator integration) · `@firebase/rules-unit-testing` · Playwright (desktop + mobile) |

---

## Quick start (local, no Firebase project needed)

Requirements: **Node 22+**, **Java 17+** (for the Database emulator), and npm.

```bash
npm install
```

```bash
npm --prefix functions install
```

Start the emulators (Auth 9099, Database 9000, Functions 5001, UI 4000) in one terminal:

```bash
npm run emulators
```

Start the web app against the emulators in another:

```bash
npm run dev:emu
```

Open http://localhost:5173. To play "on two devices" locally, open a second browser profile
(or use `http://127.0.0.1:5173`, a different origin, so you get a second anonymous identity).
Phones on your LAN can join through `http://<your-ip>:5173` because the emulator host follows
the page's hostname. If a phone cannot reach the emulators, make them listen on all interfaces
by adding `"host": "0.0.0.0"` to each emulator in `firebase.json`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `dev:emu` | Vite dev server (real project / emulators) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | oxlint over app, engine, functions, tests and scripts |
| `npm run typecheck` | `tsc -b` for app, engine and tests, plus Cloud Functions |
| `npm test` | Unit tests (engine: bids, purses, RTM, cards, squads, match engine, NRR, playoffs) |
| `npm run test:integration` | Starts the Database emulator and runs server and security-rules tests |
| `npm run test:e2e` | Builds functions, starts all emulators, runs Playwright (desktop + Pixel 7) |
| `npm run test:e2e:free` | Same journey through the plain-HTTP API used by the free Vercel setup |
| `npm run emulators:free` / `api:dev` / `dev:free` | Local stack for the free setup (no Functions emulator) |
| `npm run test:all` | Everything above |
| `npm run validate:players` | Validates `shared/data/players.json` |
| `npm run migrate:players -- <v2.html>` | Re-generates the player DB from the v2 file (recover it with `git show 888515b:IPL_auctionfull2.0.html > v2.html`) |
| `npx tsx scripts/sim-stats.ts 2000` | Prints match-engine calibration statistics |

## Environment variables

Copy `.env.example` to `.env.local` (git-ignored). A `.env.local` pre-filled for the v2
project `ipl-auction-fa6d2` is already present.

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Firebase **web** app config (Console → Project settings → Your apps). Not secrets, but kept out of source. |
| `VITE_FUNCTIONS_REGION` | Region of the `api` function (default `asia-southeast1`, next to the v2 database). Must match `functions/src/index.ts`. |
| `VITE_USE_EMULATORS` | `true` to use the Emulator Suite (set by `dev:emu`). |
| `VITE_EMULATOR_PROJECT_ID`, `VITE_EMULATOR_HOST` | Demo project id / host for emulators. |
| Functions: `FUNCTIONS_REGION`, `DATABASE_URL` (optional) | Override the region or database URL the functions use. |

Never put service-account keys in the frontend or in `.env*`. The functions use the default
service account provided by Google Cloud.

## Free deployment (no Blaze plan): Firebase Spark + Vercel Hobby

Firebase Cloud Functions need the paid Blaze plan. Everything else this app uses (Realtime
Database, Anonymous Auth, security rules) is free on the **Spark** plan, so the trusted
game server runs as a free **Vercel** function instead (`api/index.ts`). It is the same server
code as the Cloud Function, with the same transactions and token checks; browsers still cannot
write game data directly. Neither service asks for a card.

**1. Firebase console** (project on the free Spark plan):
* **Build → Authentication → Sign-in method → Anonymous → Enable**.
* **Build → Realtime Database** must exist (it does for `ipl-auction-fa6d2`).
* **Project settings (gear) → Service accounts → Generate new private key.** A `.json` file
  downloads. It is a password for your database: never commit it or share it.

**2. Deploy the security rules** (free) from your Mac:

```bash
cd ~/IPL-auction && npx firebase deploy --only database
```

**3. Vercel:** sign up at vercel.com with **Continue with GitHub** (Hobby plan), then
**Add New → Project → Import** `IPL-auction`. Vercel detects Vite. Before clicking Deploy, open
**Environment Variables** and add:

| Name | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | from `.env.local` |
| `VITE_FIREBASE_AUTH_DOMAIN` | from `.env.local` |
| `VITE_FIREBASE_DATABASE_URL` | from `.env.local` |
| `VITE_FIREBASE_PROJECT_ID` | from `.env.local` |
| `VITE_FIREBASE_APP_ID` | from `.env.local` |
| `VITE_API_URL` | `/api` |
| `FIREBASE_DATABASE_URL` | same value as `VITE_FIREBASE_DATABASE_URL` |
| `FIREBASE_SERVICE_ACCOUNT` | the **entire contents** of the downloaded `.json` key |

Click **Deploy**. Your game is live at `https://<project-name>.vercel.app`.

**4. Back in Firebase:** **Authentication → Settings → Authorized domains → Add domain** →
your `…vercel.app` domain.

**5. Updates:** every `git push` to `main` redeploys automatically. If you change
`database.rules.json`, run step 2 again.

**Free-tier limits** (fine for friends): Spark allows 100 simultaneous database connections,
1 GB stored and 10 GB downloaded per month (roughly 25 ten-player auctions). Vercel Hobby is for
non-commercial use. There is no once-a-minute sweeper on this path: a lot whose timer ran out
while everyone was away is finalised as soon as anyone reopens the room.

**Test the free setup locally:** emulators without Functions, the local API, and the app, each
in its own terminal:

```bash
npm run emulators:free
```

```bash
npm run api:dev
```

```bash
npm run dev:free
```

Automated: `npm run test:e2e:free`.

## Deploying to Firebase (Blaze plan, Cloud Functions)

The existing project is `ipl-auction-fa6d2` (see `.firebaserc`).

1. **Plan:** Cloud Functions and Cloud Scheduler need the **Blaze (pay-as-you-go)** plan.
   Usage for a friends-and-family game is normally within the free tier.
2. **Console setup** (once):
   * Authentication → Sign-in method → enable **Anonymous**.
   * Authentication → Settings → Authorized domains → add your hosting domain(s).
   * Realtime Database already exists (asia-southeast1). The rules are deployed below.
3. Log in:

   ```bash
   npx firebase login
   ```

4. Build and deploy hosting, functions and database rules:

   ```bash
   npm run deploy
   ```

   This runs `npm run build`, builds functions, then `firebase deploy`. To deploy pieces:

   ```bash
   npx firebase deploy --only database
   ```

   ```bash
   npx firebase deploy --only functions
   ```

   ```bash
   npx firebase deploy --only hosting
   ```

5. Open `https://ipl-auction-fa6d2.web.app`.

**Important:** deploying the new rules locks the database against direct client writes. The
v2 single-file app will stop working against this project after that (by design, see
AUDIT_REPORT S1). v2 data under `rooms/` uses a different shape, and 3.0 does not read it.

### Cloud Functions configuration

* `api` (HTTPS callable, v2, region `asia-southeast1`, `maxInstances 20`, `concurrency 80`):
  the single authoritative entry point. Requires a signed-in user.
* `sweepAuctions` (scheduled every minute): finalises overdue lots in rooms where nobody is
  connected. Uses Cloud Scheduler. In the emulator it is skipped unless Pub/Sub is emulated;
  clients' `tick` covers live rooms.
* Node runtime 22, bundled with esbuild into `functions/lib/index.js`, so the shared engine is
  compiled in.

---

## Architecture

```
src/                  React app (pages, feature folders, hooks, stores, services)
shared/               Pure TypeScript used by BOTH client and server
  types/              Domain types (money is integer lakhs everywhere)
  data/               players.json (migrated), reference data, validator
  engine/             auction · cards · squad · match · tournament · dispatch
functions/src/        Cloud Functions: api (callable) + sweepAuctions (scheduled)
database.rules.json   Security rules (clients cannot write game state)
tests/unit            Engine tests
tests/integration     Emulator tests: concurrency, idempotency, timer, rules
tests/e2e             Playwright: two-user journey, mobile layout
```

### Data model (Realtime Database)

| Path | Written by | Contents |
|---|---|---|
| `rooms/{code}` | server only | `meta`, `settings`, `members`, `teams` (purse, squad, cards, effects, XI), `customPlayers`, `auction`, `tournament` |
| `roomLogs/{code}/{commentary,bids,ledger/{team}}` | server only | Commentary feed, persistent bid history, purse ledger |
| `roomMatches/{code}/{fixtureId}` | server only | Full match result, ball log and scorecards |
| `presence/{code}/{uid}` | that user | `{ online, lastChanged }` via `onDisconnect` |
| `users/{uid}/rooms/{code}` | server | Rooms you have joined (for "rejoin") |
| `users/{uid}/profile` | that user | Display name |

### How a bid works

1. The client calls `api({ action: 'placeBid', code, lotSeq, amount, requestId })`.
2. The function runs a transaction on `rooms/{code}` using the shared engine. The bid must be
   exactly the next legal amount for that lot, the bidder must own a franchise and not already
   lead, the lot must be open with the server clock before the deadline, the team must not be
   frozen, and squad size, overseas cap and purse reserve are checked.
3. Two simultaneous bids for the same amount: the transaction serialises them; the second gets
   `stale-bid`. A retried request with the same `requestId` is acknowledged, not re-applied.
4. The deadline is stored in the room. Every client renders it with the server time offset.
   When it passes, clients call `tick`, and the server finalises only if *its* clock agrees.

### Purse accounting model: charge on hammer

Bids are commitments only. A purse is debited **exactly once**, when the lot is finalised as
SOLD (to the highest bidder or the RTM franchise), inside the same transaction that records the
sale. Being outbid, undo and RTM never move money, so there is nothing to refund. The only
credits are explicit card effects (Cashback, Sponsorship, Interest). A franchise may bid at
most `purse − (remaining minimum-squad slots) × ₹20 L`, which guarantees it can always complete a
squad. Every purse movement is written to `roomLogs/{code}/ledger/{team}`.

Bid increments (lakhs): base price first, then +5 under ₹1 Cr, +10 to ₹3 Cr, +25 to ₹10 Cr,
+50 to ₹20 Cr, +100 above. Tier base prices: Diamond ₹2 Cr, Platinum ₹1.5 Cr, Gold ₹1 Cr,
Silver ₹50 L, Bronze ₹20 L.

### Roles

| Role | Can |
|---|---|
| Host | Everything an auctioneer can, plus edit settings, assign the auctioneer |
| Auctioneer | Start the auction, SOLD / UNSOLD, undo last bid, pause / resume, re-list unsold, close the auction, add custom players, start the season, simulate matches |
| Franchise owner | Claim or release a franchise in the lobby, ready up, bid, RTM decisions, buy and play power cards, save and lock a Playing XI |
| Spectator | Watch everything live |

All of these are enforced in the engine (server-side) and by the rules (no direct writes).

### Auction lifecycle

Lobby → players are queued by tier (shuffled within tier) → each lot opens after a short reveal,
runs on the bid timer (shorter above ₹15 Cr), and is finalised by the auctioneer or on expiry →
optional RTM window → next lot. At the end of a round the auctioneer re-lists unsold players
or closes the auction. Closing runs a **supplementary draft**: any squad that cannot field a
legal XI (11 players, enough Indian players for the overseas cap, a keeper, 5 bowling options)
receives replacement-level unsold players at ₹20 L.

### RTM

Offered when the feature is on, the player's **last IPL franchise** is in the room, is owned,
is not the winning bidder, has RTM cards left, and could legally afford and register the player
at the final price. The franchise has `rtmWindowSec` to match. If it matches it is charged and
loses a card, and the original bidder pays nothing. Declining or a timeout sells to the
highest bidder.

### Power cards (optional)

Mystery cards cost ₹5 Cr (max 5 held). **Good** cards go to your hand; **bad** cards fire
immediately when drawn. Every card has an id, so a retried "play" never applies twice.

| Card | Kind | Effect |
|---|---|---|
| Sniper | good | Jump the current bid by ₹5 Cr and take the lead (normal bid checks apply) |
| Freeze | good, target | Opponent cannot bid for 15 s (blocked by Shield) |
| Hidden Purse | good | Your purse shows as "Hidden" to others for the next 2 lots* |
| Form Surge | good | Your next signing gets +12 sim rating |
| Injury | good, target | Opponent's latest signing gets −10 sim rating (blocked by Shield) |
| Sponsorship | good | +₹10 Cr |
| Interest | good | +₹5 Cr |
| Shield | good | Blocks Freeze / Injury for the next 2 lots |
| Time Warp | good | Resets the bid clock to the full timer |
| Cashback | good | 10% of your next signing's price refunded |
| Tax Audit | bad | −₹10 Cr immediately |
| Brain Freeze (Self Freeze) | bad | You are frozen for 10 s |
| Scout's Error | bad | Your next signing gets −10 sim rating |
| Purse Leak | bad | Your purse is visible for 3 lots even if hidden |

\* Hidden Purse is a UI-level effect: room data is readable by members, so a determined user
with dev tools could still read the value.

### Playing XI

Exactly 11 from your squad, at most 4 overseas (configurable), at least one designated
wicket-keeper (a WK), at least 5 bowling options (bowlers or all-rounders, configurable), and
a captain. Order is the batting order. Validation lives in `shared/engine/squad.ts` and runs
in the UI and on the server. When the season starts, all XIs lock; franchises without one get
an auto-picked XI.

### Match engine

`shared/engine/match.ts`: a seeded ball-by-ball model with three phases (powerplay, middle,
death), batter-versus-bowler skill from ratings, pitch types (pace or spin assistance), wides,
no-balls with free hits, byes and leg byes, five dismissal types (run outs are not credited to
the bowler), correct strike rotation, at most 4 overs per bowler with no consecutive overs
(guaranteed by a feasibility check), chase aggression, super overs for playoff ties and player
of the match. All probabilities are **documented fictional parameters**. Calibration
(`scripts/sim-stats.ts`): first innings averages about 162/6 and chasing sides win about 52%.

The server simulates each fixture once with a seed derived from the fixture and locked XIs, so
duplicate requests compute identical results, and the room transaction records only one. The
client replays the stored ball log at Normal, Fast or Instant speed and resumes after a refresh.

### Tournament

Round-robin league (single or double), 2 points for a win and 1 each for a tie (no super over
in the league), cricket NRR (an all-out innings counts as 20 overs). Playoffs:
≥4 teams: Q1 (1v2), Eliminator (3v4), Q2 (loser Q1 v winner EL), Final ·
3 teams: Eliminator (2v3), then a Final against 1st · 2 teams: Final.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Setup needed" screen | `.env.local` is missing Firebase values, or run with `npm run dev:emu`. |
| `Could not sign in` | Enable **Anonymous** sign-in in Firebase Auth, and add the domain to Authorized domains. |
| Callable errors `functions/not-found` / CORS | Functions not deployed, or `VITE_FUNCTIONS_REGION` differs from the deployed region. |
| `permission-denied` reading rooms | You are not signed in yet, or rules not deployed. |
| Database emulator will not start | Install Java 17+ (`brew install openjdk@21` and add it to `PATH`). |
| Room "not found" in emulator right after creating it | Functions and client on different DB namespaces: make sure you started with `--project demo-ipl-auction` (the scripts do). |
| Lots never expire in production | Check that the `sweepAuctions` scheduler is deployed (needs Blaze). Connected clients also nudge expiry. |
| Port 5000 busy on macOS | Hosting emulator uses 5050 for that reason. |
