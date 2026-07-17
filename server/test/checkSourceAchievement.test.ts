import { describe, it, expect, vi, beforeEach } from 'vitest';

// checkSource is the shared dry-run path — the editor's Check button and the MCP
// check_app_source tool both land on it — so it's where the checker badge hooks.
// Mock the compiler: this is about WHEN the award fires, not about compiling.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/util/compiler', () => ({
  default: { check: vi.fn() },
}));
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

import compiler from '../src/util/compiler';
import { awardEdgeAchievement } from '../src/util/awardAchievements';
import { checkSource } from '../src/util/botActions';

const check = vi.mocked(compiler.check);
const award = vi.mocked(awardEdgeAchievement);

// The award is fire-and-forget, so let the microtask queue drain first.
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  check.mockResolvedValue({ valid: true });
});

describe('checkSource', () => {
  it('returns the compiler verdict untouched', async () => {
    check.mockResolvedValue({ valid: true });
    await expect(checkSource('user-1', 'const x = 1')).resolves.toEqual({
      valid: true,
    });
    expect(check).toHaveBeenCalledWith('const x = 1');
  });

  it('awards Sanity Check to the user who ran it', async () => {
    await checkSource('user-1', 'source');
    await settle();
    expect(award).toHaveBeenCalledWith('user-1', 'account-check');
  });

  // The badge is for USING the checker. Catching a syntax error is the tool
  // working, not the user failing — so a failed check earns it just the same.
  it('awards it even when the source does not compile', async () => {
    check.mockResolvedValue({
      valid: false,
      stage: 'compile',
      errorCode: 'E001',
      message: 'Unexpected token',
    });

    const result = await checkSource('user-1', 'const =');
    await settle();

    expect(result.valid).toBe(false);
    expect(award).toHaveBeenCalledWith('user-1', 'account-check');
  });
});
