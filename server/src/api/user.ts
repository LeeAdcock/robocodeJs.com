import express from "express";
import userService from "../services/UserService";
import appService from "../services/AppService";

const app = express();

// Log in
app.get("/api/user", (req, res) => {
  const user = userService.get((req as any).userId);
  if (user) {
    res.json({
      id: user.getId(),
      name: user.getName(),
      picture: user.getPicture(),
      apps: appService
        .getForUser(user)
        .map((app) => ({ id: app.getId(), name: app.getName() })),
    });
  } else {
    res.status(401);
    res.send("Access forbidden");
  }
});

// Get a user
app.get("/api/user/:userId", (req, res) => {
  const user = userService.get(req.params.userId);

  if (!user) {
    res.status(404);
    res.send("Invalid user id");
    return;
  }

  res.json({
    id: user.getId(),
    name: user.getName(),
    picture: user.getPicture(),
    apps: appService
      .getForUser(user)
      .map((app) => ({ id: app.getId(), name: app.getName() })),
  });
});
export default app;
