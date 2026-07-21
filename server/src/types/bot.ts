import Bullet from './bullet';
import Point from './point';
import { TimersContainer } from '../util/scheduleFactory';
import { randomUUID } from 'node:crypto';
import { Event } from './event';
import { Orientated } from './orientated';
import { BotStats } from './botStats';
import { BotTurret } from './botTurret';
import { JsonValue } from '../util/message';
import ivm from 'isolated-vm';

import compiler from '../util/compiler';
import Environment, { Process } from './environment';
import appService from '../services/AppService';
import { ErrorCodes } from './ErrorCodes';
import { normalizeAngle } from '../util/geometry';
import { sanitizeBotName } from '../util/botName';
import { isNameProfane } from '../util/nameFilter';
import { logger, LogEvent } from '../util/logger';

// Per-tick cap on how many broadcasts a single bot may issue (setInterval-style
// resource budget, mirroring the console-log budget in compiler.ts and the timer
// cap in scheduleFactory.ts). Each bot.send fans out O(bots) work — the payload
// is re-serialized and re-dispatched to every other bot in the arena — so an
// unbounded sender can saturate the tick and flood every other bot's RECEIVED
// handler. Sends past the budget are dropped (the bot keeps running; a dropped
// send is not a crash). Tunable via env so it can be tightened in prod.
export const MAX_SENDS_PER_TICK = Number(process.env.MAX_SENDS_PER_TICK) || 50;

// Per-tick cap on how many commands (movement/turret/radar) a single bot may
// issue. Each command may park a PendingCommand on the HOST heap — outside the
// isolate's 8 MB limit — so a bot synchronously issuing an unbounded chain
// (e.g. `for(;;) bot.turn(i)`) within one handler could exhaust host memory
// before the sandbox timeout fires (the documented t2.micro OOM mode). Unlike
// the send budget above (drop and keep playing), exceeding this budget FAULTS
// the bot: it is marked crashed and Simulation kills it — flooding is strictly
// self-defeating. And because the budget is per bot, a flooder can never
// consume another bot's capacity (the ranked-play fairness gap the old
// per-arena queue cap had: one bot's burst rejected its opponent's commands).
// Generous — legitimate bots issue well under ~10 commands per tick — because
// the penalty is death. Tunable via env so it can be adjusted in prod.
export const MAX_COMMANDS_PER_TICK =
  Number(process.env.MAX_COMMANDS_PER_TICK) || 100;

// The rejection every over-budget command returns; awaiting it throws E026 in
// the bot (informative in its final logs — the fault below is what kills it).
export const commandBudgetRejected = (): Promise<never> =>
  Promise.reject(
    `${ErrorCodes.E026}: command budget exceeded (${MAX_COMMANDS_PER_TICK} per tick)`
  );

// A tank's collision radius (half its width): bots contact a wall when their
// center comes within one radius of it, and another bot within two (each body
// contributes a radius). A bullet is a point, so it connects within ONE radius
// — see the swept test in simulation.ts.
// Mirrored into the sandbox as the bot.RADIUS attribute (compiler.ts).
export const BOT_RADIUS = 16;
// Degrees the body turns per tick, units/tick² toward the speed target, and
// the body's top speed. Mirrored into the sandbox as the
// bot.TURN_RATE/ACCELERATION/MAX_SPEED attributes (compiler.ts); BOT_TURN_SPEED
// also seeds the per-instance orientationVelocity runtime field below.
export const BOT_TURN_SPEED = 10;
export const BOT_ACCELERATION = 2;
export const BOT_MAX_SPEED = 5;

// Bot-vs-bot collisions no longer freeze the pair in place. On contact each bot
// is pushed apart along the line joining their centers (so a glancing hit slides
// past instead of deadlocking to death), keeping its speed and intent. Impact
// damage is applied once per contact (the tick it begins), scaled by how fast the
// two were closing: a gentle touch below COLLISION_MIN_CLOSING_SPEED does nothing,
// a hard ram costs COLLISION_DAMAGE_FACTOR per unit of closing speed.
export const COLLISION_MIN_CLOSING_SPEED = 1;
export const COLLISION_DAMAGE_FACTOR = 0.75;

// How much of a bot's velocity *into* the bot it hits is absorbed on contact, so
// collisions don't feel frictionless ("sliding around each other like ice"). The
// component of motion driving into the other bot is an inelastic normal impact; the
// tangential (sideways) component that carries a bot around its target is kept. At
// 1 a head-on ram stops dead on impact and must re-accelerate, while a glancing hit
// barely slows; 0 restores the old frictionless glide. speedTarget is untouched, so
// a bumped bot always recovers its intended speed once it works clear.
export const COLLISION_FRICTION = 1;

// Minimal structural type for the per-bot bot logger (a browser-bunyan
// instance wired up in compiler.ts). It is only ever called, so the five level
// methods are all we need — and all that scheduleFactory's Timer shares.
export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// Upper bound on a bot-chosen app name (persisted + broadcast to all clients).

// Convenience method to create a promise that resolves/rejects when specific
// conditions are met. Delegates to the environment's per-tick command registry so
// completion is driven by simulation ticks rather than a wall-clock timer — the
// same command takes the same number of ticks at any simulation speed.
export const waitUntil = (
  env: Environment,
  successCondition: () => boolean,
  failureCondition: (() => boolean) | null = null,
  msg: string | null = null
) => env.waitForCondition(successCondition, failureCondition, msg);

// Coerce a bot-supplied numeric command argument, returning null when it is not
// a finite number. Bot code is untrusted and weakly typed, so `bot.setSpeed(NaN)`,
// `bot.turn({})`, or `radar.setOrientation(Infinity)` would otherwise flow a
// non-finite value straight into the shared physics — poisoning this bot's x/y
// and potentially propagating NaN into other bots through the collision math,
// corrupting the whole arena (not a sandbox escape, but a griefing vector). We
// still coerce (so a legacy numeric string like "90" keeps working), then reject
// only the genuinely non-finite results (NaN/Infinity/objects/null). Callers
// treat null as a no-op. Mirrors the num() guard the compiler applies to
// host->isolate constants; this is its isolate->host counterpart.
export const finiteArg = (d: unknown): number | null => {
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
};

export default class Bot implements Point, Orientated {
  private context: ivm.Context | null = null;
  public turret: BotTurret;

  public orientation = 0;
  public orientationTarget = 0;
  public orientationVelocity = BOT_TURN_SPEED;

  public x: number;
  public y: number;

  public id: string = randomUUID();
  public speed = 0;
  public speedTarget = 0;
  // Dynamic event-dispatch table: populated across the isolated-vm boundary
  // (compiler.ts) and invoked positionally by Simulation, so the value type is
  // intentionally untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public handlers: any = {};
  public bullets: Bullet[] = [];
  public health = 100;
  // The clock tick at which this bot first reached 0 health (crashed, shot,
  // collided, or decayed), or null while still alive. Written once by
  // Environment.tick; never read by the physics, so it can't affect determinism.
  // A restart builds fresh Bot instances, so it resets to null automatically.
  public eliminatedAt: number | null = null;
  // The bot whose bullet last damaged this bot, or null when the most recent
  // health loss had no attributable enemy source (collision, wall, self-inflicted
  // missed shot, sudden-death decay, or a crash). Every site that lowers health
  // writes this field — the unattributed ones clear it — so the kill rule is
  // simply "the last hit was an enemy bullet", and an unattributed death credits
  // nobody by construction. Read once by applyEliminations; never read by the
  // physics, so it can't affect determinism (same contract as eliminatedAt).
  // A restart builds fresh Bot instances, so it resets automatically.
  public lastDamagedBy: Bot | null = null;
  // Ids of the other bots this bot was overlapping as of the previous tick.
  // Rebuilt every tick from the actual overlaps, it lets Simulation apply
  // collision impact damage only on the tick a contact *begins* (a rising edge)
  // rather than every tick two bots stay pressed together — so a sustained shove
  // isn't a grind. Written/read only by Simulation.run; never touched across the
  // isolate boundary, so it can't affect determinism. A restart builds fresh Bot
  // instances, so it resets automatically.
  public contacts: Set<string> = new Set();
  // Whether this bot was in contact with an arena wall as of the previous tick.
  // The wall counterpart of `contacts`: it lets Simulation fire the wall COLLIDED
  // handler and count the collision only on the tick contact *begins* (a rising
  // edge), so a bot held against a wall doesn't spam the handler every tick. Same
  // properties as `contacts` — Simulation-only, determinism-safe, reset on restart.
  public wallContact: boolean = false;
  public stats: BotStats = new BotStats();
  // Snapshot of `stats` as of the last cumulative-counter flush. Environment.flushStats
  // persists (stats - flushedStats) and then re-snapshots, which is what makes the
  // flush idempotent: calling it twice with no ticks in between computes all zeros.
  // That in turn lets it run at every point where these stats are about to be
  // destroyed (restart, dispose) without either losing a match's totals or
  // double-counting them.
  public flushedStats: BotStats = new BotStats();
  public timers: TimersContainer = new TimersContainer();
  // Per-tick send budget bookkeeping (see MAX_SENDS_PER_TICK / send below). The
  // window is the simulation tick the count belongs to; it resets whenever the
  // clock advances, so the cap is per tick rather than per match. `sendWarned`
  // limits the console warning to once per window, matching the timer-cap (E021)
  // and log-flood behaviours.
  private sendCount = 0;
  private sendWindow = -1;
  private sendWarned = false;
  // Per-tick command budget bookkeeping (see MAX_COMMANDS_PER_TICK /
  // chargeCommandBudget below). Same windowing as the send budget; the separate
  // `commandFaulted` latch keeps the fault single-shot — tripping it kills the
  // bot for the rest of the match, so the latch never needs re-arming.
  private commandCount = 0;
  private commandWindow = -1;
  private commandFaulted = false;
  public logger!: Logger;
  public process: Process;
  public env: Environment;

  public needsStarting = true;
  public appCrashed = false;
  // False until the bot's code has run and registered its handlers. Simulation
  // gates START/TICK on this so a bot added to an already-running arena (addApp
  // fires execute() without awaiting) can't be ticked in the window before its
  // START handler exists — which would clear needsStarting and let TICK run
  // first. See execute() below and Simulation.run.
  public codeLoaded = false;

  constructor(env: Environment, process: Process) {
    this.env = env;
    this.process = process;

    let overallClosestBot: number | null;
    do {
      this.x =
        BOT_RADIUS +
        (env.getArena().getWidth() - BOT_RADIUS * 2) * env.random();
      this.y =
        BOT_RADIUS +
        (env.getArena().getHeight() - BOT_RADIUS * 2) * env.random();

      // Keep iterating if we placed this bot too close to another
      overallClosestBot = env
        .getProcesses()
        .reduce((closestDistanceForApp: number | null, curProcess: Process) => {
          const closestBotForThisApp = curProcess.bots.reduce(
            (closestDistanceForBot: number | null, curBot: Bot) => {
              if (curBot.id === this.id) return closestDistanceForBot;

              const curBotDistance: number | null = Math.sqrt(
                Math.pow(curBot.x - this.x, 2) + Math.pow(curBot.y - this.y, 2)
              );
              return !closestDistanceForBot
                ? curBotDistance
                : Math.min(closestDistanceForBot, curBotDistance);
            },
            null
          );
          if (!closestDistanceForApp) return closestBotForThisApp;
          if (!closestBotForThisApp) return closestDistanceForApp;
          return Math.min(closestDistanceForApp, closestBotForThisApp);
        }, null);
    } while (overallClosestBot !== null && overallClosestBot < 50);

    this.orientation = env.random() * 360;
    this.orientationTarget = this.orientation;
    this.turret = new BotTurret(this);
  }

  getContext = (): ivm.Context => {
    if (!this.context) {
      this.context = this.process.getSandbox().createContextSync();
    }
    return this.context;
  };

  // Enables the registration of event handlers
  on(event: Event, handler: (...args: unknown[]) => unknown) {
    if (!Object.keys(Event).includes(event))
      throw new Error('Invalid event type.');

    // Keep a record of event promises, ignore repeated calls to event if previous promise
    // has not yet resolved.
    const eventPromiseMap: Map<Event, Promise<unknown>> = new Map<
      Event,
      Promise<unknown>
    >();

    // TICK is the only self-repeating event: it fires unconditionally every tick,
    // so if its handler parks on a multi-tick command we must drop the re-fire —
    // otherwise a fresh TICK would stack on the parked one every tick. Every other
    // event is a discrete notification (a received message, a hit, a collision, a
    // scan result), and each occurrence is its own thing that must be delivered.
    // Several can legitimately arrive in a single tick — e.g. four teammates all
    // broadcasting — and the old type-keyed guard dropped every one after the
    // first (its slot stays held until the async handler fully settles), so a bot
    // only ever observed one sender per round even though delivery counts were
    // high. That silent multi-party message loss was GitHub #308.
    const backpressured = event === Event.TICK;

    this.handlers[event] = (...args: unknown[]) => {
      // Backpressure (TICK only): ignore a new invocation while the previous one is
      // still in flight (a handler parked mid multi-tick await). Done without the
      // wall-clock setTimeout(0) indirection so the tick loop can await the
      // dispatch deterministically.
      if (backpressured && eventPromiseMap.get(event)) return;

      if (event !== Event.TICK) {
        if (args.length)
          this.logger.trace(
            "Called event handler '" + event + "' with ",
            args[0]
          );
        else this.logger.trace("Called event handler '" + event + "'");
      }

      // handler() bridges into the isolate (compiler.ts dispatchEvent) and returns
      // { parked, done } without running any bot code synchronously — the isolate
      // apply is async, so a bot cannot mutate state during this tick's physics.
      let dispatch:
        { parked: Promise<unknown>; done: Promise<unknown> } | undefined;
      try {
        dispatch = handler(...args) as
          { parked: Promise<unknown>; done: Promise<unknown> } | undefined;
      } catch (e) {
        this.logger.error(`${ErrorCodes.E003}: ${e}`);
        return;
      }
      if (!dispatch) return;

      const { parked, done } = dispatch;
      // For TICK, `done` resolves only when the handler fully completes (possibly
      // many ticks later); hold the slot until then so re-entry stays dropped.
      // Non-backpressured events don't occupy the slot — each occurrence dispatches
      // independently — but we still observe `done` to surface any rejection.
      if (backpressured) eventPromiseMap.set(event, done);
      done
        .then(() => {
          if (backpressured) eventPromiseMap.delete(event);
        })
        .catch((e: unknown) => {
          // An uncaught rejection from a handler's promise is NOT fatal. It is
          // almost always a command the bot didn't .catch() being superseded by a
          // later one — a documented, expected rejection (e.g. "Turn cancelled"
          // when a HIT handler retargets the body mid-turn). Surface it so the
          // author can debug, free the slot so the handler can run again, and let
          // the bot keep playing. This mirrors the synchronous handler path (E003)
          // and the fire-and-forget settle path in compiler.ts, both of which
          // log-and-continue rather than killing the bot.
          this.logger.warn(`${ErrorCodes.E019}: ${e}`);
          if (backpressured) eventPromiseMap.delete(event);
        });
      // `parked` resolves when the handler reaches its next await; the tick loop
      // awaits it (via drainBotWork) so the bot has run before the next tick.
      this.env.trackBotOp(parked);
    };
  }

  setName(name: string) {
    // Bot-controlled and persisted to the DB + broadcast to every SSE client, so
    // normalize it through the shared sanitizer (control/invisible/bidi stripped,
    // length-capped) and reject it outright if it trips the profanity filter. A
    // rejected or empty name is silently ignored — the bot keeps its current
    // name — since the sandbox has no channel to surface an error to. App.setName
    // re-checks as the authoritative gate.
    const clean = sanitizeBotName(name);
    if (clean.length === 0 || isNameProfane(clean)) return;
    // A dry-run compile (compiler.check) runs this on a throwaway, non-persisted
    // process with no backing app row — there is nothing to rename, and the lookup
    // would only reject on the sentinel appId. Skip the DB round-trip entirely.
    if (!this.process.persisted) return;
    appService
      .get(this.process.getAppId())
      .then((app) => {
        if (app && app.getName() !== clean) {
          this.env.emit('event', {
            type: 'appRenamed',
            appId: app.getId(),
            name: clean,
          });
          return app.setName(clean);
        }
      })
      // Fire-and-forget persistence: a bot renaming itself must never let a DB
      // rejection escape as an unhandledRejection (which trips the process.fatal
      // alarm). Notably, a dry-run compile (compiler.check) runs this with the
      // sentinel appId 'dry-run', so the lookup rejects with a uuid syntax error
      // every time — benign, so log at warn without an alarm `event` field.
      .catch((err) =>
        logger.warn(
          { appId: this.process.getAppId(), err },
          'bot setName persistence failed'
        )
      );
  }

  getId() {
    return this.id;
  }

  getHealth() {
    // Bot-facing health is 0–100 (matches classic Robocode's energy and reads
    // more naturally than a fraction). `health` is already stored 0–100.
    return this.health;
  }

  execute(process: Process): Promise<unknown> {
    this.logger.trace('Executing code');
    try {
      // Mark the bot loaded once its code has run (compiler.execute resolves
      // after the script runs and registers handlers, and also on a handled
      // load error). Simulation won't run START/TICK until this flips true.
      return compiler.execute(process, this).then((result) => {
        this.codeLoaded = true;
        return result;
      });
    } catch (e) {
      this.logger.error(`${ErrorCodes.E004}: ${e}`);
      this.appCrashed = true;
      // The load attempt is over (it threw synchronously); let Simulation see
      // the bot so its appCrashed path can kill it.
      this.codeLoaded = true;
      // Surface the crash on the unified fault feed (replaces the old bespoke
      // `appError` event) — buffered for MCP and broadcast as `botFault` for the UI.
      compiler.emitBotFault(this, ErrorCodes.E004, 'execute', e);
      return Promise.resolve();
    }
  }

  // Charge one command against this bot's per-tick budget. Called at the entry
  // of every command method on Bot / BotTurret / BotRadar (the latter two via
  // `this.bot`). Within budget: returns true and the command proceeds. Past it:
  // faults the bot — appCrashed (Simulation kills it), a structured per-bot
  // abuse log, and an E026 on the fault feed (recent_faults / match_summary) —
  // and returns false; the caller returns commandBudgetRejected(). The window
  // is the current sim tick; when it advances, the counter resets.
  chargeCommandBudget = (): boolean => {
    const now = this.env.getTime();
    if (now !== this.commandWindow) {
      this.commandWindow = now;
      this.commandCount = 0;
    }
    this.commandCount += 1;
    if (this.commandCount <= MAX_COMMANDS_PER_TICK) return true;
    if (!this.commandFaulted) {
      this.commandFaulted = true;
      this.appCrashed = true;
      const err = new Error(
        `${ErrorCodes.E026}: command budget exceeded (${MAX_COMMANDS_PER_TICK} per tick)`
      );
      this.logger.error(err.message);
      logger.warn(
        {
          event: LogEvent.BOT_COMMAND_FLOOD,
          appId: this.process.appId,
          botId: this.id,
          arenaId: this.env.getArena().getId?.(),
        },
        'bot exceeded its per-tick command budget; faulting the bot'
      );
      compiler.emitBotFault(this, ErrorCodes.E026, 'command-flood', err);
    }
    return false;
  };

  setOrientation(d: number) {
    if (!this.chargeCommandBudget()) return commandBudgetRejected();
    const n = finiteArg(d);
    if (n === null) {
      this.logger.trace('Ignoring non-finite setOrientation argument');
      return Promise.resolve();
    }
    const target = normalizeAngle(Math.round(n));
    if (target === this.orientationTarget) {
      return Promise.resolve();
    }

    this.orientationTarget = target;
    this.env.emit('event', {
      type: 'botTurn',
      time: this.env.getTime(),
      id: this.id,
      x: this.x,
      y: this.y,
      bodyOrientationTarget: this.orientationTarget,
      bodyOrientation: this.orientation,
      bodyOrientationVelocity: this.orientationVelocity,
    });
    this.logger.trace('Turning to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      this.env,
      () => this.orientation === target,
      () =>
        !this.env.isRunning() ||
        this.orientationTarget !== target ||
        this.health <= 0,
      'Orientation change cancelled'
    );
  }

  getOrientation() {
    // Bots see integer degrees.
    return Math.floor(normalizeAngle(this.orientation));
  }

  isTurning() {
    return this.orientation !== this.orientationTarget;
  }

  turn(d: number) {
    if (!this.chargeCommandBudget()) return commandBudgetRejected();
    const n = finiteArg(d);
    if (n === null) {
      this.logger.trace('Ignoring non-finite turn argument');
      return Promise.resolve();
    }
    const target = normalizeAngle(Math.round(this.orientation + n));
    if (target === this.orientationTarget) {
      return Promise.resolve();
    }
    this.orientationTarget = target;
    this.env.emit('event', {
      type: 'botTurn',
      time: this.env.getTime(),
      id: this.id,
      x: this.x,
      y: this.y,
      bodyOrientationTarget: this.orientationTarget,
      bodyOrientation: this.orientation,
      bodyOrientationVelocity: this.orientationVelocity,
    });
    this.logger.trace('Turning to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      this.env,
      () => this.orientation === target,
      () =>
        !this.env.isRunning() ||
        this.orientationTarget !== target ||
        this.health <= 0,
      'Turn cancelled'
    );
  }

  setSpeed(d: number) {
    if (!this.chargeCommandBudget()) return commandBudgetRejected();
    const n = finiteArg(d);
    if (n === null) {
      this.logger.trace('Ignoring non-finite setSpeed argument');
      return Promise.resolve();
    }
    // Clamp symmetrically: the physics caps actual speed at ±BOT_MAX_SPEED, so
    // an unclamped negative target (e.g. -10) would be unreachable and leave
    // the returned promise pending forever.
    const target = Math.max(-BOT_MAX_SPEED, Math.min(n, BOT_MAX_SPEED));
    if (target === this.speedTarget) {
      return Promise.resolve();
    }
    this.logger.trace(
      d === 0
        ? 'Stopping'
        : 'Accelerating to ' + target + ' from ' + this.speedTarget
    );
    this.speedTarget = target;
    this.env.emit('event', {
      type: 'botAccelerate',
      time: this.env.getTime(),
      id: this.id,
      x: this.x,
      y: this.y,
      speed: this.speed,
      speedTarget: this.speedTarget,
      speedAcceleration: BOT_ACCELERATION,
      speedMax: BOT_MAX_SPEED,
    });
    return waitUntil(
      this.env,
      () => this.speed === target,
      () =>
        !this.env.isRunning() ||
        this.speedTarget !== target ||
        this.health <= 0,
      'Speed change cancelled'
    );
  }

  getSpeed() {
    return this.speed;
  }

  getX() {
    return this.x;
  }

  getY() {
    return this.y;
  }

  send(message: JsonValue) {
    // Enforce the per-tick send budget before doing any O(bots) fan-out work.
    // The window is the current sim tick; when it advances, reset the counter.
    const now = this.env.getTime();
    if (now !== this.sendWindow) {
      this.sendWindow = now;
      this.sendCount = 0;
      this.sendWarned = false;
    }
    if (this.sendCount >= MAX_SENDS_PER_TICK) {
      // Warn the author once per window (E021-style, non-fatal) and log the
      // first drop as a structured abuse signal for ops (mirrors log-flood);
      // subsequent drops in the same window are silent.
      if (!this.sendWarned) {
        this.sendWarned = true;
        this.logger.warn(
          `${ErrorCodes.E024}: send limit reached (${MAX_SENDS_PER_TICK} per tick). ` +
            'Further bot.send calls this tick are ignored.'
        );
        logger.warn(
          {
            event: LogEvent.BOT_FAULT,
            kind: 'send-flood',
            appId: this.process.appId,
            botId: this.id,
            arenaId: this.env.getArena().getId?.(),
          },
          'bot exceeded per-tick send budget; dropping further broadcasts'
        );
      }
      return;
    }
    this.sendCount += 1;

    this.logger.trace('Sending message', message);
    this.stats.messagesSent += 1;
    this.env.getProcesses().forEach((otherProcess) => {
      otherProcess.bots
        .filter((otherBot) => otherBot.health > 0)
        .forEach((otherBot) => {
          if (otherBot.id !== this.id) {
            otherBot.stats.messagesReceived += 1;
            if (otherBot.handlers[Event.RECEIVED]) {
              // The receiver also learns how far away the sender is (a range, not
              // a bearing). Delivered to teammates AND eavesdropping enemies, so
              // broadcasting leaks your distance to everyone in the arena.
              const distance = Math.sqrt(
                Math.pow(otherBot.x - this.x, 2) +
                  Math.pow(otherBot.y - this.y, 2)
              );
              otherBot.handlers[Event.RECEIVED](message, { distance });
            }
          }
        });
    });
  }
}
