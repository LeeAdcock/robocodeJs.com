# Coming from classic Robocode?

Welcome! If you've written tank AI for the classic (Java) Robocode, you already have the
right instincts: it's still event-driven robots scanning, aiming, and firing in an arena.
This page maps what you know onto RobocodeJs so you can get productive fast — and flags
the handful of differences that will trip you up if you don't know them.

## The big picture

|                | Classic Robocode                                                  | RobocodeJs                                                                                                                                         |
| -------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language       | Java (`extends Robot` / `AdvancedRobot`)                          | JavaScript (no class — an "app" of event handlers)                                                                                                 |
| Program shape  | a `run()` loop + `onX()` event methods                            | register handlers: `bot.on(Event.X, …)`, `clock.on(Event.TICK, …)`                                                                                 |
| You control    | one robot per file                                                | a **team of 5 bots**, all sharing your one app                                                                                                     |
| Health         | **energy** `0–100`, spent to fire, gun heat limits fire rate      | **health** `0–100`; no cost to fire, no gun heat — a **reload timer** instead — but a **missed shot** (bullet leaves the field) costs **3 health** |
| Movement calls | blocking `ahead(100)` / `turnRight(45)` (or `setAhead`+`execute`) | **async** `bot.setSpeed(5)` / `bot.turn(45)` return **Promises**                                                                                   |
| Heading `0°`   | **North**, clockwise                                              | **North**, clockwise — same                                                                                                                        |
| Bearings       | relative to your heading (`getBearing()`)                         | relative to your heading — same                                                                                                                    |
| Messaging      | `TeamRobot` serializable objects                                  | any JSON message — a primitive or nested object/array — via `bot.send()`, broadcast to every bot in the arena (enemies included)                   |

## Good news: directions work like you expect

The compass matches classic Robocode: **`0°` is north and angles increase clockwise**
(see the [compass diagram](/rules#directions-the-compass)). And like classic's
`getBearing()`, the angles reported to you — a scan result's `angle`, the `HIT`/`COLLIDED`
`angle`, `marker.getBearing()` — are **relative to your heading**. The turret turns
relative to the body too, so aiming a scanned target needs no trig at all:

```
bot.turret.setOrientation(target.angle); // point the gun at the enemy
bot.turn(target.angle); // or turn the whole bot toward it
```

(The bot's own heading, `bot.getOrientation()` / `setOrientation()`, is the one absolute
compass value — exactly like classic's `getHeading()`.)

## Events you already know

| Classic                    | RobocodeJs                                                                        |
| -------------------------- | --------------------------------------------------------------------------------- |
| `run()` (main loop)        | `clock.on(Event.TICK, …)` — runs every tick                                       |
| `onScannedRobot(e)`        | `bot.on(Event.SCANNED, (results) => …)` — an **array** of everything the scan saw |
| `onHitByBullet(e)`         | `bot.on(Event.HIT, (info) => …)` — `info.angle`                                   |
| `onHitWall` / `onHitRobot` | `bot.on(Event.COLLIDED, (info) => …)` — `info.angle`, `info.friendly`             |
| `onBulletHit`              | the value `bot.turret.fire()` resolves to: `{ id }` if it hit                     |
| (startup)                  | `bot.on(Event.START, …)` — also the place to set state on `this`                  |
| —                          | `Event.DETECTED` (an enemy's radar swept you), `Event.FIRED`, `Event.RECEIVED`    |

## Movement & guns: blocking → async

Classic movement is distance/blocking (`ahead(100)` drives 100 px then returns).
RobocodeJs movement is **continuous and asynchronous**: you set a target and get a Promise
that resolves when it's reached (or rejects if a later command overrides it).

| Classic                    | RobocodeJs                                                                  |
| -------------------------- | --------------------------------------------------------------------------- |
| `setAhead(d)` / `ahead(d)` | `bot.setSpeed(0…5)` (a speed, not a distance; `0` stops)                    |
| `turnRight(deg)`           | `bot.turn(deg)` → Promise (positive = clockwise)                            |
| `turnGunRight(deg)`        | `bot.turret.turn(deg)` (turret turns relative to the body)                  |
| `turnRadarRight(deg)`      | `bot.radar.turn(deg)` (radar turns relative to the turret)                  |
| `fire(power)`              | `bot.turret.fire()` (no power/heat; check `isReady()` / `await onReady()`)  |
| `getEnergy()`              | `bot.getHealth()` (`100` … `0`)                                             |
| `getX()` / `getY()`        | `bot.getX()` / `bot.getY()` (and `arena.createMarker(x, y)` for navigation) |

Because actions take time, you sequence them with `await` / `.then()` and tidy cancelled
ones with `.catch(() => {})`. If async-in-JS is new to you, the course covers it in
[Lesson 9: Good things take time](/learn/waiting).

## A tiny "tracker", ported

A familiar pattern — scan, aim, fire — looks like this here:

```
bot.on(Event.START, () => bot.setSpeed(3));

clock.on(Event.TICK, async () => {
  const targets = await bot.radar.onReady().then(bot.radar.scan);
  const enemy = targets.find((t) => !t.friendly);
  if (enemy) {
    await bot.turret.setOrientation(enemy.angle); // bearing is body-relative
    if (bot.turret.isReady()) bot.turret.fire();
  }
});
```

## Where to go next

- The [example bots](/examples) are your "sample robots" — read `firstbot` first.
- The [game rules & physics](/rules) page has the exact speeds, turn rates, reload times,
  and damage values.
- The full [API reference](/learn/docs) lists every method and event.
- Newer to JS than to Robocode? The [Learn course](/learn) ramps quickly and you can skip
  the parts you already know.
