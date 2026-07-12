# A tour of the bots that ship with the game

_March 12, 2024_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

A blinking cursor is intimidating. A working example you can poke at is an invitation.
That's why, when you first open RobocodeJs, you don't start with a blank page. You start
with a small shelf of finished bots you can read, run, and take apart. Every one of them
was written to teach exactly one idea, and I want to walk you through the shelf the way
I'd hand them to you in person, grouped by what each one is trying to show you.

Think of this as a guided tour. Click any name to open it in the read-only viewer, and
when one clicks, hit **Clone this bot** to drop a copy into your arena and start bending
it to your will.

## Getting started

**[Lighthouse](/samples/lighthouse)** is where I'd point an absolute beginner. It never
moves. It just sits there and sweeps its turret, and when the scan catches something, it
fires. That's the entire loop of the game in its smallest possible form (sense, aim,
shoot) with nothing else in the way. Read this one first and the rest make more sense.

**[Spirograph](/samples/spirograph)** adds motion without adding complexity. It drives
straight ahead with the gun locked forward, tracing those big looping patterns the name
promises, and shoots whatever happens to wander into its path. It's a lovely little proof
that you don't need clever aiming to be dangerous. Sometimes you just need to be moving
and pointed somewhere.

**[ReturnFire](/samples/returnfire)** is the one that made a lot of people go "oh." It has
no tick loop at all. It sits still and does nothing until something hits it, and then it
spins to face the attacker and fires back. It's pure event-driven code, and it's the
cleanest example I have of reacting to the world instead of constantly polling it.

**[Chronometer](/samples/chronometer)** is about time. It shows off one-shot and repeating
timers, `setTimeout` and `setInterval`, running on the game's own clock rather than the
wall clock. Once you understand that your bot can schedule its future, a lot of rhythmic
strategies open up.

**[Pathfinder](/samples/pathfinder)** is the first step into real navigation. It moves
between a set of waypoints, using a little trigonometry to steer toward each point in turn.
If you've ever wanted your tank to go _somewhere specific_ instead of just wandering, this
is the pattern to steal.

## Combat

**[Marksman](/samples/marksman)** is the sharpest shooter in the set, and it earns the
title. It predicts where a moving enemy _will be_ and leads the shot to meet it there,
focus-fires whichever target is weakest, and holds its fire until it has the shot
instead of spraying. It's advanced, and it's worth reading slowly; every line is a small
lesson in patience.

**[Survivor](/samples/survivor)** is the bot that wants to be alive at the end. It watches
its own health and flips between fighting and fleeing depending on how the match is going,
dodges incoming fire, and reacts when it notices it's been spotted. It's my favorite one
to point people toward once they've built something aggressive and watched it die gloriously
in ten seconds.

[PERSONAL: which sample is your personal favorite and why — one or two sentences.]

## Teamwork

Every app in RobocodeJs fields five tanks that share one program, and these two are about
making those five act like a team instead of five strangers.

**[Magnetic](/samples/magnetic)** has teammates broadcast their positions to each other
using a tagged message protocol, then cluster together. There's real strength in a pack,
and this shows the simplest version of it.

**[Squad](/samples/squad)** takes coordination one step further: whenever any teammate spots
an enemy, it tells the others, and the whole squad focus-fires that single target at once.
Five guns on one enemy ends fights fast, and watching it happen for the first time is very
satisfying.

That's the shelf. The full index, with difficulty labels and short blurbs, lives at
[the examples page](/examples), and every one is meant to be cloned and wrecked. Don't
read them like documentation; read one, break it, and see what your change does in the
arena. That's the whole point. If you haven't written a line yet, start at
[the lessons](/learn) and come back here when you want to see the ideas combined.
