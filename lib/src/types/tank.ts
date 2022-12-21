import Bullet from './bullet'
import Point from './point'
import Arena from './arena'
import Process from './process'
import { TimersContainer } from '../util/wrappers/timerWrapper'
import { v4 as uuidv4 } from 'uuid';

export class Stats {
  distanceTraveled: number = 0
  scansCompleted: number = 0
  scansDetected: number = 0
  shotsFired: number = 0
  shotsHit: number = 0
  messagesSent: number = 0
  messagesReceived: number = 0
  timesCollided: number = 0
  timesHit: number = 0
  timesDetected: number = 0
}

export default class Tank extends Point {

  constructor(arena:Arena, process:Process) {
    super()

    let overallClosestTank: number | null = null
    do {
      this.x = 16 + (arena.width - 32) * Math.random()
      this.y = 16 + (arena.height - 32) * Math.random()

      // Keep iterating if we placed this tank too close to another
      overallClosestTank = arena.processes?.reduce(
        (
          closestDistanceForTankApp: number | null,
          curProcess: Process,
        ) => {
          const closestTankForThisTankApp = curProcess.tanks.reduce(
            (closestDistanceForTank: number | null, curTank: Tank) => {
              if (curTank.id === this.id)
                return closestDistanceForTank

              const curTankDistance: number | null = Math.sqrt(
                Math.pow(curTank.x - this.x, 2) + Math.pow(curTank.y - this.y, 2),
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

    this.bodyOrientation = Math.random() * 360
    this.bodyOrientationTarget = this.bodyOrientation
    this.turretOrientation = Math.random() * 360
    this.turretOrientationTarget = this.turretOrientation
    this.radarOrientation = Math.random() * 360
    this.radarOrientationTarget = this.radarOrientation

  }

  id: string = uuidv4()

  speed: number = 0
  speedTarget: number = 0
  speedAcceleration: number = 2
  speedMax: number = 5

  bodyOrientation: number = 0
  bodyOrientationTarget: number = 0
  bodyOrientationVelocity: number = 10

  turretOrientation: number = 0
  turretOrientationTarget: number = 0
  turretOrientationVelocity: number = 2
  turretLoaded: number = 0

  radarOrientation: number = 0
  radarOrientationTarget: number = 0
  radarOrientationVelocity: number = 2
  radarCharged: number = 0

  needsStarting: boolean = true
  handlers: any = {}
  appScope: any = {}

  bullets: Bullet[] = []

  health: number = 100

  stats: any = new Stats()

  timers: any = new TimersContainer()
}
