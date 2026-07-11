/*
  Spirograph drives straight with a fixed forward-pointing turret and radar, so
  its constant gentle drift traces looping patterns while it shoots whatever
  wanders directly in front of it.

  Teaches: a fixed-turret "fire straight ahead" style and promise-chained
  (no async/await) tick logic.
  Difficulty: beginner. Pairs with the "Radar" (/learn/radar) lesson.
*/
bot.setName('Spirograph');

bot.on(Event.START, () => {
  bot.setSpeed(5);
  bot.radar.setOrientation(0);
  bot.turret.setOrientation(0);
});

clock.on(Event.TICK, () =>
  bot.radar
    .onReady()
    .then(bot.radar.scan)
    .then((targets) => {
      // The turret points straight ahead, so only fire when an enemy is actually
      // in front of us and close enough to hit — otherwise the shot is wasted.
      // A scan angle is 0..359, so "ahead" is near 0 or near 360.
      const enemy = targets[0];
      const ahead = enemy && (enemy.angle < 15 || enemy.angle > 345);
      if (enemy && !enemy.friendly && ahead && enemy.distance < 250) {
        return bot.turret.onReady().then(bot.turret.fire);
      }
    })
    .catch(() => {})
);

bot.on(Event.COLLIDED, () => {
  bot.turn(40).finally(() => bot.setSpeed(5));
});
