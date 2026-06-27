import Arena from '../types/arena';
import PointInTime from '../types/pointInTime';
import Simulate from './simulate';

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
      Simulate(
        arena.clock.time,
        arena.apps,
        750, //todo get this from the server
        750
      );
      arena.clock.time = data.time;
    }
  } else if (data.type === 'tankTurn') {
    apps.forEach((app) =>
      app.tanks
        .filter((tank) => tank.id === data.id)
        .forEach((tank) => {
          tank.bodyOrientationTarget = data.bodyOrientationTarget;
          tank.bodyOrientationVelocity = data.bodyOrientationVelocity;
          tank.x = data.x;
          tank.y = data.y;
        })
    );
  } else if (data.type === 'tankAccelerate') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) => {
        if (tank.id === data.id) {
          tank.speed = data.speed;
          tank.speedTarget = data.speedTarget;
          tank.speedAcceleration = data.speedAcceleration;
          tank.speedMax = data.speedMax;
          tank.x = data.x;
          tank.y = data.y;
        }
      })
    );
  } else if (data.type === 'tankStop') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) => {
        if (tank.id === data.id) {
          tank.speed = 0;
          tank.speedTarget = 0;
          tank.x = data.x;
          tank.y = data.y;
        }
      })
    );
  } else if (data.type === 'radarScan') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) => {
        if (tank.id === data.id) {
          tank.radarOn = true;
          setTimeout(() => (tank.radarOn = false), 200);
        }
      })
    );
  } else if (data.type === 'radarTurn') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) => {
        if (tank.id === data.id) {
          tank.radarOrientationTarget = data.radarOrientationTarget;
          tank.radarOrientationVelocity = data.radarOrientationVelocity;
        }
      })
    );
  } else if (data.type === 'tankDamaged') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) => {
        if (tank.id === data.id) {
          tank.health = data.health;
          if (tank.health <= 0) {
            tank.speed = 0;
            tank.speedTarget = 0;
          }
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
    const index = apps.findIndex((app) => app && app.id === data.id);
    if (index >= 0) {
      apps.splice(index, 1);
    }
    apps.push({
      id: data.id,
      name: data.name,
      tanks: [],
    });
  } else if (data.type === 'arenaRemoveTank') {
    apps
      .filter((app) => app.id === data.appId)
      .forEach((app) => {
        const tankIndex = app.tanks.findIndex((tank) => tank.id === data.id);
        if (tankIndex >= 0) {
          app.tanks.splice(tankIndex, 1);
        }
      });
  } else if (data.type === 'arenaPlaceTank') {
    apps
      .filter((app) => app.id === data.appId)
      .forEach((app) => {
        if (!app.tanks.find((t) => t.id === data.id)) {
          const tank = {
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
          tank.path[0] = {
            x: data.x,
            y: data.y,
            time,
          };
          tank.pathIndex = 1;
          app.tanks.push(tank);
        }
      });
  } else if (data.type === 'turretTurn') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) => {
        if (tank.id === data.id) {
          tank.turretOrientationTarget = data.turretOrientationTarget;
          tank.turretOrientationVelocity = data.turretOrientationVelocity;
        }
      })
    );
  } else if (data.type === 'bulletFired') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) => {
        if (!tank.bullets.find((bullet) => bullet.id === data.id)) {
          if (tank.id === data.tankId) {
            tank.bullets.push({
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
      app.tanks.forEach((tank) =>
        tank.bullets.forEach((bullet, bulletIndex, bullets) => {
          if (bullet.id === data.id) {
            bullets.splice(bulletIndex, 1);
          }
        })
      )
    );
  } else if (data.type === 'bulletExploded') {
    apps.forEach((app) =>
      app.tanks.forEach((tank) =>
        tank.bullets.forEach((bullet) => {
          if (bullet.id === data.id) {
            bullet.explodedAt = data.time;
          }
        })
      )
    );
  }

  return arena;
}
