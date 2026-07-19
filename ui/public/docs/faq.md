# Frequently asked questions

Quick answers to the questions bot authors ask most, each with a link to the fuller explanation. Can't find yours? The [API reference](/learn/docs) covers every method and event, and the [game rules & physics](/rules) page has every number.

# Writing bots

## Can I use `fetch`, `import`, `require`, or an npm package in my bot?

No. Bot code runs in a secure sandbox that is plain JavaScript plus the game API. There is no network access, no module system, and no browser or Node APIs. Everything a bot can use (`bot`, `arena`, `clock`, `Event`, `console`, `logger`, timers, `Math`, `Promise`) is described in the [API reference](/learn/docs); anything not listed there doesn't exist inside the sandbox. See [code guard rails](/learn/docs#coding-tips).

## Does heavier logic use up a compute budget or slow my bot down?

No. The game is turn-based: it waits for every bot to finish its work for a tick before the world advances, so a careful, expensive decision lands on the **same tick** a quick one would. There is no CPU or "cycle" budget that drains as you think, and no edge to deciding faster — so run the search, do the trig, plan ahead freely. The only limit is a **~5-second-per-handler safety timeout** to catch infinite loops (code `E013`), which is far more than any real decision needs. What actually costs you is measured in **ticks**, not thought: your maneuvers take game-ticks to play out, and a bot may issue at most 100 commands and 50 `bot.send`s per tick. See [thinking time](/learn/docs#thinking-time).

## Do my five bots share variables?

No. Each of your five bots runs its own private copy of your program. Top-level variables and `this` are per-bot, and one bot can't read another's state. The only way bots share anything is by broadcasting messages with `bot.send(...)`, which every bot in the arena (enemies included) can receive. See [messages & your five bots](/rules#messages--your-five-bots).

## I saved my code, so why is my bot still acting on its old state?

Saving reloads your handlers live but deliberately does **not** re-run `START`, so a running bot keeps the state it set up. Use the editor's **Reboot** button (or `Ctrl-Shift-S`) to re-run `START` for a fresh initialization. See [state and the START event](/learn/docs#state-and-the-start-event).

## Why can't I use `Date.now()`?

The game runs in simulated time, so `Date` is removed to keep bots deterministic. Use `clock.getTime()` (the current tick) instead, and note that `setInterval`/`setTimeout` take **ticks**, not milliseconds. See [JavaScript timers](/learn/docs#javascript-timers).

## Are angles in degrees or radians?

**Degrees**, always (`0`–`359`), never radians. Every heading, bearing, and turret or radar orientation is in degrees, and every method that takes an angle expects degrees. JavaScript's `Math.atan2`, `Math.sin`, and `Math.cos` work in **radians**, so convert when you cross between them: degrees are radians `× 180 / Math.PI`. See [directions & the compass](/rules#directions-the-compass).

# Combat & movement

## Why is my bot losing health when nobody is shooting it?

Three quiet drains: a **missed shot** costs the shooter 3 health when the bullet leaves the field, a **collision** with a wall or bot costs 1 health per tick (and stops you), and after ~7,500 ticks **sudden death** decays every bot's health to force a finish. See [combat & health](/rules#combat--health).

## Why does `fire()` fail at the start of every match?

The first 100 ticks (about 10 seconds) are a **deployment window**: turrets are held while bots deploy, so `isReady()` is `false` and `fire()` rejects. Reloading still progresses. `await bot.turret.onReady()` resolves the moment the window opens. See [the turret](/learn/docs#turret).

## Can I set a bullet's power or speed?

No. Every shot is identical: there's no power, heat, or ammunition mechanic (a deliberate difference from [classic Robocode](/classic)). The trade-offs live elsewhere: the reload timer and the 3-health miss penalty. See [turret & radar](/rules#turret--radar).

## I aimed the turret, so why is it no longer pointing at the target?

The turret is mounted on the body, so its orientation is **relative to the bot**: when the body turns, the aimed turret swings with it. Re-aim after turning, or aim just before firing. (The radar stacks the same way, on top of the turret.) See [the turret](/learn/docs#turret).

## Why does `bot.turn(350)` turn left instead of right?

`bot.turn()` sets a target heading — the value you pass is added to your current heading, wrapping at 360° — and the bot rotates there by the shortest route. Turning 350° clockwise and 10° counter-clockwise end at the same heading, so the bot takes the shorter one. Keep values between -180 and 180 and the sign picks the direction: positive turns clockwise, negative counter-clockwise. See [movement](/learn/docs#movement).

# Radar

## Why does my scan come back empty when an enemy is right there?

Two usual causes. The radar detects what's inside its beam (a narrow wedge reaching **600 feet**, one tank-width across at your bot and about 244 feet across at its tip, drawn under the radar in the arena), so it sees far but only where it's pointed, and a distant enemy still needs a reasonably precise sweep. And the radar points where **body + turret + radar** angles add up, since it's mounted on the turret: if the body or turret has turned since you aimed the radar, it's no longer looking where you think. See [the radar](/learn/docs#radar).

## Can other bots tell when I scan?

Yes. Every bot your scan detects receives a `DETECTED` event at that moment. Scanning finds the enemy _and_ announces you to them. See [environment events](/learn/docs#environment-events).

# Matches & the platform

## Why isn't my app on the Global Rankings?

To enter the background ladder an app must have real (non-empty) source, not be flagged broken, not be an untouched starter bot, and both the app and its owner must have been active in the last 3 months, and it appears on the board only after its first ranked match. See [how the rankings work](/rankings).

## Can other players see my source code?

No. Your source is private to your account. Sharing an arena watch link lets others spectate your bots, and sharing an app link lets another player add your app to their arena, but in both cases they only ever see your bots _behaving_, never the code behind them.

## How do I replay the exact same match?

Fix the arena's random seed. A seeded arena lays out identical starting positions and orientations on every restart, and the simulation itself is deterministic. Setting the seed isn't in the UI. It's available to tooling and AI assistants through the [MCP integration](/mcp) (`set_arena_seed`, or `run_match` with a `seed`).

---

See also: the [API reference](/learn/docs), [game rules & physics](/rules), [error codes](/error-codes), and the [Learn course](/learn).
