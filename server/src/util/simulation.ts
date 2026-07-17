import { Event } from '../types/event';
import { timerTick } from './scheduleFactory';
import Environment from '../types/environment';
// Type-only: Process is declared in environment.ts, which imports this module.
// `import type` is erased at compile time, so the cycle never exists at runtime.
import type { Process } from '../types/environment';
import type Bot from '../types/bot';
import {
  BOT_RADIUS,
  BOT_MAX_SPEED,
  BOT_ACCELERATION,
  COLLISION_MIN_CLOSING_SPEED,
  COLLISION_DAMAGE_FACTOR,
} from '../types/bot';
import { TURRET_RELOAD_RATE } from '../types/botTurret';
import { RADAR_CHARGE_RATE } from '../types/botRadar';
import { BULLET_DAMAGE, BULLET_MISS_PENALTY } from '../types/bullet';
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

          if (bot.turret.loaded < 100) bot.turret.loaded += TURRET_RELOAD_RATE;
          if (bot.turret.radar.charged < 100)
            bot.turret.radar.charged += RADAR_CHARGE_RATE;
        });
    });

    // Then handle movement and interactions
    env.getProcesses().forEach((process) => {
      process.bots.forEach((bot) => {
        if (bot.health > 0) {
          const startX = bot.x;
          const startY = bot.y;
          const newX =
            bot.x + bot.speed * Math.sin(-bot.orientation * (Math.PI / 180));
          const newY =
            bot.y + bot.speed * Math.cos(-bot.orientation * (Math.PI / 180));

          // Detect if we have collided with another bot. Rather than freezing on
          // contact (which used to lock two bots together until one died), we push
          // apart from the deepest overlap along the line joining the two centers
          // and keep our speed/intent — so a glancing hit slides past instead of
          // deadlocking. `contacts` records who we overlap this tick so impact
          // damage only lands on the tick a contact begins (see `bot.contacts`).
          const contacts = new Set<string>();
          // `null as ...` (rather than a plain annotation) keeps the type wide:
          // separation is only reassigned inside the forEach callback below, which
          // control-flow analysis ignores, so a plain `= null` would narrow it to
          // `null` and break the `if (separation)` checks further down.
          let separation = null as {
            x: number;
            y: number;
            closingSpeed: number;
            fresh: boolean;
          } | null;
          let deepestOverlap = BOT_RADIUS * 2;

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

                if (distance < BOT_RADIUS * 2) {
                  contacts.add(otherBot.id);
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

                  // Resolve against the deepest overlap this tick.
                  if (distance < deepestOverlap) {
                    deepestOverlap = distance;

                    // Unit normal pointing from the other bot toward us, falling
                    // back to our pre-move position, then a fixed axis, if the two
                    // centers coincide exactly (degenerate, but keeps the push
                    // finite).
                    let normalX = newX - otherBot.x;
                    let normalY = newY - otherBot.y;
                    let normalLength = Math.sqrt(
                      normalX * normalX + normalY * normalY
                    );
                    if (normalLength === 0) {
                      normalX = startX - otherBot.x;
                      normalY = startY - otherBot.y;
                      normalLength = Math.sqrt(
                        normalX * normalX + normalY * normalY
                      );
                    }
                    if (normalLength === 0) {
                      normalX = 1;
                      normalY = 0;
                      normalLength = 1;
                    }
                    const unitX = normalX / normalLength;
                    const unitY = normalY / normalLength;

                    // Closing speed = how fast the gap is shrinking = the pair's
                    // relative velocity projected onto the separating axis.
                    const velX =
                      bot.speed * Math.sin(-bot.orientation * (Math.PI / 180));
                    const velY =
                      bot.speed * Math.cos(-bot.orientation * (Math.PI / 180));
                    const otherVelX =
                      otherBot.speed *
                      Math.sin(-otherBot.orientation * (Math.PI / 180));
                    const otherVelY =
                      otherBot.speed *
                      Math.cos(-otherBot.orientation * (Math.PI / 180));
                    const closingSpeed = -(
                      (velX - otherVelX) * unitX +
                      (velY - otherVelY) * unitY
                    );

                    separation = {
                      // Place us exactly at contact distance along the normal, out
                      // of the overlap. The other bot resolves symmetrically on its
                      // own turn in this same loop.
                      x: otherBot.x + unitX * BOT_RADIUS * 2,
                      y: otherBot.y + unitY * BOT_RADIUS * 2,
                      closingSpeed,
                      fresh: !bot.contacts?.has(otherBot.id),
                    };
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

                    // A bullet lands anywhere within one tank width (two
                    // radii) of the target's center.
                    if (distance < BOT_RADIUS * 2) {
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
                      const dealt = damage(bot, BULLET_DAMAGE, otherBot);
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
          let hitWall = false;
          if (
            newX < BOT_RADIUS ||
            newX > arenaWidth - BOT_RADIUS ||
            newY < BOT_RADIUS ||
            newY > arenaHeight - BOT_RADIUS
          ) {
            hitWall = true;
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
              const wallX =
                newX < BOT_RADIUS ? -1 : newX > arenaWidth - BOT_RADIUS ? 1 : 0;
              const wallY =
                newY < BOT_RADIUS
                  ? -1
                  : newY > arenaHeight - BOT_RADIUS
                    ? 1
                    : 0;
              const wallAngle = normalizeAngle(
                Math.atan2(wallY, wallX) * (180 / Math.PI) - 90
              );
              bot.handlers[Event.COLLIDED]({
                angle: toRelativeBearing(wallAngle, bot.orientation),
              });
            }
          }

          if (hitWall) {
            // A wall can't yield: stop dead where we are, as before. The
            // unattributed 1 damage is applied once (a wall has no shooter, so
            // passing null credits nobody for the collision death).
            bot.speedTarget = 0;
            bot.speed = 0;
            damage(bot, 1, null);
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
          } else {
            // Move — to the separated position if we overlapped another bot,
            // otherwise freely to the candidate position.
            if (separation) {
              // Clamp the push inside the arena so it can never shove us through a
              // wall (any residual overlap resolves over the next tick or two).
              bot.x = Math.max(
                BOT_RADIUS,
                Math.min(arenaWidth - BOT_RADIUS, separation.x)
              );
              bot.y = Math.max(
                BOT_RADIUS,
                Math.min(arenaHeight - BOT_RADIUS, separation.y)
              );
              bot.stats.distanceTraveled += Math.sqrt(
                Math.pow(bot.x - startX, 2) + Math.pow(bot.y - startY, 2)
              );
            } else {
              bot.x = newX;
              bot.y = newY;
              bot.stats.distanceTraveled += bot.speed;
            }

            // Manage acceleration / deceleration. Crucially we do NOT zero the
            // speed target on a bot collision (as the wall does), so a bumped bot
            // keeps driving and can work itself free instead of deadlocking.
            if (bot.speed > bot.speedTarget) bot.speed -= BOT_ACCELERATION;
            if (bot.speed < bot.speedTarget) bot.speed += BOT_ACCELERATION;
            if (Math.abs(bot.speed - bot.speedTarget) < BOT_ACCELERATION)
              bot.speed = bot.speedTarget;
            bot.speed = Math.max(
              -BOT_MAX_SPEED,
              Math.min(BOT_MAX_SPEED, bot.speed)
            );

            if (separation) {
              // Impact damage, once per contact, scaled by how fast we were
              // closing — a gentle touch is free, a hard ram hurts. Unattributed
              // like every other collision (no ram-kill credit; see `damage`).
              if (
                separation.fresh &&
                separation.closingSpeed > COLLISION_MIN_CLOSING_SPEED
              ) {
                damage(
                  bot,
                  separation.closingSpeed * COLLISION_DAMAGE_FACTOR,
                  null
                );
                env.emit('event', {
                  type: 'botDamaged',
                  time: env.getTime(),
                  id: bot.id,
                  health: bot.health,
                });
              }

              // The UI dead-reckons bot positions between events and has no
              // per-tick position update, so tell it where the push actually left
              // us. We reuse botAccelerate (speed unchanged — unlike the wall's
              // botStop) rather than snapping the bot to a halt on the client.
              env.emit('event', {
                type: 'botAccelerate',
                time: env.getTime(),
                id: bot.id,
                x: bot.x,
                y: bot.y,
                speed: bot.speed,
                speedTarget: bot.speedTarget,
                speedAcceleration: BOT_ACCELERATION,
                speedMax: BOT_MAX_SPEED,
              });
            }
          }

          // Remember who we are touching this tick so impact damage lands only on
          // the tick a contact begins, not every tick two bots stay pressed
          // together.
          bot.contacts = contacts;

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
              damage(bot, BULLET_MISS_PENALTY, null);
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
