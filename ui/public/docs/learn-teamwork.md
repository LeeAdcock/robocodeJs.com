# Lesson 14: Teamwork and graduation

**By the end of this lesson you'll be able to:**

- Have your robots **talk to each other**
- Debug like a pro — and you'll have used **every** RobocodeJs feature!

**New idea:** _Sending messages between programs._

## The idea

Your team is **five tanks running the same code**. They can coordinate by sending
**messages** to each other:

- `bot.send(7)` — broadcast a **number** to your teammates. (Only numbers can be sent.)
- The **RECEIVED** event fires on each teammate, handing them that number.

A number is enough to share something useful — like the compass direction of an enemy.

## Try it

When any tank spots an enemy, it tells the team which way to point:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) bot.radar.scan();
});

bot.on(Event.SCANNED, (targets) => {
  const enemies = targets.filter((t) => !t.friendly);
  if (enemies.length > 0) {
    bot.send(Math.round(enemies[0].angle)); // tell teammates the direction
    bot.turret.setOrientation(enemies[0].angle - bot.getOrientation());
    if (bot.turret.isReady()) bot.turret.fire();
  }
});

// A teammate spotted an enemy at this angle — aim our turret there too.
bot.on(Event.RECEIVED, (angle) => {
  bot.turret.setOrientation(angle - bot.getOrientation());
});
```

Press **Save**. Now the whole team swings their turrets toward an enemy the moment _any_
one of them sees it. (`Math.round` just sends a tidy whole number.)

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

- The [full reference docs](/dev) — every method and event in one place.
- The [example bots](/examples) — nine complete strategies to read, run, and remix.

Congratulations — you went from "what is code?" to programming a team of battling robots.
Now go build something awesome! 🤖

---

[← Maps and math](/learn/navigation) · [Index](/learn)
