# Stationary bots die

_January 16, 2024_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

If I could attach one rule to every new player's first bot, it would be this: keep
moving. A tank that sits still is the easiest target in the arena: a fixed point that any
enemy can lead perfectly and hit again and again. A bullet does **25 damage** and you only
have **100 health**, so four clean shots is the whole game. Standing still hands those four
shots to anyone who can aim. Almost every "why does my bot keep dying?" question I get has
the same root: the tank stopped moving.

So here are the five movement habits that keep a tank alive, roughly in the order I'd add
them.

## 1. Never stop moving

This is the whole post in one line, but it's worth stating on its own. A moving tank forces
every enemy to solve the [leading problem](/learn/leading) (guess where you'll
be when the bullet arrives), and most of the time they'll guess wrong. A still tank makes
that problem trivial. Give your bot a default of "always be going somewhere," and only
override it for a good reason.

```js
bot.setSpeed(5); // top speed; the default should be "moving"
```

## 2. Don't hug the walls

Corners feel safe and they are a trap. Two things go wrong at the edge. First, a wall stops
you. A collision costs **a point of health every tenth of a second you're stuck against it** _and_ drops your
speed to zero, turning you into the stationary target from rule one. Second, and
worse, the wall shrinks the angles you have to escape through. In the open, a threat can
come from any direction and so can your dodge. Backed into a corner, you can only run two
ways, and a smart enemy just covers both. Stay toward the middle where you have room on
every side. There's a whole post on this, [Walls and retreat](/blog/walls-and-retreat),
because I learned it the hard way.

## 3. Move unpredictably

A tank that moves in a straight line, or a perfect circle, or flips direction on a fixed
timer, is still easy to lead. You're moving, but you're _predictable_, and a good bot will
learn your pattern and aim at the pattern instead of at you. Throw some randomness into your
turns and your timing so no enemy can model you:

```js
if (Math.random() < 0.1) {
  bot.turn(90 + Math.random() * 90); // an unpredictable jink
}
```

The goal is to make yourself un-leadable, not chaos for its own sake. Every time an
enemy has to re-guess your motion, they waste a shot, and every wasted shot on their side
is a long reload spent hitting nothing while you're still in the fight.

## 4. Watch your health and run

Bravery is a bug. Track your own health, and when it gets low, stop trading shots and get
out. A tank that survives to fight in a better moment beats a tank that goes down swinging.

```js
if (bot.getHealth() < 30) {
  bot.turn(180); // break off
  bot.setSpeed(5); // and run; live to shoot later
}
```

Living longer is how you win: the last tank standing takes the match,
and half of surviving is knowing when the current fight isn't worth your last 30 health.
The [survival lesson](/learn/survival) goes deeper on retreating well.

## 5. Don't stop to aim, turn the turret instead

This is the one that surprises people, and it's the reason none of the rules above conflict
with shooting. Your turret rotates **independently of your body.** You do not have to face
an enemy to shoot it: you point the _gun_ at it while the _tank_ keeps driving wherever
it's driving. So the instinct to slow down and line up a shot is exactly backwards:

```js
bot.setSpeed(5); // body keeps moving, evading
bot.turret.setOrientation(target.angle); // gun tracks the target on its own
if (bot.turret.isReady()) bot.turret.fire();
```

Movement and aiming are two separate jobs on two separate mounts. The good tanks never
trade one for the other: they dodge with the body and hunt with the turret at the same
time.

Put all five together and you get the baseline every competitive tank is built on: always
moving, off the walls, unpredictable, health-aware, and shooting on the move. The
[survivor](/samples/survivor) sample is a good, plain example to read. And if your tank
keeps dying in the first few seconds, start with [movement](/learn/move) and work up.
