# Hug no walls, pick your fights

_March 14, 2023_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

New bots don't die of bad marksmanship. They die of positioning and stubbornness. Once
your bot can find an enemy and hit it, the next jump in skill is two boring habits, not a
cleverer aiming trick. They keep your tank _alive long enough_ for the aiming to matter,
and they win more matches than any fancy shot: stay off the walls, and know when to run.

## Habit one: stop hugging the walls

Watch a beginner bot for a minute and you'll usually see it drift into a corner and get
stuck there. It feels safe; nothing can sneak up from behind a wall. It's the opposite of
safe. Against the edge you've thrown away half your escape angles: you can't dodge into the
wall, so every incoming shot only has to account for the directions you have left. You're
easier to predict, easier to corner, and easier to pin. A tank in open space can juke in any
direction; a tank on a wall is a sitting duck with good posture.

The arena is 750×750, and your tank always knows where it is. So give yourself a margin and
steer back toward the middle whenever you get too close to an edge:

```js
const MARGIN = 120;
const x = bot.getX();
const y = bot.getY();

// too close to any edge? turn back toward open space
if (x < MARGIN || x > 750 - MARGIN || y < MARGIN || y > 750 - MARGIN) {
  // steer toward the arena center (375, 375) instead of the wall
  bot.turnTowards(375, 375); // aim the body back into open ground
}
```

You don't have to be fancy about it. Even a crude "if I'm near an edge, head back toward the
middle" rule will noticeably extend how long your tank survives. And surviving is how you
win. The best players treat the walls as lava and live in the open center where they always
have somewhere to run.

## Habit two: retreat when you're low

The second habit is knowing that not every fight is worth finishing. Health is 100, and a
single bullet takes 25 of it, so four clean hits and you're gone. A lot of bots don't track
this at all. They trade shots to the bitter end and die in even matchups they could have
walked away from. A tank that flees at 25 health and comes back later beats a tank that
stands its ground at 25 health and doesn't come back at all.

Your bot can check its own health any time, so let it change its mind when things get thin:

```js
if (bot.getHealth() < 30) {
  // low: break off and put distance between you and the fight
  bot.turnTowards(375, 375); // head for open center, away from the brawl
  bot.setSpeed(5); // and actually leave
} else {
  // healthy: keep pressing the attack
  engage();
}
```

The idea is to flip between two modes (fight when you're healthy, flee when you're not)
instead of running one plan into the ground. Time spent alive is time your enemies spend
shooting at each other instead of at you, and matches are often won by whoever's still
standing when the dust settles, not whoever hit hardest early.

If you want to see both habits done well, read [Survivor](/samples/survivor). It's built
around exactly this: it watches its own health, switches between fighting and fleeing, and
dodges instead of standing there trading. It's the cleanest example of "boring habits win"
in the whole sample set. Clone it and watch how much longer it lasts than an all-out
attacker.

## The pattern underneath

Both of these are the same lesson wearing two hats: don't let your bot get into positions it
can't get out of. A wall is a position you can't get out of in _space_. A death-trade at low
health is a position you can't get out of in _time_. The strongest bots are the ones that
keep their options open (room to move, health to spend) so they're still around when
the opening comes.

The exact numbers (health, damage, top speed, the arena size) all live on the
[rules page](/rules) if you want to tune your margins precisely. And if your tank keeps
getting picked off before positioning even matters, get it moving first: a tank that
stands still is the easiest kill in the game. Then come back and teach it where _not_
to move.
