import express from "express";
import appService from "../services/AppService";
import arenaMemberService from "../services/ArenaMemberService";
import demoService from "../services/DemoService"
const app = express();

// Listen to an arena
app.get("/api/demo/events", async (req, res) => {

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
    });

    function listener(event) {
        res.write("data: " + JSON.stringify(event) + "\n\n");
    }

    return demoService.getDemoEnvironment().then((env) => {
        env.addListener("event", listener);
        req.on("close", () => {
            env.removeListener("event", listener);
            res.end();
        });
    });
});

app.get("/api/demo/restart", async (req, res) => {
    const env = await demoService.getDemoEnvironment()
    env.restart()
    env.resume()
    res.sendStatus(200)
});
  
// Get an arena status
app.get("/api/demo/arena/", async (req, res) => {
  
    const env = await demoService.getDemoEnvironment();
    const arena = await env.getArena()
    
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
      apps: env.getProcesses().map((process) => ({
        id: process.getAppId(),
        name: apps.find((app) => app?.getId() === process.appId)?.getName(),
        userId: apps.find((app) => app?.getId() === process.appId)?.getUserId(),
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

export default app;

