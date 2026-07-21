# Lesson 15: Teamwork and graduation

**By the end of this lesson you'll be able to:**

- Have your robots **talk to each other**
- Debug like a pro, and you'll have used **every** RobocodeJs feature!

**New idea:** _Sending messages between programs._

## The idea

Your team is **five bots running the same code**. They can coordinate by sending **messages** to each other:

- `bot.send(7)`: broadcast a message. It can be a **number** (or a string, or a small object of them, like `{ x: 100, y: 200 }`).
- The **RECEIVED** event fires on the other bots, handing them that message (plus `from`, telling you how far away the sender was).

One catch: `bot.send` is heard by **every** bot in the arena, **enemies included**, not just your team. So a real team tags its messages with something only teammates know and checks it before trusting one (the [Magnetic](/examples) example shows how). For this lesson we'll keep it simple. A number is enough to share something useful, like the compass direction of an enemy.

## Try it

When any bot spots an enemy, it tells the team which way to point:

```
bot.setName('Rusty');

bot.on(Event.START, () => {
  this.called = null; // the last direction a teammate called out
  bot.setSpeed(3);
});

clock.on(Event.TICK, () => {
  if (!bot.isTurning()) bot.turn(20); // wander, so the radar sweeps
  if (bot.radar.isReady()) bot.radar.scan();

  // Act on the newest call-out here, where only one thing is steering the gun.
  if (this.called !== null) {
    bot.turret.setOrientation(this.called - bot.getOrientation());
    this.called = null;
  }
});

bot.on(Event.SCANNED, (targets) => {
  const enemies = targets.filter((t) => !t.friendly);
  if (enemies.length > 0) {
    // A scan's angle is relative to *us*, so share the absolute compass
    // direction (our heading + the bearing) that any teammate can use.
    bot.send(Math.round(enemies[0].angle + bot.getOrientation()) % 360);
    bot.turret.setOrientation(enemies[0].angle); // our own aim (body-relative)
    if (bot.turret.isReady()) bot.turret.fire();
  }
});

// A teammate shared an absolute direction to an enemy. Write it down; TICK
// points the turret. Several teammates can call out on the same tick, and if
// each of them aimed from here they would just cancel each other.
bot.on(Event.RECEIVED, (heading) => {
  this.called = heading;
});

bot.on(Event.COLLIDED, () => {
  bot.turn(150).catch(() => {}); // don't spend the match against a wall
  bot.setSpeed(3);
});
```

Press **Reboot**. Now the whole team swings their turrets toward an enemy the moment _any_ one of them sees it. (`Math.round` just sends a tidy whole number, and `% 360` keeps it a compass heading.)

Notice where the aiming happens. Every broadcast is delivered on its own, so when three teammates spot the same enemy in one tick your `RECEIVED` handler runs three times, and three turret commands issued back-to-back mean the first two are cancelled before the gun has turned a degree. Writing the call-out down and acting on it once in TICK is the same "one handler owns one control" rule from [Lesson 11](/learn/survival).

**Sharing a position instead of a direction.** A direction is only right from where _you_ stand. A teammate across the arena pointing the same way looks at a different spot. Every scan result is a **contact** (a marker pinned at the enemy's location), so you can broadcast its actual coordinates instead: `bot.send({ x: enemies[0].getX(), y: enemies[0].getY() })`, and each teammate aims with `bot.turret.turnTowards(message.x, message.y)`, the same point for everyone. The **Squad** example bot builds this out, team secret and all.

**Sharing the whole contact.** You can even broadcast the contact itself: `bot.send(enemies[0])`. A contact is **serializable**: what actually transmits is its plain data (position, speed, heading, and so on; the methods aren't serialized, and its `angle`/`distance` readings are relative to the _sender_). Each teammate rebuilds a full contact from that data with `arena.createContact(message)`, its methods answer from **their** position, so `getBearing()` points _them_ at the enemy, and `getIntercept(bot.turret.BULLET_SPEED)` even leads the shot for them (see [Lesson 14](/learn/leading)). Markers work the same way: a sent marker arrives as its `x`/`y`, and `arena.createMarker(message.x, message.y)` rebuilds it, so `bot.send(bot.dropMarker())` is the one-liner for telling teammates where **you** are.

## Debugging like a pro

When a bot misbehaves, these are your tools:

- **`console.log(...)`**: print anything (numbers, text, even objects) to see what your bot is thinking. You used this throughout the course.
- **`logger.warn(...)` / `logger.error(...)`**: like `console.log`, but tagged by importance so problems stand out in the log panel.
- **The log panel** (**Arena → View Logs**) also shows **faults**: if your code has a typo, throws an error, or runs too long, the bot is stopped and the reason appears there.
- **Save vs Reboot:** Save swaps in new code while the bot keeps its memory; **Reboot** (⏻ or `Ctrl-Shift-S`) restarts the bot fresh and re-runs `START`. Reboot when you want a clean slate.
- **Keep handlers quick** and don't write endless loops: a handler that never finishes will crash the bot.

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
2. **Attacks** the nearest enemy: aim, wait for the cannon, fire (Lessons 8, 9).
3. **Survives**: dodge when HIT and flee when health is low (Lesson 11).
4. **Coordinates** with teammates over `send` / RECEIVED (this lesson).
5. **Doesn't shoot its own team**: before firing, check that no friendly bot is on the line between you and your target (Lesson 8). With five bots fighting shoulder to shoulder this is easy to overlook — a team that nails the first four behaviours can still lose to friendly fire alone.

Mix in markers, timers, and a state machine however you like. Your app already fields a team of five, so the coordination is there to test the moment you add an opponent — use the **Bots per app** dropdown in the arena toolbar if you want to try a different squad size. (The roster's **[+]** button adds a _different_ app, which gives you opponents rather than teammates: teammates are the bots running _your_ code.)

**Who to beat.** The [example bots](/examples) make a natural ladder of difficulty. Clone one into the arena, watch the fight, then climb:

- **[Lighthouse](/samples/lighthouse)** _(beginner)_ — the simplest scan-and-fire bot there is. If your team can't beat this one, there's a bug to find first.
- **[Squad](/samples/squad)** _(intermediate)_ — a coordinated team that focus-fires one target at a time. This one tests whether your _own_ teamwork holds up under pressure.
- **[Marksman](/samples/marksman)** _(advanced)_ — the sharpest shooter in the set: it leads its shots, picks off the weakest target, and holds fire until it's truly lined up.

**Beating Marksman is graduation.** When your team can take down the toughest bot in the examples, you've built something genuinely strong — and you're ready to stop following lessons and start inventing strategies and tactics of your own.

## Where to go next

- The [global leaderboard](/leaderboard): every eligible bot earns an **Elo rating** from matches it plays around the clock against everyone else's. Keep sharpening your graduate bot and watch where it climbs — it's the real, running answer to "is my bot any good?"
- The [full reference docs](/learn/docs): every method and event in one place.
- The [example bots](/examples): nine complete strategies to read, run, and remix.

Congratulations, you went from "what is code?" to programming a team of battling robots. Now go build something awesome! 🤖

---

[← Leading a moving target](/learn/leading) · [Index](/learn)
