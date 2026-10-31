import { describe, it, expect, vi, beforeEach } from 'vitest';

// How EnvironmentService drives the user home leases (GitHub #444). The lease
// SQL itself is covered in homeService.test.ts; here HomeService is mocked and
// the store holds fakes, so no isolate or database is involved.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/ArenaMemberService', () => ({
  default: { getForArena: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/util/awardAchievements', () => ({
  recordSandboxStats: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/HomeService', () => ({
  default: {
    claim: vi.fn().mockResolvedValue(null),
    reconcile: vi.fn().mockResolvedValue([]),
  },
}));

import environmentService from '../src/services/EnvironmentService';
import homeService from '../src/services/HomeService';
import Arena from '../src/types/arena';

const store = () =>
  environmentService.store as unknown as Record<string, unknown>;

const fakeEnv = (userId: string) => ({
  getArena: () => new Arena('unused', userId),
  pause: vi.fn(),
  dispose: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(store()).forEach((k) => delete store()[k]);
});

describe('EnvironmentService user homes', () => {
  it("claims the owner's home when it builds an arena", async () => {
    await environmentService.get(new Arena('arena-1', 'user-1'));
    expect(homeService.claim).toHaveBeenCalledWith('user-1');

    // An arena already in memory doesn't claim again; reconcile renews it.
    vi.mocked(homeService.claim).mockClear();
    await environmentService.get(new Arena('arena-1', 'user-1'));
    expect(homeService.claim).not.toHaveBeenCalled();
  });

  it('reconciles the set of users it holds arenas for', async () => {
    store()['a1'] = fakeEnv('user-1');
    store()['a2'] = fakeEnv('user-1');
    store()['a3'] = fakeEnv('user-2');

    await environmentService.reconcileHomes(1234);

    expect(homeService.reconcile).toHaveBeenCalledWith(
      new Set(['user-1', 'user-2']),
      1234
    );
  });

  it("drops every arena of a user whose home was lost, and no one else's", async () => {
    const mine1 = fakeEnv('user-1');
    const mine2 = fakeEnv('user-1');
    const other = fakeEnv('user-2');
    store()['a1'] = mine1;
    store()['a2'] = mine2;
    store()['a3'] = other;
    vi.mocked(homeService.reconcile).mockResolvedValueOnce(['user-1']);

    await environmentService.reconcileHomes();

    expect(mine1.dispose).toHaveBeenCalledOnce();
    expect(mine2.dispose).toHaveBeenCalledOnce();
    expect(other.dispose).not.toHaveBeenCalled();
    expect(Object.keys(store())).toEqual(['a3']);
  });

  it('skips a pass while the previous one is still waiting on the database', async () => {
    let finish: (lost: string[]) => void = () => undefined;
    vi.mocked(homeService.reconcile).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve))
    );

    const first = environmentService.reconcileHomes();
    await environmentService.reconcileHomes();
    expect(homeService.reconcile).toHaveBeenCalledOnce();

    finish([]);
    await first;
    await environmentService.reconcileHomes();
    expect(homeService.reconcile).toHaveBeenCalledTimes(2);
  });
});
