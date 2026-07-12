# Writing readable bot code

> **A tip sheet for AI assistants generating RobocodeJs bots** over the MCP
> connector. It is not part of the human-facing documentation and isn't linked
> from it — it exists so that when a model writes a bot, the source it produces
> is easy for a _person_ to read, understand, and adjust quickly.

When you generate a bot, treat the source as something a human will open next and
optimize it for their comprehension, not just for a working match. A bot someone
can read and adjust in seconds beats a clever one-liner every time. This page is
the house style: how to lay a bot out, name things, and comment so a reader gets
up to speed fast.

Ground the code in the real API as you write it — the reference
(`robocodejs://docs/dev`), the exact signatures
(`robocodejs://types/robocode.d.ts`), and the sample bots
(`robocodejs://samples/`, which all follow this style). If your client can't read
MCP resources, the `read_doc` tool serves the same material by id (`docs/dev`,
`types/robocode.d.ts`, `samples/<name>`).

## The one rule

**Write for the next reader, not the compiler.** Anyone can make the machine
understand the code. The job is to make a _person_ understand it quickly — the
strategy, the reasoning, and where to change it. Everything below serves that.

## Open with a header comment

Start every bot with a short block comment that answers, before any code:

- **What is this bot?** One line — its name and its idea.
- **What's the strategy?** Two or three sentences a reader can hold in their head.
- **How do you see it work?** A hint like "add a moving bot and watch it lead."

```js
/*
  Sentinel — a defensive area-denial bot.

  Holds the centre and sweeps its radar in a full circle. When it spots an
  enemy it stops, faces the threat, and fires in disciplined bursts rather than
  chasing — trading map control for accuracy. Weakest against a swarm that can
  approach from several sides at once.
*/
```

This is the single highest-value thing you can add. A reader who knows the plan
reads the rest of the file as _confirmation_ instead of _investigation_.

## Lay the file out in reading order

A bot has a natural top-to-bottom shape. Keep to it, so a reader can scan the
file like an outline:

1. **Header comment** — the strategy (above).
2. **`bot.setName(...)`** — name it first.
3. **Constants** — the tunable numbers, named (below).
4. **Helper functions** — the reusable math/logic, defined before they're used.
5. **`bot.on(Event.START, ...)`** — one-time setup: initial speed, radar lock,
   any state you stash on `this`.
6. **Event handlers** — `TICK`, `SCANNED`, `HIT`, `COLLIDED`, … — the ongoing
   behaviour, the heart of the bot.

Grouping by _lifecycle_ (setup, then reactions) rather than scattering handlers
through the file lets a reader find "what happens when it sees an enemy?" at a
glance.

## Name the magic numbers

A bare `250` or `4` in the middle of a handler tells the reader nothing. A named
constant tells them what it _means_ — and gives them one obvious place to tune.
Put a comment on the ones whose value is a judgement call.

```js
// Bullets fly 25 units/tick and the target keeps moving, so shots past this
// range tend to miss as the lead estimate drifts. Don't take them.
const RANGE = 250;
// Only fire when the turret is within this many degrees of the aim point.
const AIM_TOLERANCE = 4;
```

Now `if (target.distance < RANGE && linedUp)` reads like a sentence, and a
tweaker knows exactly which knob to turn.

## Pull logic into small, named functions

If a handler does something non-trivial — trigonometry, target selection, a
decision — lift it into a function whose _name_ says what it does. The handler
then reads as a sequence of intentions, and the tricky part is isolated,
reusable, and testable in your head.

```js
// Smallest signed difference between two compass angles, in -180..180.
function angleDelta(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function weakestEnemy(enemies) {
  // Lowest health first; nearest as a tie-break.
  return enemies.sort(
    (a, b) => a.health - b.health || a.distance - b.distance
  )[0];
}
```

`const target = weakestEnemy(enemies)` needs no comment — the name is the comment.

## Comment the _why_, not the _what_

The code already says _what_ it does. A comment earns its place by explaining
what the code can't: the reason, the trade-off, the thing that would otherwise
look like a mistake.

```js
// Good — explains a decision the code can't:
bot.setSpeed(0); // hold still so aiming is the only variable

// Noise — just restates the line:
bot.setSpeed(0); // set speed to 0
```

Reserve a short comment for each non-obvious step of a calculation (the Marksman
sample, `robocodejs://samples/marksman`, narrates its lead-the-target math this
way), and for any workaround, so the next reader doesn't "clean it up" and
reintroduce the bug.

## Lean into the event-driven shape

RobocodeJs bots are reactive: you register handlers and the game calls them.
Idioms that keep that readable:

- **One responsibility per handler.** `TICK` charges and fires the radar;
  `SCANNED` does the aiming; `HIT` reacts to damage. Don't cram the whole bot
  into `TICK`.
- **Return the Promise from an async handler** so the engine waits before
  re-firing it — this prevents the same handler stacking up in parallel. See the
  events section of the API reference (`robocodejs://docs/dev`).
- **Stash state on `this`**, set it in `START`, and give it a clear name
  (`this.targetId`, `this.mode`) so the reader knows what the bot remembers
  between ticks.
- **Guard before you act** — `if (bot.turret.isReady())` before firing — and let
  the guard read as the precondition it is.

## Keep the formatting consistent

Consistent formatting removes a whole category of distraction. RobocodeJs uses
**Prettier** with 2-space indent, single quotes, semicolons, and trailing commas
(the in-app editor and the pre-commit hook both apply it). You don't have to
hand-format: run the code through the formatter and paste the result back.

AI assistants over MCP can call the **`format_source`** tool to pretty-print a bot
to exactly this style before saving it — do that as the last step before
`set_app_source`, and use **`check_app_source`** to confirm it still compiles.

## A quick checklist

Before you save a bot, skim it as if you'd never seen it:

- Is there a header comment stating the strategy?
- Could a reader find "what happens when it sees an enemy?" in one scan?
- Are the tuning numbers named, and the judgement-call ones commented?
- Does each comment explain a _why_, or is it just restating the code?
- Is the tricky math tucked into a well-named helper?
- Has it been through the formatter?

If yes, the next reader — human or AI — is set up to get productive in minutes.
