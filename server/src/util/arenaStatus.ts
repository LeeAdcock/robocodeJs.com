import Environment, { DEPLOY_TICKS } from '../types/environment';
import ArenaMember from '../types/arenaMember';
import appService from '../services/AppService';

// Builds the arena status snapshot returned by the REST status endpoints and the
// MCP `arena_status` tool. Previously this object was constructed inline in both
// api/arena.ts and api/demo.ts; centralizing it keeps the wire shape in one place
// (the UI and the client-side interpolator depend on it).
//
// Processes are ordered by when their app joined the arena so the output is
// stable across calls.
export const buildArenaStatus = async (
  env: Environment,
  members: ArenaMember[]
) => {
  const arena = env.getArena();
  const apps = await Promise.all(
    members.map((member) => appService.get(member.getAppId()))
  );

  return {
    height: arena.getHeight(),
    width: arena.getWidth(),
    running: env.isRunning(),
    // Current simulation speed so a bootstrapping client can pace playback to the
    // server's rate. `speed` is the multiplier (0 = unbounded); `tickMs` is the
    // matching target ms/tick (0 = as fast as possible).
    speed: env.getSpeed(),
    tickMs: env.getTickMs(),
    // Current PRNG seed for reproducible match setup (see Environment.setSeed).
    seed: env.getSeed(),
    // Tick at which the damage-free deployment window ends and turrets go live.
    // The UI shows a countdown while clock.time < deployTick.
    deployTick: DEPLOY_TICKS,
    clock: { time: env.getTime() },
    apps: env
      .getProcesses()
      .sort(
        (a, b) =>
          (members
            .find((member) => member?.getAppId() === a.appId)
            ?.getTimestamp() || 0) -
          (members
            .find((member) => member?.getAppId() === b.appId)
            ?.getTimestamp() || 0)
      )
      .map((process) => ({
        id: process.getAppId(),
        name: apps.find((app) => app?.getId() === process.appId)?.getName(),
        userId: apps.find((app) => app?.getId() === process.appId)?.getUserId(),
        addedTimestamp: members
          .find((member) => member?.getAppId() === process.appId)
          ?.getTimestamp(),
        bots: process.bots.map((bot) => ({
          id: bot.id,
          x: bot.x,
          y: bot.y,
          speed: bot.speed,
          speedTarget: bot.speedTarget,
          speedAcceleration: bot.speedAcceleration,
          speedMax: bot.speedMax,
          bodyOrientation: bot.orientation,
          bodyOrientationTarget: bot.orientationTarget,
          bodyOrientationVelocity: bot.orientationVelocity,
          turretOrientation: bot.turret.orientation,
          turretOrientationTarget: bot.turret.orientationTarget,
          turretOrientationVelocity: bot.turret.orientationVelocity,
          radarOrientation: bot.turret.radar.orientation,
          radarOrientationTarget: bot.turret.radar.orientationTarget,
          radarOrientationVelocity: bot.turret.radar.orientationVelocity,
          health: bot.health,
          // Whether the bot crashed (vs. died in combat) — lets a client / AI tell
          // a fault-death from a bullet-death. Detail is in the fault feed.
          crashed: bot.appCrashed,
          // Only live bullets, and include orientation/speed so a client that
          // bootstraps from this snapshot (a reload, or a freshly connected SSE
          // client) can both render the bullet (it rotates by orientation) and
          // interpolate its motion. Omitting them left snapshot bullets with an
          // undefined orientation — an invalid SVG transform that the browser
          // drops, stranding the sprite at (0,0). Spent (exploded) bullets are
          // excluded so they don't re-seed as immovable orphans.
          bullets: bot.bullets
            .filter((bullet) => !bullet.exploded)
            .map((bullet) => ({
              id: bullet.id,
              x: bullet.x,
              y: bullet.y,
              orientation: bullet.orientation,
              speed: bullet.speed,
            })),
        })),
      })),
  };
};
