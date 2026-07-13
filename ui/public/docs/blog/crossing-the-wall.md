# How bot.turn() crosses the wall

_March 9, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

A few weeks ago I wrote about [the wall](/blog/running-strangers-code): every bot runs
inside a sealed sandbox with no filesystem, no network, and no way to touch my server.
Which raises a fair question. If the sandbox is really sealed, how does `bot.turn(90)`
do anything? Your code is locked in a soundproof room, and yet the tank turns. Somebody
is clearly listening. This post is about the listening.

## Two sides, one thin wire

Everything a bot can do lives on the host side of the wall, in my code, where the real
tank object and the real simulation are. What the sandbox gets is a set of deliberately
boring native functions I install into it before your code ever runs, one per ability.
Think of each one as a phone that dials exactly one number.

Then, still before your code runs, I compile a thin JavaScript wrapper inside the
sandbox that dresses those phones up as the friendly API you actually use: `bot.turn`,
`bot.radar.scan`, `bot.turret.fire`, `clock`, `console`, even `setInterval`. When your
bot calls `bot.turn(90)`, the wrapper picks up the phone, and my side hears the request,
checks it, and applies it to the real tank.

The important part is what never crosses. The sandbox library's own privileged handles
(the objects that could reach back into my process) stay entirely on my side, which is
the library's own first commandment for anyone running untrusted code. The wrapper
inside the sandbox holds nothing but those single-purpose phones. A bot can read its own
wrapper all day and find nothing worth stealing, which is the point. I wrote the API
surface so that the most a hostile bot can ever do is ask, loudly, for things I was
already willing to give it.

## Promises settled from outside

Most bot commands are asynchronous. `bot.radar.scan()` doesn't have an answer at the
moment you call it; the scan resolves as the simulation advances. So the wrapper does
something a little sneaky: it creates a promise inside the sandbox, parks it in a
pending table with a ticket number, and sends the ticket across the wall with the
request.

When the simulation has the answer, my side calls back through a single captured
settle function with the ticket number and the result, and the parked promise resolves
inside the sandbox. Your `await` wakes up none the wiser. Events and timers ride the
same machinery in the other direction: a dispatch table inside the sandbox maps handler
ids to your functions, and when you get hit or a timer comes due, my side calls the
dispatcher with the right id.

One detail I'm fond of: those few crossing points (the settle function, the
dispatchers) are captured and pinned by the host when the sandbox is born. A bot can
reassign `__dispatch` to something evil if it likes; I kept my own reference to the
original, so the sabotage does nothing. You can't cut the phone line from inside the
booth.

## Nothing blocks, everything expires

The last piece is where your code actually executes. Bot code never runs on my server's
main thread. Every entry into the sandbox (loading your script, running an event
handler, firing a timer callback) happens on a worker pool, off to the side, with a
stopwatch on it. If your handler takes about five seconds, it's over: the run is
cancelled, the app is marked crashed, and the simulation kills the tank and moves on.

That's also why the game's timers aren't real timers. `setInterval` inside a bot is
driven by simulation ticks, not by the clock on the wall, so when a match pauses, your
timers pause, and when a match replays [from a seed](/blog/repeatable-randomness), they
fire at exactly the same moments they did the first time. The whole bridge is built so
that the simulation owns time, order, and truth, and the bot just gets to make requests.

So the answer to "how does `bot.turn()` work" is: a wrapper you can't escape, phones
that each dial one number, promises settled from outside the room, and a stopwatch on
everything. None of it is exotic on its own. The discipline is in what's absent: no
handle crosses the wall, ever, in either direction, that I didn't put there on purpose.

If this is the layer of the game you enjoy, the test suite that keeps the bridge honest
has [its own post](/blog/testing-a-game-engine), and the sandbox story starts in
[How do you let strangers run code on your server?](/blog/running-strangers-code). And
if you've never once thought about any of this while your tank happily turned left:
also the point.
