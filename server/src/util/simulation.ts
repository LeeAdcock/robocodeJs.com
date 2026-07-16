import { Event } from '../types/event';
import { timerTick } from './scheduleFactory';
import Environment from '../types/environment';
// Type-only: Process is declared in environment.ts, which imports this module.
// `import type` is erased at compile time, so the cycle never exists at runtime.
import type { Process } from '../types/environment';
import type Bot from '../types/bot';
import { normalizeAngle, toRelativeBearing } from './geometry';

/*
  These functions calculate the changes and interaction between active
  elements in the arena, specifically bots and their bullets.
*/

// Apply `amount` damage to `bot` and record who did it (`source`, or null when the
// cause has no attributable enemy: a collision, the arena wall, the bot's own
// missed shot, sudden-death decay, or a crash).
//
// Only a blow that finds the bot ALIVE counts or changes attribution. Health is
// allowed to go negative and several damage events can land on one bot in a single
// tick — the enclosing `health > 0` checks are made once per tick, and a dead bot's
// bullets keep flying and still penalize it for missing — so without this guard a
// hit on an already-dead bot would both over-count damage and overwrite
// lastDamagedBy, stealing the kill from whoever actually landed the killing blow.
// Once a bot is dead its attribution is frozen, which is exactly what "the last hit
// that took it to <= 0" means.
//
// The health arithmetic itself is deliberately left untouched (it still runs for a
// dead bot, and still goes negative): match ranking sums totalHealth, so changing
// it would change match outcomes.
const damage = (bot: Bot, amount: number, source: Bot | null): number => {
  const wasAlive = bot.health > 0;
  const dealt = wasAlive ? Math.min(amount, bot.health) : 0;
  bot.health -= amount;
  if (wasAlive) {
    bot.stats.damageTaken += dealt;
    bot.lastDamagedBy = source;
  }
  return dealt;
};

// Record the tick each bot died — crash, bullet, collision, self-inflicted miss,
// or sudden-death decay — and credit the kill when one is owed. Called once per
// tick by Environment.tick, AFTER decay, so it sees each bot's final health and
// final attribution for the tick.
//
// The eliminatedAt === null guard is the once-latch: a bot is processed on the
// first tick it is found dead and never again, so a kill can't be double-counted.
// Read-only for the physics — this never feeds back into the simulation.
export const applyEliminations = (processes: Process[], time: number): void => {
  for (const process of processes) {
    for (const bot of process.bots) {
      if (bot.health > 0 || bot.eliminatedAt !== null) continue;
      bot.eliminatedAt = time;

      // Credit the last-hit shooter, but only a genuine enemy: an unattributed
      // death (collision, decay, crash, own missed shot) leaves lastDamagedBy
      // null, and friendly fire — including shooting yourself — earns no kill
      // even though the damage was recorded. A dead shooter still gets credit
      // for a bullet that was already in flight, which is correct.
      const killer = bot.lastDamagedBy;
      if (killer && killer.process.getAppId() !== process.getAppId()) {
        killer.stats.kills += 1;
      }
    }
  }
};

export default {
  // Handles all object movement
  run: (env: Environment) => {
    // Process any bots whose software crashed
    env.getProcesses().forEach((process) => {
      process.bots
        .filter((bot) => bot.health > 0 && bot.appCrashed)
        .forEach((bot) => {
          bot.health = 0;
          // A crash is a forfeit, not damage: nobody dealt it, so it credits no
          // kill and counts toward no damage total.
          bot.lastDamagedBy = null;
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

          if (bot.turret.loaded < 100) bot.turret.loaded += 2.5;
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

                      // The last-hit rule: whoever landed this shot is on the hook
                      // for the kill if the bot doesn't recover. Friendly fire is
                      // recorded here too — it really happened — but applyEliminations
                      // refuses to credit it as a kill.
                      const dealt = damage(bot, 25, otherBot);
                      bot.stats.timesHit += 1;
                      otherBot.stats.shotsHit += 1;
                      otherBot.stats.damageDealt += dealt;

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
            // Collision damage is deliberately unattributed: `collided` is set by
            // both the bot-bot branch above and the arena-boundary branch, and the
            // penalty is applied once without knowing which — so there is no ram
            // kill credit. Passing null (rather than leaving a stale shooter) is
            // what makes a collision death credit nobody.
            damage(bot, 1, null);
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
              // Self-inflicted, so nobody is credited. This runs for dead bots too
              // — their bullets stay in flight — but `damage` freezes a dead bot's
              // attribution, so a corpse's stray miss can't rob its killer.
              damage(bot, 3, null);
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
