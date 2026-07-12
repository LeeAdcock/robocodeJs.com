# Why won't my bot shoot?

_July 8, 2025_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Of all the messages I get, this is the most common one, in a hundred different phrasings:
"my tank just sits there and never fires." It's frustrating because a tank that won't
shoot _looks_ broken in a way that gives you no clue why. Nothing crashes. Nothing turns
red. The gun just... doesn't go off.

The good news is that "my bot won't shoot" almost always comes down to one of about five
things, and you can tell which one from the tank's own console output. So before we go
through the list: open your bot's log. Every `console.log` you write shows up there,
live, next to the arena. If you're debugging blind, that's the first fix. Sprinkle a few
lines in and let the tank tell you what it's thinking.

My first job, back in high school, was answering tech-support phones at a small internet
provider in Richmond, and the first question was always the same one: is it plugged in?
Not because callers were careless, but because the obvious thing is precisely the thing
nobody checks. Twenty-some years later I write bots that won't shoot, and I promise you
I still start at the top of this list. So should you.

## The five usual suspects

**1. The turret is still reloading.** This is the big one. After every shot the turret
needs **about five seconds** (50 ticks, if you're counting) to reload, and if you call
`fire()` during that window, the shot doesn't happen; the call rejects and a "Turret not
ready" error lands in your bot's log. That error is actually a gift: if your log is a
wall of "Turret not ready", you've found your answer. If your loop is "scan, aim, fire"
as fast as it can go, you're firing into a cooldown 49 times out of 50 and it _feels_
like the gun is dead. The fix is to ask first:

```js
if (bot.turret.isReady()) {
  bot.turret.fire();
}
```

Add a `console.log('ready?', bot.turret.isReady())` for a few seconds and watch it flip
between `true` and `false`. If it's `false` far more than you expected, reloading is your
answer. Better still, stop polling and let the turret tell you when it's loaded:
`bot.turret.onReady().then(bot.turret.fire)`. I wrote about that whole style in
[React, don't poll](/blog/react-dont-poll).

**2. You never actually call `fire()`.** I know how this sounds. But it's astonishing how
often the aiming code is perfect and the firing line got commented out, or lives inside an
`if` that's never true, or you wrote `bot.turret.fire` without the `()` and just
referenced the function instead of calling it. Put a log directly above the shot:

```js
console.log('FIRING at', target.angle);
bot.turret.fire();
```

If that line never prints, the problem isn't aim or reload. Your code never reaches
the trigger. Work backwards from there.

**3. The bot crashed and got killed.** If your code throws an error, or a handler runs
longer than the sandbox allows and times out, the simulation marks the app as crashed and
that tank stops responding entirely: no moving, no shooting. A crashed tank
looks exactly like a lazy one. Check the log for an error or an [error code](/error-codes);
a thrown exception or a timeout will show up there. If the tank went inert all at once
mid-match, suspect a crash before you suspect your aim.

**4. You're aiming at nothing.** `bot.radar.scan()` returns every bot your radar can
currently see, teammates included; each result carries a `friendly` flag so you can tell
which is which. If nobody's in view at all, the scan is empty, and code like
`bot.turret.fire()`-only-when-there's-a-target will correctly never fire, because there's
nothing to shoot at. This one's easy to confirm:

```js
if (bot.radar.isReady()) {
  const seen = await bot.radar.scan();
  console.log('I can see', seen.length, 'bots');
}
```

If that's `0` most of the time, the gun is fine and your radar isn't finding anyone.
That's a sweeping problem, and the [radar lesson](/learn/radar) covers it.

**5. Friendly fire is making you too cautious.** Remember that your bullets hit **any**
bot within the 32-pixel blast radius, including your own teammates. And you field five
tanks that all run this same code. If you wrote a "don't shoot if a friend is near the
line" guard (a good instinct!), double-check it isn't firing constantly with five of your
own tanks milling around. A too-strict safety check can silence a gun as effectively as a
bug. Log the reason you're holding fire so you can see how often it triggers.

## Reading the log like a doctor

Notice the pattern in all five: I didn't guess, I asked the tank. Each culprit has a
tell, and each tell is a single `console.log` away. Is the turret ready? Is the scan
empty? Did an error print? Did "FIRING" ever appear? Four little print statements will
tell you exactly which of the five you're looking at, usually within one match.

That's really the whole skill. A bot that won't shoot is never mysterious for long once
you stop staring at the arena and start reading what the tank is telling you. Get the
gun working, then go make it hit something with [Aim where they'll be](/blog/aim-where-theyll-be).
When you're ready, the [aiming lesson](/learn/aim) walks through it from the top.
