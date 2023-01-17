import express from "express";
import userService from "../services/UserService";
import appService from "../services/AppService";
import { AuthenticatedRequest } from "../middleware/auth";

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
app.get("/api/user/:userId", async (req, res) => {
  const user = await userService.get(req.params.userId);
  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }

  const apps = await appService.getForUser(user.getId());

  res.json({
    id: user.getId(),
    name: user.getName(),
    picture: user.getPicture(),
    apps: apps.map((app) => ({ id: app.getId(), name: app.getName() })),
  });
});
export default app;
