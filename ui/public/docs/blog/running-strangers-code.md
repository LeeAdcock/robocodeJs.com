# How do you let strangers run code on your server?

_July 13, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Here is the sentence that should give any developer a small chill: RobocodeJs takes
JavaScript written by people I have never met, and runs it on my server. Not in their
browser, where the worst they can do is crash their own tab. On my machine, the one
that also holds everyone else's bots and the database behind them.

I remember the moment that really landed. I had the arena working, tanks moving,
everything felt like a toy. And then it occurred to me that the whole point of the game
is that _other people_ write the tank code. Strangers. On purpose. I was building a
thing whose core feature was "run untrusted code from the internet." That's usually the
plot of a security incident, not a feature.

## What could go wrong

Once you accept that the code is hostile (and you have to assume it is, even when it
isn't), the failure modes line up pretty quickly.

Someone writes an infinite loop, on purpose or (far more often) by accident, and the
whole server hangs while one tank spins forever. Someone allocates memory until the
process falls over and takes every other match down with it. Someone gets curious and
tries to read the filesystem, or reach the database, or peek at another player's bot.
Someone reads the real-world clock and makes their bot behave differently from one run
to the next, so a fight can never be fairly replayed. None of
these require a genius attacker. A beginner learning JavaScript can write an accidental
`while (true)` on their first afternoon, and that's exactly the audience I'm building for.

So the defense can't be "please don't do that." It has to be a wall that holds even when
the code on the other side is actively trying to get through.

## The wall

The wall is a library called **isolated-vm**. Each app runs in its own separate V8
sandbox: the same engine that runs JavaScript in Chrome, but a fresh, sealed instance
with nothing in it. No filesystem. No network. No access to my server's memory or to
any other bot's sandbox. It's a clean room, and the bot only ever sees what I choose to
hand it.

Then I put limits on the room itself:

- **8 MB of memory.** Try to allocate more and the isolate is killed, not the server.
- **About 5 seconds per callback.** Every time the bot's code runs (its startup, an
  event handler, a timer) it's on a stopwatch. The infinite loop hits the ceiling,
  the bot is killed, and the match carries on without it.
- **No `Date`.** I switch it off on purpose, so bots can't read the wall clock. They
  use `clock.getTime()` instead, which counts game ticks, the simulation's
  tenth-of-a-second steps. (That also keeps matches
  deterministic, a bonus I wrote about in [Making randomness repeatable](/blog/repeatable-randomness).)

The most important rule is the one you can't see: the sandbox's own privileged handle,
the thing that could reach back out into my server, is **never** given to the bot. All
the bridging between the safe little API a bot sees (`bot.turn`, `bot.radar.scan`,
`bot.turret.fire`) and the real machinery lives on my side of the wall. The bot calls a
thin, boring wrapper; I decide what that wrapper is allowed to do. If a bot could get
hold of that handle, the whole thing would be over. So it never crosses the boundary.

A crashed bot, a timed-out bot, a memory hog: all of them just get their tank killed
and the game moves on. That's the design goal. Bad code should hurt the person
who wrote it and nobody else.

## The mindset

The thing I had to internalize is that "assume it's hostile" is the job, not paranoia.
Ninety-nine percent of the code people write here is a beginner earnestly trying to
make a tank shoot straight. But the wall can't be built for the ninety-nine percent. It
has to be built for the one line of code, written by anyone, ever, that tries something
it shouldn't, because I don't get to review it first. It compiles and runs the instant
someone clicks the button.

What I like about this part of the project is that it turned a scary premise into a
fairly calm daily reality. I don't lie awake about the untrusted code anymore, because
the untrusted code lives in a box that assumes the worst about it. If you want to see
the box from the inside, the [Learn course](/learn) drops your first bot into exactly
this sandbox, five seconds and eight megabytes and all. It'll feel like nothing at
all, which is the whole point. And if you're curious how I make sure the wall keeps
holding as I change things, that's over in
[How do you unit-test a game you can't see?](/blog/testing-a-game-engine).
