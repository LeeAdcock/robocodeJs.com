/*
  This bot is stationary, but quickly turns to face any
  enemy bots who collide or hit it, then returns fire.
*/
bot.setName('ReturnFire')

// Create a function to make this behavior reusable.
// Turns the tank towards a specific heading and
// when the turret is ready it fires.
retaliate = angle => {
  return bot.setOrientation(angle).then(bot.turret.onReady).then(bot.turret.fire)
}

bot.on(Event.START, () => {
  bot.turret.setOrientation(0)
})

// For both hit and collided events, run our relatiation
// logic in our custom function.
bot.on(Event.HIT, info => retaliate(info.angle))
bot.on(Event.COLLIDED, info => retaliate(info.angle))
