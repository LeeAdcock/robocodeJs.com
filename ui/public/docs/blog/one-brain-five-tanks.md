# One brain, five tanks

_January 12, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Your app doesn't control _one_ tank. It controls **five**. You write one program, and the
game runs a copy of it on each of your five tanks: same code, five bodies, all fighting
at once. This trips up almost everyone at first, and once it clicks, a lot of surprising
behavior stops being surprising. Why does my tank keep bumping into an identical tank?
Because it's you. Why do all five of them charge the same corner? Because they all ran the
same instruction at the same moment. You didn't write a bot; you wrote a _species_.

## "Which one am I?"

The first consequence is that inside your code, `this bot` could be any of the five. When
you call `bot.getX()`, you get _that particular tank's_ position, the one currently
running the code. So a line like "drive toward the center" makes all five converge, while
"drive away from my nearest teammate" makes them spread out, because each tank evaluates
"my nearest teammate" from its own spot.

That's the mental shift: stop writing instructions for a single tank and start writing
instructions that produce good behavior no matter which of the five is asking. The best
squads don't hard-code "tank 1 does this, tank 2 does that." They write one rule that,
run five times from five positions, naturally produces a formation. The
[magnetic](/samples/magnetic) sample is the cleanest example of this: every tank pushes
away from its neighbors and the spacing just falls out of it, no coordinator required.

I've built AI players for real-time strategy games, where you're herding dozens of units
instead of five, and the lesson was the same there: you almost never want a general
issuing orders. You want simple rules that produce good group behavior when everyone
follows them. Five tanks is the friendly version of that problem, and it's the part of
this game I find hardest to put down.

## Talking to yourself

Because all five run in the same sandbox, they can share information. If one tank's radar
spots an enemy, it can stash that enemy's position somewhere the others can read, and
suddenly all five know about a threat only one of them can see. That's the whole idea
behind a coordinated squad: five sets of eyes feeding one shared picture of the arena.

The pattern is simpler than it sounds: a shared spot the tanks all read from and write
to. One tank spots something, records it, and the others check that record on their next
tick and react. You don't need networking or messages in the postal sense; you just need
a place all five can see. The [squad](/samples/squad) sample builds exactly this, and the
[teamwork lesson](/learn/teamwork) walks through it step by step. It's worth reading both
side by side: `magnetic` shows coordination with _no_ communication (just local rules),
and `squad` shows coordination _through_ communication (a shared target). Most good teams
end up somewhere between the two.

## The friendly-fire tax

Now the part that punishes you for having friends nearby: **friendly fire is on.** Your
bullet hits any bot within its 32-unit blast radius, and it does not check jerseys. Five
of your own tanks clustered together is five chances to shoot yourself in the back.

This changes how you think about both formation and firing. Clumping your tanks feels
safe (strength in numbers), but a tight clump is a friendly-fire accident waiting to
happen, and it also means one enemy shot into the pile can splash several of you at once.
Spacing is self-preservation, not just board control. And before any tank pulls
the trigger, it's worth a glance down the barrel: is a teammate sitting between me and my
target? If so, the "shot" is just me damaging my own side.

The teams that win consistently treat their five tanks as a group that _spreads out,
shares what it sees, and checks its line before firing_. That's three habits, and none of
them are complicated. They just require remembering, always, that you're not one tank.
You're five, and they're all you.

Go build a squad that doesn't fight itself: start with [magnetic](/samples/magnetic) for
spacing, [squad](/samples/squad) for coordination, and the
[teamwork lesson](/learn/teamwork) to tie it together. If your tanks keep shooting each
other, [Why won't my bot shoot?](/blog/why-wont-my-bot-shoot) has the friendly-fire
diagnosis too.
