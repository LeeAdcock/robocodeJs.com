/*
  Squad — teammates that gang up on one enemy.

  Teaches: real team COORDINATION over bot.send / Event.RECEIVED. When any squad
  member spots an enemy it broadcasts the whole scan contact (tagged with a
  shared team secret, since enemies hear broadcasts too) — a contact is
  serializable, so bot.send transmits its data and every teammate rebuilds it
  with arena.createContact. Each teammate then leads the shared target from its
  OWN position with getIntercept — five bots focusing predictive fire on one
  target instead of each fighting alone. Difficulty: intermediate. Pairs with
  the "Teamwork" (/learn/teamwork) lesson, and builds on the message-validation
  idea from the Magnetic example.
*/

bot.setName('Squad');

const SECRET = 42; // shared team tag; ignore any message without it
const FORGET_AFTER = 60; // drop a target we haven't seen for this many ticks

bot.on(Event.START, () => {
  bot.setSpeed(3);
  bot.radar.setOrientation(0);
  this.target = null; // last known enemy: a contact (ours or a teammate's)
});

clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) bot.radar.scan();

  // Forget a stale target so the squad doesn't keep firing at empty space.
  // Every contact carries the tick it was captured at as .time.
  if (this.target && clock.getTime() - this.target.time > FORGET_AFTER) {
    this.target = null;
  }

  if (this.target) {
    // Lead the shot: getIntercept solves where to aim from OUR position so a
    // bullet meets the target — falling back to its last known spot when no
    // interception is possible.
    const aim = this.target.getIntercept(bot.turret.bulletSpeed);
    const x = aim ? aim.getX() : this.target.getX();
    const y = aim ? aim.getY() : this.target.getY();
    bot.turret.turnTowards(x, y).catch(() => {});
    if (bot.turret.isReady()) bot.turret.fire().catch(() => {});
  } else if (!bot.isTurning()) {
    bot.turn(15).catch(() => {}); // no target known — roam and look
  }
});

bot.on(Event.SCANNED, (targets) => {
  const enemies = targets.filter((t) => !t.isFriendly());
  if (enemies.length === 0) return;

  // Nearest enemy. Spread the contact into the broadcast: what transmits is
  // its serializable data (position, speed, heading, capture time — methods
  // are not serialized), plus our team tag riding along.
  const enemy = enemies.sort((a, b) => a.getDistance() - b.getDistance())[0];
  this.target = enemy;
  bot.send({ secret: SECRET, ...enemy }); // rally the squad onto it
});

bot.on(Event.RECEIVED, (message) => {
  // Only trust well-formed messages carrying our team secret — enemies broadcast
  // too, so never act on a message you can't verify came from a teammate.
  if (!message || message.secret !== SECRET) return;
  // Rebuild the full contact from the serialized data; its methods now answer
  // from OUR position (the extra secret field rides along harmlessly).
  this.target = arena.createContact(message);
});
