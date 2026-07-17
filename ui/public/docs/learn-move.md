# Lesson 3: Move!

**By the end of this lesson you'll be able to:**

- Drive your robot around the arena
- Ask your robot **where** it is

**New idea:** _Instructions can take **values** (numbers), and can give answers back._

## The idea

Last lesson we made the robot "think" every tick. Now let's make it _move_.

To drive, we use `bot.setSpeed(...)`. The `...` is a **value** we hand to the
instruction. Programmers call it an **argument**. For speed, the argument is a number:

- `0` means stop.
- `5` is full speed ahead.
- A negative number like `-3` means reverse.

We also want to set things up once at the start. There's a special event for that:
**START**, which runs one time when your robot begins.

## Try it

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  console.log('I am at', bot.getX(), bot.getY());
});
```

Press **Deploy**. Rusty drives forward, and the log shows two numbers that keep changing.

Those numbers come from **questions you ask the robot**:

- `bot.getX()` answers "how far across am I?" (left-to-right)
- `bot.getY()` answers "how far down am I?" (top-to-bottom)

The arena's top-left corner is `0, 0`. X grows as you go right; Y grows as you go down.
You can ask how big the arena is with `arena.getWidth()` and `arena.getHeight()`.

Notice some instructions **do** something (`setSpeed`) and others **answer** something
(`getX`). The ones that answer hand a value back that you can print or use.

## Experiment

- Change `bot.setSpeed(3)` to `bot.setSpeed(5)`, full speed. Then try `0` (it stops)
  and `-3` (it backs up).
- Add this line inside START to see the arena size:
  `console.log('arena is', arena.getWidth(), 'x', arena.getHeight());`

## Common questions

**My robot drove to the edge and stopped. Why?**
It bumped into the wall! Hitting something stops you. We'll learn to react to that in
the next lesson.

**What's the difference between `setSpeed` and `getX`?**
`setSpeed` is a command: it changes something. `getX` is a question: it gives you an
answer back. Commands often end in `set...`, questions often start with `get...`.

**Why put `setSpeed` in START instead of TICK?**
START runs once, which is perfect for "start driving." If you put it in TICK it would
run every heartbeat, usually unnecessary, though not harmful here.

## You learned

- `bot.setSpeed(n)` drives the robot; `n` ranges from `-5` (reverse) to `5` (full speed),
  `0` stops.
- `bot.getX()` / `bot.getY()` tell you your position; `0, 0` is the top-left corner.
- `arena.getWidth()` / `arena.getHeight()` give the arena size.
- The **START** event runs once at the beginning, a good place to set things up.

---

[← Do something every moment](/learn/events) · [Index](/learn) · Next: [Which way? →](/learn/turn)
