import express from "express";
import appService from "../services/AppService";
import { AuthenticatedRequest } from "../middleware/auth";
import { loadUser, scopedUser } from "../middleware/resource";

const app = express();

// Get current user
app.get("/api/user", async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  if (user) {
    const apps = await appService.getForUser(user.getId());
    res.json({
      id: user.getId(),
      name: user.getName(),
      picture: user.getPicture(),
      apps: apps.map((app) => ({ id: app.getId(), name: app.getName() })),
    });
  } else {
    res.status(401);
    res.send("Access forbidden");
  }
});

// Get a user
app.get("/api/user/:userId", loadUser, async (req, res) => {
  const user = scopedUser(req);

  const apps = await appService.getForUser(user.getId());

  res.json({
    id: user.getId(),
    name: user.getName(),
    picture: user.getPicture(),
    apps: apps.map((app) => ({ id: app.getId(), name: app.getName() })),
  });
});
export default app;
