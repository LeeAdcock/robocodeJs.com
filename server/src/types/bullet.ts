import Point from './point';

export type BulletId = string & {};

// Distance a bullet travels per tick (also stamped on each Bullet's `speed`),
// health a hit removes, and health the shooter loses when a shot leaves the
// arena unhit. bulletSpeed/bulletDamage are mirrored into the sandbox as
// bot.turret attributes in compiler.ts.
export const BULLET_SPEED = 25;
export const BULLET_DAMAGE = 25;
export const BULLET_MISS_PENALTY = 3;

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
