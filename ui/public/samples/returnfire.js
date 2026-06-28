/*
  This bot is stationary, but quickly turns to face any
  enemy bots who collide or hit it, then returns fire.
*/
bot.setName('ReturnFire');

// Create a function to make this behavior reusable. HIT/COLLIDED report a
// bearing relative to our body, so we turn BY that amount to face the threat,
// then fire once the turret is ready.
retaliate = (bearing) => {
  return bot.turn(bearing).then(bot.turret.onReady).then(bot.turret.fire);
};

bot.on(Event.START, () => {
  bot.turret.setOrientation(0);
});

// For both hit and collided events, run our relatiation
// logic in our custom function.
bot.on(Event.HIT, (info) => retaliate(info.angle));
bot.on(Event.COLLIDED, (info) => retaliate(info.angle));
