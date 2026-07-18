# Game rules & physics

A single reference for the numbers behind the game: how directions work, how fast things
move, and how combat resolves. Handy when you're tuning a bot or porting strategy from
elsewhere.

> Times below assume the simulation's standard **tick** of about **100 ms** (≈10 ticks per
> second). The game is tick-based, so everything is ultimately measured in ticks; the
> seconds are there for intuition.

# Directions: the compass

Headings are degrees from `0` to `359`, like a compass. **`0°` is north (up) and angles
increase clockwise**, the same as classic Robocode.

**Every angle in the API is in degrees, never radians** — headings, bearings, turret and
radar orientation, and turn amounts alike. JavaScript's `Math.atan2`/`sin`/`cos` work in
radians, so convert at the boundary: multiply radians by `180 / Math.PI` before handing an
angle to the API.

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
- **Bearings reported to you** (a scan result's `angle`, the `HIT`/`COLLIDED` `angle`,
  and `marker.getBearing()`) are **relative to your heading** (`0` = dead ahead). That's
  why aiming needs no math: `bot.turret.setOrientation(target.angle)` points the gun at a
  scanned enemy, and `bot.turn(target.angle)` turns the whole bot toward it.

## Coordinates

The arena is a **750 × 750-foot** square. The top-left corner is `(0, 0)`:

- **x** grows to the **right** (`bot.getX()`, `0` … `750`)
- **y** grows **downward** (`bot.getY()`, `0` … `750`)

(So `0°`/north means moving toward smaller `y`.)

Bot centers keep a **16-foot margin** from every wall. A bot touching a wall sits at
`16` (or `734`), not `0`. Bots also spawn at least **50 feet** apart.

# Movement

| Thing          | Value           | In context                                        |
| -------------- | --------------- | ------------------------------------------------- |
| Top speed      | **5** feet/tick | ≈50 feet/sec (~34 mph), crosses the arena in ~15s |
| Acceleration   | **2** feet/tick | reaches top speed (or stops) in ~3 ticks          |
| Speed range    | **−5 … 5**      | negative is reverse; `0` stops                    |
| Body turn rate | **10°/tick**    | ≈100°/sec, a full spin in ~3.6s                   |

# Turret & radar

| Thing            | Value            | In context                                                                                                                     |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Turret turn rate | **4°/tick**      | ≈40°/sec (turret turns relative to the body)                                                                                   |
| Radar turn rate  | **4°/tick**      | radar turns relative to the turret                                                                                             |
| Turret reload    | **40 ticks**     | ~4s between shots; `isReady()` / `onReady()` track it                                                                          |
| Radar recharge   | **10 ticks**     | ~1s between scans                                                                                                              |
| Radar range      | **600 feet**     | a narrow beam, 32 feet wide at the bot flaring to ~244 feet across at its tip, drawn under the radar in the arena              |
| Bullet speed     | **25** feet/tick | ≈250 feet/sec                                                                                                                  |
| Deployment hold  | **100 ticks**    | ~10s at match start with turrets held: `isReady()` is `false` and `fire()` rejects while bots deploy (reload still progresses) |

# Combat & health

| Thing             | Value                    | In context                                                                                                                                                              |
| ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health            | **100 → 0**              | `bot.getHealth()`; `100` is full, `0` is dead                                                                                                                           |
| Bullet damage     | **−25**                  | a clean hit removes a quarter of full health                                                                                                                            |
| Bullet hit radius | **32 feet**              | a bullet hits any bot whose center is within 32 feet                                                                                                                    |
| Bot collision     | **32 feet**              | two bots collide when their centers are within 32 feet                                                                                                                  |
| Wall collision    | **0.75 × impact speed**  | driving into an arena edge stops you dead (speed → 0) and costs damage scaled by how fast you drove in; a gentle graze is free, and skimming along a wall costs nothing |
| Bot ram           | **0.75 × closing speed** | a hard bump hurts once per contact (a gentle touch is free); the two bots are shoved apart but keep their speed, not stopped                                            |
| Missed shot       | **−3**                   | a bullet that leaves the field without hitting anyone costs the shooter 3 health                                                                                        |

**Friendly fire is on.** A bullet damages **any** bot within the 32-foot hit
radius, **including your own teammates**. There is no team exemption, so a shot
that skims past a teammate can hurt them. Watch your line of fire when your bots
cluster.

**Missing costs you.** A bullet that flies clear off the field without hitting
any bot deducts **3 health** from the bot that fired it. There is no cost to
_fire_, only to _miss_, so don't spray blindly: fire when you have a target
and expect to connect. (A shot that grazes a wall's hit radius still counts as a
miss once it leaves the arena.)

**Hitting a moving target: "lead" the shot.** A bullet leaves the muzzle and
travels **25 feet/tick**; it is not instant. If you aim where an enemy _is_, by
the time the bullet arrives the enemy has moved and you miss. To connect, aim
where the target _will be_. This is **leading**. A scan gives you the enemy's
`speed` and `orientation` (its absolute heading), which is exactly what you need
to predict its future position. Leading is the single biggest accuracy gain
against anything that moves; the [Leading a moving target](/learn/leading) lesson
walks through it.

# Messages & your five bots

Each app fields **five bots**, and every bot runs your program
**independently**: each gets its own private copy. Top-level variables
(`let target = …`) are **per-bot**, `START` runs once per bot, and one bot
cannot see another's state. The **only** way bots share anything is by sending
messages.

- `bot.send(message)` broadcasts a **message**, a primitive (number, string,
  boolean, `null`) or a nested object/array of them, that **every other living
  bot in the arena receives** via `Event.RECEIVED`, **including enemy bots**,
  not just your teammates. There are no private channels. The receiver also gets
  a second argument, `{ distance }`: how far away the sender was (a range, not a
  bearing), so broadcasting leaks your distance to everyone in the arena.
- Because the broadcast is global, a naïve `RECEIVED` handler can be fed an
  **enemy's** message: even that enemy's callout about _your own_ bot. If you
  use messages to coordinate a team, tag them with a field your bots recognize
  and another team is unlikely to send (e.g. a shared `team` value), and validate
  an incoming message before acting on it.

# Match length

- A match runs until one team remains.
- To prevent stalemates, after a long match a **sudden-death** phase begins (around
  **7,500 ticks**, ~12.5 minutes) during which health slowly decays. Every bot loses
  **1 health every 50 ticks** (~5s), forcing a finish.

# Limits

To keep the shared server fast and fair for everyone, a few limits apply. These
are generous for normal play. You'll usually only meet them if something is
looping.

| Limit                   | Value                                          |
| ----------------------- | ---------------------------------------------- |
| Bots (apps) per account | **20**                                         |
| Arenas per account      | **10**                                         |
| Bots per arena          | **5**                                          |
| Active timers per bot   | **64** (`setInterval` + `setTimeout` combined) |

Going over the timer limit surfaces code **E021** in the bot's console and the
extra `setInterval`/`setTimeout` is ignored. It isn't fatal. (Timers are counted
per bot, and each app fields five bots.)

## Rate limits

The API is also **rate limited**. If requests arrive too quickly, the server
replies with **HTTP 429** and error code **E022**, and the action is skipped.
That can happen when you sign in, save/check/deploy code, create apps and
arenas, or drive your bots through an AI assistant (MCP). Wait a moment and retry; if a script is
driving the API, add a small delay between calls. Typical budgets (per account, or
per IP address for sign-in):

| Action                             | Budget      |
| ---------------------------------- | ----------- |
| Sign in                            | 20 / 10 min |
| Check, deploy, or reboot code      | 60 / min    |
| Create an app or arena             | 30 / min    |
| AI assistant tools (MCP)           | 60 / min    |
| Any API request (overall backstop) | 600 / min   |

See [Error codes](/error-codes) for **E021** and **E022**.

---

See also: the [API reference](/learn/docs) for every method and event, the
[FAQ](/faq) for quick answers to common questions, and the
[example bots](/examples). New here? The [Learn course](/learn) teaches all of this
step by step.
