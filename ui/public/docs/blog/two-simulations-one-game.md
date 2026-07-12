# Two simulations, one game

_May 11, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Here's a confession that surprises people: the physics of RobocodeJs runs twice. Once on
my server, which is the real, authoritative version, the one that decides who actually
hit whom. And once in your browser, a second copy that's only there to make the picture
look smooth. Two simulations, one game. Let me explain why a sane person would do that.

## The problem: the truth arrives in jerks

The server advances the game one **tick** at a time. A tick is about 100 milliseconds,
so the server is sending your browser fresh news roughly ten times a second. Ten updates
a second sounds like plenty until you try to _watch_ it. If the browser did nothing but
draw each server update the instant it arrived, a tank crossing the arena would jump ten
little jumps a second: teleporting a short distance, freezing, teleporting again. Your
eye reads that as stutter.

Movies get away with 24 frames a second because each frame is motion-blurred and
continuous. Ten discrete snapshots a second, with hard edges, is not that. A tank doing
exactly the right thing on the server can still look like it's lurching around the
arena. The truth was fine; the _presentation_ of the truth was the problem.

## The fix: guess, then correct

The trick is to let the browser fill in the gaps. Between server updates, the browser
runs its own little copy of the movement math and _predicts_ where each tank should be.
The server said a tank was here, moving this direction, at this speed. So a sixtieth of
a second later, the browser can work out where it must be now and draw it there. It keeps
doing that, frame after smooth frame, until the next real update lands from the server.

When that real update arrives, the browser doesn't argue. The server is the source of
truth. If the browser's guess drifted a little, it snaps to the corrected position and
carries on predicting from there. Most of the time the guess is close, so the correction
is invisible. You just see a tank gliding across the arena, which is exactly the lie I
want to tell your eyes.

Conceptually it's as simple as this:

```js
// between server ticks, in the browser (headings are compass degrees, 0 = north):
tank.x += tank.speed * Math.sin((-tank.orientation * Math.PI) / 180) * dt;
tank.y += tank.speed * Math.cos((-tank.orientation * Math.PI) / 180) * dt;

// when the next server update arrives:
tank.x = serverTank.x; // trust the server, correct the drift
tank.y = serverTank.y;
```

Predict for smoothness, correct for truth. The server stays in charge of what really
happened; the browser is just a very good animator filling in the in-between frames.

## The catch: two copies of the math must agree

This is the part that keeps me honest. If the browser is going to predict where a tank
_will_ be, its movement math has to match the server's movement math. The browser's copy
is only a partial mirror (it doesn't need collisions or damage or any of the parts that
decide the match, just enough motion to interpolate), but the motion it does copy has to
agree with the real thing.

And that means every time I change how movement works on the server (turning, acceleration,
how speed ramps up) I have to change it in _two places_, or the two simulations start to
disagree. When they disagree, you get a specific, maddening symptom: the browser predicts
a tank sliding one way, then the server update says "actually, no," and the tank visibly
snaps back. A little rubber-band. The game is still correct, because the server always
wins, but it _looks_ wrong, and it looks wrong in a way that points straight at "your
two physics copies drifted apart."

I've made my peace with the duplication. I could try to share one body of math between a
Node server and a browser, and someday I might, but for now the honest tradeoff is: keep
two small copies in lockstep, and treat any rubber-banding as a bug telling me they've
fallen out of step. It's a good reminder that a smooth-looking game is often two systems
politely lying to you in perfect agreement. If you're curious how the server's authoritative
version stays reproducible tick for tick, that's the story in
[Making randomness repeatable](/blog/repeatable-randomness). And how those updates even
reach your browser is [Watching a battle, live](/blog/streaming-the-arena).
