# See the arena the way the simulation does

_May 11, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Most bot bugs aren't crashes. Your code runs fine, it just does the wrong thing: the turret is always a beat behind, the radar swings past a target and never sees it, a shot that looked perfect sails wide. Nothing errors, nothing logs, and you're left staring at the arena trying to reverse-engineer what your bot _thought_ it was doing from what it actually did. That gap — between the picture in your head and the numbers the simulation is really working with — is where most of the frustration in this game lives.

There's now a button in the arena toolbar that closes that gap. Press it and the pretty battlefield is replaced by a **schematic**: the arena redrawn as the simulation actually models it, with your bot's heading, aim, and radar shown as lines instead of left to your imagination. It's a debugging view, and the whole reason it exists is to stop you guessing.

## Stop guessing about your radar

Everything your bot knows comes through [the radar](/blog/radar), which makes radar the hardest thing to debug: when a sweep misses, nothing happens, and "nothing happened" looks identical whether your logic is wrong, your timing is off, or there was simply nothing there. It's the number-one reason behind [a bot that just sits there](/blog/why-wont-my-bot-shoot).

The schematic makes a scan visible. When your radar detects something, it draws a line straight to what it found — so a successful sweep is a line appearing, and a miss is the absence of one. Suddenly the question "did that scan catch anything?" has a yes-or-no answer you can watch in real time. You can see your beam sweeping across empty space a tick before it would have crossed a target, or catching an enemy exactly as it fires, and tune the sweep accordingly. The difference between a radar that finds people and one that doesn't is usually a few degrees or a few ticks, and this is how you find those degrees.

## Stop guessing about your aim

The other place bots quietly fail is aim. [Leading a moving target](/blog/aim-where-theyll-be) is the skill that separates a bot that lands shots from one that mostly doesn't, and it's almost impossible to eyeball, because you're trying to judge where the turret is pointing versus where the enemy will be by the time the bullet gets there.

Click any tank to focus it and the schematic answers exactly that. It draws the target's path ahead of it, shows your turret's current aim as one line and where you've _commanded_ it to point as another, and puts range rings around your bot so distances stop being a guess. Now "lead your shots" is something you can see: is my turret line pointing where the enemy _will be_, or where it just _was_? A telemetry panel shows the same numbers your code reads this tick — position, heading, speed, turret, radar, health — so if your bot believes it's aimed at 90 degrees and the panel says 78, you've found the bug, no `console.log` required. When a value is mid-change the panel shows it settling, like `90° → 180°`, so you can watch a command take the ticks it takes to land instead of assuming it happened instantly.

That last point is the quiet theme of the whole view. Commands aren't instant — turning, aiming, and accelerating all take time — and a surprising number of bot bugs are really just code that assumed otherwise. Seeing the "current versus commanded" split drawn out makes that lag concrete in a way a wall of log numbers never does.

## Slow the fight down to your speed

Even with everything drawn, some things happen too fast to see: a collision, a missed shot at point-blank, a turn that overshoots and corrects. So the view comes with a **step** button. Pause the match and each press advances the simulation exactly one tick, then stops.

This is the single-step debugger, applied to a battle. Instead of reconstructing a bad moment from the wreckage, you pause just before it and walk through it one tick at a time, reading the telemetry at every frame. The moment your aim drifts off, the exact tick two bots clip each other, the frame a bullet should have connected and didn't — you can sit on each one and look. Real-time debugging asks you to imagine the frames between the numbers. Stepping just shows them to you.

It also draws the collision circles your bots really occupy — which are bigger than the sprites suggest — so "why did I take damage when I wasn't even touching them?" tends to answer itself the first time you turn the view on.

None of this changes how the game plays; it changes how much of it you can _see_. A bot is a small program reasoning about angles and distances, and for a long time the only window into that reasoning was to print the numbers and picture the rest. Now the picture is drawn for you, from the same values, updating as it fights. Next time your bot does something you can't explain, turn the schematic on and watch it happen — you'll spend a lot less time guessing, and a lot more time actually improving your bot.
