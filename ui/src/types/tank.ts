import Bullet from './bullet'
import Point from './point'
import PointInTime from './pointInTime'

export default interface Tank extends Point {
    id: string

    speed: number
    speedTarget: number
    speedAcceleration: number
    speedMax: number

    bodyOrientation: number
    bodyOrientationTarget: number
    bodyOrientationVelocity: number

    turretOrientation: number
    turretOrientationTarget: number
    turretOrientationVelocity: number

    radarOrientation: number
    radarOrientationTarget: number
    radarOrientationVelocity: number
    radarOn: boolean

    bullets: Bullet[]

    health: number

    path: PointInTime[]
    pathIndex: number
}
