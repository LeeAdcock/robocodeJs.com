import express from "express";
import appService from "../services/AppService";
import arenaService from "../services/ArenaService";
import environmentService from "../services/EnvironmentService";
import arenaMemberService from "../services/ArenaMemberService";
import Arena from "../types/arena";
import {
  loadUser,
  requireOwner,
  loadApp,
  scopedUser,
  scopedApp,
} from "../middleware/resource";

const app = express();

// Get an arena status
app.get("/api/user/:userId/arena/", loadUser, async (req, res) => {
  const user = scopedUser(req);

  // TODO assumes at least one arena, order is consistant, first is default
  const arena = await arenaService.getDefaultForUser(user.getId());
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
    apps: env.getProcesses()
      .sort((a, b) => {
        return (members.find((member) => member?.getAppId() === a.appId)?.getTimestamp()||0) -
        (members.find((member) => member?.getAppId() === b.appId)?.getTimestamp()||0)
      }).map((process) => ({
      id: process.getAppId(),
      name: apps.find((app) => app?.getId() === process.appId)?.getName(),
      userId: apps.find((app) => app?.getId() === process.appId)?.getUserId(),
      addedTimestamp: members.find((member) => member?.getAppId() === process.appId)?.getTimestamp(),
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
});

// Remove an app from an arena
app.delete(
  "/api/user/:userId/arena/app/:appId",
  loadUser,
  requireOwner,
  async (req, res) => {
    const user = scopedUser(req);

    // TODO assumes at least one arena, order is consistant, first is default
    const arena: Arena = await arenaService.getDefaultForUser(user.getId());
    const members = await arenaMemberService.getForArena(arena.getId());

    const member = members.find(
      (member) => member.getAppId() === req.params.appId
    );
    if (!member) {
      res.status(404);
      res.send("Invalid app id");
      return;
    }
    (await environmentService.getByArenaId(arena.getId()))?.removeApp(
      req.params.appId
    );
    return member.delete().then(() => {
      res.status(200);
      res.send();
    });
  }
);

// Add an app to an arena
app.put(
  "/api/user/:userId/arena/app/:appId",
  loadUser,
  requireOwner,
  loadApp,
  async (req, res) => {
    const user = scopedUser(req);
    const app = scopedApp(req);

    // TODO assumes at least one arena, order is consistant, first is default
    const arena: Arena = await arenaService.getDefaultForUser(user.getId());

    const members = await arenaMemberService.getForArena(arena.getId());
    if (members.length > 4) {
      res.status(400);
      res.send("Arena limit reached");
      return;
    }

    const env = await environmentService.get(arena);
    env.addApp(app);
    return arenaMemberService.create(arena.getId(), app.getId()).then(() => {
      res.status(201);
      res.send();
    });
  }
);

app.post(
  "/api/user/:userId/arena/restart",
  loadUser,
  requireOwner,
  async (req, res) => {
    const user = scopedUser(req);
    // TODO assumes at least one arena, order is consistant, first is default
    const arena: Arena = await arenaService.getDefaultForUser(user.getId());
    return environmentService
      .get(arena)
      .then((env) => env.restart())
      .then(() => {
        res.status(200);
        res.send();
      });
  }
);

app.post(
  "/api/user/:userId/arena/pause",
  loadUser,
  requireOwner,
  async (req, res) => {
    const user = scopedUser(req);
    // TODO assumes at least one arena, order is consistant, first is default
    const arena: Arena = await arenaService.getDefaultForUser(user.getId());
    return environmentService
      .get(arena)
      .then((env) => env.pause())
      .then(() => {
        res.status(200);
        res.send();
      });
  }
);

app.post(
  "/api/user/:userId/arena/resume",
  loadUser,
  requireOwner,
  async (req, res) => {
    const user = scopedUser(req);
    // TODO assumes at least one arena, order is consistant, first is default
    const arena: Arena = await arenaService.getDefaultForUser(user.getId());
    return environmentService
      .get(arena)
      .then((env) => env.resume())
      .then(() => {
        res.status(200);
        res.send();
      });
  }
);

// Listen to an arena
app.get("/api/user/:userId/arena/events", loadUser, async (req, res) => {
  const user = scopedUser(req);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });

  function listener(event: unknown) {
    res.write("data: " + JSON.stringify(event) + "\n\n");
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena: Arena = await arenaService.getDefaultForUser(user.getId());
  return environmentService.get(arena).then((env) => {
    env.addListener("event", listener);
    req.on("close", () => {
      env.removeListener("event", listener);
      res.end();
    });
  });
});

// Listen to an arena
app.get("/api/user/:userId/arena/logs", loadUser, async (req, res) => {
  const user = scopedUser(req);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });

  function listener(event: unknown) {
    res.write("data: " + JSON.stringify(event) + "\n\n");
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena: Arena = await arenaService.getDefaultForUser(user.getId());
  return environmentService.get(arena).then((env) => {
    env.addListener("log", listener);

    req.on("close", () => {
      env.removeListener("log", listener);
      res.end();
    });
  });
});
export default app;
