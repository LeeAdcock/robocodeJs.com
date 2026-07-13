# Aim where they'll be

_November 12, 2024_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Aiming _at_ an enemy is the easy part. The game hands it to you: a scan result comes back
with an `angle` that's already relative to your heading, so pointing the gun straight at
what you see is a single line:

```js
if (bot.radar.isReady()) {
  const targets = await bot.radar.scan();
  if (targets.length) bot.turret.setOrientation(targets[0].angle);
}
```

Do that and you'll hit things that stand still. The trouble is that good bots don't stand
still (that's the whole point of [Stationary bots die](/blog/stationary-bots-die)), and
against anything moving, aiming _at_ it will miss almost every time. The reason is the one
detail everybody forgets: your bullet is not instant.

## The bullet takes time

A bullet travels at **250 pixels a second** (25 per tick, the number you'll use in code).
That's fast, but the arena is 750 pixels across, so a shot at a target halfway down the
board takes a second and a half to arrive. In that second and a half, an enemy moving at
top speed, about 50 pixels a second, has slid 75 pixels sideways. You aimed at where it
_was_. The bullet showed up at that spot, politely, and the enemy was long gone.

This is the single biggest jump in accuracy you can make, and every miss has a price: a
bullet that sails off the field is a five-second reload spent on nothing, a whole shot's worth
of opportunity gone while the enemy keeps maneuvering. So you don't aim at the target. You
aim at where it's _going_ to be.

## Lead the target

The idea is called leading, and you already do it in real life: you throw a ball to where
someone will run, not where they're standing. Here's the recipe in words:

1. See where the enemy is now, and figure out which way and how fast it's moving (compare
   its position across two scans, or read its motion from the scan).
2. Guess how long your bullet will take to reach it: distance divided by the bullet's
   speed of 25 gives you the flight time.
3. Project the enemy forward by that flight time: where will it be after that long, moving
   the way it's moving now?
4. Aim there instead of at the enemy itself, and fire.

In code the shape looks like this. The details of the geometry live in the
[leading lesson](/learn/leading), but the bones are just "project forward, then aim":

```js
if (bot.radar.isReady()) {
  const [target] = await bot.radar.scan();
  if (target) {
    const ticks = target.distance / 25; // flight time in ticks (each is a tenth of a second)
    // estimate where the enemy will be after `ticks`, from its motion,
    // then point the turret at THAT spot instead of its current one:
    const leadAngle = predictAngle(target, ticks);
    bot.turret.setOrientation(leadAngle);
    if (bot.turret.isReady()) bot.turret.fire();
  }
}
```

You don't need heavy trigonometry to start. A rough lead ("it's drifting left, so aim a
little left of it") beats no lead at all, and you can tighten the estimate later. The
[marksman](/samples/marksman) sample does the full version if you want to read a working
one; I'd start by getting a crude lead firing and watching how much your hit rate jumps
before you reach for the precise math.

The thing I love about leading is that it's pure anticipation. You're not reacting to the
enemy; you're predicting it, committing to a spot on the board a second and a half before
the truth arrives, and being _right_. That feeling, reasoning about the future and
watching the future agree with you, is the whole reason I fell for this game in the first
place. Get the gun firing reliably first, then come back and start aiming into the
future.
