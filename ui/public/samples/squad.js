/*
  Squad — teammates that gang up on one enemy.

  Teaches: real team COORDINATION over bot.send / Event.RECEIVED. When any squad
  member spots an enemy it broadcasts that enemy's arena position (tagged with a
  shared team secret, since enemies hear broadcasts too); every teammate then
  swings its turret onto that spot with bot.turret.turnTowards(x, y) and fires —
  so five bots focus their fire on one target instead of each fighting alone.
  Difficulty: intermediate. Pairs with the "Teamwork" (/learn/teamwork) lesson,
  and builds on the message-validation idea from the Magnetic example.
*/

bot.setName('Squad');

const SECRET = 42; // shared team tag; ignore any message without it
const FORGET_AFTER = 60; // drop a target we haven't seen for this many ticks

bot.on(Event.START, () => {
  bot.setSpeed(3);
  bot.radar.setOrientation(0);
  this.enemyAt = null; // last known enemy position: { x, y, time }
});

clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) bot.radar.scan();

  // Forget a stale target so the squad doesn't keep firing at empty space.
  if (this.enemyAt && clock.getTime() - this.enemyAt.time > FORGET_AFTER) {
    this.enemyAt = null;
  }

  if (this.enemyAt) {
    // Aim at the shared target and fire when loaded. turret.turnTowards does the
    // trig for us — it accounts for both our body and our turret orientation.
    bot.turret.turnTowards(this.enemyAt.x, this.enemyAt.y).catch(() => {});
    if (bot.turret.isReady()) bot.turret.fire().catch(() => {});
  } else if (!bot.isTurning()) {
    bot.turn(15).catch(() => {}); // no target known — roam and look
  }
});

bot.on(Event.SCANNED, (targets) => {
  const enemies = targets.filter((t) => !t.friendly);
  if (enemies.length === 0) return;

  // Nearest enemy — turn its (body-relative) bearing + distance into an ABSOLUTE
  // arena position, which any teammate can aim at no matter where they stand.
  const enemy = enemies.sort((a, b) => a.distance - b.distance)[0];
  const bearing = ((bot.getOrientation() + enemy.angle) * Math.PI) / 180;
  const x = bot.getX() + enemy.distance * Math.sin(bearing);
  const y = bot.getY() - enemy.distance * Math.cos(bearing);

  this.enemyAt = { x: x, y: y, time: clock.getTime() };
  bot.send({ secret: SECRET, x: x, y: y }); // rally the squad onto it
});

bot.on(Event.RECEIVED, (message) => {
  // Only trust well-formed messages carrying our team secret — enemies broadcast
  // too, so never act on a message you can't verify came from a teammate.
  if (!message || message.secret !== SECRET) return;
  this.enemyAt = { x: message.x, y: message.y, time: clock.getTime() };
});
