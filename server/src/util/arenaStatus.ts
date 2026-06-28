import Environment from '../types/environment';
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
        tanks: process.tanks.map((tank) => ({
          id: tank.id,
          x: tank.x,
          y: tank.y,
          speed: tank.speed,
          speedTarget: tank.speedTarget,
          speedAcceleration: tank.speedAcceleration,
          speedMax: tank.speedMax,
          bodyOrientation: tank.orientation,
          bodyOrientationTarget: tank.orientationTarget,
          bodyOrientationVelocity: tank.orientationVelocity,
          turretOrientation: tank.turret.orientation,
          turretOrientationTarget: tank.turret.orientationTarget,
          turretOrientationVelocity: tank.turret.radar.orientationVelocity,
          radarOrientation: tank.turret.radar.orientation,
          radarOrientationTarget: tank.turret.radar.orientationTarget,
          radarOrientationVelocity: tank.turret.radar.orientationVelocity,
          health: tank.health,
          // Only live bullets, and include orientation/speed so a client that
          // bootstraps from this snapshot (a reload, or a freshly connected SSE
          // client) can both render the bullet (it rotates by orientation) and
          // interpolate its motion. Omitting them left snapshot bullets with an
          // undefined orientation — an invalid SVG transform that the browser
          // drops, stranding the sprite at (0,0). Spent (exploded) bullets are
          // excluded so they don't re-seed as immovable orphans.
          bullets: tank.bullets
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
