import { describe, it, expect, vi, beforeEach } from 'vitest';

// The pg pool and isolated-vm are pulled in transitively; mock the pool so the
// import doesn't try to connect. disposeAll only touches injected fake
// environments, so no real isolate is created here.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/ArenaMemberService', () => ({
  default: { getForArena: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/util/awardAchievements', () => ({
  recordSandboxStats: vi.fn().mockResolvedValue(undefined),
}));

import environmentService from '../src/services/EnvironmentService';
import Arena from '../src/types/arena';
import { DEMO_USER_ID } from '../src/types/user';
import { recordSandboxStats } from '../src/util/awardAchievements';

describe('EnvironmentService.disposeAll', () => {
  it('pauses and disposes every live environment and clears the store', () => {
    const makeEnv = () => ({ pause: vi.fn(), dispose: vi.fn() });
    const a = makeEnv();
    const b = makeEnv();
    // Inject fakes directly into the store (bypassing the isolate-creating get()).
    const store = environmentService.store as unknown as Record<
      string,
      unknown
    >;
    store['arena-a'] = a;
    store['arena-b'] = b;

    const count = environmentService.disposeAll();

    expect(count).toBe(2);
    // Each env is paused (tick loop stopped) before its isolate is released.
    expect(a.pause).toHaveBeenCalledOnce();
    expect(a.dispose).toHaveBeenCalledOnce();
    expect(b.pause).toHaveBeenCalledOnce();
    expect(b.dispose).toHaveBeenCalledOnce();
    // Store is emptied so a subsequent dispose is a no-op.
    expect(Object.keys(environmentService.store)).toHaveLength(0);
    expect(environmentService.disposeAll()).toBe(0);
  });
});

describe('EnvironmentService.metrics', () => {
  const store = () =>
    environmentService.store as unknown as Record<string, unknown>;
  // Clear the store directly (these fakes have no pause/dispose, so disposeAll
  // can't be used to reset).
  const clear = () => Object.keys(store()).forEach((k) => delete store()[k]);

  it('aggregates arena/isolate counts and the busiest tick time', () => {
    clear();
    store()['a'] = {
      isRunning: () => true,
      getProcesses: () => [{}, {}], // 2 isolates
      getAvgTickMs: () => 3.2,
    };
    store()['b'] = {
      isRunning: () => false, // paused arena still counts as a live env
      getProcesses: () => [{}], // 1 isolate
      getAvgTickMs: () => 7.891,
    };

    const m = environmentService.metrics();
    expect(m.arenas).toBe(2);
    expect(m.runningArenas).toBe(1);
    expect(m.isolates).toBe(3);
    // Busiest arena's EMA, rounded to 2 decimals.
    expect(m.maxAvgTickMs).toBe(7.89);

    clear();
  });

  it('reports zeroes when no environments are live', () => {
    clear();
    expect(environmentService.metrics()).toEqual({
      arenas: 0,
      runningArenas: 0,
      isolates: 0,
      maxAvgTickMs: 0,
    });
  });
});

// The achievement stats sink (GitHub #121). EnvironmentService.get is the only
// place a sink is installed, and it is the only place a real arena's Environment
// is constructed — LadderService builds its ephemeral one directly. That asymmetry
// is what makes it structurally impossible for a ranked match to be counted twice
// (once by the ladder hook, once by the env's dispose), so it is worth pinning.
describe('EnvironmentService.get — achievement stats sink', () => {
  const clearStore = () => {
    for (const key of Object.keys(environmentService.store)) {
      delete environmentService.store[key];
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearStore();
  });

  it('routes a real arena’s flushed stats to its OWNER', async () => {
    const env = await environmentService.get(new Arena('arena-1', 'user-1'));

    (env as unknown as { statsSink: (d: object) => void }).statsSink({
      kills: 2,
    });

    expect(recordSandboxStats).toHaveBeenCalledWith('user-1', { kills: 2 });
  });

  it('installs no sink for the shared demo account', async () => {
    // Excluded for the same reason it's excluded from ladder candidates: it isn't
    // a real player, and every visitor shares it.
    const env = await environmentService.get(
      new Arena('arena-demo', DEMO_USER_ID)
    );
    expect((env as unknown as { statsSink: unknown }).statsSink).toBeNull();
  });

  it('leaves a directly-constructed Environment sink-less (the ladder path)', async () => {
    // LadderService does exactly this — `new Environment(arena)` — so its flushes
    // are no-ops and its dispose() cannot double-count the ranked stats the ladder
    // hook records itself.
    const { default: Environment } = await import('../src/types/environment');
    const env = new Environment(new Arena('arena-x', 'user-1'));
    expect((env as unknown as { statsSink: unknown }).statsSink).toBeNull();
  });
});
