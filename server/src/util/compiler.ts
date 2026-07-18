import Bot, {
  BOT_RADIUS,
  BOT_TURN_SPEED,
  BOT_ACCELERATION,
  BOT_MAX_SPEED,
} from '../types/bot';
import { TURRET_TURN_SPEED } from '../types/botTurret';
import { RADAR_TURN_SPEED } from '../types/botRadar';
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
import { lintUndeclared } from './sourceLint';

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

  // Engine constants, mirrored into the sandbox as plain data properties at
  // init. None of these values vary mid-match today; if one ever becomes
  // per-instance or mutable, its property must instead read the live field via
  // an exposeGetter method or the sandbox copy silently goes stale.
  isolate
    .compileScriptSync(`bot.radar.TURN_RATE = ${num(RADAR_TURN_SPEED)}`)
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

  // Engine constants, mirrored as plain data properties at init (see the
  // note in exposeBotRadar).
  isolate
    .compileScriptSync(
      `
      bot.turret.TURN_RATE = ${num(TURRET_TURN_SPEED)}
      bot.turret.BULLET_SPEED = ${num(BULLET_SPEED)}
      bot.turret.BULLET_DAMAGE = ${num(BULLET_DAMAGE)}
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
        const args = JSON.parse(jsonArgs)
        // SCANNED hands the handler the same Contact objects radar.scan()
        // resolves with (__makeContact is defined in a later init script;
        // events only fire after init completes).
        if (event === 'SCANNED' && Array.isArray(args[0]))
          args[0] = args[0].map(__makeContact)
        const returnValue = handler.apply(bot.scope, args)
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

  // Engine constants, mirrored as plain data properties at init (see the
  // note in exposeBotRadar).
  isolate
    .compileScriptSync(
      `
      bot.RADIUS = ${num(BOT_RADIUS)}
      bot.MAX_SPEED = ${num(BOT_MAX_SPEED)}
      bot.ACCELERATION = ${num(BOT_ACCELERATION)}
      bot.TURN_RATE = ${num(BOT_TURN_SPEED)}
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
//
// Why `'use strict'`: sloppy mode turns a typo'd assignment (`speeed = 5`) into
// a silent implicit global that reads back as if it worked — the least
// debuggable failure a bot author can hit. Strict mode makes it throw a
// ReferenceError where it happens instead (and `check`'s no-undef lint catches
// it before deploy). The directive only strictens the author's code: it sits
// inside the arrow body, so the enclosing script stays sloppy and the arrow's
// `this` is still the context's global object — the `this.foo` state pattern
// is unaffected (explicit property assignment is legal in strict mode).
const wrapSource = (source: string): string =>
  `(() => {'use strict';${source}\n})()`;

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
        // Determinism: Date is gone, but Intl.DateTimeFormat().format() with no
        // argument formats the *current* wall-clock time — a back-door real clock
        // (and entropy source) that would break seeded-match reproducibility. Bots
        // have no need for locale formatting, so remove Intl entirely.
        Intl = undefined
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

        // Attach methods as NON-enumerable properties, so Object.keys /
        // for...in / spread / JSON.stringify see only an object's data — a
        // Contact enumerates exactly like the plain scan result it replaced.
        const __withMethods = (obj, methods) => {
          for (const k of Object.keys(methods))
            Object.defineProperty(obj, k, {
              value: methods[k],
              enumerable: false,
              writable: true,
              configurable: true,
            })
          return obj
        }

        // Single factory behind every positional helper (createMarker,
        // dropMarker, getNearestWall), so all markers share one shape.
        // x/y are enumerable data (not just accessors) so a Marker survives
        // serialization — bot.send(marker), spread, JSON — and the receiver
        // can rebuild it with arena.createMarker(msg.x, msg.y).
        const __makeMarker = (x, y) => __withMethods({ x, y }, {
          getX: () => x,
          getY: () => y,
          getDistance: () => {
            const bx = bot.getX(), by = bot.getY()
            return Math.sqrt((bx - x) * (bx - x) + (by - y) * (by - y))
          },
          getBearing: () => {
            const heading =
              Math.atan2(x - bot.getX(), bot.getY() - y) * (180 / Math.PI)
            return (((heading - bot.getOrientation()) % 360) + 360) % 360
          },
          isInBounds: () => arena.contains(x, y),
        })

        arena.createMarker = (x, y) => __makeMarker(x, y)

        arena.contains = (x, y) =>
          x >= 0 && x <= arena.getWidth() && y >= 0 && y <= arena.getHeight()

        // Nearest point on the arena boundary — a Marker, so getDistance()
        // ("how far to the wall") and getBearing() ("which way") come free.
        // Note bots collide 16 units before the wall itself.
        arena.getNearestWall = () => {
          const x = bot.getX(), y = bot.getY()
          const w = arena.getWidth(), h = arena.getHeight()
          const d = [y, h - y, x, w - x]
          const p = [[x, 0], [x, h], [0, y], [w, y]]
          let i = 0
          for (let j = 1; j < 4; j++) if (d[j] < d[i]) i = j
          return __makeMarker(p[i][0], p[i][1])
        }
      `
      )
      .runSync(bot.getContext(), {});

    // Contacts: radar.scan() results (and SCANNED handler args) upgraded from
    // plain data to Markers-with-motion. Pure in-isolate JS over the same
    // copied scan payload — no new host plumbing.
    process
      .getSandbox()
      .compileScriptSync(
        `
        // A Contact IS a Marker pinned where the scanned bot WAS at capture
        // (recovered from the capture-time bearing + distance; the pin does
        // not track the target afterwards) that still carries every raw
        // ScanResult field — so existing bots reading .distance/.angle, and
        // bot.send(contact), see exactly the data they always did — plus an
        // intercept solver. Marker's getDistance()/getBearing() are measured
        // from the bot's CURRENT position to that fixed pin (they change as
        // WE move, not as the target moves); .distance/.angle stay capture-time.
        // Only data fields are enumerable (methods ride along invisibly), so
        // Object.keys / for...in / spread / JSON see the scan fields plus the
        // frame-independent x/y/time — everything a receiver needs to rebuild
        // the Contact with arena.createContact after a bot.send round-trip
        // (the scan's angle/distance are relative to the SCANNER, so on their
        // own they can't be re-anchored from anywhere else).
        //
        // Core factory over absolute kinematics ({x, y, speed, orientation,
        // time} + any extra readings, all kept as data). Shared by the scan
        // path and arena.createContact so a rehydrated Contact is built by
        // literally the same code.
        const __makeContactFrom = (data) => {
          const x0 = data.x, y0 = data.y, t0 = data.time
          const h = (data.orientation * Math.PI) / 180
          const vx = data.speed * Math.sin(h)
          const vy = -data.speed * Math.cos(h)
          return __withMethods(Object.assign(__makeMarker(x0, y0), data), {
            // Accessor forms of the raw scan readings, so the whole Contact
            // surface is methods like every other bot API object. The plain
            // properties stay for compatibility (and are the wire shape
            // bot.send(contact) transmits).
            getId: () => data.id,
            getSpeed: () => data.speed,
            getOrientation: () => data.orientation,
            isFriendly: () => data.friendly,
            getHealth: () => data.health,
            // Where to aim (or drive) so something leaving our position at
            // the given speed meets this contact, assuming it holds its
            // heading and speed — pass bot.turret.BULLET_SPEED to lead a shot,
            // or bot.MAX_SPEED to cut it off. Closed-form smallest-positive
            // root; folds in ticks elapsed since the scan. Returns a Marker,
            // or null when no interception is possible.
            getIntercept: (speed) => {
              if (!(speed > 0) || !isFinite(speed)) return null
              // Clamp: a rehydrated snapshot can carry a capture tick from
              // before a match restart (the clock resets to 0) — treat a
              // from-the-future time as "now" instead of projecting backward.
              const dt = Math.max(0, clock.getTime() - t0)
              const px = x0 + vx * dt - bot.getX()
              const py = y0 + vy * dt - bot.getY()
              const a = vx * vx + vy * vy - speed * speed
              const bq = 2 * (px * vx + py * vy)
              const c = px * px + py * py
              let t
              if (Math.abs(a) < 1e-9) {
                if (Math.abs(bq) < 1e-9) return null
                t = -c / bq
              } else {
                const disc = bq * bq - 4 * a * c
                if (disc < 0) return null
                const r = Math.sqrt(disc)
                const pos = [(-bq - r) / (2 * a), (-bq + r) / (2 * a)]
                  .filter((v) => v > 0)
                if (pos.length === 0) return null
                t = Math.min.apply(null, pos)
              }
              if (!(t > 0) || !isFinite(t)) return null
              return __makeMarker(x0 + vx * (dt + t), y0 + vy * (dt + t))
            },
          })
        }

        // Scan path: convert the scanner-relative capture (angle/distance
        // from THIS bot, right now) into the absolute frame the factory
        // wants. The raw readings ride along unchanged.
        const __makeContact = (scan) => {
          const b = ((bot.getOrientation() + scan.angle) * Math.PI) / 180
          return __makeContactFrom(Object.assign({}, scan, {
            x: bot.getX() + scan.distance * Math.sin(b),
            y: bot.getY() - scan.distance * Math.cos(b),
            time: clock.getTime(),
          }))
        }

        // Rehydrate a Contact from its serialized data — typically a contact
        // a teammate broadcast with bot.send (methods never survive the
        // wire; the enumerable x/y/speed/orientation/time do). Extra fields
        // (id, health, friendly, even the sender's capture-time
        // angle/distance) pass through as data, so a Contact can be relayed
        // across multiple hops losslessly. Mirrors arena.createMarker.
        arena.createContact = (data) => {
          if (data === null || typeof data !== 'object')
            throw new Error(
              'createContact expects an object with numeric x, y, speed, and orientation'
            )
          for (const k of ['x', 'y', 'speed', 'orientation'])
            if (typeof data[k] !== 'number' || !isFinite(data[k]))
              throw new Error(
                'createContact requires a finite numeric "' + k + '"'
              )
          return __makeContactFrom(Object.assign({}, data, {
            // A missing (or bad) capture tick means "as of now".
            time:
              typeof data.time === 'number' && isFinite(data.time)
                ? data.time
                : clock.getTime(),
          }))
        }

        const __rawScan = bot.radar.scan
        bot.radar.scan = () =>
          __rawScan().then((found) => found.map(__makeContact))
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
  stage?: 'compile' | 'lint' | 'load';
  errorCode?: ErrorCodes;
  message?: string;
  timedOut?: boolean;
}

// How many undeclared-variable findings to spell out in a lint failure message
// before collapsing the rest into a count.
const MAX_LINT_FINDINGS_SHOWN = 5;

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
    // Static no-undef pass (E027): bots run in strict mode, so an undeclared
    // variable throws at runtime — catch it here with a line number instead,
    // including inside handlers the load stage below never executes. Runs
    // after the compile stage so a plain syntax error keeps its E017 shape.
    const findings = lintUndeclared(source);
    if (findings.length > 0) {
      const shown = findings
        .slice(0, MAX_LINT_FINDINGS_SHOWN)
        .map(
          (f) =>
            `${f.message.replace(/\.$/, '')} (line ${f.line}, char ${f.column})`
        );
      const more = findings.length - shown.length;
      return {
        valid: false,
        stage: 'lint',
        errorCode: ErrorCodes.E027,
        message:
          shown.join('; ') + (more > 0 ? `; and ${more} more` : '') + '.',
        timedOut: false,
      };
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
