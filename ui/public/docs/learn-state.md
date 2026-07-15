# Lesson 10: Remembering things

**By the end of this lesson you'll be able to:**

- Give your robot a "mind" that remembers what it's doing
- Organize behavior into named, reusable pieces

**New idea:** _Lasting memory with `this`, and a **state machine** (modes)._

## The idea

A `let` box from Lesson 8 is forgotten the moment its handler finishes. But a robot needs
memory that **lasts** between events — like its current mood. For that we use **`this`**:
a shared notebook that all your handlers can read and write, and that even survives a
code Save.

A great use of lasting memory is a **state machine**: your robot is always in one
**mode** (a state), and it behaves differently depending on which. We'll use two modes:
`SEARCH` (wander and look) and `ATTACK` (shoot the enemy). The bot switches modes as
things happen.

We'll also tidy our code into a **named function** — a reusable bundle we can call by
name from anywhere.

## Try it

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  this.mode = 'SEARCH'; // remember our starting mode
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) bot.radar.scan();

  if (this.mode === 'SEARCH') {
    if (!bot.isTurning()) bot.turn(20); // wander while looking
  }
});

bot.on(Event.SCANNED, (targets) => {
  const enemies = targets.filter((t) => !t.friendly);
  if (enemies.length > 0) {
    this.mode = 'ATTACK';
    aimAndFire(enemies[0]);
  } else {
    this.mode = 'SEARCH';
  }
});

// A named helper we can reuse anywhere.
function aimAndFire(target) {
  bot.turret.setOrientation(target.angle);
  if (bot.turret.isReady()) bot.turret.fire();
}
```

Press **Save**. Rusty wanders in `SEARCH`, and the moment it spots an enemy it flips to
`ATTACK` and fires.

New pieces:

- `this.mode = 'SEARCH'` stores the mode in lasting memory; `this.mode === 'ATTACK'`
  checks it.
- `targets.filter((t) => !t.friendly)` makes a **new list** containing only the enemies.
  `filter` keeps the items that pass your test.
- `function aimAndFire(target) { ... }` defines a reusable action we call with
  `aimAndFire(enemies[0])`.

## Experiment

- Watch the brain work: add `console.log('mode:', this.mode);` at the top of your TICK.
- Add a third mode. In SCANNED, if there are no enemies but you were attacking, set
  `this.mode = 'SEARCH'`. Try adding a `FLEE` mode you switch to later (next lesson!).
- Make ATTACK chase: inside the `enemies.length > 0` block, add
  `bot.setOrientation(enemies[0].angle);`

## Common questions

**Why `this.mode` instead of `let mode`?**
A `let` inside a handler is forgotten when that handler ends. `this.mode` lives on your
robot's shared notebook, so every handler sees the same value — and it even survives a
code Save, so editing mid-match won't wipe your robot's memory.

**Do my five robots share this memory?**
No — each robot gets its **own** private notebook. When one bot sets `this.mode`, the
other four don't see it, and a top-level `let` variable is private to a single bot too
(they run the same code, but each keeps its own copy). To share something across your
team, you **send a message** — that's [Lesson 15](/learn/teamwork).

**What does `filter` do (vs `forEach`)?**
`forEach` _visits_ every item. `filter` _builds a new shorter list_ of just the items that
match — here, the enemies.

**Why make a function like `aimAndFire`?**
So you can reuse it and keep your handlers short and readable. If you want to aim-and-fire
in two places, you write it once and call it twice.

## You learned

- `this.something` is lasting memory shared across handlers (and across Saves).
- A **state machine** keeps a `mode` and acts differently per mode.
- `list.filter(test)` builds a new list of matching items.
- `function name(args) { ... }` defines a reusable action you call by name.

---

[← Good things take time](/learn/waiting) · [Index](/learn) · Next: [Survival →](/learn/survival)
