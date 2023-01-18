import express from "express";

import userService from "../services/UserService";
import appService from "../services/AppService";
import arenaService from "../services/ArenaService";
import environmentService from "../services/EnvironmentService";

import Arena from "../types/arena";
import { AuthenticatedRequest } from "../middleware/auth";
import arenaMemberService from "../services/ArenaMemberService";

const app = express();

// Get user apps
app.get("/api/user/:userId/apps", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  // TODO filter this response
  const apps = await appService.getForUser(user.getId());
  res.json(apps.map((app) => ({ id: app.getId(), name: app.getName() })));
});

// Create an app
app.post("/api/user/:userId/app/", async (req, res) => {
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
  const tankApp = await appService.create(user.getId());

  res.status(201);
  res.send({ appId: tankApp.getId() });
});

// Get an app
app.get("/api/user/:userId/app/:appId", async (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  const app = await appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }

  res.json({
    id: app.getId(),
    name: app.getName(),
  });
});

// Put app source code
app.put("/api/user/:userId/app/:appId/source", async (req, res) => {
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
  const app = await appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }
  // TODO validate the source code first?
  return app.setSource(req.body.toString("utf-8")).then(() => {
    res.status(200);
    res.send();
  }).then(() =>
  {
    arenaMemberService.getForApp(app.getId()).then(members => {
      members.forEach(member => {
        environmentService.getByArenaId(member.getAppId()).then(env => {
          if(env) {
            env.processes.filter(process => process.getAppId() == member.getAppId())
            .forEach(process => process.tanks.forEach(tank => tank.execute(process)))
          }
        })
      })
    })
  })
});

// Execute app source code
app.post("/api/user/:userId/app/:appId/compile", async (req, res) => {
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
  const app = await appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }

  const arenas: Arena[] = await arenaService.getForUser(user.getId());
  return Promise.all(
    arenas
      .filter((arena) => environmentService.has(arena.getId()))
      .map((arena) =>
        environmentService
          .get(arena)
          .then((env) => env.execute(app.getId()))
          .then(() => {
            res.status(200);
            res.send({
              name: app.getName(),
            });
          })
      )
  );
});

// Get app source code
app.get("/api/user/:userId/app/:appId/source", async (req, res) => {
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
  const app = await appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }
  res.status(200);
  res.send(app.getSource());
});

// Delete an app
app.delete("/api/user/:userId/app/:appId", async (req, res) => {
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

  const app = await appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }

  const memberships = await arenaMemberService.getForApp(app.getId());
  return Promise.all(
    memberships.map((membership) =>
      environmentService
        .getByArenaId(membership.getArenaId())
        .then((env) => (env ? env.removeApp(app.getId()) : Promise.resolve()))
        .then(() => membership.delete())
    )
  )
    .then(() => app.delete())
    .then(() => {
      res.status(200);
      res.send()
    })
});

export default app;
