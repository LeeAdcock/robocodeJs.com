# Lesson 4: Which way? The compass

**By the end of this lesson you'll be able to:**

- Turn your robot and steer it in circles
- Read which direction it's facing

**New idea:** _Directions are just numbers (degrees), like a compass._

## The idea

A robot faces some direction, measured in **degrees** from `0` to `359` — like a
compass or a clock face. A full circle is `360` degrees.

In this arena the compass is:

- `0` = **south** (down) ⬇️
- `90` = **west** (left) ⬅️
- `180` = **north** (up) ⬆️
- `270` = **east** (right) ➡️

There are two ways to steer:

- `bot.turn(20)` — turn **20 degrees from where you're facing now**. Positive turns one
  way (clockwise), negative the other way.
- `bot.setOrientation(90)` — face an **exact** compass direction (here, west).

## Try it

This makes Rusty drive in a loop by turning a little, again and again:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (!bot.isTurning()) {
    bot.turn(20);
  }
});
```

Press **Save**. Rusty drives in circles!

The new pieces:

- `bot.isTurning()` answers **yes or no**: "am I in the middle of a turn?" (`true` or
  `false`). A yes/no value like this is called a **boolean** — more on those next lesson.
- `if (!bot.isTurning())` means "**if** I'm **not** already turning." The `!` means
  "not." So: only start a new turn once the last one finishes.

## Experiment

- Change `bot.turn(20)` to `bot.turn(5)` (wide, lazy circle) or `bot.turn(90)` (sharp).
- Try a negative turn like `bot.turn(-20)` — Rusty loops the other way.
- Add this to your TICK handler to see the direction:
  `console.log('facing', bot.getOrientation());`
- Replace the loop with a fixed heading: put `bot.setOrientation(180);` in START to drive
  straight north.

## Common questions

**Why is `0` south and not north?**
It's just this game's compass. The important part is the pattern: bigger numbers rotate
you around the circle. You'll get a feel for it quickly.

**What's the difference between `turn` and `setOrientation`?**
`turn` is **relative** ("turn 20 more from here"). `setOrientation` is **absolute**
("face exactly this way"). Use whichever is easier for what you want.

**The robot turns slowly — is that a bug?**
No. Robots turn at a limited speed, just like real machines. A big turn takes a little
time to finish.

## You learned

- Directions are degrees `0`–`359`: `0` south, `90` west, `180` north, `270` east.
- `bot.turn(n)` turns relative to now; `bot.setOrientation(n)` faces an exact direction.
- `bot.getOrientation()` tells you which way you face; `bot.isTurning()` answers yes/no.
- `!` means "not."

---

[← Move!](/learn/move) · [Index](/learn) · Next: [Bumping into walls →](/learn/walls)
