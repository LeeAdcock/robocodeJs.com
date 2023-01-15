import Point from "./point";
import { v4 as uuidv4 } from "uuid";

export default class Bullet implements Point {
  id: string = uuidv4();
  origin: Point = { x: 0, y: 0 };
  x = 0;
  y = 0;
  speed = 15;
  orientation = 0;

  exploded = false;

  callback: ((...arg: any[]) => void) | null = null;
}
