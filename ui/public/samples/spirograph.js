bot.setName('Spirograph');

bot.on(Event.START, () => {
  bot.setSpeed(10);
  bot.radar.setOrientation(0);
  bot.turret.setOrientation(0);
});

clock.on(Event.TICK, () =>
  bot.radar
    .onReady()
    .then(bot.radar.scan)
    .then((targets) => {
      // Only fire if the scan straight ahead found an enemy.
      if (targets.length > 0 && !targets[0].friendly) {
        return bot.turret.onReady().then(bot.turret.fire);
      }
    })
    .catch(() => {})
);

bot.on(Event.COLLIDED, () => {
  bot.turn(40).finally(() => bot.setSpeed(10));
});
