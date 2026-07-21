# Lesson 12: Rhythms and timers

**By the end of this lesson you'll be able to:**

- Run actions on a schedule instead of every single tick
- Start a timer, and stop it later

**New idea:** _Scheduling with timers, measured in game ticks, not seconds._

## The idea

Sometimes you don't want something _every_ tick. You want a **rhythm**, like "turn a little every 10 ticks." Two tools do this:

- `setInterval(fn, 10)` runs `fn` **every** 10 ticks, over and over.
- `setTimeout(fn, 30)` runs `fn` **once**, 30 ticks from now.

Two important notes:

1. The number is in **game ticks** (the clock's heartbeat), **not** seconds. There's no real-world clock here. The game runs on its own time. (If you ever want the current tick number, ask `clock.getTime()`.)
2. **Create repeating timers inside START.** START runs once, so you set up your rhythms a single time. (If you made them in TICK, you'd start a brand-new timer every heartbeat!) A one-shot `setTimeout` scheduled from inside another timer is fine — you'll see one below — because it fires once and is gone.

## Try it

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  // Every 10 ticks: turn a little (and counter-turn the turret so it keeps aim).
  setInterval(() => {
    bot.turn(15);
    bot.turret.turn(-15);
  }, 10);

  // Every 50 ticks: dash forward for 10 ticks, then ease off.
  setInterval(() => {
    bot.setSpeed(5);
    setTimeout(() => bot.setSpeed(2), 10);
  }, 50);
});
```

Press **Deploy**. Rusty moves in a steady, rhythmic pattern, turning constantly and dashing forward every so often.

## Stopping a timer

`setInterval` hands back an **id** (a ticket) you can use to cancel it later with `clearInterval`. Store the id in lasting memory (`this`) so other handlers can reach it.

Add the timer _inside_ the START handler you already have — a second `bot.on(Event.START, ...)` would replace the first one, quietly taking your other two rhythms with it (Lesson 2: setting a handler twice keeps only the last):

```
bot.on(Event.START, () => {
  // ...your two intervals from above stay here...

  this.spin = setInterval(() => bot.turret.turn(20), 5);
});

// Stop spinning the first time we get hit.
bot.on(Event.HIT, () => {
  clearInterval(this.spin);
});
```

(`setTimeout` has a matching `clearTimeout` if you need to cancel a one-shot.)

## Experiment

- Change the `10` in the first interval to `5` (turns more often) or `30` (lazier).
- Add a one-shot to START: `setTimeout(() => bot.setName('Warmed up!'), 30);` and the name changes after 30 ticks.
- Combine with the spin example: stop the turret spin on HIT, and notice it stays put afterward.

## Common questions

**Is `10` ten seconds?** No, ten **ticks**. The clock ticks many times a second. Timers count ticks so the game can pause and resume cleanly. There is no `Date` here on purpose; use `clock.getTime()` for the tick count.

**Is there a limit on timers?** Yes, **64** at once per robot (`setInterval` and `setTimeout` together). Past that the call returns `-1` and the callback never runs, which is the game's way of catching a timer being created in a loop. Sixty-four is far more rhythms than a good robot needs, so hitting it almost always means a `setInterval` ended up somewhere that runs repeatedly.

**Why must timers go in START?** START runs once. If you create a timer in TICK, you'd create a new one every tick and end up with hundreds piling up. Set rhythms up once, in START.

**What's the id from `setInterval` for?** It's a handle to that specific timer so you can `clearInterval(id)` to stop it later.

## You learned

- `setInterval(fn, ticks)` repeats; `setTimeout(fn, ticks)` runs once, both in **ticks**.
- Create timers in **START**; they return an **id** you can `clearInterval` / `clearTimeout`.
- There's no real clock; `clock.getTime()` gives the current tick.

---

[← Survival](/learn/survival) · [Index](/learn) · Next: [Maps and math →](/learn/navigation)
