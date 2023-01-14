/*
  This bot navigates continuously between a series of 
  precomputed waypoints.
*/
bot.setName('Pathfinder')

bot.on(Event.START, () => {
  bot.turret.setOrientation(0)
  bot.radar.setOrientation(0)
  this.waypoints = []
  this.waypoints.push(
    { x: 100, y: 100 },
    { x: arena.getWidth() - 100, y: 100 },
    { x: arena.getWidth() - 100, y: arena.getHeight() - 100 },
    { x: 100, y: arena.getHeight() - 100 },
  )
  this.waypointIndex = 0
})

clock.on(Event.TICK, () => {
  // Calculate details on next waypoint
  let waypoint = this.waypoints[this.waypointIndex % this.waypoints.length]
  let angle = Math.atan2(waypoint.y - bot.getY(), waypoint.x - bot.getX()) * (180 / Math.PI) - 90
  let distance = Math.sqrt(
    Math.pow(waypoint.y - bot.getY(), 2) + Math.pow(waypoint.x - bot.getX(), 2),
  )

  if (distance < 25) this.waypointIndex++

  // Reorient
  return bot.setOrientation(angle).then(() => bot.setSpeed(distance < 50 ? 2 : 10))
})
