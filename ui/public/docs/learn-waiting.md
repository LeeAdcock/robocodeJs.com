# Lesson 9: Good things take time

**By the end of this lesson you'll be able to:**

- Wait for an action to **finish** before doing the next thing
- Write clean "do this, then that" robot behavior

**New idea:** _Promises — actions that finish later — with `await`, `.then`, and `.catch`._

## The idea

Lots of robot actions don't happen instantly: turning, driving to a speed, scanning,
reloading. When you start one, the game hands you a **Promise** — think of it like a
**ticket at a food counter**. The ticket isn't your food; it's a promise that your food
is coming. When it's ready, your number is called.

There are two ways to use that ticket:

- **`await`** — wait right here until it's ready, then continue. You can only use `await`
  inside a handler marked **`async`** (it means "this handler is allowed to wait").
- **`.then(() => ...)`** — "when it's ready, do this next." Same idea, different style.

Sometimes an action gets **cancelled** — for example, you start a new turn before the old
one finishes. The old ticket is then thrown out (programmers say the Promise is
_rejected_). That's normal and harmless; we tidy up with **`.catch(() => {})`**, which
just says "if it got cancelled, never mind."

## Try it

A roaming bot that scans, waits for the cannon to reload, then fires — properly ordered:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

clock.on(Event.TICK, async () => {
  // Wait until the radar is charged, then scan and wait for the results.
  const targets = await bot.radar.onReady().then(bot.radar.scan);

  if (targets.length > 0 && !targets[0].friendly) {
    await bot.turret.onReady(); // wait until the cannon is loaded
    bot.turret.fire();
  }
});

bot.on(Event.COLLIDED, () => {
  // Turn, and only once the turn is done, start moving again.
  bot.turn(120).then(() => bot.setSpeed(3)).catch(() => {});
});
```

Press **Save**. Rusty roams and fires cleanly. The `await`s make each step wait for the
one before it, so it fires _after_ the cannon is actually ready.

New pieces:

- `async () => { ... }` — a handler that's allowed to `await`.
- `bot.radar.onReady()` — a Promise that finishes when the radar is charged. Nicer than
  checking `isReady()` over and over.
- `.then(bot.radar.scan)` — when ready, run the scan.
- `.catch(() => {})` — ignore a cancelled action so it doesn't clutter your log.

## Experiment

- Add aiming from Lesson 8 before firing:
  `await bot.turret.setOrientation(targets[0].angle);`
  then `bot.turret.fire();`. Now it waits to finish aiming, _then_ shoots — much more
  accurate.
- Remove the `await` before `bot.turret.onReady()` and see how the behavior gets sloppier.
- Delete the `.catch(() => {})` on the COLLIDED turn, bump a wall a few times, and watch
  the log fill with "cancelled" messages. Put it back to silence them.

## Common questions

**What's a Promise, really?**
A stand-in for a result that isn't ready yet — your "food counter ticket." `await` waits
for it; `.then` schedules what to do when it arrives.

**`await` vs `.then` — which should I use?**
Both do the same job. `await` often reads more like plain steps; `.then` chains are handy
for short sequences. Use whichever is clearer to you.

**What does "cancelled" / rejected mean?**
You started an action, then replaced it with a new one before it finished. The old one is
dropped. It's safe — `.catch(() => {})` just keeps your log quiet.

**Do I always need `async`?**
Only when you want to use `await` inside that handler. The COLLIDED handler above uses
`.then` instead, so it doesn't need `async`.

## You learned

- Slow actions return a **Promise**; `await` (inside an `async` handler) waits for it.
- `.then(...)` chains "do this next"; `.catch(() => {})` ignores cancelled actions.
- `bot.radar.onReady()` / `bot.turret.onReady()` finish when those parts are ready.

---

[← Take aim](/learn/aim) · [Index](/learn) · Next: [Remembering things →](/learn/state)
