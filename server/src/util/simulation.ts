import { Event } from '../types/event';
import { timerTick } from './scheduleFactory';
import Environment from '../types/environment';
import { normalizeAngle, toRelativeBearing } from './geometry';

/*
  These functions calculate the changes and interaction between active
  elements in the arena, specifically bots and their bullets.
*/

export default {
  // Handles all object movement
  run: (env: Environment) => {
    // Process any bots whose software crashed
    env.getProcesses().forEach((process) => {
      process.bots
        .filter((bot) => bot.health > 0 && bot.appCrashed)
        .forEach((bot) => {
          bot.health = 0;
          env.emit('event', {
            type: 'botDamaged',
            id: bot.id,
            time: env.getTime(),
            health: bot.health,
          });
        });
    });

    // Ensure the bot has started. A bot whose START handler runs THIS tick is
    // recorded so the TICK loop below skips it: its first TICK arrives next tick,
    // after this tick's drainBotWork has fully run the (async) START. That makes
    // startup order deterministic — START always runs (and settles) before a
    // bot's first TICK — instead of racing START and TICK within one tick.
    const startedThisTick = new Set<unknown>();
    env.getProcesses().forEach((process) => {
      process.bots.forEach((bot) => {
        // Skip until the bot's code has loaded (handlers registered). Clearing
        // needsStarting before the START handler exists would permanently skip
        // START and let the first TICK run against uninitialized state — the
        // race that hit bots added to an already-running arena. See bot.codeLoaded.
        if (bot.health > 0 && bot.codeLoaded) {
          if (bot.needsStarting === true) {
            if (bot.handlers[Event.START]) {
              bot.handlers[Event.START]();
              startedThisTick.add(bot);
            }
            bot.needsStarting = false;
          }
        }
      });
    });

    // Then execute all timers
    timerTick(env);

    // Then execute the bot's tick handlers (skipping any bot just started this
    // tick, so START runs before that bot ever sees a TICK).
    env.getProcesses().forEach((process) => {
      process.bots
        .filter((bot) => bot.health > 0)
        .forEach((bot) => {
          if (
            bot.codeLoaded &&
            !startedThisTick.has(bot) &&
            bot.handlers[Event.TICK]
          ) {
            bot.handlers[Event.TICK]();
          }

          if (bot.turret.loaded < 100) bot.turret.loaded += 2;
          if (bot.turret.radar.charged < 100) bot.turret.radar.charged += 10;
        });
    });

    // Then handle movement and interactions
    env.getProcesses().forEach((process) => {
      process.bots.forEach((bot) => {
        if (bot.health > 0) {
          const newX =
            bot.x + bot.speed * Math.sin(-bot.orientation * (Math.PI / 180));
          const newY =
            bot.y + bot.speed * Math.cos(-bot.orientation * (Math.PI / 180));
          let collided = false;

          // Detect if we have collided with another bot
          env.getProcesses().forEach((otherProcess) =>
            otherProcess.bots.forEach((otherBot) => {
              if (otherBot.health > 0 && otherBot.id !== bot.id) {
                const distance = Math.sqrt(
                  Math.pow(otherBot.x - newX, 2) +
                    Math.pow(otherBot.y - newY, 2)
                );
                const angle: number = normalizeAngle(
                  Math.atan2(otherBot.y - bot.y, otherBot.x - bot.x) *
                    (180 / Math.PI) -
                    90
                );

                if (distance < 32) {
                  collided = true;
                  bot.stats.timesCollided += 1;
                  otherBot.stats.timesCollided += 1;
                  bot.logger.trace('Collided with bot');
                  otherBot.logger.trace('Collided with bot');
                  if (bot.handlers[Event.COLLIDED]) {
                    bot.handlers[Event.COLLIDED]({
                      angle: toRelativeBearing(angle, bot.orientation),
                      friendly: otherProcess.getAppId() === process.getAppId(),
                    });
                  }
                  if (otherBot.handlers[Event.COLLIDED]) {
                    otherBot.handlers[Event.COLLIDED]({
                      angle: toRelativeBearing(
                        normalizeAngle(180 + angle),
                        otherBot.orientation
                      ),
                      friendly: otherProcess.getAppId() === process.getAppId(),
                    });
                  }
                }
              }
            })
          );

          // Detect if we have been hit by another bot's bullets
          env.getProcesses().forEach((otherProcess) =>
            otherProcess.bots.forEach((otherBot) => {
              if (otherBot.id !== bot.id) {
                otherBot.bullets
                  .filter((bullet) => !bullet.exploded)
                  .forEach((bullet) => {
                    const distance = Math.sqrt(
                      Math.pow(bullet.x - bot.x, 2) +
                        Math.pow(bullet.y - bot.y, 2)
                    );
                    const angle: number = normalizeAngle(
                      Math.atan2(
                        bot.y - bullet.origin.y,
                        bot.x - bullet.origin.x
                      ) *
                        (180 / Math.PI) -
                        90
                    );

                    if (distance < 32) {
                      // We have a hit
                      if (bot.handlers[Event.HIT]) {
                        bot.handlers[Event.HIT]({
                          angle: toRelativeBearing(
                            normalizeAngle(angle + 180),
                            bot.orientation
                          ),
                        });
                      }

                      bot.health -= 25;
                      bot.stats.timesHit += 1;
                      otherBot.stats.shotsHit += 1;

                      bullet.exploded = true;
                      if (bullet.callback) bullet.callback({ id: bot.id });

                      env.emit('event', {
                        type: 'botDamaged',
                        id: bot.id,
                        time: env.getTime(),
                        health: bot.health,
                      });
                      env.emit('event', {
                        type: 'bulletExploded',
                        time: env.getTime(),
                        id: bullet.id,
                        botId: bot.id,
                        x: bullet.x,
                        y: bullet.y,
                      });
                    }
                  });
              }
            })
          );

          // Detect if we are at the edge of the arena
          const arenaWidth = env.getArena().getWidth();
          const arenaHeight = env.getArena().getHeight();
          if (
            newX < 16 ||
            newX > arenaWidth - 16 ||
            newY < 16 ||
            newY > arenaHeight - 16
          ) {
            collided = true;
            bot.stats.timesCollided += 1;
            bot.logger.trace('Collided with arena boundary');
            if (bot.handlers[Event.COLLIDED]) {
              // Point a unit vector at whichever boundary/boundaries we crossed
              // (west/east on x, north/south on y — both on a corner), then report
              // the bearing to that wall relative to our heading, exactly as a bot
              // collision reports the bearing to the other bot. A head-on hit still
              // yields 0 (dead ahead); a glancing or corner hit is now meaningful.
              // `friendly` is intentionally omitted for a wall (undefined — the
              // thing we hit isn't a bot, so it's neither a teammate nor an enemy).
              const wallX = newX < 16 ? -1 : newX > arenaWidth - 16 ? 1 : 0;
              const wallY = newY < 16 ? -1 : newY > arenaHeight - 16 ? 1 : 0;
              const wallAngle = normalizeAngle(
                Math.atan2(wallY, wallX) * (180 / Math.PI) - 90
              );
              bot.handlers[Event.COLLIDED]({
                angle: toRelativeBearing(wallAngle, bot.orientation),
              });
            }
          }

          // If there wasn't a collision, continue the movement
          if (!collided) {
            // Update the location
            bot.x = newX;
            bot.y = newY;

            bot.stats.distanceTraveled += bot.speed;

            // Manage acceleration / deceleration
            if (bot.speed > bot.speedTarget) bot.speed -= bot.speedAcceleration;
            if (bot.speed < bot.speedTarget) bot.speed += bot.speedAcceleration;
            if (Math.abs(bot.speed - bot.speedTarget) < bot.speedAcceleration)
              bot.speed = bot.speedTarget;
            bot.speed = Math.max(
              -bot.speedMax,
              Math.min(bot.speedMax, bot.speed)
            );
          } else {
            bot.speedTarget = 0;
            bot.speed = 0;
            bot.health -= 1;
            // Handle a collision
            env.emit('event', {
              type: 'botStop',
              time: env.getTime(),
              id: bot.id,
              x: bot.x,
              y: bot.y,
            });
            env.emit('event', {
              type: 'botDamaged',
              time: env.getTime(),
              id: bot.id,
              health: bot.health,
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
          bot.orientation = rotate(
            bot.orientation,
            bot.orientationTarget,
            bot.orientationVelocity
          );

          // Rotate the turret
          bot.turret.orientation = rotate(
            bot.turret.orientation,
            bot.turret.orientationTarget,
            bot.turret.orientationVelocity
          );

          // Rotate the radar
          bot.turret.radar.orientation = rotate(
            bot.turret.radar.orientation,
            bot.turret.radar.orientationTarget,
            bot.turret.radar.orientationVelocity
          );
        }

        // Move our bullets
        bot.bullets.forEach((bullet, bulletIndex, bullets) => {
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
              // Went outside the arena without hitting anyone — the shooter is
              // penalized 3 health for the missed shot, then the bullet is
              // removed. (Elimination at health <= 0 is handled in
              // Environment.tick, so a miss can be a self-inflicted killing blow.)
              bot.health -= 3;
              env.emit('event', {
                type: 'bulletRemoved',
                time: env.getTime(),
                id: bullet.id,
                botId: bot.id,
              });
              env.emit('event', {
                type: 'botDamaged',
                id: bot.id,
                time: env.getTime(),
                health: bot.health,
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
