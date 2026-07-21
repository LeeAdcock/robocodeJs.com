# Lesson 6: Fire the turret

**By the end of this lesson you'll be able to:**

- Shoot your robot's cannon
- Check whether it's reloaded before firing

**New idea:** _Parts of your robot have their own buttons; checking before acting._

## The idea

Your robot has a **turret**, the cannon on top. It's a _part_ of your robot, so you reach it through `bot.turret`, and it has its own actions:

- `bot.turret.fire()`: shoot!
- `bot.turret.isReady()`: is the cannon reloaded? (`true`/`false`)

After each shot the turret needs time to **reload**. If you try to fire while it's reloading, nothing happens. So the polite thing is to **check first** with `isReady()`, exactly the kind of true/false check you met last lesson.

There's also an event, **FIRED**, that happens the moment a shot goes off.

## Try it

Let's make a stationary turret that fires as fast as it can reload:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(0); // stand still
});

clock.on(Event.TICK, () => {
  if (bot.turret.isReady()) {
    bot.turret.fire();
  }
});

bot.on(Event.FIRED, () => {
  console.log('boom!');
});
```

Press **Reboot**. Rusty stands still and fires whenever the cannon is loaded. The log prints `boom!` on every shot.

Two things worth expecting. Nothing happens for the first ten seconds of a fresh match: robots deploy with their turrets held, so `isReady()` stays `false` until they are in position. And once the shooting starts, blind fire is genuinely dangerous to your own side — your robots begin the match near each other, and a shot that connects does not care whose robot it hit. That is the problem the next two lessons solve.

## Experiment

- Make the turret sweep while shooting: add `bot.turret.turn(30);` right after `bot.turret.fire();`. Now Rusty sprays shots in different directions.
- Remove the `if (bot.turret.isReady())` check so it _tries_ to fire every tick. It still only fires when loaded. The check just keeps things tidy.

## Common questions

**What is `bot.turret`?** It's the cannon, a part of your robot. `bot.turret.fire()` reads as "robot → turret → fire." Your robot also has `bot.radar` (next lesson) the same way.

**Why does my robot fire slower than every tick?** Because of reload time. `isReady()` is `false` while reloading, so the `if` skips firing until it's loaded again.

**Does firing hurt me or my teammates?** Firing itself is free, but a shot that _misses_ and flies off the field costs you **3 health**, so don't fire blindly into empty space. Your shots _can_ also hit teammates. Soon we'll learn to scan and only fire at enemies.

## You learned

- The turret is a part of your robot: `bot.turret`.
- `bot.turret.fire()` shoots; `bot.turret.isReady()` says whether it's reloaded.
- The **FIRED** event happens when a shot goes off.

---

[← Bumping into walls](/learn/walls) · [Index](/learn) · Next: [See your enemies →](/learn/radar)
