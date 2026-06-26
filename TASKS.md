# RobocodeJs — future work

A living backlog for future sessions, written after the 2024 modernization effort
(Node 22, CRA→Vite, Prettier/ESLint unification, security hardening, sandbox
rewrite, multi-arena API, zero-config local dev). Roughly priority-ordered within
each tier. Effort tags: **S** ≈ <½ day, **M** ≈ 1–2 days, **L** ≈ multi-day.

## Now (high priority)

- **Merge `modernize-foundation` → `main`.** (S) The branch is ~40 commits ahead
  of `main` and unmerged — all the modernization work lives only here. Open a PR,
  review, and merge so `main` reflects reality.
- **CI pipeline (GitHub Actions).** (M) No CI exists. Add a workflow that, per
  package, runs install → build (`tsc`) → lint → test on every PR. Note the
  native `isolated-vm` build needs Node 22 + `gcc`/`gcc-c++` on the runner. This
  is the last unfinished item from the original modernization plan.
- **Cap concurrent isolates globally (sandbox review #4).** (M) Per-arena (5 apps)
  and per-user (10 arenas) caps exist, but nothing bounds total `Environment`s/
  isolates across all users beyond the 30-min idle GC — a memory-exhaustion DoS.
  Add a global ceiling in `EnvironmentService` and log when it's hit.

## Soon (medium priority)

- **Upgrade TypeScript 4.9 → 5.x** (both packages). (S–M) Notably behind;
  unlocks newer language/type features and keeps tooling current.
- **Investigate un-awaited bot-command rejections.** (S) A bot that calls e.g.
  `bot.setSpeed(2)` without awaiting produces "Speed change cancelled" rejections
  (seen in the dev battle logs). Confirm these can't become process-level
  `unhandledRejection`s and quiet the log noise.
- **Grow UI test coverage.** (M) Only 3 util suites today (`arenaReducer`,
  `geometry`, `simulate`). Add component/page tests (the SSE-driven `App` state,
  arena rendering, the editor) — `jsdom` + Testing Library.
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
- **React 18 → 19 and Express 4 → 5.** (M) Evaluate and upgrade when convenient.
- **Trim the editor bundle.** (S–M) The lazy `appPage` chunk (ace + prettier) is
  ~1.3 MB / ~380 kB gzip. Already off the initial load; could be slimmed with a
  lighter editor or formatter.
- **Document `ErrorCodes` (E0xx) for bot authors.** (S) Surface what each code
  means in `ui/public/docs`.
- **Tidy `DemoService`.** (S) Move its inline hardcoded bot source into
  `ui/public/samples` and reuse it.
- **Burn down remaining `~18` TODOs** in `server/src` / `ui/src` (e.g. debounce
  `app.setSource` persistence, "only if actual change" guards, validate uploaded
  source). Mostly small.
- **Structured logging / metrics.** (M) Replace scattered `console.log` with a
  structured logger and basic operational metrics.

## Known & accepted (not action items)

- **`showdown` ReDoS** (UI moderate audit finding, no fix available): accepted —
  it only renders our own static `/docs/*.md`, never user input. See the note in
  `markdownPage.tsx`.
- **`isolated-vm` ⇄ Node major coupling** (6.x needs Node ≥22): documented in
  `server/README.md`; move both together on any runtime bump.
