import { Event } from "../types/event";
import { timerTick } from "./scheduleFactory";
import Environment from "../types/environment";

/*
  These functions calculate the changes and interaction between active
  elements in the arena, specifically tanks and their bullets.
*/

// Convenience function that ensures an angle is between 0 and 360
const normalizeAngle = (x: number): number => {
  x = x % 360;
  while (x < 0) x += 360;
  return x;
};

export default {
  // Handles all object movement
  run: (env: Environment) => {
    // Process any tanks whose software crashed
    env.getProcesses().forEach((process) => {
      process.tanks
        .filter((tank) => tank.health > 0 && tank.appCrashed)
        .forEach((tank) => {
          tank.health = 0;
          env.emit("event", {
            type: "tankDamaged",
            id: tank.id,
            time: env.getTime(),
            health: tank.health,
          });
        });
    });

    // First execute all timers
    timerTick(env);

    // Then execute the tank's tick handlers
    env.getProcesses().forEach((process) => {
      process.tanks
        .filter((tank) => tank.health > 0)
        .forEach((tank) => {
          if (tank.handlers[Event.TICK]) {
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
          if (tank.needsStarting === true) {
            if (tank.handlers[Event.START]) {
              tank.handlers[Event.START]();
            }
            tank.needsStarting = false;
          }

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
                  if (tank.handlers[Event.COLLIDED]) {
                    tank.handlers[Event.COLLIDED]({
                      angle,
                      friendly: otherProcess.getAppId() === process.getAppId(),
                    });
                  }
                  if (otherTank.handlers[Event.COLLIDED]) {
                    otherTank.handlers[Event.COLLIDED]({
                      angle: normalizeAngle(180 + angle),
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
                          angle: normalizeAngle(angle + 180),
                        });
                      }

                      tank.health -= 25;
                      tank.stats.timesHit += 1;
                      otherTank.stats.shotsHit += 1;

                      bullet.exploded = true;
                      if (bullet.callback) bullet.callback({ id: tank.id });

                      env.emit("event", {
                        type: "tankDamaged",
                        id: tank.id,
                        time: env.getTime(),
                        health: tank.health,
                      });
                      env.emit("event", {
                        type: "bulletExploded",
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
            if (tank.handlers[Event.COLLIDED]) {
              tank.handlers[Event.COLLIDED]({
                angle: normalizeAngle(tank.orientation),
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
            env.emit("event", {
              type: "tankStop",
              time: env.getTime(),
              id: tank.id,
              x: tank.x,
              y: tank.y,
            });
            env.emit("event", {
              type: "tankDamaged",
              time: env.getTime(),
              id: tank.id,
              health: tank.health,
            });
          }

          // Convenience method for manging rotating towards a target orientation
          // with a maximum rotational velocity.
          const rotate = (current, target, velocity) => {
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
              newX > 0 &&
              newX < env.getArena().getWidth() &&
              newY > 0 &&
              newY < env.getArena().getHeight()
            ) {
              bullet.x = newX;
              bullet.y = newY;
            } else {
              // Went outside the arena, get rid of it
              env.emit("event", {
                type: "bulletRemoved",
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
