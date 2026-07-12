# Radar

_November 10, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Everything your tank knows about the world, it learns through the radar. It can't see the
whole arena. It doesn't get a map. The only way it finds out an enemy exists is
`bot.radar.scan()` coming back with something in it. If your radar is pointed at empty
space, your tank is blind: a perfectly-aimed gun with nothing to shoot, because it never
found a target to shoot at. So before aim, before movement, before anything: your radar
has to be _looking in the right place_.

## The two knobs

The radar has exactly two constraints, and your whole radar strategy is a negotiation
between them.

First, it's slow to turn. The radar swings at about **40 degrees a second**, same as the
turret and much slower than your body, which turns at roughly 100 degrees a second. You
can't snap the radar across the board. Pointing it somewhere new takes real time, and
while it's traveling, it's staring at whatever it passes over, not at what you want.

Second, it recharges. After a scan, the radar needs about a second before it can scan
again. So you don't get a continuous stream of the world; you get a snapshot roughly once
a second, from wherever the radar happens to be aimed at that moment. Aim it badly and
your snapshot is empty.

Put those together and the radar's whole personality falls out: you get one look per
second, and moving your gaze is expensive.

## Sweep or lock

Which leaves you with a genuine tactical choice every match, and it's the fun part.

**Sweeping** means you keep the radar turning, raking it across the arena so that once a
second it catches whoever's out there. It's how you _find_ enemies when you don't know
where anyone is. The cost is that any single target only crosses your beam occasionally,
so your information about it is always a little stale.

**Locking** means you stop sweeping and keep the radar pinned on one enemy, scan after
scan, so you always know exactly where _that_ tank is and where it's headed. It's how you
feed a good [leading shot](/blog/aim-where-theyll-be): precise, fresh position data on
one target. The cost is tunnel vision: while you're locked on one tank, the other four are
doing whatever they like, unwatched.

Most strong bots do both, in phases. Sweep until you find someone worth shooting, lock on
long enough to kill them, then sweep again. The [lighthouse](/samples/lighthouse) sample
is the one to read here: a clean, continuous sweep, the radar turning like a
lighthouse beam. It's a great skeleton to graft a lock onto once you understand it.

```js
// keep the beam turning, and grab whatever it finds each scan
bot.on(Event.SCANNED, (targets) => {
  // ...found someone; decide whether to keep sweeping or lock on
});
```

If there's one thing to take away, it's that radar is the sense that makes everything else
possible, and it's the one beginners neglect. You can have the best aim and the smartest
movement in the arena, but if your beam is pointed at a wall, none of it fires. Get your
eyes working first. The [radar lesson](/learn/radar) goes deeper, and
[lighthouse](/samples/lighthouse) is fifteen lines of tank that never stops looking.
