import Point from "./point";

// eslint-disable-next-line @typescript-eslint/ban-types
export type BulletId = string & {};

export default interface Bullet extends Point {
  id: BulletId;
  origin: Point;
  x;
  y;
  speed;
  orientation;

  exploded: boolean;

  callback?: (value: unknown) => void;
}
