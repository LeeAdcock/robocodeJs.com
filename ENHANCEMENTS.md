# RobocodeJs — enhancement ideas

A menu of features and capabilities still to consider — to make RobocodeJs more
**fun**, more **approachable**, and more **popular** with a broad range of tech
enthusiasts, from curious beginners to competitive programmers and ML tinkerers.

These are ideas, not commitments. Effort is a rough hint: **S** ≈ <½ day, **M** ≈
1–2 days, **L** ≈ multi-day. Several deliberately build on things that already
exist in the codebase (the multi-arena API, the `isolated-vm` sandbox, SSE
streaming, the `dropMarker` API).

---

## 1. Approachability & onboarding

_Lower the barrier so a first-time visitor writes a working bot in minutes._

- **Interactive guided tutorial.** (M) A step-by-step overlay that walks a new
  player through naming, moving, scanning, and firing — building on the existing
  homepage tutorial but live in the editor with "try it" checkpoints.
- **"Fork this example" buttons.** (S) On the Examples page, one click clones a
  sample into the user's apps and drops it in the arena. Turns reading into doing.
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
- **Replays.** (M–L) The arena is already an event stream — persist a match's
  events and add a replay player (scrub, slow-mo). Hugely shareable.

## 3. Competition & community

_The flywheel for popularity: ranking, sharing, and watching._

- **Bot sharing / gallery.** (M) Publish a bot (read-only) for others to view and
  clone. Browsing real strategies is both fun and a learning tool.
- **Leaderboard & ranked ladder.** (M–L) Run published bots against each other
  (headless, via the multi-arena API) and rank by Elo. The competitive hook.
- **Tournaments & weekly challenges.** (M) Scheduled brackets, a "boss bot" to
  beat, or "survive 60 seconds" puzzles. Recurring reasons to come back. (The
  `run_tournament` MCP tool already round-robins a set of bots — a natural
  building block.)
- **Public live spectating.** (M) A read-only "watch live" view of ongoing
  battles (the demo arena already streams publicly to signed-out users).
- **Achievements / badges.** (S) First kill, flawless victory, 1000 shots, etc.

## 4. Developer experience (tech-enthusiast appeal)

_The features that make hacker-news-type users want to play and share._

- **Headless simulation / CLI.** (M) A command (or thin client over the existing
  `/arenas` API) to run a match between bots without the UI — enables scripting,
  local iteration, and CI for your bot. The multi-arena API was built for exactly
  this kind of tooling.
- **Self-play / ML hooks.** (L) A headless, **steppable** match API (run-N-ticks,
  read state) so people can train bots with reinforcement learning. Catnip for the
  ML crowd. The hard prerequisites already exist — a **deterministic** simulation,
  **seeded RNG**, and unbounded `"max"` speed — so what remains is an explicit
  step/read-state control (today you approximate it with `set_arena_speed "max"` +
  `arena_status`).
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

- **Connected-clients UI.** (S) Optional: a navbar affordance listing the OAuth
  clients the user has authorized, with a revoke button (delete their
  `oauth_token` rows). Nice-to-have now that connecting is one click.
- **Live battle updates (no polling).** (M) Instead of polling `arena_status`,
  use MCP resource-update notifications (or a `recent_events` buffer mirroring the
  `recent_logs` ring) so the model can follow a match as it unfolds.
- **Spectate other/demo arenas.** (S–M) Read-only `arena_status` / `recent_logs`
  for the public demo arena (and opt-in shared arenas), so the model can watch
  battles it isn't a participant in. Pairs with "public live spectating" (§3).
- **Dedicated per-user MCP rate limit.** (S–M) Today `POST /api/mcp` shares the
  broad `/api` backstop; add a dedicated per-user limit since an access token
  grants full control of a user's bots/arenas. (Audit logging of MCP mutations via
  the structured `LogEvent` `mcp.tool` is already in place.)
- **End-to-end bearer auth test.** (S) The MCP tools are tested over an in-memory
  transport, and the OAuth flow (register → authorize → exchange → verify → refresh
  → revoke) is covered in `test/oauth.test.ts`. Still missing: a test that drives
  `/api/mcp` through a real access-token `Authorization: Bearer` header.
- **Partial / config source updates.** (S–M) `set_bot_source` replaces the whole
  program, so tuning one constant means resending the entire bot each iteration. Add
  a patch path or a `set_bot_config(appId, {...})` that merges a small config object,
  to shrink iterative-tuning payloads (a model may resend a bot 10–15× while tuning).
- **Settable arena config on create.** (S–M) Expose arena size and sudden-death /
  max-tick timing on `create_arena` so a model can shorten matches (faster
  tournaments) or vary the battlefield. Pairs with `set_arena_speed`.
- **Batch bot setup.** (S) A `create_bot(…, addToArena)` option (or a bulk add) —
  standing up a 5-bot tournament arena is otherwise ~10 separate calls.
- **Editor live-reload on external edits.** (S–M) When a bot's source changes
  out-of-band — e.g. an MCP client calls `set_bot_source` — the open editor has no
  idea. If that bot is the one on screen, detect the change (an SSE/resource
  notification, or an app version/etag) and reload it live, or surface a
  non-destructive "updated elsewhere — reload?" prompt to protect unsaved edits.
  Keeps the human and the AI pair-programmer on the same source.

---

## Suggested "quick wins" (high impact / low effort, leverage existing code)

- **Fork-this-example** buttons + **starter templates** — turn the docs into
  action. (S)

## Bigger bets (highest popularity upside)

- **Leaderboard / ranked ladder** + **bot sharing** (the competitive + social
  flywheel).
- **Replays** (the most shareable artifact).
- **Headless sim + ML hooks** (the tech-enthusiast magnet) — the groundwork is now
  in place (deterministic simulation, seeded RNG, and unbounded `"max"` speed);
  what remains is an explicit step/read-state API and a CLI.
