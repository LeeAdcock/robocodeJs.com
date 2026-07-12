# Bot Development

Each bot's logic is defined in JavaScript that is initialized at the beginning of a match to provide initial commands and register event handlers. Saving your code reloads it live — your event handlers are replaced immediately — but it does **not** re-run the `START` handler, so a running bot keeps the state it set up. Use the editor's **reboot** button (or `Ctrl-Shift-S`) to reload your code and re-run `START` when you want a fresh initialization.

The in-browser code editor offers **autocomplete** for the whole bot API: type `bot.`, `arena.`, `clock.`, or `Event.` to see the available members, each with its signature and a short description.

See also the [game rules & physics](/rules) for exact speeds, turn rates, reload times, and damage values, and — if you've used the classic Java Robocode — [Coming from classic Robocode](/classic). Brand new to coding? Try the [Learn course](/learn). For writing bots a human (or an AI) can read and adjust quickly, see [Writing readable bot code](/code-style).

- [Arena](#arena)
- [Clock](#clock)
- [Bot events](#bot-events)
- [Bot movement](#movement)
- [Bot turret](#turret)
- [Bot radar](#radar)
- [Type definitions](#type-definitions)

# Arena

The arena where bots live is a square. Headings are specified in degrees on a compass, with 0 degrees being north, 90 east, 180 south, and 270 west, increasing clockwise. Bearings reported to you (scan/hit/collision angles and `marker.getBearing()`) are relative to your own heading. Terrain and other arena elements do not affect gameplay. See [game rules & physics](/rules) for the full compass diagram.

- `arena.getWidth() : number`
- `arena.getHeight() : number`

Virtual markers can be created in the arena that provide simplified calculations for angles and distance. These markers are either dropped at the current bot location, or at a specified coordinate.

- `arena.createMarker(x, y) : marker`

The `marker` object returned has several convenience methods:

- `marker.getX() : number`
- `marker.getY() : number`
- `marker.getDistance() : number`
- `marker.getBearing() : number`

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

You can access the current "simulation time" using the 'clock' object. Registering a handler for clock ticks enables providing logic that executes at a set frequency. For logic that executes on different frequencies, details on the JavaScript timers are below. A click tick is the smallest increment of time within the simulation.

- `clock.getTime() : number` Number of clock ticks in the current game
- `clock.on(Event.TICK, () => {} )`

# Bot

The `bot` object provides the programmatic ability to control the various capabilities of the bot. This includes navigation, radar, fire control, and communications. Methods allow triggering behaviors on the bot, while callbacks enable reacting to events that occur on the bot.

A few basic methods exist for setting and retrieving information about the bot.

- `bot.setName(string)` Sets the bot's display name.
- `bot.getId() : string` Returns a unique identifier (a UUID string).
- `bot.getHealth() : number` Returns the bot's health from 100 (full) down to 0 (unfortunately dead).
- `bot.dropMarker() : marker` Returns a marker object for the bot's current location.

## Bot events

- `bot.on(Event.FIRED, () => {}))` Registers a callback that is executed when the turret is fired.
- `bot.on(Event.SCANNED, (object[]) => {})` Registers a callback that is executed when the radar performs a scan, the handler is provided an array of objects representing each bot detection by the scan. The objects are of the format `{ id: string, speed: number, orientation: number, distance: number, angle: number, friendly: boolean, health: number }`. The `angle` is a bearing relative to your heading (so `bot.turret.setOrientation(angle)` aims at it); `orientation` is the detected bot's own absolute heading; `health` is the detected bot's current health (0–100).
- `bot.on(Event.COLLIDED, () => {object})` Registers a callback that is executed when the bot collides with the edge of the arena, or with another bot. Bots will stop with a speed of zero after a collision. An object is provided to the handler that is of the format `{angle:number, friendly:boolean}` specifying the direction of the collided object or arena edge; the angle is relative to your heading (a wall ahead is 0). Be careful returning a Promise from the `COLLIDED` event handler which may itself cause a collision. The handler will not be called for the second collision while the first Promise has not yet finished.

## Environment events

- `bot.on(Event.HIT, (object) => {})` Registers a callback that is executed when the bot is hit. An object is provided to the handler that is of the format `{angle:number}`, where the angle is the bearing the shot came from, relative to your heading.
- `bot.on(Event.DETECTED, () => {})` Registers a callback that is executed when the bot is detected by another bot's radar.
- `bot.on(Event.START, () => {})` Registers a callback that is executed when the bot is being started at the beginning of a match.

## Communications events

- `bot.on(Event.RECEIVED, (message, from) => {})` Registers a callback that is executed when another bot broadcasts a message (via `bot.send`). This fires for messages from **any** bot in the arena, including enemies. `message` is the payload sent — a primitive (number, string, boolean, or null) or a nested array/object of primitives. `from` is `{ distance: number }`: how far away the sender was when it broadcast (a range, not a bearing — the same value is given to teammates and eavesdropping enemies).

## Movement

The bot can turn left or right, and move straight ahead at a desired speed. The turn rate is limited, so a measurable amount of time will pass between setting the desired orientation and the bot achieving that orientation. Similarly there is a limited acceleration and deceleration. Methods that set these values will return a Promise object that is resolved when the desired value is reached. If other logic changes the desired value before it is reached, the Promise will be rejected - optionally these rejections can be caught and handled. Leaving such a rejection unhandled is safe: it is logged to your bot's log panel but does **not** stop the bot, so you only need to `.catch()` them when you want to react to the cancellation (or to keep your logs quiet).

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
- `bot.getY() : number` Returns the current y-axis position. the top is 0.

### Orientation

- `bot.setOrientation(number) : Promise` Sets the bot's target orientation in degrees. Returns a promise that resolves when the orientation is reached, or that is rejected if the target orientation is altered before being achieved.
- `bot.getOrientation() : number` Returns the orientation in degrees, 0 to 359.
- `bot.isTurning() : boolean` Returns if the bot is actively turning.
- `bot.turn(number) : Promise` Turns the bot the provided number of degrees, positive values turn clockwise and negative values counter-clockwise.
- `bot.turnTowards(x, y) : Promise` Turns the bot towards the provided coordinates. Returns a promise that resolves when the turn is complete.

### Speed

- `bot.setSpeed(number) : Promise` Sets the bot's target speed as an integer between -5 and 5. Returns a promise that resolves when the speed is reached, or that is rejected if the target speed is altered before being achieved.
- `bot.getSpeed() : number` Returns the speed.

### Communications

- `bot.send(message)` Broadcasts a message that every other bot in the arena — teammates **and** enemies — can receive via the `RECEIVED` event. `message` can be a primitive (number, string, boolean, null) or a nested array/object of those primitives (functions, class instances, and other non-JSON values cannot be sent). There are no private channels: to coordinate a team, tag your messages with something teammates recognize and validate incoming messages before acting on them.

## Turret

The turret provides the ability to fire at other bots. The turret is attached to the top of the bot, so its orientation is relative to the bot's orientation.

As the bot turns, the turret will also turn. The position of the turret is relative to the bot, not to the arena. An orientation of 0 degrees aligns the turret directly forward. The turret will take time to reload after being fired and methods exist to identify when it is available to fire.

### Orientation

- `bot.turret.setOrientation(number) : Promise`
- `bot.turret.getOrientation() : number`
- `bot.turret.isTurning() : boolean`
- `bot.turret.turn(number)`
- `bot.turret.turnTowards(x, y) : Promise`

### Firing

- `bot.turret.onReady(): Promise` Returns a promise that resolves when the turret is ready to fire. If the turret fires through another thread while this promise is pending, the promise will be rejected.
- `bot.turret.isReady(): boolean` Returns a boolean indicating whether the turret is ready to fire.
- `bot.turret.fire() : Promise` Fires the turret, returning a promise that resolves with an object. If another bot is hit, the object is of the format `{id:number}` with the identifier for the struck bot. If nothing was hit, the object resolves with `{}` once the bullet leaves the arena — and the shooter loses **3 health** for the missed shot. If the turret is not ready to fire, the Promise is rejected.

## Radar

The radar provides the ability to detect other nearby bots. Only nearby bots in the direction the radar is pointed will be detectable. The radar is attached to the top of the turret, so its orientation is relative to the turret's orientation. An orientation of 0 points the radar directly aligned to the turret. As the bot or the turret turns, the radar will also turn relative to the arena. The radar will take time to recharge after each scan, and methods exist to identify when it is available to scan.

### Orientation

- `bot.radar.setOrientation(number) : Promise`
- `bot.radar.getOrientation() : number`
- `bot.radar.isTurning() : boolean`
- `bot.radar.turn(number)`
- `bot.radar.turnTowards(x, y) : Promise`

### Scanning

- `bot.radar.onReady(): Promise` Returns a promise that resolves when the radar is ready to scan. If the radar scans through another thread while this promise is pending, the promise will be rejected.
- `bot.radar.isReady(): boolean` Returns a boolean indicating whether the radar is ready to scan.
- `bot.radar.scan(): Promise<object[]>` Performs a radar scan, returning a promise that resolves with an array of objects with details on each bot that is detected, or an empty array if nothing is detected. If the radar is not ready to scan, the Promise is rejected. The resolved objects are of the format `{ id: string, speed: number, orientation: number, distance: number, angle: number, friendly: boolean, health: number }`

# Coding Tips

## Code guard rails

All app code is executed in a sandbox environment which limits all bots running the same application to use 8 MB of memory. When multiple applications are running in the arena simultaneously, each application will have its own 8 MB of allocated memory. Exceeding this limit will cause all bots running the application to terminate.

Callback functions are limited to 5 seconds of runtime. Long duration activities could be implemented by returning a Promise. Exceeding this limit will cause the bot to terminate.

Synchronous syntax-errors or runtime-errors in the application code will cause the bot to terminate. This can impact the bot as soon as the match begins, or at any point while it is running.

An _unhandled promise rejection_ is treated more leniently. For example, an `await bot.turn(...)` that is cancelled because newer logic changed the target will reject, and if you don't `.catch()` it that rejection escapes your handler — but it is only logged to your bot's log panel, it does not terminate the bot. The same is true of a rejection thrown from inside a timer callback.

Faults are written to your bot's log panel with a short code (like `E017`). See the [error code reference](/error-codes) for what each one means and how to fix it. You can also validate your code before a match with the editor's **Check** button.

## State and the START event

When a bot's code is loaded — when it first starts, and again every time you save a change — it is re-executed to pick up your new handlers, and the `START` event fires so your setup code runs again. Initialize your bot's state in a `START` handler and store it on `this`, which is shared across all of the bot's event handlers (so `TICK`, `HIT`, and the rest can read it). Plain top-level variables are reset every time the code is reloaded.

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
console.log('health', bot.getHealth())         // -> health 0.75
console.log('scan results', results)           // -> scan results [{"angle":12,...}]
```

Objects and arrays are serialized to JSON, so you can dump whole state objects while debugging. A few details worth knowing:

- **Put a label first.** The log panel shows the message text, so `console.log('state', obj)` reads better than `console.log(obj)` alone.
- **Cycles and functions are safe.** Circular references render as `[Circular]` and functions as `[Function]` — logging something like `this` won't crash your bot.
- **Errors show their stack**, so `try { ... } catch (e) { console.error(e) }` is useful.
- Very long messages are truncated, and output is rate-limited per simulation tick, so a tight logging loop won't flood the panel.

### Log levels

A `logger` instance is also available for outputting messages with the various `debug`, `trace`, `info`, `warn`, and `error` levels. It accepts the same mix of arguments as `console.log`.

```
logger.warn('low health, retreating', bot.getHealth())
logger.error('unexpected scan', results)
```

## JavaScript Timers

Any timers or intervals created in the bot logic will be automatically cleaned up when bots are removed from the arena, or will be paused and resumed with the game. Timers should be created within an event handler, such as `START` shown below, instead of at the root of the application to avoid duplicate timer instances when the app is recompiled and reinitialized.

```
bot.on(Event.START, () => {
  // Turn every second
  this.turnIntervalTimer = setInterval(() =>
    bot.turn(15)
  , 1000)
})
```

Timers will operate in "simulated time" instead of real-world time. The interval provided to `setInterval` and `setTimeout` is the number of simulated clock ticks, this is in contrast to the traditional interval value being the number of milliseconds.

If a registered `Event.TICK` event handler returns a promise, then although it is called again until the previous promise resolves, this does not impact the function of any active timers. For this reason, it is possible that the number of times the clock ticker handler is called might appear to have a discrepancy when compared to the firing rate of any timers.

## Date.now()

Because the game runs in "simulated time" instead of real-world time, the `Date` class and related methods are not available. The `clock` instance can be used for measuring the current time within the simulation.

# Type definitions

If you prefer to write bots in your own editor, TypeScript definitions for the entire API are published at [`/ts/robocode.d.ts`](/ts/robocode.d.ts). They describe `bot`, `arena`, `clock`, the markers and scan results, and give each `Event` its correctly-typed handler — so a TypeScript-aware editor gives you the same autocomplete, hover docs, and type-checking locally.

Reference them from a bot file with a triple-slash directive:

```
/// <reference path="./robocode.d.ts" />

bot.on(Event.START, () => {
  // `bot`, `arena`, `clock`, and `Event` are all typed here.
})
```
