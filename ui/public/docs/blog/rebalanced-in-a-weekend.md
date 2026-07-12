# I rebalanced the whole game in a weekend

_May 12, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Fights felt slow. Not broken, just slow. Two decent bots would circle each other, plink away,
and take what felt like forever to resolve. I'd watch a match and find my attention
drifting, which is the single worst thing that can happen when you're the person who made
the game. If _I'm_ bored, everyone's bored.

So I spent a weekend with the numbers. Four changes, all aimed at the same feeling: make
fights faster, more decisive, and easier to read. Here's each one, before and after, and
why.

[PERSONAL: the specific match or matchup in playtesting that made it obvious something
was off — what you were watching that dragged.]

## Change 1: faster reload

**Before:** turret reload took 50 ticks, refilling +2/tick.
**After:** 40 ticks, refilling +2.5/tick.

The reload is the metronome of a fight. Everything a bot does between shots (turn, dodge,
line up the next angle) is paced by how long it waits to fire again. At 50 ticks that
wait was long enough that fights turned into patient standoffs. Dropping it to 40 tightens
the whole rhythm. Bots shoot more, commit more, and the match moves. It's a small number
with an outsized effect on how alive the arena feels.

## Change 2: missing costs you now

**Before:** a missed shot cost nothing. Fire into empty space all day.
**After:** a missed shot costs you 3 health.

This one is about intent. When missing is free, the optimal strategy drifts toward spray:
just keep firing in the general direction and let probability sort it out. That's not fun
to watch and it's not interesting to write. Putting a small cost on a miss (3 health,
enough to notice, not enough to cripple) rewards bots that _aim_. Now a shot is a
decision. Take it when you have the angle; hold when you don't. Suddenly the radar and
turret code people write actually matters, because being wasteful with your gun bleeds you
out.

## Change 3: snappier aiming

**Before:** the turret and radar each turned 2°/tick.
**After:** 4°/tick, twice as fast.

At 2°/tick, a bot that got flanked couldn't bring its gun around in time. The
turret felt like it was swinging through molasses, and the honest consequence was that
positioning beat aiming every time: if you got behind someone, they were dead, no skill
required. Doubling the turret and radar turn rate gives a bot a real chance to react.
You can whip the gun around to a target you just scanned, and a well-written tracking
loop feels responsive instead of sluggish. It rewards good code over pure geometry.

## Change 4: you can see the hits now

**Before:** damage happened silently. Health numbers changed, but the arena didn't react.
**After:** a bot flashes a red damage-glow pulse the instant it's hit.

This one is feedback rather than a balance change. Watching a fight, you couldn't
always tell _who just landed a shot_. The bullets are fast and small and the moment of
contact was easy to miss. Now, when a bot takes a hit, it pulses red. That's it. But it
completely changes how legible a match is. You can follow the exchange, feel the momentum
swing, and understand at a glance who's winning the trade. A game you can read is a game
you'll watch.

## The through-line

None of these were about making the game "harder" or "easier." Every one was aimed at a
feeling: fights should be _fast_, missing should _cost_ something, aiming should feel
_responsive_, and a hit should be _visible_. That was the whole weekend.

If you built a bot before this pass, it's worth a fresh look. The miss penalty in
particular changes how aggressively you want to fire, and the quicker turret opens up
tracking tactics that used to be too slow to bother with. Pull up a match, watch for the
red glow, and see if your old bot still fights the way you remember. If you want to sharpen
it, [the examples](/examples) are a good place to steal ideas from.
