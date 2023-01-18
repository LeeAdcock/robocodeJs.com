import express from "express";
import userService from "../services/UserService";
import appService from "../services/AppService";
import arenaService from "../services/ArenaService";
import environmentService from "../services/EnvironmentService";
import arenaMemberService from "../services/ArenaMemberService";
import TankApp from "../types/app";
import Arena from "../types/arena";
import { AuthenticatedRequest } from "../middleware/auth";

const app = express();

// Get an arena status
app.get("/api/user/:userId/arena/", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena = await arenaService.getDefaultForUser(user.getId());
  const env = await environmentService.get(arena);

  res.status(200);
  res.send({
    height: arena.getHeight(),
    width: arena.getWidth(),
    running: env.isRunning(),
    clock: { time: env.getTime() },
    apps: env.getProcesses().map((process) => ({
      id: process.getAppId(),
      //name: process.appId.getName(),
      //userId: process.app.getUserId(),
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
        bodyOrientationVelocity: tank.orientation,
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
app.delete("/api/user/:userId/arena/app/:appId", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as unknown as AuthenticatedRequest).user.getId()) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

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
  (await environmentService.getByArenaId(arena.getId()))?.removeApp(req.params.appId)
  return member.delete().then(() => {
    res.status(200);
    res.send();
  });
});

// Add an app to an arena
app.put("/api/user/:userId/arena/app/:appId", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as unknown as AuthenticatedRequest).user.getId()) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  const app: TankApp | undefined = await appService.get(req.params.appId);

  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena: Arena = await arenaService.getDefaultForUser(user.getId());

  const members = await arenaMemberService.getForArena(arena.getId());
  if (members.length > 4) {
    if (!app) {
      res.status(400);
      res.send("Arena limit reached");
      return;
    }
  }

  const env = await environmentService.get(arena);
  env.addApp(app);
  return arenaMemberService.create(arena.getId(), app.getId()).then(() => {
    res.status(201);
    res.send();
  });
});

app.post("/api/user/:userId/arena/restart", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as unknown as AuthenticatedRequest).user.getId()) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena: Arena = await arenaService.getDefaultForUser(user.getId());
  return environmentService
    .get(arena)
    .then((env) => env.restart())
    .then(() => {
      res.status(200);
      res.send();
    });
});

app.post("/api/user/:userId/arena/pause", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as unknown as AuthenticatedRequest).user.getId()) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena: Arena = await arenaService.getDefaultForUser(user.getId());

  return environmentService
    .get(arena)
    .then((env) => env.pause())
    .then(() => {
      res.status(200);
      res.send();
    });
});

app.post("/api/user/:userId/arena/resume", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as unknown as AuthenticatedRequest).user.getId()) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena: Arena = await arenaService.getDefaultForUser(user.getId());
  return environmentService
    .get(arena)
    .then((env) => env.resume())
    .then(() => {
      res.status(200);
      res.send();
    });
});

// Listen to an arena
app.get("/api/user/:userId/arena/events", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });

  function listener(event) {
    res.write("data: " + JSON.stringify(event) + "\n\n");
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena: Arena = await arenaService.getDefaultForUser(user.getId());
  return environmentService.get(arena).then((env) => {
    env.addListener("event", listener);
    req.on("close", () => {
      console.log("closed connection");
      env.removeListener("event", listener);
      res.end();
    });
  });
});

// Listen to an arena
app.get("/api/user/:userId/arena/logs", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });

  function listener(event) {
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
