import { describe, it, expect, vi } from 'vitest';

// A pinned arena seed must reproduce a bot's start state on every restart — not
// just its placement/body-heading (computeSpawns already draws those
// synchronously) but the three OTHER seed-derived values the old code drew inside
// restart()'s async per-process app fetch: the turret and radar starting angles
// and the seed for the bot's in-isolate Math.random.
//
// appService.get is a real DB query; its .then() callbacks settle in completion
// order, not process order. When the turret/radar/Math.random draws lived in
// those callbacks, the arena PRNG was consumed in whatever order the app rows
// happened to load — so the same pinned seed could hand a given team a different
// opening aim/sweep and a different Math.random stream from one restart to the
// next. This test forces the two processes' fetches to resolve in OPPOSITE orders
// across two otherwise-identical restarts and asserts each app's per-slot start
// state is byte-for-byte the same regardless. Before the fix it diverges.

const h = vi.hoisted(() => ({
  // Captured (appId, turret, radar, mathSeed) per init call.
  initCalls: [] as {
    appId: string;
    turret: number;
    radar: number;
    mathSeed: number | undefined;
  }[],
  // appId -> how many microtask hops its appService.get resolution is delayed by,
  // so a test can force one process's rebuild callback to run before another's.
  resolveRank: {} as Record<string, number>,
}));

vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

// Resolve each app after `resolveRank[appId]` microtask hops so the per-process
// rebuild callbacks in restart() fire in a controllable order (the real-world
// nondeterminism being guarded against).
vi.mock('../src/services/AppService', () => ({
  default: {
    get: (appId: string) => {
      const rank = h.resolveRank[appId] ?? 0;
      let p: Promise<unknown> = Promise.resolve({ getName: () => 'app' });
      for (let i = 0; i < rank; i++) p = p.then((x) => x);
      return p;
    },
  },
}));

// Capture what init receives instead of standing up real isolates. init records
// the turret/radar angles restart() set on the bot plus the mathSeed it passed;
// execute is a no-op so no bot code runs.
vi.mock('../src/util/compiler', () => ({
  default: {
    init: (
      _env: unknown,
      process: { getAppId: () => string },
      bot: {
        turret: { orientation: number; radar: { orientation: number } };
        logger: unknown;
      },
      mathSeed: number | undefined
    ) => {
      h.initCalls.push({
        appId: process.getAppId(),
        turret: bot.turret.orientation,
        radar: bot.turret.radar.orientation,
        mathSeed,
      });
      // Real init wires up bot.logger; Bot.execute (run below) uses it.
      const noop = () => undefined;
      bot.logger = {
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
      };
    },
    execute: () => Promise.resolve(),
    emitBotFault: () => undefined,
  },
}));

import Environment, { Process } from '../src/types/environment';
import Arena from '../src/types/arena';

// Restart a fresh two-process arena at `seed`, with app resolution delayed per
// `resolveRank`, and return each app's per-slot start state (in slot order).
const restartAndCapture = async (
  seed: number,
  resolveRank: Record<string, number>
) => {
  h.initCalls.length = 0;
  h.resolveRank = resolveRank;
  const env = new Environment(new Arena('a', 'u'));
  env.getProcesses().push(new Process('app1'));
  env.getProcesses().push(new Process('app2'));
  env.setSeed(seed);
  await env.restart();
  const byApp: Record<
    string,
    { turret: number; radar: number; mathSeed: number | undefined }[]
  > = {};
  for (const c of h.initCalls) {
    (byApp[c.appId] ??= []).push({
      turret: c.turret,
      radar: c.radar,
      mathSeed: c.mathSeed,
    });
  }
  return byApp;
};

describe('restart per-bot start state is seed-deterministic, not load-order-dependent', () => {
  it('gives each app the same turret/radar/Math.random start regardless of which app loads first', async () => {
    // Same pinned seed, opposite app-fetch resolution orders.
    const a = await restartAndCapture(42, { app1: 0, app2: 3 });
    const b = await restartAndCapture(42, { app1: 3, app2: 0 });

    expect(a.app1).toHaveLength(Environment.DEFAULT_BOT_COUNT);
    expect(a.app2).toHaveLength(Environment.DEFAULT_BOT_COUNT);
    // The whole per-app start state reproduces even though the callbacks ran in
    // the reverse order the second time.
    expect(b).toEqual(a);
    // And a real seed was handed to init (not left to a fallback draw).
    expect(a.app1.every((s) => typeof s.mathSeed === 'number')).toBe(true);
  });

  it('a different seed produces different start state', async () => {
    const a = await restartAndCapture(42, { app1: 0, app2: 0 });
    const b = await restartAndCapture(43, { app1: 0, app2: 0 });
    expect(b).not.toEqual(a);
  });

  it('gives the two teams distinct start state (each bot a distinct sub-seed)', async () => {
    const a = await restartAndCapture(42, { app1: 0, app2: 0 });
    const seeds = [...a.app1, ...a.app2].map((s) => s.mathSeed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});
