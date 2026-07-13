# Who can see your bot's code?

_January 12, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Somewhere around your third or fourth bot, once it starts winning, a very reasonable
paranoia sets in: can other people see my code? You've spent evenings tuning that radar
sweep. The aiming trick is yours. In a game where the strategy _is_ the game, "someone
could just read my strategy" would poison the whole thing.

So let me answer it plainly: the game is built so that nobody but you can read your
bot's source. And the reasons run deeper than a privacy checkbox, because the whole
design turns on a distinction I care about: **you share the fighter, never the
blueprint.**

## Your code is yours alone

Every route that touches a bot's source (reading it, editing it, compiling it,
rebooting it, deleting it) checks that the person asking is the bot's owner. Not "a
logged-in user." The owner. This isn't an afterthought bolted on later; it's enforced at
the same layer that enforces everything else, and it applies to every door into the
system, including [the AI tools](/blog/pair-programming-a-tank), which can only touch
the bots belonging to the token that's asking.

The [leaderboard](/leaderboard) is the same story. Your bot's name and rating are
public, because a ranking with hidden names isn't a ranking. Its source is not, and
never appears anywhere public, no matter how high it climbs. Beating the top bot means
out-thinking it in the arena, not scrolling through its code.

## Share the fighter, not the blueprint

Here's where it gets more interesting than simple privacy. You can hand someone your
bot to fight against without showing them a single line.

Every bot has a share link. Send it to a friend and they can add your bot to their own
arena, where it fields its bots and battles just like it does for you. What they get is
a _reference_ to your bot, not a copy of it: they see your bots drive, scan, and shoot,
and they can lose to you at two in the morning as many times as they like. What the
share link never grants is a look inside. And because it's a reference, it fields whatever
your bot currently is; when you improve your code, every arena it's been added to starts
facing the improved version.

I love this mechanic more than almost anything else in the game, because it makes the
social loop work without breaking the competitive one. The fun of this kind of game has
always been "my robot against yours." The fun evaporates if fielding your robot means
publishing it. A share link gives your friends the opponent and keeps you the author.

## Watching is open on purpose

The flip side: what your bots do in public is public. Anyone with a link to an arena
can watch its matches, and match results feed public rankings. I kept spectating open
deliberately, because being watchable is most of what makes an arena fun; a fight
nobody can see is a tree falling in the woods.

That's the line, and it's the same line the physical world uses. A chess player's moves
are public the moment they're played; the preparation behind them stays home. Your bot's
_behavior_ in the arena is legible to anyone who cares to study it, and a sharp opponent
can absolutely learn from watching your bots fight. What they can't do is skip the
studying and read the answer key.

Personally, I think that's where the game gets good. In the classic Robocode community,
players spent years reverse-engineering each other's bots from behavior alone, and whole
strategies were named and catalogued by people who had never seen the source that
produced them. Observation, theory, counter-strategy. That's not a leak in the game.
That is the game.

So build the clever thing. Tune the sweep, perfect the trick, and then send the share
link to the person you most want to beat. Your strategy stays yours; only its
consequences go public. If you're just starting and want an opponent worth studying,
[the sample bots](/examples) are open source on purpose, and every one of them can be
read. Yours never has to be.
