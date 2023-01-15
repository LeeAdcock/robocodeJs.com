/*
  This bot uses a simple state machine to shift
  between different modes of operation.
*/

bot.setName('Stately')
bot.radar.setOrientation(0)

bot.on(Event.START, () => {
  this.state = 'START_UP'
})

clock.on(Event.TICK, () => {
  if (this.state === 'START_UP') {
    if (bot.turret.getOrientation() === 0) this.state = 'SCAN_RIGHT'
    return bot.turret.setOrientation(0)
  }

  if (this.state === 'SCAN_LEFT') {
    if (bot.turret.getOrientation() > 45 && bot.turret.getOrientation() < 90)
      this.state = 'SCAN_RIGHT'
    return Promise.all([bot.turret.turn(2), bot.setSpeed(5)])
  }

  if (this.state === 'SCAN_RIGHT') {
    if (bot.turret.getOrientation() < 360 - 45 && bot.turret.getOrientation() > 260 - 90)
      this.state = 'SCAN_LEFT'
    return Promise.all([bot.turret.turn(-2), bot.setSpeed(5)])
  }

  if (bot.radar.isReady() && bot.turret.isReady()) {
    if (this.state != 'FIRING' && this.state !== 'AVOID') this.oldState = this.state
    bot.setSpeed(0)
    this.state = 'FIRING'
    return bot.radar
      .scan()
      .then(bot.turret.fire)
      .catch(() => (this.state = this.oldState))
  }
})

bot.on(Event.COLLIDED, () => {
  if (this.state != 'FIRING' && this.state !== 'AVOID') this.oldState = this.state
  this.state = 'AVOID'
  bot.turn(40).then(() => {
    bot.setSpeed(1)
    this.state = this.oldState
  })
})
