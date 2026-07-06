import express, { Request, Response } from 'express';
import arenaService from '../services/ArenaService';
import appService from '../services/AppService';
import userService from '../services/UserService';
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
import { writeRateLimit } from '../middleware/rateLimit';
import { openSseStream } from '../util/sse';
import { buildArenaStatus } from '../util/arenaStatus';
import { buildMatchSummary } from '../util/matchSummary';

const app = express();

// Caps the number of arenas a single user can create. Each arena is an
// in-memory, isolate-backed Environment, so this bounds EnvironmentService's
// store; idle arenas are also GC'd 30 minutes after they stop.
const MAX_ARENAS_PER_USER = 10;

// A global ceiling on the total number of arenas across ALL users. Each arena
// can materialize into an 8 MB isolate-backed Environment, so without a
// cross-user cap enough users (× MAX_ARENAS_PER_USER each) could exhaust host
// memory. Live isolates are additionally reclaimed by EnvironmentService's
// 30-minute idle GC; this bounds the persistent worst case. Tunable via env for
// larger deployments.
const MAX_TOTAL_ARENAS = Number(process.env.MAX_TOTAL_ARENAS) || 1000;

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
  writeRateLimit,
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
    if ((await arenaService.count()) >= MAX_TOTAL_ARENAS) {
      res.status(503);
      res.send('Server arena capacity reached');
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

  res.status(200);
  res.send(await buildArenaStatus(env, members));
};
app.get(dual(''), loadUser, resolveArena, getStatus);

// Get an outcome-oriented match summary (leaderboard, winner, aggregated stats,
// elimination order) — most useful once a match is decided. Read-only, same open
// access as getStatus (spectating is intentionally not owner-gated).
const getSummary = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  const env = await environmentService.get(arena);
  const members = await arenaMemberService.getForArena(arena.getId());

  res.status(200);
  res.send(await buildMatchSummary(env, members));
};
app.get(dual('/summary'), loadUser, resolveArena, getSummary);

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
    req.params.appId as string
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

// Add an app to an arena. The app id may belong to another user (add-by-
// reference / share link) — only the arena is owner-gated; the referenced bot's
// source is never exposed by adding it, per the access model. Idempotent: adding
// a bot that's already a member is a no-op.
const addApp = async (req: Request, res: Response) => {
  const app = scopedApp(req);
  const arena = scopedArena(req);

  const members = await arenaMemberService.getForArena(arena.getId());
  if (members.some((member) => member.getAppId() === app.getId())) {
    res.status(200);
    res.send();
    return;
  }
  // Cap on total roster size (enabled + disabled). Bounds the member list and,
  // together with the isolate caps, the arena's resource footprint.
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

// Enable or disable a bot in the arena without unlinking it. Disabled = pulled
// from the live match (tanks removed, no isolate) but the membership row stays,
// so it remains in the roster and can be re-enabled. Owner-gated on the arena.
const setEnabled = async (req: Request, res: Response) => {
  const enabled = (req.body ?? {}).enabled;
  if (typeof enabled !== 'boolean') {
    res.status(400);
    res.send('enabled must be a boolean');
    return;
  }

  const app = scopedApp(req);
  const arena = scopedArena(req);
  const members = await arenaMemberService.getForArena(arena.getId());
  const member = members.find((m) => m.getAppId() === app.getId());
  if (!member) {
    res.status(404);
    res.send('Invalid app id');
    return;
  }

  await member.setEnabled(enabled);
  const env = await environmentService.get(arena);
  if (enabled) {
    // env.get() already materializes newly-enabled members when it first builds
    // the environment; only add when it's an already-live env missing this bot.
    if (!env.containsApp(app.getId())) env.addApp(app);
  } else {
    env.removeApp(app.getId());
  }
  res.status(200);
  res.send({ enabled });
};

// The arena's full bot roster — INCLUDING disabled bots, which the live status
// omits (they have no Process). Source of truth for the UI roster panel. Returns
// metadata only (name + owner), never source. Owner-gated on the arena.
const listMembers = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  const ownerId = scopedUser(req).getId();

  const members = await arenaMemberService.getForArena(arena.getId());
  const apps = await Promise.all(
    members.map((member) => appService.get(member.getAppId()))
  );
  const ownerIds = [
    ...new Set(
      apps.map((app) => app?.getUserId()).filter((id): id is string => !!id)
    ),
  ];
  const owners = await Promise.all(ownerIds.map((id) => userService.get(id)));

  res.status(200);
  res.json(
    members.map((member) => {
      const app = apps.find((a) => a?.getId() === member.getAppId());
      const appOwnerId = app?.getUserId();
      const owner = owners.find((o) => o?.getId() === appOwnerId);
      return {
        appId: member.getAppId(),
        name: app?.getName(),
        ownerUserId: appOwnerId,
        ownerName: owner?.getName(),
        enabled: member.getEnabled(),
        addedTimestamp: member.getTimestamp(),
        isOwn: appOwnerId === ownerId,
      };
    })
  );
};
app.put(
  dual('/app/:appId'),
  loadUser,
  requireOwner,
  loadApp,
  resolveArena,
  addApp
);

app.post(
  dual('/app/:appId/enabled'),
  loadUser,
  requireOwner,
  loadApp,
  resolveArena,
  setEnabled
);

app.get(dual('/members'), loadUser, requireOwner, resolveArena, listMembers);

const restart = async (req: Request, res: Response) => {
  const arena = scopedArena(req);
  return environmentService.get(arena).then((env) =>
    env.restart().then(() => {
      // A reset starts a fresh match running, not paused — env.restart() on its
      // own leaves the arena paused.
      env.resume();
      res.status(200);
      res.send();
    })
  );
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

// Set the simulation speed multiplier. Accepts a positive number (1 = the
// baseline 10 ticks/s) or "max"/0 for unbounded ("as fast as possible"). This is
// a tooling/MCP control — the UI adopts the rate but does not set it.
const setSpeed = async (req: Request, res: Response) => {
  const raw = (req.body ?? {}).speed;
  const speed = raw === 'max' || raw === 'unbounded' ? 0 : Number(raw);
  if (raw !== 'max' && raw !== 'unbounded' && !Number.isFinite(speed)) {
    res.status(400);
    res.send('speed must be a number or "max"');
    return;
  }
  const arena = scopedArena(req);
  return environmentService
    .get(arena)
    .then((env) => env.setSpeed(speed))
    .then(() => {
      res.status(200);
      res.send({ speed: Math.max(0, speed) });
    });
};
app.post(dual('/speed'), loadUser, requireOwner, resolveArena, setSpeed);

// Set the arena's random seed. Fixing the seed makes the match setup (tank
// placement + starting orientations) reproducible; the change takes effect on the
// next restart, which rebuilds the tanks from the reseeded stream. A tooling/MCP
// control.
const setSeed = async (req: Request, res: Response) => {
  const raw = (req.body ?? {}).seed;
  const seed = Number(raw);
  if (!Number.isFinite(seed)) {
    res.status(400);
    res.send('seed must be a number');
    return;
  }
  const arena = scopedArena(req);
  return environmentService.get(arena).then((env) => {
    env.setSeed(seed);
    res.status(200);
    res.send({ seed: env.getSeed() });
  });
};
app.post(dual('/seed'), loadUser, requireOwner, resolveArena, setSeed);

// Listen to an arena's game events
const events = async (req: Request, res: Response) => {
  openSseStream(res);

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

// Listen to an arena's bot console logs. Unlike the arena status/events streams
// (which are open so any signed-in user can spectate a match), console output is
// the author's private debug channel — a bot may print strategy or diagnostic
// data — so this stream is owner-only via requireOwner.
const logs = async (req: Request, res: Response) => {
  openSseStream(res);

  function listener(event: unknown) {
    res.write('data: ' + JSON.stringify(event) + '\n\n');
  }

  const arena = scopedArena(req);
  return environmentService.get(arena).then((env) => {
    // The live log stream is not replayable, so a page that opens mid-match would
    // otherwise start blank. Replay the recent-logs buffer first, then stream live.
    env.getRecentLogs().forEach((entry) => listener(entry));
    env.addListener('log', listener);

    req.on('close', () => {
      env.removeListener('log', listener);
      res.end();
    });
  });
};
app.get(dual('/logs'), loadUser, requireOwner, resolveArena, logs);

export default app;
