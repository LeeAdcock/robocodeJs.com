# The body, the turret, and the radar

_July 11, 2023_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Your bot is not one machine. It's three machines bolted together, and each one turns on its own. If there's one mental model that unlocks RobocodeJs, that's it. Once it clicks, most of the game stops feeling mysterious. So let me walk through the three parts, what each one does, and how they fit into the little loop that runs your whole bot.

## Three machines, three steering wheels

The first part is the **body**. It drives and it turns, at up to about 100 degrees a second (a full spin in under four seconds), and it carries everything else around the arena, 750 pixels on a side. When you tell the bot to move, this is what moves.

Bolted on top is the **turret**, the gun. It turns _relative to the body_, at about 20 degrees a second, and it's what actually fires. Its angle is independent: the body can be pointed north while the gun points east. It also has to reload, about five seconds per shot, so you can't just hold down the trigger; a good bot spends its shots.

Mounted on the turret is the **radar**. It turns relative to the turret, also about 20 degrees a second, and it recharges about once a second. The radar is how your bot _senses_: it's the only way you find out where the enemies are. No scan, no information; a blind bot is a dead bot.

The thing to really sit with is that all three turn independently. Your body can be driving one direction, your gun aiming a second, and your radar sweeping a third, all at the same moment. That independence is the source of nearly every advanced tactic in the game. You can flee to the left while shooting to the right and watching behind you, because the three machines don't have to agree.

## The loop that ties them together

Almost every bot, underneath, is running the same four-beat rhythm:

```js
// sense with the radar → aim the turret → fire → move the body
clock.on(Event.TICK, async () => {
  const targets = await bot.radar.scan(); // sweep: how you learn where enemies are
  bot.turret.turn(...);  // point the gun where the scan said to
  bot.turret.fire();     // spend a shot (if you're reloaded and lined up)
  bot.turn(...);         // steer the body: chase, circle, or flee
});
```

That's the skeleton. Everything fancy is a variation on it. A stationary sniper skips the last line. A dodger spends most of its energy on the last line and barely aims. A team bot inserts a "tell my squad what I saw" step after the scan. But the bones are always sense → aim → fire → move, and they map straight onto radar, turret, gun, body.

The reason to think in these four beats rather than one big blob of code is that each part has its own limits (the reload, the recharge, the turn rates) and good play comes from respecting them separately. Your gun being reloaded doesn't help if your radar hasn't found anyone. Your radar finding someone doesn't help if your gun is pointed the wrong way and needs a couple of seconds to swing around. The whole craft of a bot is keeping these three machines pointed at the right things at the right time.

## Where to go next

The best way to feel this is to watch it fail. Point your radar and gun the same direction and you'll see how a bot that "looks where it shoots" gets tunnel vision and drives into things. Split them and it comes alive.

If you want the exact turn rates, reload times, damage numbers, and everything else in one place, they all live on the [rules page](/rules). And if you haven't built a bot yet, the [lessons](/learn) walk you through this loop one beat at a time, starting from a bot that does nothing and ending with one that can find and hit a target. Start there, then come back and reread this. It lands differently once you've watched your own three machines argue with each other in the arena.
