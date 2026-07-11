/*
  This bot navigates continuously between a series of
  precomputed waypoints.

  Teaches: driving to an (x, y) point with trig (heading + distance) and
  cycling through a list of waypoints.
  Difficulty: intermediate. Pairs with the "Maps and math" (/learn/navigation)
  lesson. (bot.turnTowards(x, y) can do the heading math for you — here we
  compute it by hand to show how it works.)
*/
bot.setName('Pathfinder');

bot.on(Event.START, () => {
  bot.turret.setOrientation(0);
  bot.radar.setOrientation(0);
  this.waypoints = [];
  this.waypoints.push(
    { x: 100, y: 100 },
    { x: arena.getWidth() - 100, y: 100 },
    { x: arena.getWidth() - 100, y: arena.getHeight() - 100 },
    { x: 100, y: arena.getHeight() - 100 }
  );
  this.waypointIndex = 0;
});

clock.on(Event.TICK, () => {
  // Calculate details on next waypoint
  let waypoint = this.waypoints[this.waypointIndex % this.waypoints.length];
  // North-zero compass heading toward the waypoint (0 = north/up, clockwise).
  let angle =
    Math.atan2(waypoint.x - bot.getX(), bot.getY() - waypoint.y) *
    (180 / Math.PI);
  let distance = Math.sqrt(
    Math.pow(waypoint.y - bot.getY(), 2) + Math.pow(waypoint.x - bot.getX(), 2)
  );

  if (distance < 25) this.waypointIndex++;

  // Reorient
  return bot
    .setOrientation(angle)
    .then(() => bot.setSpeed(distance < 50 ? 2 : 10));
});
