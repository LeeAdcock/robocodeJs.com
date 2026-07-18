import Point from './point';

export type BulletId = string & {};

// Distance a bullet travels per tick (also stamped on each Bullet's `speed`),
// health a hit removes, and health the shooter loses when a shot leaves the
// arena unhit. bulletSpeed/bulletDamage are mirrored into the sandbox as
// bot.turret attributes in compiler.ts.
export const BULLET_SPEED = 25;
export const BULLET_DAMAGE = 25;
export const BULLET_MISS_PENALTY = 3;

// Distance from the bot's center to the muzzle, where a shot actually spawns —
// the bullet leaves the end of the barrel, not the middle of the hull. Sized to
// the drawn barrel: the turret/barrel sprite (arenaBot.tsx, a 32×32 image at
// translate(-16, -24)) reaches its tip ~24 units ahead of the bot center, so a
// shot appears right at that tip. The debug view, collision, and the scenic
// projectile all place the bullet at this one point.
export const BARREL_LENGTH = 24;

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
