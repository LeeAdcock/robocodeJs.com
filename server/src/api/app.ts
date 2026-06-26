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

// Get user apps
app.get("/api/user/:userId/apps", loadUser, async (req, res) => {
  const user = scopedUser(req);
  // TODO filter this response
  const apps = await appService.getForUser(user.getId());
  res.json(apps.map((app) => ({ id: app.getId(), name: app.getName() })));
});

// Create an app
app.post("/api/user/:userId/app/", loadUser, requireOwner, async (req, res) => {
  const user = scopedUser(req);
  const tankApp = await appService.create(user.getId());
  res.status(201);
  res.send({ appId: tankApp.getId() });
});

// Get an app
app.get("/api/user/:userId/app/:appId", loadUser, loadApp, (req, res) => {
  const app = scopedApp(req);
  res.json({
    id: app.getId(),
    name: app.getName(),
  });
});

// Put app source code
app.put(
  "/api/user/:userId/app/:appId/source",
  loadUser,
  requireOwner,
  loadApp,
  (req, res) => {
    const app = scopedApp(req);
    // TODO validate the source code first?
    return app
      .setSource(req.body.toString("utf-8"))
      .then(() => {
        res.status(200);
        res.send();
      })
      .then(() => {
        arenaMemberService.getForApp(app.getId()).then((members) => {
          members.forEach((member) => {
            environmentService.getByArenaId(member.getArenaId()).then((env) => {
              if (env) {
                env.processes
                  .filter((process) => process.getAppId() == member.getAppId())
                  .forEach((process) =>
                    process.tanks.forEach((tank) => tank.execute(process))
                  );
              }
            });
          });
        });
      });
  }
);

// Execute app source code
app.post(
  "/api/user/:userId/app/:appId/compile",
  loadUser,
  requireOwner,
  loadApp,
  async (req, res) => {
    const user = scopedUser(req);
    const app = scopedApp(req);

    const arenas: Arena[] = await arenaService.getForUser(user.getId());
    return Promise.all(
      arenas
        .filter((arena) => environmentService.has(arena.getId()))
        .map((arena) =>
          environmentService.get(arena).then((env) => env.execute(app.getId()))
        )
    ).then(() => {
      res.status(200);
      res.send({
        name: app.getName(),
      });
    });
  }
);

// Get app source code
app.get(
  "/api/user/:userId/app/:appId/source",
  loadUser,
  requireOwner,
  loadApp,
  (req, res) => {
    const app = scopedApp(req);
    res.status(200);
    res.send(app.getSource());
  }
);

// Delete an app
app.delete(
  "/api/user/:userId/app/:appId",
  loadUser,
  requireOwner,
  loadApp,
  (req, res) => {
    const app = scopedApp(req);
    return arenaMemberService.getForApp(app.getId()).then((memberships) =>
      Promise.all(
        memberships.map((membership) =>
          environmentService
            .getByArenaId(membership.getArenaId())
            .then((env) =>
              env ? env.removeApp(app.getId()) : Promise.resolve()
            )
            .then(() => membership.delete())
        )
      )
        .then(() => app.delete())
        .then(() => {
          res.status(200);
          res.send();
        })
    );
  }
);

export default app;
