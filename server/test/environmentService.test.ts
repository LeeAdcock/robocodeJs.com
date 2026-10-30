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

import environmentService, {
  parseIdlePauseMs,
} from '../src/services/EnvironmentService';
import Arena from '../src/types/arena';
import Environment from '../src/types/environment';
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
      isIdlePaused: () => false,
      getProcesses: () => [{}, {}], // 2 isolates
      getAvgTickMs: () => 3.2,
    };
    store()['b'] = {
      isRunning: () => false, // paused arena still counts as a live env
      isIdlePaused: () => true,
      getProcesses: () => [{}], // 1 isolate
      getAvgTickMs: () => 7.891,
    };

    const m = environmentService.metrics();
    expect(m.arenas).toBe(2);
    expect(m.runningArenas).toBe(1);
    expect(m.idlePausedArenas).toBe(1);
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
      idlePausedArenas: 0,
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

// Idle auto-pause. Nothing else pauses a running arena, so without it every
// arena anyone resumed kept ticking until the next deploy.
describe('EnvironmentService idle pause', () => {
  const MIN = 60 * 1000;
  const clearStore = () => {
    for (const key of Object.keys(environmentService.store)) {
      environmentService.store[key].pause();
      delete environmentService.store[key];
    }
  };
  // An arena with no bots ends its match (game over) on the first tick, so stub
  // the tick loop out: these tests are about the running flag, not ticking.
  const noLoop = (env: Environment) => {
    (env as unknown as { runLoop: () => Promise<void> }).runLoop = () =>
      Promise.resolve();
    return env;
  };
  const running = async (id: string) => {
    const env = noLoop(await environmentService.get(new Arena(id, 'user-1')));
    env.resume();
    return env;
  };
  const later = (ms: number) => Date.now() + ms;

  beforeEach(() => {
    clearStore();
    environmentService.idlePauseMs = 5 * MIN;
  });

  it('pauses a running arena once nobody has watched or used it for the window', async () => {
    const env = await running('idle-1');

    expect(environmentService.pauseIdle(later(4 * MIN))).toBe(0);
    expect(env.isRunning()).toBe(true);

    expect(environmentService.pauseIdle(later(6 * MIN))).toBe(1);
    expect(env.isRunning()).toBe(false);
    expect(env.isIdlePaused()).toBe(true);
    expect(environmentService.metrics().idlePausedArenas).toBe(1);
  });

  it('never pauses an arena with an open SSE stream', async () => {
    const env = await running('idle-2');
    const listener = () => undefined;
    env.addListener('log', listener);

    expect(environmentService.pauseIdle(later(60 * MIN))).toBe(0);
    expect(env.isRunning()).toBe(true);

    // The idle clock starts when the last viewer leaves, not when they arrived.
    env.removeListener('log', listener);
    expect(environmentService.pauseIdle(later(4 * MIN))).toBe(0);
    expect(environmentService.pauseIdle(later(6 * MIN))).toBe(1);
  });

  it('leaves a driven match (run_match) running', async () => {
    const env = await running('idle-3');
    env.beginMatch();
    expect(environmentService.pauseIdle(later(60 * MIN))).toBe(0);
    expect(env.isRunning()).toBe(true);
    env.endMatch();
  });

  it('wakes an idle-paused arena on the next access and restarts its idle clock', async () => {
    const env = await running('idle-4');
    environmentService.pauseIdle(later(6 * MIN));

    const again = await environmentService.get(new Arena('idle-4', 'user-1'));
    expect(again).toBe(env);
    expect(env.isRunning()).toBe(true);
    expect(env.isIdlePaused()).toBe(false);
    expect(environmentService.pauseIdle(later(4 * MIN))).toBe(0);
  });

  it('keeps a user-paused arena paused on access', async () => {
    const env = await running('idle-5');
    env.pause();
    expect(environmentService.pauseIdle(later(60 * MIN))).toBe(0);

    await environmentService.get(new Arena('idle-5', 'user-1'));
    expect(env.isRunning()).toBe(false);
  });

  it('turns an idle pause into a user pause when the user pauses explicitly', async () => {
    const env = await running('idle-6');
    environmentService.pauseIdle(later(6 * MIN));
    env.pause();
    expect(env.isIdlePaused()).toBe(false);

    await environmentService.get(new Arena('idle-6', 'user-1'));
    expect(env.isRunning()).toBe(false);
  });

  it('is disabled by a zero window', async () => {
    environmentService.idlePauseMs = 0;
    const env = await running('idle-7');
    expect(environmentService.pauseIdle(later(60 * MIN))).toBe(0);
    expect(env.isRunning()).toBe(true);
  });

  // A rebuilt arena resumes inside get(), before a test could stub its loop,
  // so these assert on the resume() call rather than on isRunning().
  it('rebuilds an arena the GC disposed while idle-paused as running', async () => {
    const resume = vi.spyOn(Environment.prototype, 'resume');
    const arena = new Arena('idle-8', 'user-1');
    const env = await running('idle-8');
    environmentService.pauseIdle(later(6 * MIN));
    environmentService.collectGarbage(later(31 * MIN));
    expect(environmentService.has('idle-8')).toBe(false);

    resume.mockClear();
    const rebuilt = await environmentService.get(arena);
    expect(rebuilt).not.toBe(env);
    expect(resume.mock.contexts).toEqual([rebuilt]);

    // Only once: the next rebuild of this arena comes back paused.
    rebuilt.pause();
    environmentService.collectGarbage(later(31 * MIN));
    resume.mockClear();
    await environmentService.get(arena);
    expect(resume).not.toHaveBeenCalled();
    resume.mockRestore();
  });

  it('rebuilds a GC-disposed user-paused arena paused', async () => {
    const resume = vi.spyOn(Environment.prototype, 'resume');
    const env = await running('idle-9');
    env.pause();
    environmentService.collectGarbage(later(31 * MIN));

    resume.mockClear();
    await environmentService.get(new Arena('idle-9', 'user-1'));
    expect(resume).not.toHaveBeenCalled();
    resume.mockRestore();
  });
});

describe('parseIdlePauseMs', () => {
  it('defaults to five minutes and accepts 0 to disable', () => {
    expect(parseIdlePauseMs(undefined)).toBe(5 * 60 * 1000);
    expect(parseIdlePauseMs('')).toBe(5 * 60 * 1000);
    expect(parseIdlePauseMs('abc')).toBe(5 * 60 * 1000);
    expect(parseIdlePauseMs('-1')).toBe(5 * 60 * 1000);
    expect(parseIdlePauseMs('0')).toBe(0);
    expect(parseIdlePauseMs('60000')).toBe(60000);
  });
});
