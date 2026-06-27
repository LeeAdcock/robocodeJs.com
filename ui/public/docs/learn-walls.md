# Lesson 5: Bumping into walls

**By the end of this lesson you'll be able to:**

- React when your robot hits something
- Make your robot **decide** between two actions

**New idea:** _Making choices with `if` / `else`, and reading **objects**._

## The idea

When your robot runs into a wall or another robot, it **stops** and an event fires:
**COLLIDED**. We can handle that event to back out of trouble.

This event hands our handler some information. It comes as an **object** — a bundle of
labeled values. We read a value with a dot and its label:

- `info.angle` — the direction the thing we hit is in (in compass degrees)
- `info.friendly` — `true` if we bumped a teammate, `false` otherwise

`true`/`false` values are called **booleans**, and they let us make **decisions** with
`if` and `else`: "**if** this is true, do one thing, **else** do another."

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

Press **Save**. Now when Rusty hits a wall it spins around and keeps going instead of
getting stuck.

What's happening:

- `(info) => { ... }` — the handler receives the `info` object. (You can name it anything;
  `info` is just a friendly label.)
- `if (info.friendly) { ... } else { ... }` — chooses an action based on a true/false value.
- We call `bot.setSpeed(3)` again because **hitting something sets your speed to 0**.

## Experiment

- Add `console.log('bumped, friendly?', info.friendly);` as the first line of the handler,
  then watch the log when Rusty hits a wall (a wall is **not** friendly).
- Change the `else` turn from `180` to `150` so it doesn't retrace its exact path.
- Delete the `bot.setSpeed(3)` line and Save. Rusty gets stuck after the first bump —
  that's why we re-start it!

## Common questions

**What exactly is an "object"?**
A bundle of related values with labels. `info` bundles `angle` and `friendly` together.
You read one piece with a dot: `info.angle`.

**The dot in `bot.turn` and the dot in `info.angle` look the same — are they?**
Same idea: the dot reaches **into** something. `bot.turn` reaches into `bot` for an
action; `info.angle` reaches into `info` for a value.

**Does COLLIDED fire for walls or only robots?**
Both — any time you run into something. Use `info.friendly` to tell a teammate apart from
a wall or enemy.

## You learned

- The **COLLIDED** event fires when you hit something and stops you.
- Its handler gets an **object** `info` with `info.angle` and `info.friendly`.
- `if (...) { } else { }` makes a decision; `true`/`false` values are **booleans**.

---

[← Which way?](/learn/turn) · [Index](/learn) · Next: [Fire the turret →](/learn/fire)
