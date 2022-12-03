/*
  This bot demonstrates using a message protocal to
  send information between bots.
*/
bot.setName('Magnetic')
bot.turret.setOrientation(0)

let secret = 8 // 15 max

bot.on(Event.START, () => bot.setSpeed(10))

clock.on(Event.TICK, () => {
  // Create message
  let x = Math.ceil(bot.getX())
  let y = Math.ceil(bot.getY())
  let id = bot.getId()
  let content = (secret << 27) | (x << 18) | (y << 9) | (id << 2)

  // Create check digit
  let checkDigit = content % 4
  let message = content | checkDigit

  // Send message
  bot.send(message)
})

bot.on(Event.RECEIVED, message => {
  // Validate check digit
  let checkDigit = message & 0x3

  if (checkDigit === message % 4) {
    // Extract content fields
    let content = message & ~0x3
    let id = (content >> 2) & 0x7f
    let y = (content >> 9) & 0x1ff
    let x = (content >> 18) & 0x1ff

    // Validate secret
    let allegedSecret = (content >> 27) & 0x3ff
    if (allegedSecret === secret) {
      let angle = Math.atan2(y - bot.getY(), x - bot.getX()) * (180 / Math.PI) - 90
      let distance = Math.sqrt(Math.pow(y - bot.getY(), 2) + Math.pow(x - bot.getX(), 2))

      // Reorient, set speed
      return Promise.all([bot.setOrientation(angle), distance < 50 ? bot.setSpeed(0) : null])
    }
  }
})
