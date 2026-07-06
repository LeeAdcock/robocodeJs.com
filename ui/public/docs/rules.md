# Game rules & physics

A single reference for the numbers behind the game — how directions work, how fast things
move, and how combat resolves. Handy when you're tuning a bot or porting strategy from
elsewhere.

> Times below assume the simulation's standard **tick** of about **100 ms** (≈10 ticks per
> second). The game is tick-based, so everything is ultimately measured in ticks; the
> seconds are there for intuition.

# Directions: the compass

Headings are degrees from `0` to `359`, like a compass. **`0°` is north (up) and angles
increase clockwise** — the same as classic Robocode.

```
                     north
                     0°  ↑
                         |
       west 270° ←-------+-------→ 90° east
                         |
                     180° ↓
                     south       (angles increase clockwise: 0 → 90 → 180 → 270)
```

- `0°` = **north** (up)
- `90°` = **east** (right)
- `180°` = **south** (down)
- `270°` = **west** (left)

How the frames fit together:

- Your **body heading** (`bot.getOrientation()` / `setOrientation()`) is an absolute
  compass heading on the diagram above.
- The **turret** turns relative to the body; the **radar** turns relative to the turret.
- **Bearings reported to you** — a scan result's `angle`, the `HIT`/`COLLIDED` `angle`,
  and `marker.getBearing()` — are **relative to your heading** (`0` = dead ahead). That's
  why aiming needs no math: `bot.turret.setOrientation(target.angle)` points the gun at a
  scanned enemy, and `bot.turn(target.angle)` turns the whole tank toward it.

## Coordinates

The arena is a **750 × 750** square. The top-left corner is `(0, 0)`:

- **x** grows to the **right** (`bot.getX()`, `0` … `750`)
- **y** grows **downward** (`bot.getY()`, `0` … `750`)

(So `0°`/north means moving toward smaller `y`.)

# Movement

| Thing          | Value            | In context                                |
| -------------- | ---------------- | ----------------------------------------- |
| Top speed      | **5** units/tick | ≈50 units/sec — crosses the arena in ~15s |
| Acceleration   | **2** units/tick | reaches top speed (or stops) in ~3 ticks  |
| Speed range    | **−5 … 5**       | negative is reverse; `0` stops            |
| Body turn rate | **10°/tick**     | ≈100°/sec — a full spin in ~3.6s          |

# Turret & radar

| Thing            | Value             | In context                                            |
| ---------------- | ----------------- | ----------------------------------------------------- |
| Turret turn rate | **2°/tick**       | ≈20°/sec (turret turns relative to the body)          |
| Radar turn rate  | **2°/tick**       | radar turns relative to the turret                    |
| Turret reload    | **50 ticks**      | ~5s between shots; `isReady()` / `onReady()` track it |
| Radar recharge   | **10 ticks**      | ~1s between scans                                     |
| Bullet speed     | **25** units/tick | ≈250 units/sec                                        |

# Combat & health

| Thing             | Value           | In context                                             |
| ----------------- | --------------- | ------------------------------------------------------ |
| Health            | **100 → 0**     | `bot.getHealth()`; `100` is full, `0` is dead          |
| Bullet damage     | **−25**         | a clean hit removes a quarter of full health           |
| Bullet hit radius | **32 units**    | a bullet hits any tank whose center is within 32 units |
| Collision         | **−1 per tick** | bumping a wall/bot also stops you (speed → 0)          |

**Friendly fire is on.** A bullet damages **any** tank within the 32-unit hit
radius — **including your own teammates**. There is no team exemption, so a shot
that skims past a teammate can hurt them. Watch your line of fire when your tanks
cluster.

**Hitting a moving target — "lead" the shot.** A bullet leaves the muzzle and
travels **25 units/tick**; it is not instant. If you aim where an enemy _is_, by
the time the bullet arrives the enemy has moved and you miss. To connect, aim
where the target _will be_ — this is **leading**. A scan gives you the enemy's
`speed` and `orientation` (its absolute heading), which is exactly what you need
to predict its future position. Leading is the single biggest accuracy gain
against anything that moves; the [Leading a moving target](/learn/leading) lesson
walks through it.

# Messages & your five tanks

Each app fields **five tanks**, and every tank runs your program
**independently** — each gets its own private copy. Top-level variables
(`let target = …`) are **per-tank**, `START` runs once per tank, and one tank
cannot see another's state. The **only** way tanks share anything is by sending
messages.

- `bot.send(number)` broadcasts a single integer that **every other living tank
  in the arena receives** via `Event.RECEIVED` — **including enemy tanks**, not
  just your teammates. There are no private channels.
- Because the broadcast is global, a naïve `RECEIVED` handler can be fed an
  **enemy's** message — even that enemy's callout about _your own_ tank. If you
  use messages to coordinate a team, encode a value your tanks recognize and
  another team is unlikely to send by accident (e.g. reserve some high bits as a
  team tag), and don't blindly trust an incoming number as a friendly target.

# Match length

- A match runs until one team remains.
- To prevent stalemates, after a long match a **sudden-death** phase begins (around
  **10,000 ticks**, ~16 minutes) during which health slowly decays, forcing a finish.

# Limits

To keep the shared server fast and fair for everyone, a few limits apply. These
are generous for normal play — you'll usually only meet them if something is
looping.

| Limit                   | Value                                          |
| ----------------------- | ---------------------------------------------- |
| Bots (apps) per account | **20**                                         |
| Arenas per account      | **10**                                         |
| Bots per arena          | **5**                                          |
| Active timers per tank  | **64** (`setInterval` + `setTimeout` combined) |

Going over the timer limit surfaces code **E021** in the bot's console and the
extra `setInterval`/`setTimeout` is ignored — it isn't fatal. (Timers are counted
per tank, and each app fields five tanks.)

## Rate limits

The API is also **rate limited**. If requests arrive too quickly — signing in,
saving/checking/deploying code, or creating apps and arenas — the server replies
with **HTTP 429** and error code **E022**, and the action is skipped. Wait a moment
and retry; if a script is driving the API, add a small delay between calls. Typical
budgets (per account, or per IP address for sign-in):

| Action                             | Budget      |
| ---------------------------------- | ----------- |
| Sign in                            | 20 / 10 min |
| Check, deploy, or reboot code      | 60 / min    |
| Create an app or arena             | 30 / min    |
| Any API request (overall backstop) | 600 / min   |

See [Error codes](/error-codes) for **E021** and **E022**.

---

See also: the [API reference](/dev) for every method and event, and the
[example bots](/examples). New here? The [Learn course](/learn) teaches all of this
step by step.
