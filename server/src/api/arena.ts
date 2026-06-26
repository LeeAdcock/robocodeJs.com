import express, { Request, Response } from 'express';
import appService from '../services/AppService';
import arenaService from '../services/ArenaService';
import environmentService from '../services/EnvironmentService';
import arenaMemberService from '../services/ArenaMemberService';
import {
  loadUser,
  requireOwner,
  loadApp,
  resolveArena,
  scopedUser,
  scopedApp,
  scopedArena,
} from '../middleware/resource';

const app = express();

// Caps the number of arenas a single user can create. Each arena is an
// in-memory, isolate-backed Environment, so this bounds EnvironmentService's
// store; idle arenas are also GC'd 30 minutes after they stop.
const MAX_ARENAS_PER_USER = 10;

// Arena action routes are exposed at two paths that share one handler:
//   /api/user/:userId/arena<suffix>             -> the user's default arena (UI)
//   /api/user/:userId/arenas/:arenaId<suffix>   -> a specific arena (tooling)
// resolveArena picks the right arena for each; the UI only ever uses the first.
const dual = (suffix: string) => [
  `/api/user/:userId/arena${suffix}`,
  `/api/user/:userId/arenas/:arenaId${suffix}`,
];

// List a user's arenas (ids only) — the entry point for tooling that drives
// multiple arenas. The UI does not use this.
app.get('/api/user/:userId/arenas', loadUser, async (req, res) => {
  const user = scopedUser(req);
  const arenas = await arenaService.getForUser(user.getId());
  res.status(200);
  res.send(arenas.map((arena) => ({ id: arena.getId() })));
});

// Create a new arena for the user, up to MAX_ARENAS_PER_USER.
app.post(
  '/api/user/:userId/arenas',
  loadUser,
  requireOwner,
  async (req, res) => {
    const user = scopedUser(req);
    const existing = await arenaService.getForUser(user.getId());
    if (existing.length >= MAX_ARENAS_PER_USER) {
      res.status(400);
      res.send('Arena limit reached');
      return;
    }
    const arena = await arenaService.create(user.getId());
    res.status(201);
    res.send({ id: arena.getId() });
  }
);

// Delete an arena: tear down its live environment, then its members and row.
app.delete(
  '/api/user/:userId/arenas/:arenaId',
  loadUser,
  requireOwner,
  resolveArena,
  async (req, res) => {
    const arena = scopedArena(req);
    await environmentService.dispose(arena.getId());
    await arenaMemberService.deleteForArena(arena.getId());
    await arenaService.delete(arena.getId());
    res.status(200);
    res.send();
  }
);

// Get an arena status
const getStatus = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  const env = await environmentService.get(arena);

  const members = await arenaMemberService.getForArena(arena.getId());

  const apps = await Promise.all(
    members.map((member) => appService.get(member.getAppId()))
  );

  res.status(200);
  res.send({
    height: arena.getHeight(),
    width: arena.getWidth(),
    running: env.isRunning(),
    clock: { time: env.getTime() },
    apps: env
      .getProcesses()
      .sort((a, b) => {
        return (
          (members
            .find((member) => member?.getAppId() === a.appId)
            ?.getTimestamp() || 0) -
          (members
            .find((member) => member?.getAppId() === b.appId)
            ?.getTimestamp() || 0)
        );
      })
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
          bullets: tank.bullets.map((bullet) => ({
            id: bullet.id,
            x: bullet.x,
            y: bullet.y,
            exploded: bullet.exploded,
          })),
        })),
      })),
  });
};
app.get(dual(''), loadUser, resolveArena, getStatus);

// Remove an app from an arena
const removeApp = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  const members = await arenaMemberService.getForArena(arena.getId());

  const member = members.find(
    (member) => member.getAppId() === req.params.appId
  );
  if (!member) {
    res.status(404);
    res.send('Invalid app id');
    return;
  }
  (await environmentService.getByArenaId(arena.getId()))?.removeApp(
    req.params.appId
  );
  return member.delete().then(() => {
    res.status(200);
    res.send();
  });
};
app.delete(
  dual('/app/:appId'),
  loadUser,
  requireOwner,
  resolveArena,
  removeApp
);

// Add an app to an arena
const addApp = async (req: Request, res: Response) => {
  const app = scopedApp(req);
  const arena = scopedArena(req);

  const members = await arenaMemberService.getForArena(arena.getId());
  if (members.length > 4) {
    res.status(400);
    res.send('Arena limit reached');
    return;
  }

  const env = await environmentService.get(arena);
  env.addApp(app);
  return arenaMemberService.create(arena.getId(), app.getId()).then(() => {
    res.status(201);
    res.send();
  });
};
app.put(
  dual('/app/:appId'),
  loadUser,
  requireOwner,
  loadApp,
  resolveArena,
  addApp
);

const restart = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  return environmentService
    .get(arena)
    .then((env) => env.restart())
    .then(() => {
      res.status(200);
      res.send();
    });
};
app.post(dual('/restart'), loadUser, requireOwner, resolveArena, restart);

const pause = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  return environmentService
    .get(arena)
    .then((env) => env.pause())
    .then(() => {
      res.status(200);
      res.send();
    });
};
app.post(dual('/pause'), loadUser, requireOwner, resolveArena, pause);

const resume = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  return environmentService
    .get(arena)
    .then((env) => env.resume())
    .then(() => {
      res.status(200);
      res.send();
    });
};
app.post(dual('/resume'), loadUser, requireOwner, resolveArena, resume);

// Listen to an arena's game events
const events = async (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });

  function listener(event: unknown) {
    res.write('data: ' + JSON.stringify(event) + '\n\n');
  }

  const arena = scopedArena(req);
  return environmentService.get(arena).then((env) => {
    env.addListener('event', listener);
    req.on('close', () => {
      env.removeListener('event', listener);
      res.end();
    });
  });
};
app.get(dual('/events'), loadUser, resolveArena, events);

// Listen to an arena's bot console logs
const logs = async (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });

  function listener(event: unknown) {
    res.write('data: ' + JSON.stringify(event) + '\n\n');
  }

  const arena = scopedArena(req);
  return environmentService.get(arena).then((env) => {
    env.addListener('log', listener);

    req.on('close', () => {
      env.removeListener('log', listener);
      res.end();
    });
  });
};
app.get(dual('/logs'), loadUser, resolveArena, logs);

export default app;
