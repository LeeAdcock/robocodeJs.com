import express from "express";

import userService from "../services/UserService";
import appService from "../services/AppService";
import arenaService from "../services/ArenaService";

const app = express();

// Get user apps
app.get("/api/user/:userId/apps", (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  // TODO filter this response
  res.json(
    appService
      .getForUser(user)
      .map((app) => ({ id: app.getId(), name: app.getName() }))
  );
});

// Create an app
app.post("/api/user/:userId/app/", (req, res) => {
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
  const tankApp = appService.create(user);

  res.status(201);
  res.send({ appId: tankApp.getId() });
});

// Get an app
app.get("/api/user/:userId/app/:appId", (req, res) => {
  const user = userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }
  const app = appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }
  // TODO don't return the raw app
  res.json(app);
});

// Put app source code
app.put("/api/user/:userId/app/:appId/source", (req, res) => {
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
  const app = appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }
  // TODO validate the source code first?
  app.setSource(req.body.toString("utf-8"));

  res.status(200);
  res.send();
});

// Put app source code
app.post("/api/user/:userId/app/:appId/compile", (req, res) => {
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
  const app = appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }

  arenaService
    .getForUser(user.getId())
    .filter((arena) => arena.isRunning())
    .forEach((arena) => {
      arena.execute(app.getId());
    });

  res.status(200);
  res.send({
    name: app.getName(),
  });
});

// Get app source code
app.get("/api/user/:userId/app/:appId/source", (req, res) => {
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
  const app = appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send("Invalid app id");
    return;
  }
  res.status(200);
  res.send(app.getSource());
});
export default app;
