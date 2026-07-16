// Shared test harness: a faithful in-memory stand-in for the parts of
// Environment that Simulation, timers, and Bot read — including the deterministic
// per-tick command registry and bot-op tracking that the real tick loop drives.
//
// It mirrors Environment.waitForCondition / settlePendingCommands / trackBotOp /
// drainBotWork so tests can drive real isolate-backed bots through the same
// tick-driven (not wall-clock) execution model the production loop uses, without
// standing up an Arena or Postgres. Used by the sandbox+simulation integration
// tests, the sample-bot smoke tests, and the speed/determinism tests.

import { Process } from '../src/types/environment';
import { mulberry32 } from '../src/util/random';

interface PendingCommand {
  success: () => boolean;
  failure: (() => boolean) | null;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  msg: string | null;
}

export interface SimEnv {
  env: any;
  processes: Process[];
  events: { name: string; payload: unknown }[];
  faults: Record<string, unknown>[];
  getClock: () => number;
  // Jump the clock to a specific tick (e.g. past the damage-free deployment
  // window) so a test can exercise live-combat behavior without ticking there.
  setClock: (t: number) => void;
  // Advance the simulation one or more ticks: run physics, bump the clock, then
  // drain this tick's bot work to quiescence — exactly what Environment.tick does.
  tick: (n?: number) => Promise<void>;
  // Just the drain phase, exposed for tests that run physics themselves.
  drainBotWork: () => Promise<void>;
}

export function makeSimEnv(
  opts: {
    width?: number;
    height?: number;
    isRunning?: () => boolean;
    // Fixed PRNG seed for reproducible bot placement/orientation. Omit for
    // Math.random() (nondeterministic, like an unseeded Environment).
    seed?: number;
    // Run physics for one tick; injected so this helper needn't import Simulation
    // (keeps it usable by tests that drive Simulation directly).
    run: (env: any) => void;
  } = { run: () => undefined }
): SimEnv {
  const processes: Process[] = [];
  let clock = 0;
  const rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;
  const events: { name: string; payload: unknown }[] = [];
  const faults: Record<string, unknown>[] = [];
  const pendingCommands: PendingCommand[] = [];
  const botOps = new Set<Promise<unknown>>();

  const settlePendingCommands = (): number => {
    if (pendingCommands.length === 0) return 0;
    let settled = 0;
    for (let i = pendingCommands.length - 1; i >= 0; i--) {
      const c = pendingCommands[i];
      if (c.success()) {
        c.resolve();
        pendingCommands.splice(i, 1);
        settled += 1;
      } else if (c.failure && c.failure()) {
        c.reject(c.msg);
        pendingCommands.splice(i, 1);
        settled += 1;
      }
    }
    return settled;
  };

  const env: any = {
    getArena: () => ({
      getWidth: () => opts.width ?? 750,
      getHeight: () => opts.height ?? 750,
    }),
    getProcesses: () => processes,
    getTime: () => clock,
    isRunning: opts.isRunning ?? (() => true),
    random: () => rng(),
    emit: (name: string, payload: unknown) => events.push({ name, payload }),
    waitForCondition: (
      success: () => boolean,
      failure: (() => boolean) | null,
      msg: string | null
    ) =>
      new Promise<void>((resolve, reject) => {
        if (success()) return resolve();
        if (failure && failure()) return reject(msg ?? undefined);
        pendingCommands.push({ success, failure, resolve, reject, msg });
      }),
    trackBotOp: (op: Promise<unknown>) => {
      const wrapped: Promise<unknown> = Promise.resolve(op)
        .catch(() => undefined)
        .finally(() => botOps.delete(wrapped));
      botOps.add(wrapped);
    },
    // Capture structured faults so tests can assert a crash was reported (mirrors
    // Environment.reportFault, minus the ring-buffer cap).
    reportFault: (fault: Record<string, unknown>) => {
      faults.push(fault);
      events.push({ name: 'event', payload: { type: 'botFault', ...fault } });
    },
  };

  // Mirror of Environment.drainBotWork, including the setImmediate macrotask
  // boundary that makes quiescence detection robust to microtask/thread-pool
  // timing (see the note there).
  const drainBotWork = async (): Promise<void> => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    for (let round = 0; round < 10000; round++) {
      const settled = settlePendingCommands();
      await flush();
      let hadOps = false;
      while (botOps.size > 0) {
        hadOps = true;
        await Promise.all([...botOps]);
        await flush();
      }
      if (settled === 0 && !hadOps) return;
    }
  };

  const tick = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) {
      opts.run(env);
      clock += 1;
      await drainBotWork();
    }
  };

  return {
    env,
    processes,
    events,
    faults,
    getClock: () => clock,
    setClock: (t: number) => {
      clock = t;
    },
    tick,
    drainBotWork,
  };
}
