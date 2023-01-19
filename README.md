# Welcome

Welcome to RobocodeJs, a browser-based programming game. Create Javascript bots that compete for fame and glory! Brainstorm your own winning strategy, program your bot, and set it loose in the arena in teams to defeat your competition.

The battle arena is a rectangular space filled with bots working in teams. Each app you program commands each member of the team. Search and destroy your enemies before they can find you and eliminate you from the game. You'll have the use of your bot's radar and a turret mounted canon. Collisions with the arena edges and with other bots will also inflict a small amount of damage.

Continue to develop your application code and they will immediately adapt to the changes you make. Quickly reset the match and start a new game, or add or remove bots as you try out different iterations on your strategy.

# Examples Bots

Here are some simple bot applications that demonstrate concepts you may wish to integrate what you build.

- [Lighthouse](https://github.com/LeeAdcock/robocodeJs.com/blob/master/public/samples/lighthouse.js) A stationary bot that turns as it scans for others, then adjusting its turret for maximum accuracy before firing.
- [Magnetic](https://github.com/LeeAdcock/robocodeJs.com/blob/master/public/samples/magnetic.js) Demonstrating advanced multi-bot communication, these bots use secure communication to share their location and cluster together.
- [Pathfinder](https://github.com/LeeAdcock/robocodeJs.com/blob/master/public/samples/pathfinder.js) With a predefined set of waypoints, this bot navigates continuously around the arena.
- [Spirograph](https://github.com/LeeAdcock/robocodeJs.com/blob/master/public/samples/spirograph.js) This bot makes slow looping turns through the arena, scanning straight ahead and firing if it detects something.
- [Stately](https://github.com/LeeAdcock/robocodeJs.com/blob/master/public/samples/stately.js) Using a simple state machine, this bot shifts between different modes of operation.
- [Chronometer](https://github.com/LeeAdcock/robocodeJs.com/blob/master/public/samples/chronometer.js) This bot demonstrates the use of one-shot timers and scheduled interval timers.
- [ReturnFire](https://github.com/LeeAdcock/robocodeJs.com/blob/master/public/samples/returnfire.js) Although stationary, this bot quickly turns to face any enemy bots who collide or hit it, then returns fire.

# Bot Development

Each bot's logic is defined in JavaScript that is initialized at the beginning of a match to provide initial control commands and register event handlers. The logic is reinitialized every time you save your code.

## Arena

The arena where bots live is rectangular in shape with. The orientation of objects within the arena is specified in degrees, with 0 degrees being south and 90 degrees being west. Terrain and other arena elements do not affect gameplay.

- `arena.getWidth() : number`
- `arena.getHeight() : number`

## Events

Most of your bot application code will be defined as functions you create that are executed when events take place in your bot's environment. These functions, which are registered on the bot as event handlers, enable you to define how your bot reacts and adapts. Each time you set an event handler with the `on` function, it will overwrite any previously defined handler for that event type.

```
bot.on(Event.DETECTED, () => {
  // event has occurred and logic should be executed
})
```

If an event handler returns nothing, it will be called each time the event occurs. This can at times result in unintended side effects if multiple events happen in quick succession and the handler is executing multiple times in parallel. To account for this, if the registered event handler returns a Promise, that Promise must resolve before the event handler will be called again for the same event type. Events can return Promises as demonstrated below with a traditional `return` statement, the abbreviated arrow syntax, or through using `async...await`.

```
clock.on(Event.TICK, () => {
  return
    bot.radar.onReady()
    .then(() => bot.radar.scan())
    .then(() => bot.setSpeed(0))
    .then(() => bot.turret.onReady())
    .then(() => bot.turret.fire(10))
    .catch(() =>  bot.setSpeed(10))
})
```

```
bot.on(Event.COLLIDED, bot.turn(110).then(() => bot.setSpeed(10)))
```

```
clock.on(Event.TICK, async () => {
  await bot.radar.onReady()
  await bot.radar.scan()
    .then(() => bot.turret.onReady())
    .then(() => bot.turret.fire(10))
})
```

## Clock

You can access the current "simulation time" using the 'clock' object. Registering a handler for clock ticks enables providing logic that executes at a set frequency. For logic that executes on different frequencies, details on the JavaScript timers are below. A click tick is the smallest increment of time within the simulation.

- `clock.getTime() : number` Number of clock ticks in the current game
- `clock.on(Event.TICK, () => {} )`

## Bot

The `bot` object provides the programmatic ability to control the various capabilities of the bot.  This includes navigation, radar, fire control, and communications. Methods allow triggering behaviors on the bot, while callbacks enable reacting to events that occur on the bot.

A few basic methods exist for setting and retrieving information about the bot.

- `bot.setName(string)` Sets the bot's display name.
- `bot.getId() : number` Returns a unique non-zero numeric identifier.
- `bot.getHealth() : number` Returns a decimal value representing the bot's health, with 1 being healthy and 0 being unfortunately dead.

### Bot events
- `bot.on(Event.FIRED, () => {}))` Registers a callback that is executed when the turret is fired.
- `bot.on(Event.SCANNED, (object[]) => {})` Registers a callback that is executed when the radar performs a scan, the handler is provided an array of objects representing each tank detection by the scan. The objects are of the format `{ id : number, speed: number, angle: number, distance: number, orientation: number }`.
- `bot.on(Event.COLLIDED, () => {object})` Registers a callback that is executed when the bot collides with the edge of the arena, or with another bot. Bots will stop with a speed of zero after a collision. An object is provided to the handler that is of the format `{angle:number, friendly:boolean}` specifying the direction of the collided object or arena edge; the angle is relative to the arena (0 degrees is south). Be careful returning a Promise from the `COLLIDED` event handler which may itself cause a collision. The handler will not be called for the second collision while the first Promise has not yet finished.

### Environment events
- `bot.on(Event.HIT, (object) => {})` Registers a callback that is executed when the bot is hit. An object is provided to the handler that is of the format `{angle:number}`, where the angle is relative to the arena.
- `bot.on(Event.DETECTED, () => {})` Registers a callback that is executed when the bot is detected by another bot's radar.
- `bot.on(Event.START, () => {})` Registers a callback that is executed when the bot is being started at the beginning of a match.

### Communications events
- `bot.on(Event.RECEIVED, (number) = {})` Registers a callback that is executed when an incoming numeric message is received from another bot.

### Movement

The bot can turn left or right, and move straight ahead at a desired speed. The turn rate is limited, so a measurable amount of time will pass between setting the desired orientation and the bot achieving that orientation. Similarly there is a limited acceleration and deceleration. Methods that set these values will return a Promise object that is resolved when the desired value is reached. If other logic changes the desired value before it is reached, the Promise will be rejected - optionally these rejections can be caught and handled.

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

#### Position
- `bot.getX() : number` Returns the current x-axis position. The left is 0.
- `bot.getY() : number` Returns the current y-axis position. the top is 0.

#### Orientation
- `bot.setOrientation(number) : Promise` Sets the bot's target orientation in degrees. Returns a promise that resolves when the orientation is reached, or that is rejected if the target orientation is altered before being achieved.
- `bot.getOrientation() : number` Returns the orientation in degrees, 0 to 360.
- `bot.isTurning() : boolean` Returns if the bot is actively turning.
- `bot.turn(number)` Turns the bot the provided number of degrees, positive values turn clockwise and negative values counter-clockwise.

#### Speed
- `bot.setSpeed(number) : Promise` Sets the bot's target speed as an integer between -5 and 5. Returns a promise that resolves when the speed is reached, or that is rejected if the target speed is altered before being achieved.
- `bot.getSpeed() : number` Returns the speed.

#### Communications
- `bot.send(number)` Broadcasts a numeric value that other bots can receive via an event handler.

### Turret

The turret provides the ability to fire at other bots. The turret is attached to the top of the bot, so its orientation is relative to the bot's orientation.

As the bot turns, the turret will also turn. The position of the turret is relative to the bot, not to the arena. An orientation of 0 degrees aligns the turret directly forward. The turret will take time to reload after being fired and methods exist to identify when it is available to fire.

#### Orientation
- `bot.turret.setOrientation(number) : Promise`
- `bot.turret.getOrientation() : Promise`
- `bot.turret.isTurning() : boolean`
- `bot.turret.turn(number)`

#### Firing
- `bot.turret.onReady(): Promise` Returns a promise that resolves when the turret is ready to fire. If the turret fires through another thread while this promise is pending, the promise will be rejected.
- `bot.turret.isReady(): boolean` Returns a boolean indicating whether the turret is ready to fire.
- `bot.turret.fire() : Promise` Fires the turret, returning a promise that resolves with an object. If another bot is hit, the object is of the format `{id:number}` with the identifier for the struck bot. If nothing was hit, the object resolves with `{}` once the bullet leaves the arena. If the turret is not ready to fire, the Promise is rejected.

### Radar

The radar provides the ability to detect other nearby bots. Only nearby bots in the direction the radar is pointed will be detectable. The radar is attached to the top of the turret, so its orientation is relative to the turret's orientation. An orientation of 0 points the radar directly aligned to the turret. As the bot or the turret turns, the radar will also turn relative to the arena. The radar will take time to recharge after each scan, and methods exist to identify when it is available to scan.

#### Orientation
- `bot.radar.setOrientation(number) : Promise`
- `bot.radar.getOrientation() : Promise`
- `bot.radar.isTurning() : boolean`
- `bot.radar.turn(number)`

#### Scanning
- `bot.radar.onReady(): Promise` Returns a promise that resolves when the radar is ready to scan. If the radar scans through another thread while this promise is pending, the promise will be rejected.
- `bot.radar.isReady(): boolean` Returns a boolean indicating whether the radar is ready to scan.
- `bot.radar.scan(): Promise<object[]>` Performs a radar scan, returning a promise that resolves with an array of objects with details on each bot that is detected, or an empty array if nothing is detected. If the radar is not ready to scan, the Promise is rejected. The resolved objects are of the format `{ id : number, speed: number, orientation: number, friendly: boolean }`

## Coding Tips

### Code guard rails

All app code is executed in a sandbox environment which limits all bots running the same application to use 8 MB of memory. When multiple applications are running in the arena simultaniously, each application will have its own 5 MB of allocated memory. Exceeding this limit will cause all bots running the application to terminate.

Callback functions are limited to 5 seconds of runtime. Long duration activities could be implemented by returning a Promise. Exceeding this limit will cause the bot to terminate. 

Syntax-errors or runtime-errors in the application code will caue the bot to terminate.

### Persisted variables

When a bot's logic code is changed, it is reexecuted to load new event handlers and behavior logic.  This can have the unintended side-effect of resetting any globally defined variables. It is recommended to store values as properties on `this` if you need to ensure they are available for the bot's full lifecycle. The `this` object will be stored durably across executions and available to all event handlers.

```
// This will be reset to the initial value each time the code
// is recompiled and executed.
let thisWillBeResetOnRecompile = 1

bot.on(Event.START, () => {
  // This is only available within this run of the function
  let thisWillOnlyBeAvailableInThisFunction = 2

  // This can be accessed anywhere and is stored durably.
  this.myImportantVariableAvailableEverywhere = 3
})
```

### Console Logging

The normal `console.log()` and related functions can be used for output messages. These will automatically be captured for display in the user interface, as well as being formatted and written to the browser console.

```
console.log(`here a useful log message!`)
```

A logger instance is also available for outputting messages with the various debug, trace, info, error, and warn levels.

```
logger.warn(`here a useful log message!`)
```

### JavaScript Timers

Any timers or intervals created in the bot logic will be automatically cleaned up when bots are removed from the arena, or will be paused and resumed with the game.  Timers should be created within an event handler, such as `START` shown below, instead of at the root of the application to avoid duplicate timer instances when the app is recompiled and reinitialized.

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

### Date.now()

Because the game runs in "simulated time" instead of real-world time, the `Date` class and related methods are not available. The `clock` instance can be used for measuring the current time within the simulation.

