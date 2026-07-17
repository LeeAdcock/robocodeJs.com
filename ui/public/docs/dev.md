# Bot Development

Each bot's logic is defined in JavaScript that is initialized at the beginning of a match to provide initial commands and register event handlers. Saving your code reloads it live — your event handlers are replaced immediately — but it does **not** re-run the `START` handler, so a running bot keeps the state it set up. Use the editor's **reboot** button (or `Ctrl-Shift-S`) to reload your code and re-run `START` when you want a fresh initialization.

The in-browser code editor offers **autocomplete** for the whole bot API: type `bot.`, `arena.`, `clock.`, or `Event.` to see the available members, each with its signature and a short description.

See also the [game rules & physics](/rules) for exact speeds, turn rates, reload times, and damage values, the [FAQ](/faq) for quick answers to common questions, and — if you've used the classic Java Robocode — [Coming from classic Robocode](/classic). Brand new to coding? Try the [Learn course](/learn).

- [Arena](#arena)
- [Clock](#clock)
- [Bot events](#bot-events)
- [Bot movement](#movement)
- [Bot turret](#turret)
- [Bot radar](#radar)
- [Type definitions](#type-definitions)

# Arena

The arena where bots live is a square. Headings are specified in degrees on a compass, with 0 degrees being north, 90 east, 180 south, and 270 west, increasing clockwise. Bearings reported to you (scan/hit/collision angles and `marker.getBearing()`) are relative to your own heading. Terrain and other arena elements do not affect gameplay. See [game rules & physics](/rules) for the full compass diagram.

- `arena.getWidth() : number` Returns the arena's width in units.
- `arena.getHeight() : number` Returns the arena's height in units.
- `arena.contains(x, y) : boolean` Returns whether the coordinate lies inside the arena (between 0 and the width/height, edges inclusive).
- `arena.getNearestWall() : marker` Returns a marker at the nearest point on the arena boundary — `getDistance()` tells you how far the wall is, `getBearing()` which way. Note that your bot collides about 16 units before the wall itself (see [game rules & physics](/rules)), so the distance never quite reaches 0.

Virtual markers can be created in the arena that provide simplified calculations for angles and distance. These markers are either dropped at the current bot location, or at a specified coordinate.

- `arena.createMarker(x, y) : marker` Creates a marker at the provided arena coordinates.
- `arena.createContact(data) : contact` Rebuilds a full [contact](#contacts) from its serialized data — typically a contact a teammate broadcast, since a contact serializes as its plain data properties (methods are not serialized). `data` needs numeric `x`, `y`, `speed`, and `orientation`; a `time` (the capture tick) lets `getIntercept` account for staleness and defaults to now; any other fields (`id`, `health`, `friendly`, …) carry through as data. The rebuilt contact's methods are measured from **your** position.

The `marker` object returned has several convenience methods:

- `marker.getX() : number` Returns the marker's x coordinate.
- `marker.getY() : number` Returns the marker's y coordinate.
- `marker.getDistance() : number` Returns the distance from the bot to the marker, rounded down to a whole number.
- `marker.getBearing() : number` Returns the bearing from the bot to the marker (0 to 359), relative to your heading — `bot.turn(marker.getBearing())` faces it.
- `marker.isInBounds() : boolean` Returns whether the marker lies inside the arena — the same check as `arena.contains(marker.getX(), marker.getY())`.

A marker's coordinates are also plain properties, `marker.x` and `marker.y`, which makes a marker serializable — it can be passed to `bot.send` (or through JSON), transmitting as its coordinates, since methods are not serialized. A receiver rebuilds it with `arena.createMarker(message.x, message.y)`. In particular, `bot.send(bot.dropMarker())` is the recommended way to broadcast your own position to teammates.

# Events Overview

Most of your bot application code will be defined as functions you create that are executed when events take place in your bot's environment. These functions, which are registered on the bot as event handlers, enable you to define how your bot reacts and adapts. Each time you set an event handler with the `on` function, it will overwrite any previously defined handler for that event type.

```
bot.on(Event.DETECTED, () => {
  // event has occurred and logic should be executed
})
```

If an event handler returns nothing, it will be called each time the event occurs. This can at times result in unintended side effects if multiple events happen in quick succession and the handler is executing multiple times in parallel. To account for this, if the registered event handler returns a Promise, that Promise must resolve before the event handler will be called again for the same event type. Events can return Promises as demonstrated below with a traditional `return` statement, the abbreviated arrow syntax, or through using `async...await`.

Define a chain of behaviors when an event occurs:

```
clock.on(Event.TICK, () => {
  return bot.radar
    .onReady()
    .then(() => bot.radar.scan())
    .then(() => bot.setSpeed(0))
    .then(() => bot.turret.onReady())
    .then(() => bot.turret.fire())
    .catch(() => bot.setSpeed(5))
})
```

```
bot.on(Event.COLLIDED, () => bot.turn(110).then(() => bot.setSpeed(5)))
```

Use `async...await` to stop code execution until an asynchronous activity has finished:

```
clock.on(Event.TICK, async () => {
  await bot.radar.onReady()
  await bot.radar.scan()
    .then(() => bot.turret.onReady())
    .then(() => bot.turret.fire())
})
```

# Clock

You can access the current "simulation time" using the 'clock' object. Registering a handler for clock ticks enables providing logic that executes at a set frequency. For logic that executes on different frequencies, details on the JavaScript timers are below. A clock tick is the smallest increment of time within the simulation.

- `clock.getTime() : number` Returns the number of clock ticks elapsed in the current match.
- `clock.on(Event.TICK, () => {} )` Registers a callback that is executed every clock tick.

# Bot

The `bot` object provides the programmatic ability to control the various capabilities of the bot. This includes navigation, radar, fire control, and communications. Methods allow triggering behaviors on the bot, while callbacks enable reacting to events that occur on the bot.

A few basic methods exist for setting and retrieving information about the bot.

- `bot.setName(string)` Sets the bot's display name. Names are sanitized and length-capped; an empty or disallowed name is silently ignored and the bot keeps its current name.
- `bot.getId() : string` Returns a unique identifier (a UUID string).
- `bot.getHealth() : number` Returns the bot's health from 100 (full) down to 0 (unfortunately dead).
- `bot.dropMarker() : marker` Returns a marker object for the bot's current location. Markers are serializable, so `bot.send(bot.dropMarker())` is the easy way to broadcast your position.
- `bot.radius : number` The bot's collision radius (half its width). A wall is hit when the bot's center comes within one radius of an arena edge, and bots or bullets connect within two radii — useful for planning how much room a turn or a stop needs.

## Bot events

- `bot.on(Event.FIRED, () => {})` Registers a callback that is executed when the turret is fired.
- `bot.on(Event.SCANNED, (contact[]) => {})` Registers a callback that is executed when the radar performs a scan, the handler is provided an array of [contacts](#contacts) — the same objects `bot.radar.scan()` resolves with — representing each bot detected by the scan. Each carries the readings `{ id: string, speed: number, orientation: number, distance: number, angle: number, friendly: boolean, health: number }` (as both properties and accessor methods) plus the marker and intercept methods. The `angle` is a bearing relative to your heading (so `bot.turret.setOrientation(angle)` aims at it); `orientation` is the detected bot's own absolute heading; `health` is the detected bot's current health (0–100).
- `bot.on(Event.COLLIDED, (object) => {})` Registers a callback that is executed when the bot collides with the edge of the arena, or with another bot. Bots will stop with a speed of zero after a collision. An object is provided to the handler that is of the format `{angle:number, friendly:boolean}` specifying the direction of the collided object or arena edge; the angle is relative to your heading (a wall ahead is 0). `friendly` is `true` for a teammate and `false` for an enemy; it is `undefined` when you hit a wall. Be careful returning a Promise from the `COLLIDED` event handler which may itself cause a collision. The handler will not be called for the second collision while the first Promise has not yet finished.

## Environment events

- `bot.on(Event.HIT, (object) => {})` Registers a callback that is executed when the bot is hit. An object is provided to the handler that is of the format `{angle:number}`, where the angle is the bearing the shot came from, relative to your heading.
- `bot.on(Event.DETECTED, () => {})` Registers a callback that is executed when the bot is detected by another bot's radar.
- `bot.on(Event.START, () => {})` Registers a callback that is executed when the bot first starts, when the arena restarts, and when you reboot the app — an ordinary save does not re-fire it (see [State and the START event](#state-and-the-start-event)).

## Communications events

- `bot.on(Event.RECEIVED, (message, from) => {})` Registers a callback that is executed when another bot broadcasts a message (via `bot.send`). This fires for messages from **any** bot in the arena, including enemies. `message` is the payload sent — a primitive (number, string, boolean, or null) or a nested array/object of primitives. `from` is `{ distance: number }`: how far away the sender was when it broadcast (a range, not a bearing — the same value is given to teammates and eavesdropping enemies).

## Movement

The bot can turn left or right, and move straight ahead at a desired speed. The turn rate is limited, so a measurable amount of time will pass between setting the desired orientation and the bot achieving that orientation. Similarly there is a limited acceleration and deceleration. Turns always take the shortest path to the target angle — `bot.turn(350)` is executed as 10 degrees counter-clockwise, not 350 clockwise — so use signed values to control direction (positive clockwise, negative counter-clockwise). The same applies to the turret and radar. Methods that set these values will return a Promise object that is resolved when the desired value is reached. If other logic changes the desired value before it is reached, the Promise will be rejected - optionally these rejections can be caught and handled. (A pending command is also rejected if the bot is destroyed or the match stops before the value is reached.) Leaving such a rejection unhandled is safe: it is logged to your bot's log panel but does **not** stop the bot, so you only need to `.catch()` them when you want to react to the cancellation (or to keep your logs quiet).

Asynchronously set a desired value and ignore any result:

```
bot.setOrientation(90)
```

Asynchronously set a desired value and chain following actions:

```
bot.setOrientation(90).then(() => {
  // desired orientation has been reached
}).catch(() => {
  // action was overridden by a subsequent command
})
```

### Position

- `bot.getX() : number` Returns the current x-axis position. The left is 0.
- `bot.getY() : number` Returns the current y-axis position. The top is 0.

### Orientation

- `bot.setOrientation(number) : Promise` Sets the bot's target orientation in degrees. Returns a promise that resolves when the orientation is reached, or that is rejected if the target orientation is altered before being achieved.
- `bot.getOrientation() : number` Returns the orientation in degrees, 0 to 359.
- `bot.isTurning() : boolean` Returns if the bot is actively turning.
- `bot.turn(number) : Promise` Turns the bot the provided number of degrees, positive values turn clockwise and negative values counter-clockwise.
- `bot.turnTowards(x, y) : Promise` Turns the bot towards the provided coordinates. Returns a promise that resolves when the turn is complete.
- `bot.turnRate : number` How many degrees the body turns per tick — divide an angle by this to know how long a turn will take.

### Speed

- `bot.setSpeed(number) : Promise` Sets the bot's target speed as an integer between -5 and 5. Returns a promise that resolves when the speed is reached, or that is rejected if the target speed is altered before being achieved.
- `bot.getSpeed() : number` Returns the speed.
- `bot.maxSpeed : number` The fastest the bot can travel, in units per tick.
- `bot.acceleration : number` How much the speed changes per tick while moving toward the target speed — needed to judge braking distance.

### Communications

- `bot.send(message)` Broadcasts a message that every other bot in the arena — teammates **and** enemies — can receive via the `RECEIVED` event. `message` can be a primitive (number, string, boolean, null) or a nested array/object of those primitives (functions, class instances, and other non-JSON values cannot be sent). There are no private channels: to coordinate a team, tag your messages with something teammates recognize and validate incoming messages before acting on them. A message that isn't JSON data, is larger than 4,096 characters once encoded, or nests more than 8 levels deep is rejected — `send` throws (code `E023`). A bot may also broadcast at most 50 messages per tick; sends past that budget are silently dropped (code `E024`). See the [error code reference](/error-codes).

## Turret

The turret provides the ability to fire at other bots. The turret is attached to the top of the bot, so its orientation is relative to the bot's orientation.

As the bot turns, the turret will also turn. The position of the turret is relative to the bot, not to the arena — so an aimed turret swings with the body, and if the body turns after you aim you'll need to re-aim (or aim just before firing). An orientation of 0 degrees aligns the turret directly forward. The turret will take time to reload after being fired and methods exist to identify when it is available to fire. Every shot is identical: there is no power, heat, or ammunition mechanic — the constraints are the reload timer and the miss penalty (see [game rules](/rules)).

### Orientation

- `bot.turret.setOrientation(number) : Promise` Sets the turret's target orientation in degrees, relative to the bot's body. Returns a promise that resolves when the orientation is reached, or that is rejected if the target is altered before being achieved.
- `bot.turret.getOrientation() : number` Returns the turret's orientation in degrees, 0 to 359, relative to the bot's body.
- `bot.turret.isTurning() : boolean` Returns if the turret is actively turning.
- `bot.turret.turn(number) : Promise` Turns the turret the provided number of degrees, positive values turn clockwise and negative values counter-clockwise.
- `bot.turret.turnTowards(x, y) : Promise` Turns the turret towards the provided arena coordinates. Returns a promise that resolves when the turn is complete.
- `bot.turret.turnRate : number` How many degrees the turret turns per tick.

### Firing

At the start of every match there is a short **deployment window** (the first 100 ticks, about 10 seconds at default speed) during which the turret is held: `isReady()` returns `false` and `fire()` rejects while the bots deploy. Reloading still progresses, so `onReady()` resolves as soon as the window opens.

- `bot.turret.onReady(): Promise` Returns a promise that resolves when the turret is ready to fire. If the turret fires through another thread while this promise is pending, the promise will be rejected.
- `bot.turret.isReady(): boolean` Returns a boolean indicating whether the turret is ready to fire.
- `bot.turret.fire() : Promise` Fires the turret, returning a promise that resolves with an object. If another bot is hit, the object is of the format `{id:string}` with the identifier for the struck bot. If nothing was hit, the object resolves with `{}` once the bullet leaves the arena — and the shooter loses **3 health** for the missed shot. If the turret is not ready to fire, the Promise is rejected.
- `bot.turret.bulletSpeed : number` How far a bullet travels per tick. Divide a target's distance by this to know the flight time when leading a shot.
- `bot.turret.bulletDamage : number` Health an enemy loses when your bullet hits.

## Radar

The radar provides the ability to detect other bots. Its detection area is a long, narrow wedge reaching **600 units** — one tank-width (32 units) across at your bot, widening to about 244 units across at its tip — and any bot whose center is inside it is detected. It's shown as the beam drawn under the radar in the arena; the drawing is slightly slimmer at its base than the detection area, so anything the beam visibly touches is detected. Vision is directional on purpose: you can see far, but only where you choose to look, so pointing the radar well matters more than being close. The radar is attached to the top of the turret, so its orientation is relative to the turret's orientation. An orientation of 0 points the radar directly aligned to the turret. As the bot or the turret turns, the radar will also turn relative to the arena — the radar looks where the body, turret, and radar angles add up, so a scan that "should" have seen something usually means one of the three has turned since you aimed. The radar will take time to recharge after each scan, and methods exist to identify when it is available to scan. Scanning is not stealthy: every bot your scan detects receives a `DETECTED` event, so sweeping the field announces you to whoever you find.

### Orientation

- `bot.radar.setOrientation(number) : Promise` Sets the radar's target orientation in degrees, relative to the turret. Returns a promise that resolves when the orientation is reached, or that is rejected if the target is altered before being achieved.
- `bot.radar.getOrientation() : number` Returns the radar's orientation in degrees, 0 to 359, relative to the turret.
- `bot.radar.isTurning() : boolean` Returns if the radar is actively turning.
- `bot.radar.turn(number) : Promise` Turns the radar the provided number of degrees, positive values turn clockwise and negative values counter-clockwise.
- `bot.radar.turnTowards(x, y) : Promise` Turns the radar towards the provided arena coordinates. Returns a promise that resolves when the turn is complete.
- `bot.radar.turnRate : number` How many degrees the radar turns per tick.

### Scanning

- `bot.radar.onReady(): Promise` Returns a promise that resolves when the radar is ready to scan. If the radar scans through another thread while this promise is pending, the promise will be rejected.
- `bot.radar.isReady(): boolean` Returns a boolean indicating whether the radar is ready to scan.
- `bot.radar.scan(): Promise<contact[]>` Performs a radar scan, returning a promise that resolves with an array of contacts — one per bot detected, or an empty array if nothing is detected. If the radar is not ready to scan, the Promise is rejected. Each contact carries the raw readings `{ id: string, speed: number, orientation: number, distance: number, angle: number, friendly: boolean, health: number }` plus the convenience methods described under [Contacts](#contacts). Note the two direction fields answer different questions: `angle` is where the detected bot **was** at the moment of the scan — the bearing from you to it, relative to your heading (so `bot.turret.setOrientation(angle)` aims at it) — while `orientation` is which way that bot itself is **facing**, as an absolute compass heading (0 = north); combine `orientation` with `speed` to predict where it is going. The other fields are described under the `SCANNED` event in [Bot events](#bot-events).

### Contacts

Every scan result is a **contact**: a [marker](#arena) pinned at the spot where the detected bot **was at the moment of the scan** — the pin does not follow the bot afterwards. Because a contact is a marker, all the marker methods work on it — `getX()`/`getY()` give that pinned position in arena coordinates (no trigonometry needed), and `getDistance()`/`getBearing()`/`isInBounds()` are measured from wherever **you** are now to the pin: they update as you move, **not** as the target moves. To estimate where a moving target actually is or will be, use `getIntercept(speed)` below (it extrapolates the target's motion for you) or take a fresh scan.

The scan's own readings are available as methods too, so the whole surface is consistent:

- `contact.getId() : string` Unique id of the detected bot.
- `contact.getSpeed() : number` Its speed (-5 to 5).
- `contact.getOrientation() : number` Its body heading — absolute compass, 0 = north (which way **it** is facing, unlike `getBearing()`, which is the direction from you to it).
- `contact.isFriendly() : boolean` Whether it is on your team.
- `contact.getHealth() : number` Its health at the moment of the scan (0–100).
- `contact.getIntercept(speed) : marker | null` Returns a marker at the point where something leaving **your** position at the given speed would meet this bot, assuming it holds its current heading and speed. Pass `bot.turret.bulletSpeed` to lead a shot — `bot.turret.turnTowards(m.getX(), m.getY())` aims it — or pass `bot.maxSpeed` to work out where to drive to cut the bot off. The calculation accounts for any ticks that have passed since the scan. Returns `null` when no interception is possible (for example, the bot is running away faster than the speed you gave).

The raw readings also remain as plain properties — `{ id, speed, orientation, distance, angle, friendly, health }`, exactly as scans have always reported them — plus the frame-independent `x`, `y` (the detected bot's arena coordinates at the moment of the scan) and `time` (the clock tick of the capture). The properties are a snapshot from the moment of the scan (`distance`/`angle` don't update as you move; that's what `getDistance()`/`getBearing()` are for), and they are what makes a contact serializable — they're exactly what `bot.send(contact)` transmits.

**Sharing a contact with teammates.** A contact is serializable, so it can be broadcast directly with `bot.send(contact)`: what's delivered is the plain data properties (methods are not serialized), and the received `angle`/`distance` are relative to the **sender**, not to whoever receives it. The receiver rebuilds the full contact with `arena.createContact(message)`: the result has every contact method measured from the receiver's own position, and `getIntercept` accounts for the ticks elapsed since the sender's scan.

```javascript
// Spotter: broadcast what you see.
bot.on(Event.SCANNED, (contacts) => {
  const enemy = contacts.find((c) => !c.isFriendly());
  if (enemy) bot.send(enemy);
});

// Teammate: rebuild and lead the shot — from your own position.
bot.on(Event.RECEIVED, (message) => {
  if (typeof message?.x !== 'number') return; // not a contact broadcast
  const target = arena.createContact(message);
  const aim = target.getIntercept(bot.turret.bulletSpeed);
  if (aim) bot.turret.turnTowards(aim.getX(), aim.getY());
});
```

```
bot.on(Event.SCANNED, (contacts) => {
  const enemy = contacts.find((c) => !c.isFriendly());
  if (!enemy) return;
  const aim = enemy.getIntercept(bot.turret.bulletSpeed);
  if (aim) bot.turret.turnTowards(aim.getX(), aim.getY());
});
```

# Coding Tips

## Code guard rails

The sandbox is plain JavaScript plus the bot API — nothing else. There is no network access (`fetch`, `XMLHttpRequest`, WebSockets), no module system (`import`/`require`, no npm packages), and no browser or Node globals (`window`, `document`, `process`). Everything a bot can use is on this page: `bot`, `arena`, `clock`, `Event`, `console`, `logger`, the timers, `Math`, and `Promise`.

All app code is executed in a sandbox environment which limits all bots running the same application to use 8 MB of memory. When multiple applications are running in the arena simultaneously, each application will have its own 8 MB of allocated memory. Exceeding this limit will cause all bots running the application to terminate.

Callback functions are limited to 5 seconds of runtime. Long duration activities could be implemented by returning a Promise. Exceeding this limit will cause the bot to terminate.

Synchronous syntax-errors or runtime-errors in the application code will cause the bot to terminate. This can impact the bot as soon as the match begins, or at any point while it is running.

An _unhandled promise rejection_ is treated more leniently. For example, an `await bot.turn(...)` that is cancelled because newer logic changed the target will reject, and if you don't `.catch()` it that rejection escapes your handler — but it is only logged to your bot's log panel, it does not terminate the bot. The same is true of a rejection thrown from inside a timer callback.

Faults are written to your bot's log panel with a short code (like `E017`). See the [error code reference](/error-codes) for what each one means and how to fix it. You can also validate your code before a match with the editor's **Check** button.

## State and the START event

When a bot's code is loaded — when it first starts, and again every time you save a change — it is re-executed to pick up your new handlers. The `START` event fires only on that first start (and again on an arena restart or a reboot), **not** on an ordinary save. Initialize your bot's state in a `START` handler and store it on `this`, which is shared across all of the bot's event handlers (so `TICK`, `HIT`, and the rest can read it). Plain top-level variables are reset every time the code is reloaded.

```
// Reset to its initial value every time the code is (re)loaded.
let resetOnReload = 1

bot.on(Event.START, () => {
  // Local to this single call of the handler.
  let localOnly = 2

  // Stored on `this`, which is shared across all of this bot's handlers.
  this.sharedAcrossHandlers = 3
})

clock.on(Event.TICK, () => {
  // `this.sharedAcrossHandlers` is available here.
})
```

`START` runs when the bot first starts, when the arena restarts, and when you **reboot** — it does **not** re-run on an ordinary save, so editing code won't reset the state you set up there. Set your initial state up in `START` (not lazily in `TICK`) so it's ready before your other handlers run, and reboot (the editor button or `Ctrl-Shift-S`) when you want to re-initialize after an edit.

## Console Logging

The normal `console.log()` and related functions can be used for output messages. These are captured for display in the bot's log panel in the user interface, as well as being formatted and written to the browser console.

```
console.log(`here a useful log message!`)
```

`console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug` are all available.

### Logging values, not just strings

You don't have to format everything into a string yourself. Pass **any mix of arguments** — strings, numbers, booleans, objects, arrays, even an `Error` — and they're each rendered into the message, separated by spaces (just like `console.log` in a browser):

```
console.log('target', target)                 // -> target {"x":120,"y":40,"id":"t3"}
console.log('health', bot.getHealth())         // -> health 75
console.log('scan results', results)           // -> scan results [{"angle":12,...}]
```

Objects and arrays are serialized to JSON, so you can dump whole state objects while debugging. A few details worth knowing:

- **Put a label first.** The log panel shows the message text, so `console.log('state', obj)` reads better than `console.log(obj)` alone.
- **Cycles and functions are safe.** Circular references render as `[Circular]` and functions as `[Function]` — logging something like `this` won't crash your bot.
- **Errors show their stack**, so `try { ... } catch (e) { console.error(e) }` is useful.
- Very long messages are truncated, and output is rate-limited per simulation tick, so a tight logging loop won't flood the panel.

### Log levels

A `logger` instance is also available for outputting messages with the various `debug`, `trace`, `info`, `warn`, and `error` levels (`logger.log` is an alias for `info`). It accepts the same mix of arguments as `console.log`.

```
logger.warn('low health, retreating', bot.getHealth())
logger.error('unexpected scan', results)
```

## JavaScript Timers

Any timers or intervals created in the bot logic will be automatically cleaned up when bots are removed from the arena, or will be paused and resumed with the game. Timers should be created within an event handler, such as `START` shown below, instead of at the root of the application to avoid duplicate timer instances when the app is recompiled and reinitialized.

```
bot.on(Event.START, () => {
  // Turn every 10 ticks (about once a second at default speed)
  this.turnIntervalTimer = setInterval(() =>
    bot.turn(15)
  , 10)
})
```

Timers will operate in "simulated time" instead of real-world time. The interval provided to `setInterval` and `setTimeout` is the number of simulated clock ticks, this is in contrast to the traditional interval value being the number of milliseconds. At the default speed a tick is about 100 ms, so an interval of `10` fires roughly once a second.

A bot may hold at most **64** active timers (`setInterval` and `setTimeout` combined). Registrations past the cap are ignored — the call returns `-1` and the callback never fires (code `E021`, non-fatal).

If a registered `Event.TICK` event handler returns a promise, then although it is called again until the previous promise resolves, this does not impact the function of any active timers. For this reason, it is possible that the number of times the clock ticker handler is called might appear to have a discrepancy when compared to the firing rate of any timers.

## Date.now()

Because the game runs in "simulated time" instead of real-world time, the `Date` class and related methods are not available. The `clock` instance can be used for measuring the current time within the simulation.

# Type definitions

If you prefer to write bots in your own editor, TypeScript definitions for the entire API are published at [`/docs/ts/robocode.d.ts`](/docs/ts/robocode.d.ts). They describe `bot`, `arena`, `clock`, the markers and contacts, and give each `Event` its correctly-typed handler — so a TypeScript-aware editor gives you the same autocomplete, hover docs, and type-checking locally.

Reference them from a bot file with a triple-slash directive:

```
/// <reference path="./robocode.d.ts" />

bot.on(Event.START, () => {
  // `bot`, `arena`, `clock`, and `Event` are all typed here.
})
```
