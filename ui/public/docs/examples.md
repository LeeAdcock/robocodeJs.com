# Example Bots

Complete bot strategies you can read, run, and remix. Click one to open it in a read-only viewer, then use **Clone this bot** to drop a copy into your arena and start editing. New to bots? Work through the [lessons](/learn) first, then come back here to see the ideas combined.

## Getting started

- **[Lighthouse](/samples/lighthouse)** _(beginner)_: A stationary bot that turns as it scans, adjusting its turret onto a target before firing. The simplest scan-and-fire loop.

- **[Spirograph](/samples/spirograph)** _(beginner)_: Drives straight with a fixed forward turret, tracing looping patterns while it shoots whatever wanders in front of it.

- **[ReturnFire](/samples/returnfire)** _(beginner)_: Stationary, but instantly turns to face any bot that hits or collides with it and returns fire, a purely event-driven bot with no tick loop.

- **[Chronometer](/samples/chronometer)** _(beginner)_: Demonstrates one-shot and repeating timers (`setInterval` / `setTimeout`) driven by the game clock.

- **[Pathfinder](/samples/pathfinder)** _(intermediate)_: Navigates continuously between a set of precomputed waypoints, using trig to steer toward each point.

## Combat

- **[Marksman](/samples/marksman)** _(advanced)_: Predicts where a moving enemy will be and **leads** the shot, focus-fires the weakest target, and holds fire until it's actually lined up. The sharpest shooter in the set.

- **[Survivor](/samples/survivor)** _(intermediate)_: Watches its own health and switches between fighting and fleeing, dodges incoming fire, and reacts to being spotted on radar.

## Teamwork

- **[Magnetic](/samples/magnetic)** _(intermediate)_: Teammates share a secret-tagged message protocol to broadcast their positions and cluster together.

- **[Squad](/samples/squad)** _(intermediate)_: Teammates broadcast the position of any enemy they spot so the whole team focus-fires one target at once.
