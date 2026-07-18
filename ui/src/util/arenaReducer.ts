import Arena from '../types/arena';
import PointInTime from '../types/pointInTime';
import Simulate, { recordTrailPoint } from './simulate';

// Applies a single Server-Sent-Event from the arena stream to the arena state.
//
// This mutates `arena` in place and returns it (the App keeps the same object
// reference and re-renders are driven by the tick/pause state updates), matching
// the original inline reducer. It handles only the events that transform arena
// state; purely React-state side effects (setTime, setPaused, setUser, restart)
// stay in the component. Kept free of React so it can be unit-tested directly.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function applyArenaEvent(arena: Arena, data: any, time: number) {
  const apps = arena.apps;

  if (data.type === 'tick') {
    if (arena.clock.time !== data.time) {
      // Arena dimensions come from the server status snapshot (always present
      // after bootstrap); fall back to the 750² default if a tick somehow lands
      // before the first snapshot.
      Simulate(
        arena.clock.time,
        arena.apps,
        arena.width || 750,
        arena.height || 750
      );
      arena.clock.time = data.time;
    }
  } else if (data.type === 'botTurn') {
    apps.forEach((app) =>
      app.bots
        .filter((bot) => bot.id === data.id)
        .forEach((bot) => {
          bot.bodyOrientationTarget = data.bodyOrientationTarget;
          bot.bodyOrientationVelocity = data.bodyOrientationVelocity;
          bot.x = data.x;
          bot.y = data.y;
        })
    );
  } else if (data.type === 'botAccelerate') {
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (bot.id === data.id) {
          bot.speed = data.speed;
          bot.speedTarget = data.speedTarget;
          bot.speedAcceleration = data.speedAcceleration;
          bot.speedMax = data.speedMax;
          bot.x = data.x;
          bot.y = data.y;
          // A collision nudge moves the bot sideways without a heading change, so
          // the client's own interpolation (which only records vertices on a turn)
          // would never capture it — the trail would cut the corner once the bot
          // drives on. Record the landing point so the polyline kinks at the bump.
          if (data.nudged) {
            recordTrailPoint(bot, data.x, data.y, time);
          }
        }
      })
    );
  } else if (data.type === 'botStop') {
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (bot.id === data.id) {
          bot.speed = 0;
          bot.speedTarget = 0;
          bot.x = data.x;
          bot.y = data.y;
        }
      })
    );
  } else if (data.type === 'radarScan') {
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (bot.id === data.id) {
          bot.radarOn = true;
          setTimeout(() => (bot.radarOn = false), 200);
        }
      })
    );
  } else if (data.type === 'radarTurn') {
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (bot.id === data.id) {
          bot.radarOrientationTarget = data.radarOrientationTarget;
          bot.radarOrientationVelocity = data.radarOrientationVelocity;
        }
      })
    );
  } else if (data.type === 'botDamaged') {
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (bot.id === data.id) {
          // Stamp the hit (wall-clock) so the arena can pulse a damage glow.
          // Only on an actual health drop, so no-op/heal events don't flash.
          const delta = bot.health - data.health;
          if (delta > 0) {
            bot.lastDamagedAt = performance.now();
            bot.lastDamageAmount = delta;
          }
          bot.health = data.health;
          if (bot.health <= 0) {
            bot.speed = 0;
            bot.speedTarget = 0;
          }
        }
      })
    );
  } else if (data.type === 'botFault') {
    // A bot crashed — flag the bot so the arena can show a warning triangle.
    // (Cleared naturally when the bot is re-placed on reboot/restart.)
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (bot.id === data.botId) {
          bot.crashed = true;
          bot.faultCode = data.code;
        }
      })
    );
  } else if (data.type === 'appRenamed') {
    const app = apps.find((app) => app.id === data.appId);
    if (app && app.name !== data.name) {
      app.name = data.name;
    }
  } else if (data.type === 'arenaRemoveApp') {
    const index = apps.findIndex((app) => app.id === data.id);
    if (index >= 0) {
      apps.splice(index, 1);
    }
  } else if (data.type === 'arenaPlaceApp') {
    // Non-destructive: if the app is already present (from the REST snapshot or a
    // prior/lazy placement), just refresh its name — do NOT recreate it with an
    // empty bots array, which used to wipe bots when the SSE replay landed after
    // the snapshot. A first-time app is created empty for its bots to attach to.
    const existing = apps.find((app) => app && app.id === data.id);
    if (existing) {
      existing.name = data.name;
    } else {
      apps.push({
        id: data.id,
        name: data.name,
        bots: [],
      });
    }
  } else if (data.type === 'arenaRemoveBot') {
    apps
      .filter((app) => app.id === data.appId)
      .forEach((app) => {
        const botIndex = app.bots.findIndex((bot) => bot.id === data.id);
        if (botIndex >= 0) {
          app.bots.splice(botIndex, 1);
        }
      });
  } else if (data.type === 'arenaPlaceBot') {
    // Order-independent: if the bot's app hasn't been placed yet (e.g. its
    // arenaPlaceApp is still in flight), create a placeholder app now so the bot
    // isn't dropped. A later arenaPlaceApp fills in the real name (see above).
    let app = apps.find((a) => a.id === data.appId);
    if (!app) {
      app = { id: data.appId, name: '', bots: [] };
      apps.push(app);
    }
    if (!app.bots.find((t) => t.id === data.id)) {
      const bot = {
        id: data.id,
        speed: data.speed,
        speedTarget: 0,
        speedAcceleration: 0,
        speedMax: data.speedMax,
        bodyOrientation: data.bodyOrientation,
        bodyOrientationTarget: data.bodyOrientation,
        bodyOrientationVelocity: data.bodyOrientationVelocity,
        turretOrientation: data.turretOrientation,
        turretOrientationTarget: data.turretOrientation,
        turretOrientationVelocity: data.turretOrientationVelocity,
        radarOrientation: data.radarOrientation,
        radarOrientationTarget: data.radarOrientation,
        radarOrientationVelocity: data.radarOrientationVelocity,
        radarOn: false,
        bullets: [],
        health: 100,
        path: Array<PointInTime>(20),
        pathIndex: 0,
        x: data.x,
        y: data.y,
      };
      bot.path[0] = {
        x: data.x,
        y: data.y,
        time,
      };
      bot.pathIndex = 1;
      app.bots.push(bot);
    }
  } else if (data.type === 'turretTurn') {
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (bot.id === data.id) {
          bot.turretOrientationTarget = data.turretOrientationTarget;
          bot.turretOrientationVelocity = data.turretOrientationVelocity;
        }
      })
    );
  } else if (data.type === 'bulletFired') {
    apps.forEach((app) =>
      app.bots.forEach((bot) => {
        if (!bot.bullets.find((bullet) => bullet.id === data.id)) {
          if (bot.id === data.botId) {
            bot.bullets.push({
              id: data.id,
              x: data.x,
              y: data.y,
              orientation: data.orientation,
              origin: {
                x: data.x,
                y: data.y,
              },
              explodedAt: undefined,
              speed: data.speed,
            });
          }
        }
      })
    );
  } else if (data.type === 'bulletRemoved') {
    apps.forEach((app) =>
      app.bots.forEach((bot) =>
        bot.bullets.forEach((bullet, bulletIndex, bullets) => {
          if (bullet.id === data.id) {
            bullets.splice(bulletIndex, 1);
          }
        })
      )
    );
  } else if (data.type === 'bulletExploded') {
    apps.forEach((app) =>
      app.bots.forEach((bot) =>
        bot.bullets.forEach((bullet) => {
          if (bullet.id === data.id) {
            bullet.explodedAt = data.time;
          }
        })
      )
    );
  }

  return arena;
}
