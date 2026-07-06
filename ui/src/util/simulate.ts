import TankApp from '../types/tankApp';
import { normalizeAngle } from './geometry';

// A partial mirror of the server's movement engine (server/src/util/
// simulation.ts), used to interpolate motion smoothly between server ticks.
// Keep the movement/rotation math here consistent with the server's.
export default (
  time: number,
  apps: TankApp[],
  arenaWidth: number,
  arenaHeight: number
) => {
  // Then handle movement and interactions
  apps.forEach((app) => {
    app.tanks.forEach((tank) => {
      if (tank.health > 0) {
        // Update the location
        const newTankX =
          tank.x +
          tank.speed * Math.sin(-tank.bodyOrientation * (Math.PI / 180));
        const newTankY =
          tank.y +
          tank.speed * Math.cos(-tank.bodyOrientation * (Math.PI / 180));

        if (
          newTankX > 16 &&
          newTankY > 16 &&
          newTankX < arenaWidth - 16 &&
          newTankY < arenaHeight - 16
        ) {
          tank.x = newTankX;
          tank.y = newTankY;
        }

        // Manage acceleration / deceleration
        if (tank.speed > tank.speedTarget) tank.speed -= tank.speedAcceleration;
        if (tank.speed < tank.speedTarget) tank.speed += tank.speedAcceleration;
        if (Math.abs(tank.speed - tank.speedTarget) < tank.speedAcceleration)
          tank.speed = tank.speedTarget;
        tank.speed = Math.max(
          -tank.speedMax,
          Math.min(tank.speedMax, tank.speed)
        );

        // Convenience method for manging rotating towards a target orientation
        // with a maximum rotational velocity.
        const rotate = (current: number, target: number, velocity: number) => {
          const delta = normalizeAngle(current - target);
          // Normalize the result so the interpolated angle stays in
          // [0, 360) instead of drifting negative/over 360 over time.
          return normalizeAngle(
            current +
              (delta <= 180 ? -1 : 1) *
                Math.min(normalizeAngle(Math.abs(current - target)), velocity)
          );
        };

        // Record the tank's path only while it is turning (orientation not yet
        // at its target). By design the trail is the series of vertices where
        // the tank changed heading — the renderer (arenaTankPath) connects them
        // into a polyline — so a straight run needs no breadcrumbs between its
        // endpoints. Points go into a fixed-size ring buffer, deduped by
        // position.
        if (
          normalizeAngle(tank.bodyOrientation - tank.bodyOrientationTarget) > 1
        ) {
          if (!tank.path) {
            tank.path = new Array(20);
            tank.pathIndex = 0;
          }
          const len = tank.path.length;
          // (pathIndex - 1) with a positive modulo, so the dedup check reads the
          // last written slot after the ring buffer wraps, instead of
          // tank.path[-1] / an out-of-bounds index. The old
          // `pathIndex - (1 % len)` collapsed to `pathIndex - 1` (1 % len === 1)
          // and broke once pathIndex passed the buffer length.
          const lastPoint = tank.path[(tank.pathIndex - 1 + len) % len];
          if (!lastPoint || lastPoint.x !== tank.x || lastPoint.y !== tank.y) {
            tank.path[tank.pathIndex % len] = {
              x: tank.x,
              y: tank.y,
              time,
            };
            tank.pathIndex = tank.pathIndex + 1;
          }
        }

        // Rotate the body
        tank.bodyOrientation = rotate(
          tank.bodyOrientation,
          tank.bodyOrientationTarget,
          tank.bodyOrientationVelocity
        );

        // Rotate the turret
        tank.turretOrientation = rotate(
          tank.turretOrientation,
          tank.turretOrientationTarget,
          tank.turretOrientationVelocity
        );

        // Rotate the radar
        tank.radarOrientation = rotate(
          tank.radarOrientation,
          tank.radarOrientationTarget,
          tank.radarOrientationVelocity
        );
      }

      // Move our bullets
      tank.bullets.forEach((bullet) => {
        if (!bullet.explodedAt) {
          bullet.x =
            bullet.x +
            bullet.speed * Math.sin(-bullet.orientation * (Math.PI / 180));
          bullet.y =
            bullet.y +
            bullet.speed * Math.cos(-bullet.orientation * (Math.PI / 180));
        }
      });
    });
  });
};
