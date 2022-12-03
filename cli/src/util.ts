import { TankApp, Compiler, Tank } from 'battle-bots'
import * as fs from 'fs'

// Class to capture the last log message and make it
// available for display
class LogCapturer {
  value: undefined | object

  write = value => {
    this.value = value
  }

  getLastRecord = () => this.value
}

export const init = (files, tankCount, arenaWidth, arenaHeight, timeProvider: Function) => {
  // Initialize arena, applications, and bots
  const apps: TankApp[] = []
  const logs: LogCapturer[] = []

  for (let appIndex = 0; appIndex < files.length; appIndex++) {
    const app = new TankApp()
    app.name = appIndex.toString()
    apps.push(app)

    const logCapturer = new LogCapturer()
    logs.push(logCapturer)

    app.source = fs.readFileSync(files[appIndex], 'utf8')
    app.recompile = true

    app.tanks = new Array()
    for (let tankIndex = 0; tankIndex < tankCount; tankIndex++) {
      const tank = new Tank()
      app.tanks.push(tank)

      let overallClosestTank: number | null = null
      do {
        tank.x = 16 + (arenaWidth - 32) * Math.random()
        tank.y = 16 + (arenaHeight - 32) * Math.random()

        // Keep iterating if we placed this tank too close to another
        overallClosestTank = apps.reduce(
          (
            closestDistanceForTankApp: number | null,
            curTankApp: TankApp,
            curTankAppIndex: number,
          ) => {
            const closestTankForThisTankApp = curTankApp.tanks.reduce(
              (closestDistanceForTank: number | null, curTank: Tank, curTankIndex: number) => {
                if (curTankAppIndex === appIndex && curTankIndex === tankIndex)
                  return closestDistanceForTank

                const curTankDistance: number | null = Math.sqrt(
                  Math.pow(curTank.x - tank.x, 2) + Math.pow(curTank.y - tank.y, 2),
                )
                return !closestDistanceForTank
                  ? curTankDistance
                  : Math.min(closestDistanceForTank, curTankDistance)
              },
              null,
            )
            if (!closestDistanceForTankApp) return closestTankForThisTankApp
            if (!closestTankForThisTankApp) return closestDistanceForTankApp
            return Math.min(closestDistanceForTankApp, closestTankForThisTankApp)
          },
          null,
        )
      } while (overallClosestTank !== null && overallClosestTank < 50)

      tank.bodyOrientation = Math.random() * 360
      tank.bodyOrientationTarget = tank.bodyOrientation
      tank.turretOrientation = Math.random() * 360
      tank.turretOrientationTarget = tank.turretOrientation
      tank.radarOrientation = Math.random() * 360
      tank.radarOrientationTarget = tank.radarOrientation

      tank.health = 100
      tank.turretLoaded = 0
      tank.radarCharged = 0
      tank.speed = 0

      tank.needsStarting = true

      Compiler.compile(
        apps,
        appIndex,
        tankIndex,
        () => arenaWidth,
        () => arenaHeight,
        logCapturer,
        false,
        timeProvider,
      )
    }
  }
  return { apps, logs }
}
