# A game that taught me to think

_December 12, 2022_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

The first computer I ever owned almost didn't make it home, because a school bus driver
refused to let it on the bus.

I was in middle school in Richmond, Virginia, when somebody donated an old desktop to the
school, and the principal decided it should go to me. I'll be grateful for that decision
the rest of my life. The machine was enormous and it was filthy, and the bus driver took
one look at this kid hauling a dusty beige tower up the steps and said absolutely not. It
took help from the school administration before she finally gave in. I got it home and did
the only reasonable thing you can do with your first computer: I took it completely apart
to find out what was inside.

I want to start this blog with that kid, because RobocodeJs is really a long chain of
consequences that starts there.

## The part of games I actually loved

Here's a confession that explains everything else about this project. I've never loved
building games as much as I love building the _players_. In high school I wrote a version
of Risk in Visual Basic, and the game itself was mostly an excuse. The fun part was the AI
opponents, tuning and re-tuning the logic that decided where they'd attack and when they'd
hold back. The habit stuck for life. Strategy games, board games, and years later a
Codewords-playing AI I entered in a hackathon that turned out to be more or less unbeatable
against human competitors. Give me a game, and the part I want to build is the thing that
_thinks_.

So imagine handing that kid **Robocode**. That's what happened in late high school, right
around the time AP Computer Science was teaching me Java. Robocode, fresh out of IBM, was
a game that had thrown away everything except the part I loved. You didn't drive the tank.
You couldn't. You wrote its brain in Java, set it loose, and won or lost entirely on how
well you'd thought it through beforehand. It was _all_ AI players, all the way down.

I don't remember the name of the first bot that started winning for me, but I remember
exactly what made it win: teamwork. I had my tanks talk to each other, sharing the
locations of enemies as their radars found them, so the whole team could gang up on one
target at a time. Watching a pack of my little robots quietly corner something felt like
getting away with a heist. Twenty years later that instinct is still my favorite part of
the game.

I played it through the end of high school and into college, and it quietly taught me what
school was trying to teach me the hard way: how to reason about a system, hold it in your
head, and anticipate what it'll do when you're not there to help it. That turned out to be
most of what a career in software is. I talked my way from a high school tech-support job
at a small local internet provider into building web applications, and I've spent every
job since chasing the feeling Robocode gave me first: my code, alive, out there making
decisions without me.

## The wall in front of everyone else

Here's the part that bothered me for years. Whenever I wanted to show the original
Robocode to someone, whether a friend, a kid, or anyone I thought would love it the way I
did, I hit the same wall before we even started. Install a Java runtime. Then a
development kit. Then the game. Then figure out why one of those three things wasn't
talking to the other two. By the time we had a tank on screen, the spark I was trying to
share had usually gone out.

The barrier wasn't the _idea_ of the game. Kids grasp "write instructions for a tank"
in about ten seconds. The barrier was everything you had to survive to get to your first
line of code. And that felt backwards to me. The whole magic of Robocode is how quickly a
beginner can feel powerful, and we'd buried that magic under a software installation.

## Why I'm building RobocodeJs

So the goal I set myself was almost embarrassingly simple: get someone from nothing to
_their code, alive in the arena_ as fast as possible. No download. No toolchain. No
account with a credit card. You open a web page, you write a few lines of JavaScript, and
you watch your tank do the thing you told it to.

Everything else I build here, from the arena to the sandbox that runs your code safely to
the [Learn course](/learn) and the docs, is really in service of that one moment. I want
the first "it moved!" to be minutes away, not an afternoon of setup away.

This is a tribute, not a replacement. The original Robocode is still going, still
wonderful, and if you enjoy this you should go play it too. But I think there's room for a
version that a curious ten-year-old can start playing on a school Chromebook during lunch.
No installation, no permission slip, and definitely no negotiating with the bus driver.

That's why this exists. In the posts that follow I'll get into the fun stuff: strategy,
the guts of the simulation, the occasional bug that cost me a weekend. But I wanted the
first one to be about the why. Thanks for reading. Now go [make something that moves](/learn/hello).
