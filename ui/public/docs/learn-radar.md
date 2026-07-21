# Lesson 7: See your enemies: the radar

**By the end of this lesson you'll be able to:**

- Scan the arena for other robots
- Work through a **list** of everything you found

**New idea:** _Lists (arrays), and doing something **for each** item._

## The idea

Your robot has a **radar** (`bot.radar`) that can **scan** for other robots in the direction it's pointing. Like the turret, it needs time to recharge between scans, so we check `bot.radar.isReady()` first.

When a scan finishes, the **SCANNED** event fires and hands you a **list** of everything it found. A list (programmers call it an **array**) is just several things in a row. Each item is a robot you spotted, and it's an object with useful labels:

- `target.distance`: how far away it is
- `target.angle`: the bearing to it, relative to your heading (you'll use this to aim)
- `target.friendly`: `true` if it's a teammate
- `target.health`: how much life it has left, handy for picking off the weakest
- (also `target.id`, `target.speed`, `target.orientation`)

To look at every item in a list, we use **`forEach`**: "for each item, do this."

## Try it

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) {
    bot.radar.scan(); // results arrive in the SCANNED event below
  }
});

bot.on(Event.SCANNED, (targets) => {
  targets.forEach((target) => {
    console.log('spotted one', target.distance, 'away, friendly?', target.friendly);
  });
});
```

Press **Reboot** and watch the log. Whenever another robot crosses the radar's beam, you'll see a line about it. If nothing is in view, the list is empty and nothing prints — and that will be most of the time here, because nothing in this code points the radar anywhere. The beam does not swing around on its own; it looks wherever the robot happens to be facing. The last Experiment below fixes that, and from here on it is the difference between a robot that finds enemies and one that never sees a thing.

## Experiment

- Only report **enemies**: wrap the `console.log` in `if (!target.friendly) { ... }`.
- Print how many robots a scan saw with `console.log('saw', targets.length, 'robots');` inside the SCANNED handler (before the `forEach`). `.length` is the size of a list.
- Sweep the beam so it finds robots in other directions: add `bot.radar.turn(15);` in your TICK. Watch how many more sightings you get. The radar sits on the turret, which sits on the body, so turning either of those swings the radar too — but the radar can also turn on its own, and that is usually what you want, since the next lesson gives the turret a job of its own.

## Common questions

**What's an "array"?** A list of things in order, written with square brackets like `[a, b, c]`. The radar hands you an array of the robots it found. An empty list `[]` means it saw nothing.

**What does `forEach` do?** It runs your code once for every item in the list, handing you one item at a time (here, `target`). It's how you deal with "however many" robots there are.

**Why use the SCANNED event instead of reading `scan()` directly?** A scan takes a moment to complete. The SCANNED event tells you the instant it's done, the same "when this happens, do that" pattern you already know. (There's also a way to wait for the answer directly; that's the next lesson.)

## You learned

- `bot.radar.scan()` looks for robots; `bot.radar.isReady()` says if it's recharged.
- The **SCANNED** event hands you a **list (array)** of what was found.
- `list.forEach((item) => { ... })` runs code for each item; `list.length` is its size.
- Each result has `distance`, `angle`, `friendly`, and more.

---

[← Fire the turret](/learn/fire) · [Index](/learn) · Next: [Take aim →](/learn/aim)
