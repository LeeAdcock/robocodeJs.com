# How do you unit-test a game you can't see?

_March 9, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Most of what makes RobocodeJs fun is also what makes it hard to test. It's real-time:
things happen tick by tick (a tick is the game's tenth-of-a-second heartbeat). It's
visual: the proof that it works is tanks moving on a
screen. And its core feature is _running other people's code inside a sandbox_, which is
about as far from a tidy pure function as you can get. You can't exactly write
`expect(theGame).toLookRight()`.

So how do I know that a bullet does 25 damage, that a timeout kills a bot, that a tank
turns when told to, without opening a browser and squinting at it? The answer
is automated tests: small programs whose only job is to re-check the game's promises,
automatically, every time I change the code. I've landed on three patterns of them, each
aimed at a different layer, and together they cover a surprising amount.

## Pattern one: fake tanks, real physics

The physics engine (movement, collisions, damage, who-hit-whom) is the beating heart of
the game, and happily it's also the part that doesn't _care_ where its tanks came from.
The engine just reads a tank's position and heading and speed, does the math, and writes
the results back. It doesn't need a sandbox or real bot code, only objects shaped like
tanks.

So the first pattern is to hand the engine **lightweight mock tanks**, plain objects with
the right fields. Place them exactly where I want, run one tick, and check what happened.
Put two tanks close enough and assert they collide. Fire a bullet into one and assert its
health dropped by 25. Miss a shot and assert the small penalty landed instead. It's fast,
it's deterministic, and it lets me test every corner of the physics without the weight of
the sandbox at all.

```js
// (illustrative; the real tests are wordier, but this is their shape)
// place two mock tanks 200 pixels apart, fire, let the bullet fly
const target = mockTank({ x: 100, y: 100, health: 100 });
const shooter = mockTank({ x: 100, y: 300 });
fireAt(shooter, target);
simulation.run(ticksUntilImpact);
expect(target.health).toBe(75); // -25 on a clean hit
```

This layer is where I catch the "I tweaked the movement math and broke collisions" class
of bug, which is the most common thing I break.

## Pattern two: a real sandbox, to lock the contract

The mock tanks prove the physics. They don't prove the thing bots actually touch: the
API surface. When a bot writes `bot.turret.fire()` or `bot.radar.scan()`, is that call
wired to the right machinery? Does `clock.getTime()` return a number? Is `Date` really
switched off like it's supposed to be?

For that, the second pattern spins up a **real isolated-vm isolate** (an actual sandbox,
the same kind a live bot runs in) and pokes at the bot-facing API from inside it. This is
the test that guards the _contract_: the promise I make to every bot author that these
functions exist and behave a certain way. If I ever accidentally rename something bots
depend on, or expose something I shouldn't (the sandbox deserves a post of its own
someday), this layer goes red. It's slower than the mock tests because it's booting a real V8 sandbox, so
there are fewer of them, but each one is worth a lot.

## Pattern three: a real bot, driven tick by tick

The first two patterns test the halves. The third tests the whole thing glued together,
because that's where the interesting bugs hide.

This pattern takes a **real bot**, compiles it into a **real isolate**, drops it into the
simulation, and then drives the match forward one tick at a time, asserting the tank's
state as it goes. This is the closest thing to "playing the game" that a test can be, and
it's caught things the isolated tests never could, because it exercises the seam between
the async sandbox and the synchronous physics.

That seam is subtle, and worth understanding: a bot's commands are **asynchronous** (the
bot `await`s them) but their _effects_ land synchronously. When a bot sets its target
speed, that intent is recorded immediately; then the physics engine applies it gradually,
over ticks, as the tank accelerates. So the test does a little dance: advance a tick, let
the bot's async work settle, check the state, advance again. Watching a real tank crawl up
to speed across a handful of ticks, in a test, with no browser open, is oddly satisfying.

## What each one buys me

The three form a ladder. The mock-tank tests are cheap and plentiful and cover the physics
exhaustively. The real-isolate tests are fewer but they guard the exact promises bots rely
on. The full integration tests are the fewest and slowest, but they're the ones that prove
the pieces actually work _together_.

None of them require me to look at the screen, which is the whole point. The determinism I
build into the game (one seed, tick-driven, no wall clock; see
[Making randomness repeatable](/blog/repeatable-randomness)) is exactly what makes it
testable: a match that behaves identically every run is a match you can write an assertion
about. A game you can't see, it turns out, is perfectly testable, as long as you build it
so that "what should happen" is never in doubt.
