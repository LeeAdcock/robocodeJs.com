import App from '../types/app';
import Bot from '../types/bot';
import { normalizeAngle } from './geometry';

// Append a vertex to a bot's trail ring buffer, deduped against the last point.
// The trail is a fixed-size (20) ring buffer of vertices the renderer connects
// into a polyline (see arenaBotPath). Used both here — recording where a bot
// changed heading — and by the SSE reducer, which records the landing point of a
// collision nudge so the drawn track kinks with the push instead of cutting the
// corner once the bot drives on.
export const recordTrailPoint = (
  bot: Pick<Bot, 'path' | 'pathIndex'>,
  x: number,
  y: number,
  time: number
) => {
  // Treat a missing OR empty buffer as uninitialized — a zero-length array would
  // make the ring-buffer modulo below NaN. (Placed bots always start with a
  // length-20 buffer, but don't rely on it.)
  if (!bot.path || bot.path.length === 0) {
    bot.path = new Array(20);
    bot.pathIndex = 0;
  }
  const len = bot.path.length;
  // (pathIndex - 1) with a positive modulo, so the dedup check reads the last
  // written slot after the ring buffer wraps, instead of bot.path[-1] / an
  // out-of-bounds index.
  const lastPoint = bot.path[(bot.pathIndex - 1 + len) % len];
  if (!lastPoint || lastPoint.x !== x || lastPoint.y !== y) {
    bot.path[bot.pathIndex % len] = { x, y, time };
    bot.pathIndex = bot.pathIndex + 1;
  }
};

// A partial mirror of the server's movement engine (server/src/util/
// simulation.ts), used to interpolate motion smoothly between server ticks.
// Keep the movement/rotation math here consistent with the server's.
export default (
  time: number,
  apps: App[],
  arenaWidth: number,
  arenaHeight: number
) => {
  // Then handle movement and interactions
  apps.forEach((app) => {
    app.bots.forEach((bot) => {
      if (bot.health > 0) {
        // Update the location
        const newBotX =
          bot.x + bot.speed * Math.sin(-bot.bodyOrientation * (Math.PI / 180));
        const newBotY =
          bot.y + bot.speed * Math.cos(-bot.bodyOrientation * (Math.PI / 180));

        if (
          newBotX > 16 &&
          newBotY > 16 &&
          newBotX < arenaWidth - 16 &&
          newBotY < arenaHeight - 16
        ) {
          bot.x = newBotX;
          bot.y = newBotY;
        }

        // Manage acceleration / deceleration
        if (bot.speed > bot.speedTarget) bot.speed -= bot.speedAcceleration;
        if (bot.speed < bot.speedTarget) bot.speed += bot.speedAcceleration;
        if (Math.abs(bot.speed - bot.speedTarget) < bot.speedAcceleration)
          bot.speed = bot.speedTarget;
        bot.speed = Math.max(-bot.speedMax, Math.min(bot.speedMax, bot.speed));

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

        // Record the bot's path only while it is turning (orientation not yet
        // at its target). By design the trail is the series of vertices where
        // the bot changed heading — the renderer (arenaBotPath) connects them
        // into a polyline — so a straight run needs no breadcrumbs between its
        // endpoints. (A collision nudge is the other source of vertices, recorded
        // by the reducer.)
        if (
          normalizeAngle(bot.bodyOrientation - bot.bodyOrientationTarget) > 1
        ) {
          recordTrailPoint(bot, bot.x, bot.y, time);
        }

        // Rotate the body
        bot.bodyOrientation = rotate(
          bot.bodyOrientation,
          bot.bodyOrientationTarget,
          bot.bodyOrientationVelocity
        );

        // Rotate the turret
        bot.turretOrientation = rotate(
          bot.turretOrientation,
          bot.turretOrientationTarget,
          bot.turretOrientationVelocity
        );

        // Rotate the radar
        bot.radarOrientation = rotate(
          bot.radarOrientation,
          bot.radarOrientationTarget,
          bot.radarOrientationVelocity
        );
      }

      // Move our bullets
      bot.bullets.forEach((bullet) => {
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
