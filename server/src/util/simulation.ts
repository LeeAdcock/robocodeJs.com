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
  COLLISION_FRICTION,
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

    // Snapshot every bot's speed before any movement resolution runs. Bots are
    // processed one at a time and collision friction mutates a bot's speed as it
    // resolves, so a later bot must read this tick-start speed (not the already-
    // frictioned live value) when computing closing speed against it — otherwise a
    // symmetric head-on would score less impact damage on whichever bot resolves
    // second.
    const tickStartSpeed = new Map<Bot, number>();
    env.getProcesses().forEach((process) => {
      process.bots.forEach((bot) => tickStartSpeed.set(bot, bot.speed));
    });

    // Directed "already told this bot about that bot" markers for this tick,
    // keyed `${observer.id}|${other.id}`. A colliding pair can be detected in both
    // bots' passes (each bot resolves its own push separately), so this guarantees
    // each side is notified at most once per tick even when both drive in together.
    const collisionsReported = new Set<string>();

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
            cosNormal: number;
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

                // Sticky contact: if we are already touching this bot at our
                // CURRENT position (not just on the projected move), remember it so
                // impact damage counts it as an ongoing contact next tick, not a
                // fresh one. Without this a pair that friction has stalled at exactly
                // contact distance separates to gap 2R, no longer "overlaps" on the
                // next projected move, and so would re-register as a fresh collision
                // and be damaged again every time it inched back in — grinding two
                // dead-centre bots to death. Impact damage and the COLLIDED handlers
                // still fire only on the projected-move overlap below; this only
                // seeds `contacts` for the freshness check.
                const currentDistance = Math.sqrt(
                  Math.pow(otherBot.x - startX, 2) +
                    Math.pow(otherBot.y - startY, 2)
                );
                if (currentDistance < BOT_RADIUS * 2 + 1e-6) {
                  contacts.add(otherBot.id);
                }

                if (distance < BOT_RADIUS * 2) {
                  contacts.add(otherBot.id);

                  // Fire COLLIDED and count the collision only on the tick the
                  // contact *begins* (a rising edge — this pair wasn't overlapping
                  // last tick), not every tick two bots stay pressed together.
                  // Otherwise bots rubbing against each other spam the handler and
                  // inflate timesCollided. This mirrors the freshness the impact
                  // damage already uses below (`separation.fresh`), so event, stat,
                  // and damage now all land once per contact.
                  //
                  // We report BOTH sides here rather than letting each bot fire in
                  // its own pass, because resolving `bot`'s push moves it to exactly
                  // contact distance from `otherBot`; on `otherBot`'s later pass the
                  // gap is no longer strictly overlapping, so it would never notify
                  // itself. Each side is edge-gated on its OWN previous-tick contact
                  // set (a rising edge — not overlapping last tick) and de-duped via
                  // `collisionsReported` so it fires exactly once per contact begin.
                  const friendly =
                    otherProcess.getAppId() === process.getAppId();
                  const botKey = `${bot.id}|${otherBot.id}`;
                  const otherKey = `${otherBot.id}|${bot.id}`;
                  if (
                    !bot.contacts?.has(otherBot.id) &&
                    !collisionsReported.has(botKey)
                  ) {
                    collisionsReported.add(botKey);
                    bot.stats.timesCollided += 1;
                    bot.logger.trace('Collided with bot');
                    if (bot.handlers[Event.COLLIDED]) {
                      bot.handlers[Event.COLLIDED]({
                        angle: toRelativeBearing(angle, bot.orientation),
                        friendly,
                      });
                    }
                  }
                  if (
                    !otherBot.contacts?.has(bot.id) &&
                    !collisionsReported.has(otherKey)
                  ) {
                    collisionsReported.add(otherKey);
                    otherBot.stats.timesCollided += 1;
                    otherBot.logger.trace('Collided with bot');
                    if (otherBot.handlers[Event.COLLIDED]) {
                      otherBot.handlers[Event.COLLIDED]({
                        angle: toRelativeBearing(
                          normalizeAngle(180 + angle),
                          otherBot.orientation
                        ),
                        friendly,
                      });
                    }
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
                    // relative velocity projected onto the separating axis. Read
                    // both speeds from the tick-start snapshot so a bot already
                    // frictioned earlier this tick still contributes its full
                    // pre-impact velocity here (see `tickStartSpeed`).
                    const botSpeed = tickStartSpeed.get(bot) ?? bot.speed;
                    const otherSpeed =
                      tickStartSpeed.get(otherBot) ?? otherBot.speed;
                    const velX =
                      botSpeed * Math.sin(-bot.orientation * (Math.PI / 180));
                    const velY =
                      botSpeed * Math.cos(-bot.orientation * (Math.PI / 180));
                    const otherVelX =
                      otherSpeed *
                      Math.sin(-otherBot.orientation * (Math.PI / 180));
                    const otherVelY =
                      otherSpeed *
                      Math.cos(-otherBot.orientation * (Math.PI / 180));
                    const closingSpeed = -(
                      (velX - otherVelX) * unitX +
                      (velY - otherVelY) * unitY
                    );

                    // Cosine of our heading against the push-away normal: our own
                    // velocity projected onto the normal, divided by our speed. It
                    // is negative when we are driving into the other bot; -1 is
                    // dead-on, 0 is a pure sideways graze. Collision friction uses
                    // it to absorb only the inward (head-on) part of our motion.
                    const speedMag = Math.sqrt(velX * velX + velY * velY);
                    const cosNormal =
                      speedMag > 0
                        ? (velX * unitX + velY * unitY) / speedMag
                        : 0;

                    separation = {
                      // Place us exactly at contact distance along the normal, out
                      // of the overlap. The other bot resolves symmetrically on its
                      // own turn in this same loop.
                      x: otherBot.x + unitX * BOT_RADIUS * 2,
                      y: otherBot.y + unitY * BOT_RADIUS * 2,
                      closingSpeed,
                      cosNormal,
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
            // Fire the wall COLLIDED and count it only when the contact begins (a
            // rising edge), mirroring the bot-vs-bot debounce above — a bot held
            // against a wall shouldn't spam the handler or inflate timesCollided
            // every tick. Impact damage is edged the same way (below); only the
            // physical stop stays level-triggered — a wall can't yield, so we hold
            // the bot at rest for as long as it's driving into it.
            if (!bot.wallContact) {
              bot.stats.timesCollided += 1;
              bot.logger.trace('Collided with arena boundary');
            }
            if (!bot.wallContact && bot.handlers[Event.COLLIDED]) {
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
            // A wall can't yield: stop dead where we are, as before. The stop is
            // level-triggered (we hold the bot at rest for as long as it drives
            // into the wall) and we always tell the UI about it.
            bot.speedTarget = 0;
            bot.speed = 0;
            env.emit('event', {
              type: 'botStop',
              time: env.getTime(),
              id: bot.id,
              x: bot.x,
              y: bot.y,
            });

            // Impact damage on the rising edge only, scaled by how fast we drove
            // into the wall — symmetric with bot-vs-bot ram damage: a graze below
            // COLLISION_MIN_CLOSING_SPEED is free, a hard crash hurts. The impact
            // speed is our velocity projected onto the wall's inward normal (not
            // our raw speed), so skimming along a wall costs nothing and only the
            // component driving into it counts, exactly as closingSpeed does for a
            // bot. Read the speed from the tick-start snapshot (bot.speed was just
            // zeroed by the stop above); the heading is unchanged this tick.
            // Unattributed like every collision (a wall has no shooter, so null
            // credits nobody for the death).
            const impactVel = tickStartSpeed.get(bot) ?? bot.speed;
            const velX =
              impactVel * Math.sin(-bot.orientation * (Math.PI / 180));
            const velY =
              impactVel * Math.cos(-bot.orientation * (Math.PI / 180));
            const wallNormalX =
              newX < BOT_RADIUS ? -1 : newX > arenaWidth - BOT_RADIUS ? 1 : 0;
            const wallNormalY =
              newY < BOT_RADIUS ? -1 : newY > arenaHeight - BOT_RADIUS ? 1 : 0;
            const wallNormalLen = Math.hypot(wallNormalX, wallNormalY) || 1;
            const impactSpeed = Math.max(
              0,
              (velX * wallNormalX + velY * wallNormalY) / wallNormalLen
            );
            if (!bot.wallContact && impactSpeed > COLLISION_MIN_CLOSING_SPEED) {
              damage(bot, impactSpeed * COLLISION_DAMAGE_FACTOR, null);
              env.emit('event', {
                type: 'botDamaged',
                time: env.getTime(),
                id: bot.id,
                health: bot.health,
              });
            }
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
              // Collision friction: shed the part of our motion that was driving
              // into the other bot, keeping the tangential slide that carries us
              // around it. `cosNormal < 0` means we were closing; the surviving
              // fraction of our speed is |sin| of the impact angle plus whatever
              // inward motion COLLISION_FRICTION lets through (0 = frictionless
              // glide, 1 = fully inelastic — a head-on ram stops dead). This scales
              // the post-acceleration speed, so speedTarget still pulls us back up
              // to intent once we work clear.
              if (separation.cosNormal < 0) {
                const inward = -separation.cosNormal;
                const kept = (1 - COLLISION_FRICTION) * inward;
                const survives = Math.sqrt(
                  Math.max(0, 1 - inward * inward + kept * kept)
                );
                bot.speed *= survives;
              }

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
              // `nudged` flags this as a collision push (not a bot's own
              // accelerate) so the client records the landing point on the bot's
              // trail — otherwise the drawn track would cut the corner.
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
                nudged: true,
              });
            }
          }

          // Remember who we are touching this tick so impact damage lands only on
          // the tick a contact begins, not every tick two bots stay pressed
          // together.
          bot.contacts = contacts;
          // Same rising-edge bookkeeping for the wall, so the wall COLLIDED fires
          // once per contact rather than every tick a bot is pinned to it.
          bot.wallContact = hitWall;

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
