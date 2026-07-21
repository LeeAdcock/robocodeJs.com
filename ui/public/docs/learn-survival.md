# Lesson 11: Survival

**By the end of this lesson you'll be able to:**

- Check your robot's health and react when it's low
- Respond to being shot or spotted

**New idea:** _Thresholds: using a cutoff number to decide._

## The idea

Your robot has health you can check with `bot.getHealth()`. It's a number from **`100`** (full health) down to **`0`** (destroyed). Watching it lets you play it safe when you're hurt, a decision based on a **threshold** (a cutoff like "below 40 = danger").

Two new events help you survive:

- **HIT**: a bullet hit you. The handler gets `info.angle`: the bearing the shot came from, **relative to your heading** (so you `turn` by it, not `setOrientation` to it).
- **DETECTED**: an enemy's radar swept over you. You've been **spotted** (a good time to start moving so you're harder to hit).

## Try it

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  this.spotted = 0; // ticks left of "someone has me on their radar"
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (this.spotted > 0) this.spotted = this.spotted - 1;

  if (bot.getHealth() < 40) {
    // Low health — run and weave to dodge.
    bot.setSpeed(5);
    if (!bot.isTurning()) bot.turn(45);
  } else if (this.spotted > 0) {
    bot.setSpeed(5); // someone is watching — pick up the pace
  } else {
    bot.setSpeed(3);
    if (!bot.isTurning()) bot.turn(10); // keep wandering, don't park on a wall
  }
});

bot.on(Event.HIT, (info) => {
  console.log('ow! hit from', info.angle, '— health', bot.getHealth());
  // info.angle is relative to us, so turn BY it (+90) to veer sideways.
  bot.turn(info.angle + 90).catch(() => {});
});

bot.on(Event.DETECTED, () => {
  console.log('spotted — speeding up');
  this.spotted = 20; // leave TICK a note instead of setting speed here
});

bot.on(Event.COLLIDED, () => {
  bot.turn(150).catch(() => {}); // shove off the wall we just hit
  bot.setSpeed(3);
});
```

Press **Reboot**. Rusty cruises and wanders, dashes and weaves when hurt, veers when shot, and picks up the pace when an enemy's radar finds it.

Two details there are worth more than the health threshold itself.

**DETECTED leaves a note rather than setting the speed.** TICK sets a speed on _every_ tick, so anything another handler sets is overwritten within a tick or two — a `bot.setSpeed(5)` inside DETECTED simply never survives long enough to see. Writing `this.spotted = 20` and letting TICK decide keeps one handler in charge of the throttle. Any time two handlers drive the same control, the one that runs most often wins, and the other looks broken.

**The wander and the COLLIDED handler are what keep Rusty alive.** A robot that only ever drives straight finds a wall, stops, and then keeps grinding into it — dozens of bumps, each costing health. It is entirely possible to lose a match to the arena without an enemy ever hitting you.

The threshold is the line `if (bot.getHealth() < 40)`. Above `40` it plays normal; below it, it panics and runs.

## Experiment

- Watch your health: add `console.log('health', bot.getHealth());` to your TICK.
- Make Rusty more cautious by raising the threshold to `60`, or braver with `20`.
- Change the dodge from `info.angle + 90` (veer sideways) to `info.angle + 180` (drive directly away). Which survives longer?

## Common questions

**What are the health numbers?** `100` is full health, `0` means destroyed. So `50` is half. That's why we compare with a number like `40`.

**What's the difference between HIT, DETECTED, and COLLIDED?**

- **HIT**: a bullet struck you.
- **DETECTED**: an enemy's radar saw you (no damage, but you're a target).
- **COLLIDED**: you ran into a wall (which stops you) or another robot (which shoves you both apart).

**Why `info.angle + 90`?** `info.angle` is the bearing back toward the shooter, relative to your heading. `bot.turn` turns you _by_ that amount, so `+ 90` turns you sideways to the shot, a quick dodge. `+ 180` would turn you straight away instead.

## You learned

- `bot.getHealth()` returns `100` (full) down to `0` (destroyed).
- A **threshold** (`if health < 40`) lets you change behavior when hurt.
- The **HIT** event gives `info.angle`; the **DETECTED** event warns you've been spotted.

---

[← Remembering things](/learn/state) · [Index](/learn) · Next: [Rhythms and timers →](/learn/timers)
