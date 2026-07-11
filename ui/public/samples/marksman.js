/*
  Marksman — a precision combat bot.

  Teaches: LEADING a moving target (aiming where it will be, not where it is),
  locking onto and focus-firing the WEAKEST enemy, and FIRE DISCIPLINE — holding
  fire until the shot can actually land, instead of spraying reloads at hopeless
  angles.
  Difficulty: advanced. Pairs with the "Leading a moving target" (/learn/leading)
  and "Take aim" (/learn/aim) lessons.

  It holds position and sweeps its turret to search (the radar rides on top of
  the turret, so wherever the turret points, the radar looks). Once it sees an
  enemy it predicts where that enemy is driving and fires only when lined up.

  Add a moving bot (like Pathfinder) to the arena and watch Marksman lead it.
*/

bot.setName('Marksman');

// Bullets fly 25 units/tick and the target keeps moving, so shots past this
// range tend to miss as the lead estimate drifts. Don't take them.
const RANGE = 250;
// Only fire when the turret is within this many degrees of the aim point.
const AIM_TOLERANCE = 4;

// Smallest signed difference between two angles, in the range -180..180.
function angleDelta(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

bot.on(Event.START, () => {
  bot.setSpeed(0); // hold still so aiming is the only variable
  // Keep the radar at 0 relative to the turret: aiming the turret at a target
  // also points the radar at it, so we keep seeing it (a simple "lock").
  bot.radar.setOrientation(0);
  this.targetId = null;
});

// Charge and fire the radar each tick; the SCANNED handler does the aiming.
clock.on(Event.TICK, () => {
  if (bot.radar.isReady()) bot.radar.scan();
});

bot.on(Event.SCANNED, (targets) => {
  const enemies = targets.filter((t) => !t.friendly);
  if (enemies.length === 0) {
    // Nothing in view — sweep the turret (and the radar riding it) to search.
    this.targetId = null;
    bot.turret.turn(15).catch(() => {});
    return;
  }

  // Focus-fire: keep shooting our locked target while we can still see it,
  // otherwise pick the weakest enemy (lowest health), nearest as a tie-break.
  const target =
    enemies.find((e) => e.id === this.targetId) ||
    enemies.sort((a, b) => a.health - b.health || a.distance - b.distance)[0];
  this.targetId = target.id;

  // --- Lead the shot: aim where the target will be, not where it is. ---
  // (The Leading lesson walks through this trig step by step.)
  const ticks = target.speed === 0 ? 0 : target.distance / 25;
  const bearing = ((bot.getOrientation() + target.angle) * Math.PI) / 180;
  const enemyX = bot.getX() + target.distance * Math.sin(bearing);
  const enemyY = bot.getY() - target.distance * Math.cos(bearing);
  const heading = (target.orientation * Math.PI) / 180;
  const futureX = enemyX + target.speed * ticks * Math.sin(heading);
  const futureY = enemyY - target.speed * ticks * Math.cos(heading);
  // Turn the predicted point back into a body-relative bearing for the turret.
  const aim =
    (Math.atan2(futureX - bot.getX(), bot.getY() - futureY) * 180) / Math.PI -
    bot.getOrientation();
  bot.turret.setOrientation(aim).catch(() => {});

  // --- Fire discipline: only take a shot that can actually land. ---
  const linedUp =
    Math.abs(angleDelta(aim, bot.turret.getOrientation())) < AIM_TOLERANCE;
  if (target.distance < RANGE && linedUp && bot.turret.isReady()) {
    bot.turret.fire().catch(() => {});
  }
});
