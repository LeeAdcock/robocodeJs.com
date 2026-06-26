import Tank from '../types/tank';
import { Event } from '../types/event';
import { scheduleFactory } from './scheduleFactory';
import ivm from 'isolated-vm';
import { createLogger } from 'browser-bunyan';
import { v4 as uuidv4 } from 'uuid';
import Environment, { Process } from '../types/environment';
import appService from '../services/AppService';
import { ErrorCodes } from '../types/ErrorCodes';

// Wall-clock ceiling, in ms, for any single synchronous entry into untrusted
// bot code (top-level script load, event handlers, and timer callbacks).
// Without it a bot can hang the host thread forever — e.g. an interval whose
// body is `while (true) {}`. Tunable via env so it can be tightened in prod or
// shortened in tests; defaults to 5s to match the original behavior.
const sandboxTimeoutMs = () => Number(process.env.SANDBOX_TIMEOUT_MS) || 5000;

// Bounds on bot-controlled log output, which is broadcast to every SSE client.
const MAX_LOGS_PER_TICK = 50;
const MAX_LOG_LENGTH = 2000;

// Invoke a bot-supplied timer callback (an isolate Reference) under the sandbox
// timeout, isolating the host thread from runaway loops. A timeout (or any
// throw) crashes the bot rather than the server; Simulation kills crashed bots.
function runTimer(func: ivm.Reference, tank: Tank) {
  try {
    func.applySync(undefined, [], { timeout: sandboxTimeoutMs() });
  } catch (e) {
    tank.logger.error(`${ErrorCodes.E020}: ${e}`);
    tank.appCrashed = true;
    console.log(e);
  }
}

// --- helpers for exposing the bot API into the isolate ---
// Each installs a native `_name` function on the isolate global and compiles the
// matching `botPath` wrapper that bridges to it (via ExternalCopy for values and
// _ivm.Callback for async results).

// Synchronous getter: `botPath()` copies fn()'s result out of the host.
function exposeGetter(
  tank: Tank,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: () => unknown
) {
  tank.getContext().global.setSync(name, () => new ivm.ExternalCopy(fn()));
  isolate
    .compileScriptSync(`${botPath} = () => ${name}().copy()`)
    .runSync(tank.getContext(), {});
}

// Async action taking one argument; resolves/rejects when fn() settles.
function exposeAsync1(
  tank: Tank,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: (arg: number) => Promise<unknown>
) {
  tank
    .getContext()
    .global.setSync(
      name,
      (
        arg: number,
        resolve: (v?: unknown) => void,
        reject: (v?: unknown) => void
      ) => {
        fn(arg).then(resolve, reject).catch(reject);
      }
    );
  isolate
    .compileScriptSync(
      `${botPath} = arg => new Promise((resolve, reject) => ${name}(arg, new _ivm.Callback(resolve), new _ivm.Callback(reject)))`
    )
    .runSync(tank.getContext(), {});
}

// Async action with no arguments that resolves with fn()'s result.
function exposeAsyncResult(
  tank: Tank,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: () => Promise<unknown>
) {
  tank
    .getContext()
    .global.setSync(
      name,
      (resolve: (v?: unknown) => void, reject: (v?: unknown) => void) => {
        fn().then(resolve, reject).catch(reject);
      }
    );
  isolate
    .compileScriptSync(
      `${botPath} = () => new Promise((resolve, reject) => ${name}(new _ivm.Callback((result) => resolve(result)), new _ivm.Callback(() => reject())))`
    )
    .runSync(tank.getContext(), {});
}

// Fire-and-forget call passing a single argument through to fn.
function exposeVoid(
  tank: Tank,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: (arg: any) => void
) {
  tank.getContext().global.setSync(name, (arg: any) => {
    fn(arg);
  });
  isolate
    .compileScriptSync(`${botPath} = (arg) => ${name}(arg)`)
    .runSync(tank.getContext(), {});
}

function exposeTankRadar(tank: Tank, isolate: ivm.Isolate) {
  const radar = tank.turret.radar;
  exposeGetter(
    tank,
    isolate,
    'bot.radar.getOrientation',
    '_bot_radar_getOrientation',
    () => radar.getOrientation()
  );
  exposeAsync1(
    tank,
    isolate,
    'bot.radar.setOrientation',
    '_bot_radar_setOrientation',
    (arg) => radar.setOrientation(arg)
  );
  exposeGetter(
    tank,
    isolate,
    'bot.radar.isTurning',
    '_bot_radar_isTurning',
    () => radar.isTurning()
  );
  exposeAsync1(tank, isolate, 'bot.radar.turn', '_bot_radar_turn', (arg) =>
    radar.turn(arg)
  );

  // Convenience turnTowards
  isolate
    .compileScriptSync(
      `
      bot.radar.turnTowards = (x, y) => {
        let bearing = Math.atan2(bot.getY() - y, bot.getX() - x) * (180 / Math.PI) - 90 + 180
        return bot.radar.setOrientation(bearing - bot.getOrientation() - bot.turret.getOrientation())
      }
      `
    )
    .runSync(tank.getContext(), {});

  exposeAsyncResult(tank, isolate, 'bot.radar.scan', '_bot_radar_scan', () =>
    radar.scan()
  );
  exposeAsyncResult(
    tank,
    isolate,
    'bot.radar.onReady',
    '_bot_radar_onReady',
    () => radar.onReady()
  );
  exposeGetter(tank, isolate, 'bot.radar.isReady', '_bot_radar_isReady', () =>
    radar.isReady()
  );
}

function exposeTankTurret(tank: Tank, isolate: ivm.Isolate) {
  const turret = tank.turret;
  exposeGetter(
    tank,
    isolate,
    'bot.turret.getOrientation',
    '_bot_turret_getOrientation',
    () => turret.getOrientation()
  );
  exposeAsync1(
    tank,
    isolate,
    'bot.turret.setOrientation',
    '_bot_turret_setOrientation',
    (arg) => turret.setOrientation(arg)
  );
  exposeGetter(
    tank,
    isolate,
    'bot.turret.isTurning',
    '_bot_turret_isTurning',
    () => turret.isTurning()
  );
  exposeAsync1(tank, isolate, 'bot.turret.turn', '_bot_turret_turn', (arg) =>
    turret.turn(arg)
  );

  // Convenience turnTowards
  isolate
    .compileScriptSync(
      `
      bot.turret.turnTowards = (x, y) => {
        let bearing = Math.atan2(bot.getY() - y, bot.getX() - x) * (180 / Math.PI) - 90 + 180
        return bot.turret.setOrientation(bearing - bot.getOrientation())
      }
      `
    )
    .runSync(tank.getContext(), {});

  // Expose fire
  // todo resulting value
  tank
    .getContext()
    .global.setSync(
      '_bot_turret_fire',
      (resolve: (v?: unknown) => void, reject: (v?: unknown) => void) => {
        turret.fire().then(resolve, reject).catch(reject);
      }
    );
  isolate
    .compileScriptSync(
      `
      bot.turret.fire = () => new Promise((resolve, reject) =>
        _bot_turret_fire(new _ivm.Callback(resolve), new _ivm.Callback(reject))
      )
      `
    )
    .runSync(tank.getContext(), {});

  exposeAsyncResult(
    tank,
    isolate,
    'bot.turret.onReady',
    '_bot_turret_onReady',
    () => turret.onReady()
  );
  exposeGetter(tank, isolate, 'bot.turret.isReady', '_bot_turret_isReady', () =>
    turret.isReady()
  );
}

function exposeTank(tank: Tank, isolate: ivm.Isolate) {
  // Expose event handler
  tank
    .getContext()
    .global.setSync('_bot_on', (event: Event, handler: ivm.Reference) => {
      tank.on(event, (...args: unknown[]) => {
        try {
          return new Promise((resolve, reject) => {
            handler.applySync(
              undefined,
              [resolve, reject, JSON.stringify(args)],
              { timeout: sandboxTimeoutMs() }
            );
          });
        } catch (e) {
          tank.logger.error(`${ErrorCodes.E013}: ${e}`);
          tank.appCrashed = true;
          console.log(e);
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

  exposeGetter(tank, isolate, 'bot.getId', '_bot_getId', () => tank.getId());
  exposeGetter(tank, isolate, 'bot.getSpeed', '_bot_getSpeed', () =>
    tank.getSpeed()
  );
  exposeAsync1(tank, isolate, 'bot.setSpeed', '_bot_setSpeed', (arg) =>
    tank.setSpeed(arg)
  );
  exposeGetter(tank, isolate, 'bot.getOrientation', '_bot_getOrientation', () =>
    tank.getOrientation()
  );
  exposeAsync1(
    tank,
    isolate,
    'bot.setOrientation',
    '_bot_setOrientation',
    (arg) => tank.setOrientation(arg)
  );

  isolate
    .compileScriptSync(
      `bot.dropMarker = () => arena.createMarker(bot.getX(), bot.getY())`
    )
    .runSync(tank.getContext(), {});

  exposeVoid(tank, isolate, 'bot.setName', '_bot_setName', (arg) =>
    tank.setName(arg)
  );
  exposeGetter(tank, isolate, 'bot.getHealth', '_bot_getHealth', () =>
    tank.getHealth()
  );
  exposeGetter(tank, isolate, 'bot.isTurning', '_bot_isTurning', () =>
    tank.isTurning()
  );
  exposeAsync1(tank, isolate, 'bot.turn', '_bot_turn', (arg) => tank.turn(arg));
  exposeGetter(tank, isolate, 'bot.getX', '_bot_getX', () => tank.getX());
  exposeGetter(tank, isolate, 'bot.getY', '_bot_getY', () => tank.getY());
  exposeVoid(tank, isolate, 'bot.send', '_bot_send', (arg) => tank.send(arg));

  // Convenience turnTowards
  isolate
    .compileScriptSync(
      `
      bot.turnTowards = (x, y) => {
        let bearing = Math.atan2(bot.getY() - y, bot.getX() - x) * (180 / Math.PI) - 90 + 180
        return bot.setOrientation(bearing)
      }
      `
    )
    .runSync(tank.getContext(), {});
}

// Execute the tank code
const execute = (process: Process, tank: Tank): Promise<unknown> => {
  tank.handlers = {};
  tank.timers.reset();
  return appService.get(process.getAppId()).then((app) => {
    if (app) {
      try {
        process
          .getSandbox()
          .compileScriptSync(app.getSource())
          .runSync(tank.getContext(), { timeout: sandboxTimeoutMs() });
      } catch (e) {
        tank.logger.error(`${ErrorCodes.E017}: ${e}`);
        tank.appCrashed = true;
        console.log(e);
      }
    }
  });
};

// Initialize a tank.getContext() within the isolated sandbox
const init = (env: Environment, process: Process, tank: Tank) => {
  try {
    tank.getContext().global.setSync('_ivm', ivm);

    // Expose tank
    process
      .getSandbox()
      .compileScriptSync(`const bot={radar: {}, turret: {}}`)
      .runSync(tank.getContext(), {});
    exposeTank(tank, process.getSandbox());
    exposeTankRadar(tank, process.getSandbox());
    exposeTankTurret(tank, process.getSandbox());

    // Expose scheduler / timers. The bot hands its callback across as an isolate
    // Reference (not a Callback) so the host can invoke it under the sandbox
    // timeout via runTimer — a Callback would run with no time limit, letting a
    // looping timer body hang the whole server.
    const scheduler = scheduleFactory(tank);
    tank
      .getContext()
      .global.setSync('_setInterval', (func: ivm.Reference, interval: number) =>
        scheduler.setInterval(() => runTimer(func, tank), interval, env)
      );
    tank.getContext().global.setSync('_clearInterval', (id: number) => {
      scheduler.clearInterval(id);
    });
    process
      .getSandbox()
      .compileScriptSync(
        `
        setInterval = (func, interval) =>
          _setInterval(new _ivm.Reference(func), interval)
        clearInterval = (id) => _clearInterval(id)
        `
      )
      .runSync(tank.getContext(), {});

    tank
      .getContext()
      .global.setSync('_setTimeout', (func: ivm.Reference, interval: number) =>
        scheduler.setTimeout(() => runTimer(func, tank), interval, env)
      );
    tank.getContext().global.setSync('_clearTimeout', (id: number) => {
      scheduler.clearTimeout(id);
    });
    process
      .getSandbox()
      .compileScriptSync(
        `
        setTimeout = (func, interval) =>
          _setTimeout(new _ivm.Reference(func), interval)
        clearTimeout = (id) => _clearTimeout(id)
        `
      )
      .runSync(tank.getContext(), {});

    // Expose clock
    tank
      .getContext()
      .global.setSync(
        '_clock_getTime',
        () => new ivm.ExternalCopy(env.getTime())
      );
    process
      .getSandbox()
      .compileScriptSync(
        `
        clock = {}
        clock.getTime = () => _clock_getTime().copy()
        clock.on = (event, handler) => _bot_on(event, new _ivm.Reference((resolve, reject, jsonArgs) => {
          if(event !== "TICK") throw new Error("Invalid event type")
          returnValue = handler.apply(bot.T, JSON.parse(jsonArgs))
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
        '_arena_getWidth',
        () => new ivm.ExternalCopy(env.getArena().getWidth())
      );
    tank
      .getContext()
      .global.setSync(
        '_arena_getHeight',
        () => new ivm.ExternalCopy(env.getArena().getHeight())
      );
    process
      .getSandbox()
      .compileScriptSync(
        `
        arena = {};
        arena.getWidth = () => _arena_getWidth().copy();
        arena.getHeight = () => _arena_getHeight().copy();

        arena.createMarker = (x, y) => {
          return {
            getX: () => x,
            getY: () => y,
            getDistance: () => Math.floor(Math.sqrt(
                Math.pow(bot.getX() - x, 2) +
                  Math.pow(bot.getY() - y, 2)
              )),
            getBearing: () =>
              Math.atan2(bot.getY() - y, bot.getX() - x) *
                (180 / Math.PI) - 90 + 180
          }
        }
      `
      )
      .runSync(tank.getContext(), {});

    // Expose console / logger
    const streams = [
      {
        level: 'TRACE',
        stream: {
          write: (entry: any) => {
            env.emit('log', {
              ...entry,
              time: env.getTime(),
              id: uuidv4(),
            });
          },
        },
      },
    ];
    const tankId =
      (env
        .getProcesses()
        .map((p) => p.getAppId())
        .indexOf(process.getAppId()) +
        1) *
        10 +
      ((env
        .getProcesses()
        .find((p) => p.getAppId() === process.getAppId())
        ?.tanks.map((t) => t.id)
        .indexOf(tank.id) || 0) +
        1);

    tank.logger = createLogger({
      name: '<' + tankId + '>',
      streams,
    });

    // Bot-controlled log output is broadcast to every connected SSE client, so
    // bound it: drop anything past a per-tick budget (stops a tight loop from
    // flooding clients) and clamp long strings. The budget resets whenever the
    // simulation clock advances; within one synchronous handler the clock is
    // fixed, so a logging loop is capped at MAX_LOGS_PER_TICK.
    let logCount = 0;
    let logWindow = env.getTime();
    const clampLog = (m: unknown) =>
      typeof m === 'string' && m.length > MAX_LOG_LENGTH
        ? m.slice(0, MAX_LOG_LENGTH) + '…'
        : m;
    tank.getContext().global.setSync('_log', (msg: any, ...msgs: any[]) => {
      const now = env.getTime();
      if (now !== logWindow) {
        logWindow = now;
        logCount = 0;
      }
      if (logCount >= MAX_LOGS_PER_TICK) return;
      logCount += 1;
      tank.logger.info(clampLog(msg), ...msgs.map(clampLog));
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
    console.log(e);
    tank.logger.error(`${ErrorCodes.E018}: ${e}`);
    tank.appCrashed = true;
  }
};

export default {
  execute,
  init,
};
