# Lesson 2: Do something every moment

**By the end of this lesson you'll be able to:**

- Make your robot do something over and over, on its own
- Understand **events**, the heartbeat of every bot

**New idea:** _"When this happens, do that."_

## The idea

So far our robot just sits there. To make it _act_, we need to run code at the right
moments. Programmers do this with **events**.

An event is something that happens, like a doorbell ringing. You decide what to do
**when** it happens. "When the doorbell rings, open the door." In code we call the
"what to do" part a **handler** (it _handles_ the event).

The most important event is the **TICK**. The game has a clock that ticks many times a
second, like a heartbeat. Every tick is a chance for your robot to think and act.

## Try it

Replace your code with this:

```
bot.setName('Rusty');

clock.on(Event.TICK, () => {
  console.log('tick!');
});
```

Press **Deploy**, then open the **log panel** (menu: **Arena → View Logs**). You'll see
`tick!` printed over and over, once per heartbeat.

Let's break down the new line:

- `clock.on(Event.TICK, ...)` means "**when** the clock ticks, do this."
- The part `() => { ... }` is the **handler**, the code that runs each tick. This shape
  is called a **function**: a little bundle of instructions you hand to the game to run
  later. The `=>` is just how we write "a function that does...".
- `console.log('tick!')` prints a message to the log panel. `console.log` is your robot's
  way of "thinking out loud", super useful for seeing what's going on.

## Experiment

- Change `'tick!'` to a message of your own.
- Add a second line inside the handler: `console.log('still going');`. Both lines run
  every tick, top to bottom.
- The TICK is where most of your robot's behavior will live. Keep this handler. We'll
  fill it with real actions in the next lessons.

## Common questions

**My logs are scrolling too fast!**
That's normal. The clock ticks quickly. We're just peeking. Soon we'll do real actions
instead of printing.

**What's a "function"?**
A function is a reusable bundle of instructions. Here we're handing one to `clock.on`
so the game can run it every tick. You'll write many functions as you go.

**What's the difference between `bot` and `clock`?**
`bot` is your robot. `clock` is the game's timer. You ask `clock` to tell you _when_ to
act, and you tell `bot` _what_ to do.

## You learned

- An **event** is something that happens; a **handler** is the code you run when it does.
- `clock.on(Event.TICK, () => { ... })` runs your code every game tick.
- `console.log(...)` prints to the log panel so you can see what your bot is doing.

---

[← Hello, bot!](/learn/hello) · [Index](/learn) · Next: [Move! →](/learn/move)
