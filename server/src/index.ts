import express from "express";
import bodyParser from "body-parser";
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import cookieParser from 'cookie-parser';
import {OAuth2Client} from 'google-auth-library';

import User from './types/user';

import { Simulation, Arena, TankApp, Tank, Compiler } from '@battletank/lib'


// TODO externalize these
const users:User[]= []

const app = express();
app.use(bodyParser.json({}));
app.use(bodyParser.raw({ type: "application/octet-stream" }));
app.use(cookieParser())

// auth
app.use((req, res, next) => {
  const googleClientId = '344303216827-jtutvdqjp24q0or2fpqf5mihja138sem.apps.googleusercontent.com';
  const client = new OAuth2Client(googleClientId);
  client.verifyIdToken({
      idToken: req.cookies.auth,
      audience: googleClientId
  }).then(verification => {
    (req as any).userId = verification.getPayload()?.sub

    const user = users.find(user => user.id === req.params.userId)
    if(!user) {
      const user = new User()
      const payload = verification.getPayload()
      if(payload) {
        user.id = payload.sub
        user.name = payload.name
        user.picture = payload.picture
        user.email = payload.email
        users.push(user)
      } else {
        res.status(401);
        res.send('Access forbidden');
      }
    }
    next()
  }).catch(() => {
    res.status(401);
    res.send('Access forbidden');
  })
})

const port = 8080; // default port to listen

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", });
});

// Log in
app.get("/api/login", (req, res) => {
  const user = users.find(user => user.id === (req as any).userId)
  if(user) {
    res.json({id: user.id});
  } else {
    res.status(401);
    res.send('Access forbidden');
  }
});

// Get a user
app.get("/api/user/:userId", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }

  res.json({
    id: user.id,
    name: user.name,
    picture: user.picture,
    apps: user.apps.map(app => ({ id: app.id, name: app.name }))
  });
});

// Get user apps
app.get("/api/user/:userId/apps", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  // TODO filter this response
  res.json(user.apps.map(app => ({ id: app.id, name: app.name })))
});

// Create an app
app.post("/api/user/:userId/app/", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }
  const tankApp: TankApp = new TankApp()
  tankApp.id = uuidv4()
  user.apps.push(tankApp)

  res.status(201);
  res.send({ appId: tankApp.id })
});

// Get an app
app.get("/api/user/:userId/app/:appId", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  const app = user.apps.find(app => app.id === req.params.appId)
  if (!app) {
    res.status(404);
    res.send('Invalid app id');
    return
  }
  // TODO don't return the raw app
  res.json(app);
});

// Put app source code
app.put("/api/user/:userId/app/:appId/source", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }
  const app = user.apps.find(app => app.id === req.params.appId)
  if (!app) {
    res.status(404);
    res.send('Invalid app id');
    return
  }
  // TODO validate the source code first?
  app.source = req.body.toString("utf-8")

  res.status(200);
  res.send();
});

// Put app source code
app.post("/api/user/:userId/app/:appId/compile", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }
  const app = user.apps.find(app => app.id === req.params.appId)
  if (!app) {
    res.status(404);
    res.send('Invalid app id');
    return
  }

  user.arena.processes.filter(process => process.app.id === app.id).forEach(process => process.tanks.forEach(tank => {
    Compiler.compile(user.arena, process, tank)
  }))

  res.status(200);
  res.send();
});

// Get app source code
app.get("/api/user/:userId/app/:appId/source", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }
  const app = user.apps.find(app => app.id === req.params.appId)
  if (!app) {
    res.status(404);
    res.send('Invalid app id');
    return
  }
  res.status(200);
  res.send(app.source);
});

// Get an arena status
app.get("/api/user/:userId/arena/", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  res.status(200);
  res.send({
    height: user.arena.height,
    width: user.arena.width,
    running: user.arena.running,
    clock: user.arena.clock,
    apps: user.arena.processes.map(process => ({
      id: process.app.id,
      name: process.app.name,
      userId: users.find(user => user.apps.find(app => app.id === process.app.id))?.id,
      tanks: process.tanks.map(tank => ({
        id: tank.id,
        x: tank.x,
        y: tank.y,
        speed: tank.speed,
        speedTarget: tank.speedTarget,
        speedAcceleration: tank.speedAcceleration,
        speedMax: tank.speedMax,
        bodyOrientation: tank.bodyOrientation,
        bodyOrientationTarget: tank.bodyOrientationTarget,
        bodyOrientationVelocity:tank.bodyOrientationVelocity,
        turretOrientation:tank.turretOrientation,
        turretOrientationTarget:tank.turretOrientationTarget,
        turretOrientationVelocity:tank.radarOrientationVelocity,
        radarOrientation:tank.radarOrientation,
        radarOrientationTarget:tank.radarOrientationTarget,
        radarOrientationVelocity:tank.radarOrientationVelocity,
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

// Remove an app from an arena
app.delete("/api/user/:userId/arena/app/:appId", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }

  const process = user.arena.processes.find(process => process.app.id === req.params.appId)
  if (!process) {
    res.status(404);
    res.send('Invalid app id');
    return
  }

  // Emit removed app event
  user.arena.emitter.emit("event", {
    type: "arenaRemoveApp",
    id: process.app.id
  })

  user.arena.processes = user.arena.processes.splice(user.arena.processes.indexOf(process), 1)

  process.tanks.forEach(tank => {
    // Emit removed tank event
    user.arena.emitter.emit("event", {
      type: "arenaRemoveTank",
      id: tank.id,
      appId: process.app.id,
    })
  })
  res.status(200)
  res.send();
});

// Add an app to an arena
app.put("/api/user/:userId/arena/app/:appId", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }

  const app:TankApp | undefined = users.reduce((app, user) => app || user.apps.find(app => app.id === req.params.appId), undefined)

  if (!app) {
    res.status(404);
    res.send('Invalid app id');
    return
  }

  // Emit new app event
  user.arena.emitter.emit("event", {
    type: "arenaPlaceApp",
    id: app.id,
    name: app.name
  })

  const process = {
    app,
    tanks:[] as Tank[]
  }
  user.arena.processes.push(process)

  const tankCount = 5 // todo pull from arena

  for (let tankIndex = 0; tankIndex < tankCount; tankIndex++) {

    const tank = new Tank(user.arena, process)

    process.tanks.push(tank)

    Compiler.compile(user.arena, process, tank)

    // Emit new tank event
    user.arena.emitter.emit("event", {
      type: "arenaPlaceTank",
      id: tank.id,
      appId: process.app.id,
      bodyOrientation: tank.bodyOrientation,
      bodyOrientationVelocity: tank.bodyOrientationVelocity,
      turretOrientation: tank.turretOrientation,
      turretOrientationVelocity: tank.turretOrientationVelocity,
      radarOrientation: tank.radarOrientation,
      radarOrientationVelocity: tank.radarOrientationVelocity,
      speed: tank.speed,
      speedMax: tank.speedMax,
      x: tank.x,
      y: tank.y
    })
  }

  res.status(201)
  res.send();
});

app.post("/api/user/:userId/arena/restart", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }

  user.arena.emitter = user.arena.emitter || new EventEmitter();

  user.arena.emitter.emit("event", {
    type: "arenaRestart",
  })

  user.arena.processes.forEach(process => {

    user.arena.emitter.emit("event", {
      type: "arenaPlaceApp",
      id: process.app.id,
      name: process.app.name
    })

    process.tanks = []

    const tankCount = req.body.tankCount || 5 // todo validate, or pull from arena

    for (let tankIndex = 0; tankIndex < tankCount; tankIndex++) {

      const tank = new Tank(user.arena, process)

      process.tanks.push(tank)

      Compiler.compile(user.arena, process, tank)

      // Emit new tank event
      user.arena.emitter.emit("event", {
        type: "arenaPlaceTank",
        id: tank.id,
        appId: process.app.id,
        bodyOrientation: tank.bodyOrientation,
        bodyOrientationVelocity: tank.bodyOrientationVelocity,
        turretOrientation: tank.turretOrientation,
        turretOrientationVelocity: tank.turretOrientationVelocity,
        radarOrientation: tank.radarOrientation,
        radarOrientationVelocity: tank.radarOrientationVelocity,
        speed: tank.speed,
        speedMax: tank.speedMax,
        x: tank.x,
        y: tank.y
      })

      Compiler.compile(user.arena, process, tank)
    }
  })
  res.status(200);
  res.send();

})

app.post("/api/user/:userId/arena/pause", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }
  if (!user.arena.running) {
    res.status(409);
    res.send("Already paused");
  }
  user.arena.emitter.emit("event", {
    type: "arenaPaused"
  })
  user.arena.running = false
  res.status(200);
  res.send();
})

app.post("/api/user/:userId/arena/resume", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }
  if (!user.id === (req as any).userId) {
    res.status(401);
    res.send("Unauthorized");
    return
  }
  if (user.arena.running) {
    res.status(409);
    res.send("Already running");
  }
  user.arena.emitter.emit("event", {
    type: "arenaResumed"
  })
  user.arena.running = true

  // TODO queue this up for a thread pool elsewhere
  console.log("Start")
  const cancelable = {interval: (null as any)}
  cancelable.interval = setInterval(() => simulate(user.arena, cancelable), 100)

  res.status(200);
  res.send();
})

// Listen to an arena
app.get("/api/user/:userId/arena/events", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
  });

  function listener(event) {
    res.write('data: ' + JSON.stringify(event) + '\n\n');
  }

  user.arena.emitter = user.arena.emitter || new EventEmitter();
  const eventEmitter = user.arena.emitter
  eventEmitter.addListener('event', listener)

  user.arena.processes.forEach(process => {
    listener({
      type: "arenaPlaceApp",
      id: process.app.id,
      name: process.app.name
    })
    process.tanks.forEach(tank => {
      // Emit new tank event
      listener({
        type: "arenaPlaceTank",
        id: tank.id,
        appId: process.app.id,
        bodyOrientation: tank.bodyOrientation,
        bodyOrientationVelocity: tank.bodyOrientationVelocity,
        turretOrientation: tank.turretOrientation,
        turretOrientationVelocity: tank.turretOrientationVelocity,
        radarOrientation: tank.radarOrientation,
        radarOrientationVelocity: tank.radarOrientationVelocity,
        speed: tank.speed,
        speedMax: tank.speedMax,
        x: tank.x,
        y: tank.y
      })
    })
  })

  if(user.arena.running) {
    listener({
      type: "arenaResumed"
    })
  } else {
    listener({
      type: "arenaPaused"
    })
  }

  req.on('close', () => {
    console.log("closed connection")
    eventEmitter.removeListener('event', listener)
    res.end();
  });

});

// Listen to an arena
app.get("/api/user/:userId/arena/logs", (req, res) => {
  const user = users.find(user => user.id === req.params.userId)
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
  });

  function listener(event) {
    res.write('data: ' + JSON.stringify(event) + '\n\n');
  }

  user.arena.emitter = user.arena.emitter || new EventEmitter();
  const eventEmitter = user.arena.emitter
  eventEmitter.addListener('log', listener)

  req.on('close', () => {
    eventEmitter.removeListener('log', listener)
    res.end();
  });

});

// start the express server
app.listen(port, () => {
  // tslint:disable-next-line:no-console
  console.log(`server started at http://localhost:${port}`);
});

// Run the game
const simulate = (arena:Arena, cancelable) => {
  const slowDeathTime = 10000

  // Forward the simulation one clock tick
  Simulation.run(arena)
  arena.clock.time = arena.clock.time + 1

  // Health decays after sudden death time
  if (arena.clock.time > slowDeathTime && arena.clock.time % 50 === 0) {
    arena.processes.forEach(process => {
      process.tanks
        .filter(tank => tank.health > 0)
        .forEach(tank => {
          tank.health = Math.max(0, tank.health - 1)
        })
    })
  }

  // Calculate application health
  const appHealth: any[] = arena.processes.map(
    process => process.tanks.reduce((sum, tank) => sum + tank.health, 0) / (process.tanks.length * 100),
  )

  arena.emitter.emit("event", {
    type: "tick",
    time: arena.clock.time
  })

  // Stop game if winning conditions are met
  if (appHealth.filter(item => item > 0).length === 0) {
    arena.emitter.emit("event", {
      type: "arenaPaused"
    })
    arena.running = false
  }


  if(!arena.running)
  {
    console.log("Stop")
    clearInterval(cancelable.interval)
  }
}
