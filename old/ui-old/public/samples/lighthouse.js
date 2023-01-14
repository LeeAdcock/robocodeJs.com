/*
  This bot is stationary, turning as it scans for
  others, then adjusts its turret before firing.
*/
bot.setName('Lighthouse')

bot.on(Event.START, () => {
  bot.setSpeed(0)
  bot.radar.setOrientation(0)
})

clock.on(Event.TICK, async () => {
  if (bot.radar.isReady()) {
    const targets = await bot.radar.scan()

    // Only if we see an enemy bot
    if (targets.length > 0 && !target[0].friendly) {
      // Turn the turret for a more accurate shot
      return bot.turret.setOrientation(targets[0].angle - bot.getOrientation()).then(() => {
        if (bot.turret.isReady()) bot.turret.fire()
      })
    } else return bot.turn(20)
  }
})
