import Bullet from './bullet'
import Point from './point'
import { TimersContainer } from '../util/wrappers/timerWrapper'

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
  speed: number = 0
  speedTarget: number = 0
  speedAcceleration: number = 2
  speedMax: number = 5

  bodyOrientation: number = 0
  bodyOrientationTarget: number = 0
  bodyOrientationVelocity: number = 10

  turretOrientation: number = Math.random() * 360
  turretOrientationTarget: number = 0
  turretOrientationVelocity: number = 2
  turretLoaded: number = 0

  radarOrientation: number = Math.random() * 360
  radarOrientationTarget: number = 0
  radarOrientationVelocity: number = 2
  radarCharged: number = 0
  radarOn: boolean = false

  needsStarting: boolean = true
  handlers: any = {}
  appScope: any = {}

  bullets: Bullet[] = []

  health: number = 100

  path: Point[] = new Array<Point>(20)
  pathIndex: number = 0

  stats: any = new Stats()

  timers: any = new TimersContainer()
}
