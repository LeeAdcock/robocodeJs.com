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
