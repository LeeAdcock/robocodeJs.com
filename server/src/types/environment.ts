import Clock from "./clock";
import { EventEmitter } from "events";
import TankApp, { AppId } from "./app";
import Tank from "./tank";
import ivm from "isolated-vm";
import Arena from "./arena";
import compiler from "../util/compiler";

import Simulation from "../util/simulation";
import appService from "../services/AppService";
import { ErrorCodes } from "./ErrorCodes";

// eslint-disable-next-line @typescript-eslint/ban-types
export type ArenaId = string & {};

export class Process {
  public appId: AppId;
  public tanks: Tank[] = [];

  private sandbox: ivm.Isolate | null = null;

  constructor(appId: AppId) {
    this.appId = appId;
  }

  getAppId = () => this.appId;

  getSandbox = (): ivm.Isolate => {
    if (!this.sandbox || this.sandbox.isDisposed) {
      this.sandbox = new ivm.Isolate({
        memoryLimit: 8,
        onCatastrophicError: (msg) => {
          this.tanks.forEach((tank) => {
            tank.appCrashed = true;
            tank.logger.error(new Error(`${ErrorCodes.E001}: ${msg}`));
            console.log(msg);
          });
          this.sandbox?.dispose();
        },
      });
    }
    return this.sandbox;
  };

  dispose() {
    this.tanks.forEach((tank) => tank.getContext().release());
    this.tanks = [];
    this.sandbox?.dispose();
    this.sandbox = null;
  }
}

export default class Environment {
  public processes: Process[] = [];
  private arena: Arena;
  private clock: Clock = { time: 0 };
  public stoppedAt: Date = new Date();
  private emitter: EventEmitter = new EventEmitter();
  private running = false;

  constructor(arena: Arena) {
    this.arena = arena;
    this.emitter = new EventEmitter();
  }

  dispose = () => {
    this.processes.forEach((process) => process.dispose());
  };

  isRunning = () => this.running;
  getTime = () => this.clock.time;
  getProcesses = () => this.processes;
  getArena = () => this.arena;

  addListener = (
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ) => {
    this.emitter.addListener(eventName, listener);
    console.log("listening!")
    if (eventName === "event") {
      this.processes.forEach((process) => {
        appService.get(process.getAppId()).then((app) => {
          if (app) {
            listener({
              type: "arenaPlaceApp",
              id: process.getAppId(),
              name: app.getName(),
            });
          }
        });
        process.tanks.forEach((tank) => {
          // Emit new tank event
          listener({
            type: "arenaPlaceTank",
            id: tank.id,
            appId: process.getAppId(),
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

  execute(appId: AppId): Promise<unknown> {
    return Promise.all(
      this.processes
        .filter((process) => process.getAppId() === appId)
        .map((process) =>
          Promise.all(process.tanks.map((tank) => tank.execute(process)))
        )
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
      console.log("game over", this.arena.getId())
      this.emitter.emit("event", {
        type: "arenaPaused",
      });
      this.running = false;
    }

    if (!this.running) {
      clearInterval(cancelable.interval);
    }
  };

  resume() {
    console.log("resuming", this.arena.getId())

    this.emitter.emit("event", {
      type: "arenaResumed",
    });
    this.running = true;

    const cancelable = { interval: null as any };
    cancelable.interval = setInterval(() => this.simulate(cancelable), 100);
  }

  pause() {
    this.emitter.emit("event", {
      type: "arenaPaused",
    });
    this.running = false;
    this.stoppedAt = new Date();
  }
  
  async restart() {
    this.emitter.emit("event", {
      type: "arenaRestart",
    });

    this.processes.forEach((process) => {
      process.tanks.forEach((tank) => {
        // Emit removed tank event
        this.emitter.emit("event", {
          type: "arenaRemoveTank",
          id: tank.id,
          appId: process.getAppId(),
        });
      });

      process.dispose();

      appService.get(process.getAppId()).then((app) => {
        if (app) {
          this.emitter.emit("event", {
            type: "arenaPlaceApp",
            id: process.getAppId(),
            name: app.getName(),
          });

          const tankCount = 5;

          for (let tankIndex = 0; tankIndex < tankCount; tankIndex++) {
            const tank = new Tank(this, process);

            process.tanks.push(tank);
            compiler.init(this, process, tank);
            tank.execute(process);

            // Emit new tank event
            this.emitter.emit("event", {
              type: "arenaPlaceTank",
              id: tank.id,
              appId: process.getAppId(),
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
      });
    });
  }

  addApp(app: TankApp) {
    const process = new Process(app.getId());
    this.processes.push(process);

    for (let x = 0; x < 5; x++) {
      const tank = new Tank(this, process);
      process.tanks.push(tank);

      compiler.init(this, process, tank);
      tank.execute(process);

      // Emit new tank event
      this.emitter.emit("event", {
        type: "arenaPlaceTank",
        id: tank.id,
        appId: process.getAppId(),
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
      (process) => process.getAppId() === appId
    );

    if (process) {
      const i = this.processes.findIndex(
        (process) => process.getAppId() === appId
      );
      this.processes.splice(i, 1);

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
    this.processes.find((process) => process.getAppId() === appId);
}
