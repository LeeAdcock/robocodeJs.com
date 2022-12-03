# Battlebots

Welcome to Battlebots, [a browser-based programming game](https://battletank.io) for creating Javascript artificial intellegence that enables your bots compete for fame and glory! Brainstorm your own winning strategy, program your bot, and set it lose in the arena in teams of one or more to defeat your competition.

The battle arena is is rectangular space filled with other bots working alone or in teams. Search and destroy them before they can find you and eliminate you from the game. You'll have the use of your bot's radar and a turret mounted canon. Collisions with the arena edges and with other bots will also inflict a small amount of damage - so ramming others is an option.

For each app you create, you'll add bots to the arena that are running your code. Continue to develop your application code as the bots run and they will immediatly adapt their behavior. Quickly reset the match and start a new game, or add or remove bots as you try out different iterations on your strategy.

![Battlebots Screenshot](https://github.com/LeeAdcock/battletank.io/raw/master/ui/public/screenshot.png)

# Examples Bots

Here are some simple bot applications that demonstrate concepts you may wish to integrate what you build.

- [Lighthouse](https://github.com/LeeAdcock/battletank.io/blob/master/public/samples/lighthouse.js) A stationary bot that turns as it scans for others, then adjusting its turret for maximum accuracy before firing.
- [Magnetic](https://github.com/LeeAdcock/battletank.io/blob/master/public/samples/magnetic.js) Demonstrating advanced multi-bot communication, these bots us secure communication to share their location and cluster together.
- [Pathfinder](https://github.com/LeeAdcock/battletank.io/blob/master/public/samples/pathfinder.js) With a predefined set of waypoints, this bot navigates continuously around the arena.
- [Spirograph](https://github.com/LeeAdcock/battletank.io/blob/master/public/samples/spirograph.js) This bot makes slow looping turns through the arena, scanning straight ahead and firing if it detects something.
- [Stately](https://github.com/LeeAdcock/battletank.io/blob/master/public/samples/stately.js) Using a simple state machin, this bot shifts between different modes of operation.
- [Chronometer](https://github.com/LeeAdcock/battletank.io/blob/master/public/samples/chronometer.js) This bot demonstrates the use of one-shot timers and scheduled interval timers.
- [ReturnFire](https://github.com/LeeAdcock/battletank.io/blob/master/public/samples/returnfire.js) Although stationary, this bot quickly turns to face any enemy bots who collide or hit it, then returns fire.

# Bot Development

Each bot's logic is defined in JavaScript that is initialized at the beginning of a match to provide initial control commands and register event handlers.

## Arena

The arena where bots live is rectangular in shape with a dynamic size. The orientation of objects within the arena is specified in degrees, with 0 degrees being south and 90 degrees being west. Terrain and other arena elements to not effect gameplay.

- `arena.getWidth() : number`
- `arena.getHeight() : number`

## Events

Most of your bot application code will be defined as functions you create that are called when events take place in your bot's environment. These functions, which are registered on the bot as event handlers, enable you to define how your bot reacts and adapts. Each time you set an event handler with the `on` function, it will overwrite any previously defined handler for that event type.

```
bot.on(Event.DETECTED, () => {
  // event has occured and logic should be executed
})
```

If an event handler returns nothing, it will be called each time the event occurs. This can at times result in unintended side effects if multiple events happen in quick succession and the handler is executing multiple times in parallel. To account for this, if the registered event handler returns a Promise, that Promise must resolve before the event handler will be called again for the same event type. Events can return Promises as demonstrated below with a tradition `return` statement, the abbreviated arrow syntax, or through using `async...await`.

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

You can access the current "simulation time" using the 'clock' object. Registering a handler for clock ticks enables providing logic that executes at a set frequency. For logic that executes on different frequencies, details on the JavaScript timers is below. A click tick is the smallest increment of time within the simulation.

- `clock.getTime() : number` Number of clock ticks in the current game
- `clock.on(Event.TICK, () => {} )`

## Bot

The `bot` object provides the programmatic ability to control the various capabilies of bot.  This includes navigation, radar, fire control, and communications. Methods allow triggering behaviors on the bot, while callbacks enable reacting to events that occur on the bot.

A few basic methods exist for setting and retrieving information about the bot.

- `bot.setName(string)` Sets the bot's display name.
- `bot.getId() : number` Returns a unique non-zero numeric identifier.
- `bot.getHealth() : number` Returns a decimal value representing the bot's health, with 1 being healthy and 0 being unfortunately dead.

### Bot events
- `bot.on(Event.FIRED, () => {}))` Registers a callback that is executed when the turret is fired.
- `bot.on(Event.SCANNED, (object[]) => {})` Registers a callback that is executed when the radar performs a scan, the handler is provided an array of objects representing each tank detection by the scan. The objects are of the format `{ id : number, speed: number, angle: number, distance: number, orientation: number }`.
- `bot.on(Event.COLLIDED, () => {object})` Registers a callback that is executed when the bot collides with the edge of the arena, or with another bot. Bots will stop with a speed of zero after a collision. An object is provided to the handler that is of the format `{angle:number, friendly:boolean}` specifying the direction of the collided object or arena edge; the angle is relative to the arena (0 degress is south). Be careful returning a Promise from the `COLLIDED` event handler which may itself cause a collision. The handler will not be called for the second collision while the first Promise is has not yet finished.

### Environment events
- `bot.on(Event.HIT, (object) => {})` Registers a callback that is executed when the bot is hit. An object is provided to the handler that is of the format `{angle:number}`, where the angle is relative to the arena.
- `bot.on(Event.DETECTED, () => {})` Registers a callback that is executed when the bot is detected by another bot's radar.
- `bot.on(Event.START, () => {})` Registers a callback that is executed when the bot is being started at the beginning of a match.

### Communications events
- `bot.on(Event.RECEIVED, (number) = {})` Registers a callback that is executed when an incoming numeric message is received from another bot.

### Movement

The bot can turn left or right, and move straight ahead at a desired speed. The turn rate is limited, so a measurable amount of time will pass between setting the desired orientation and the bot acheiving that orientation. Similary there is a limited accelerationa and deceleration. Methods that set these values will return a Promise object that is resolved when the desired value is reached. If other logic changes the desired value before it is reached, the Promise will be rejected - optionally these rejections can be caught and handled.

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

As the bot turns, the turret will also turn. An orientation of 0 degrees aligns the turret directly forward. The turret will take time to reload after being fired, and methods exist to identify when it is available to fire.

#### Orientation
- `bot.turret.setOrientation(number) : Promise`
- `bot.turret.getOrientation() : Promise`
- `bot.turret.isTurning() : boolean`
- `bot.turret.turn(number)`

#### Firing
- `bot.turret.onReady(): Promise` Returns a promise that resolves when the turret is ready to fire. If the turret fires through another thread while this promise is pending, the promise will be rejected.
- `bot.turret.isReady(): boolean` Returns a boolean indicating whether the turret is ready to fire.
- `bot.turret.fire() : Promise` Fires the turret, returning a promise that resolves with an object. If another bot is hit, the object is of the format `{id:number}` with the identifier for the struck bot. If nothing was hit, the object resolved with `{}` once the bullet leaves the arena. If the turret is not ready to fire, the Promise is rejected.

### Radar

The radar provides the ability to detect other nearby bots. Only nearby bots in the direction the radar is pointed will be detectable. The radar is attached to the top of the turret, so its orientation is relative to the turret's orientation. As the bot or the turret turns, the radar will also turn. An orientation of 0 degrees aligns the radar with the turret. The radar will take time to recharge after each scan, and methods exist to identify when it is available to scan.

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

### Persisted variables

When a bot's logic code is changed, it is reexecuted to load new event handlers and behavior logic.  This can have the unintended side-effect of resetting any globally defined variables. It is recommended to store values as properties on `this` if you need  ensure they are available for the bot's full lifecycle.

```
// This will be reset to the initial value each time the code
// is recompiled and executed.
let thisWillBeResetOnRecompile = 1

bot.on(Event.START, () => {
  // This is only available within this run of the function
  let thisWillOnlyBeAvailableInThisFunction = 2

  // This can be access anywhere and is stored durably.
  this.myImportantVariableAvailableEverywhere = 3
})
```

### Console Logging

The normal `console.log()` and related functions can be used for ouput messages. These will automatically be captured for display in the user interface, as well as being formatted and written to the brower console.

```
console.log(`here a useful log message!`)
```

A logger instance is also available for outputting messages with the various debug, trace, info, error, and warn levels.

```
logger.warn(`here a useful log message!`)
```

### JavaScript Timers

Any timers or intervals created in the Bot logic will be automatically cleaned up when bots are removed from the arena, or will be paused and resumed with the game.  Timers should be created within an event handler, such as `START` shown below, instead of at the root of the application to avoid duplicate timer instances when the app is recompiled and reinitialized.

```
bot.on(Event.START, () => {
  // Turn every second
  this.turnIntervalTimer = setInterval(() =>
    bot.turn(15)
  , 1000)
})
```

Timers will operate in "simulated time" instead of real-world time. The interval provided to `setInterval` and `setTimeout` is the number of simulated clock ticks, this is in contrast to the traditional interval value being the number of milliseconds.

If a registered `Event.TICK` event handler returns a promise, than although it is called again until the previous promise resolves, this does not impact the function of any active timers. For this reason, it is possible than the number of times the clock ticker handler is called might appear to have a discrepency when compared to the firing rate of any timers.

### Date.now()

Because the game runs in "simulated time" intead of real-world time, the `Date` class and related methods are not available. The `clock` instance can be used for measuring the current time within the simulation.

# Command Line

Bot battles can be run head-less from the command line. This enables faster battles and automated battle configuration. Up to nine individual bot .js files can be provided through the command line.

```
battlebots -c [number] -m [mode] -f [filepath1] -f [filepath2]

Options:
      --help           Show help                                       [boolean]
      --version        Show version number                             [boolean]
  -b, --botCount       number of bots for each app         [number] [default: 5]
  -m, --mode           conditions for game completion
        [string] [choices: "laststanding", "knockout"] [default: "laststanding"]
  -w, --arenaWidth     arena width                       [number] [default: 750]
  -h, --arenaHeight    arena height                      [number] [default: 750]
  -f, --file           path to bot js file                    [array] [required]
  -b, --battleCount    number of battles                   [number] [default: 1]
  -a, --appsInArena    number of apps in the arena at one time
                                                       [number] [default: "all"]
  -s, --slowDeathTime  number of clock ticks before slow death begins
                                                     [number] [default: "10000"]
```

# Application Development

## Web Application

### Setup

`git clone https://github.com/LeeAdcock/battletank.io`

First build the `lib` component as described below.

In the `ui` folder run:

`npm run install` - Install dependencies to your local environmnt.

### Development

In the `ui` folder run:

`npm run dev` - Run application at `http://localhost:8080/Lee/battlebots` with automatic rebuilding on file change.

`npm run build` - Build the simulation library.

`npm run lint` - Code cleanup and linting.

### Deploying

TBD

## Simulation Library

### Setup

`git clone https://github.com/LeeAdcock/battletank.io`

In the `lib` folder run:

`npm run install` - Install dependencies to your local environmnt.

`npm run build` - Build the simulation library.

### Development

In the `lib` folder run:

`npm run build` - Build the simulation library.

`npm run lint` - Code cleanup and linting.

## Command Line Interface

### Setup

`git clone https://github.com/LeeAdcock/battletank.io`

First build the `lib` component as described above.

In the `cli` folder run:

`npm run install` - Install dependencies to your local environmnt.

### Development

In the `cli` folder run:

`npm run build` - Compile and package command line interface.

`npm run lint` - Code cleanup and linting.

### Running

`battlebots` - Run the command line interface providing the required parameters.
`battlebots --help` - Output the command line interface usage instructions.
