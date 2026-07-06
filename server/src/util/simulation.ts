import { Event } from '../types/event';
import { timerTick } from './scheduleFactory';
import Environment, { DEPLOY_TICKS } from '../types/environment';
import { normalizeAngle, toRelativeBearing } from './geometry';

/*
  These functions calculate the changes and interaction between active
  elements in the arena, specifically tanks and their bullets.
*/

export default {
  // Handles all object movement
  run: (env: Environment) => {
    // Process any tanks whose software crashed
    env.getProcesses().forEach((process) => {
      process.tanks
        .filter((tank) => tank.health > 0 && tank.appCrashed)
        .forEach((tank) => {
          tank.health = 0;
          env.emit('event', {
            type: 'tankDamaged',
            id: tank.id,
            time: env.getTime(),
            health: tank.health,
          });
        });
    });

    // Ensure the tank has started. A tank whose START handler runs THIS tick is
    // recorded so the TICK loop below skips it: its first TICK arrives next tick,
    // after this tick's drainBotWork has fully run the (async) START. That makes
    // startup order deterministic — START always runs (and settles) before a
    // tank's first TICK — instead of racing START and TICK within one tick.
    const startedThisTick = new Set<unknown>();
    env.getProcesses().forEach((process) => {
      process.tanks.forEach((tank) => {
        if (tank.health > 0) {
          if (tank.needsStarting === true) {
            if (tank.handlers[Event.START]) {
              tank.handlers[Event.START]();
              startedThisTick.add(tank);
            }
            tank.needsStarting = false;
          }
        }
      });
    });

    // Then execute all timers
    timerTick(env);

    // Then execute the tank's tick handlers (skipping any tank just started this
    // tick, so START runs before that tank ever sees a TICK).
    env.getProcesses().forEach((process) => {
      process.tanks
        .filter((tank) => tank.health > 0)
        .forEach((tank) => {
          if (!startedThisTick.has(tank) && tank.handlers[Event.TICK]) {
            tank.handlers[Event.TICK]();
          }

          if (tank.turret.loaded < 100) tank.turret.loaded += 2;
          if (tank.turret.radar.charged < 100) tank.turret.radar.charged += 10;
        });
    });

    // Then handle movement and interactions
    env.getProcesses().forEach((process) => {
      process.tanks.forEach((tank) => {
        if (tank.health > 0) {
          const newX =
            tank.x + tank.speed * Math.sin(-tank.orientation * (Math.PI / 180));
          const newY =
            tank.y + tank.speed * Math.cos(-tank.orientation * (Math.PI / 180));
          let collided = false;

          // Detect if we have collided with another tank
          env.getProcesses().forEach((otherProcess) =>
            otherProcess.tanks.forEach((otherTank) => {
              if (otherTank.health > 0 && otherTank.id !== tank.id) {
                const distance = Math.sqrt(
                  Math.pow(otherTank.x - newX, 2) +
                    Math.pow(otherTank.y - newY, 2)
                );
                const angle: number = normalizeAngle(
                  Math.atan2(otherTank.y - tank.y, otherTank.x - tank.x) *
                    (180 / Math.PI) -
                    90
                );

                if (distance < 32) {
                  collided = true;
                  tank.stats.timesCollided += 1;
                  otherTank.stats.timesCollided += 1;
                  tank.logger.trace('Collided with tank');
                  otherTank.logger.trace('Collided with tank');
                  if (tank.handlers[Event.COLLIDED]) {
                    tank.handlers[Event.COLLIDED]({
                      angle: toRelativeBearing(angle, tank.orientation),
                      friendly: otherProcess.getAppId() === process.getAppId(),
                    });
                  }
                  if (otherTank.handlers[Event.COLLIDED]) {
                    otherTank.handlers[Event.COLLIDED]({
                      angle: toRelativeBearing(
                        normalizeAngle(180 + angle),
                        otherTank.orientation
                      ),
                      friendly: otherProcess.getAppId() === process.getAppId(),
                    });
                  }
                }
              }
            })
          );

          // Detect if we have been hit by another tank's bullets
          env.getProcesses().forEach((otherProcess) =>
            otherProcess.tanks.forEach((otherTank) => {
              if (otherTank.id !== tank.id) {
                otherTank.bullets
                  .filter((bullet) => !bullet.exploded)
                  .forEach((bullet) => {
                    const distance = Math.sqrt(
                      Math.pow(bullet.x - tank.x, 2) +
                        Math.pow(bullet.y - tank.y, 2)
                    );
                    const angle: number = normalizeAngle(
                      Math.atan2(
                        tank.y - bullet.origin.y,
                        tank.x - bullet.origin.x
                      ) *
                        (180 / Math.PI) -
                        90
                    );

                    if (distance < 32) {
                      // We have a hit
                      if (tank.handlers[Event.HIT]) {
                        tank.handlers[Event.HIT]({
                          angle: toRelativeBearing(
                            normalizeAngle(angle + 180),
                            tank.orientation
                          ),
                        });
                      }

                      // The bullet is consumed and the firer's shot resolves
                      // regardless of when it lands.
                      bullet.exploded = true;
                      if (bullet.callback) bullet.callback({ id: tank.id });

                      // Damage-free deployment window: during the opening
                      // DEPLOY_TICKS a shot still lands (HIT fires above) but
                      // deals no damage, so teams can settle off their spawns
                      // before combat is lethal — removing the last of the spawn
                      // luck. After the window it damages as normal.
                      if (env.getTime() >= DEPLOY_TICKS) {
                        tank.health -= 25;
                        tank.stats.timesHit += 1;
                        otherTank.stats.shotsHit += 1;

                        env.emit('event', {
                          type: 'tankDamaged',
                          id: tank.id,
                          time: env.getTime(),
                          health: tank.health,
                        });
                      }
                      env.emit('event', {
                        type: 'bulletExploded',
                        time: env.getTime(),
                        id: bullet.id,
                        tankId: tank.id,
                        x: bullet.x,
                        y: bullet.y,
                      });
                    }
                  });
              }
            })
          );

          // Detect if we are at the edge of the arena
          if (
            newX < 16 ||
            newX > env.getArena().getWidth() - 16 ||
            newY < 16 ||
            newY > env.getArena().getHeight() - 16
          ) {
            collided = true;
            tank.stats.timesCollided += 1;
            tank.logger.trace('Collided with arena boundary');
            if (tank.handlers[Event.COLLIDED]) {
              tank.handlers[Event.COLLIDED]({
                // A wall is in the direction you drove into it — dead ahead (0)
                // once expressed relative to your heading.
                angle: 0,
              });
            }
          }

          // If there wasn't a collision, continue the movement
          if (!collided) {
            // Update the location
            tank.x = newX;
            tank.y = newY;

            tank.stats.distanceTraveled += tank.speed;

            // Manage acceleration / deceleration
            if (tank.speed > tank.speedTarget)
              tank.speed -= tank.speedAcceleration;
            if (tank.speed < tank.speedTarget)
              tank.speed += tank.speedAcceleration;
            if (
              Math.abs(tank.speed - tank.speedTarget) < tank.speedAcceleration
            )
              tank.speed = tank.speedTarget;
            tank.speed = Math.max(
              -tank.speedMax,
              Math.min(tank.speedMax, tank.speed)
            );
          } else {
            tank.speedTarget = 0;
            tank.speed = 0;
            tank.health -= 1;
            // Handle a collision
            env.emit('event', {
              type: 'tankStop',
              time: env.getTime(),
              id: tank.id,
              x: tank.x,
              y: tank.y,
            });
            env.emit('event', {
              type: 'tankDamaged',
              time: env.getTime(),
              id: tank.id,
              health: tank.health,
            });
          }

          // Convenience method for manging rotating towards a target orientation
          // with a maximum rotational velocity.
          const rotate = (
            current: number,
            target: number,
            velocity: number
          ) => {
            if (normalizeAngle(Math.abs(current - target)) < velocity)
              return target;
            const delta = normalizeAngle(current - target);
            return normalizeAngle(current + (delta <= 180 ? -1 : 1) * velocity);
          };

          // Rotate the body
          tank.orientation = rotate(
            tank.orientation,
            tank.orientationTarget,
            tank.orientationVelocity
          );

          // Rotate the turret
          tank.turret.orientation = rotate(
            tank.turret.orientation,
            tank.turret.orientationTarget,
            tank.turret.orientationVelocity
          );

          // Rotate the radar
          tank.turret.radar.orientation = rotate(
            tank.turret.radar.orientation,
            tank.turret.radar.orientationTarget,
            tank.turret.radar.orientationVelocity
          );
        }

        // Move our bullets
        tank.bullets.forEach((bullet, bulletIndex, bullets) => {
          if (!bullet.exploded) {
            const newX =
              bullet.x +
              bullet.speed * Math.sin(-bullet.orientation * (Math.PI / 180));
            const newY =
              bullet.y +
              bullet.speed * Math.cos(-bullet.orientation * (Math.PI / 180));
            if (
              newX > -32 &&
              newX < env.getArena().getWidth() + 32 &&
              newY > -32 &&
              newY < env.getArena().getHeight() + 32
            ) {
              bullet.x = newX;
              bullet.y = newY;
            } else {
              // Went outside the arena, get rid of it
              env.emit('event', {
                type: 'bulletRemoved',
                time: env.getTime(),
                id: bullet.id,
                tankId: tank.id,
              });
              if (bullet.callback) bullet.callback({});
              bullets.splice(bulletIndex, 1);
            }
          }
        });
      });
    });
  },
};
