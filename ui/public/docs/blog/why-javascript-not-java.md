# Why JavaScript, not Java?

_September 12, 2023_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Java paid my mortgage.

It was my first real language. I learned it in AP Computer Science in high school, and it carried the front half of my career, first at Honeywell and then at Capital One. So when people find out I rebuilt a Java game in JavaScript and ask if I have some grudge against Java, the answer is no. I'm not a Java skeptic. The decision was never about the language at all. It was about everything that happens _before_ the language, the part where you're trying to get to your first line of code and something stops you.

## The barrier was never the code

The idea of Robocode is instantly graspable. You write instructions for a tank, then set it loose to fight without touching it again. A kid gets that in about ten seconds. The concept is not the obstacle.

The obstacle was the setup. Before you could play the original, you had to get Java installed, get the development tools installed, get the game installed, and then figure out why some piece of that stack was broken on your particular machine. None of it is hard, exactly. But it's a gauntlet, and it stands between a curious person and the fun part. Ask anyone who's spent a Saturday getting a development environment working: the enthusiasm has a shelf life.

And the cruel part is _who_ this barrier stops. It doesn't stop the person who's already a developer with a configured machine. It stops exactly the person the game would be best for: the beginner, the kid, the friend who's curious but has never installed a compiler and has no reason to learn how just to try a game about tanks.

## What the browser gives you

So the real question I was asking wasn't "which language is better." It was "how do I delete the gauntlet." And the answer turns out to be: run it where everyone already is. Everybody has a browser. The browser already runs JavaScript, sandboxed, with nothing to install. The platform picked the language. JavaScript-in-the-browser isn't a verdict on Java. It's just the shape of "no setup."

That one decision erases the entire front half of the experience. No runtime, no dev kit, no toolchain, no account with a credit card. The distance from curious to playing went from an afternoon to a couple of minutes, and that distance is the whole game as far as I'm concerned.

## The language grew up anyway

There's a version of this decision that would have stung, and it's worth naming: the JavaScript of twenty years ago. I've watched this language evolve across my whole career, from the thing you used for silly little web scripts, mostly image rollovers and popup warnings, into a full-stack language running cloud-deployed, mission-critical systems. My own work followed the same arc. I started out writing Java, and as the web took center stage I found myself living more and more in JavaScript and TypeScript. Not because anyone made me, but because that's where the interesting work went.

So the honest answer to "why JavaScript?" has a second half. The browser picked the language, and the language turned out to be worthy of it. The same JavaScript that makes your first bot move in a lunch break is, structurally, the JavaScript I'd happily run in production. A beginner's language and a professional's language turned out to be the same language, and that almost never happens.

## An accessibility argument, not a verdict

I want to keep saying this because it matters to me: I'm not knocking Java, and I'm not knocking the original. If you love this, go play the original too. It's still going, still wonderful, and it can do things a browser sandbox can't. This is a tribute, not a replacement.

What I'm defending is a specific kind of person's first five minutes. I want a curious ten-year-old on a school Chromebook to be able to start during lunch, with no permission slip for a software install and no dad who knows how to fix a PATH variable. JavaScript in the browser is what makes that possible. The language was the means; access was the point.

If you want the fuller story of why this project exists at all, I wrote about that [here](/blog/a-game-that-taught-me). And if you'd rather just feel what I'm talking about, the fastest way is to go [make something move](/learn/hello). No download, right now, in the tab you already have open.
