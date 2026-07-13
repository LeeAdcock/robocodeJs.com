# The arena is a web page

_March 9, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Most games draw themselves the way a painter works: grab a canvas, repaint every pixel,
sixty times a second. The RobocodeJs arena doesn't. Every tank you see is a piece of
markup sitting in the page, the same way this paragraph is. The battle is drawn in
**SVG**, a web standard for describing graphics as elements instead of pixels, and MDN
has my favorite one-line description of it: SVG is to graphics what HTML is to text.

That one decision shapes everything about how the arena looks and moves, so let me give
you the tour.

## A tank is three elements in a trench coat

Each tank on screen is really three stacked images, one per machine in the
[tank, turret, radar](/blog/tank-turret-radar) anatomy: a body sprite, a barrel sprite
rotated relative to the body, and a little radar sprite rotated relative to the barrel,
each carrying its own `transform`. Because they're separate elements, the three parts
rotate independently for free, which is exactly what the game needs: a tank that drives
one way, aims another, and scans a third is just three rotation values on three nodes.

Elements-not-pixels pays for itself all over. The health bar above each tank is two
rectangles whose color slides from green through yellow to red as a function of health.
Dead tanks aren't redrawn as wreck art; they're the same elements with half opacity and
a blur filter. And the entire night mode, the tint you get with the dark theme, is one
red-brown rectangle laid over the whole arena with a multiply blend mode. One element
darkens a battlefield.

## The browser is the animator

The server thinks in ticks, its tenth-of-a-second heartbeat, so raw positions arrive as
ten little jumps per second. Some of the smoothing happens in
[the browser's own copy of the physics](/blog/two-simulations-one-game), which predicts
positions between updates. But the final polish is almost embarrassingly simple: nearly
every moving element carries one line of CSS.

```css
transition: all 200ms linear;
```

That's it. When a tank's position or rotation changes, the browser itself tweens the
element to its new transform over 200 milliseconds, in time with the update cadence. I
don't run an animation loop for movement. I move the elements, and CSS glides them.

There's one trap in letting CSS interpolate rotation: the long way around. If a tank's
heading goes from 359 degrees to 1 degree, a naive transition spins it 358 degrees
backwards instead of nudging it 2 degrees forward, and early versions of the arena were
full of tanks doing dramatic pirouettes at the compass seam. The fix is a tiny
accumulator that always applies the shortest signed change, so the angle handed to the
transform grows and shrinks continuously and never snaps across the boundary.

The [red damage glow](/blog/rebalanced-in-a-weekend) is the other kind of CSS animation:
a keyframe pulse. When a tank takes a hit, a gradient circle appears behind it and runs
a one-second flare, rising fast, holding, fading out. Its peak brightness scales with
how hard the hit was, passed in as a CSS variable. And because the pulse belongs to the
stylesheet rather than the simulation, it even finishes animating when you pause the
game, which I find quietly charming: time stops, and the wound still throbs.

## A new landscape every battle

The grass, sand, roads, and trees under the fight are procedurally generated. When the
arena appears, a little terraformer runs: it picks a random line and declares one side
of it sandy, lays transition tiles along the shoreline, then sends a road-builder on a
random walk across the map, stepping tile by tile with a small chance of turning at
each step and stitching in the right corner and junction sprites as it goes. A few
forest clusters get scattered on top, each tree randomly sized and rotated, and a faint
shaded-relief layer underneath sells the illusion of contour.

Here's the design note I enjoy most: this is the only unseeded randomness in the game.
Everything that affects a match [flows from one seed](/blog/repeatable-randomness) so
fights can be replayed exactly. The scenery is exempt, because the scenery is paint.
Roads and trees don't block bullets or tanks; they're purely cosmetic, so they're
allowed to be different every time you visit. Determinism for the physics, novelty for
the eyes.

## Twenty breadcrumbs

The tread trails behind each tank have my favorite small data structure in the UI: a
ring of twenty points. The renderer doesn't record a tank's every position; it drops a
breadcrumb only when the tank _turns_, because a straight run needs no memory, just a
line from the last corner. Each new vertex writes over the oldest once the ring is
full, so a tank that fights for an hour costs exactly the same memory as one that just
spawned: twenty points, no more, ever.

Drawing the trail means walking the ring in insertion order, connecting the surviving
corners, and rendering each segment as a stretch of tread-track texture rotated to
match its direction, with older segments faded toward transparent. The whole effect,
the fading tire tracks that make the arena feel inhabited, is a fixed-size array and
some arithmetic.

None of this is heroic engineering, and that's the point I'd leave you with. A boring
old web standard, one line of CSS doing the animating, and a twenty-slot array turn out
to be enough to make a battlefield feel alive. The browser is a far better graphics
engine than it gets credit for. You just have to let it do its job.
