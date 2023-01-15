import Clock from "./clock";
import { EventEmitter } from "events";
import Process from "./process";
import { v4 as uuidv4 } from "uuid";
import User, { UserId } from "./user";
import { AppId } from "./app";
import Tank from "./tank";
import TankApp from "./app";
import Simulation from "../util/simulation";

// eslint-disable-next-line @typescript-eslint/ban-types
export type ArenaId = string & {};

export default class Arena {
  private id: ArenaId;
  private userId: UserId;
  private height = 750;
  private width = 750;
  private clock: Clock = { time: 0 };
  private emitter: EventEmitter = new EventEmitter();
  private processes: Process[] = [];
  private running = false;

  constructor(user: User) {
    this.id = uuidv4();
    this.userId = user.getId();
    this.emitter = new EventEmitter();
  }

  getId = () => this.id;
  getUserId = () => this.userId;
  getWidth = () => this.width;
  getHeight = () => this.height;
  isRunning = () => this.running;
  getTime = () => this.clock.time;
  getProcesses = () => this.processes;

  addListener = (
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ) => {
    this.emitter.addListener(eventName, listener);
    if (eventName === "event") {
      this.processes.forEach((process) => {
        listener({
          type: "arenaPlaceApp",
          id: process.app.getId(),
          name: process.app.getName(),
        });
        process.tanks.forEach((tank) => {
          // Emit new tank event
          listener({
            type: "arenaPlaceTank",
            id: tank.id,
            appId: process.app.getId(),
            bodyOrientation: tank.orientation,
            bodyOrientationVelocity: tank.orientationVelocity,
            turretOrientation: tank.turret.orientation,
            turretOrientationVelocity: tank.turret.orientationVelocity,
            radarOrientation: tank.turret.radar.orientation,
            radarOrientationVelocity: tank.turret.radar.orientationVelocity,
            speed: tank.speed,
            speedMax: tank.speedMax,
            x: tank.x,
            y: tank.y,
          });
        });
      });

      if (this.isRunning()) {
        listener({
          type: "arenaResumed",
        });
      } else {
        listener({
          type: "arenaPaused",
        });
      }
    }
    return this;
  };

  removeListener = (
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ) => {
    this.emitter.removeListener(eventName, listener);
    return this;
  };

  emit(eventName: string | symbol, ...args: any[]): boolean {
    return this.emitter.emit(eventName, ...args);
  }

  execute(appId: AppId) {
    this.processes
      .filter((process) => process.app.getId() === appId)
      .forEach((process) =>
        process.tanks.forEach((tank) => {
          tank.execute(process);
        })
      );
  }

  // Run the game
  private simulate = (cancelable) => {
    const suddenDeathTime = 10000;

    // Forward the simulation one clock tick
    Simulation.run(this);
    this.clock.time = this.clock.time + 1;

    // Health decays after sudden death time
    if (this.clock.time > suddenDeathTime && this.clock.time % 50 === 0) {
      this.processes.forEach((process) => {
        process.tanks
          .filter((tank) => tank.health > 0)
          .forEach((tank) => {
            tank.health = Math.max(0, tank.health - 1);
          });
      });
    }

    // Calculate application health
    const appHealth: any[] = this.processes.map(
      (process) =>
        process.tanks.reduce((sum, tank) => sum + tank.health, 0) /
        (process.tanks.length * 100)
    );

    this.emitter.emit("event", {
      type: "tick",
      time: this.clock.time,
    });

    // Stop game if winning conditions are met
    if (appHealth.filter((item) => item > 0).length === 0) {
      this.emitter.emit("event", {
        type: "arenaPaused",
      });
      this.running = false;
    }

    if (!this.running) {
      console.log("Stop");
      clearInterval(cancelable.interval);
    }
  };

  resume() {
    this.emitter.emit("event", {
      type: "arenaResumed",
    });
    this.running = true;

    // TODO queue this up for a thread pool elsewhere?
    console.log("Start");
    const cancelable = { interval: null as any };
    cancelable.interval = setInterval(() => this.simulate(cancelable), 100);
  }
  pause() {
    this.emitter.emit("event", {
      type: "arenaPaused",
    });
    this.running = false;
  }
  restart() {
    this.emitter.emit("event", {
      type: "arenaRestart",
    });

    this.processes.forEach((process) => {
      process.tanks.forEach((tank) => {
        // Emit removed tank event
        this.emitter.emit("event", {
          type: "arenaRemoveTank",
          id: tank.id,
          appId: process.app.getId(),
        });
      });

      this.emitter.emit("event", {
        type: "arenaPlaceApp",
        id: process.app.getId(),
        name: process.app.getName(),
      });

      process.reset();

      const tankCount = 5;

      for (let tankIndex = 0; tankIndex < tankCount; tankIndex++) {
        const tank = new Tank(this, process);

        process.tanks.push(tank);

        // Emit new tank event
        this.emitter.emit("event", {
          type: "arenaPlaceTank",
          id: tank.id,
          appId: process.app.getId(),
          bodyOrientation: tank.orientation,
          bodyOrientationVelocity: tank.orientationVelocity,
          turretOrientation: tank.turret.orientation,
          turretOrientationVelocity: tank.turret.orientationVelocity,
          radarOrientation: tank.turret.radar.orientation,
          radarOrientationVelocity: tank.turret.radar.orientationVelocity,
          speed: tank.speed,
          speedMax: tank.speedMax,
          x: tank.x,
          y: tank.y,
        });

        tank.execute(process);
      }
    });
  }
  addApp(app: TankApp) {
    const process = new Process(app);
    this.processes.push(process);

    const tankCount = 5; // todo pull from arena

    for (let tankIndex = 0; tankIndex < tankCount; tankIndex++) {
      const tank = new Tank(this, process);

      process.tanks.push(tank);

      tank.execute(process);

      // Emit new tank event
      this.emitter.emit("event", {
        type: "arenaPlaceTank",
        id: tank.id,
        appId: process.app.getId(),
        bodyOrientation: tank.orientation,
        bodyOrientationVelocity: tank.orientationVelocity,
        turretOrientation: tank.turret.orientation,
        turretOrientationVelocity: tank.turret.orientationVelocity,
        radarOrientation: tank.turret.radar.orientation,
        radarOrientationVelocity: tank.turret.radar.orientationVelocity,
        speed: tank.speed,
        speedMax: tank.speedMax,
        x: tank.x,
        y: tank.y,
      });
    }
  }

  removeApp(appId: AppId) {
    // Emit removed app event
    this.emitter.emit("event", {
      type: "arenaRemoveApp",
      id: appId,
    });

    const process = this.processes.find(
      (process) => process.app.getId() === appId
    );

    if (process) {
      this.processes = this.processes.splice(
        this.processes.findIndex((process) => process.app.getId() === appId),
        1
      );

      process.tanks.forEach((tank) => {
        // Emit removed tank event
        this.emitter.emit("event", {
          type: "arenaRemoveTank",
          id: tank.id,
          appId: appId,
        });
      });
    }
  }

  containsApp = (appId: AppId) =>
    this.processes.find((process) => process.app.getId() === appId);
}
