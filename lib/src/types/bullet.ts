import Point from './point'
import { v4 as uuidv4 } from 'uuid';

export default class Bullet extends Point {
  id: string = uuidv4()
  origin: Point = new Point()
  speed: number = 15
  orientation: number = 0

  exploded: boolean = false

  callback: any
}
