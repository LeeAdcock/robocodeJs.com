# Lesson 8: Take aim

**By the end of this lesson you'll be able to:**

- Point your turret at an enemy you spotted
- Pick the **closest** target out of many

**New idea:** _Variables: labeled boxes that remember a value._

## The idea

Scanning tells us about enemies, but to **aim** we need to remember one and point at it. For that we use a **variable**: a labeled box that holds a value. We make one with `let`:

```
let closest = null;
```

`null` is a special value meaning "nothing yet." As we look through the scan results, we can put the best target in this box and change it whenever we find a better one. Changing the box's contents later is the whole point of a variable.

To pick the closest enemy, we **compare** distances with `<` ("less than").

To aim, point the turret at the target's `angle`. A scan's `angle` is a **bearing relative to your body**, and the turret also turns relative to the body, so it drops straight in: `bot.turret.setOrientation(target.angle)`.

## Try it

A stationary sniper that always aims at the nearest enemy:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(0);
});

clock.on(Event.TICK, () => {
  bot.radar.turn(20); // keep the beam sweeping, or it never finds anyone
  if (bot.radar.isReady()) bot.radar.scan();
});

bot.on(Event.SCANNED, (targets) => {
  let closest = null;

  targets.forEach((target) => {
    if (!target.friendly) {
      if (closest === null || target.distance < closest.distance) {
        closest = target; // remember this one — it's the best so far
      }
    }
  });

  if (closest !== null) {
    bot.turret.setOrientation(closest.angle);
    if (bot.turret.isReady()) bot.turret.fire();
  }
});
```

Press **Reboot**. Rusty tracks the nearest enemy with its turret and fires when loaded.

That `bot.radar.turn(20)` is doing more work than it looks. Rusty is parked, so its body never rotates, and the radar is a narrow beam rather than a circle of vision — without something turning it, the beam stays frozen on whatever direction Rusty happened to spawn facing, and a sniper that scans a hundred times can still never see a soul.

Reading the tricky line: `closest === null || target.distance < closest.distance` means "if I haven't picked anyone yet, **or** this one is closer than my current pick, choose this one." (`||` means "or.")

## Experiment

- Make Rusty face the enemy with its whole body **instead** of its turret: swap `bot.turret.setOrientation(closest.angle);` for `bot.turn(closest.angle);`. It is `turn` and not `setOrientation` because `closest.angle` is measured from where you are already facing, so you turn _by_ it — the turret takes it as-is, since the turret is aimed relative to the body. Aim one or the other, never both with the same bearing: the turret rides on the body, so turning the body swings the gun along with it and you end up pointing at twice the angle.
- Log your target: `console.log('targeting one', closest.distance, 'away');`
- Change `<` to `>` to aim at the **farthest** enemy instead. (Compare the difference!)

## Common questions

**What's the difference between `let` and the names like `bot`?** `bot` is given to you by the game. `let closest = ...` makes your **own** box that you control and can change. Use variables to remember anything your robot needs.

**What is `null`?** "Nothing here yet." We start `closest` at `null`, then replace it once we find a target. We check `closest !== null` ("is not nothing") before aiming.

**My turret seems a step behind the target.** Turning takes a moment, and we fire the same instant we start aiming. It matters more than you'd think: a bullet has to reach the enemy's hull, a window of about 16 feet, which at long range is only a couple of degrees of aim. The next lesson teaches how to **wait** for the aim to finish before firing.

## You learned

- A **variable** (`let name = value`) is a box that remembers a value and can change.
- `null` means "nothing yet"; `<` / `>` compare numbers; `||` means "or."
- Aim the turret with `bot.turret.setOrientation(angle)` (the scan bearing is body-relative).

---

[← See your enemies](/learn/radar) · [Index](/learn) · Next: [Good things take time →](/learn/waiting)
