# One brain, five tanks

_November 10, 2026_

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
[magnetic](/samples/magnetic) sample is the cleanest example of coordination through
simple broadcast messages: every tank shouts its own position ten times a second, everyone steers
toward the voices, and the team drifts together into a cluster, no coordinator required.

I've built AI players for real-time strategy games, where you're herding dozens of units
instead of five, and the lesson was the same there: you almost never want a general
issuing orders. You want simple rules that produce good group behavior when everyone
follows them. Five tanks is the friendly version of that problem, and it's the part of
this game I find hardest to put down.

## Talking to yourself

Here's the part that surprises people: even though all five tanks run the same code, each
one is on its own. One tank can't peek at another's variables or read what its radar saw.
The only way they share anything is by talking: `bot.send` broadcasts a message, and any
bot listening for `Event.RECEIVED` hears it. So if one tank's radar spots an enemy, it
broadcasts that enemy's position, the other four receive it, and suddenly all five
converge fire on a threat only one of them can see. That's the whole idea behind a
coordinated squad: five sets of eyes feeding one shared picture of the arena, one message
at a time.

One caveat before you build this: the broadcast is truly public. Every bot in the arena
hears it, enemies included, so teams tag their messages with a shared secret and ignore
anything that doesn't carry it. Never trust a broadcast you didn't send. The
[squad](/samples/squad) sample builds exactly this pattern, and the
[teamwork lesson](/learn/teamwork) walks through it step by step. It's worth reading
`magnetic` and `squad` side by side: both speak the same broadcast protocol, but
`magnetic` uses it to pull the team together while `squad` uses it to focus fire on a
shared target. Most good teams end up doing both.

## The friendly-fire tax

Now the part that punishes you for having friends nearby: **friendly fire is on.** Your
bullet hits any bot within its 32-pixel blast radius, and it does not check jerseys. Five
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
