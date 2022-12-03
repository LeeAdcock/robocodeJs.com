/*
  This bot demonstrates the use of one-shot timers
  and scheduled interval timers.
*/
bot.setName('Chronometer')

bot.on(Event.START, () => {
  // Turn after every 10 clock ticks
  setInterval(() => {
    bot.turn(15)
    bot.turret.turn(-15)
  }, 10)

  // Dash forward for ever 50 clock ticks
  setInterval(() => {
    bot.setSpeed(10)
    setTimeout(() => bot.setSpeed(0), 10)
  }, 50)
})
