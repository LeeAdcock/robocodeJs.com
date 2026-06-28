# RobocodeJs — enhancement ideas

A menu of features and capabilities to make RobocodeJs more **fun**, more
**approachable**, and more **popular** with a broad range of tech enthusiasts —
from curious beginners to competitive programmers and ML tinkerers.

These are ideas, not commitments. Effort is a rough hint: **S** ≈ <½ day, **M** ≈
1–2 days, **L** ≈ multi-day. Several deliberately build on things that already
exist in the codebase (the multi-arena API, the `isolated-vm` sandbox, SSE
streaming, the `dropMarker` API, the unused `darkMode` flag).

---

## 1. Approachability & onboarding

_Lower the barrier so a first-time visitor writes a working bot in minutes._

- ✅ **In-editor API autocomplete + hover docs.** (M) _Shipped._ A context-aware
  Ace completer (`ui/src/page/app/appEditor.tsx`) offers the right members after
  `bot.`, `bot.radar.`, `arena.`, `clock.`, and `Event.`, each with its signature
  and a hover description.
- ✅ **Bundled TypeScript type definitions for the bot API.** (S–M) _Shipped._
  A `.d.ts` describing `bot`, `arena`, `clock`, events, markers, and scan results
  is published at `/ts/robocode.d.ts` and linked from the bot docs. Both it and
  the autocomplete are generated from one model (`ui/src/util/botApi.ts`), kept
  in sync by a snapshot test.
- **Interactive guided tutorial.** (M) A step-by-step overlay that walks a new
  player through naming, moving, scanning, and firing — building on the existing
  homepage tutorial but live in the editor with "try it" checkpoints.
- **"Fork this example" buttons.** (S) On the Examples page, one click clones a
  sample into the user's apps and drops it in the arena. Turns reading into doing.
- **Prominent error/crash surfacing.** (S–M) Bot faults are already logged
  (`bot.fault` events); show them in the UI with the error message and, where
  possible, a line number, instead of a tank quietly dying. Pairs with the
  existing `ErrorCodes`.
- **Starter template picker.** (S) "New bot" offers a few skeletons (aggressive,
  defensive, scout) rather than a blank file.

## 2. Gameplay & fun

_More to do, more ways to win, more reasons to iterate._

- **Game modes beyond deathmatch.** (M each) Last-team-standing (current),
  king-of-the-hill (hold a zone), capture-the-flag, target-practice/time-trial,
  survival-vs-waves. Modes give different strategies a reason to exist.
- **Arena hazards & terrain.** (M) Walls/obstacles that block movement and
  line-of-fire, damage zones, or speed-altering terrain (the renderer already
  draws terrain tiles). Adds spatial strategy.
- **Power-ups.** (S–M) Pickups for health, temporary shield, speed, or rapid
  reload that spawn in the arena. Cheap to add, big on dynamism.
- **Tank classes / loadouts.** (M) Scout (fast, fragile), heavy (slow, armored),
  sniper (long range, slow reload) — tradeoffs that make team composition matter.
- **Match scoring & stats.** (S–M) `TankStats` already tracks shots/hits/
  collisions/messages; surface per-match scores (kills, accuracy, damage,
  survival time) and an end-of-match summary.
- **Replays.** (M–L) The arena is already an event stream — persist a match's
  events and add a replay player (scrub, slow-mo). Hugely shareable.

## 3. Competition & community

_The flywheel for popularity: ranking, sharing, and watching._

- **Bot sharing / gallery.** (M) Publish a bot (read-only) for others to view and
  clone. Browsing real strategies is both fun and a learning tool.
- **Leaderboard & ranked ladder.** (M–L) Run published bots against each other
  (headless, via the multi-arena API) and rank by Elo. The competitive hook.
- **Tournaments & weekly challenges.** (M) Scheduled brackets, a "boss bot" to
  beat, or "survive 60 seconds" puzzles. Recurring reasons to come back.
- **Private/friend arenas.** (S–M) The multi-arena API (`/api/user/:id/arenas`)
  already supports multiple arenas per user — expose an invite/share link so
  friends can battle in a shared arena. Low-hanging given the API exists.
- **Public live spectating.** (M) A read-only "watch live" view of ongoing
  battles (the demo arena already streams publicly to signed-out users).
- **Achievements / badges.** (S) First kill, flawless victory, 1000 shots, etc.

## 4. Developer experience (tech-enthusiast appeal)

_The features that make hacker-news-type users want to play and share._

- **Headless simulation / CLI.** (M) A command (or thin client over the existing
  `/arenas` API) to run a match between bots without the UI — enables scripting,
  local iteration, and CI for your bot. The multi-arena API was built for exactly
  this kind of tooling.
- **Self-play / ML hooks.** (L) A deterministic, headless, steppable match API
  (fixed seed, run-N-ticks, read state) so people can train bots with
  reinforcement learning. Catnip for the ML crowd. Needs seeded RNG first.
- **Deterministic seeds.** (S–M) Seed the simulation's randomness (spawn
  positions, etc.) so matches are reproducible — essential for debugging,
  replays, and fair ranked play. (Today `Math.random` is used directly.)
- **Bot debug-draw.** (S–M) Extend `dropMarker` into a small debug-overlay API
  (draw points/lines/text) so authors can visualize their bot's targeting and
  decisions while it runs.
- **More languages.** (L) Allow bots in Python (or others) via transp-to-JS or
  WASM in the sandbox. Broadens the audience well beyond JS developers.
- **Embeddable arena.** (S–M) An `<iframe>` embed of a live or replayed arena for
  blogs/READMEs — free marketing every time someone shows off their bot.

## 5. Polish, performance & accessibility

_Make it feel good on every screen and connection._

- **Client-side interpolation loop.** (M) Drive smooth motion from a
  `requestAnimationFrame` loop (extrapolating from `simulate.ts`) so animation
  stays fluid even when SSE frames arrive irregularly (e.g. behind a buffering
  proxy/tunnel) instead of relying on per-event CSS transitions.
- **WebSocket transport (option).** (M) Lower-latency, bidirectional alternative
  to SSE; also sidesteps proxy buffering of long-lived HTTP streams.
- **Dark mode toggle.** (S) `ArenaSvg` already accepts a `darkMode` prop with a
  filter — wire up a UI toggle (and persist the preference).
- **Sound effects & music.** (S–M) Fire/hit/explosion cues with a mute toggle —
  surprisingly large impact on "feel."
- **Tank skins / themes.** (S) Cosmetic colors/sprites; a light vanity hook.
- **Responsive / mobile-friendly layout & touch viewing.** (M) Today the layout
  is desktop-split; make spectating work on phones.
- **Accessibility.** (S–M) Color-blind-safe team palettes and proper labels for
  menu controls.

## 6. AI / MCP integration

_Let an AI assistant (Claude, or any MCP client) write, run, and watch bots — the
model as a first-class player and pair-programmer._

- ✅ **In-process MCP server.** (M) _Shipped._ A Model Context Protocol server at
  `POST /api/mcp` (`server/src/api/mcp.ts`, Streamable HTTP) exposing 18
  user-scoped tools (bot CRUD + compile/reboot, arena create/delete/control,
  status, `recent_logs`), **resources** (the bot docs, `robocode.d.ts`, sample
  bots), and **prompts** (`write_bot`, `debug_bot`, `run_match`). Authenticated by
  a per-user API token; setup guide at `/mcp`.
- **OAuth remote-connector auth.** (M–L) Today auth is a static bearer token, so
  only clients that allow a custom header (e.g. Claude Code) can connect.
  Implement the MCP OAuth 2.1 flow so **claude.ai / Claude Desktop custom
  connectors** — which expect interactive OAuth — work too. The single biggest
  lever on reach.
- **Token-management UI.** (S) A navbar affordance to mint / show-once /
  regenerate the API token, instead of the unlisted `GET /api/token/new` URL. The
  endpoints already exist (`server/src/api/token.ts`); this is just UI.
- **Multiple named tokens + per-token revocation.** (S–M) One token per user
  today (revoke = regenerate). Support several labeled tokens with individual
  revocation — needs an id/label column on `identity`, so pair it with the
  `node-pg-migrate` item in `TASKS.md`.
- **`check_bot_source` (dry-run compile) tool.** (M) Compile a bot's source in a
  throwaway `isolated-vm` isolate and return syntax/load errors (and `ErrorCodes`)
  **without** adding it to an arena, so the model catches mistakes before
  deploying. Tightens the write → test → debug loop; reuses `util/compiler.ts`.
- **Error-code reference resource.** (S) Expose the `E0xx`/`W0xx` codes (with
  human descriptions) as an MCP resource so the model can interpret what shows up
  in `recent_logs`. Depends on first documenting them (the "Document `ErrorCodes`"
  TODO in `TASKS.md`).
- **Tool annotations + structured output.** (S) Mark destructive tools
  (`delete_bot`, `delete_arena`) with `destructiveHint` and read-only ones with
  `readOnlyHint`, and add `outputSchema`s, so clients can gate/confirm dangerous
  actions and consume typed results.
- **Live battle updates (no polling).** (M) Instead of polling `arena_status`,
  use MCP resource-update notifications (or a `recent_events` buffer mirroring the
  `recent_logs` ring) so the model can follow a match as it unfolds.
- **Editor live-reload on external edits.** (S–M) When a bot's source changes
  out-of-band — e.g. an MCP client like Claude calls `set_bot_source` — the open
  code editor has no idea. If that bot is the one currently visible in the editor,
  detect the change (an SSE/resource notification, or a version/etag on the app)
  and reload it live — or, to protect unsaved local edits, surface a non-destructive
  "this bot was updated elsewhere — reload?" prompt. Keeps the human and the AI
  pair-programmer working on the same source instead of silently diverging.
- **Spectate other/demo arenas.** (S–M) Read-only `arena_status` / `recent_logs`
  for the public demo arena (and opt-in shared arenas), so the model can watch
  battles it isn't a participant in. Pairs with "public live spectating" (§3).
- **Rate limiting + audit logging.** (M) Non-expiring tokens grant full control of
  a user's bots/arenas; add per-token rate limits and log MCP mutations (tool,
  user, token) via the structured logger (`LogEvent`) for security observability.
  Pairs with the global isolate-cap item in `TASKS.md`.
- **`run_tournament` prompt/tool.** (S–M) Round-robin a set of bots and report a
  ranking, building on `run_match` and the multi-arena API — a natural feeder for
  the leaderboard idea (§3).
- **End-to-end bearer auth test.** (S) The MCP tools are tested over an in-memory
  transport and bearer resolution is unit-tested in `auth.test.ts`, but there's no
  test that drives `/api/mcp` through a real `Authorization: Bearer` request.

### Gaps surfaced while AI-driving the MCP server

_Captured during a live session where an assistant used the MCP server end-to-end:
writing a bot, iterating it through five versions, running a 3-generation
evolutionary tournament (20 configs), and stress-testing the champion. Some items
reinforce ideas above; the rest are new._

- **Simulation speed / tick-stepping control.** (M) _The single biggest limiter._
  Matches run in real wall-clock time (the `setInterval(…, 100)` in
  `Environment.resume`), so a model orchestrating matches must sleep ~20–30s for
  each one — a 3-generation tournament took minutes of pure waiting. Add a
  `step_arena(ticks)` (advance N ticks synchronously and return) and/or a
  `set_tick_rate` tool to fast-forward or run-to-completion. Foundational for
  `run_tournament` (§6) and ML self-play (§4); the steppable match API is
  half-described in §4 but absent from the MCP surface.
- **Match-result / scoreboard tool.** (S–M) Scoring a match today means pulling the
  full `arena_status` (every tank's position + every bullet) and hand-counting
  survivors and summing health. Add a `match_result` / `arena_score` tool returning
  per-app aggregates — alive count, total health, kills, accuracy — and a `state`
  field (`running` | `sudden-death` | `ended` | `winner`). Builds on `TankStats`
  (§2) and removes a large amount of token overhead per match.
- **Deterministic seed on the control tools.** (S–M) Expose a `seed` parameter on
  `restart_arena` / `create_arena` so competing variants face identical spawns —
  essential for fair A/B fitness comparison (single-match results were visibly noisy
  due to random spawns). The MCP surface of the §4 "Deterministic seeds" item.
- **Filterable `recent_logs`.** (S) Add `appId` and minimum-level filters; today one
  chatty bot's per-tick logging can flush the bounded ring buffer and bury every
  other bot's output — including the model's own bot.
- **Partial source / config update.** (S–M) `set_bot_source` replaces the whole
  program, so tuning a single constant means resending the entire engine each
  iteration (done ~15× during the tournament). Add a patch path or a
  `set_bot_config(appId, {...})` that merges a small config object, to shrink
  iterative-tuning payloads.
- **Settable arena config.** (S–M) Expose arena size and sudden-death / max-tick
  timing on `create_arena` so a model can shorten matches (faster tournaments) or
  vary the battlefield. Pairs with the speed/step item.
- **Batch setup.** (S) A `create_bot(…, addToArena)` option (or a bulk add) —
  standing up a 5-bot tournament arena is currently ~10 separate calls.
- _Already captured above, reconfirmed as valuable in use:_ dry-run
  `check_bot_source`, the error-code reference resource, live battle updates without
  polling, and `run_tournament`.

#### Reliability issues observed in use

- **`get_bot_source` returned empty** for a bot that has source (an existing starter
  bot) — source reads should be reliable before a model trusts them for editing.
- **Stale display name in `arena_status`.** After `rename_bot` _plus_ a code
  `setName(...)`, the arena snapshot kept reporting the bot's old in-memory name
  across `restart`/`reboot` — the arena view appears to serve a cached name rather
  than the current app/process name.

---

## Suggested "quick wins" (high impact / low effort, leverage existing code)

1. **Fork-this-example** buttons + **starter templates** — turn the docs into action. (S)
2. ✅ **Editor autocomplete + bot-API type defs** — the top onboarding lever. (M) _Shipped._
3. **Dark-mode toggle** — the plumbing already exists. (S)
4. **Surface bot crashes in the UI** — the `bot.fault` data is already there. (S–M)
5. **Friend/private arenas** — the multi-arena API already supports it. (S–M)
6. **Match score summary** — `TankStats` is already collected. (S–M)
7. **MCP token-management UI** — the `/api/token` endpoints already exist. (S)

## Bigger bets (highest popularity upside)

- **Leaderboard / ranked ladder** + **bot sharing** (the competitive + social flywheel).
- **Replays** (the most shareable artifact).
- **Headless sim + deterministic seeds + ML hooks** (the tech-enthusiast magnet).
- **OAuth remote-MCP auth** (lets claude.ai / Claude Desktop connect — the model
  as a player and pair-programmer for the broadest audience).
