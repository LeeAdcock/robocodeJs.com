# RobocodeJs — future work

A living backlog of engineering/health work still to be done. Roughly
priority-ordered within each tier. Effort tags: **S** ≈ <½ day, **M** ≈ 1–2 days,
**L** ≈ multi-day.

For product feature ideas (game modes, leaderboards, onboarding, etc.) see
[`ENHANCEMENTS.md`](ENHANCEMENTS.md).

## Soon (medium priority)

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
- **Trim the editor bundle.** (S–M) The lazy `appPage` chunk (ace + prettier) is
  ~1.3 MB / ~380 kB gzip. Already off the initial load; could be slimmed with a
  lighter editor or formatter.
- **Tidy `DemoService`.** (S) Move its inline hardcoded bot source into
  `ui/public/samples` and reuse it.
- **Burn down remaining `~18` TODOs** in `server/src` / `ui/src` (e.g. debounce
  `app.setSource` persistence, "only if actual change" guards, validate uploaded
  source). Mostly small.
- **Operational metrics — remaining.** (S–M) Gauges are already live on `/health`
  and emitted as a periodic `event=metrics` log heartbeat (`util/metrics.ts`,
  `services/EnvironmentService.metrics`, `api/health.ts`, `index.ts`). Alert
  wiring on the `event=*` log fields is **done** — CloudWatch metric-filter alarms
  (`cloudwatch-alarms.config` security events + `cloudwatch-ops-alarms.config`
  reliability events) plus availability/RDS/EC2 alarms, all → the `Alerts` SNS
  topic; EB environment events are emailed too (`options.config`). Still missing:
  a `/metrics` scrape endpoint (Prometheus); host-memory monitoring via the
  CloudWatch agent; and the external `/health` Synthetics canary + CodePipeline
  failure notifications (runbook in `ops/README.md`).

## Known & accepted (not action items)

- **`showdown` ReDoS** (UI moderate audit finding, no fix available): accepted —
  it only renders our own static `/docs/*.md`, never user input. See the note in
  `markdownPage.tsx`.
- **`isolated-vm` ⇄ Node major coupling** (6.x needs Node ≥22): documented in
  `server/README.md`; move both together on any runtime bump.
