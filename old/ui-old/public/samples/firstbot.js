/*
   This simple bot AI roams the arena scanning for
   the competition and firing its turret at anything
   it sees. This simple logic is a good introduction
   for getting started on your own bot development.

   Add additional clones of this bot to the arena by
   clicking the [+] button above to the right.
*/

// A simple first task is to set the name of our AI.
bot.setName('My First Bot')

// Define what the bot should do when the match
// first starts. This might includes starting some
// initial movements.
bot.on(Event.START, () => {
  // Physical changes to our bot take time, so these
  // statements start the process of accelerating, turning
  // and prepairing for battle. They each return a JavaScript
  // Promise that could allow us to detect when the action
  // is completed.
  bot.setSpeed(10)
  bot.radar.setOrientation(0)
  bot.turret.setOrientation(0)
})

// This TICK logic is executed at every tick of the game
// clock. It defines behavior that occurs continuously.
clock.on(Event.TICK, async () => {
  // Since the radar takes. time to charge, and the
  // turret time to reload, some of the bot's functions
  // return Promises that allow us to wait until a condition
  // is met before our logic executes.
  let targets = await bot.radar.onReady().then(bot.radar.scan)

  if (targets.length > 0 && !targets[0].friendly) {
    return bot.turret
      .onReady()
      .then(bot.turret.fire)
      .catch(() => {
        // If the scan does not detect anything, or there is
        // any other failure, we'll just turn the bot and continue.
        bot.turn(10)
        bot.setSpeed(10)
      })
  }
})

// The COLLIDED event is triggered if our bot comes into contact
// with another bot or the arena edges. In that situation, we set
// some logic to avoid the obstacle and accelerate.
bot.on(Event.COLLIDED, () => {
  bot.turn(40).then(() => bot.setSpeed(10))
})
