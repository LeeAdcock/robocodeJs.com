import Point from './point'

export default class Bullet extends Point {
  id: number = Math.random()
  origin: Point = new Point()
  speed: number = 15
  orientation: number = 0

  exploded: boolean = false

  callback: any
}
