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

// A tank's collision radius (half its width): bots contact a wall when their
// center comes within one radius of it, and contact bots/bullets within two.
// Mirrored into the sandbox as the bot.radius attribute (compiler.ts).
export const BOT_RADIUS = 16;

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

export default class Bot implements Point, Orientated {
  private context: ivm.Context | null = null;
  public turret: BotTurret;

  public orientation = 0;
  public orientationTarget = 0;
  public orientationVelocity = 10;

  public x: number;
  public y: number;

  public id: string = randomUUID();
  public speed = 0;
  public speedTarget = 0;
  public speedAcceleration = 2;
  public speedMax = 5;
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

    this.handlers[event] = (...args: unknown[]) => {
      // Backpressure: ignore a new invocation while the previous one is still in
      // flight (a handler parked mid multi-tick await). Same semantics as before,
      // now without the wall-clock setTimeout(0) indirection so the tick loop can
      // await the dispatch deterministically.
      if (eventPromiseMap.get(event)) return;

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
      // `done` resolves only when the handler fully completes (possibly many ticks
      // later); hold the slot until then so re-entry stays dropped.
      eventPromiseMap.set(event, done);
      done
        .then(() => eventPromiseMap.delete(event))
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
          eventPromiseMap.delete(event);
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

  setOrientation(d: number) {
    const target = normalizeAngle(Math.round(d));
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
    const target = normalizeAngle(Math.round(this.orientation + d));
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
    // Clamp symmetrically: the physics caps actual speed at ±speedMax, so an
    // unclamped negative target (e.g. -10) would be unreachable and leave the
    // returned promise pending forever.
    const target = Math.max(-this.speedMax, Math.min(d, this.speedMax));
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
      speedAcceleration: this.speedAcceleration,
      speedMax: this.speedMax,
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
