# React, don't poll

_July 14, 2024_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Most of my bots don't have a tick loop at all. That surprises people, because everyone's
first bot is one big loop that runs every tick and checks everything: am I being hit? is
anyone on radar? is the gun ready? did I bump a wall? It works, and it's a perfectly
reasonable place to start. But there's a second way to write a tank that's both simpler
to read and closer to how the game wants to talk to you.

The game already knows when things happen to you. It fires an **event** the moment you get
HIT, the moment you COLLIDE with something, the moment your radar finishes a scan. You
don't have to stand there every tick asking "did anything happen?" You can just leave
instructions for _when_ it does.

## Polling versus reacting

Polling is you, checking. Reacting is the game, telling you. Compare the shapes.

The polling version asks the same question ten times a second whether or not the answer
ever changes:

```js
// runs every single tick
clock.on(Event.TICK, async () => {
  const targets = await bot.radar.scan();
  if (targets.length) {
    bot.turret.setOrientation(targets[0].angle);
    if (bot.turret.isReady()) bot.turret.fire();
  }
});
```

The reacting version says nothing until something actually happens, then responds:

```js
// only runs the moment someone shoots you
bot.on(Event.HIT, (info) => {
  bot.turret.setOrientation(info.angle); // the angle is where it came from
  bot.turret.onReady().then(bot.turret.fire);
});
```

That second bot is a complete, dangerous return-fire tank, and notice what's missing:
there's no loop. It just sits quietly until it gets shot, then whips the turret around to
the bearing the hit came from (a HIT event's `angle` is relative to your heading, so it
points you straight back at your attacker) and fires the instant the gun is loaded. Nothing to poll, nothing to check. The [returnfire](/samples/returnfire) sample
is built exactly this way, and it punches well above its size for how little code it is.

Radar plays the same game: even when you do ask for a scan, the answer comes back as an
event. Handle `bot.on(Event.SCANNED, (targets) => ...)` once, and it runs when the
results are in, instead of you re-reading the radar every tick.

## Let the game keep time for you

The same idea handles waiting. Instead of polling `isReady()` every tick until the turret
reloads, `onReady()` hands you a promise that settles the instant it's loaded:

```js
bot.turret.onReady().then(bot.turret.fire);
```

And when you do want something to happen on a schedule (sweep the radar, change
direction every so often), you don't need a tick counter of your own. `setInterval` and
`setTimeout` work inside your bot, except they're driven by _game ticks_, not real-world
time, so they pause when the match pauses and stay in step with the simulation:

```js
setInterval(() => bot.turn(90), 30); // wheel a quarter-turn every 30 ticks
```

The mental model I'd leave you with is this: a tick loop makes your bot ask "what should I
do right now?" ten times a second. An event-driven bot answers a different, calmer
question: "what do I do _when_ this specific thing happens?" Then it trusts the game
to bring the things to it. The code ends up shorter, the intent is right there on the
surface, and you stop burning your whole tick budget re-checking conditions that rarely
changed.

You don't have to pick one religion. Plenty of my tanks react to HIT and COLLIDED events
but still keep a small loop for movement. But if your bot is one giant `if`-ladder running
every tick, try turning the "did X happen?" checks into "when X happens, do Y" handlers
and see how much falls away. The [events lesson](/learn/events) covers the full list of
what the game will tell you about, and [returnfire](/samples/returnfire) is the loop-less
tank to read first.
