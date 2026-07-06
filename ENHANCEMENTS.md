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
- ✅ **Prominent error/crash surfacing.** (S–M) _Shipped._ Every fatal fault now
  emits a structured `botFault` (code, kind, message, and the failing line where
  the isolate provides one), buffered per-arena. In the UI a crashed bot shows a
  ⚠️ warning triangle over its tank, the editor pops a red banner with the code +
  message and marks the failing line in the gutter; for AI clients a `recent_faults`
  MCP tool and `arena_status.crashed` expose the same. Complements the pre-deploy
  **Check** button and the [`/error-codes`](/error-codes) page.
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
- ✅ **Match scoring & stats.** (S–M) _Shipped._ A `match_summary` MCP tool and a
  REST `GET .../arena/summary` endpoint (shared `server/src/util/matchSummary.ts`)
  surface an outcome-oriented view: a leaderboard ranked by who's winning/won, the
  resolved winner, aggregated per-bot stats (shots, accuracy, damage taken,
  distance, collisions — from `TankStats`), survival (tanks alive, total health),
  and elimination order. The match is "decided" the moment one bot is left
  standing (even while the engine keeps ticking the survivor).
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
- ✅ **Private/friend arenas.** (S–M) _Shipped._ A **Share** button copies an
  `/add-app/:appId` link; a signed-in friend confirms and the referenced bot is
  linked **by reference** into their arena roster — the app is never copied and
  its source stays owner-private, only its live bots are visible — so friends can
  battle each other's bots in a shared arena. Built on the arena bot-roster
  (enable/disable + add/unlink by reference) over the multi-arena API.
- **Public live spectating.** (M) A read-only "watch live" view of ongoing
  battles (the demo arena already streams publicly to signed-out users).
- **Achievements / badges.** (S) First kill, flawless victory, 1000 shots, etc.

## 4. Developer experience (tech-enthusiast appeal)

_The features that make hacker-news-type users want to play and share._

- **Headless simulation / CLI.** (M) A command (or thin client over the existing
  `/arenas` API) to run a match between bots without the UI — enables scripting,
  local iteration, and CI for your bot. The multi-arena API was built for exactly
  this kind of tooling.
- ✅ **Configurable, deterministic simulation speed.** (M) _Shipped._ The arena
  tick rate is set via `POST .../arena/speed` and the `set_arena_speed` MCP tool —
  a multiplier (1 = the default ~10 ticks/s) or `"max"` for unbounded ("as fast as
  possible", for headless/tooling). The tick loop now **awaits each tick's bot
  work** and command completion is **tick-driven** (not wall-clock), so a match
  plays out identically at any speed; the UI adopts the server's rate for playback
  (`Environment.runLoop`/`drainBotWork`, `ui/src/util/playbackBuffer.ts`).
- **Self-play / ML hooks.** (L) A headless, **steppable** match API (run-N-ticks,
  read state) so people can train bots with reinforcement learning. Catnip for the
  ML crowd. The hard prerequisites — a **deterministic** simulation and **seeded
  RNG** — now exist (see below); what remains is an explicit step/read-state
  control (today you approximate it with `set_arena_speed "max"` + `arena_status`).
- ✅ **Deterministic seeds.** (S–M) _Shipped._ Each arena has a seeded PRNG
  (`server/src/util/random.ts`, mulberry32) driving tank placement, starting
  orientations, and each bot's in-isolate `Math.random`, so a fixed seed
  reproduces a match exactly. Set via `POST .../arena/seed`, the `set_arena_seed`
  MCP tool, and reported in the arena status snapshot. In-memory per arena; the
  default seed is nondeterministic, so unseeded arenas still vary.
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
- ✅ **Dark mode toggle.** (S) _Shipped._ A whole-app light/dark theme with a
  header toggle, persisted to `localStorage` and defaulting to the OS preference
  (`ui/src/util/theme.ts`). It drives a `body.dark` CSS-variable theme across the
  app, docs, and log console, the Ace editor theme, and the arena SVG's night-mode
  tint.
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
  `POST /api/mcp` (`server/src/api/mcp.ts`, Streamable HTTP) exposing 23
  user-scoped tools (bot CRUD + compile/`check_bot_source`/reboot, arena
  create/delete/control including `set_arena_speed`/`set_arena_seed`, status,
  `match_summary`, and observation — filterable `recent_logs` + structured
  `recent_faults`),
  **resources** (the bot docs, `robocode.d.ts`, sample bots, the error-code
  reference), and **prompts** (`write_bot`, `debug_bot`, `run_match`).
  Authenticated via OAuth; setup guide at `/mcp`.
- ✅ **OAuth remote-connector auth.** (M–L) _Shipped._ RobocodeJs is its own MCP
  **OAuth 2.1** authorization server (`server/src/api/oauth.ts`,
  `util/oauthProvider.ts`, `services/OAuthService.ts`): discovery metadata +
  dynamic client registration + PKCE, with the browser login delegated to the
  existing Google sign-in on a `/mcp/authorize` UI page (auto-approve, since a
  token only grants access to the user's own account). So **claude.ai / Claude
  Desktop custom connectors** now connect with a one-click **Connect** (no token
  to copy); `/api/mcp` verifies the access token with the SDK's
  `requireBearerAuth`. All OAuth state (clients, single-use codes, access +
  refresh tokens) lives in Postgres and is hash-keyed, so it is replica-safe. The
  static bearer token and `/api/token` are **removed** in favor of this.
- **Connected-clients UI.** (S) Optional: a navbar affordance listing the OAuth
  clients the user has authorized, with a revoke button (delete their
  `oauth_token` rows). Nice-to-have now that connecting is one click — there's no
  longer a token to show.
- ✅ **`check_bot_source` (dry-run compile) tool.** (M) _Shipped._ Compiles a bot's
  source in a throwaway `isolated-vm` isolate and returns the syntax/load error
  (with its `ErrorCode`) **without** adding it to an arena (`compiler.check`). Also
  surfaced as `POST /api/user/:userId/app/:appId/check` and an editor **Check**
  button, so authors and the model catch mistakes before deploying.
- ✅ **Error-code reference resource.** (S) _Shipped._ The `E0xx`/`W0xx` codes now
  have human descriptions authored in `ui/public/docs/error-codes.md`, exposed as
  the `robocodejs://reference/error-codes` MCP resource (for interpreting
  `recent_logs` / `check_bot_source`) and as a `/error-codes` docs page — searching
  a code in the UI deep-links to its entry.
- ✅ **Tool annotations + structured output.** (S) _Shipped._ Every tool carries
  behaviour hints — `readOnlyHint` on reads (`list_bots`, `arena_status`,
  `check_bot_source`, …), `destructiveHint` on `delete_bot`/`delete_arena`,
  `idempotentHint` where applicable — and the object-returning tools declare an
  `outputSchema` and return validated `structuredContent`, so clients can gate
  dangerous actions and consume typed results.
- **Live battle updates (no polling).** (M) Instead of polling `arena_status`,
  use MCP resource-update notifications (or a `recent_events` buffer mirroring the
  `recent_logs` ring) so the model can follow a match as it unfolds.
- **Spectate other/demo arenas.** (S–M) Read-only `arena_status` / `recent_logs`
  for the public demo arena (and opt-in shared arenas), so the model can watch
  battles it isn't a participant in. Pairs with "public live spectating" (§3).
- **Rate limiting + audit logging.** (M) Access tokens grant full control of a
  user's bots/arenas; add a dedicated per-user MCP rate limit (today `/api/mcp`
  shares the `/api` backstop) and log MCP mutations (tool, user, client) via the
  structured logger (`LogEvent`) for security observability. Pairs with the
  global isolate-cap item in `TASKS.md`.
- **`run_tournament` prompt/tool.** (S–M) Round-robin a set of bots and report a
  ranking, building on `run_match` and the multi-arena API — a natural feeder for
  the leaderboard idea (§3).
- **End-to-end bearer auth test.** (S) The MCP tools are tested over an in-memory
  transport; the OAuth flow (register → authorize → exchange → verify → refresh →
  revoke) is covered in `test/oauth.test.ts` against pg-mem, and an unauthenticated
  `POST /api/mcp` is asserted to 401 with `WWW-Authenticate`. Still missing: a test
  that drives `/api/mcp` through a real access-token `Authorization: Bearer` header.

---

## Suggested "quick wins" (high impact / low effort, leverage existing code)

1. **Fork-this-example** buttons + **starter templates** — turn the docs into action. (S)
2. ✅ **Editor autocomplete + bot-API type defs** — the top onboarding lever. (M) _Shipped._
3. ✅ **Dark-mode toggle** — the plumbing already existed; whole-app theme + header toggle. (S) _Shipped._
4. ✅ **Surface bot crashes in the UI** — structured `botFault` + tank warning + editor banner. (S–M) _Shipped._
5. ✅ **Friend/private arenas** — share-link add-by-reference + arena roster. (S–M) _Shipped._
6. ✅ **Match score summary** — `match_summary` tool + `/summary` endpoint over `TankStats`. (S–M) _Shipped._
7. ✅ **One-click MCP connect (OAuth)** — claude.ai / Desktop connectors work with no token. (M–L) _Shipped._

## Bigger bets (highest popularity upside)

- **Leaderboard / ranked ladder** + **bot sharing** (the competitive + social flywheel).
- **Replays** (the most shareable artifact).
- **Headless sim + ML hooks** (the tech-enthusiast magnet) — the groundwork is now
  in place (deterministic simulation, seeded RNG, and unbounded `"max"` speed
  ✅); what remains is an explicit step/read-state API and a CLI.
- ✅ **OAuth remote-MCP auth** _(shipped)_ — claude.ai / Claude Desktop connect
  with one click (the model as a player and pair-programmer for the broadest
  audience).
