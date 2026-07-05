import Bullet from './bullet';
import Point from './point';
import PointInTime from './pointInTime';

export default interface Tank extends Point {
  id: string;

  speed: number;
  speedTarget: number;
  speedAcceleration: number;
  speedMax: number;

  bodyOrientation: number;
  bodyOrientationTarget: number;
  bodyOrientationVelocity: number;

  turretOrientation: number;
  turretOrientationTarget: number;
  turretOrientationVelocity: number;

  radarOrientation: number;
  radarOrientationTarget: number;
  radarOrientationVelocity: number;
  radarOn: boolean;

  bullets: Bullet[];

  health: number;

  // Set when the bot crashed (a fatal fault), so the arena can show a warning
  // triangle over the tank; `faultCode` is the E0xx code for the tooltip.
  crashed?: boolean;
  faultCode?: string;

  path: PointInTime[];
  pathIndex: number;
}
