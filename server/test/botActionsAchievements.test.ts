import { describe, it, expect, vi, beforeEach } from 'vitest';

// propagateSource is the shared save path — both the REST source PUT and the MCP
// set_app_source land on it — so it's where the source-save achievements hook in.
// Mock everything it touches; this is about WHEN the award fires, not the save.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/ArenaMemberService', () => ({
  default: { getForApp: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/services/EnvironmentService', () => ({
  default: { getByArenaId: vi.fn(), get: vi.fn(), has: vi.fn() },
}));
vi.mock('../src/services/ArenaService', () => ({
  default: { getForUser: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/util/awardAchievements', () => ({
  awardEdgeAchievement: vi.fn().mockResolvedValue(undefined),
  evaluateAccountAchievements: vi.fn().mockResolvedValue([]),
}));

import {
  awardEdgeAchievement,
  evaluateAccountAchievements,
} from '../src/util/awardAchievements';
import { propagateSource } from '../src/util/botActions';

// An App stand-in. The key detail this exercises: setSource CLEARS `broken` in the
// same UPDATE, so the flag is gone the moment the save lands.
const makeApp = (opts: { broken: boolean; source?: string }) => {
  const state = { broken: opts.broken, source: opts.source ?? 'old source' };
  return {
    getId: () => 'app-1',
    getUserId: () => 'user-1',
    getSource: () => state.source,
    isBroken: () => state.broken,
    setSource: vi.fn(async (source: string) => {
      state.source = source;
      state.broken = false; // mirrors App.setSource
    }),
  };
};

// The awards are fire-and-forget (a badge must never slow a save), so let the
// microtask queue drain before asserting.
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => vi.clearAllMocks());

describe('propagateSource — achievement hooks', () => {
  it('awards Field Repair when the saved bot had been benched as broken', async () => {
    await propagateSource(makeApp({ broken: true }) as never, 'new source');
    await settle();
    expect(awardEdgeAchievement).toHaveBeenCalledWith(
      'user-1',
      'account-repair'
    );
  });

  it('does not award it for an ordinary save', async () => {
    await propagateSource(makeApp({ broken: false }) as never, 'new source');
    await settle();
    expect(awardEdgeAchievement).not.toHaveBeenCalled();
  });

  // The whole reason the flag is read before setSource: afterwards it is false,
  // and there is no other record that the ladder had benched this app.
  it('reads broken BEFORE the save clears it', async () => {
    const app = makeApp({ broken: true });
    await propagateSource(app as never, 'new source');
    await settle();
    // The save really did clear it...
    expect(app.isBroken()).toBe(false);
    // ...and the badge was still awarded, so the capture happened first.
    expect(awardEdgeAchievement).toHaveBeenCalledWith(
      'user-1',
      'account-repair'
    );
  });

  it('re-derives the account badges on every save — writing a bot is a milestone', async () => {
    await propagateSource(makeApp({ broken: false }) as never, 'new source');
    await settle();
    expect(evaluateAccountAchievements).toHaveBeenCalledWith('user-1');
  });

  it('still awards on a no-op re-save (that is how a user un-breaks a bot)', async () => {
    // Re-saving identical source is the documented way to clear `broken`, so the
    // repair badge must not be gated on the source having changed.
    await propagateSource(
      makeApp({ broken: true, source: 'same' }) as never,
      'same'
    );
    await settle();
    expect(awardEdgeAchievement).toHaveBeenCalledWith(
      'user-1',
      'account-repair'
    );
  });
});
