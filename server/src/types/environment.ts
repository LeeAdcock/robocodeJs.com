import Clock from './clock';
import { EventEmitter } from 'node:events';
import App, { AppId } from './app';
import Bot, { BOT_MAX_SPEED } from './bot';
import ivm from 'isolated-vm';
import Arena from './arena';
import compiler from '../util/compiler';

import Simulation, { applyEliminations } from '../util/simulation';
import appService from '../services/AppService';
import { ErrorCodes } from './ErrorCodes';
import { logger, LogEvent } from '../util/logger';
import { mulberry32 } from '../util/random';
import { computeSpawns } from '../util/placement';
import { BotStats, STAT_KEYS } from './botStats';

export type ArenaId = string & {};

// A structured record of a bot fault (a crash), captured for prominent surfacing.
// Unlike the raw console text in `recentLogs`, this carries the error code, the
// fault kind, and (where the isolate provided it) the failing line — so the UI can
// show a jump-to-line banner / in-arena indicator and the MCP `recent_faults` tool
// can hand an AI actionable structure instead of a log string to parse.
export interface BotFault {
  appId: string;
  botId: string;
  botIndex: number;
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
  // The bot that issued the command, so a bot shed from the roster
  // (setBotCount decrease) can have its parked commands dropped rather than
  // left to settle into its released isolate context. Null when the command
  // has no single owning bot.
  owner: Bot | null;
}

export class Process {
  public appId: AppId;
  public bots: Bot[] = [];

  // Bots shed from the roster by a bots-per-app decrease (setBotCount) whose
  // fired bullets are still in flight. The engine's invariant is that a fired
  // bullet keeps flying, can still land, and still credits its shooter's kill —
  // dead bots stay in `bots` for exactly this reason — so a shed bot with live
  // bullets parks here instead of vanishing. Simulation keeps moving these
  // bullets (and only the bullets: no handlers, timers, physics, or status for
  // a retired bot) and drops each bot once its last bullet resolves. The bot's
  // isolate context is already released when it arrives here.
  public retiredBots: Bot[] = [];

  // Whether this process has a backing `app` row in the database. True for every
  // real arena/ladder process (its appId is a real uuid). False only for the
  // throwaway process a dry-run compile uses (compiler.check): its appId is a
  // sentinel string, so any DB lookup keyed off it would reject with a uuid
  // syntax error. Code that persists via getAppId() (e.g. Bot.setName) checks
  // this and skips the query for a non-persisted process.
  public readonly persisted: boolean;

  private sandbox: ivm.Isolate | null = null;

  constructor(appId: AppId, persisted = true) {
    this.appId = appId;
    this.persisted = persisted;
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
          this.bots.forEach((bot) => {
            bot.appCrashed = true;
            bot.logger.error(new Error(`${ErrorCodes.E001}: ${msg}`));
            compiler.emitBotFault(
              bot,
              ErrorCodes.E001,
              'catastrophic',
              new Error(msg)
            );
          });
          this.disposeSandbox();
        },
      });
    }
    return this.sandbox;
  };

  // Dispose the isolate at most once. isolated-vm throws "Isolate is already
  // disposed" if `dispose()` is called on an already-disposed isolate, which
  // previously escaped as an uncaughtException and crashed the process (the
  // 30-minute GC could race the onCatastrophicError handler). Guard on
  // `isDisposed` and never let cleanup throw.
  private disposeSandbox() {
    try {
      if (this.sandbox && !this.sandbox.isDisposed) this.sandbox.dispose();
    } catch (err) {
      logger.warn(
        { event: LogEvent.SANDBOX_CATASTROPHIC, appId: this.appId, err },
        'isolate dispose skipped (already disposed)'
      );
    }
    this.sandbox = null;
  }

  dispose() {
    this.bots.forEach((bot) => bot.getContext().release());
    this.bots = [];
    // Retired bots' contexts were released when they were shed; their bullets
    // die with the process.
    this.retiredBots = [];
    this.disposeSandbox();
  }
}

// Tick at which "sudden death" begins: health decays until a winner remains.
// Tick-denominated (compared against clock.time, not wall time) so its real-time
// onset scales with `speed` and outcomes stay identical across speeds. Exported
// so the match-summary util reports the same threshold instead of duplicating it.
export const SUDDEN_DEATH_TIME = 7500;

// Ticks of damage-free "deployment" at the start of a match: bullets deal no
// damage (bots still move, scan, aim, and fire) so teams can settle off their
// spawn before combat — removing the last of the start-position luck. ~10s at 1x.
export const DEPLOY_TICKS = 100;

export default class Environment {
  public processes: Process[] = [];
  private arena: Arena;
  private clock: Clock = { time: 0 };
  public stoppedAt: Date = new Date();
  private emitter: EventEmitter = new EventEmitter();
  private running = false;

  // Set while a driven match (runMatchToDecision) is claiming this live arena, so
  // a second concurrent driver refuses instead of corrupting the in-flight match.
  // See beginMatch()/endMatch() below.
  private matchInFlight = false;

  // Simulation speed. `1` = the baseline 100 ms/tick (10 ticks/s). Higher values
  // run proportionally faster; `0` means "unbounded" — run each tick as soon as the
  // previous one's bot work has settled ("as fast as possible"). In-memory only;
  // set via the API / MCP tools, never persisted. See BASE_TICK_MS / tickMs().
  private speed = 1;
  private static readonly BASE_TICK_MS = 100;

  // How many bots each app fields (1–5). In-memory only, like speed — set via
  // the API / MCP tools, never persisted, so a rebuilt Environment starts back
  // at the default. Applied live by setBotCount() and used by restart()/addApp()
  // when (re)building teams. The ceiling of 5 is the existing resource envelope
  // (all of an app's bots share its one 8 MB isolate).
  private botCount = Environment.DEFAULT_BOT_COUNT;
  public static readonly DEFAULT_BOT_COUNT = 5;
  public static readonly MAX_BOT_COUNT = 5;
  // Set while the async tick loop (runLoop) is alive, so resume() doesn't start a
  // second concurrent loop.
  private looping = false;

  // Exponential moving average of per-tick wall-clock duration (ms), maintained
  // in runLoop from the elapsed time it already measures for pacing. A cheap O(1)
  // health gauge (read by /health via EnvironmentService.metrics) — a rising value
  // flags an overloaded arena. 0 until the first tick completes.
  private avgTickMs = 0;

  // Where this arena's cumulative bot stats go when they're flushed, or null to
  // discard them. Null by DEFAULT, and that default is load-bearing: only
  // EnvironmentService.get installs a sink, and it is the sole place a real
  // arena's Environment is constructed. LadderService builds its ephemeral
  // Environment directly (`new Environment(arena)`), so it never gets a sink and
  // every flush below is a silent no-op there — the ladder hook owns ranked
  // counters exclusively, and its dispose() cannot double-count them. That's a
  // structural guarantee rather than an owner check somebody has to remember.
  //
  // Keeping it an injected callback also means Environment never imports the
  // achievement layer: no import cycle, and the existing env tests keep running
  // with no database mock.
  private statsSink:
    ((deltas: Partial<Record<keyof BotStats, number>>) => void) | null = null;

  // Commands the bots are awaiting, settled deterministically each tick. Each
  // entry lives on the HOST heap (outside the isolates' 8 MB limits), but growth
  // is bounded structurally: every command is charged against its issuing bot's
  // per-tick budget (MAX_COMMANDS_PER_TICK, bot.ts) and exceeding it faults the
  // bot, so the queue can never exceed ~budget × live bots.
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
  // request/response caller — notably the MCP `recent_logs` tool — read and search
  // what was just logged. Capped to avoid unbounded growth on a long-running
  // arena; deeper buffer = more searchable history but more per-arena memory
  // (~200 B typical, ~2.3 KB worst case per entry). Env-tunable (MAX_RECENT_LOGS)
  // like the other host-footprint caps so prod can dial it without a redeploy.
  private static readonly MAX_RECENT_LOGS =
    Number(process.env.MAX_RECENT_LOGS) || 1500;
  private recentLogs: unknown[] = [];

  // Bounded history of the most recent structured bot faults (crashes), the
  // counterpart to recentLogs for the MCP `recent_faults` tool and the SSE
  // `botFault` event. Smaller than the log buffer — crashes are rare and each
  // matters.
  private static readonly MAX_RECENT_FAULTS = 100;
  private recentFaults: BotFault[] = [];

  // Seeded PRNG for the arena's random setup (bot placement + starting
  // orientations). Fixing the seed makes a match reproducible; by default it is
  // seeded nondeterministically so arenas still vary. In-memory only, like speed.
  private seed: number;
  private rng: () => number;
  // Whether the seed was explicitly pinned by a caller (setSeed with a finite
  // value) vs. the default nondeterministic seed. restart() branches on this: a
  // pinned seed rewinds the stream so every restart reproduces the identical
  // match, while an unpinned arena mints a fresh seed per restart so it keeps
  // varying (and emits it, so the match that just ran is still reproducible after
  // the fact by pinning that seed).
  private seedPinned = false;

  constructor(arena: Arena) {
    this.arena = arena;
    this.emitter = new EventEmitter();
    // Default to a nondeterministic seed so behaviour matches the previous
    // Math.random() setup until a caller pins one.
    this.seed = Math.floor(Math.random() * 0x100000000);
    this.rng = mulberry32(this.seed);
  }

  setStatsSink = (
    sink: ((deltas: Partial<Record<keyof BotStats, number>>) => void) | null
  ) => {
    this.statsSink = sink;
  };

  // Hand this arena's accumulated bot stats to the sink as a DELTA since the last
  // flush, then re-snapshot.
  //
  // Delta-based rather than absolute because bot stats live only in memory and are
  // destroyed by restart() (which disposes and rebuilds every Bot), while the only
  // sandbox game-over fires when EVERY app is dead — so no single moment sees a
  // match's final totals reliably. Flushing at every point where the stats are about
  // to die would double-count if it were absolute; because it's a delta with a
  // re-snapshot, a second call with no ticks in between emits nothing, so it is safe
  // to call from all of them.
  //
  // `> 0` (not `!== 0`) because the counters are monotonic — it also makes a negative
  // bump impossible if a bot is ever rebuilt underneath a stale snapshot.
  private flushStats = (): void => {
    if (!this.statsSink) return;
    const deltas: Partial<Record<keyof BotStats, number>> = {};
    let any = false;
    for (const process of this.processes) {
      // Retired bots (shed with bullets still in flight) can still accrue stats
      // — a landing bullet records shotsHit/damageDealt/kills on its shooter —
      // so their deltas are banked too until Simulation drops them. (`?? []`
      // keeps mock-process tests working; real Processes carry the array.)
      for (const bot of [...process.bots, ...(process.retiredBots ?? [])]) {
        for (const key of STAT_KEYS) {
          const delta = bot.stats[key] - bot.flushedStats[key];
          if (delta > 0) {
            deltas[key] = (deltas[key] ?? 0) + delta;
            any = true;
          }
          bot.flushedStats[key] = bot.stats[key];
        }
      }
    }
    if (any) this.statsSink(deltas);
  };

  dispose = () => {
    // Last chance: this runs on the 30-minute idle GC, on arena delete, and on
    // shutdown, and the bots (with their stats) are gone immediately after.
    this.flushStats();
    this.processes.forEach((process) => process.dispose());
  };

  // --- Single-match driver guard ------------------------------------------
  // runMatchToDecision (util/runMatch.ts, behind the MCP run_match tool) drives a
  // match by mutating this live arena — setSeed / restart / resume / pause. Two
  // such drivers on the same Environment at once stomp each other's restart and
  // speed state, producing corrupt near-instant "matches" (observed when a slow
  // run_match timed out client-side and the client retried while the first was
  // still running). The matchInFlight flag serializes them: beginMatch()
  // atomically claims the arena and endMatch() releases it. The check-and-set is
  // synchronous, so it is race-free on the single-threaded event loop. Ephemeral
  // ladder environments are single-use, so they never contend.

  // Try to claim this arena for a driven match. Returns false if one is already
  // running (the caller should refuse rather than corrupt the in-flight match).
  beginMatch = (): boolean => {
    if (this.matchInFlight) return false;
    this.matchInFlight = true;
    return true;
  };

  // Release the claim taken by beginMatch(). Safe to call unconditionally.
  endMatch = () => {
    this.matchInFlight = false;
  };

  isRunning = () => this.running;
  // True while the async tick loop is still alive. pause() only flips `running`
  // off; the loop finishes its in-flight tick (bot handlers on the isolate
  // thread pool) before exiting and clearing this. A caller that disposes the
  // isolates right after pausing (e.g. the ephemeral ladder match) must wait for
  // this to go false first, or dispose() races an in-flight apply → an "Isolate
  // was disposed during execution" bot.fault.
  isLooping = () => this.looping;
  getTime = () => this.clock.time;
  getProcesses = () => this.processes;
  getAvgTickMs = () => this.avgTickMs;
  getArena = () => this.arena;

  addListener = (
    eventName: string | symbol,
    listener: (...args: unknown[]) => void
  ) => {
    this.emitter.addListener(eventName, listener);

    if (eventName === 'event') {
      this.processes.forEach((process) => {
        appService
          .get(process.getAppId())
          .then((app) => {
            if (!app) return;
            // Emit the app placement BEFORE its bots. The client reducer attaches
            // each arenaPlaceBot to an already-placed app, so a bot arriving first
            // would be dropped — the bootstrap/reconnect race that left bots
            // missing until a restart. Emitting bots inside this `.then` (after the
            // app) guarantees the order, matching restart()'s app-then-bots path.
            listener({
              type: 'arenaPlaceApp',
              id: process.getAppId(),
              name: app.getName(),
            });
            process.bots.forEach((bot) => {
              listener({
                type: 'arenaPlaceBot',
                id: bot.id,
                appId: process.getAppId(),
                bodyOrientation: bot.orientation,
                bodyOrientationVelocity: bot.orientationVelocity,
                turretOrientation: bot.turret.orientation,
                turretOrientationVelocity: bot.turret.orientationVelocity,
                radarOrientation: bot.turret.radar.orientation,
                radarOrientationVelocity: bot.turret.radar.orientationVelocity,
                speed: bot.speed,
                speedMax: BOT_MAX_SPEED,
                x: bot.x,
                y: bot.y,
              });
            });
          })
          // Fire-and-forget bootstrap replay: addListener returns synchronously,
          // so a DB rejection here would escape as an unhandledRejection (tripping
          // the process.fatal alarm) rather than surfacing to a caller.
          .catch((err) =>
            logger.warn(
              { appId: process.getAppId(), err },
              'arena bootstrap replay failed'
            )
          );
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

  // A seeded random number in [0, 1). Used for bot placement and starting
  // orientations, so a fixed seed reproduces the match setup exactly.
  random = () => this.rng();

  // Reseed the arena's PRNG. Resets the stream, so the next restart (which
  // reconstructs all bots) lays out an identical match for a given seed. A finite
  // value pins the seed (restart will rewind to it and reproduce); a non-finite
  // value picks a fresh nondeterministic seed and leaves the arena unpinned.
  setSeed(seed: number) {
    this.seedPinned = Number.isFinite(seed);
    this.seed = this.seedPinned
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

  // --- Bots per app -------------------------------------------------------

  getBotCount = () => this.botCount;

  // Set how many bots each app fields (clamped to 1–MAX_BOT_COUNT). Applied
  // live: every process immediately spawns its shortfall (new bots load the
  // app's code and fire START like any other late join) or sheds its excess —
  // removed outright, with no death or elimination recorded. The setting also
  // drives restart() and addApp(), so future matches and newly added apps
  // field the same quantity.
  setBotCount(count: number): Promise<unknown> {
    const next = Math.min(
      Environment.MAX_BOT_COUNT,
      Math.max(1, Math.floor(count))
    );
    // Idempotent: re-selecting the current quantity does no work — no
    // arenaBotCount broadcast to every SSE client, no roster walk.
    if (next === this.botCount) return Promise.resolve();
    this.botCount = next;
    this.emit('event', { type: 'arenaBotCount', botCount: this.botCount });

    return this.applyBotCount();
  }

  // Bring every process's roster to the configured size: shed the excess or
  // spawn the shortfall.
  private applyBotCount(): Promise<unknown> {
    // Bank cumulative stats before any bots vanish (same reasoning as
    // removeApp: settling every app's deltas early is harmless).
    if (this.processes.some((p) => p.bots.length > this.botCount)) {
      this.flushStats();
    }

    return Promise.all(
      this.processes.map((process) => {
        const excess = process.bots.length - this.botCount;
        if (excess > 0) {
          // Shed dead bots first — removing a corpse can't change the fight —
          // and living bots only when there aren't enough dead ones, newest
          // first within each group. Shedding purely by array position could
          // splice an app's only living bots while keeping its corpses,
          // silently knocking the app out of the match (and ending the match
          // on the next tick's app-health check if it was the last app with
          // living bots).
          const dead = process.bots.filter((bot) => bot.health <= 0);
          const alive = process.bots.filter((bot) => bot.health > 0);
          [...dead.reverse(), ...alive.reverse()]
            .slice(0, excess)
            .forEach((bot) => this.shedBot(process, bot));
        }
        const spawns: Promise<unknown>[] = [];
        while (process.bots.length < this.botCount) {
          spawns.push(this.spawnBot(process));
        }
        return Promise.all(spawns);
      })
    );
  }

  // Remove one bot from a live roster (setBotCount decrease), with the same
  // teardown discipline restart() applies before releasing isolate contexts —
  // minus anything that would read as a death (no damage, no elimination):
  // - its parked commands are dropped, NOT settled — settling would apply the
  //   __settle reference into the released context — so no parked handler
  //   continuation can resume and keep running (or streaming console output to
  //   the SSE /logs feed) for a bot that has left the arena;
  // - its handler table and timers are cleared, so no host path can dispatch
  //   into it again;
  // - its already-fired bullets keep flying (see Process.retiredBots): if any
  //   are in flight the bot is parked there for Simulation to finish them. The
  //   bullets' fire() callbacks are cleared for the same reason the commands
  //   are dropped — the promise awaiting them lives in the released context.
  private shedBot(process: Process, bot: Bot) {
    const index = process.bots.indexOf(bot);
    if (index < 0) return;
    process.bots.splice(index, 1);

    this.pendingCommands = this.pendingCommands.filter(
      (command) => command.owner !== bot
    );
    bot.handlers = {};
    bot.timers.reset();
    bot.bullets.forEach((bullet) => {
      bullet.callback = undefined;
    });

    const retiring = bot.bullets.some((bullet) => !bullet.exploded);
    this.emitter.emit('event', {
      type: 'arenaRemoveBot',
      id: bot.id,
      appId: process.getAppId(),
      // Tells clients this bot's in-flight bullets remain live — the client
      // keeps them animating until each one's bulletExploded/bulletRemoved
      // arrives, instead of dropping them with the bot.
      retired: retiring,
    });
    // Release the bot's isolate context (the process-shared isolate stays
    // alive for its remaining siblings).
    bot.getContext().release();
    if (retiring) process.retiredBots.push(bot);
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
    msg: string | null,
    owner: Bot | null = null
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (success()) return resolve();
      if (failure && failure()) return reject(msg);
      this.pendingCommands.push({
        success,
        failure,
        resolve,
        reject,
        msg,
        owner,
      });
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
    // Env-tunable (default MAX_DRAIN_ROUNDS) so tests can force the exhaustion
    // path; 0 makes drain a no-op that reports immediately (so `|| default`
    // would be wrong — 0 is falsy — hence the explicit finite check).
    const parsed = Number(process.env.MAX_DRAIN_ROUNDS);
    const maxRounds = Number.isFinite(parsed)
      ? parsed
      : Environment.MAX_DRAIN_ROUNDS;
    for (let round = 0; round < maxRounds; round++) {
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
    // Hitting the bound means a bot kept the tick busy for the whole budget —
    // a runaway/abuse signal. Carry a stable `event` (like every other alertable
    // condition) so a log-metric alarm can fire; without it this was invisible.
    logger.warn(
      {
        event: LogEvent.BOT_DRAIN_EXHAUSTED,
        arenaId: this.arena.getId(),
        rounds: maxRounds,
      },
      'bot work drain exceeded MAX_DRAIN_ROUNDS'
    );
  };

  execute(appId: AppId): Promise<unknown> {
    return Promise.all(
      this.processes
        .filter((process) => process.getAppId() === appId)
        .map((process) =>
          Promise.all(process.bots.map((bot) => bot.execute(process)))
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
          process.bots.forEach((bot) => {
            bot.needsStarting = true;
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
        process.bots
          .filter((bot) => bot.health > 0)
          .forEach((bot) => {
            bot.stats.damageTaken += Math.min(1, bot.health);
            bot.health = Math.max(0, bot.health - 1);
            // Decay is the arena killing everyone, not an opponent — so a bot
            // that is ground down to zero here dies unattributed. The filter
            // above means only living bots reach this, so a bot already shot
            // dead this tick keeps its attribution.
            bot.lastDamagedBy = null;
          });
      });
    }

    // Record eliminations and credit kills, once per bot. Runs after decay so it
    // sees each bot's final health and attribution for the tick.
    applyEliminations(this.processes, this.clock.time);

    // Calculate application health
    const appHealth: number[] = this.processes.map(
      (process) =>
        process.bots.reduce((sum, bot) => sum + bot.health, 0) /
        (process.bots.length * 100)
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
      // The one moment a sandbox match actually ends, so bank its totals now
      // rather than waiting for a restart or the idle GC.
      this.flushStats();
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
        const elapsed = Date.now() - started;
        // EMA (alpha 0.2) so a single slow tick doesn't dominate the gauge.
        this.avgTickMs =
          this.avgTickMs === 0 ? elapsed : this.avgTickMs * 0.8 + elapsed * 0.2;
        if (!this.running) break;
        const target = this.tickMs();
        const delay = target > 0 ? Math.max(0, target - elapsed) : 0;
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

  // Advance exactly one simulation tick while paused — the debug "step" control.
  // Refuses if the arena is running or a tick is still in flight (the loop owns
  // ticking then, and two overlapping ticks would corrupt state). `running` is
  // held true for just this one tick so a bot's awaited command isn't cancelled
  // by its own `!isRunning()` failure guard mid-step; the arena is left paused
  // afterward (no arenaResumed is emitted, so clients stay paused, and the tick
  // event advances their clock by one). Returns whether a tick actually ran.
  step = async (): Promise<boolean> => {
    if (this.running || this.looping) return false;
    this.looping = true;
    this.running = true;
    try {
      await this.tick();
    } finally {
      this.running = false;
      this.looping = false;
    }
    return true;
  };

  async restart(): Promise<void> {
    this.emitter.emit('event', {
      type: 'arenaRestart',
    });

    // Stop the tick loop and let the in-flight tick fully drain before rebuilding
    // the bots. restart() disposes and reloads each bot's isolate asynchronously
    // (compiler.execute → script.run on the isolate thread pool), and every bot's
    // code loads at an independent time. If the loop kept ticking during that
    // reload it would advance clock.time while those loads resolve, so bots would
    // fire START one at a time on different, nonzero ticks instead of all together
    // at 0 — the reported inconsistency when restarting a *running* arena (a
    // restart on a paused arena froze the clock at 0 and looked fine, hence
    // "sometimes 0, sometimes not"). Freezing the clock here makes every restart
    // lay out and start identically. restart() leaves the arena paused; callers
    // resume() (see api/arena.ts, mcp restart_arena, util/runMatch).
    this.running = false;
    // Wait for the current tick's drainBotWork to finish so no tick mutates
    // clock.time after we reset it below. Bounded (like LadderService.waitForLoopExit)
    // so a wedged loop can't hang a restart; each tick is itself bounded by the
    // sandbox timeout.
    for (let i = 0; i < 250 && this.looping; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Bank the finished match's stats before the rebuild below disposes every
    // Process and takes its bots (and their counters) with it. Must be after the
    // drain wait above, so a final in-flight tick is included, and it costs nothing
    // if game-over already flushed — that's the idempotence earning its keep.
    this.flushStats();

    // A new match begins now: reset the tick clock to 0. Otherwise it would run
    // monotonically across restarts, so a second match in an arena whose first
    // match passed the sudden-death tick (SUDDEN_DEATH_TIME) would start already
    // in permanent health decay. It also keeps match time (and the summary's
    // duration/elimination ticks) match-relative and bot-facing clock.getTime()
    // starting from 0.
    this.clock.time = 0;

    // The isolates are about to be disposed and rebuilt, so drop any commands or
    // in-flight operations bound to the old ones rather than settling them into a
    // released context. recentFaults (like recentLogs) deliberately survives the
    // restart: a fault from the match that just ended is exactly what a caller —
    // notably the MCP recent_faults tool after run_match — still needs to read,
    // and the bounded buffer handles growth. Note the tick clock resets below, so
    // a fault's `time` is relative to the match it occurred in.
    this.pendingCommands = [];
    this.botOps.clear();

    // Rewind the PRNG so each match's setup is drawn from a known stream position
    // rather than wherever the previous match happened to leave it — otherwise the
    // stream advances every restart and consecutive matches diverge even though
    // getSeed() is unchanged. A pinned seed rewinds to that exact seed so every
    // restart reproduces identically; an unpinned arena mints a fresh seed (and
    // emits it) so it keeps varying while staying reproducible after the fact.
    // (reboot_app also draws from this stream mid-match, so a truly reproducible
    // pinned run is restart-only.)
    if (this.seedPinned) {
      this.rng = mulberry32(this.seed);
    } else {
      this.setSeed(NaN);
    }

    // Compute a fair, symmetric spawn layout up front (util/placement.ts) so every
    // team gets an equivalent start — same distance to center, walls, and nearest
    // enemy — instead of the old uniform-random per-bot placement. Driven by the
    // seeded rng, so a fixed seed still reproduces the layout.
    const spawns = computeSpawns(
      this.processes.length,
      this.botCount,
      this.arena.getWidth(),
      this.arena.getHeight(),
      this.random
    );

    // Restart each process
    return Promise.all(
      this.processes.map((process, teamIndex) => {
        process.bots.forEach((bot) => {
          // Emit removed bot event
          this.emitter.emit('event', {
            type: 'arenaRemoveBot',
            id: bot.id,
            appId: process.getAppId(),
          });
        });

        process.dispose();

        // Restart each bot
        return appService.get(process.getAppId()).then((app) => {
          if (!app) return;

          this.emitter.emit('event', {
            type: 'arenaPlaceApp',
            id: process.getAppId(),
            name: app.getName(),
          });

          const botCount = this.botCount;
          return Promise.all(
            [...Array(botCount)].map((_unused, slot) => {
              const bot = new Bot(this, process);
              bot.needsStarting = true;

              // Overwrite the constructor's random placement with this bot's
              // fair, symmetric spawn. Falls back to the random placement if no
              // layout slot exists (defensive — e.g. an unusual team count).
              const spawn = spawns[teamIndex]?.[slot];
              if (spawn) {
                bot.x = spawn.x;
                bot.y = spawn.y;
                bot.orientation = spawn.orientation;
                bot.orientationTarget = spawn.orientation;
              }

              process.bots.push(bot);
              compiler.init(this, process, bot);
              return bot.execute(process).then(() => {
                // Emit new bot event
                this.emitter.emit('event', {
                  type: 'arenaPlaceBot',
                  id: bot.id,
                  appId: process.getAppId(),
                  bodyOrientation: bot.orientation,
                  bodyOrientationVelocity: bot.orientationVelocity,
                  turretOrientation: bot.turret.orientation,
                  turretOrientationVelocity: bot.turret.orientationVelocity,
                  radarOrientation: bot.turret.radar.orientation,
                  radarOrientationVelocity:
                    bot.turret.radar.orientationVelocity,
                  speed: bot.speed,
                  speedMax: BOT_MAX_SPEED,
                  x: bot.x,
                  y: bot.y,
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

  addApp(app: App) {
    const process = new Process(app.getId());
    this.processes.push(process);

    // Announce the app itself before its bots. A live client won't have a
    // container for a newly enabled / added-by-reference app (disabled apps
    // aren't in the arena it loaded), and the arenaPlaceBot reducer drops bots
    // whose app is unknown — so without this the bots only appeared after a
    // restart re-broadcast the whole arena. The bootstrap replay and restart()
    // already emit this; addApp was the one path that skipped it.
    this.emitter.emit('event', {
      type: 'arenaPlaceApp',
      id: app.getId(),
      name: app.getName(),
    });

    for (let x = 0; x < this.botCount; x++) {
      this.spawnBot(process);
    }
  }

  // Place one new bot on a process's team mid-match: create it (the constructor
  // picks a clear random spot), wire the sandbox API, run the app's code in it,
  // and announce it to connected clients. Shared by addApp() and setBotCount();
  // restart() has its own placement path (fair symmetric spawn layout).
  private spawnBot(process: Process): Promise<unknown> {
    const bot = new Bot(this, process);
    process.bots.push(bot);

    compiler.init(this, process, bot);
    const executed = bot.execute(process);

    // Emit new bot event
    this.emitter.emit('event', {
      type: 'arenaPlaceBot',
      id: bot.id,
      appId: process.getAppId(),
      bodyOrientation: bot.orientation,
      bodyOrientationVelocity: bot.orientationVelocity,
      turretOrientation: bot.turret.orientation,
      turretOrientationVelocity: bot.turret.orientationVelocity,
      radarOrientation: bot.turret.radar.orientation,
      radarOrientationVelocity: bot.turret.radar.orientationVelocity,
      speed: bot.speed,
      speedMax: BOT_MAX_SPEED,
      x: bot.x,
      y: bot.y,
    });
    return executed;
  }

  removeApp(appId: AppId) {
    // Bank everything before the Process is spliced out and disposed below.
    // Flushing the whole arena (not just this app) is fine and simpler: the other
    // apps just settle their deltas early, which is harmless for a cumulative
    // counter and leaves their snapshots consistent.
    this.flushStats();

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

      process.bots.forEach((bot) => {
        // Emit removed bot event
        this.emitter.emit('event', {
          type: 'arenaRemoveBot',
          id: bot.id,
          appId: appId,
        });
      });
    }
  }

  containsApp = (appId: AppId) =>
    this.processes.find((process) => process.getAppId() === appId);
}
