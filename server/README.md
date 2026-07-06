# @robocodejs/server

The RobocodeJs backend: an **Express + TypeScript API** and the **game simulation engine**. It compiles and runs untrusted bot code in sandboxed V8 isolates, simulates the arena, and streams live state to the browser.

Part of the [RobocodeJs monorepo](../README.md). Runs on port `8080` (reached through the root proxy on `:5000` in development).

## Requirements

- **Node.js ≥ 24** (`engines` in `package.json`) — required by the native [`isolated-vm`](https://github.com/laverdet/isolated-vm) dependency. The isolated-vm major and Node major are coupled: isolated-vm 5.x needs Node ≥18, 6.x ≥22, 7.x ≥26. We run **Node 24** with `isolated-vm@^6` (the dev container, `buildspec.yaml`, and CI all pin Node 24); bumping to isolated-vm 7.x would require Node ≥26. Building the native module needs `gcc`/`gcc-c++` (present in the dev container and in `.ebextensions/options.config` for Elastic Beanstalk).
- **PostgreSQL** — only for a real/production setup; see [Environment variables](#environment-variables). For local dev it is optional (see below).

### Local-dev mode

When `RDS_HOSTNAME` is unset and `NODE_ENV` is neither `production` nor `test`, the server runs in **local-dev mode** (`src/util/devMode.ts`): the database is an in-memory Postgres ([`pg-mem`](https://github.com/oguimbal/pg-mem), a devDependency) and `auth()` skips Google verification, attaching a fixed **Local Dev** user (`ensureDevUser`). So `npm run dev` works with no database and no sign-in. That user is created with the standard starter bots and a running arena (`UserService.create`), so the arena is live immediately; all data resets on restart. The mode is force-disabled in production (re-checked at the auth bypass) and in tests.

## Scripts

```bash
npm run dev     # build + nodemon-watch src, restart on change (port 8080)
npm run build   # tsc -> dist/
npm start       # node ./dist/src/index.js
npm test        # run the Vitest suite once (test/**/*.test.ts)
npm run test:watch  # Vitest in watch mode
npm run smoke   # exercise the isolated-vm API surface compiler.ts relies on
npm run lint    # prettier --write + eslint --fix
npm run package # version bump + shrinkwrap + zip the deploy artifact
```

## Environment variables

PostgreSQL connection (see `src/util/db.ts`):

| Variable                        | Purpose                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RDS_HOSTNAME`                  | database host                                                                                                                                                                                                                                                                            |
| `RDS_PORT`                      | database port (default `5432`)                                                                                                                                                                                                                                                           |
| `RDS_DB_NAME`                   | database name                                                                                                                                                                                                                                                                            |
| `RDS_USERNAME`                  | database user                                                                                                                                                                                                                                                                            |
| `RDS_PASSWORD`                  | database password                                                                                                                                                                                                                                                                        |
| `GOOGLE_CLIENT_ID`              | OAuth client id tokens are verified against (audience); defaults to the app's client id. Must match the id the UI signs in with.                                                                                                                                                         |
| `NODE_ENV`                      | `production` enables the `Secure` flag on the session cookie                                                                                                                                                                                                                             |
| `SANDBOX_TIMEOUT_MS`            | wall-clock ceiling for a single synchronous entry into bot code — script load, event handlers, and timer callbacks (default `5000`)                                                                                                                                                      |
| `LOG_LEVEL`                     | application log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent`); defaults to `debug` in local dev, `info` otherwise, `silent` under test                                                                                                                                  |
| `RDS_SSL` / `RDS_SSL_NO_VERIFY` | TLS to Postgres — verified against the vendored RDS CA bundle (`certs/rds-global-bundle.pem`) by default. `RDS_SSL_NO_VERIFY=true` encrypts without verifying the CA (old behaviour, for a non-RDS cert); `RDS_SSL=false` disables TLS. See A02-1 in [`../SECURITY.md`](../SECURITY.md). |
| `MAX_TOTAL_ARENAS`              | global ceiling on concurrently-created arenas across **all** users (default `1000`); creation past it returns `503`                                                                                                                                                                      |

Each service issues `CREATE TABLE IF NOT EXISTS` at import time, so the schema is created lazily on first connection.

## Request flow

`src/index.ts` wires everything up:

1. `/api` gets JSON + octet-stream body parsing and cookie parsing.
2. `express.static("./dist/public")` serves the built UI (produced by `ui`'s build).
3. `/api/user` is gated by `auth(true)` (see [Auth](#auth)).
4. Endpoint routers are mounted; a catch-all returns `index.html` so the SPA can handle client-side routes.

### API endpoints (`src/api/`)

Most routes are namespaced under `/api/user/:userId/...`. Mutating routes require ownership: `requireOwner` (the actor owns the `:userId`/arena) and, for confidential/destructive **app** routes, `requireAppOwner` (source read/write, delete, compile, reboot — the A01 IDOR fix). Metadata reads and add-by-reference are intentionally open (spectating / share-links). See [Security](#security--resource-limits).

| Router       | Highlights                                                                                                                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health.ts`  | `GET /health` liveness check                                                                                                                                                                                                                                                                              |
| `demo.ts`    | public demo arena + its SSE streams (no auth)                                                                                                                                                                                                                                                             |
| `help.ts`    | help responses, classified with `ml-classify-text`                                                                                                                                                                                                                                                        |
| `session.ts` | `POST`/`DELETE /api/session` — sign in / out (sets the HttpOnly `auth` cookie); see [Auth](#auth)                                                                                                                                                                                                         |
| `token.ts`   | mint / rotate the per-user **MCP bearer API token** (stored only as a sha256 hash)                                                                                                                                                                                                                        |
| `user.ts`    | `GET /api/user` (current user) and `/api/user/:userId`                                                                                                                                                                                                                                                    |
| `app.ts`     | app CRUD, `GET/PUT .../app/:appId/source`, `POST .../compile` / `.../reboot` / `.../check` (dry-run compile), capped at `MAX_APPS_PER_USER`                                                                                                                                                               |
| `arena.ts`   | arena collection (`GET`/`POST .../arenas`, `DELETE .../arenas/:arenaId`); status (`buildArenaStatus`) and `.../summary` (`buildMatchSummary`); roster add/remove + enable/disable (incl. add-by-reference); `restart`/`pause`/`resume`/`speed`/`seed`; and the live `.../events` & `.../logs` SSE streams |
| `mcp.ts`     | in-process **Model Context Protocol** server at `POST /api/mcp`; see [MCP server](#mcp-server)                                                                                                                                                                                                            |

> **Multi-arena:** a user can own several arenas. Each action route is registered at **two paths sharing one handler** (the `dual()` helper): `/api/user/:userId/arena/...` resolves the user's **default arena** (lazily created if none) — this is what the UI uses — while `/api/user/:userId/arenas/:arenaId/...` addresses a **specific arena** for external tooling. The `resolveArena` middleware enforces that an `:arenaId` belongs to `:userId`. Creation is capped at `MAX_ARENAS_PER_USER` (10) per user and `MAX_TOTAL_ARENAS` globally. Keep arena management out of the UI; build it against `/arenas`.

> **Bot roster:** an arena's members (`ArenaMember` rows) can be **enabled or disabled** — a disabled member is pulled from the live match (no `Process`/tanks) but stays in the roster to be re-enabled. Apps may be **added by reference** (another user's app id, e.g. via the `/add-app/:appId` share link): the app is linked in without exposing its source — only its live bots are visible. The live status snapshot and `match_summary` omit disabled members.

## The sandbox (the core of the system)

User bot code is untrusted, so it never runs in the Node process directly — it runs in `isolated-vm` isolates.

- **`Environment`** (`src/types/environment.ts`) is one in-memory arena instance. It is an `EventEmitter`; subscribing to its `event` stream replays current state (place-app / place-tank events) so a freshly connected browser can bootstrap.
- **`Process`** = one app (bot program) in an arena. It owns a single `ivm.Isolate` (8 MB limit) and **5 `Tank` instances** that all share that isolate.
- **`Tank`** (`src/types/tank.ts`) holds per-tank state and its own `ivm.Context` within the process's isolate.

`src/util/compiler.ts` builds the bot-facing API. For each method it sets a native `_bot_*` function on the isolate global, then compiles a thin JS wrapper (`bot.turn`, `bot.radar.scan`, `bot.turret.fire`, `arena`, `clock`, `console`, `setInterval`/`setTimeout`, `Event`, …) that bridges to it. The **`ivm` module is never exposed to bot code** — all `Callback`/`Reference`/`ExternalCopy` objects are built host-side. Asynchronous actions are Promises parked isolate-side and settled by the host via a captured `__settle` reference; events and timers use the same host-pinned dispatch references (`__dispatch`/`__runTimer`). Bot code runs via isolated-vm's async `run`/`apply` (on the thread pool, off the main event loop), each bounded by `SANDBOX_TIMEOUT_MS`. `Date` is set to `undefined` so bots stay deterministic — they use `clock.getTime()` instead.

Two directions cross the host ↔ isolate boundary — an **outbound** command the bot makes, and an **inbound** event the simulation delivers:

```mermaid
sequenceDiagram
  participant Bot as Bot code (isolate)
  participant Host as Host bridge (compiler.ts)
  participant Game as Tank / Simulation

  Note over Bot,Game: Outbound — bot calls a command, e.g. await bot.setSpeed(10)
  Bot->>Host: __asyncCall parks the promise, makes a sync native call (id, 10)
  Host->>Game: tank.setSpeed(10) — side effect applies immediately
  Game-->>Host: returns a promise that settles over ticks
  Host-->>Bot: __settle(id, ok, value) via captured reference — resolves the awaited promise

  Note over Bot,Game: Inbound — simulation fires an event (START / TICK / HIT / …)
  Game->>Host: tank.handlers[event](data)
  Host->>Bot: __dispatch(event, args) via captured reference — async apply, under SANDBOX_TIMEOUT_MS
  Bot-->>Host: handler runs off the main thread; resolve/reject report completion
```

The host pins the `__settle`, `__dispatch`, and `__runTimer` references at init (before any bot code runs), so a bot cannot reassign those globals to intercept what the host invokes.

`npm run smoke` (`scripts/ivm-smoke.js`) is a quick check that the native module loads and the exact API patterns compiler.ts depends on (ExternalCopy round-trips incl. `copyInto`, the host-settled async-call bridge, event dispatch via a captured Reference, and async `apply` honoring a timeout) still work — run it after any Node or isolated-vm version change.

## The simulation loop

- `Environment.resume()` runs a **self-scheduling async loop** (`runLoop` → `tick` → `drainBotWork`), _not_ a fixed `setInterval`: each tick runs the physics, then **awaits** that tick's bot work (handlers, timers, command settlements) before the next tick starts. That await is what makes the sim **deterministic at any speed**. Cadence is set by `setSpeed` (`POST .../arena/speed`, `set_arena_speed`): a multiplier (`1` = the default ~10 ticks/s) or `0`/`"max"` for unbounded. The clock advances by 1 per tick and **resets to 0 on `restart()`**, so a new match never inherits the previous match's sudden-death state.
- `src/util/simulation.ts` (`Simulation.run`) is the physics/interaction engine: it kills crashed bots, runs `START` then `TICK` handlers, fires timers, recharges radar/turret, moves tanks, detects tank collisions and bullet hits, applies damage, and emits events. After `SUDDEN_DEATH_TIME` ticks it decays health to force a winner; `Environment.tick` records each tank's death tick on `Tank.eliminatedAt` for the match summary.
- **Deterministic seeds:** each `Environment` has a seeded PRNG (`src/util/random.ts`, mulberry32) driving tank placement/orientation and each bot's in-isolate `Math.random`. A fixed seed (`setSeed`, `POST .../arena/seed`, `set_arena_seed`) reproduces a match exactly; combined with the tick-driven loop and unbounded speed, accelerated headless runs are fully repeatable. The default seed is nondeterministic, so unseeded arenas still vary.
- **Timers are tick-driven** (`src/util/scheduleFactory.ts`): bot `setInterval`/`setTimeout` are monkey-patched to advance with simulation ticks rather than wall-clock time, so the game can pause, resume, and reset them. Keep this in mind — a bot's `setTimeout(fn, 50)` means 50 _ticks_, not 50 ms. Each tank is capped at `MAX_TIMERS_PER_TANK` (excess registrations refused with error `E021`).

## Services & data model

`src/services/*Service.ts` are singleton data-access objects:

- **Postgres-backed:** `UserService`, `AppService`, `ArenaService`, `ArenaMemberService` (the arena roster — each `ArenaMember` row carries an `enabled` flag), `IdentityService`, `DemoService`.
- **In-memory:** `EnvironmentService` keeps a `Map<arenaId, Environment>` of running arenas and disposes an environment (freeing its isolates) 30 minutes after it stops.

Domain types and DTOs live in `src/types/` (`Tank`, `Arena`, `Environment`/`Process`, `Bullet`, `Clock`, `TankStats`, plus plain DTOs). `ErrorCodes.ts` defines the `E0xx`/`W0xx` codes surfaced in bot logs (e.g. `E021` timer cap, `E022` rate limit).

## Auth

The UI posts the Google credential to **`POST /api/session`**, which verifies it and sets an **HttpOnly, `SameSite=Lax`** `auth` cookie server-side (`Secure` when `NODE_ENV=production`); `DELETE /api/session` logs out (`src/api/session.ts`). `src/middleware/auth.ts` then verifies that cookie's id token on each request — checking its **audience** against `GOOGLE_CLIENT_ID` — and attaches `req.user`. A user record is auto-created on first login (rejected when `email_verified` is false). `/api/user` and `POST /api/mcp` are hard-gated by `auth(true)`; the MCP route resolves the actor from a **bearer API token** instead of the cookie (`src/api/token.ts`, stored only as a sha256 hash).

Ownership is enforced by two middlewares (`src/middleware/resource.ts`): **`requireOwner`** asserts the actor owns the `:userId`/arena (scopes mutating arena + user routes), and **`requireAppOwner`** guards the confidential/destructive app routes — source read/write, delete, compile, reboot (the A01 IDOR fix). Cross-user **metadata** reads (names + ids, never source) and **add-by-reference** stay open by design, for spectating and share-links. The full access model, plus the rest of the security posture, is in [`../SECURITY.md`](../SECURITY.md) and summarized under [Security](#security--resource-limits).

## MCP server

`src/api/mcp.ts` is an in-process [Model Context Protocol](https://modelcontextprotocol.io) server at **`POST /api/mcp`** (Streamable HTTP, stateless — a fresh server + transport per request), so an AI client (Claude, or any MCP client) can write, run, and watch bots. It's gated by `auth(true)`, resolving the acting user from a **bearer API token** (minted via `src/api/token.ts`); every tool acts only on that user's own resources — `ownedApp`/`ownedArena` mirror the REST ownership checks, so there's no cross-user addressing.

`buildServer(user)` registers ~23 user-scoped **tools**:

- **Bots:** `list_bots`, `get_bot_source`, `create_bot`, `set_bot_source`, `rename_bot`, `compile_bot`, `check_bot_source` (dry-run compile), `reboot_bot`, `delete_bot`.
- **Arenas:** `list_arenas`, `create_arena`, `delete_arena`, `arena_status`, **`match_summary`** (leaderboard / winner / elimination order), `add_bot_to_arena`, `remove_bot_from_arena`, `pause_arena`, `resume_arena`, `restart_arena`, `set_arena_speed`, `set_arena_seed`.
- **Observation:** `recent_logs` (filterable), `recent_faults` (structured crash records).

Plus **resources** (`robocodejs://` — the bot docs, `robocode.d.ts`, sample bots, and the error-code reference) and **prompts** (`write_bot`, `debug_bot`, `run_match`). Tools carry behaviour annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`) and object-returning tools return validated `structuredContent`. The user-facing setup guide is served at `/mcp` (`../ui/public/docs/mcp.md`). The REST caps (`MAX_APPS_PER_ARENA`, etc.) are mirrored by hand in `mcp.ts` — keep them in sync.

## Security & resource limits

Untrusted user code plus shared, multi-user arenas make **access control, sandbox integrity, and resource exhaustion** the top concerns. The hardening in place (see [`../SECURITY.md`](../SECURITY.md) for the full OWASP audit — findings, fixes, and accepted risks):

- **Access control** — `requireOwner` + `requireAppOwner` (above); metadata/spectating open by design.
- **HTTP hardening** — `helmet` with a CSP tuned to the real bundle (`src/middleware/securityHeaders.ts`): `frame-ancestors`/`X-Frame-Options`, `nosniff`, HSTS, `object-src 'none'`.
- **Rate limiting** — `src/middleware/rateLimit.ts`: IP-keyed auth limiter (sign-in/token), user-keyed compute (isolate-spawning check/compile/reboot) and write (app/arena creation) limiters, and a broad `api` backstop. Refusals return `429` with error code `E022`.
- **Resource caps** — per-tank timers (`MAX_TIMERS_PER_TANK`, `E021`), per-user apps (`MAX_APPS_PER_USER`) and arenas (`MAX_ARENAS_PER_USER`), a global `MAX_TOTAL_ARENAS` ceiling, the 8 MB per-isolate memory limit, and `SANDBOX_TIMEOUT_MS` per synchronous entry into bot code.
- **Transport** — RDS connections verify the server cert against a vendored CA bundle by default (`sslConfig` in `src/util/db.ts`).

## Server ↔ UI communication

Live arena state is pushed to the browser via **Server-Sent Events**:

- `GET /api/user/:userId/arena/events` — game events (ticks, movement, fire, hits, place/remove app & tank, pause/resume).
- `GET /api/user/:userId/arena/logs` — bot `console` output.

The UI consumes these and interpolates motion between server ticks with its own partial physics mirror. **If you change movement or collision math here, update `ui/src/util/simulate.ts` to match.**

## Logging & monitoring

The server uses a structured [pino](https://getpino.io) logger (`src/util/logger.ts`) — **distinct from the per-tank bot `console` output**, which is streamed to the UI via browser-bunyan. It emits pretty, human-readable lines in local dev and JSON in production (for ingestion by a log pipeline), is silenced under test, and honors `LOG_LEVEL`. One line is logged per HTTP request (method, path, status, duration) via `pino-http`, skipping the long-lived SSE streams and `/health`.

Beyond ordinary info/debug logs, a set of **named fault/security events** is logged with a stable `event` field so a pipeline can alert on them. Each carries relevant context (`appId`, `arenaId`, `tankId`, etc.):

| `event`                | Level       | Meaning / why monitor                                                                                                                                                                                                                                                       |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot.fault`            | warn        | A bot crashed (`kind`: `load`/`init`/`handler`/`timer`/`callback`, or `log-flood`). **`timedOut: true`** means it tripped `SANDBOX_TIMEOUT_MS` — a runaway loop or possible sandbox-escape attempt; alert on these specifically. A rising overall rate signals broken bots. |
| `sandbox.catastrophic` | error       | A fatal V8 error in an isolate — typically the 8 MB memory limit (runaway allocation / abuse).                                                                                                                                                                              |
| `auth.failed`          | warn        | A gated route rejected an invalid/expired credential. A spike suggests probing or a token problem.                                                                                                                                                                          |
| `auth.forbidden`       | warn        | An authenticated user tried to act on **another** user's resource (`actor`/`target`) — potential abuse.                                                                                                                                                                     |
| `db.error`             | error       | Database/pool error (lost connection, auth failure).                                                                                                                                                                                                                        |
| `http.error`           | error       | An unhandled error reached the Express error handler (a 5xx).                                                                                                                                                                                                               |
| `process.fatal`        | error/fatal | An `unhandledRejection` or `uncaughtException` escaped to the process.                                                                                                                                                                                                      |

Note: a bot choosing **not** to await a command whose promise later rejects (e.g. a cancelled `bot.setSpeed`) is normal and is **not** logged as a fault or treated as a crash.

## Tests

[Vitest](https://vitest.dev) suites live in `test/` (kept out of `src` so they're excluded from the `tsc` build). Run with `npm test`. Coverage so far:

- `test/simulation.test.ts` — the simulation physics (movement, acceleration, rotation, tank/boundary collisions, bullet hits and lifetimes). `Simulation.run` only invokes `tank.handlers[...]` and mutates plain fields, so the tests drive it with lightweight mock tanks — no real isolates required.
- `test/scheduleFactory.test.ts` — the tick-driven timers.
- `test/tankTypes.test.ts` — the `Tank`/`TankTurret`/`TankRadar` classes (turn/accelerate targeting, `send` messaging, turret `fire`, radar `scan` detection geometry). These classes transitively import `util/db`, so the suite `vi.mock`s the db pool to avoid touching Postgres and builds a **real** `Tank` against a mock environment whose `isRunning()` returns false (so `waitUntil`-based methods settle immediately instead of leaving polling timers running).
- `test/compiler.test.ts` — integration tests that spin up a **real** isolated-vm isolate, have `compiler.init` build the bot API into it, then compile/run bot code in the sandbox and read values back out (`{copy:true}`): synchronous getters, `Date`/Node-global removal, mutating commands, the `bot.on`/`clock.on` dispatch bridge, `console.log` routing and per-tick log capping, timer registration, and the security invariants — `ivm`/`Reference`/`ExternalCopy` are **not** reachable from bot code, async results/rejections cross the boundary correctly, the per-call timeout terminates a runaway timer, and `setName` is sanitized and length-bounded.
- `test/simulationIntegration.test.ts` — the **full sandbox + simulation path**: a real bot is compiled into a real isolate, then driven through `Simulation.run` tick by tick (manually advancing the clock, with a short settle for the now-async handlers) and the resulting tank state asserted. It covers the isolate-exposed capabilities end-to-end: movement/acceleration, absolute (`setOrientation`) and relative (`turn`) rotation, firing a travelling bullet, **radar `scan` detecting an enemy** (with `SCANNED`/`DETECTED` events and the hit-list fields), `COLLIDED` on a wall impact, `send`→`RECEIVED` messaging between bots, `clock.getTime()` driving behavior off the advancing clock, the `FIRED` event, `dropMarker`/`arena.createMarker` geometry, a crashing handler getting the bot killed, a tick-driven `setTimeout`, and one tank destroying another with sustained fire (`HIT` damage). This is the live game loop minus the 100ms interval and the database. Note body/turret/radar orientations start random, so tests that aim set `orientation`/`orientationTarget` explicitly for determinism.
- `test/api.test.ts` — Express endpoints via [supertest](https://github.com/ladjs/supertest), with the data-access singletons `vi.mock`ed so handlers run with no Postgres/isolates. Covers health, the user/app endpoints, and the shared 404-unknown / 401-not-owner authorization boilerplate.
- `test/auth.test.ts` — the Google-OAuth auth middleware: recognized token attaches the user, first login auto-creates one, and an invalid token 401s when required / falls through when optional. Mocks `google-auth-library` (via `vi.hoisted`) and the user/identity services.
- `test/services.test.ts` — the Postgres data-access services (`AppService`, `ArenaService`, `ArenaMemberService`): `vi.mock`s the pool with canned result sets and asserts the row→domain-object mapping and `undefined`-on-empty.
- `test/nameFactory.test.ts` — display-name generation.
- `test/logger.test.ts` — the `logBotFault` monitoring contract: the structured `bot.fault` payload (ids, `kind`) and the `timedOut` flag that lets runaway/abuse be alerted on separately.

When testing other isolate-/DB-coupled code, follow the same pattern: `vi.mock('../src/util/db', ...)` (or mock the relevant service modules) at the top of the file, then construct real domain objects / mount routers with mock collaborators.

## Build & deploy

`npm run build` compiles `src/` to `dist/`. In production the server also serves the UI from `dist/public` (the `ui` build writes there). Deployment is AWS CodeBuild (`../buildspec.yaml`) → Elastic Beanstalk (`.ebextensions/`).
