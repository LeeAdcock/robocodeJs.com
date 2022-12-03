import { Event } from '../types/event'
import { timerTick } from '../util/wrappers/timerWrapper'
import TankApp from '../types/tankApp'

/*
  These functions calculate the changes and interaction between active
  elements in the arena, specifically tanks and their bullets.
*/

// Convenience function that ensures an angle is between 0 and 360
const normalizeAngle = (x: number): number => {
  x = x % 360
  while (x < 0) x += 360
  return x
}

// Convenience method to calculate a unqiue id
const getTankId = (appIndex: number, tankIndex: number) => (appIndex + 1) * 10 + (tankIndex + 1)

export default {
  // Handles all object movement
  run: (time: number, apps: TankApp[], arenaWidth: number, arenaHeight: number) => {
    // First execute all timers
    timerTick(apps, time)

    // Then execute the tank's tick handlers
    apps.forEach((app, appIndex) => {
      app.tanks
        .filter(tank => tank.health > 0)
        .forEach((tank, tankIndex) => {
          if (tank.handlers[Event.TICK]) {
            tank.handlers[Event.TICK]()
          }

          if (tank.turretLoaded < 100) tank.turretLoaded += 2
          if (tank.radarCharged < 100) tank.radarCharged += 10
        })
    })

    // Then handle movement and interactions
    apps.forEach((app, appIndex) => {
      app.tanks.forEach((tank, tankIndex) => {
        if (tank.health > 0) {
          if (tank.needsStarting === true) {
            if (tank.handlers[Event.START]) {
              tank.handlers[Event.START]()
            }
            tank.needsStarting = false
          }

          // Push tanks within the arena bounds, useful if the arena resizes
          tank.x = Math.min(arenaWidth - 16, tank.x)
          tank.y = Math.min(arenaHeight - 16, tank.y)

          const newX = tank.x + tank.speed * Math.sin(-tank.bodyOrientation * (Math.PI / 180))
          const newY = tank.y + tank.speed * Math.cos(-tank.bodyOrientation * (Math.PI / 180))
          let collided = false

          // Detect if we have collided with another tank
          apps.forEach((otherApp, otherAppIndex) =>
            otherApp.tanks.forEach((otherTank, otherTankIndex) => {
              if (
                otherTank.health > 0 &&
                (otherAppIndex !== appIndex || otherTankIndex !== tankIndex)
              ) {
                const distance = Math.sqrt(
                  Math.pow(otherTank.x - newX, 2) + Math.pow(otherTank.y - newY, 2),
                )
                const angle: number = normalizeAngle(
                  Math.atan2(otherTank.y - tank.y, otherTank.x - tank.x) * (180 / Math.PI) - 90,
                )

                if (distance < 32) {
                  collided = true
                  tank.stats.timesCollided += 1
                  otherTank.stats.timesCollided += 1
                  if (tank.handlers[Event.COLLIDED]) {
                    tank.handlers[Event.COLLIDED]({ angle, friendly: appIndex === otherAppIndex })
                  }
                  if (otherTank.handlers[Event.COLLIDED]) {
                    otherTank.handlers[Event.COLLIDED]({
                      angle: normalizeAngle(180 + angle),
                      friendly: appIndex === otherAppIndex,
                    })
                  }
                }
              }
            }),
          )

          // Detect if we have been hit by another tank's bullets
          apps.forEach((otherApp, otherAppIndex) =>
            otherApp.tanks.forEach((otherTank, otherTankIndex) => {
              if (otherAppIndex !== appIndex || otherTankIndex !== tankIndex) {
                otherTank.bullets
                  .filter(bullet => !bullet.exploded)
                  .forEach((bullet, bulletIndex, bullets) => {
                    const distance = Math.sqrt(
                      Math.pow(bullet.x - tank.x, 2) + Math.pow(bullet.y - tank.y, 2),
                    )
                    const angle: number = normalizeAngle(
                      Math.atan2(tank.y - bullet.origin.y, tank.x - bullet.origin.x) *
                        (180 / Math.PI) -
                        90,
                    )

                    if (distance < 32) {
                      // We have a hit
                      if (tank.handlers[Event.HIT]) {
                        tank.handlers[Event.HIT]({ angle: normalizeAngle(angle + 180) })
                      }
                      tank.health -= 25
                      tank.stats.timesHit += 1
                      otherTank.stats.shotsHit += 1

                      bullet.exploded = true
                      if (bullet.callback) bullet.callback({ id: getTankId(appIndex, tankIndex) })
                    }
                  })
              }
            }),
          )

          // Detect if we are at the edge of the arena
          if (newX < 16 || newX > arenaWidth - 16 || newY < 16 || newY > arenaHeight - 16) {
            collided = true
            tank.stats.timesCollided += 1
            if (tank.handlers[Event.COLLIDED]) {
              tank.handlers[Event.COLLIDED]({ angle: normalizeAngle(tank.bodyOrientation) })
            }
          }

          // If there wasn't a collision, continue the movement
          if (!collided) {
            // Update the location
            tank.x = newX
            tank.y = newY

            tank.stats.distanceTraveled += tank.speed

            // Manage acceleration / deceleration
            if (tank.speed > tank.speedTarget) tank.speed -= tank.speedAcceleration
            if (tank.speed < tank.speedTarget) tank.speed += tank.speedAcceleration
            if (Math.abs(tank.speed - tank.speedTarget) < tank.speedAcceleration)
              tank.speed = tank.speedTarget
            tank.speed = Math.min(tank.speedMax, tank.speed)
          } else {
            // Handle a collision
            tank.speedTarget = 0
            tank.speed = 0
            tank.health -= 1
          }

          // Convenience method for manging rotating towards a target orientation
          // with a maximum rotational velocity.
          const rotate = (current, target, velocity) => {
            if (normalizeAngle(Math.abs(current - target)) < velocity) return target
            const delta = normalizeAngle(current - target)
            return normalizeAngle(current + (delta <= 180 ? -1 : 1) * velocity)
          }

          // Record the tank's path
          if (tank.bodyOrientation !== tank.bodyOrientationTarget) {
            if (!tank.path) tank.path = []
            const lastPoint = tank.path[tank.pathIndex - (1 % tank.path.length)] || {}
            if (!lastPoint || lastPoint.x !== tank.x || lastPoint.y !== tank.y) {
              tank.path[tank.pathIndex % tank.path.length] = { x: tank.x, y: tank.y, time }
              tank.pathIndex = (tank.pathIndex || 0) + 1
            }
          }

          // Rotate the body
          tank.bodyOrientation = rotate(
            tank.bodyOrientation,
            tank.bodyOrientationTarget,
            tank.bodyOrientationVelocity,
          )

          // Rotate the turret
          tank.turretOrientation = rotate(
            tank.turretOrientation,
            tank.turretOrientationTarget,
            tank.turretOrientationVelocity,
          )

          // Rotate the radar
          tank.radarOrientation = rotate(
            tank.radarOrientation,
            tank.radarOrientationTarget,
            tank.radarOrientationVelocity,
          )
        }

        // Move our bullets
        tank.bullets.forEach((bullet, bulletIndex, bullets) => {
          if (!bullet.exploded) {
            const newX = bullet.x + bullet.speed * Math.sin(-bullet.orientation * (Math.PI / 180))
            const newY = bullet.y + bullet.speed * Math.cos(-bullet.orientation * (Math.PI / 180))
            if (newX > 0 && newX < arenaWidth && newY > 0 && newY < arenaHeight) {
              bullet.x = newX
              bullet.y = newY
            } else {
              // Went outside the arena, get rid of it
              if (bullet.callback) bullet.callback({})
              bullets.splice(bulletIndex, 1)
            }
          }
        })
      })
    })
  },
}
