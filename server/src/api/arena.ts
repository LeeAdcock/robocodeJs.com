import express from "express";
import userService from "../services/UserService";
import appService from "../services/AppService";
import arenaService from "../services/ArenaService";
import TankApp from "../types/app";

const app = express();

// Get an arena status
/*
app.get("/api/user/:userId/arena/", (req, res) => {
  const user = userService.get(req.params.userId)
if (!user) {
  res.status(404);
  res.send('Invalid user id');
  return
}

// TODO assumes at least one arena, order is consistant, first is default
const arena = arenaService.getForUser(user.getId())[0]

res.status(200);
res.send({
  height: arena.getHeight(),
  width: arena.getWidth(),
  running: arena.isRunning(),
  clock: { time: arena.getTime()},
  apps: arena.getProcesses().map(process => ({
    id: process.app.getId(),
    name: process.app.getName(),
    userId: process.app.getUserId(),
    tanks: process.tanks.map(tank => ({
      id: tank.id,
      x: tank.x,
      y: tank.y,
      speed: tank.speed,
      speedTarget: tank.speedTarget,
      speedAcceleration: tank.speedAcceleration,
      speedMax: tank.speedMax,
      bodyOrientation: tank.orientation,
      bodyOrientationTarget: tank.orientationTarget,
      bodyOrientationVelocity:tank.orientation,
      turretOrientation:tank.turret.orientation,
      turretOrientationTarget:tank.turret.orientationTarget,
      turretOrientationVelocity:tank.turret.radar.orientationVelocity,
      radarOrientation:tank.turret.radar.orientation,
      radarOrientationTarget:tank.turret.radar.orientationTarget,
      radarOrientationVelocity:tank.turret.radar.orientationVelocity,
      health: tank.health,
      bullets: tank.bullets.map(bullet => ({
        id: bullet.id,
        x: bullet.x,
        y: bullet.y,
        exploded: bullet.exploded
      }))
    }))
  }))
});
})
*/

// Remove an app from an arena
app.delete("/api/user/:userId/arena/app/:appId", (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena = arenaService.getForUser(user.getId())[0];

  if (!arena.containsApp(req.params.appId)) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }

  arena.removeApp(req.params.appId);
  res.status(200);
  res.send();
});

// Add an app to an arena
app.put("/api/user/:userId/arena/app/:appId", (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  const app: TankApp | undefined = appService.get(req.params.appId);

  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena = arenaService.getForUser(user.getId())[0];

  arena.addApp(app);
  res.status(201);
  res.send();
});

app.post("/api/user/:userId/arena/restart", (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena = arenaService.getForUser(user.getId())[0];

  arena.restart();

  res.status(200);
  res.send();
});

app.post("/api/user/:userId/arena/pause", (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena = arenaService.getForUser(user.getId())[0];

  if (!arena.isRunning()) {
    res.status(409);
    res.send("Already paused");
    return;
  }
  arena.pause();
  res.status(200);
  res.send();
});

app.post("/api/user/:userId/arena/resume", (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  if (user.getId() !== (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return;
  }

  // TODO assumes at least one arena, order is consistant, first is default
  const arena = arenaService.getForUser(user.getId())[0];

  if (arena.isRunning()) {
    res.status(409);
    res.send("Already running");
    return;
  }

  arena.resume();
  res.status(200);
  res.send();
});

// Listen to an arena
app.get("/api/user/:userId/arena/events", (req, res) => {
  const user = userService.get(req.params.userId);
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
  const arena = arenaService.getForUser(user.getId())[0];
  arena.addListener("event", listener);

  req.on("close", () => {
    console.log("closed connection");
    arena.removeListener("event", listener);
    res.end();
  });
});

// Listen to an arena
app.get("/api/user/:userId/arena/logs", (req, res) => {
  const user = userService.get(req.params.userId);
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
  const arena = arenaService.getForUser(user.getId())[0];

  arena.addListener("log", listener);

  req.on("close", () => {
    arena.removeListener("log", listener);
    res.end();
  });
});
export default app;
