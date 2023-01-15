import Arena from "../types/arena";
import Process from "../types/process";
import Tank from "../types/tank";
import { Event } from "../types/event";
import { scheduleFactory } from "./scheduleFactory";
import ivm from "isolated-vm";
import { createLogger } from "browser-bunyan";
import { v4 as uuidv4 } from "uuid";

function exposeTankRadar(tank: Tank, isolate: ivm.Isolate) {
  // Expose getOrientation
  tank
    .getContext()
    .global.setSync(
      "_bot_radar_getOrientation",
      () => new ivm.ExternalCopy(tank.turret.radar.getOrientation())
    );
  isolate
    .compileScriptSync(
      `
    bot.radar.getOrientation = () => _bot_radar_getOrientation().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose setOrientation
  tank
    .getContext()
    .global.setSync(
      "_bot_radar_setOrientation",
      (arg: number, resolve: () => void, reject: () => void) => {
        tank.turret.radar
          .setOrientation(arg)
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.radar.setOrientation = orientation => new Promise((resolve, reject) => _bot_radar_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose isTurning
  tank
    .getContext()
    .global.setSync(
      "_bot_radar_isTurning",
      () => new ivm.ExternalCopy(tank.turret.radar.isTurning())
    );
  isolate
    .compileScriptSync(
      `
    bot.radar.isTurning = () => _bot_radar_isTurning().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose turn
  tank
    .getContext()
    .global.setSync(
      "_bot_radar_turn",
      (arg: number, resolve: () => void, reject: () => void) => {
        tank.turret.radar
          .turn(arg)
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.radar.turn = orientation => new Promise((resolve, reject) => _bot_radar_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose scan
  tank
    .getContext()
    .global.setSync(
      "_bot_radar_scan",
      (resolve: (result: []) => void, reject: () => void) => {
        tank.turret.radar
          .scan()
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.radar.scan = () => new Promise((resolve, reject) => _bot_radar_scan(new _ivm.Callback((result) => resolve(result)), new _ivm.Callback(() => reject())))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose onReady
  tank
    .getContext()
    .global.setSync(
      "_bot_radar_onReady",
      (resolve: (result: void) => void, reject: () => void) => {
        tank.turret.radar
          .onReady()
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.radar.onReady = () => new Promise((resolve, reject) => _bot_radar_onReady(new _ivm.Callback((result) => resolve(result)), new _ivm.Callback(() => reject())))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose isReady
  tank
    .getContext()
    .global.setSync(
      "_bot_radar_isReady",
      () => new ivm.ExternalCopy(tank.turret.radar.isReady())
    );
  isolate
    .compileScriptSync(
      `
    bot.radar.isReady = () => _bot_radar_isReady().copy()
  `
    )
    .runSync(tank.getContext(), {});
}

function exposeTankTurret(tank: Tank, isolate: ivm.Isolate) {
  // Expose getOrientation
  tank
    .getContext()
    .global.setSync(
      "_bot_turret_getOrientation",
      () => new ivm.ExternalCopy(tank.turret.getOrientation())
    );
  isolate
    .compileScriptSync(
      `
    bot.turret.getOrientation = () => _bot_turret_getOrientation().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose setOrientation
  tank
    .getContext()
    .global.setSync(
      "_bot_turret_setOrientation",
      (arg: number, resolve: () => void, reject: () => void) => {
        tank.turret
          .setOrientation(arg)
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.turret.setOrientation = orientation => new Promise((resolve, reject) => _bot_turret_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose isTurning
  tank
    .getContext()
    .global.setSync(
      "_bot_turret_isTurning",
      () => new ivm.ExternalCopy(tank.turret.isTurning())
    );
  isolate
    .compileScriptSync(
      `
    bot.turret.isTurning = () => _bot_turret_isTurning().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose turn
  tank
    .getContext()
    .global.setSync(
      "_bot_turret_turn",
      (arg: number, resolve: () => void, reject: () => void) => {
        tank.turret
          .turn(arg)
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.turret.turn = orientation => new Promise((resolve, reject) => _bot_turret_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose fire
  // todo resulting value
  tank
    .getContext()
    .global.setSync(
      "_bot_turret_fire",
      (resolve: () => void, reject: () => void) => {
        tank.turret
          .fire()
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.turret.fire = () => new Promise((resolve, reject) => _bot_turret_fire(new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose onReady
  tank
    .getContext()
    .global.setSync(
      "_bot_turret_onReady",
      (resolve: (result: void) => void, reject: () => void) => {
        tank.turret
          .onReady()
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.turret.onReady = () => new Promise((resolve, reject) => _bot_turret_onReady(new _ivm.Callback((result) => resolve(result)), new _ivm.Callback(() => reject())))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose isReady
  tank
    .getContext()
    .global.setSync(
      "_bot_turret_isReady",
      () => new ivm.ExternalCopy(tank.turret.isReady())
    );
  isolate
    .compileScriptSync(
      `
    bot.turret.isReady = () => _bot_turret_isReady().copy()
  `
    )
    .runSync(tank.getContext(), {});
}

function exposeTank(tank: Tank, isolate: ivm.Isolate) {
  // Expose event handler
  tank
    .getContext()
    .global.setSync("_bot_on", (event: Event, handler: ivm.Reference) => {
      tank.on(event, (...args) => {
        try {
          return new Promise((resolve, reject) => {
            handler.applySync(
              undefined,
              [resolve, reject, JSON.stringify(args)],
              { timeout: 5000 }
            );
          });
        } catch (e) {
          tank.logger.error(e);
          tank.appCrashed = true;
        }
      });
    });
  isolate
    .compileScriptSync(
      `
    bot.scope = {}
    bot.on = (event, handler) => _bot_on(event, new _ivm.Reference((resolve, reject, jsonArgs) => { 
      returnValue = handler.apply(bot.scope, JSON.parse(jsonArgs))
      return (returnValue || Promise.resolve()).then(resolve, reject)
    }))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose getId
  tank
    .getContext()
    .global.setSync("_bot_getId", () => new ivm.ExternalCopy(tank.getId()));
  isolate
    .compileScriptSync(
      `
    bot.getId = () => _bot_getId().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose getSpeed
  tank
    .getContext()
    .global.setSync(
      "_bot_getSpeed",
      () => new ivm.ExternalCopy(tank.getSpeed())
    );
  isolate
    .compileScriptSync(
      `
    bot.getSpeed = () => _bot_getSpeed().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose setSpeed
  tank
    .getContext()
    .global.setSync(
      "_bot_setSpeed",
      (arg: number, resolve: () => void, reject: () => void) => {
        tank
          .setSpeed(arg)
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.setSpeed =  speed => new Promise((resolve, reject) => _bot_setSpeed(speed, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose getOrientation
  tank
    .getContext()
    .global.setSync(
      "_bot_getOrientation",
      () => new ivm.ExternalCopy(tank.getOrientation())
    );
  isolate
    .compileScriptSync(
      `
    bot.getOrientation = () => _bot_getOrientation().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose setOrientation
  tank
    .getContext()
    .global.setSync(
      "_bot_setOrientation",
      (arg: number, resolve: () => void, reject: () => void) => {
        tank
          .setOrientation(arg)
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.setOrientation = orientation => new Promise((resolve, reject) => _bot_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose setName
  tank.getContext().global.setSync("_bot_setName", (arg: string) => {
    tank.setName(arg);
  });
  isolate
    .compileScriptSync(
      `
    bot.setName = name => _bot_setName(name)
  `
    )
    .runSync(tank.getContext(), {});

  // Expose getHealth
  tank
    .getContext()
    .global.setSync(
      "_bot_getHealth",
      () => new ivm.ExternalCopy(tank.getHealth())
    );
  isolate
    .compileScriptSync(
      `
    bot.getHealth = () => _bot_getHealth().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose isTurning
  tank
    .getContext()
    .global.setSync(
      "_bot_isTurning",
      () => new ivm.ExternalCopy(tank.isTurning())
    );
  isolate
    .compileScriptSync(
      `
    bot.isTurning = () => _bot_isTurning().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose turn
  tank
    .getContext()
    .global.setSync(
      "_bot_turn",
      (arg: number, resolve: () => void, reject: () => void) => {
        tank
          .turn(arg)
          .then(resolve, reject)
          .catch((e) => tank.logger.error(e));
      }
    );
  isolate
    .compileScriptSync(
      `
    bot.turn = orientation => new Promise((resolve, reject) => _bot_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `
    )
    .runSync(tank.getContext(), {});

  // Expose getX
  tank
    .getContext()
    .global.setSync("_bot_getX", () => new ivm.ExternalCopy(tank.getX()));
  isolate
    .compileScriptSync(
      `
    bot.getX = () => _bot_getX().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose getY
  tank
    .getContext()
    .global.setSync("_bot_getY", () => new ivm.ExternalCopy(tank.getY()));
  isolate
    .compileScriptSync(
      `
    bot.getY = () => _bot_getY().copy()
  `
    )
    .runSync(tank.getContext(), {});

  // Expose send
  tank.getContext().global.setSync("_bot_send", (arg: number) => {
    tank.send(arg);
  });
  isolate
    .compileScriptSync(
      `
    bot.send = message => _bot_send(message)
  `
    )
    .runSync(tank.getContext(), {});
}

// Execute the tank code
const execute = (process: Process, tank: Tank) => {
  tank.handlers = {};
  tank.timers.reset();
  try {
    process
      .getSandbox()
      .compileScriptSync(process.app.getSource())
      .runSync(tank.getContext(), { timeout: 5000 });
  } catch (e) {
    tank.logger.error(e);
    tank.appCrashed = true;
  }
};

// Initialize a tank.getContext() within the isolated sandbox
const init = (arena: Arena, process: Process, tank: Tank) => {
  try {
    tank.getContext().global.setSync("_ivm", ivm);

    // Expose tank
    process
      .getSandbox()
      .compileScriptSync(`const bot={radar: {}, turret: {}}`)
      .runSync(tank.getContext(), {});
    exposeTank(tank, process.getSandbox());
    exposeTankRadar(tank, process.getSandbox());
    exposeTankTurret(tank, process.getSandbox());

    // Expose scheduler / timers
    const scheduler = scheduleFactory(tank);
    tank
      .getContext()
      .global.setSync("_setInterval", (func: () => void, interval: number) => {
        scheduler.setInterval(func, interval, arena);
      });
    tank.getContext().global.setSync("_clearInterval", (id: number) => {
      scheduler.clearInterval(id);
    });
    process
      .getSandbox()
      .compileScriptSync(
        `
      setInterval = (func, interval) => _setInterval(new _ivm.Callback(() => { func() }), interval)
      clearInterval = (id) => _clearInterval(id)
    `
      )
      .runSync(tank.getContext(), {});

    tank
      .getContext()
      .global.setSync("_setTimeout", (func: () => void, interval: number) => {
        scheduler.setTimeout(func, interval, arena);
      });
    tank.getContext().global.setSync("_clearTimeout", (id: number) => {
      scheduler.clearTimeout(id);
    });
    process
      .getSandbox()
      .compileScriptSync(
        `
      setTimeout = (func, interval) => _setTimeout(new _ivm.Callback(() => { func() }), interval)
      clearTimeout = (id) => _clearTimeout(id)
    `
      )
      .runSync(tank.getContext(), {});

    // Expose clock
    // TODO .on(Event.TICK, ...)
    tank
      .getContext()
      .global.setSync(
        "_clock_getTime",
        () => new ivm.ExternalCopy(arena.getTime())
      );
    process
      .getSandbox()
      .compileScriptSync(
        `
      clock = {}
      clock.getTime = () => _clock_getTime().copy()
      clock.on = (event, handler) => _bot_on(event, new _ivm.Reference((resolve, reject, jsonArgs) => { 
        if(event !== "TICK") throw new Error("Invalid event type")
        returnValue = handler.apply(bot.scope, JSON.parse(jsonArgs))
        return (returnValue || Promise.resolve()).then(resolve, reject)
      }))
      Date = undefined
      `
      )
      .runSync(tank.getContext(), {});

    // Expose arena
    tank
      .getContext()
      .global.setSync(
        "_arena_getWidth",
        () => new ivm.ExternalCopy(arena.getWidth())
      );
    tank
      .getContext()
      .global.setSync(
        "_arena_getHeight",
        () => new ivm.ExternalCopy(arena.getHeight())
      );
    process
      .getSandbox()
      .compileScriptSync(
        `
      arena = {};
      arena.getWidth = () => _arena_getWidth().copy();
      arena.getHeight = () => _arena_getHeight().copy();
    `
      )
      .runSync(tank.getContext(), {});

    // Expose console / logger
    const streams = [
      {
        level: "TRACE",
        stream: {
          write: (entry) => {
            arena.emit("log", {
              ...entry,
              time: arena.getTime(),
              id: uuidv4(),
            });
          },
        },
      },
    ];
    const tankId =
      (arena
        .getProcesses()
        .map((process) => process.app.getId())
        .indexOf(process.app.getId()) +
        1) *
        10 +
      ((arena
        .getProcesses()
        .find((process) => process.app.getId() === process.app.getId())
        ?.tanks.map((tank) => tank.id)
        .indexOf(tank.id) || 0) +
        1);

    tank.logger = createLogger({
      name: process.app.getName() + " <" + tankId + ">",
      streams,
    });

    tank.getContext().global.setSync("_log", (msg: any, ...msgs: any[]) => {
      console.log(msg, ...msgs);
      tank.logger.info(msg, ...msgs);
    });
    // TODO better log-level support
    process
      .getSandbox()
      .compileScriptSync(
        `
      logger = {};
      logger.log = _log;
      logger.info = _log;
      logger.trace = _log;
      logger.debug = _log;
      logger.warn = _log;
      logger.error = _log;
      console = {log: _log};
    `
      )
      .runSync(tank.getContext(), {});

    // Expose Event definitions
    process
      .getSandbox()
      .compileScriptSync(
        `
      Event = {
        RECEIVED: 'RECEIVED',
        FIRED:'FIRED',
        SCANNED:'SCANNED',
        COLLIDED:'COLLIDED',
        START:'START',
        TICK:'TICK',
        HIT: 'HIT',
        DETECTED:'DETECTED',          
      }
  `
      )
      .runSync(tank.getContext(), {});
  } catch (e) {
    tank.logger.error(e);
    tank.appCrashed = true;
  }
};

export default {
  execute,
  init,
};
