import Point from './point'
import { v4 as uuidv4 } from 'uuid';

export default class Bullet implements Point {
  id: string = uuidv4()
  origin: Point = {x:0, y:0}
  x: number = 0
  y: number  = 0
  speed: number = 15
  orientation: number = 0

  exploded: boolean = false

  callback: any
}
