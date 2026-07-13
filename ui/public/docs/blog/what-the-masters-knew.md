# What the masters knew

_February 9, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Before this game existed, the [original Robocode](/classic) ran for two decades, and its
community did something remarkable with the time. On a site called the
[RoboWiki](https://robowiki.net), players catalogued strategy the way naturalists
catalogue beetles: naming techniques, proving them against each other in the RoboRumble,
a never-ending community ladder, and refining them across hundreds of bots and years of
argument. Reading it today feels like finding the collected papers of a small, obsessive
science.

I grew up on the edges of that culture, and [it's half the reason this game
exists](/blog/a-game-that-taught-me). I've told
[the fuller history of the community before](/blog/a-brief-history-of-robot-tanks);
this post is a tribute with homework attached:
two of the RoboWiki's most famous ideas, and what their spirit looks like translated
into this arena's simpler physics.

## Wave surfing, or: dodge the bullet you can't see

The classic community's deepest insight about survival was that you don't dodge
bullets. You dodge _possibilities_.

When an enemy fires, the shot travels at a fixed speed. So from the moment it leaves
the barrel, the set of places it could be forms an expanding ring, a "wave," rolling out
from where the shooter stood. The masters' technique, wave surfing, was to track those
waves and keep steering toward the point on each ring where a shot was least likely to
be. The bots that did this well looked telepathic. They weren't reacting to bullets;
they were standing where bullets weren't.

You can't see bullets on your radar here, and this game won't announce when an enemy
fires. But you know something almost as good: the rhythm. A gun that just fired can't
fire again for about four seconds. If a shot whizzes past (or hits you), you've just
learned the earliest moment the next one can exist, and that's the moment worth dodging
before. The cheap translation of wave surfing is this: don't wander randomly all match,
_time_ your sharpest change of direction to your enemy's reload. Moving is good.
[Moving on beat is better.](/blog/stationary-bots-die)

## Guess-factor targeting, or: aim with statistics

The second big idea attacked the opposite problem: how do you hit a dodging bot?
[Leading a target](/blog/aim-where-theyll-be) assumes the enemy keeps doing what it's
doing. Against a good dodger, that assumption is exactly what gets exploited.

The masters' answer, guess-factor targeting, was to stop assuming and start counting.
Every shot you fire is an experiment: you aimed with some lead angle, and it either hit
or it didn't. Record the result. Over a match, a picture forms: _this_ opponent, when
shot at, tends to dart forward; _that_ one always cuts back. Aim where the data says
this particular enemy tends to be, not where geometry says an obedient one would be.
The best classic gunners kept whole statistical profiles per opponent and hit dodging
bots that "couldn't" be hit.

Your bot can carry the pocket version. It has memory; nothing stops you keeping a
little tally: when I led by a full tank-length, did I hit? When I aimed straight at
them? Even two or three buckets, updated as the match runs, will start telling you which
kind of mover you're fighting, and a bot that adapts its lead mid-match is a genuinely
scary thing to face. The [leading lesson](/learn/leading) gives you the geometric
baseline; the statistics are the graduate course you can build on top of it.

## The real lesson is the culture

Here's what strikes me most about the RoboWiki, though, more than any single technique:
none of it was in the manual. Wave surfing and guess-factor targeting weren't shipped
features. They were _discovered_, argued over, named, and taught, by players studying
each other's bots from behavior alone and writing down what they learned. The game gave
them a closed little universe with fixed rules, and they did science to it.

That's the tradition this game hopes to inherit, more than any particular trick. The
rules here are all [public and small](/rules). The interesting part is everything they
imply, and most of it is still unwritten. Go read the masters: the
[RoboWiki](https://robowiki.net) for the deep theory, or one of the lovely
[veteran-written strategy guides](https://shanehalbach.com/robocode/) that still
circulate from the classic era. Steal their oldest ideas, and then find something they
never did. Somebody has to write the first page of this arena's wiki.
