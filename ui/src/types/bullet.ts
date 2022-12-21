import Point from './point'

export default interface Bullet extends Point {
    id: string
    origin: Point
    speed: number
    orientation: number

    explodedAt: number | undefined
}
