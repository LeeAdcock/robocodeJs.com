# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

RobocodeJs is a browser-based programming game where users write JavaScript "bots" (tank AIs) that battle in teams in a shared arena. It is a two-package monorepo plus a tiny root dev proxy:

- `index.js` — root dev reverse proxy (port 5000). Routes `/api` and `/health` → `:8080` (server), everything else → `:3000` (ui). This is the port forwarded by `.devcontainer`.
- `server/` — Express + TypeScript API and the game simulation engine (port 8080). Package `@robocodejs/server`.
- `ui/` — Vite + React + TypeScript front end (port 3000). Renders the arena as SVG and the bot code editor.

## Commands

There is no root-level install/build; work inside `server/` and `ui/` separately.

```bash
# Local dev (run all three in separate terminals)
node index.js                 # root proxy on :5000
(cd server && npm run dev)    # builds + nodemon-watches server on :8080
(cd ui && npm run dev)        # Vite dev server on :3000 (npm start is an alias)

# Build (mirrors buildspec.yaml)
(cd ui && npm run build)      # tsc --noEmit type-check, then vite build → server/dist/public
(cd server && npm run build)  # tsc -> server/dist

# Lint / format (per package; both use prettier + eslint with --fix)
(cd server && npm run lint)
(cd ui && npm run lint)
```

Both packages use **Vitest** (`npm test` runs `vitest run`, `npm run test:watch` for watch mode). Tests live in each package's `test/` directory (outside `src`, so they're excluded from the `tsc` build). Server coverage spans the simulation physics (`simulation.test.ts`), tick-driven timers (`scheduleFactory.test.ts`), the `Tank`/`Turret`/`Radar` classes (`tankTypes.test.ts`), the API endpoints with auth/ownership (`api.test.ts`, `auth.test.ts`, `session.test.ts`), the Postgres services (`services.test.ts`), name generation (`nameFactory.test.ts`), **real-isolate** sandbox integration (`compiler.test.ts`), and **full sandbox+simulation** integration (`simulationIntegration.test.ts` — a real bot compiled into a real isolate and driven through `Simulation.run` tick by tick, asserting tank state); the UI covers the SSE reducer (`arenaReducer.test.ts`), shared geometry (`geometry.test.ts`), and client-side interpolation (`simulate.test.ts`). Three patterns recur: `Simulation.run` is driven with lightweight mock tanks (it only invokes `tank.handlers[...]` and mutates plain fields, so no isolates are needed); `compiler.test.ts` spins up a real `isolated-vm` isolate to lock the bot-facing contract; and `simulationIntegration.test.ts` combines both — manually advancing ticks with a short settle for the async handlers. Bot commands are async, but their side effects (e.g. `speedTarget`) land synchronously, then `Simulation.run` applies physics synchronously over ticks. DB-/isolate-coupled modules `vi.mock('../src/util/db', ...)` (or mock the relevant services) at the top of the file.

`ui build` writes directly into `server/dist/public` (`build.outDir` in `ui/vite.config.ts`, with `emptyOutDir` clearing it first), so the server can serve the built UI as static files in production. Deployment is AWS CodeBuild (`buildspec.yaml`) → Elastic Beanstalk (`server/.ebextensions`).

**CI** runs on every PR/push (`.github/workflows/ci.yml`): per package, `npm ci` → lint → build (`tsc`) → test → `npm audit --audit-level=high` (the native `isolated-vm` build needs Node 24 + `gcc`/`gcc-c++`, provided on the runner). `.github/dependabot.yml` opens weekly npm + github-actions update PRs.

To cut a release artifact, run `npm run package` from `server/` (build `ui` then `server` first so `dist/` is current). It runs `npm version patch --no-git-tag-version` (bumps the version without creating npm's own commit/tag), regenerates `npm-shrinkwrap.json`, and zips the deploy bundle (`node_modules` excluded — EB installs from the shrinkwrap). **Always commit the resulting version bump (`server/package.json` + `server/npm-shrinkwrap.json`) and push it to `main`** with a `build: bump server to vX.Y.Z (from npm run package)` message — this is the established convention. Then **tag the release**: `git tag -a vX.Y.Z -m "Release vX.Y.Z" <bump-commit>` and `git push origin vX.Y.Z` (annotated tags, created separately from the bump commit). Bump commits through **v1.2.68** were backfilled with tags; every release from v1.2.68 on is tagged.

## Runtime requirements

The server requires `node >=24` (see `server/package.json` engines), pinned by the native `isolated-vm` dependency: isolated-vm 5.x requires Node ≥18, 6.x ≥22, and 7.x ≥26 — so the isolated-vm major and the Node major must move together. We run Node 24 (LTS) with isolated-vm 6.x; bumping to isolated-vm 7.x would require Node ≥26. The dev container (`.devcontainer/devcontainer.json`) runs Node 24, and CI pins `nodejs: 24` in `buildspec.yaml`. If `isolated-vm` fails to build or load, a Node/isolated-vm version mismatch is the first thing to check; the native build needs `gcc`/`gcc-c++` (provided in the container and in `server/.ebextensions/options.config` for Elastic Beanstalk).

The server needs Postgres via `RDS_*` env vars (`RDS_USERNAME`, `RDS_HOSTNAME`, `RDS_DB_NAME`, `RDS_PASSWORD`, `RDS_PORT`); see `server/src/util/db.ts`. Services create their own tables lazily with `CREATE TABLE IF NOT EXISTS` at import time.

**Local-dev mode** (`util/devMode.ts`, `isLocalDev`): when `NODE_ENV` is neither `production` nor `test` **and** `RDS_HOSTNAME` is unset, the server runs with an in-memory Postgres (`pg-mem`, a devDependency `require`d lazily in `db.ts`) and an **auth bypass** that attaches a fixed "Local Dev" user (`ensureDevUser` in `middleware/auth.ts`) — no real database or Google sign-in needed. New users (including the dev user) are bootstrapped with starter bots and a running arena by `UserService.create`. The mode is force-disabled in production (re-checked at the auth-bypass site) and in the test suite. Don't rely on it serving requests with real persistence — data resets each restart.

## Architecture

### Bot sandboxing (the core of the system)

User bot code is untrusted JavaScript run in `isolated-vm` isolates — this is the central design constraint.

- An **`Environment`** (`server/src/types/environment.ts`) is one arena instance held in memory. `EnvironmentService` keeps a `Map<arenaId, Environment>` and disposes environments 30 minutes after they stop (isolate cleanup).
- Each **`Process`** = one app (bot program) in an arena, owns one `ivm.Isolate` sandbox (8 MB limit) and **5 `Tank` instances** that all share that isolate.
- `util/compiler.ts` is where the bot-facing API is built: for every method it sets a native `_bot_*` function on the isolate global, then compiles a thin JS wrapper (`bot.turn`, `bot.radar.scan`, `bot.turret.fire`, `arena`, `clock`, `console`, `setInterval/setTimeout`, `Event`, etc.) that bridges to it. **The `ivm` module is never exposed to bot code** (per isolated-vm's security guidance): all `Callback`/`Reference`/`ExternalCopy` objects are built host-side. Async bot APIs are Promises parked in an isolate-side `__pending` table and settled by the host via a captured `__settle` reference; events and timers use the same dispatch-table pattern (`__dispatch`/`__runTimer`), with the host pinning those references at init so a bot can't reassign them. Bot code (script load, event handlers, timer callbacks) runs via isolated-vm's **async `run`/`apply`** — on the thread pool, off the main event loop — each bounded by `SANDBOX_TIMEOUT_MS` (default 5s); a timeout or throw sets `tank.appCrashed` and Simulation kills the bot. `Date` is deliberately set to `undefined` to keep bots deterministic — bots use `clock.getTime()`.
- The bot API surface lives entirely in `compiler.ts`; bot-author documentation is in `ui/public/docs/*.md` and example bots in `ui/public/samples/*.js`.

### Simulation loop

- `Environment.resume()` runs a **self-scheduling async loop** (`runLoop` → `tick` → `drainBotWork`), _not_ a fixed `setInterval`: each tick runs the physics, then **awaits** that tick's bot work (handlers, timers, command settlements) before the next tick begins — the guarantee that makes the sim deterministic at any speed. Cadence is set by `setSpeed` (a multiplier; `1` = the default ~10 ticks/s, `0`/`"max"` = unbounded). `clock.time` increments by 1 per tick and **resets to 0 on `restart()`** (so a new match never inherits the prior match's sudden-death state).
- `util/simulation.ts` (`Simulation.run`) is the physics/interaction engine: runs START/TICK handlers, fires timers (`scheduleFactory.timerTick`), moves tanks, detects collisions and bullet hits, applies damage, and emits events. After `SUDDEN_DEATH_TIME` ticks it decays health to force a winner. A crashed bot (`tank.appCrashed`) is killed; a tank's death tick is recorded on `Tank.eliminatedAt` for the match summary.
- Timers are **monkey-patched** (`util/scheduleFactory.ts`): bot `setInterval`/`setTimeout` are driven by simulation ticks, not real time, so the game can pause/resume/stop them.
- **Determinism:** each `Environment` has a seeded PRNG (`util/random.ts`, mulberry32) driving tank placement/orientation and each bot's in-isolate `Math.random` — a fixed seed (`setSeed`, `POST .../arena/seed`, `set_arena_seed`) reproduces a match. Combined with the tick-driven loop, accelerated headless runs are repeatable.

### Server <-> UI communication

- REST endpoints live in `server/src/api/*.ts` (`app`, `arena`, `user`, `demo`, `help`, `health`, `session`, `token`, `mcp`), wired up in `index.ts`. Most are namespaced under `/api/user/:userId/...`. Two shared builders back both REST and MCP: `util/arenaStatus.ts` (`buildArenaStatus` — the live per-tank snapshot, `GET .../arena`) and `util/matchSummary.ts` (`buildMatchSummary` — the outcome-oriented leaderboard/winner/elimination view, `GET .../arena/summary`).
- Live arena state streams to the browser via **Server-Sent Events**: `GET /api/user/:userId/arena/events` (game events) and `/arena/logs` (bot console output). The `Environment` is an `EventEmitter`; adding an `event` listener replays current state (place app/tank events) so a new client can bootstrap.
- The UI (`ui/src/App.tsx`) consumes the SSE stream and applies a large per-event-type reducer to its arena state. Between server ticks it runs its **own** client-side physics (`ui/src/util/simulate.ts`, a partial mirror of the server's `simulation.ts`) to interpolate smooth motion. Keep these two simulations consistent when changing movement math.
- **Theme:** a whole-app light/dark theme lives in `ui/src/util/theme.ts` (a `useSyncExternalStore` store — header toggle, persisted to `localStorage`, OS-default). The boolean drives a `body.dark` CSS-variable theme (`ui/src/index.css`), the Ace editor theme, and the arena SVG's night-mode tint.

### Auth & access control

`server/src/middleware/auth.ts` verifies a Google OAuth id token (checking its **audience** against `GOOGLE_CLIENT_ID`, which must match the client id the UI signs in with) stored in the `auth` cookie. The cookie is set **server-side and HttpOnly** by `POST /api/session` (the UI posts the Google credential there; `DELETE /api/session` logs out) — see `server/src/api/session.ts`. A user record is auto-created on first login (rejected if `email_verified` is false). Both `/api/user` and `POST /api/mcp` are hard-gated by `auth(true)` — the latter resolves the acting user from a **bearer API token** (`api/token.ts`, stored only as a sha256 hash). Ownership is enforced by two middlewares (`middleware/resource.ts`): `requireOwner` (the actor owns the `:userId`/arena) and `requireAppOwner` (the confidential/destructive app routes — source read/write, delete, compile, reboot — the A01 IDOR fix). Metadata reads and add-by-reference stay open by design (spectating / share-links).

### AI integration (MCP)

`server/src/api/mcp.ts` is an in-process **Model Context Protocol** server at `POST /api/mcp` (Streamable HTTP, stateless, bearer-token auth) exposing ~28 tools (bot CRUD + `check_app_source`/`format_app_source`/compile/reboot; arena create/delete/control incl. `set_arena_speed`/`set_arena_seed`; `arena_status`, `match_summary`/`match_status`; `platform_status`; `recent_logs`/`recent_faults`; the global `leaderboard`), **resources** (bot docs, `robocode.d.ts`, samples, error codes), and **prompts** (`write_app`, `debug_app`, `play_match`). Own-resource tools address apps/arenas by `appId`/`arenaId` (not a bare `id`), and pure control actions return a verb-specific flag (`paused`/`resumed`/`restarted`/`updated`/…). Almost every tool acts only on the token owner's own resources (`ownedApp`/`ownedArena` mirror the REST ownership checks) — keep the MCP caps in sync with the REST caps by hand; the `leaderboard` tool is the one deliberately global (public ranking data). User-facing setup guide at `/mcp` (`ui/public/docs/mcp.md`).

### Global bot ladder (GitHub #151)

A background matchmaking system that gives every eligible app a persistent **Elo rating**, separate from user arenas. `services/LadderService.ts` runs a self-scheduling loop: `pickPair` (eligibility via `AppService.getLadderCandidates` — non-deleted/non-broken, non-empty, app + owner active within 3 months, minus untouched starters from `util/starterBots.ts`; biased toward fewest-games + nearest-rating, different owner) → `runOneMatch` (an **ephemeral, non-persisted** `Environment` with two `Process`es, random seed, run to `deriveMatch().decided` via the shared `util/runMatch.ts` `runMatchToDecision` — also used by the MCP `run_match`) → `util/elo.ts` `updateRatings` (placement K-boost) persisted on the `app` row (`rating`/`ratingGames`/`ratingWins`/`broken`), match logged to `ranked_match` (`RankedMatchService`). The rating rides the app's **current** source (never reset on edit — editing clears `broken`), so effectiveness drifts the score over ~20–40 games. The loop is **opt-in** (`LADDER_ENABLED=true`, never under test), conservative by default (1 worker, `LADDER_*` env knobs), and **load-gated** off `EnvironmentService.metrics().isolates` so ranked matches yield to live players on the small prod box; a match is ~3s typical, ~15s worst-case (sudden death). The public top-20 is `GET /api/leaderboard` (`api/leaderboard.ts`, unauthenticated, no source) + the MCP `leaderboard` tool, rendered at the UI `/leaderboard` route (main-nav "Rankings", visible logged-out). `account.lastActiveAt` (bumped, throttled, in `middleware/auth.ts`) feeds the owner-activity eligibility gate.

### Bot roster & membership

An arena's **roster** is its `ArenaMember` rows. A member can be **enabled or disabled** (`ArenaMember.enabled`): disabled = pulled from the live match (no `Process`/tanks) but kept in the roster so it can be re-enabled. Apps can be **added by reference** — another user's app id, e.g. via the `/add-app/:appId` **share link** — which links the app into the arena without ever exposing its source (only its live bots are visible). Roster/enable/add-by-reference routes live in `api/arena.ts`; the live status snapshot omits disabled members (they have no `Process`), and so does `match_summary`.

### Security & resource limits

Untrusted code + shared multi-user arenas make **access control, sandbox integrity, and resource exhaustion** the primary concerns. Hardening in place: `helmet` + CSP (`middleware/securityHeaders.ts`), rate limiting (`middleware/rateLimit.ts` — auth/compute/write/api limiters, `429` + error `E022`), RDS TLS **CA verification** (`db.ts` `sslConfig`), and resource caps — per-tank timers (`MAX_TIMERS_PER_TANK`, `E021`), per-user apps (`MAX_APPS_PER_USER`) and arenas (`MAX_ARENAS_PER_USER`) plus a global `MAX_TOTAL_ARENAS` ceiling, and the 8 MB isolate limit. A full OWASP Top 10 audit was completed and **all medium-and-above findings are remediated**; the engineering + product backlog is tracked in **GitHub Issues** (labels `tech-debt`, `enhancement`, `ai-mcp`).

**Accepted / deferred security risks** (all low severity, decided deliberately — don't "fix" without cause):

- **No server-side session revocation.** Logout just clears the cookie; a stolen still-valid Google id token works until its ~1 h expiry. Accepted — a revocation denylist is disproportionate for the short TTL.
- **Markdown rendering relies on CSP, not a sanitizer.** `showdown` → `html-react-parser` (`ui/src/.../markdownPage.tsx`) is unsanitized, but input is only our own static `/docs/*.md`, `html-react-parser` makes injected scripts inert, and the CSP is a backstop. Escalation path if untrusted markdown is ever rendered: add `DOMPurify.sanitize` before `parse()` (noted at the render site).
- **`showdown` ReDoS** (GHSA-rmmh-p597-ppvv, no fix available): accepted for the same reason — trusted static input only.
- **Token entropy uses `randomUUID()`.** OAuth codes/access/refresh tokens are ~122-bit UUIDv4, stored only as sha256 hashes (`services/OAuthService.ts` via `util/hash.ts`). Adequate; `crypto.randomBytes(32)` would be the purist upgrade.
- **Lazy DDL startup robustness.** `CREATE TABLE IF NOT EXISTS` promises fire at import time without `await`/`.catch` (e.g. `AppService.ts`) — a startup race, not a vuln. Would be tidied by the DB-migrations task (GitHub issue #142).
- **`isolated-vm` ⇄ Node major coupling** (6.x needs Node ≥22; 7.x needs ≥26): move both majors together on any runtime bump.

### Services & types

`server/src/services/*Service.ts` are singleton data-access objects over Postgres (User, App, Arena, ArenaMember, Identity, Demo) plus the in-memory `EnvironmentService`. `server/src/types/*` hold both domain classes (`Tank`, `Arena`, `Environment`, `Process`) and plain DTOs; `ui/src/types/*` mirror the wire DTOs. `ErrorCodes.ts` defines the `E0xx` codes surfaced in bot logs.

## Conventions

- A user can own multiple arenas. Each arena action route is registered at **two paths sharing one handler** (`api/arena.ts`, via the `dual()` helper): `/api/user/:userId/arena/...` resolves the user's **default arena** (first by creation time, lazily created if none) and is what the UI uses, while `/api/user/:userId/arenas/:arenaId/...` addresses a **specific arena** and is intended for tooling. The `resolveArena` middleware (`middleware/resource.ts`) picks the right one and enforces that an `:arenaId` belongs to `:userId`. The collection lives at `/api/user/:userId/arenas` (GET list, POST create — capped at `MAX_ARENAS_PER_USER`), with `DELETE .../arenas/:arenaId` to tear one down. Keep the UI single-arena: add arena management to tooling against `/arenas`, not the UI.
- Server logging uses the structured **pino** logger in `server/src/util/logger.ts` (pretty in dev, JSON in prod, silent in test, `LOG_LEVEL`-tunable) — use it, not `console.log`. This is separate from the per-tank bot `console` output (browser-bunyan → SSE). Fault/security conditions are logged with a stable `event` field via `LogEvent`/`logBotFault` (e.g. `bot.fault` with `timedOut`, `auth.forbidden`); see the server README "Logging & monitoring".
- Code style is enforced by prettier + eslint with `--fix`; one root `.prettierrc.json` governs the whole repo, eslint is per-package (each resolves its own plugins). Run the package `lint` script rather than hand-formatting. A **Husky pre-commit hook** (root `.husky/pre-commit` → `lint-staged`, configured in `.lintstagedrc.cjs`) runs `prettier --write` on staged files, so commits are auto-formatted; it's activated by the root `prepare` script on `npm install`. Generated files are excluded via `.prettierignore` (e.g. `ui/public/ts`, the generated `robocode.d.ts`).
