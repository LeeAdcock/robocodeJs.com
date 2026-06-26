# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

RobocodeJs is a browser-based programming game where users write JavaScript "bots" (tank AIs) that battle in teams in a shared arena. It is a two-package monorepo plus a tiny root dev proxy:

- `index.js` — root dev reverse proxy (port 5000). Routes `/api` and `/health` → `:8080` (server), everything else → `:3000` (ui). This is the port forwarded by `.devcontainer`.
- `server/` — Express + TypeScript API and the game simulation engine (port 8080). Package `@battletank/server`.
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

Both packages use **Vitest** (`npm test` runs `vitest run`, `npm run test:watch` for watch mode). Tests live in each package's `test/` directory (outside `src`, so they're excluded from the `tsc` build). Current coverage focuses on the pure-ish logic: the server's simulation physics (`test/simulation.test.ts`) and tick-driven timers (`test/scheduleFactory.test.ts`), and the UI's client-side interpolation (`test/simulate.test.ts`). `Simulation.run` is tested with lightweight mock tanks — it only invokes `tank.handlers[...]` and mutates plain fields, so tests need no real isolates.

`ui build` writes directly into `server/dist/public` (`build.outDir` in `ui/vite.config.ts`, with `emptyOutDir` clearing it first), so the server can serve the built UI as static files in production. Deployment is AWS CodeBuild (`buildspec.yaml`) → Elastic Beanstalk (`server/.ebextensions`).

## Runtime requirements

The server requires `node >=22` (see `server/package.json` engines), pinned by the native `isolated-vm` dependency: isolated-vm 6.x requires Node ≥22, 5.x ≥18, and 7.x ≥26 — so the isolated-vm major and the Node major must move together. The dev container (`.devcontainer/devcontainer.json`) runs Node 22. If `isolated-vm` fails to build or load, a Node/isolated-vm version mismatch is the first thing to check; the native build needs `gcc`/`gcc-c++` (provided in the container and in `server/.ebextensions/options.config` for Elastic Beanstalk).

The server needs Postgres via `RDS_*` env vars (`RDS_USERNAME`, `RDS_HOSTNAME`, `RDS_DB_NAME`, `RDS_PASSWORD`, `RDS_PORT`); see `server/src/util/db.ts`. Services create their own tables lazily with `CREATE TABLE IF NOT EXISTS` at import time.

## Architecture

### Bot sandboxing (the core of the system)

User bot code is untrusted JavaScript run in `isolated-vm` isolates — this is the central design constraint.

- An **`Environment`** (`server/src/types/environment.ts`) is one arena instance held in memory. `EnvironmentService` keeps a `Map<arenaId, Environment>` and disposes environments 30 minutes after they stop (isolate cleanup).
- Each **`Process`** = one app (bot program) in an arena, owns one `ivm.Isolate` sandbox (8 MB limit) and **5 `Tank` instances** that all share that isolate.
- `util/compiler.ts` is where the bot-facing API is built: for every method it sets a native `_bot_*` function on the isolate global, then compiles a thin JS wrapper (`bot.turn`, `bot.radar.scan`, `bot.turret.fire`, `arena`, `clock`, `console`, `setInterval/setTimeout`, `Event`, etc.) that bridges to it. **The `ivm` module is never exposed to bot code** (per isolated-vm's security guidance): all `Callback`/`Reference`/`ExternalCopy` objects are built host-side. Async bot APIs are Promises parked in an isolate-side `__pending` table and settled by the host via a captured `__settle` reference; events and timers use the same dispatch-table pattern (`__dispatch`/`__runTimer`), with the host pinning those references at init so a bot can't reassign them. Bot code (script load, event handlers, timer callbacks) runs via isolated-vm's **async `run`/`apply`** — on the thread pool, off the main event loop — each bounded by `SANDBOX_TIMEOUT_MS` (default 5s); a timeout or throw sets `tank.appCrashed` and Simulation kills the bot. `Date` is deliberately set to `undefined` to keep bots deterministic — bots use `clock.getTime()`.
- The bot API surface lives entirely in `compiler.ts`; bot-author documentation is in `ui/public/docs/*.md` and example bots in `ui/public/samples/*.js`.

### Simulation loop

- `Environment.resume()` starts a `setInterval(..., 100)` that calls `simulate()` each tick; `clock.time` increments by 1 per tick.
- `util/simulation.ts` (`Simulation.run`) is the physics/interaction engine: runs START/TICK handlers, fires timers (`scheduleFactory.timerTick`), moves tanks, detects collisions and bullet hits, applies damage, and emits events. After a "sudden death" time it decays health to force a winner. A crashed bot (`tank.appCrashed`) is killed.
- Timers are **monkey-patched** (`util/scheduleFactory.ts`): bot `setInterval`/`setTimeout` are driven by simulation ticks, not real time, so the game can pause/resume/stop them.

### Server <-> UI communication

- REST endpoints live in `server/src/api/*.ts` (`app`, `arena`, `user`, `demo`, `help`, `health`), wired up in `index.ts`. Most are namespaced under `/api/user/:userId/...`.
- Live arena state streams to the browser via **Server-Sent Events**: `GET /api/user/:userId/arena/events` (game events) and `/arena/logs` (bot console output). The `Environment` is an `EventEmitter`; adding an `event` listener replays current state (place app/tank events) so a new client can bootstrap.
- The UI (`ui/src/App.tsx`) consumes the SSE stream and applies a large per-event-type reducer to its arena state. Between server ticks it runs its **own** client-side physics (`ui/src/util/simulate.ts`, a partial mirror of the server's `simulation.ts`) to interpolate smooth motion. Keep these two simulations consistent when changing movement math.

### Auth

`server/src/middleware/auth.ts` verifies a Google OAuth id token (checking its **audience** against `GOOGLE_CLIENT_ID`, which must match the client id the UI signs in with) stored in the `auth` cookie. The cookie is set **server-side and HttpOnly** by `POST /api/session` (the UI posts the Google credential there; `DELETE /api/session` logs out) — see `server/src/api/session.ts`. A user record is auto-created on first login. Only `/api/user` is hard-gated (`auth(true)`); mutating endpoints additionally enforce ownership via the `requireOwner` middleware.

### Services & types

`server/src/services/*Service.ts` are singleton data-access objects over Postgres (User, App, Arena, ArenaMember, Identity, Demo) plus the in-memory `EnvironmentService`. `server/src/types/*` hold both domain classes (`Tank`, `Arena`, `Environment`, `Process`) and plain DTOs; `ui/src/types/*` mirror the wire DTOs. `ErrorCodes.ts` defines the `E0xx` codes surfaced in bot logs.

## Conventions

- A user can own multiple arenas. Each arena action route is registered at **two paths sharing one handler** (`api/arena.ts`, via the `dual()` helper): `/api/user/:userId/arena/...` resolves the user's **default arena** (first by creation time, lazily created if none) and is what the UI uses, while `/api/user/:userId/arenas/:arenaId/...` addresses a **specific arena** and is intended for tooling. The `resolveArena` middleware (`middleware/resource.ts`) picks the right one and enforces that an `:arenaId` belongs to `:userId`. The collection lives at `/api/user/:userId/arenas` (GET list, POST create — capped at `MAX_ARENAS_PER_USER`), with `DELETE .../arenas/:arenaId` to tear one down. Keep the UI single-arena: add arena management to tooling against `/arenas`, not the UI.
- Code style is enforced by prettier + eslint with `--fix`; one root `.prettierrc.json` governs the whole repo, eslint is per-package (each resolves its own plugins). Run the package `lint` script rather than hand-formatting.
