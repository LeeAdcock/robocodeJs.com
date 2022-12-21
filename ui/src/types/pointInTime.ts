import Point from './point'

export default interface PointInTime extends Point {
    x: number
    y: number
    time: number
}
