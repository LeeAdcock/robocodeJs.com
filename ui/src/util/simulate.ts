import TankApp from '../types/tankApp'

const normalizeAngle = (x: number): number => {
    x = x % 360
    while (x < 0) x += 360
    return x
}

export default (
    time: number,
    apps: TankApp[],
    arenaWidth: number,
    arenaHeight: number
) => {
    // Then handle movement and interactions
    apps.forEach((app) => {
        app.tanks.forEach((tank) => {
            if (tank.health > 0) {
                // Update the location
                const newTankX =
                    tank.x +
                    tank.speed *
                        Math.sin(-tank.bodyOrientation * (Math.PI / 180))
                const newTankY =
                    tank.y +
                    tank.speed *
                        Math.cos(-tank.bodyOrientation * (Math.PI / 180))

                if (
                    newTankX > 16 &&
                    newTankY > 16 &&
                    newTankX < arenaWidth - 16 &&
                    newTankY < arenaHeight - 16
                ) {
                    tank.x = newTankX
                    tank.y = newTankY
                }

                // Manage acceleration / deceleration
                if (tank.speed > tank.speedTarget)
                    tank.speed -= tank.speedAcceleration
                if (tank.speed < tank.speedTarget)
                    tank.speed += tank.speedAcceleration
                if (
                    Math.abs(tank.speed - tank.speedTarget) <
                    tank.speedAcceleration
                )
                    tank.speed = tank.speedTarget
                tank.speed = Math.max(
                    -tank.speedMax,
                    Math.min(tank.speedMax, tank.speed)
                )

                // Convenience method for manging rotating towards a target orientation
                // with a maximum rotational velocity.
                const rotate = (current, target, velocity) => {
                    const delta = normalizeAngle(current - target)
                    return (
                        current +
                        (delta <= 180 ? -1 : 1) *
                            Math.min(
                                normalizeAngle(Math.abs(current - target)),
                                velocity
                            )
                    )
                }

                // Record the tank's path
                // TODO is this working?
                if (
                    normalizeAngle(
                        tank.bodyOrientation - tank.bodyOrientationTarget
                    ) > 1
                ) {
                    if (!tank.path) {
                        tank.path = new Array(10)
                        tank.pathIndex = 0
                    }
                    const lastPoint =
                        tank.path[tank.pathIndex - (1 % tank.path.length)]
                    if (
                        !lastPoint ||
                        lastPoint.x !== tank.x ||
                        lastPoint.y !== tank.y
                    ) {
                        tank.path[tank.pathIndex % tank.path.length] = {
                            x: tank.x,
                            y: tank.y,
                            time,
                        }
                        tank.pathIndex = tank.pathIndex + 1
                    }
                }

                // Rotate the body
                tank.bodyOrientation = rotate(
                    tank.bodyOrientation,
                    tank.bodyOrientationTarget,
                    tank.bodyOrientationVelocity
                )

                // Rotate the turret
                tank.turretOrientation = rotate(
                    tank.turretOrientation,
                    tank.turretOrientationTarget,
                    tank.turretOrientationVelocity
                )

                // Rotate the radar
                tank.radarOrientation = rotate(
                    tank.radarOrientation,
                    tank.radarOrientationTarget,
                    tank.radarOrientationVelocity
                )
            }

            // Move our bullets
            tank.bullets.forEach((bullet) => {
                if (!bullet.explodedAt) {
                    bullet.x =
                        bullet.x +
                        bullet.speed *
                            Math.sin(-bullet.orientation * (Math.PI / 180))
                    bullet.y =
                        bullet.y +
                        bullet.speed *
                            Math.cos(-bullet.orientation * (Math.PI / 180))
                }
            })
        })
    })
}
