# Error codes

When a bot misbehaves, RobocodeJs writes a code to that bot's **console log** (the
log panel next to the editor). Each code below explains what happened, whether it's
**fatal** (the bot is killed and removed from the arena) or **non-fatal** (the bot
keeps playing), and how to fix it.

A few codes (like `E022`) are **API-level** — returned by the server to the app or
your tooling rather than written to a bot's console — and are noted as such below.

You can also validate a bot before deploying it with the editor's **Check** button,
which reports the same codes for compile/load problems.

Tip: search a code (e.g. `E017`) in the search box at the top of the site to jump
straight to its entry here.

## E001

**Sandbox catastrophic error — fatal.** The bot's sandbox hit a fatal limit,
almost always the **8 MB memory cap** from runaway allocation (e.g. an
ever-growing array). All of the app's tanks are killed. Fix: bound the memory your
bot keeps — don't accumulate unbounded history or large data structures.

## E003

**Event handler threw — non-fatal.** One of your event handlers (`clock.on`,
`bot.on(...)`) threw an error _synchronously_ while running. The bot keeps playing,
but that handler run did nothing useful. Fix: wrap risky logic in `try/catch`, and
check the message printed alongside the code.

## E004

**Bot failed to load — fatal.** The bot's code could not be (re)loaded/executed
(for example after a save). The bot is stopped. Fix: check your top-level code for
errors; the accompanying message names the cause.

## E013

**Async handler failed — fatal.** An event handler that returns a promise
(`async` handler) rejected or threw. Unlike E003 (synchronous), an unhandled async
failure stops the bot. Fix: `await` your commands inside `try/catch`, or `.catch()`
the promises you don't await.

## E017

**Bot script failed to load — fatal.** The bot's source could not be compiled or
its top-level code threw while loading. This is the most common code and is exactly
what the **Check** button reports:

- a **syntax error** (a typo, an unbalanced brace), or
- an error/throw in top-level code (code outside your event handlers), or
- top-level code that ran too long and hit the sandbox timeout.

Fix: use **Check** (or format with the code button) to locate the syntax error;
keep top-level code minimal — do work inside `clock.on(Event.TICK, ...)` and the
other event handlers rather than at the top level.

## E018

**Sandbox init failed — fatal.** An internal error occurred while setting up the
bot's sandbox. This is rare and usually indicates a platform issue rather than a
bug in your code. Fix: try rebooting the bot; if it persists, report it.

## E019

**Command cancelled — non-fatal.** A command your bot was awaiting (e.g.
`bot.turn(...)`, `bot.setSpeed(...)`) was superseded or cancelled before it
finished — typically because a later handler issued a new command (for example a
`HIT` handler retargets the body mid-turn). The bot keeps playing. This is often
expected; if you want to handle it, `.catch()` the command or wrap the `await` in
`try/catch`.

## E020

**Timer callback failed — fatal.** A `setTimeout` / `setInterval` callback threw,
rejected, or ran too long and hit the sandbox timeout. Fix: keep timer callbacks
short and guard them with `try/catch`.

## E021

**Timer limit reached — non-fatal.** Your bot tried to hold more than the
per-tank limit of **64** active timers (`setInterval` + `setTimeout` combined).
The extra registration is ignored — that `setInterval`/`setTimeout` call returns
`-1` and never fires — and the bot keeps playing. This almost always means timers
are being created faster than they're cleared, e.g. calling `setInterval` inside a
handler that runs every tick. Fix: create timers once (at the top level or in a
`START` handler), keep references to them, and `clearInterval` / `clearTimeout`
the ones you no longer need. Timers count per tank, and each app fields five
tanks. See the timer limit under [Game rules](/rules).

## E022

**Rate limited — the action was refused.** You (or a tool acting for you) sent
too many requests in a short period, so the server returned **HTTP 429** with this
code _instead of_ performing the action. Unlike the other codes here, this is an
API response surfaced in the app or your tooling — not a bot console message. The
limits apply to signing in, to checking/deploying/rebooting code (each compiles
your bot in a fresh sandbox), and to creating apps and arenas. Fix: slow down and
retry after a short wait; if a script is driving the API, add a delay between
calls. The specific budgets are listed under [Game rules](/rules).

## E023

**Invalid message — the broadcast was rejected.** `bot.send(...)` was called with
something that can't be sent. A message must be a JSON value: a primitive (number,
string, boolean, or `null`), or a nested array/object of those. Functions, class
instances, and other non-JSON values can't be sent, and there are caps on size
(**4096** characters once encoded) and nesting depth (**8**). The `send` call
throws, so wrap it in a `try`/`catch` if you're sending data that might exceed a
cap. Fix: send only plain data, and keep payloads small.

## Reserved codes

`E002`, `E005`–`E012`, `E014`–`E016`, `W001`, and `W002` are reserved and not
currently emitted. If you ever see one, it's safe to report it.
