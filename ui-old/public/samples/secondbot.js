/*
   This more complex bot AI roams the arena scanning for
   the competition and firing its turret at anything
   it sees. A state machine enables it to switch between
   behaviors.

   Add additional clones of this bot to the arena by
   clicking the [+] button above to the right.
*/

// A simple first task is to set the name of our AI.
bot.setName('My Second Bot')

bot.on(Event.START, () => {
  bot.turret.setOrientation(0)
  bot.radar.setOrientation(0)

  // Put persisted variables on 'this'. Set the intiial
  // state value.
  this.state = 'SEARCH'
})

clock.on(Event.TICK, async () => {
  // If we are in SEARCH mode first scan for enemies
  if (this.state === 'SEARCH') {
    let targets = await bot.radar.onReady().then(bot.radar.scan)
    if (targets.length > 0 && !targets[0].friendly) {
      // Slow down and adjust the turret for a better aim.
      await bot.setSpeed(-1)
      await bot.turret.setOrientation(targets[0].angle - bot.getOrientation())
      if (bot.turret.isReady()) {
        let result = await bot.turret.fire()

        // If it was a miss, accelerate and turn
        if (!result) {
          await bot
            .setSpeed(3)
            .then(() => bot.turn(bot.turret.getOrientation()))
            .then(() => bot.turret.setOrientation(0))
            .then(() => bot.turn(20))
        }
      }
    } else {
      // If no enemy targets, then keep searching
      await bot
        .turn(10)
        .then(() => bot.setSpeed(3))
        .then(() => bot.turret.setOrientation(0))
    }
  }
})

bot.on(Event.HIT, async info => {
  // If we are hit, change modes.
  this.state = 'RETALIATE'
  // Prepare to fire back
  return bot
    .setSpeed(-2)
    .then(() => bot.setOrientation(info.angle))
    .then(bot.turret.onReady)
    .then(async () => {
      // Fire repeatedly as long as we still see an enemy
      bot.turret.fire()
      while (
        (await bot.radar.onReady().then(await bot.radar.scan)).length() > 0 &&
        !targets[0].friendly
      )
        bot.turret.fire()
    })
    .finally(() => (this.state = 'SEARCH'))
})

// If we hit an obstical, change modes until we have avoided it
bot.on(Event.COLLIDED, () => {
  this.state = 'AVOID'
  bot.turn(90).finally(() => (this.state = 'SEARCH'))
})
