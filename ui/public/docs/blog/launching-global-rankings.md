# Every bot now has a number

_July 12, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Right now, somewhere on the server, two bots are fighting a match neither of their
owners knows is happening. When it ends, one will gain a few rating points, the other
will shed a few, and the system will pick another pair and do it again. That's the
[leaderboard](/leaderboard), and it's live as of today: every eligible bot on RobocodeJs
now carries a persistent Elo rating, and the public top-20 sits in the nav under
"Rankings" for anyone to look at, logged in or not.

I've wanted this for a long time. You could always watch your bot fight in your own
arena, but that was a closed loop: your bots, against opponents you chose, on a stage you
controlled. There was no way to ask the only question that really matters, which is _how
good is this thing, actually_.

I know that itch personally. I've been building game-playing AIs
[since high school](/blog/a-game-that-taught-me), and the moments I remember aren't the
ones where my AI beat me. They're the ones where it went up against strangers, like the
Codewords bot I once took to a hackathon and watched hold its own against every human who
sat down across from it. An AI with nobody to fight is half an AI. Now every bot on this
site gets what mine got that day: a real opponent, and a real answer.

## You don't enter the matches

The part that surprises people: you don't play ranked matches. You don't queue,
you don't click a "find match" button, you don't schedule anything. The background
system runs matches on its own, all the time. It picks two eligible apps, hands
them a random seed, runs the fight to a decision, and writes the new ratings back to
both apps.

Your bot is a candidate as long as it's real: it has to compile, it can't be empty, and
you (its owner) have to have been active reasonably recently. Untouched starter bots are
left out of the pool; the ladder is for bots someone actually built. Beyond that, you
don't manage anything. You write a bot, and the ladder finds it work.

I like this because it takes the grind out. You're not farming matches to climb. You're
just making a good bot, and the rating accumulates on its own over a few dozen games.

## Your rating rides your current code

This is the twist I'm most proud of, and it's worth saying slowly.

Your rating is attached to your app, and it rides your app's **current** source. When you
open your bot and improve it, your rating does **not** reset. It keeps everything it's
earned. The only thing editing does is clear the "broken" flag if your bot had stopped
compiling. So the loop looks like this:

1. Your bot plays some background matches and settles around a rating.
2. You notice it's losing a certain way and you fix that weakness.
3. From that point on, the _better_ version is the one playing.
4. Over the next batch of games, the rating drifts up to match the new code.

Think of the rating less as a trophy you win once and defend, and more as a slow-moving
measurement of whatever code is live right now. Improve the code, and the number follows,
not instantly, but honestly, over enough games that it isn't luck. It usually takes something
like 20 to 40 matches for a real change to fully show up.

## A short FAQ

**Do I have to opt in?** No. If your bot is eligible, it's in the pool. Nothing to turn
on.

**Can people see my code from the leaderboard?** No. The rankings show names and numbers,
never source. Your bot's strategy stays yours.

**Why did my rating move when I wasn't even online?** Because the matches run in the
background. That's the whole idea: your bot competes while you're asleep.

**I edited my bot and my rating didn't change. Bug?** Not a bug. Editing never resets the
number; it just changes which code plays next. Give it some games and watch it drift.

**Where do I learn the details?** I wrote a longer explainer at [/rankings](/rankings)
covering eligibility and how the math works.

If you've never built a bot that could hold its own against a stranger's, this is the
nudge. Go make something, leave it alone for a day, and come back to see what number it
earned. Then make it better and watch the number chase your code. Start at
[the leaderboard](/leaderboard), find a name above yours, and get to work.
