import Clock from './clock';
import { EventEmitter } from 'node:events';
import TankApp, { AppId } from './app';
import Tank from './tank';
import ivm from 'isolated-vm';
import Arena from './arena';
import compiler from '../util/compiler';

import Simulation from '../util/simulation';
import appService from '../services/AppService';
import { ErrorCodes } from './ErrorCodes';
import { logger, LogEvent } from '../util/logger';
import { mulberry32 } from '../util/random';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ArenaId = string & {};

// A structured record of a bot fault (a crash), captured for prominent surfacing.
// Unlike the raw console text in `recentLogs`, this carries the error code, the
// fault kind, and (where the isolate provided it) the failing line — so the UI can
// show a jump-to-line banner / in-arena indicator and the MCP `recent_faults` tool
// can hand an AI actionable structure instead of a log string to parse.
export interface BotFault {
  appId: string;
  tankId: string;
  tankIndex: number;
  code: string; // ErrorCodes value, e.g. "E017"
  kind: string; // where it happened: load | init | handler | timer | execute | catastrophic
  message: string;
  line?: number;
  column?: number;
  timedOut: boolean;
  time: number; // simulation tick
}

// A bot command (e.g. `await bot.setSpeed(5)`) that has not yet completed. Its
// promise resolves/rejects when the simulation reaches a state the command was
// waiting for. These are settled once per tick (see settlePendingCommands) rather
// than on a wall-clock timer, so command latency is measured in ticks — the key to
// a deterministic simulation that runs identically at any speed.
interface PendingCommand {
  success: () => boolean;
  failure: (() => boolean) | null;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  msg: string | null;
}

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
          // A fatal V8 error in the isolate — typically the 8 MB memory limit
          // being hit (runaway allocation / possible abuse). Strong signal to
          // alert on; logged once with the offending app id.
          logger.error(
            { event: LogEvent.SANDBOX_CATASTROPHIC, appId: this.appId, msg },
            'isolate catastrophic error'
          );
          this.tanks.forEach((tank) => {
            tank.appCrashed = true;
            tank.logger.error(new Error(`${ErrorCodes.E001}: ${msg}`));
            compiler.emitBotFault(
              tank,
              ErrorCodes.E001,
              'catastrophic',
              new Error(msg)
            );
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

// Tick at which "sudden death" begins: health decays until a winner remains.
// Tick-denominated (compared against clock.time, not wall time) so its real-time
// onset scales with `speed` and outcomes stay identical across speeds. Exported
// so the match-summary util reports the same threshold instead of duplicating it.
export const SUDDEN_DEATH_TIME = 10000;

export default class Environment {
  public processes: Process[] = [];
  private arena: Arena;
  private clock: Clock = { time: 0 };
  // The clock tick the current match started at. `clock.time` is monotonic across
  // restarts (restart() does not reset it), so match-relative duration is measured
  // from here, not from 0. Set to the current time by restart().
  private matchStartTick = 0;
  public stoppedAt: Date = new Date();
  private emitter: EventEmitter = new EventEmitter();
  private running = false;

  // Simulation speed. `1` = the baseline 100 ms/tick (10 ticks/s). Higher values
  // run proportionally faster; `0` means "unbounded" — run each tick as soon as the
  // previous one's bot work has settled ("as fast as possible"). In-memory only;
  // set via the API / MCP tools, never persisted. See BASE_TICK_MS / tickMs().
  private speed = 1;
  private static readonly BASE_TICK_MS = 100;
  // Set while the async tick loop (runLoop) is alive, so resume() doesn't start a
  // second concurrent loop.
  private looping = false;

  // Commands the bots are awaiting, settled deterministically each tick.
  private pendingCommands: PendingCommand[] = [];
  // In-flight isolate operations (event-handler dispatches, command settlements,
  // timer callbacks) started during the current tick. The loop awaits these before
  // advancing so every bot has run to its next await-park — this is what makes
  // acceleration deterministic instead of dropping bot decisions at speed.
  private botOps: Set<Promise<unknown>> = new Set();
  // Safety bound on the per-tick drain loop so a pathological bot that issues an
  // unbounded chain of immediately-resolving commands can't spin a tick forever.
  private static readonly MAX_DRAIN_ROUNDS = 10000;

  // Bounded history of the most recent bot console 'log' emits. The SSE /logs
  // stream is live-only (a late subscriber misses earlier output), so this lets a
  // request/response caller — notably the MCP `recent_logs` tool — read what was
  // just logged. Capped to avoid unbounded growth on a long-running arena.
  private static readonly MAX_RECENT_LOGS = 200;
  private recentLogs: unknown[] = [];

  // Bounded history of the most recent structured bot faults (crashes), the
  // counterpart to recentLogs for the MCP `recent_faults` tool and the SSE
  // `botFault` event. Smaller than the log buffer — crashes are rare and each
  // matters.
  private static readonly MAX_RECENT_FAULTS = 100;
  private recentFaults: BotFault[] = [];

  // Seeded PRNG for the arena's random setup (tank placement + starting
  // orientations). Fixing the seed makes a match reproducible; by default it is
  // seeded nondeterministically so arenas still vary. In-memory only, like speed.
  private seed: number;
  private rng: () => number;

  constructor(arena: Arena) {
    this.arena = arena;
    this.emitter = new EventEmitter();
    // Default to a nondeterministic seed so behaviour matches the previous
    // Math.random() setup until a caller pins one.
    this.seed = Math.floor(Math.random() * 0x100000000);
    this.rng = mulberry32(this.seed);
  }

  dispose = () => {
    this.processes.forEach((process) => process.dispose());
  };

  isRunning = () => this.running;
  getTime = () => this.clock.time;
  getMatchStartTick = () => this.matchStartTick;
  getProcesses = () => this.processes;
  getArena = () => this.arena;

  addListener = (
    eventName: string | symbol,
    listener: (...args: unknown[]) => void
  ) => {
    this.emitter.addListener(eventName, listener);

    if (eventName === 'event') {
      this.processes.forEach((process) => {
        appService.get(process.getAppId()).then((app) => {
          if (app) {
            listener({
              type: 'arenaPlaceApp',
              id: process.getAppId(),
              name: app.getName(),
            });
          }
        });
        process.tanks.forEach((tank) => {
          // Emit new tank event
          listener({
            type: 'arenaPlaceTank',
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
          type: 'arenaResumed',
        });
      } else {
        listener({
          type: 'arenaPaused',
        });
      }
    }
    return this;
  };

  removeListener = (
    eventName: string | symbol,
    listener: (...args: unknown[]) => void
  ) => {
    this.emitter.removeListener(eventName, listener);
    return this;
  };

  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'log') {
      this.recentLogs.push(args[0]);
      if (this.recentLogs.length > Environment.MAX_RECENT_LOGS) {
        this.recentLogs.splice(
          0,
          this.recentLogs.length - Environment.MAX_RECENT_LOGS
        );
      }
    }
    return this.emitter.emit(eventName, ...args);
  }

  // The most recent bot console logs (oldest first), up to MAX_RECENT_LOGS. Pass
  // a limit to read only the tail.
  getRecentLogs = (limit?: number): unknown[] =>
    limit ? this.recentLogs.slice(-limit) : [...this.recentLogs];

  // Record a bot fault: buffer it for later retrieval (MCP `recent_faults`) and
  // broadcast it on the SSE `event` stream as a `botFault` so the UI can surface
  // the crash prominently (banner, in-arena indicator, jump-to-line).
  reportFault = (fault: BotFault) => {
    this.recentFaults.push(fault);
    if (this.recentFaults.length > Environment.MAX_RECENT_FAULTS) {
      this.recentFaults.splice(
        0,
        this.recentFaults.length - Environment.MAX_RECENT_FAULTS
      );
    }
    this.emit('event', { type: 'botFault', ...fault });
  };

  // The most recent bot faults (oldest first), optionally limited to a bot and/or
  // capped to the tail.
  getRecentFaults = (limit?: number, appId?: string): BotFault[] => {
    const faults = appId
      ? this.recentFaults.filter((f) => f.appId === appId)
      : this.recentFaults;
    return limit ? faults.slice(-limit) : [...faults];
  };

  // --- Random seed (reproducible setup) ----------------------------------

  getSeed = () => this.seed;

  // A seeded random number in [0, 1). Used for tank placement and starting
  // orientations, so a fixed seed reproduces the match setup exactly.
  random = () => this.rng();

  // Reseed the arena's PRNG. Resets the stream, so the next restart (which
  // reconstructs all tanks) lays out an identical match for a given seed. A
  // non-finite value picks a fresh nondeterministic seed.
  setSeed(seed: number) {
    this.seed = Number.isFinite(seed)
      ? seed >>> 0
      : Math.floor(Math.random() * 0x100000000);
    this.rng = mulberry32(this.seed);
    this.emit('event', { type: 'arenaSeed', seed: this.seed });
  }

  // --- Simulation speed ---------------------------------------------------

  getSpeed = () => this.speed;

  // Target wall-clock ms between ticks. `0` (unbounded) yields 0, i.e. no pacing
  // delay — the loop advances as soon as the tick's bot work has settled. Exposed
  // so the status snapshot and connected UIs can pace playback to match.
  getTickMs = () =>
    this.speed > 0 ? Environment.BASE_TICK_MS / this.speed : 0;
  private tickMs = () => this.getTickMs();

  // Set the simulation speed multiplier. Any non-finite or non-positive value is
  // treated as `0` (unbounded / "as fast as possible"). The running loop picks up
  // the new pacing on its next iteration; connected UIs adopt it via the emitted
  // event.
  setSpeed(speed: number) {
    this.speed = Number.isFinite(speed) && speed > 0 ? speed : 0;
    this.emit('event', {
      type: 'arenaSpeed',
      speed: this.speed,
      tickMs: this.tickMs(),
    });
  }

  // --- Deterministic bot execution ---------------------------------------

  // Register an in-flight isolate operation so the tick loop's drain awaits it.
  // The wrapper swallows rejections (a settled/cancelled command surfacing as a
  // rejected apply is normal, not a crash) and self-removes when done.
  trackBotOp = (op: Promise<unknown>) => {
    const wrapped: Promise<unknown> = Promise.resolve(op)
      .catch(() => undefined)
      .finally(() => this.botOps.delete(wrapped));
    this.botOps.add(wrapped);
  };

  // Create a promise that settles when the simulation reaches the desired state.
  // Replaces the old wall-clock (setTimeout) polling: conditions are checked at
  // call time and then once per tick by settlePendingCommands, so a command's
  // completion is measured in ticks and is identical at any speed.
  waitForCondition = (
    success: () => boolean,
    failure: (() => boolean) | null,
    msg: string | null
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (success()) return resolve();
      if (failure && failure()) return reject(msg);
      this.pendingCommands.push({ success, failure, resolve, reject, msg });
    });

  // Settle every pending command whose success/failure condition now holds.
  // Returns how many settled this pass (the drain loop uses it to detect progress).
  settlePendingCommands = (): number => {
    if (this.pendingCommands.length === 0) return 0;
    const remaining: PendingCommand[] = [];
    let settled = 0;
    for (const command of this.pendingCommands) {
      if (command.success()) {
        command.resolve();
        settled += 1;
      } else if (command.failure && command.failure()) {
        command.reject(command.msg);
        settled += 1;
      } else {
        remaining.push(command);
      }
    }
    this.pendingCommands = remaining;
    return settled;
  };

  // Run all of this tick's bot work to quiescence: settle commands the tick's
  // physics satisfied (resuming parked handlers), let freshly-dispatched handlers
  // run to their next await-park, and repeat until nothing is left in flight. Each
  // isolate apply is independently bounded by SANDBOX_TIMEOUT_MS, and the round
  // count is capped, so untrusted code can never hang the loop indefinitely.
  private drainBotWork = async (): Promise<void> => {
    // A macrotask boundary. Command settlements reach the isolate through a
    // microtask hop (exposeAsync's `.then(settle)`), and isolate applies complete
    // on the thread pool; flushing to the next macrotask guarantees both have
    // registered in botOps before we judge quiescence — without it, work can leak
    // into the next tick and make the result depend on wall-clock timing.
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    for (let round = 0; round < Environment.MAX_DRAIN_ROUNDS; round++) {
      const settled = this.settlePendingCommands();
      await flush();
      let hadOps = false;
      while (this.botOps.size > 0) {
        hadOps = true;
        await Promise.all([...this.botOps]);
        await flush();
      }
      if (settled === 0 && !hadOps) return;
    }
    logger.warn(
      { arenaId: this.arena.getId() },
      'bot work drain exceeded MAX_DRAIN_ROUNDS'
    );
  };

  execute(appId: AppId): Promise<unknown> {
    return Promise.all(
      this.processes
        .filter((process) => process.getAppId() === appId)
        .map((process) =>
          Promise.all(process.tanks.map((tank) => tank.execute(process)))
        )
    );
  }

  // Reload the app's code and re-fire its START handlers — the manual "reboot"
  // the editor offers. execute() no longer re-arms START on its own (so saves
  // don't disrupt a running bot), so set needsStarting here once the freshly
  // loaded handlers are registered.
  reboot(appId: AppId): Promise<unknown> {
    return this.execute(appId).then(() => {
      this.processes
        .filter((process) => process.getAppId() === appId)
        .forEach((process) =>
          process.tanks.forEach((tank) => {
            tank.needsStarting = true;
          })
        );
    });
  }

  // Forward the simulation one clock tick, then run this tick's bot work to
  // completion. Physics is synchronous; drainBotWork awaits the (async) bot
  // handlers and command settlements so the next tick never starts until every bot
  // has run — the guarantee that makes the sim deterministic at any speed.
  private tick = async (): Promise<void> => {
    Simulation.run(this);
    this.clock.time = this.clock.time + 1;

    // Health decays after sudden death time
    if (this.clock.time > SUDDEN_DEATH_TIME && this.clock.time % 50 === 0) {
      this.processes.forEach((process) => {
        process.tanks
          .filter((tank) => tank.health > 0)
          .forEach((tank) => {
            tank.health = Math.max(0, tank.health - 1);
          });
      });
    }

    // Record the tick each tank died (crash, bullet, collision, or decay above),
    // once, so the match summary can rank apps by elimination order. Read-only for
    // the physics — this never feeds back into the simulation.
    this.processes.forEach((process) =>
      process.tanks.forEach((tank) => {
        if (tank.health <= 0 && tank.eliminatedAt === null) {
          tank.eliminatedAt = this.clock.time;
        }
      })
    );

    // Calculate application health
    const appHealth: number[] = this.processes.map(
      (process) =>
        process.tanks.reduce((sum, tank) => sum + tank.health, 0) /
        (process.tanks.length * 100)
    );

    this.emitter.emit('event', {
      type: 'tick',
      time: this.clock.time,
    });

    // Stop game if winning conditions are met
    if (appHealth.filter((item) => item > 0).length === 0) {
      logger.info({ arenaId: this.arena.getId() }, 'game over');
      this.emitter.emit('event', {
        type: 'arenaPaused',
      });
      this.running = false;
    }

    // Run the bots' reactions to this tick (handlers, timers, command
    // resumptions) to their next await-park before the next tick begins.
    await this.drainBotWork();
  };

  // The self-scheduling tick loop. Replaces the fixed setInterval so the cadence
  // can vary with `speed`: after each tick it waits only the remaining time to hit
  // the target interval (0 when unbounded), yielding to the event loop every
  // iteration so SSE and other I/O still flow even at "as fast as possible".
  private runLoop = async (): Promise<void> => {
    this.looping = true;
    try {
      while (this.running) {
        const started = Date.now();
        await this.tick();
        if (!this.running) break;
        const target = this.tickMs();
        const delay =
          target > 0 ? Math.max(0, target - (Date.now() - started)) : 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } finally {
      this.looping = false;
    }
  };

  resume() {
    logger.info({ arenaId: this.arena.getId() }, 'resuming arena');

    this.emitter.emit('event', {
      type: 'arenaResumed',
    });
    this.running = true;

    // Guard against a second concurrent loop if resume() is called while one is
    // already draining a tick.
    if (!this.looping) this.runLoop();
  }

  pause() {
    this.emitter.emit('event', {
      type: 'arenaPaused',
    });
    this.running = false;
    this.stoppedAt = new Date();
    // The loop only rejects a command's failure condition while ticking; settle
    // once here so bots awaiting a command see it cancelled (!isRunning) on pause
    // rather than hanging until the next resume.
    this.settlePendingCommands();
  }

  restart(): Promise<void> {
    this.emitter.emit('event', {
      type: 'arenaRestart',
    });

    // A new match begins now. clock.time is monotonic (not reset here), so record
    // where this match starts for match-relative duration/elimination reporting.
    this.matchStartTick = this.clock.time;

    // The isolates are about to be disposed and rebuilt, so drop any commands or
    // in-flight operations bound to the old ones rather than settling them into a
    // released context. Faults from the previous match are now stale too.
    this.pendingCommands = [];
    this.botOps.clear();
    this.recentFaults = [];

    // Restart each process
    return Promise.all(
      this.processes.map((process) => {
        process.tanks.forEach((tank) => {
          // Emit removed tank event
          this.emitter.emit('event', {
            type: 'arenaRemoveTank',
            id: tank.id,
            appId: process.getAppId(),
          });
        });

        process.dispose();

        // Restart each tank
        return appService.get(process.getAppId()).then((app) => {
          if (!app) return;

          this.emitter.emit('event', {
            type: 'arenaPlaceApp',
            id: process.getAppId(),
            name: app.getName(),
          });

          const tankCount = 5;
          return Promise.all(
            [...Array(tankCount)].map(() => {
              const tank = new Tank(this, process);
              tank.needsStarting = true;

              process.tanks.push(tank);
              compiler.init(this, process, tank);
              return tank.execute(process).then(() => {
                // Emit new tank event
                this.emitter.emit('event', {
                  type: 'arenaPlaceTank',
                  id: tank.id,
                  appId: process.getAppId(),
                  bodyOrientation: tank.orientation,
                  bodyOrientationVelocity: tank.orientationVelocity,
                  turretOrientation: tank.turret.orientation,
                  turretOrientationVelocity: tank.turret.orientationVelocity,
                  radarOrientation: tank.turret.radar.orientation,
                  radarOrientationVelocity:
                    tank.turret.radar.orientationVelocity,
                  speed: tank.speed,
                  speedMax: tank.speedMax,
                  x: tank.x,
                  y: tank.y,
                });
              });
            })
          );
        });
      })
    ).then(() => {
      return;
    });
  }

  addApp(app: TankApp) {
    const process = new Process(app.getId());
    this.processes.push(process);

    // Announce the app itself before its tanks. A live client won't have a
    // container for a newly enabled / added-by-reference app (disabled apps
    // aren't in the arena it loaded), and the arenaPlaceTank reducer drops tanks
    // whose app is unknown — so without this the tanks only appeared after a
    // restart re-broadcast the whole arena. The bootstrap replay and restart()
    // already emit this; addApp was the one path that skipped it.
    this.emitter.emit('event', {
      type: 'arenaPlaceApp',
      id: app.getId(),
      name: app.getName(),
    });

    for (let x = 0; x < 5; x++) {
      const tank = new Tank(this, process);
      process.tanks.push(tank);

      compiler.init(this, process, tank);
      tank.execute(process);

      // Emit new tank event
      this.emitter.emit('event', {
        type: 'arenaPlaceTank',
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
    this.emitter.emit('event', {
      type: 'arenaRemoveApp',
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
        this.emitter.emit('event', {
          type: 'arenaRemoveTank',
          id: tank.id,
          appId: appId,
        });
      });
    }
  }

  containsApp = (appId: AppId) =>
    this.processes.find((process) => process.getAppId() === appId);
}
