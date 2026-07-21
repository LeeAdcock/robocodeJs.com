# Lesson 5: Bumping into walls

**By the end of this lesson you'll be able to:**

- React when your robot hits something
- Make your robot **decide** between two actions

**New idea:** _Making choices with `if` / `else`, and reading **objects**._

## The idea

When your robot runs into a wall or another robot, an event fires: **COLLIDED**. Hitting a **wall** stops you dead. Hitting another **robot** shoves the two of you apart instead, so you keep rolling. Either way the bump costs you a little health, so we want to handle that event and back out of trouble.

This event hands our handler some information. It comes as an **object**: a bundle of labeled values. We read a value with a dot and its label:

- `info.angle`: the direction the thing we hit is in, relative to your heading (`0` is straight ahead)
- `info.friendly`: `true` for a teammate and `false` for an enemy. A **wall** isn't a robot, so it has no `friendly` at all (`undefined`), which still counts as "not true"

`true`/`false` values are called **booleans**, and they let us make **decisions** with `if` and `else`: "**if** this is true, do one thing, **else** do another."

## Try it

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

bot.on(Event.COLLIDED, (info) => {
  if (info.friendly) {
    bot.turn(120); // bumped a teammate — sidestep
  } else {
    bot.turn(180); // wall or enemy — turn right around
  }
  bot.setSpeed(3); // we stopped on impact, so get moving again
});
```

Press **Reboot**. Now when Rusty hits a wall it turns away and keeps going instead of sitting there. Watch closely and you'll see it bump the same wall a few more times on the way out: that turn takes around 15 ticks, and `bot.setSpeed(3)` is pushing into the wall for every one of them. Getting free costs a little health. It still beats being stuck.

What's happening:

- `(info) => { ... }`: the handler receives the `info` object. (You can name it anything; `info` is just a friendly label.)
- `if (info.friendly) { ... } else { ... }`: chooses an action based on a true/false value.
- We call `bot.setSpeed(3)` again because **hitting a wall sets your speed to 0**. A bump with another robot doesn't stop you, so there the line is simply harmless.

## Experiment

- Add `console.log('bumped, friendly?', info.friendly);` as the first line of the handler, then watch the log when Rusty hits a wall (a wall is **not** friendly).
- Change the `else` turn from `180` to `150` so it doesn't retrace its exact path.
- Delete the `bot.setSpeed(3)` line and Reboot. Rusty gets stuck against the wall after its first bump, that's why we re-start it!
- See the wall coming **before** you hit it: put `console.log('wall in', arena.getNearestWall().getDistance());` in a `clock.on(Event.TICK, ...)` handler and watch the number shrink as Rusty closes in. It bottoms out around 16, because robots stop a little before the wall itself.

## Common questions

**What exactly is an "object"?** A bundle of related values with labels. `info` bundles `angle` and `friendly` together. You read one piece with a dot: `info.angle`.

**The dot in `bot.turn` and the dot in `info.angle` look the same, are they?** Same idea: the dot reaches **into** something. `bot.turn` reaches into `bot` for an action; `info.angle` reaches into `info` for a value.

**Does COLLIDED fire for walls or only robots?** Both, any time you run into something. `info.friendly` tells them apart: `true` is a teammate, `false` is an enemy, and a wall has no `friendly` at all (`undefined`).

## You learned

- The **COLLIDED** event fires when you hit something — a wall stops you, another bot shoves you apart.
- Its handler gets an **object** `info` with `info.angle` and `info.friendly`.
- `if (...) { } else { }` makes a decision; `true`/`false` values are **booleans**.

---

[← Which way?](/learn/turn) · [Index](/learn) · Next: [Fire the turret →](/learn/fire)
