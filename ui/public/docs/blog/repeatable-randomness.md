# Making randomness repeatable

_September 8, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

There's a small contradiction sitting at the heart of RobocodeJs, and I had to solve it
before the game could ever be fair. A good match needs randomness: tanks shouldn't start
in the same spot every time, or the whole thing becomes a memorization exercise. But a
good match also needs to be _repeatable_. If a bot mysteriously loses, I want to run that
exact fight again and watch what went wrong. Randomness and repeatability sound like
opposites. You can't rewind a coin flip.

Except you can, if the randomness isn't really random.

## Random enough, but on rails

Computers don't actually flip coins. What they have is a **pseudo-random** number
generator: a formula that takes a starting number (the **seed**) and grinds out a long,
chaotic-looking sequence of numbers from it. The sequence looks random. It passes for
random. But it's completely determined by that one seed. Feed the formula the same seed
tomorrow and it produces the exact same sequence, number for number.

That's the trapdoor out of the contradiction. If every unpredictable thing in a match is
drawn from one seeded generator, then the seed _is_ the match. RobocodeJs uses a tiny,
fast generator called mulberry32 for this. Give it seed 12345 and the tanks spawn in one
arrangement; give it 12346 and they spawn in another. Both feel random to a player. Both
are perfectly reproducible to me.

## One seed, the whole match

The part that makes it work: the seed doesn't just place the tanks. It
drives _every_ source of randomness in the match, including the one inside your bot.

When your bot calls `Math.random()`, it isn't getting the browser's or the server's real
randomness. Inside the sandbox, I've wired `Math.random` to draw from the same seeded
generator that runs the match. So a bot that "randomly" picks a direction to scan, or
jitters its aim a little, will make the _exact same random choices_ every time the match
replays. Nothing floats free. The starting positions, the orientations, the coin flips
inside every bot: all of it descends from one number.

The seed handles the randomness; the game's clockwork advance handles the timing, one
tick at a time (a tick is the game's tenth-of-a-second step), each tick finishing all
its work before the next begins.
Put the two together and you get something powerful: a match that unfolds
identically every single time you run it, tick for tick, down to the last bullet. Set
the seed, and you can reproduce a fight exactly. It's less like a recording and more
like a player piano: the same roll always plays the same song.

## Why the leaderboard depends on this

This is more than a debugging nicety. It's the foundation the whole ranked
[leaderboard](/leaderboard) stands on.

The [global rankings](/rankings) work by running enormous numbers of matches in the
background, bots against bots, over and over, adjusting each app's rating based on who
wins. For that to mean anything, the matches have to be _fair_ and they have to be
_trustworthy_. Determinism gives me both. Because the matches don't depend on real-world
timing or wall-clock luck, I can run them far faster than real time on a
[small server](/blog/five-dollar-server) and trust that the result is the code's doing,
not some fluke of when the CPU happened to be busy. And if a ranked result ever looks
wrong, I can replay that precise match from its seed and see exactly what happened, rather
than shrugging and calling it noise.

There's a design rule hiding in here that I've come to love: **nothing in a match
should depend on the real world.** Not the clock (that's why bots can't read `Date` and
use `clock.getTime()` instead). Not the timing of the server. Not the phase of the moon.
Everything a match does should flow from its inputs, the bots' code and one seed, so
that the same inputs always produce the same fight. Randomness, it turns out, is fine.
It just has to be randomness you can rewind.

If you want to try it, spin up a match, set the seed, and watch the same battle play out
twice. Then change one line in your bot and run the same seed again to see, cleanly,
what your change actually did. It's one of the best debugging tools the game has. Start
over in the [Learn course](/learn) if you haven't written a bot yet.
