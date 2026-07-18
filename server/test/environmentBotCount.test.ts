import { describe, it, expect, vi, beforeEach } from 'vitest';

// setBotCount applies the per-app bot quantity (1–5) to a live arena: every
// process spawns its shortfall immediately or sheds its newest bots outright
// (removed, not killed — no elimination recorded), and the same setting drives
// restart()/addApp() when teams are (re)built.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));
vi.mock('../src/services/AppService', () => ({
  default: { get: () => Promise.resolve(null) },
}));
// Keep spawns isolate-free: sandbox wiring + code loading are compiler.test.ts
// territory; here we exercise only the roster arithmetic and events. init's
// stub installs the per-bot logger the real init provides, so the spawn path's
// execute() doesn't crash on it.
vi.mock('../src/util/compiler', () => ({
  default: {
    execute: vi.fn(() => Promise.resolve()),
    init: vi.fn((_env, _process, bot) => {
      bot.logger = { trace: () => undefined, error: () => undefined };
    }),
    check: vi.fn(),
    emitBotFault: vi.fn(),
  },
}));

import Bot from '../src/types/bot';
import Environment, { Process } from '../src/types/environment';
import Arena from '../src/types/arena';
import compiler from '../src/util/compiler';

interface ArenaEvent {
  type: string;
  id?: string;
  botCount?: number;
}

const makeEnv = (teamSizes: number[]) => {
  const env = new Environment(new Arena('a', 'u'));
  teamSizes.forEach((size, i) => {
    const process = new Process(`app${i + 1}`);
    for (let b = 0; b < size; b++) process.bots.push(new Bot(env, process));
    env.getProcesses().push(process);
  });
  return env;
};

const collectEvents = (env: Environment) => {
  const events: ArenaEvent[] = [];
  env.addListener('event', (e: ArenaEvent) => events.push(e));
  return events;
};

describe('Environment.setBotCount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to 5 and clamps to 1–5', async () => {
    const env = makeEnv([]);
    expect(env.getBotCount()).toBe(5);
    await env.setBotCount(0);
    expect(env.getBotCount()).toBe(1);
    await env.setBotCount(99);
    expect(env.getBotCount()).toBe(5);
    await env.setBotCount(3.9);
    expect(env.getBotCount()).toBe(3);
  });

  it('announces the new setting with an arenaBotCount event', async () => {
    const env = makeEnv([]);
    const events = collectEvents(env);
    await env.setBotCount(2);
    expect(
      events.some((e) => e.type === 'arenaBotCount' && e.botCount === 2)
    ).toBe(true);
  });

  it('sheds each process’s newest bots and announces their removal', async () => {
    const env = makeEnv([5, 5]);
    const events = collectEvents(env);
    const expectedRemoved = env
      .getProcesses()
      .flatMap((p) => p.bots.slice(3).map((b) => b.id));

    await env.setBotCount(3);

    env.getProcesses().forEach((p) => expect(p.bots.length).toBe(3));
    const removes = events.filter((e) => e.type === 'arenaRemoveBot');
    expect(removes.map((e) => e.id).sort()).toEqual(expectedRemoved.sort());
    // Removal is not death: no bot was damaged or eliminated.
    expect(events.some((e) => e.type === 'botDamaged')).toBe(false);
  });

  it('spawns each process’s shortfall immediately, like a late-joining app', async () => {
    const env = makeEnv([2, 2]);
    const events = collectEvents(env);

    await env.setBotCount(4);

    env.getProcesses().forEach((p) => {
      expect(p.bots.length).toBe(4);
      // Spawned bots go through the standard late-join start: their code loads
      // and START fires on a subsequent tick (needsStarting/codeLoaded gating).
      p.bots.slice(2).forEach((b) => expect(b.needsStarting).toBe(true));
    });
    expect(compiler.init).toHaveBeenCalledTimes(4);
    expect(compiler.execute).toHaveBeenCalledTimes(4);
    expect(events.filter((e) => e.type === 'arenaPlaceBot').length).toBe(4);
  });

  it('handles mixed rosters: grows short teams and shrinks long ones to the same size', async () => {
    const env = makeEnv([5, 1]);
    await env.setBotCount(3);
    expect(env.getProcesses().map((p) => p.bots.length)).toEqual([3, 3]);
  });

  it('addApp fields the configured quantity', async () => {
    const env = makeEnv([]);
    await env.setBotCount(2);
    env.addApp({ getId: () => 'app1', getName: () => 'App 1' } as never);
    expect(env.getProcesses()[0].bots.length).toBe(2);
  });
});
