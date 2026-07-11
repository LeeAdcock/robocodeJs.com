/*
  This bot is stationary, turning as it scans for
  others, then adjusts its turret before firing.

  Teaches: a stationary scan-and-fire loop using synchronous isReady()
  gating (instead of onReady() Promises).
  Difficulty: beginner. Pairs with the "Take aim" (/learn/aim) lesson.
*/
bot.setName('Lighthouse');

bot.on(Event.START, () => {
  bot.setSpeed(0);
  bot.radar.setOrientation(0);
});

clock.on(Event.TICK, async () => {
  if (bot.radar.isReady()) {
    const targets = await bot.radar.scan();

    // Only if we see an enemy bot
    if (targets.length > 0 && !targets[0].friendly) {
      // Turn the turret onto the target. The scan bearing is relative to the
      // body, and the turret orientation is too, so it drops straight in.
      return bot.turret.setOrientation(targets[0].angle).then(() => {
        if (bot.turret.isReady()) bot.turret.fire();
      });
    } else return bot.turn(20);
  }
});
