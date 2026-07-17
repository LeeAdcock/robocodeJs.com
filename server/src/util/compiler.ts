import Bot, { BOT_RADIUS } from '../types/bot';
import { BULLET_SPEED, BULLET_DAMAGE } from '../types/bullet';
import { Event } from '../types/event';
import { scheduleFactory } from './scheduleFactory';
import ivm from 'isolated-vm';
import { createLogger } from 'browser-bunyan';
import { randomUUID } from 'node:crypto';
import Environment, { Process } from '../types/environment';
import Arena from '../types/arena';
import appService from '../services/AppService';
import { ErrorCodes } from '../types/ErrorCodes';
import { logBotFault, logger, LogEvent } from './logger';
import { toApiHeading, toInternalHeading } from './geometry';
import { parseMessage } from './message';

// Identifying context for a faulting bot, for the structured server log.
const botCtx = (bot: Bot) => ({
  appId: bot.process.appId,
  botId: bot.id,
  arenaId: bot.env.getArena().getId?.(),
});

// Pull a bot-code location (line/column) out of an isolated-vm error. Runtime
// errors carry it in the stack ("at <isolated-vm>:12:5"); syntax errors often
// embed it in the message ("... [<isolated-vm>:1:1]"). Best-effort — undefined
// when V8 didn't attach one.
const parseIsolateLocation = (
  err: unknown
): { line?: number; column?: number } => {
  const text =
    (err instanceof Error && (err.stack || err.message)) || String(err);
  const match = text.match(/<isolated-vm>:(\d+):(\d+)/);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : {};
};

// isolated-vm names the sandbox source `<isolated-vm>` in its error messages,
// e.g. "Unexpected end of input [<isolated-vm>:22:1]". That internal detail is
// noise to a bot author, so rewrite the location to a friendly "(line 22, char 1)"
// and scrub any stray reference to the sandbox name.
const cleanErrorMessage = (message: string): string =>
  message
    .replace(/\s*\[<isolated-vm>:(\d+):(\d+)\]/g, ' (line $1, char $2)')
    .replace(/<isolated-vm>/g, 'bot code');

// Record a fatal bot fault on the environment's fault feed (a bounded buffer plus
// a `botFault` SSE event) so a crash is surfaced prominently — in the UI (banner /
// in-arena indicator / jump-to-line) and to MCP (`recent_faults`). This is
// additive: the per-site bot.logger + logBotFault calls stay as they are.
const emitBotFault = (
  bot: Bot,
  code: ErrorCodes,
  kind: string,
  err: unknown
) => {
  // Parse the location from the raw error (its stack/message still has the
  // <isolated-vm> marker), then clean the message shown to the author.
  const { line, column } = parseIsolateLocation(err);
  const message = cleanErrorMessage(
    err instanceof Error ? err.message : String(err)
  );
  bot.env.reportFault({
    appId: bot.process.appId,
    botId: bot.id,
    botIndex: bot.process.bots.map((t) => t.id).indexOf(bot.id) + 1,
    code,
    kind,
    message,
    line,
    column,
    timedOut: /timed out|timeout/i.test(message),
    time: bot.env.getTime(),
  });
};

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
  bot: Bot,
  code: ErrorCodes
) {
  return ref
    .apply(undefined, args, { timeout: sandboxTimeoutMs() })
    .catch((e: unknown) => {
      const kind = code === ErrorCodes.E020 ? 'timer' : 'callback';
      bot.logger.error(`${code}: ${e}`);
      bot.appCrashed = true;
      logBotFault(botCtx(bot), kind, e);
      emitBotFault(bot, code, kind, e);
    });
}

// --- helpers for exposing the bot API into the isolate ---
// Each installs a native `_name` function on the isolate global and compiles the
// matching `botPath` wrapper that bridges to it. ivm objects (Callbacks,
// References) are always built host-side; the ivm module is never exposed to
// untrusted bot code.

// Synchronous getter: `botPath()` copies fn()'s result out of the host.
function exposeGetter(
  bot: Bot,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: () => unknown
) {
  bot.getContext().global.setSync(name, () => new ivm.ExternalCopy(fn()));
  isolate
    .compileScriptSync(`${botPath} = () => ${name}().copy()`)
    .runSync(bot.getContext(), {});
}

// Settles a pending bot-side promise by id (see __settle). Each bot's settler
// is registered by init; the async callbacks below look it up by bot, so the
// expose* helpers don't need to thread it through their signatures.
type Settle = (id: number, ok: boolean, value: unknown) => void;
const settlers = new WeakMap<Bot, Settle>();

// A settler is registered for every bot during init, before any bot code, timer,
// or command can run, so one is always present by the time a settlement fires.
// Resolve it through this helper so that invariant is an explicit throw rather
// than a non-null assertion.
function getSettler(bot: Bot): Settle {
  const settle = settlers.get(bot);
  if (!settle) {
    throw new Error('No settler registered for bot');
  }
  return settle;
}

// Async action taking one argument; resolves/rejects when fn() settles. The
// side effect (fn) runs synchronously inside this sync callback so commands
// apply immediately; the promise the bot is awaiting is settled later via the
// host-captured __settle reference. The bot wrapper calls the shared
// __asyncCall bridge, so no ivm primitive is ever exposed to bot code.
function exposeAsync1(
  bot: Bot,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: (arg: number) => Promise<unknown>
) {
  bot.getContext().global.setSync(name, (id: number, arg: number) => {
    const settle = getSettler(bot);
    fn(arg).then(
      (v) => settle(id, true, v),
      (e) => settle(id, false, e)
    );
  });
  isolate
    .compileScriptSync(`${botPath} = (arg) => __asyncCall(${name}, arg)`)
    .runSync(bot.getContext(), {});
}

// Async action with no arguments that resolves with fn()'s result (e.g.
// radar.scan's hit list). __settle copies object results across the boundary.
function exposeAsyncResult(
  bot: Bot,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: () => Promise<unknown>
) {
  bot.getContext().global.setSync(name, (id: number) => {
    const settle = getSettler(bot);
    fn().then(
      (v) => settle(id, true, v),
      (e) => settle(id, false, e)
    );
  });
  isolate
    .compileScriptSync(`${botPath} = () => __asyncCall(${name})`)
    .runSync(bot.getContext(), {});
}

// Fire-and-forget call passing a single argument through to fn.
function exposeVoid(
  bot: Bot,
  isolate: ivm.Isolate,
  botPath: string,
  name: string,
  fn: (arg: unknown) => void
) {
  bot.getContext().global.setSync(name, (arg: unknown) => {
    fn(arg);
  });
  isolate
    .compileScriptSync(`${botPath} = (arg) => ${name}(arg)`)
    .runSync(bot.getContext(), {});
}

// Isolate helpers are compiled from source text, so any engine constant they use
// must be interpolated from the real host value — never re-typed as a literal, or
// the sandbox's math and the physics silently drift apart. `num` is both the
// convention marker and a guard: a NaN/Infinity would paste as broken source.
const num = (n: number): string => {
  if (!Number.isFinite(n)) throw new Error(`Non-finite isolate constant: ${n}`);
  return JSON.stringify(n);
};

function exposeBotRadar(bot: Bot, isolate: ivm.Isolate) {
  const radar = bot.turret.radar;
  exposeGetter(
    bot,
    isolate,
    'bot.radar.getOrientation',
    '_bot_radar_getOrientation',
    () => radar.getOrientation()
  );
  exposeAsync1(
    bot,
    isolate,
    'bot.radar.setOrientation',
    '_bot_radar_setOrientation',
    (arg) => radar.setOrientation(arg)
  );
  exposeGetter(
    bot,
    isolate,
    'bot.radar.isTurning',
    '_bot_radar_isTurning',
    () => radar.isTurning()
  );
  exposeAsync1(bot, isolate, 'bot.radar.turn', '_bot_radar_turn', (arg) =>
    radar.turn(arg)
  );

  // Convenience turnTowards
  isolate
    .compileScriptSync(
      `
      bot.radar.turnTowards = (x, y) => {
        let bearing = Math.atan2(x - bot.getX(), bot.getY() - y) * (180 / Math.PI)
        return bot.radar.setOrientation(bearing - bot.getOrientation() - bot.turret.getOrientation())
      }
      `
    )
    .runSync(bot.getContext(), {});

  exposeAsyncResult(bot, isolate, 'bot.radar.scan', '_bot_radar_scan', () =>
    radar.scan()
  );
  exposeAsyncResult(
    bot,
    isolate,
    'bot.radar.onReady',
    '_bot_radar_onReady',
    () => radar.onReady()
  );
  exposeGetter(bot, isolate, 'bot.radar.isReady', '_bot_radar_isReady', () =>
    radar.isReady()
  );

  // Physics constants, mirrored into the sandbox as plain data properties at
  // init — from the engine's module constants, or from the instance fields
  // those constants seed. None of these values mutate mid-match today; if one
  // ever does, its property must become an exposeGetter method or the sandbox
  // copy silently goes stale.
  isolate
    .compileScriptSync(`bot.radar.turnRate = ${num(radar.orientationVelocity)}`)
    .runSync(bot.getContext(), {});
}

function exposeBotTurret(bot: Bot, isolate: ivm.Isolate) {
  const turret = bot.turret;
  exposeGetter(
    bot,
    isolate,
    'bot.turret.getOrientation',
    '_bot_turret_getOrientation',
    () => turret.getOrientation()
  );
  exposeAsync1(
    bot,
    isolate,
    'bot.turret.setOrientation',
    '_bot_turret_setOrientation',
    (arg) => turret.setOrientation(arg)
  );
  exposeGetter(
    bot,
    isolate,
    'bot.turret.isTurning',
    '_bot_turret_isTurning',
    () => turret.isTurning()
  );
  exposeAsync1(bot, isolate, 'bot.turret.turn', '_bot_turret_turn', (arg) =>
    turret.turn(arg)
  );

  // Convenience turnTowards
  isolate
    .compileScriptSync(
      `
      bot.turret.turnTowards = (x, y) => {
        let bearing = Math.atan2(x - bot.getX(), bot.getY() - y) * (180 / Math.PI)
        return bot.turret.setOrientation(bearing - bot.getOrientation())
      }
      `
    )
    .runSync(bot.getContext(), {});

  // Expose fire
  bot.getContext().global.setSync('_bot_turret_fire', (id: number) => {
    const settle = getSettler(bot);
    turret.fire().then(
      (v) => settle(id, true, v),
      (e) => settle(id, false, e)
    );
  });
  isolate
    .compileScriptSync(`bot.turret.fire = () => __asyncCall(_bot_turret_fire)`)
    .runSync(bot.getContext(), {});

  exposeAsyncResult(
    bot,
    isolate,
    'bot.turret.onReady',
    '_bot_turret_onReady',
    () => turret.onReady()
  );
  exposeGetter(bot, isolate, 'bot.turret.isReady', '_bot_turret_isReady', () =>
    turret.isReady()
  );

  // Physics constants, mirrored as plain data properties at init (see the
  // note in exposeBotRadar).
  isolate
    .compileScriptSync(
      `
      bot.turret.turnRate = ${num(turret.orientationVelocity)}
      bot.turret.bulletSpeed = ${num(BULLET_SPEED)}
      bot.turret.bulletDamage = ${num(BULLET_DAMAGE)}
      `
    )
    .runSync(bot.getContext(), {});
}

function exposeBot(bot: Bot, isolate: ivm.Isolate) {
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
    .runSync(bot.getContext(), {});

  // Captured once, before any bot code runs, so a bot reassigning __dispatch
  // later cannot hijack what the host invokes.
  const dispatchRef = bot
    .getContext()
    .evalSync('__dispatch', { reference: true });

  // Returns two promises for one handler invocation:
  //   done   — resolves when the handler fully finishes (may be many ticks later,
  //            if it awaits multi-tick commands); drives bot.on's re-entry guard.
  //   parked — resolves when the apply returns, i.e. the handler has run to its
  //            first await-park this tick; the tick loop awaits this so bot code
  //            has executed before the next tick advances.
  const dispatchEvent = (event: string, ...args: unknown[]) => {
    let done_resolve!: (value?: unknown) => void;
    let done_reject!: (reason?: unknown) => void;
    const done = new Promise((resolve, reject) => {
      done_resolve = resolve;
      done_reject = reject;
    });
    // apply (async) runs the handler off the main thread under the timeout; the
    // handler settles `done` via the resolve/reject host callbacks. The apply
    // promise itself resolves at the first await-park and surfaces synchronous
    // failures (e.g. a handler that loops past the timeout).
    const parked = dispatchRef
      .apply(
        undefined,
        [event, JSON.stringify(args), done_resolve, done_reject],
        {
          timeout: sandboxTimeoutMs(),
        }
      )
      .catch((e: unknown) => {
        bot.logger.error(`${ErrorCodes.E013}: ${e}`);
        bot.appCrashed = true;
        logBotFault(botCtx(bot), 'handler', e);
        emitBotFault(bot, ErrorCodes.E013, 'handler', e);
        done_reject(e);
      });
    return { parked, done };
  };

  bot.getContext().global.setSync(
    '_bot_register',
    new ivm.Callback(
      (event: Event) => {
        bot.on(event, (...args: unknown[]) => dispatchEvent(event, ...args));
      },
      { sync: true }
    )
  );

  exposeGetter(bot, isolate, 'bot.getId', '_bot_getId', () => bot.getId());
  exposeGetter(bot, isolate, 'bot.getSpeed', '_bot_getSpeed', () =>
    bot.getSpeed()
  );
  exposeAsync1(bot, isolate, 'bot.setSpeed', '_bot_setSpeed', (arg) =>
    bot.setSpeed(arg)
  );
  // The body heading is the one absolute angle the bot sees, so translate it
  // between the internal south-zero compass and the bot-facing north-zero one.
  exposeGetter(bot, isolate, 'bot.getOrientation', '_bot_getOrientation', () =>
    toApiHeading(bot.getOrientation())
  );
  exposeAsync1(
    bot,
    isolate,
    'bot.setOrientation',
    '_bot_setOrientation',
    (arg) => bot.setOrientation(toInternalHeading(arg))
  );

  isolate
    .compileScriptSync(
      `bot.dropMarker = () => arena.createMarker(bot.getX(), bot.getY())`
    )
    .runSync(bot.getContext(), {});

  exposeVoid(bot, isolate, 'bot.setName', '_bot_setName', (arg) =>
    bot.setName(arg as string)
  );
  exposeGetter(bot, isolate, 'bot.getHealth', '_bot_getHealth', () =>
    bot.getHealth()
  );
  exposeGetter(bot, isolate, 'bot.isTurning', '_bot_isTurning', () =>
    bot.isTurning()
  );
  exposeAsync1(bot, isolate, 'bot.turn', '_bot_turn', (arg) => bot.turn(arg));
  exposeGetter(bot, isolate, 'bot.getX', '_bot_getX', () => bot.getX());
  exposeGetter(bot, isolate, 'bot.getY', '_bot_getY', () => bot.getY());
  // bot.send accepts any JSON value — a primitive, or nested arrays/objects of
  // primitives. The value crosses the sandbox boundary as a JSON string: the
  // bot-side wrapper stringifies it and the host parses + validates it
  // (parseMessage) before broadcasting. JSON is the whitelist, so functions,
  // class instances, Dates, Maps/Sets, and host references can never be sent.
  bot.getContext().global.setSync('_bot_send', (json: unknown) => {
    bot.send(parseMessage(json));
  });
  isolate
    .compileScriptSync(
      `bot.send = (message) => _bot_send(JSON.stringify(message))`
    )
    .runSync(bot.getContext(), {});

  // Convenience turnTowards
  isolate
    .compileScriptSync(
      `
      bot.turnTowards = (x, y) => {
        let bearing = Math.atan2(x - bot.getX(), bot.getY() - y) * (180 / Math.PI)
        return bot.setOrientation(bearing)
      }
      `
    )
    .runSync(bot.getContext(), {});

  // Physics constants, mirrored as plain data properties at init (see the
  // note in exposeBotRadar).
  isolate
    .compileScriptSync(
      `
      bot.radius = ${num(BOT_RADIUS)}
      bot.maxSpeed = ${num(bot.speedMax)}
      bot.acceleration = ${num(bot.speedAcceleration)}
      bot.turnRate = ${num(bot.orientationVelocity)}
      `
    )
    .runSync(bot.getContext(), {});
}

// Bot source is (re)run in the SAME persisted isolate context on every reload:
// a live save re-registers handlers without re-firing START, so the context —
// and its global lexical scope — is intentionally kept (see `execute` below).
// Running the author's code directly in that scope means a top-level `const` or
// `let` is re-declared on the second load and throws "Identifier '…' has already
// been declared" (surfaced as E017), even though the docs promise top-level
// variables simply "reset every time the code is reloaded". Wrapping the source
// in an immediately-invoked arrow gives every load its own fresh function scope,
// so top-level `const`/`let`/`var` no longer collide across reloads.
//
// Why an ARROW (not `function`): the arrow keeps `this` bound to the enclosing
// script's `this`, which for a classic isolated-vm script is the context's
// global object. Bots share state across handlers (and across reloads) by
// assigning to `this` — the documented pattern — so preserving that binding is
// required. The opener adds NO newline, so bot-code line numbers in fault
// reports (parsed from `<isolated-vm>:line:col`) are unchanged; the closing
// `})()` sits on its own trailing line, after all author code.
const wrapSource = (source: string): string => `(() => {${source}\n})()`;

// Execute the bot code
const execute = (process: Process, bot: Bot): Promise<unknown> => {
  bot.handlers = {};
  bot.timers.reset();
  // Reloading code re-registers handlers and resets timers, but deliberately
  // does NOT re-fire START: a running bot keeps the state it set up so an edit
  // (auto-save / save) doesn't disrupt a match. START still fires on first
  // placement (Bot.needsStarting defaults to true), on arena restart, and when
  // the author explicitly reboots the bot (Environment.reboot / the editor's
  // reboot button).
  return appService.get(process.getAppId()).then((app) => {
    if (!app) return;
    const onError = (e: unknown) => {
      bot.logger.error(`${ErrorCodes.E017}: ${e}`);
      bot.appCrashed = true;
      logBotFault(botCtx(bot), 'load', e);
      emitBotFault(bot, ErrorCodes.E017, 'load', e);
    };
    let script: ivm.Script;
    try {
      // Compile is synchronous (and can throw on a syntax error); the top-level
      // run goes async so the bot's startup code runs off the main thread.
      // wrapSource gives each (re)load a fresh scope so top-level const/let don't
      // collide when this same context is re-run on a live save.
      script = process
        .getSandbox()
        .compileScriptSync(wrapSource(app.getSource()));
    } catch (e) {
      onError(e);
      return;
    }
    return script
      .run(bot.getContext(), { timeout: sandboxTimeoutMs() })
      .catch(onError);
  });
};

// Initialize a bot.getContext() within the isolated sandbox
const init = (env: Environment, process: Process, bot: Bot) => {
  try {
    // Expose bot
    process
      .getSandbox()
      .compileScriptSync(`const bot={radar: {}, turret: {}}`)
      .runSync(bot.getContext(), {});

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
      .runSync(bot.getContext(), {});

    const settleRef = bot
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
      // Tracked so the tick loop's drain awaits the resumed handler running to its
      // next await-park before advancing.
      env.trackBotOp(
        settleRef
          .apply(undefined, [id, ok, transfer], { timeout: sandboxTimeoutMs() })
          .catch(() => undefined)
      );
    };
    settlers.set(bot, settle);

    exposeBot(bot, process.getSandbox());
    exposeBotRadar(bot, process.getSandbox());
    exposeBotTurret(bot, process.getSandbox());

    // Expose scheduler / timers, without exposing ivm. The bot keeps its timer
    // callbacks in an isolate-side table keyed by id and the host captures a
    // Reference to a single `__runTimer` entry point — the mirror of the event
    // dispatch above. Running it under the sandbox timeout keeps a looping timer
    // body from hanging the host thread.
    const scheduler = scheduleFactory(bot);
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
          const id = ++__timerSeq; __timers[id] = func
          // A falsy return means the host refused the timer (per-bot cap, E021);
          // drop the callback we just stored so it can't leak or fire.
          if (!_setInterval(id, interval)) { delete __timers[id]; return -1 }
          return id
        }
        clearInterval = (id) => { delete __timers[id]; _clearInterval(id) }
        setTimeout = (func, interval) => {
          const id = ++__timerSeq; __timers[id] = func
          if (!_setTimeout(id, interval)) { delete __timers[id]; return -1 }
          return id
        }
        clearTimeout = (id) => { delete __timers[id]; _clearTimeout(id) }
        `
      )
      .runSync(bot.getContext(), {});

    const runTimerRef = bot
      .getContext()
      .evalSync('__runTimer', { reference: true });
    const fireTimer = (id: number, oneShot: boolean) =>
      // Tracked so the tick loop awaits the timer callback running to its next
      // await-park, keeping timer-driven bots deterministic under acceleration.
      env.trackBotOp(
        runInIsolate(runTimerRef, [id, oneShot], bot, ErrorCodes.E020)
      );

    bot
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
    bot.getContext().global.setSync(
      '_clearInterval',
      new ivm.Callback((id: number) => scheduler.clearInterval(id), {
        sync: true,
      })
    );
    bot
      .getContext()
      .global.setSync(
        '_setTimeout',
        new ivm.Callback(
          (id: number, interval: number) =>
            scheduler.setTimeout(id, () => fireTimer(id, true), interval, env),
          { sync: true }
        )
      );
    bot.getContext().global.setSync(
      '_clearTimeout',
      new ivm.Callback((id: number) => scheduler.clearTimeout(id), {
        sync: true,
      })
    );

    // Expose clock
    bot
      .getContext()
      .global.setSync(
        '_clock_getTime',
        () => new ivm.ExternalCopy(env.getTime())
      );
    // Seed this bot's Math.random from the arena PRNG so bot randomness is
    // reproducible when the arena seed is fixed (and still varies by default,
    // since the default seed is nondeterministic). Each bot draws a distinct
    // sub-seed, so bots behave differently but repeatably. The generator is pure
    // in-isolate JS (mulberry32) — no host round-trip per call.
    const mathSeed = Math.floor(env.random() * 0x100000000);
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
        {
          let __rng = ${mathSeed} >>> 0
          Math.random = () => {
            __rng = (__rng + 0x6D2B79F5) | 0
            let t = Math.imul(__rng ^ (__rng >>> 15), 1 | __rng)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
          }
        }
        `
      )
      .runSync(bot.getContext(), {});

    // Expose arena
    bot
      .getContext()
      .global.setSync(
        '_arena_getWidth',
        () => new ivm.ExternalCopy(env.getArena().getWidth())
      );
    bot
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
            getBearing: () => {
              const heading =
                Math.atan2(x - bot.getX(), bot.getY() - y) * (180 / Math.PI)
              return (((heading - bot.getOrientation()) % 360) + 360) % 360
            }
          }
        }
      `
      )
      .runSync(bot.getContext(), {});

    // Expose console / logger
    const streams = [
      {
        level: 'TRACE',
        stream: {
          write: (entry: Record<string, unknown>) => {
            env.emit('log', {
              ...entry,
              // Identify the source for non-UI consumers (the MCP recent_logs
              // tool): the bot's uuid and the bot's 1-based index within that
              // bot. The bunyan `name` ("<25>") is a compact UI label that's
              // opaque to API clients.
              appId: process.getAppId(),
              botIndex: process.bots.map((t) => t.id).indexOf(bot.id) + 1,
              time: env.getTime(),
              id: randomUUID(),
            });
          },
        },
      },
    ];
    const botId =
      (env
        .getProcesses()
        .map((p) => p.getAppId())
        .indexOf(process.getAppId()) +
        1) *
        10 +
      ((env
        .getProcesses()
        .find((p) => p.getAppId() === process.getAppId())
        ?.bots.map((t) => t.id)
        .indexOf(bot.id) || 0) +
        1);

    bot.logger = createLogger({
      name: '<' + botId + '>',
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
    // primitive level string plus a message string here. Coerce defensively in
    // case `_log` is called directly. `level` is validated against the bunyan
    // method allowlist so a bot can't reach an arbitrary property of the logger.
    const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
    type LogLevel = (typeof LOG_LEVELS)[number];
    bot.getContext().global.setSync('_log', (level: unknown, msg: unknown) => {
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
            { event: LogEvent.BOT_FAULT, kind: 'log-flood', ...botCtx(bot) },
            'bot exceeded per-tick log budget; dropping further output'
          );
        }
        return;
      }
      logCount += 1;
      // Anything unexpected (a bot calling `_log` directly, an unknown method)
      // falls back to INFO — the bunyan method name rides the SSE entry as
      // `levelName`, driving the UI's per-level coloring/filtering.
      const method: LogLevel = LOG_LEVELS.includes(level as LogLevel)
        ? (level as LogLevel)
        : 'info';
      bot.logger[method](clampLog(typeof msg === 'string' ? msg : String(msg)));
    });
    // Bot console/logger methods differentiate log levels (GitHub #147):
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
    //
    // Each method passes its level as a PRIMITIVE string ('trace'/'debug'/
    // 'info'/'warn'/'error') alongside the already-formatted message; only
    // those two primitives cross the boundary (primitives clone safely), never
    // an object or function. The host maps the level to the matching bunyan
    // method so the level rides the SSE entry (see `_log` above).
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
          // Build a logging function bound to one level. The level is a plain
          // string primitive so it clones safely across the isolate boundary;
          // only it and the formatted message string are ever passed to emit.
          function at(level) {
            return function () {
              emit(level, fmt.apply(null, arguments));
            };
          }
          logger = {
            log: at('info'),
            info: at('info'),
            trace: at('trace'),
            debug: at('debug'),
            warn: at('warn'),
            error: at('error'),
          };
          console = {
            log: at('info'),
            info: at('info'),
            warn: at('warn'),
            error: at('error'),
            debug: at('debug'),
          };
        })();
        _log = undefined;
       `
      )
      .runSync(bot.getContext(), {});

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
      .runSync(bot.getContext(), {});
  } catch (e) {
    bot.logger.error(`${ErrorCodes.E018}: ${e}`);
    bot.appCrashed = true;
    logBotFault(botCtx(bot), 'init', e);
    emitBotFault(bot, ErrorCodes.E018, 'init', e);
  }
};

// The outcome of a dry-run compile (see `check`). `valid` is the only field on
// success; a failure carries the stage, the error code, the message, and whether
// it was a sandbox timeout.
export interface CheckResult {
  valid: boolean;
  stage?: 'compile' | 'load';
  errorCode?: ErrorCodes;
  message?: string;
  timedOut?: boolean;
}

// Dry-run compile: load a bot's source in a throwaway isolate WITHOUT adding it to
// an arena, and RETURN any syntax/load error instead of logging it (as `execute`
// does). Powers the `check_bot_source` MCP tool, the `/check` REST endpoint, and
// the editor Check button, so authors and AI catch mistakes before deploying.
//
// It reuses the real Environment/Process/Bot/init path against a fresh throwaway
// Environment (which runs no tick loop and touches no database), then disposes the
// isolate. It deliberately does NOT call logBotFault / set appCrashed — a dry-run
// is not a real fault and must not pollute logs or fault alerting.
//
// The Environment/Process carry a sentinel id (not a real uuid) purely to satisfy
// their constructors — nothing keys a DB lookup off it, and the process is flagged
// non-persisted so persistence paths (e.g. Bot.setName) skip the database outright.
const DRY_RUN_SENTINEL = 'dry-run';
const check = async (source: string): Promise<CheckResult> => {
  const env = new Environment(new Arena(DRY_RUN_SENTINEL, DRY_RUN_SENTINEL));
  const process = new Process(DRY_RUN_SENTINEL, /* persisted */ false);
  const failure = (stage: 'compile' | 'load', e: unknown): CheckResult => {
    const message = cleanErrorMessage(
      e instanceof Error ? e.message : String(e)
    );
    return {
      valid: false,
      stage,
      // Mirrors execute()'s onError: both a syntax error and a top-level load
      // failure surface as E017; `stage` disambiguates which.
      errorCode: ErrorCodes.E017,
      message,
      timedOut: /timed out|timeout/i.test(message),
    };
  };
  try {
    const bot = new Bot(env, process);
    process.bots.push(bot);
    init(env, process, bot);
    let script: ivm.Script;
    try {
      // Synchronous compile — throws on a syntax error. Wrap identically to
      // execute() so the dry-run's scoping (and thus what it accepts/rejects)
      // matches a real load.
      script = process.getSandbox().compileScriptSync(wrapSource(source));
    } catch (e) {
      return failure('compile', e);
    }
    try {
      // Top-level load — runs the bot's setup (registering handlers, etc.),
      // bounded by the sandbox timeout so an infinite top-level loop is caught.
      await script.run(bot.getContext(), { timeout: sandboxTimeoutMs() });
    } catch (e) {
      return failure('load', e);
    }
    return { valid: true };
  } finally {
    process.dispose();
  }
};

export default {
  execute,
  init,
  check,
  emitBotFault,
};
