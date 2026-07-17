# Lesson 13: Maps and math

**By the end of this lesson you'll be able to:**

- Send your robot to an exact spot in the arena
- Use **markers** to handle the direction-and-distance math for you

**New idea:** _Marker pins (and a peek at the `Math` toolbox)._

## The idea

To drive somewhere, you need two things: which **direction** it's in and how **far** it
is. Working that out by hand needs geometry — but a **marker** does it for you.

A marker is a pin on the map. Two ways to make one:

- `arena.createMarker(x, y)` — a pin at an exact spot you choose.
- `bot.dropMarker()` — a pin right where your robot is standing now.

Once you have a marker, ask it:

- `marker.getBearing()` — the bearing to the pin **relative to your heading**, so
  `bot.turn(getBearing())` faces it (updates as you move).
- `marker.getDistance()` — how far you are from the pin.

(For custom calculations there's also `Math`, a built-in toolbox of number tools like
`Math.sqrt`. But markers cover most navigation without it.)

## Try it

Drive to the middle of the arena and stop when you arrive:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  // A pin in the center of the arena.
  this.target = arena.createMarker(arena.getWidth() / 2, arena.getHeight() / 2);
});

clock.on(Event.TICK, () => {
  // Turn toward the pin (the bearing is relative, so we turn BY it).
  bot.turn(this.target.getBearing()).catch(() => {});

  if (this.target.getDistance() < 30) {
    bot.setSpeed(0); // close enough — we've arrived
  } else {
    bot.setSpeed(3);
  }
});
```

Press **Save**. Rusty heads straight to the center and parks there.

We store the marker in `this.target` (lasting memory) so every tick can ask it for the
latest bearing and distance. The `< 30` is an "are we close enough?" check.

## Experiment

- Send Rusty to a corner instead: `arena.createMarker(40, 40);`
- Remember home base and return there when hurt:
  - In START: `this.home = bot.dropMarker();`
  - In a HIT handler: `bot.turn(this.home.getBearing()).catch(() => {}); bot.setSpeed(5);`
- Log the distance as you travel: `console.log('distance to target', this.target.getDistance());`
- Before pinning a spot, check it's actually in the arena:
  `if (arena.contains(x, y)) { this.target = arena.createMarker(x, y); }`
- `arena.getNearestWall()` gives you a **ready-made marker** on the closest wall — log
  `arena.getNearestWall().getDistance()` in the TICK handler and watch it shrink as you
  approach a wall. (You'll stop a little short of 0 — you collide before the wall itself.)

## Common questions

**What's the difference between `createMarker` and `dropMarker`?**
`arena.createMarker(x, y)` pins a spot **you pick**. `bot.dropMarker()` pins **where you
are right now** — handy for remembering a location to come back to.

**Does the bearing change as I move?**
Yes! `getBearing()` and `getDistance()` are always measured from your **current** spot to
the pin, so they update every tick as you drive. That's what makes steering toward it
work.

**Do I need `Math` for this?**
Not for going to a marker — the marker does the geometry. Reach for `Math` when you want
custom calculations the markers don't cover.

## You learned

- `arena.createMarker(x, y)` pins a chosen spot; `bot.dropMarker()` pins your current spot.
- `marker.getBearing()` and `marker.getDistance()` give direction and distance from you.
- `Math` is a toolbox of number helpers for custom calculations.

---

[← Rhythms and timers](/learn/timers) · [Index](/learn) · Next: [Leading a moving target →](/learn/leading)
