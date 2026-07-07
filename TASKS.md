# RobocodeJs — future work

A living backlog for future sessions, written after the 2024 modernization effort
(Node 24, CRA→Vite, Prettier/ESLint unification, security hardening, sandbox
rewrite, multi-arena API, zero-config local dev). Roughly priority-ordered within
each tier. Effort tags: **S** ≈ <½ day, **M** ≈ 1–2 days, **L** ≈ multi-day.

This file is the **engineering/health backlog**. For product feature ideas
(game modes, leaderboards, onboarding, etc.) see [`ENHANCEMENTS.md`](ENHANCEMENTS.md).

## Now (high priority)

- ✅ **Merge `modernize-foundation` → `main`.** _Done._ The modernization work is
  on `main` (Node 24, Express 5, React 19, Vite, TS 5, etc.).
- ✅ **CI pipeline (GitHub Actions).** (M) _Done._ `.github/workflows/ci.yml` runs,
  per package, `npm ci` → lint → build (`tsc`) → test + `npm audit --audit-level=high`
  on every PR/push, and `.github/dependabot.yml` opens weekly npm + github-actions
  update PRs (added alongside the security hardening — see `SECURITY.md` A06-1).
  Closes the last unfinished item from the original modernization plan.
- ✅ **Cap concurrent isolates globally (sandbox review #4).** (M) _Done._ A global
  `MAX_TOTAL_ARENAS` ceiling (default 1000, env-tunable) is enforced at arena
  creation via `arenaService.count()`, returning **503** at capacity
  (`api/arena.ts`); the 30-minute idle GC still reclaims live isolates. See
  `SECURITY.md` A04-2.

## Soon (medium priority)

- ✅ **Upgrade TypeScript 4.9 → 5.x** (both packages). _Done._ Both packages are on
  TypeScript 5.9, with `pino` v10 and `@typescript-eslint` v8.
- **Graceful shutdown.** (S) On `SIGTERM`/`SIGINT`, dispose isolates and close the
  pg pool so deploys/restarts don't leak native resources.
- **DB schema migrations.** (M) Schema is created ad-hoc via
  `CREATE TABLE IF NOT EXISTS` at import; columns can't evolve safely. Introduce a
  lightweight migration tool (e.g. `node-pg-migrate`).

## Later (nice to have)

- **De-duplicate the simulation math.** (L) `server/src/util/simulation.ts` and
  `ui/src/util/simulate.ts` are hand-kept mirrors; movement/collision changes must
  touch both or client/server drift. Extract a shared module/package.
- **Multi-arena tooling client.** (M) The `/arenas` API exists but has no
  consumer; build a small CLI/script that drives multiple arenas (the original
  motivation for that API).
- ✅ **React 18 → 19 and Express 4 → 5.** _Done._ The UI is on React 19 and the
  server on Express 5.
- **Trim the editor bundle.** (S–M) The lazy `appPage` chunk (ace + prettier) is
  ~1.3 MB / ~380 kB gzip. Already off the initial load; could be slimmed with a
  lighter editor or formatter.
- ✅ **Document `ErrorCodes` (E0xx) for bot authors.** _Done._ Each code is
  described in `ui/public/docs/error-codes.md` (the `/error-codes` page), also
  exposed as the `robocodejs://reference/error-codes` MCP resource.
- **Tidy `DemoService`.** (S) Move its inline hardcoded bot source into
  `ui/public/samples` and reuse it.
- **Burn down remaining `~18` TODOs** in `server/src` / `ui/src` (e.g. debounce
  `app.setSource` persistence, "only if actual change" guards, validate uploaded
  source). Mostly small.
- **Operational metrics.** (M) _Partly done._ Structured logging (pino + request
  logs + named fault/security events — see the server README "Logging &
  monitoring") and now point-in-time **gauges on `/health`**: live arena count,
  running arenas, total isolates, the busiest arena's EMA tick duration
  (`Environment` maintains it in `runLoop`), and process memory (rss/heap) +
  uptime. Kept O(arenas) with no async so it's safe on every ALB health check
  (`util`/`services/EnvironmentService.metrics`, `util/metrics.ts`,
  `api/health.ts`), plus a periodic `event=metrics` **log heartbeat** for
  time-series/alerting (`index.ts`, `METRICS_LOG_INTERVAL_MS`-tunable, off under
  test). Still missing: a `/metrics` scrape endpoint (Prometheus) and alert wiring
  on the `event=*` log fields (e.g. CloudWatch metric filters).

## Known & accepted (not action items)

- **`showdown` ReDoS** (UI moderate audit finding, no fix available): accepted —
  it only renders our own static `/docs/*.md`, never user input. See the note in
  `markdownPage.tsx`.
- **`isolated-vm` ⇄ Node major coupling** (6.x needs Node ≥22): documented in
  `server/README.md`; move both together on any runtime bump.
