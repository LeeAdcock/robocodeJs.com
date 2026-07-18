# Error codes

When a bot misbehaves, RobocodeJs writes a code to that bot's **console log** (the log panel next to the editor). Each code below explains what happened, whether it's **fatal** (the bot is killed and removed from the arena) or **non-fatal** (the bot keeps playing), and how to fix it.

A few codes (like `E022`) are **API-level** (returned by the server to the app or your tooling rather than written to a bot's console) and are noted as such below.

You can also validate a bot before deploying it with the editor's **Check** button, which reports the same codes for compile/load problems.

Where it helps, an entry includes a small example that triggers the code and a fixed version for comparison.

Tip: search a code (e.g. `E017`) in the search box at the top of the site to jump straight to its entry here.

## E001

**Sandbox catastrophic error: fatal.** The bot's sandbox hit a fatal limit, almost always the **8 MB memory cap** from runaway allocation (e.g. an ever-growing array). All of the app's bots are killed. Fix: bound the memory your bot keeps. Don't accumulate unbounded history or large data structures.

```
// Triggers E001: the history grows forever and eventually hits the 8 MB cap
clock.on(Event.TICK, () => {
  this.history.push({ x: bot.getX(), y: bot.getY() })
})
```

```
// Fixed: keep the history bounded
clock.on(Event.TICK, () => {
  this.history.push({ x: bot.getX(), y: bot.getY() })
  if (this.history.length > 100) this.history.shift()
})
```

## E003

**Event dispatch failed: non-fatal.** The game could not deliver an event to one of your handlers. This is rare and usually indicates a platform issue rather than a bug in your code; the bot keeps playing. (An error thrown _inside_ your handler surfaces as [E013](#e013); a rejected promise from an `async` handler as [E019](#e019).)

## E004

**Bot failed to load: fatal.** The bot's code could not be (re)loaded/executed (for example after a save). The bot is stopped. Fix: check your top-level code for errors; the accompanying message names the cause.

## E013

**Event handler failed: fatal.** An event handler threw an error _synchronously_ (before its first `await`), or ran too long and hit the sandbox timeout. The bot is stopped. Note this is different from a promise that _rejects_ inside an `async` handler. That surfaces as [E019](#e019) and is non-fatal. Fix: wrap risky logic in `try/catch`, and keep per-event work well under the 5-second sandbox limit; the message printed alongside the code names the cause.

```
// Triggers E013: an empty scan makes targets[0] undefined, so .angle throws
bot.on(Event.SCANNED, (targets) => {
  bot.turret.setOrientation(targets[0].angle)
})
```

```
// Fixed: guard against the empty scan
bot.on(Event.SCANNED, (targets) => {
  if (targets.length === 0) return
  bot.turret.setOrientation(targets[0].angle)
})
```

Another common trigger: calling a contact method on a **received** contact. A broadcast contact arrives as plain serialized data. Its methods are not serialized.

```
// Triggers E013: a contact sent via bot.send arrives without its methods,
// so .getIntercept is not a function
bot.on(Event.RECEIVED, (message) => {
  const aim = message.getIntercept(bot.turret.BULLET_SPEED)
})
```

```
// Fixed: rebuild the full contact from the serialized data first
bot.on(Event.RECEIVED, (message) => {
  const aim = arena.createContact(message).getIntercept(bot.turret.BULLET_SPEED)
  if (aim) bot.turret.turnTowards(aim.getX(), aim.getY())
})
```

## E017

**Bot script failed to load: fatal.** The bot's source could not be compiled or its top-level code threw while loading. This is the most common code and is exactly what the **Check** button reports:

- a **syntax error** (a typo, an unbalanced brace), or
- an error/throw in top-level code (code outside your event handlers), or
- top-level code that ran too long and hit the sandbox timeout.

Fix: use **Check** (or format with the code button) to locate the syntax error; keep top-level code minimal. Do work inside `clock.on(Event.TICK, ...)` and the other event handlers rather than at the top level.

```
// Triggers E017: the handler's closing brace is missing
clock.on(Event.TICK, () => {
  bot.setSpeed(5)
)
```

```
// Fixed: balanced braces
clock.on(Event.TICK, () => {
  bot.setSpeed(5)
})
```

## E018

**Sandbox init failed: fatal.** An internal error occurred while setting up the bot's sandbox. This is rare and usually indicates a platform issue rather than a bug in your code. Fix: try rebooting the bot; if it persists, report it.

## E019

**Command cancelled: non-fatal.** A command your bot was awaiting (e.g. `bot.turn(...)`, `bot.setSpeed(...)`) was superseded or cancelled before it finished, typically because a later handler issued a new command (for example a `HIT` handler retargets the body mid-turn). The bot keeps playing. This is often expected; if you want to handle it, `.catch()` the command or wrap the `await` in `try/catch`. Any other unhandled promise rejection that escapes a handler surfaces the same way: logged with this code, and never fatal.

```
// Logs E019: if another handler retargets the body mid-turn, this await rejects
bot.on(Event.HIT, async () => {
  await bot.turn(180)
})
```

```
// Fixed: a superseded turn is fine here — swallow the cancellation
bot.on(Event.HIT, async () => {
  await bot.turn(180).catch(() => {})
})
```

## E020

**Timer callback failed: fatal.** A `setTimeout` / `setInterval` callback threw, rejected, or ran too long and hit the sandbox timeout. Fix: keep timer callbacks short and guard them with `try/catch`.

```
// Triggers E020: the busy-wait never yields, so the callback hits the 5s timeout
setInterval(() => {
  while (bot.getSpeed() > 0) {}
}, 10)
```

```
// Fixed: check once per firing instead of looping
setInterval(() => {
  if (bot.getSpeed() > 0) bot.setSpeed(0)
}, 10)
```

## E021

**Timer limit reached: non-fatal.** Your bot tried to hold more than the per-bot limit of **64** active timers (`setInterval` + `setTimeout` combined). The extra registration is ignored (that `setInterval`/`setTimeout` call returns `-1` and never fires) and the bot keeps playing. This almost always means timers are being created faster than they're cleared, e.g. calling `setInterval` inside a handler that runs every tick. Fix: create timers once (at the top level or in a `START` handler), keep references to them, and `clearInterval` / `clearTimeout` the ones you no longer need. Timers count per bot, and each app fields five bots. See the timer limit under [Game rules](/rules).

```
// Triggers E021: a NEW interval every tick — the 64-timer cap is hit in seconds
clock.on(Event.TICK, () => {
  setInterval(() => bot.turn(15), 10)
})
```

```
// Fixed: create the interval once, in START
bot.on(Event.START, () => {
  this.spin = setInterval(() => bot.turn(15), 10)
})
```

## E022

**Rate limited: the action was refused.** You (or a tool acting for you) sent too many requests in a short period, so the server returned **HTTP 429** with this code _instead of_ performing the action. Unlike the other codes here, this is an API response surfaced in the app or your tooling, not a bot console message. The limits apply to signing in, to checking/deploying/rebooting code (each compiles your bot in a fresh sandbox), to creating apps and arenas, and to the MCP endpoint an AI assistant uses. Fix: slow down and retry after a short wait; if a script (or an AI assistant) is driving the API, add a delay between calls. The specific budgets are listed under [Game rules](/rules).

## E023

**Invalid message: the broadcast was rejected.** `bot.send(...)` was called with something that can't be sent. A message must be a JSON value: a primitive (number, string, boolean, or `null`), or a nested array/object of those. Functions, class instances, and other non-JSON values can't be sent, and there are caps on size (**4096** characters once encoded) and nesting depth (**8**). The `send` call throws, so wrap it in a `try`/`catch` if you're sending data that might exceed a cap. Fix: send only plain data, and keep payloads small.

```
// Triggers E023: functions aren't JSON, so this throws
bot.send({ target: this.target, attack: () => true })
```

```
// Fixed: send plain data only
bot.send({ target: { x: this.target.x, y: this.target.y } })
```

## E024

**Send limit reached: non-fatal.** Your bot called `bot.send(...)` more than the per-tick limit of **50** times in a single simulation tick. Each broadcast is re-delivered to every other bot in the arena, so an unbounded stream of sends can flood the match; the extra calls this tick are ignored (they simply don't send) and the bot keeps playing. Sends past the cap don't throw, unlike a malformed message ([E023](#e023)). This almost always means `bot.send` is being called in a tight loop. Fix: send at most a handful of messages per clock tick. Coordinate with a compact payload rather than a stream of them, and avoid calling `send` inside an unbounded loop. The budget resets every tick.

```
// Triggers E024: one send per queued item can exceed 50 in a single tick
clock.on(Event.TICK, () => {
  while (this.queue.length) bot.send(this.queue.shift())
})
```

```
// Fixed: batch the queue into one message
clock.on(Event.TICK, () => {
  if (this.queue.length) bot.send(this.queue.splice(0))
})
```

## E025

**Source too large: the save was rejected.** The submitted bot source exceeded the maximum size of **256 KB**. Like [E022](#e022), this is an API response (**HTTP 413**) surfaced in the app or your tooling, not a bot console message, and it applies to both the editor's save and the MCP `set_app_source` / `create_app` tools. Bots are small programs, so this almost always means unintended content (a huge paste, or generated boilerplate) landed in the editor. Fix: trim the source below the limit.

## E026

**Too many pending commands: the command was rejected.** Your bot has more than the per-arena limit of **10,000** awaited commands (`bot.turn`, `bot.setSpeed`, `bot.turret.fire`, `bot.radar.scan`, …) parked at once. Each awaited command waits for the simulation to reach a state, so issuing them faster than they can complete — typically firing thousands in a tight loop without `await` — piles them up until the arena refuses more. The rejected command's promise rejects (so an `await` throws); the bot keeps playing. This almost always means commands are being launched in an unbounded loop instead of awaited one at a time. Fix: `await` each command before issuing the next, and don't call movement/turret/radar commands inside an unbounded loop.

```
// Triggers E026: thousands of un-awaited commands pile up in one tick
clock.on(Event.TICK, () => {
  for (let a = 0; a < 100000; a++) bot.turn(a) // no await — all parked at once
})
```

```
// Fixed: await the command so only one is in flight
clock.on(Event.TICK, async () => {
  await bot.turn(90)
})
```

## Reserved codes

`E002`, `E005`–`E012`, `E014`–`E016`, `W001`, and `W002` are reserved and not currently emitted. If you ever see one, it's safe to report it.
