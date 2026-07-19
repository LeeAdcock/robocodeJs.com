# See the arena the way the simulation does

_May 11, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

The arena is pretty. Grass and sand, tank sprites that swivel and scan, tread marks fading behind each bot. That art is doing you a small disservice, though, because it hides the game your code is actually playing. Your bot doesn't drive over a road. It's a circle at a coordinate, pointed at an angle, moving at a speed, and everything it does is arithmetic on those numbers.

There's now a button in the arena toolbar that strips the paint away. Press it and the battlefield becomes a **schematic**: a measurement grid, tanks drawn as the plain circles the physics treats them as, and every heading, aim, and radar sweep drawn as an explicit line. It's the arena as the simulation models it, and once you've debugged a bot with it you won't want to go back to guessing.

## What the schematic shows

Turn it on and the scene redraws from scratch. A **50-pixel grid** with coordinate labels every 100 units gives you a ruler for the whole arena, so a position in your logs maps to a spot you can point at. Each tank becomes a circle of radius 16, which is not a stylistic choice: that _is_ its collision shape. When two of those circles touch, the sim calls it a hit. Seeing the real discs instead of the sprites is the first time a lot of people realize how much bigger their bot's footprint is than the sprite suggests.

Then come the vectors, one set per machine in the [body, turret, and radar](/blog/tank-turret-radar) anatomy. Each is drawn twice: a solid line for where the part is pointing right now, and a dashed, dimmer line for where you've told it to go. When your bot is mid-turn, the two lines fan apart by exactly the angle it still has to travel; when it settles, the solid line covers the dashed one and they become one. The body's heading line even grows longer as the bot speeds up, so a fast bot throws a long spear and a stopped one shows just a stub at the rim. And the radar draws its actual **detection cone**, the narrow wedge that widens with range, so you can see the slice of the world your scan is really covering.

## Click a tank and it tells you everything

Vectors are the overview. When you want the numbers, click a tank to **focus** it. The others dim to get out of the way, and the one you picked lights up with the full readout.

A telemetry panel appears in the corner listing the exact values your code reads: position, heading, speed, turret angle, radar angle, health. Not approximations, not the interpolated on-screen guess, but the same figures your `bot.getX()` and friends return this tick. When a value is changing, the panel shows it as a transition, like `90° → 180°`, so you can watch a command take effect over the ticks it takes to complete. If your bot thinks it's aimed at 90 degrees and the panel says otherwise, you've just found your bug without adding a single `console.log`.

Around the focused tank, **range rings** at 100, 200, and 300 units turn distances into something you can eyeball, and each vector gets a small **angle tag** at its tip reading out its heading in degrees. This is the view where "lead your shots" stops being abstract advice. You can see the target's [heading trajectory line](/blog/aim-where-theyll-be) projected across the arena, measure the gap with the rings, and watch whether your turret's solid line is pointing where the enemy _will be_ or where it _was_.

## The two features I use most

Two smaller things ended up being the ones I reach for constantly.

The first is **radar detection lines**. When a scan finds a target, the schematic draws a dotted line straight from the scanner to whatever it hit. This answers the single most common radar question — "did my sweep actually catch anything?" — at a glance. If you're sweeping and no lines are appearing, your radar is pointed at empty space, and that's usually the whole story behind [a bot that won't shoot](/blog/why-wont-my-bot-shoot). Bullets get the same treatment: each one draws its projected path to the wall with a little number counting down its remaining travel, plus a faint trace back to where it was fired.

The second is **single-tick stepping**. Pause the arena and a step button appears; each press advances the simulation exactly one tick and stops. This is the debugger's single-step, applied to a battle. When something happens too fast to see — a collision, a missed shot, a turn that overshoots — you pause just before it, then walk through it one frame at a time, reading the telemetry panel at every step. Real-time debugging asks you to reconstruct what happened from the wreckage. Stepping lets you watch it happen.

The whole thing re-themes with [light and dark mode](/blog/the-arena-is-a-web-page) and, like the sprites, eases its lines smoothly between ticks so nothing jitters. But the polish isn't the point. The point is that a bot is a small program reasoning about numbers, and for a long time the only way to check that reasoning was to print the numbers and imagine the picture. Now the picture is right there, drawn from the same values, updating as it fights. Tune a radar sweep, lead a moving target, or work out why your aim is always a hair behind — do it once with the schematic on, and you'll understand your own bot better than the logs ever let you.
