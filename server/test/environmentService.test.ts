import { describe, it, expect, vi } from 'vitest';

// The pg pool and isolated-vm are pulled in transitively; mock the pool so the
// import doesn't try to connect. disposeAll only touches injected fake
// environments, so no real isolate is created here.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

import environmentService from '../src/services/EnvironmentService';

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
