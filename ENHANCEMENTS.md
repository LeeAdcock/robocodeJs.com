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
*Lower the barrier so a first-time visitor writes a working bot in minutes.*

- **In-editor API autocomplete + hover docs.** (M) The editor is Ace; wire up
  completions and signature help for the `bot`/`arena`/`clock` API and the
  `Event` enum. The single biggest quality-of-life win for new authors — no more
  hunting the docs for method names.
- **Bundled TypeScript type definitions for the bot API.** (S–M) Ship a `.d.ts`
  describing `bot`, `arena`, `clock`, events, and scan results. Powers the
  autocomplete above and lets advanced users author bots with full typing.
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
*More to do, more ways to win, more reasons to iterate.*

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
*The flywheel for popularity: ranking, sharing, and watching.*

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
*The features that make hacker-news-type users want to play and share.*

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
*Make it feel good on every screen and connection.*

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

---

## Suggested "quick wins" (high impact / low effort, leverage existing code)
1. **Fork-this-example** buttons + **starter templates** — turn the docs into action. (S)
2. **Editor autocomplete + bot-API type defs** — the top onboarding lever. (M)
3. **Dark-mode toggle** — the plumbing already exists. (S)
4. **Surface bot crashes in the UI** — the `bot.fault` data is already there. (S–M)
5. **Friend/private arenas** — the multi-arena API already supports it. (S–M)
6. **Match score summary** — `TankStats` is already collected. (S–M)

## Bigger bets (highest popularity upside)
- **Leaderboard / ranked ladder** + **bot sharing** (the competitive + social flywheel).
- **Replays** (the most shareable artifact).
- **Headless sim + deterministic seeds + ML hooks** (the tech-enthusiast magnet).
