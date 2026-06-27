import Point from './point';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type BulletId = string & {};

export default interface Bullet extends Point {
  id: BulletId;
  origin: Point;
  x: number;
  y: number;
  speed: number;
  orientation: number;

  exploded: boolean;

  callback?: (value: unknown) => void;
}
