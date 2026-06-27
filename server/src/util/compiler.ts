import Tank from '../types/tank';
import { Event } from '../types/event';
import { scheduleFactory } from './scheduleFactory';
import ivm from 'isolated-vm';
import { createLogger } from 'browser-bunyan';
import { v4 as uuidv4 } from 'uuid';
import Environment, { Process } from '../types/environment';
import appService from '../services/AppService';
import { ErrorCodes } from '../types/ErrorCodes';
import { logBotFault, logger, LogEvent } from './logger';

// Identifying context for a faulting bot, for the structured server log.
const botCtx = (tank: Tank) => ({
  appId: tank.process.appId,
  tankId: tank.id,
  arenaId: tank.env.getArena().getId?.(),
});

// Wall-clock ceiling, in ms, for any single synchronous entry into untrusted
// bot code (top-level script load, event handlers, and timer callbacks).
// Without it a bot can hang the host thread forever — e.g. an interval whose
// body is `while (true) {}`. Tunable via env so it can be tightened in prod or
// shortened in tests; defaults to 5s to match the original behavior.
const sandboxTimeoutMs = () => Number(process.env.SANDBOX_TIMEOUT_MS) || 5000;

// Bounds on bot-controlled log output, which is broadcast to every SSE client.
const MAX_LOGS_PER_TICK = 50;
const MAX_LOG_LENGTH = 2000;

// Invoke an isolate function (captured host-side as a Reference) under the
// sandbox timeout. `apply` (async) runs the bot's work on isolated-vm's thread
// pool rather than the main event loop, so a runaway bot can't stall the
// simulation or other arenas; host callbacks it makes still run on the main
// thread. A timeout (or any throw) crashes the bot rather than the server;
// Simulation kills crashed bots. Drives timer callbacks and promise settling.
function runInIsolate(
  ref: ivm.Reference,
  args: unknown[],
  tank: Tank,
  code: ErrorCodes
) {
  return ref
    .apply(undefined, args, { timeout: sandboxTimeoutMs() })
    .catch((e: unknown) => {
      tank.logger.error(`${code}: ${e}`);
      tank.appCrashed = true;
      logBotFault(
        botCtx(tank),
        code === ErrorCodes.E020 ? 'timer' : 'callback',
        e
      );
    });
}

// --- helpers for exposing the bot API into the isolate ---
// Each installs a native `_name` function on the isolate global and compiles the
// matching `botPath` wrapper that bridges to it. ivm objects (Callbacks,
// References) are always built host-side; the ivm module is never exposed to
// untrusted bot code.

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

// Settles a pending bot-side promise by id (see __settle). Each tank's settler
// is registered by init; the async callbacks below look it up by tank, so the
// expose* helpers don't need to thread it through their signatures.
type Settle = (id: number, ok: boolean, value: unknown) => void;
const settlers = new WeakMap<Tank, Settle>();

// Async action taking one argument; resolves/rejects when fn() settles. The
// side effect (fn) runs synchronously inside this sync callback so commands
// apply immediately; the promise the bot is awaiting is settled later via the
// host-captured __settle reference. The bot wrapper calls the shared
// __asyncCall bridge, so no ivm primitive is ever exposed to bot code.
function exposeAsync1(
  tank: Tank,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: (arg: number) => Promise<unknown>
) {
  tank.getContext().global.setSync(name, (id: number, arg: number) => {
    const settle = settlers.get(tank)!;
    fn(arg).then(
      (v) => settle(id, true, v),
      (e) => settle(id, false, e)
    );
  });
  isolate
    .compileScriptSync(`${botPath} = (arg) => __asyncCall(${name}, arg)`)
    .runSync(tank.getContext(), {});
}

// Async action with no arguments that resolves with fn()'s result (e.g.
// radar.scan's hit list). __settle copies object results across the boundary.
function exposeAsyncResult(
  tank: Tank,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: () => Promise<unknown>
) {
  tank.getContext().global.setSync(name, (id: number) => {
    const settle = settlers.get(tank)!;
    fn().then(
      (v) => settle(id, true, v),
      (e) => settle(id, false, e)
    );
  });
  isolate
    .compileScriptSync(`${botPath} = () => __asyncCall(${name})`)
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
  tank.getContext().global.setSync('_bot_turret_fire', (id: number) => {
    const settle = settlers.get(tank)!;
    turret.fire().then(
      (v) => settle(id, true, v),
      (e) => settle(id, false, e)
    );
  });
  isolate
    .compileScriptSync(`bot.turret.fire = () => __asyncCall(_bot_turret_fire)`)
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
  // Event handlers, without exposing ivm. The bot stores its handler functions
  // in an isolate-side table (`__handlers`); the host captures a Reference to a
  // single `__dispatch` entry point and drives it when an event fires. The
  // handler functions never cross the boundary — only the event name + JSON args
  // do (host -> isolate) and resolve/reject callbacks (which auto-wrap).
  isolate
    .compileScriptSync(
      `
      bot.scope = {}
      const __handlers = {}
      bot.on = (event, handler) => { __handlers[event] = handler; _bot_register(event) }
      globalThis.__dispatch = (event, jsonArgs, resolve, reject) => {
        const handler = __handlers[event]
        if (!handler) { resolve(); return }
        const returnValue = handler.apply(bot.scope, JSON.parse(jsonArgs))
        return (returnValue || Promise.resolve()).then(resolve, reject)
      }
      `
    )
    .runSync(tank.getContext(), {});

  // Captured once, before any bot code runs, so a bot reassigning __dispatch
  // later cannot hijack what the host invokes.
  const dispatchRef = tank
    .getContext()
    .evalSync('__dispatch', { reference: true });

  const dispatchEvent = (event: string, x: unknown) =>
    new Promise((resolve, reject) => {
      // apply (async) runs the handler off the main thread under the timeout;
      // the handler settles this promise via the resolve/reject host callbacks.
      // The apply promise itself only surfaces synchronous failures (e.g. a
      // handler that loops past the timeout).
      dispatchRef
        .apply(undefined, [event, JSON.stringify([x]), resolve, reject], {
          timeout: sandboxTimeoutMs(),
        })
        .catch((e: unknown) => {
          tank.logger.error(`${ErrorCodes.E013}: ${e}`);
          tank.appCrashed = true;
          logBotFault(botCtx(tank), 'handler', e);
          reject(e);
        });
    });

  tank.getContext().global.setSync(
    '_bot_register',
    new ivm.Callback(
      (event: Event) => {
        tank.on(event, (x: unknown) => dispatchEvent(event, x));
      },
      { sync: true }
    )
  );

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
  // Re-arm the START event so loading (or reloading) code always re-runs the
  // bot's initialization. Without this, swapping a bot's source onto a tank that
  // already started would re-register handlers but never fire START — so any
  // state a bot sets up in START (e.g. waypoints) would be missing when TICK runs.
  tank.needsStarting = true;
  return appService.get(process.getAppId()).then((app) => {
    if (!app) return;
    const onError = (e: unknown) => {
      tank.logger.error(`${ErrorCodes.E017}: ${e}`);
      tank.appCrashed = true;
      logBotFault(botCtx(tank), 'load', e);
    };
    let script: ivm.Script;
    try {
      // Compile is synchronous (and can throw on a syntax error); the top-level
      // run goes async so the bot's startup code runs off the main thread.
      script = process.getSandbox().compileScriptSync(app.getSource());
    } catch (e) {
      onError(e);
      return;
    }
    return script
      .run(tank.getContext(), { timeout: sandboxTimeoutMs() })
      .catch(onError);
  });
};

// Initialize a tank.getContext() within the isolated sandbox
const init = (env: Environment, process: Process, tank: Tank) => {
  try {
    // Expose tank
    process
      .getSandbox()
      .compileScriptSync(`const bot={radar: {}, turret: {}}`)
      .runSync(tank.getContext(), {});

    // Async-call bridge (no ivm in the isolate). The bot's async API wrappers
    // call __asyncCall, which parks the promise's resolve/reject in __pending
    // keyed by id and makes a synchronous native call. The host later settles it
    // via the captured __settle reference. __pending is closure-private so bot
    // code cannot reach into other pending calls.
    process
      .getSandbox()
      .compileScriptSync(
        `
        let __asyncSeq = 0
        const __pending = {}
        const __asyncCall = (nativeFn, ...args) => new Promise((resolve, reject) => {
          const id = ++__asyncSeq
          __pending[id] = { resolve, reject }
          nativeFn(id, ...args)
        })
        globalThis.__settle = (id, ok, value) => {
          const p = __pending[id]
          if (!p) return
          delete __pending[id]
          if (ok) p.resolve(value)
          else p.reject(value)
        }
        `
      )
      .runSync(tank.getContext(), {});

    const settleRef = tank
      .getContext()
      .evalSync('__settle', { reference: true });
    const settle: Settle = (id, ok, value) => {
      // Objects (e.g. the scan hit list) must be copied to cross the boundary;
      // primitives transfer as-is.
      const transfer =
        typeof value === 'object' && value !== null
          ? new ivm.ExternalCopy(value).copyInto()
          : value;
      // Delivering a settlement is NOT bot execution, so it must not be treated
      // as a crash. In particular, rejecting a command promise the bot chose not
      // to await (e.g. a cancelled `bot.setSpeed`) surfaces here as a rejected
      // apply — that's normal, so swallow it rather than killing the bot.
      settleRef
        .apply(undefined, [id, ok, transfer], { timeout: sandboxTimeoutMs() })
        .catch(() => undefined);
    };
    settlers.set(tank, settle);

    exposeTank(tank, process.getSandbox());
    exposeTankRadar(tank, process.getSandbox());
    exposeTankTurret(tank, process.getSandbox());

    // Expose scheduler / timers, without exposing ivm. The bot keeps its timer
    // callbacks in an isolate-side table keyed by id and the host captures a
    // Reference to a single `__runTimer` entry point — the mirror of the event
    // dispatch above. Running it under the sandbox timeout keeps a looping timer
    // body from hanging the host thread.
    const scheduler = scheduleFactory(tank);
    process
      .getSandbox()
      .compileScriptSync(
        `
        let __timerSeq = 0
        const __timers = {}
        globalThis.__runTimer = (id, oneShot) => {
          const func = __timers[id]
          if (oneShot) delete __timers[id]
          if (func) func()
        }
        setInterval = (func, interval) => {
          const id = ++__timerSeq; __timers[id] = func; _setInterval(id, interval); return id
        }
        clearInterval = (id) => { delete __timers[id]; _clearInterval(id) }
        setTimeout = (func, interval) => {
          const id = ++__timerSeq; __timers[id] = func; _setTimeout(id, interval); return id
        }
        clearTimeout = (id) => { delete __timers[id]; _clearTimeout(id) }
        `
      )
      .runSync(tank.getContext(), {});

    const runTimerRef = tank
      .getContext()
      .evalSync('__runTimer', { reference: true });
    const fireTimer = (id: number, oneShot: boolean) =>
      runInIsolate(runTimerRef, [id, oneShot], tank, ErrorCodes.E020);

    tank
      .getContext()
      .global.setSync(
        '_setInterval',
        new ivm.Callback(
          (id: number, interval: number) =>
            scheduler.setInterval(
              id,
              () => fireTimer(id, false),
              interval,
              env
            ),
          { sync: true }
        )
      );
    tank.getContext().global.setSync(
      '_clearInterval',
      new ivm.Callback((id: number) => scheduler.clearInterval(id), {
        sync: true,
      })
    );
    tank
      .getContext()
      .global.setSync(
        '_setTimeout',
        new ivm.Callback(
          (id: number, interval: number) =>
            scheduler.setTimeout(id, () => fireTimer(id, true), interval, env),
          { sync: true }
        )
      );
    tank.getContext().global.setSync(
      '_clearTimeout',
      new ivm.Callback((id: number) => scheduler.clearTimeout(id), {
        sync: true,
      })
    );

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
        clock.on = (event, handler) => {
          if (event !== "TICK") throw new Error("Invalid event type")
          __handlers[event] = handler
          _bot_register(event)
        }
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
    const clampLog = (m: string) =>
      m.length > MAX_LOG_LENGTH ? m.slice(0, MAX_LOG_LENGTH) + '…' : m;
    // The bot-side wrappers (below) format every argument into a single string
    // before it crosses the isolate boundary, so the host only ever receives a
    // string here. Coerce defensively in case `_log` is called directly.
    tank.getContext().global.setSync('_log', (msg: any) => {
      const now = env.getTime();
      if (now !== logWindow) {
        logWindow = now;
        logCount = 0;
      }
      if (logCount >= MAX_LOGS_PER_TICK) {
        // Note the first drop in each window (a bot spamming logs is an abuse
        // signal); subsequent drops in the same window are silent.
        if (logCount === MAX_LOGS_PER_TICK) {
          logCount += 1;
          logger.warn(
            { event: LogEvent.BOT_FAULT, kind: 'log-flood', ...botCtx(tank) },
            'bot exceeded per-tick log budget; dropping further output'
          );
        }
        return;
      }
      logCount += 1;
      tank.logger.info(clampLog(typeof msg === 'string' ? msg : String(msg)));
    });
    // TODO better log-level support
    //
    // console.log / logger.* accept any mix of arguments — strings, numbers,
    // objects, arrays, Errors. We format them into one display string *inside*
    // the isolate, because isolated-vm copies arguments across the boundary and
    // that copy throws on values it can't clone (functions, circular refs),
    // which — since logging is synchronous — would otherwise crash the bot. The
    // formatter never throws: objects are safe-stringified (with circular-ref
    // and function placeholders), Errors render their stack, and any failure
    // falls back to String(). The result is one string, matching the UI, which
    // only displays the message text. The helpers live in a closure so they
    // can't be clobbered, and `_log` is captured before being hidden so bots
    // can't reach the raw (crash-prone) channel directly.
    process
      .getSandbox()
      .compileScriptSync(
        `
        (function () {
          var emit = _log;
          // Serialize one value into something JSON.stringify can render,
          // tracking ancestors so genuine cycles become '[Circular]' without
          // false-positiving on values merely shared between siblings.
          function safe(v, anc) {
            if (v === null) return null;
            var t = typeof v;
            if (t === 'string' || t === 'number' || t === 'boolean') return v;
            if (t === 'undefined') return undefined;
            if (t === 'bigint') return v.toString() + 'n';
            if (t === 'symbol') return v.toString();
            if (t === 'function')
              return '[Function' + (v.name ? ': ' + v.name : '') + ']';
            if (t === 'object') {
              if (anc.indexOf(v) !== -1) return '[Circular]';
              if (v instanceof Error)
                return v.stack || v.name + ': ' + v.message;
              var next = anc.concat([v]);
              if (Array.isArray(v))
                return v.map(function (x) {
                  return safe(x, next);
                });
              var out = {};
              var keys = Object.keys(v);
              for (var i = 0; i < keys.length; i++) {
                try {
                  out[keys[i]] = safe(v[keys[i]], next);
                } catch (e) {
                  out[keys[i]] = '[Unreadable]';
                }
              }
              return out;
            }
            return String(v);
          }
          // Render one top-level argument as a display string.
          function disp(a) {
            if (typeof a === 'string') return a;
            var s;
            try {
              s = safe(a, []);
            } catch (e) {
              try {
                return String(a);
              } catch (e2) {
                return '[Unserializable]';
              }
            }
            if (typeof s === 'string') return s;
            if (s === undefined) return 'undefined';
            try {
              return JSON.stringify(s);
            } catch (e) {
              return String(s);
            }
          }
          // Join all arguments with spaces, console.log style.
          function fmt() {
            var parts = [];
            for (var i = 0; i < arguments.length; i++)
              parts.push(disp(arguments[i]));
            return parts.join(' ');
          }
          var log = function () {
            emit(fmt.apply(null, arguments));
          };
          logger = {
            log: log,
            info: log,
            trace: log,
            debug: log,
            warn: log,
            error: log,
          };
          console = {
            log: log,
            info: log,
            warn: log,
            error: log,
            debug: log,
          };
        })();
        _log = undefined;
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
    tank.logger.error(`${ErrorCodes.E018}: ${e}`);
    tank.appCrashed = true;
    logBotFault(botCtx(tank), 'init', e);
  }
};

export default {
  execute,
  init,
};
