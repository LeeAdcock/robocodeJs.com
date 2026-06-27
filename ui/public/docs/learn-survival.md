# Lesson 11: Survival

**By the end of this lesson you'll be able to:**

- Check your robot's health and react when it's low
- Respond to being shot or spotted

**New idea:** _Thresholds — using a cutoff number to decide._

## The idea

Your robot has health you can check with `bot.getHealth()`. It's a number from **`1`**
(full health) down to **`0`** (destroyed). Watching it lets you play it safe when you're
hurt — a decision based on a **threshold** (a cutoff like "below 0.4 = danger").

Two new events help you survive:

- **HIT** — a bullet hit you. The handler gets `info.angle`: the direction it came from.
- **DETECTED** — an enemy's radar swept over you. You've been **spotted** (a good time to
  start moving so you're harder to hit).

## Try it

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (bot.getHealth() < 0.4) {
    // Low health — run and weave to dodge.
    bot.setSpeed(5);
    if (!bot.isTurning()) bot.turn(45);
  } else {
    bot.setSpeed(3);
  }
});

bot.on(Event.HIT, (info) => {
  console.log('ow! hit from', info.angle, '— health', bot.getHealth());
  // Veer sideways from the incoming shot.
  bot.setOrientation(info.angle + 90).catch(() => {});
});

bot.on(Event.DETECTED, () => {
  console.log('spotted — speeding up');
  bot.setSpeed(5);
});
```

Press **Save**. Rusty cruises normally, dashes and weaves when hurt, veers when shot, and
speeds up when an enemy's radar finds it.

The threshold is the line `if (bot.getHealth() < 0.4)`. Above `0.4` it plays normal; below
it, it panics and runs.

## Experiment

- Watch your health: add `console.log('health', bot.getHealth());` to your TICK.
- Make Rusty more cautious by raising the threshold to `0.6`, or braver with `0.2`.
- Change the dodge from `info.angle + 90` (veer sideways) to `info.angle + 180` (drive
  directly away). Which survives longer?

## Common questions

**What are the health numbers?**
`1` is full health, `0` means destroyed. So `0.5` is half. That's why we compare with a
decimal like `0.4`.

**What's the difference between HIT, DETECTED, and COLLIDED?**

- **HIT**: a bullet struck you.
- **DETECTED**: an enemy's radar saw you (no damage, but you're a target).
- **COLLIDED**: you ran into a wall or robot (you stop).

**Why `info.angle + 90`?**
`info.angle` points back at the shooter. Adding `90` turns you sideways to the shot — a
quick dodge. `+ 180` would send you straight away instead.

## You learned

- `bot.getHealth()` returns `1` (full) down to `0` (destroyed).
- A **threshold** (`if health < 0.4`) lets you change behavior when hurt.
- The **HIT** event gives `info.angle`; the **DETECTED** event warns you've been spotted.

---

[← Remembering things](/learn/state) · [Index](/learn) · Next: [Rhythms and timers →](/learn/timers)
