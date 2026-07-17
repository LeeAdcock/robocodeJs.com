# Lesson 15: Teamwork and graduation

**By the end of this lesson you'll be able to:**

- Have your robots **talk to each other**
- Debug like a pro — and you'll have used **every** RobocodeJs feature!

**New idea:** _Sending messages between programs._

## The idea

Your team is **five bots running the same code**. They can coordinate by sending
**messages** to each other:

- `bot.send(7)` — broadcast a message. It can be a **number** (or a string, or a
  small object of them, like `{ x: 100, y: 200 }`).
- The **RECEIVED** event fires on the other bots, handing them that message (plus
  `from`, telling you how far away the sender was).

One catch: `bot.send` is heard by **every** bot in the arena — **enemies included**,
not just your team. So a real team tags its messages with something only teammates
know and checks it before trusting one (the [Magnetic](/examples) example shows how).
For this lesson we'll keep it simple. A number is enough to share something useful —
like the compass direction of an enemy.

## Try it

When any bot spots an enemy, it tells the team which way to point:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) bot.radar.scan();
});

bot.on(Event.SCANNED, (targets) => {
  const enemies = targets.filter((t) => !t.isFriendly());
  if (enemies.length > 0) {
    // A scan's angle is relative to *us*, so share the absolute compass
    // direction (our heading + the bearing) that any teammate can use.
    bot.send(Math.round(enemies[0].angle + bot.getOrientation()));
    bot.turret.setOrientation(enemies[0].angle); // our own aim (body-relative)
    if (bot.turret.isReady()) bot.turret.fire();
  }
});

// A teammate shared an absolute direction to an enemy — point our turret there
// too, converting the compass heading into an offset from our body.
bot.on(Event.RECEIVED, (heading) => {
  bot.turret.setOrientation(heading - bot.getOrientation());
});
```

Press **Save**. Now the whole team swings their turrets toward an enemy the moment _any_
one of them sees it. (`Math.round` just sends a tidy whole number.)

**Sharing a position instead of a direction.** A direction is only right from where
_you_ stand — a teammate across the arena pointing the same way looks at a different
spot. Every scan result is a **contact** (a marker pinned at the enemy's location), so
you can broadcast its actual coordinates instead:
`bot.send({ x: enemies[0].getX(), y: enemies[0].getY() })`, and each teammate aims with
`bot.turret.turnTowards(message.x, message.y)` — the same point for everyone. The
**Squad** example bot builds this out, team secret and all.

**Sharing the whole contact.** You can even broadcast the contact itself:
`bot.send(enemies[0])`. A contact is **serializable** — what actually transmits is its
plain data (position, speed, heading, and so on; the methods aren't serialized, and
its `angle`/`distance` readings are relative to the _sender_). Each teammate rebuilds
a full contact from that data with `arena.createContact(message)` — its methods answer
from **their** position, so `getBearing()` points _them_ at the enemy, and
`getIntercept(bot.turret.bulletSpeed)` even leads the shot for them (see
[Lesson 12](/learn/leading)). Markers work the same way: a sent marker arrives as its
`x`/`y`, and `arena.createMarker(message.x, message.y)` rebuilds it — so
`bot.send(bot.dropMarker())` is the one-liner for telling teammates where **you** are.

## Debugging like a pro

When a bot misbehaves, these are your tools:

- **`console.log(...)`** — print anything (numbers, text, even objects) to see what your
  bot is thinking. You used this throughout the course.
- **`logger.warn(...)` / `logger.error(...)`** — like `console.log`, but tagged by
  importance so problems stand out in the log panel.
- **The log panel** (**Arena → View Logs**) also shows **faults**: if your code has a typo,
  throws an error, or runs too long, the bot is stopped and the reason appears there.
- **Save vs Reboot:** Save swaps in new code while the bot keeps its memory; **Reboot**
  (⏻ or `Ctrl-Shift-S`) restarts the bot fresh and re-runs `START`. Reboot when you want a
  clean slate.
- **Keep handlers quick** and don't write endless loops — a handler that never finishes
  will crash the bot.

## 🎓 You can now use the whole toolkit

- **Name & identity:** `bot.setName`, `bot.getId`, `bot.getHealth`
- **Move:** `bot.setSpeed`, `bot.getX` / `getY`, `arena.getWidth` / `getHeight`
- **Turn:** `bot.turn`, `bot.setOrientation`, `getOrientation`, `isTurning` (the compass)
- **Decide:** `if` / `else`, booleans, objects, variables (`let`, `this`)
- **Fight:** `bot.turret.fire` / `isReady` / `setOrientation`, the **FIRED** event
- **See:** `bot.radar.scan` / `isReady`, the **SCANNED** list, scan-result fields
- **React:** **START, TICK, SCANNED, DETECTED, HIT, COLLIDED, FIRED, RECEIVED**
- **Wait:** Promises with `await`, `.then`, `.catch`, and `onReady`
- **Remember & organize:** `this` state machines and named functions
- **Schedule:** `setInterval` / `setTimeout` (in ticks), `clearInterval`, `clock.getTime`
- **Navigate:** markers (`arena.createMarker`, `bot.dropMarker`, `getBearing`, `getDistance`), `Math`
- **Team up:** `bot.send` and the **RECEIVED** event
- **Debug:** `console` and `logger`, the log panel, Reboot

That's the complete RobocodeJs toolkit. 🎉

## 🏆 Your capstone challenge

Build your own champion bot that combines what you've learned. A strong bot usually:

1. **Searches** by roaming and sweeping its radar (Lessons 4, 7, 10).
2. **Attacks** the nearest enemy — aim, wait for the cannon, fire (Lessons 8, 9).
3. **Survives** — dodge when HIT and flee when health is low (Lesson 11).
4. **Coordinates** with teammates over `send` / RECEIVED (this lesson).

Mix in markers, timers, and a state machine however you like. Test it by adding a few
copies to the arena (the **[+]** button) and watching them fight.

## Where to go next

- The [full reference docs](/learn/docs) — every method and event in one place.
- The [example bots](/examples) — nine complete strategies to read, run, and remix.

Congratulations — you went from "what is code?" to programming a team of battling robots.
Now go build something awesome! 🤖

---

[← Leading a moving target](/learn/leading) · [Index](/learn)
