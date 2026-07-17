# Lesson 14: Leading a moving target

**By the end of this lesson you'll be able to:**

- Understand why firing straight at an enemy **misses** when it's moving
- **Lead** the target — aim where it _will be_ — using its `speed` and `orientation`

**New idea:** _Prediction — using what you know now to guess where something will be._

## The idea

In [Take aim](/learn/aim) you pointed the turret straight at an enemy. That works
great against a **still** target. But bullets aren't instant — they travel
**25 units per tick** (see the [rules](/rules)). While your bullet is in the air,
a moving enemy keeps driving, and by the time the bullet arrives, the enemy has
left. You aimed at a ghost.

The fix is **leading**: aim at the spot where the target will be when the bullet
gets there — like a quarterback throwing _ahead_ of a running receiver.

A scan hands you everything you need to predict that spot:

- `target.distance` — how far away it is **now**
- `target.orientation` — the direction it's **driving** (its absolute compass heading)
- `target.speed` — how fast it's driving (units per tick)

The plan, in three steps:

1. **How long** will the bullet fly? Roughly `distance ÷ 25` ticks.
2. **Where is the enemy now**, in arena coordinates? We know our own position
   (`bot.getX()`, `bot.getY()`), the bearing to the enemy, and the distance.
3. **Where will it be** after those ticks, if it keeps driving along its heading?
   Aim there instead.

We turn a direction + distance into an `(x, y)` point (and back) with a little
trig — the same `Math.atan2` / `Math.sin` / `Math.cos` toolbox from
[Maps and math](/learn/navigation). Don't worry if the formulas look busy; you can
copy them and tweak.

## Try it

**Deadeye** holds still, sweeps for an enemy, then leads its shot:

```
bot.setName('Deadeye');

bot.on(Event.START, () => {
  bot.setSpeed(0); // hold position so we can focus on aiming
});

clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) bot.radar.scan();
});

bot.on(Event.SCANNED, (targets) => {
  const enemy = targets.find((t) => !t.friendly);
  if (!enemy) {
    bot.turn(15); // no one in view — sweep around to look
    return;
  }

  // 1. Roughly how many ticks until a bullet reaches it (bullets fly 25/tick).
  const ticks = enemy.distance / 25;

  // 2. Where is the enemy right now? Turn its bearing + distance into an (x, y).
  //    Its bearing from us is our heading plus the scan's (body-relative) angle.
  const bearing = ((bot.getOrientation() + enemy.angle) * Math.PI) / 180;
  const enemyX = bot.getX() + enemy.distance * Math.sin(bearing);
  const enemyY = bot.getY() - enemy.distance * Math.cos(bearing);

  // 3. Where will it be after those ticks, driving along its own heading?
  const heading = (enemy.orientation * Math.PI) / 180;
  const futureX = enemyX + enemy.speed * ticks * Math.sin(heading);
  const futureY = enemyY - enemy.speed * ticks * Math.cos(heading);

  // Aim the turret at that predicted spot and fire.
  const aim =
    (Math.atan2(futureX - bot.getX(), bot.getY() - futureY) * 180) / Math.PI;
  bot.turret.setOrientation(aim - bot.getOrientation());
  if (bot.turret.isReady()) bot.turret.fire();
});
```

Press **Deploy**. Put a moving bot (say **Pathfinder** from the examples) in the
arena and watch Deadeye lead it — its shots land where the target is _going_, not
where it was.

Reading the key idea: steps 2 and 3 build an `(x, y)` for the **future** position;
the final `Math.atan2(...)` turns that point back into a compass heading, and we
subtract our own heading to get a **body-relative** bearing the turret understands
(just like a scan's `angle`).

## Experiment

- **See the difference.** Temporarily aim at the _current_ spot instead by using
  `enemyX`/`enemyY` in the final `atan2`, and watch the misses against a fast
  mover. Then switch back to `futureX`/`futureY`.
- **Only lead when it helps.** A still target needs no lead. Try skipping the
  prediction when `enemy.speed === 0`.
- **Sharpen the guess.** The bullet's flight time really depends on the _future_
  distance, not the current one. Run the whole calculation **twice**, feeding the
  first prediction's distance back into step 1 — the second answer is closer. Then
  compare both answers to `enemy.getIntercept(bot.turret.bulletSpeed)` (see **The
  shortcut** below): the helper solves exactly the equation your two-pass loop is
  converging toward.

## Common questions

**Why `distance / 25`?**
Bullets travel 25 units per tick, so a target 100 units away is about `100 / 25 = 4`
ticks of flight. That's how far into the future we predict.

**Why subtract `bot.getOrientation()` at the end?**
The turret turns **relative to your body** (same as a scan's `angle`). `Math.atan2`
gives an **absolute** compass heading, so we subtract our own heading to convert it
into the body-relative bearing the turret wants.

**It still misses sometimes.**
Leading with the _current_ distance is an approximation, and the enemy can turn or
brake after we fire. The "run it twice" experiment above gets you closer; perfect
aim against an unpredictable driver isn't possible — but you'll hit far more often
than firing straight.

## You learned

- Bullets take time to arrive (**25 units/tick**), so firing at a moving target's
  current position misses.
- **Leading** predicts where the target will be: flight time `≈ distance / 25`,
  then move the target along its `orientation` at its `speed`.
- Convert between a bearing+distance and an `(x, y)` point with `Math.sin` /
  `Math.cos`, and back with `Math.atan2` — subtracting your heading for the turret.

## The shortcut

Now that you've built the prediction by hand, here's the confession: every scan
result is a **contact** — a [marker](/learn/navigation) pinned at the detected
bot's position — and it can solve this whole lesson in one call:

```
bot.on(Event.SCANNED, (targets) => {
  const enemy = targets.find((t) => !t.isFriendly());
  if (!enemy) { bot.turn(15); return; }

  const aim = enemy.getIntercept(bot.turret.bulletSpeed); // = 25
  if (!aim) return; // no shot can catch it
  bot.turret.turnTowards(aim.getX(), aim.getY());
  if (bot.turret.isReady()) bot.turret.fire();
});
```

`getIntercept(bot.turret.bulletSpeed)` solves the meet-up equation exactly — it's your "run it twice"
experiment taken to its limit — and even accounts for ticks that passed since the
scan. It returns `null` when no interception is possible, and because the answer
is a marker, `turnTowards` aims at it directly. Understanding **why** it works is
what this lesson was for; now you get to use the short version with a clear
conscience.

One more trick for later: a contact is serializable, so a teammate can broadcast one
with `bot.send(enemy)` and you can rebuild it — `getIntercept` and all, solved from
**your** position — with `arena.createContact(message)`. That's the heart of team
fire-control, and it's where [the last lesson](/learn/teamwork) ends up.

---

[← Maps and math](/learn/navigation) · [Index](/learn) · Next: [Teamwork and graduation →](/learn/teamwork)
