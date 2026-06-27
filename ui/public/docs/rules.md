# Game rules & physics

A single reference for the numbers behind the game — how directions work, how fast things
move, and how combat resolves. Handy when you're tuning a bot or porting strategy from
elsewhere.

> Times below assume the simulation's standard **tick** of about **100 ms** (≈10 ticks per
> second). The game is tick-based, so everything is ultimately measured in ticks; the
> seconds are there for intuition.

# Directions: the compass

Orientations are degrees from `0` to `359`. **`0°` is south (down) and angles increase
clockwise.**

```
                      north
                     180°  ↑
                          |
        west  90°  ←------+------→  270°  east
                          |
                      0°  ↓
                      south        (angles increase clockwise: 0 → 90 → 180 → 270)
```

- `0°` = **south** (down)
- `90°` = **west** (left)
- `180°` = **north** (up)
- `270°` = **east** (right)

This applies to your body, turret, and radar orientations, and to the `angle` you get
from scans, hits, and collisions.

## Coordinates

The arena is a **750 × 750** square. The top-left corner is `(0, 0)`:

- **x** grows to the **right** (`bot.getX()`, `0` … `750`)
- **y** grows **downward** (`bot.getY()`, `0` … `750`)

(So "north"/`180°` means moving toward smaller `y`.)

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

| Thing      | Value              | In context                                             |
| ---------- | ------------------ | ------------------------------------------------------ |
| Health     | **1.0 → 0**        | `bot.getHealth()`; `1` is full, `0` is destroyed       |
| Bullet hit | **−0.25**          | a clean hit removes a quarter of full health (~4 hits) |
| Collision  | **−0.01 per tick** | bumping a wall/bot also stops you (speed → 0)          |

# Match length

- A match runs until one team remains.
- To prevent stalemates, after a long match a **sudden-death** phase begins (around
  **10,000 ticks**, ~16 minutes) during which health slowly decays, forcing a finish.

---

See also: the [API reference](/dev) for every method and event, and the
[example bots](/examples). New here? The [Learn course](/learn) teaches all of this
step by step.
