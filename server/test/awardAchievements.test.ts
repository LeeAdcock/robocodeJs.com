import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/AchievementService', () => ({
  default: { bump: vi.fn(), unlock: vi.fn() },
}));
// evaluateAccountAchievements reads the user's apps to count what they've authored.
vi.mock('../src/services/AppService', () => ({
  default: { getForUser: vi.fn() },
}));

import achievementService from '../src/services/AchievementService';
import appService from '../src/services/AppService';
import { STARTER_BOTS } from '../src/util/starterBots';
import {
  toCounterDeltas,
  recordSandboxStats,
  recordLadderResult,
  evaluateAccountAchievements,
  awardEdgeAchievement,
  LadderResult,
} from '../src/util/awardAchievements';

const bump = vi.mocked(achievementService.bump);
const unlock = vi.mocked(achievementService.unlock);
const getForUser = vi.mocked(appService.getForUser);

// What unlock() was asked to store, as plain ids.
const unlockedIds = (): string[] =>
  (unlock.mock.calls.at(-1)![1] as { id: string }[]).map((e) => e.id);
const unlockedEntry = (id: string) =>
  (
    unlock.mock.calls.at(-1)![1] as { id: string; appId?: string | null }[]
  ).find((e) => e.id === id);

const facts = (over = {}) => ({
  won: true,
  myRatingBefore: 1500,
  opponentRatingBefore: 1500,
  timesHit: 5,
  botsAlive: 3,
  botsTotal: 5,
  shotsFired: 40,
  shotsHit: 4,
  suddenDeath: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  bump.mockResolvedValue({});
  unlock.mockResolvedValue([]);
  getForUser.mockResolvedValue([]);
});

// A stand-in for App exposing only what the account pass reads.
const app = (source: string) => ({ getSource: () => source }) as never;
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('toCounterDeltas', () => {
  it('keeps the counters that feed a badge and drops the rest', () => {
    // timesHit/damageTaken are deliberately not lifetime counters: a "score" for
    // being shot would reward losing.
    expect(
      toCounterDeltas({
        shotsFired: 4,
        kills: 1,
        timesHit: 9,
        damageTaken: 40,
        timesDetected: 3,
      })
    ).toEqual({ shotsFired: 4, kills: 1 });
  });

  it('drops zero counters so an idle flush sends nothing', () => {
    expect(toCounterDeltas({ shotsFired: 0, kills: 0 })).toEqual({});
  });
});

describe('recordSandboxStats', () => {
  it('bumps the mapped counters and unlocks what the new totals earn', async () => {
    bump.mockResolvedValue({ kills: 1, shotsFired: 1200 });
    await recordSandboxStats('user-1', { kills: 1, shotsFired: 30 });

    expect(bump).toHaveBeenCalledWith('user-1', { kills: 1, shotsFired: 30 });
    expect(unlockedIds()).toEqual(
      expect.arrayContaining(['first-kill', 'shots-1000'])
    );
  });

  // The whole point of the scope split: an arena you control must not mint
  // prestige. Note this holds for TWO different reasons, and only one of them is
  // about this function:
  //   - ladder `test` badges (Flawless, Giant Slayer): unreachable here because we
  //     pass no match facts at all, and testAchievements is scope-pinned anyway.
  //   - ladder COUNTER badges (Contender, Champion): they key off ladderWins /
  //     ladderMatchesPlayed, and recordLadderResult is the only writer of those —
  //     see the counterpart test below. The sandbox path cannot produce them
  //     because bump() RETURNs only the counters it just touched.
  it('never awards a ladder badge, however good the sandbox match was', async () => {
    bump.mockResolvedValue({ kills: 500, shotsFired: 99999 });
    await recordSandboxStats('user-1', { kills: 500, shotsFired: 99999 });
    for (const id of unlockedIds()) {
      expect(id.startsWith('ladder-')).toBe(false);
    }
  });

  it('cannot touch the ladder-only counters — they are the un-farmable part', async () => {
    await recordSandboxStats('user-1', {
      kills: 5,
      // Even if a caller tried to smuggle these through, they are not BotStats
      // combat counters, so toCounterDeltas drops them.
      ...({ ladderWins: 99, ladderMatchesPlayed: 99 } as object),
    });
    expect(bump).toHaveBeenCalledWith('user-1', { kills: 5 });
  });

  it('leaves appId null — no single app earned a cumulative badge', async () => {
    bump.mockResolvedValue({ kills: 1 });
    await recordSandboxStats('user-1', { kills: 1 });
    expect(unlockedEntry('first-kill')!.appId).toBeNull();
  });

  it('does nothing at all when the flush carries no badge-worthy stats', async () => {
    await recordSandboxStats('user-1', { timesHit: 3 });
    expect(bump).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
  });

  it('swallows a database failure — a badge must not break an arena lifecycle', async () => {
    bump.mockRejectedValue(new Error('db down'));
    await expect(
      recordSandboxStats('user-1', { kills: 1 })
    ).resolves.toBeUndefined();
  });
});

describe('recordLadderResult', () => {
  const base = {
    userId: 'user-1',
    stats: { shotsFired: 20, kills: 2 },
    winningAppId: 'app-a',
  };

  it('counts a rated win as both a match played and a win', async () => {
    await recordLadderResult({ ...base, facts: facts(), rated: true });
    expect(bump).toHaveBeenCalledWith('user-1', {
      shotsFired: 20,
      kills: 2,
      ladderMatchesPlayed: 1,
      ladderWins: 1,
    });
  });

  it('counts a rated loss as played but not won', async () => {
    await recordLadderResult({
      ...base,
      facts: facts({ won: false }),
      rated: true,
    });
    expect(bump).toHaveBeenCalledWith('user-1', {
      shotsFired: 20,
      kills: 2,
      ladderMatchesPlayed: 1,
    });
  });

  it('awards the ladder badges the match earned, tagged with the winning app', async () => {
    await recordLadderResult({
      ...base,
      facts: facts({ timesHit: 0, botsAlive: 5, botsTotal: 5 }),
      rated: true,
    });
    expect(unlockedIds()).toEqual(
      expect.arrayContaining([
        'ladder-first-win',
        'ladder-flawless',
        'ladder-untouchable',
      ])
    );
    // This is what makes "Overlord earned Flawless Victory" sayable later.
    expect(unlockedEntry('ladder-flawless')!.appId).toBe('app-a');
  });

  // An unrated match is a timeout or a double crash: not a real result, so it must
  // not move the ranked counters or mint a badge — but the shots were still fired,
  // so the grindable counters are real.
  it('counts combat but nothing ranked when the match was not rated', async () => {
    await recordLadderResult({ ...base, facts: facts(), rated: false });
    expect(bump).toHaveBeenCalledWith('user-1', { shotsFired: 20, kills: 2 });
    for (const id of unlockedIds()) {
      expect(id.startsWith('ladder-')).toBe(false);
    }
  });

  it('does not award a ladder badge for an unrated match even if it "won"', async () => {
    bump.mockResolvedValue({});
    await recordLadderResult({
      ...base,
      facts: facts({ won: true, timesHit: 0, botsAlive: 5, botsTotal: 5 }),
      rated: false,
    });
    expect(unlockedIds()).not.toContain('ladder-flawless');
  });

  it('swallows a database failure — a badge must not fail a ranked match', async () => {
    bump.mockRejectedValue(new Error('db down'));
    await expect(
      recordLadderResult({ ...base, facts: facts(), rated: true })
    ).resolves.toBeUndefined();
  });
});

describe('evaluateAccountAchievements', () => {
  it('counts an authored bot, but not an untouched starter', async () => {
    // Being handed a bot isn't writing one — the same rule the ladder uses to
    // bench starters.
    getForUser.mockResolvedValue([
      app(STARTER_BOTS[0].source),
      app(STARTER_BOTS[1].source),
    ]);
    await evaluateAccountAchievements('user-1');
    expect(unlock).not.toHaveBeenCalled();

    getForUser.mockResolvedValue([
      app(STARTER_BOTS[0].source),
      app('bot.setName("Mine")'),
    ]);
    await evaluateAccountAchievements('user-1');
    expect(unlockedIds()).toContain('account-first-bot');
  });

  it('ignores an empty bot', async () => {
    getForUser.mockResolvedValue([app(''), app('   ')]);
    await evaluateAccountAchievements('user-1');
    expect(unlock).not.toHaveBeenCalled();
  });

  it('awards the anniversary from the account age', async () => {
    getForUser.mockResolvedValue([app('bot.setName("Mine")')]);
    await evaluateAccountAchievements('user-1', daysAgo(400));
    expect(unlockedIds()).toContain('account-veteran');
  });

  it('does not award the anniversary early', async () => {
    getForUser.mockResolvedValue([app('bot.setName("Mine")')]);
    await evaluateAccountAchievements('user-1', daysAgo(100));
    expect(unlockedIds()).not.toContain('account-veteran');
  });

  it('treats an unknown creation date as brand new rather than guessing', async () => {
    getForUser.mockResolvedValue([app('bot.setName("Mine")')]);
    await evaluateAccountAchievements('user-1');
    expect(unlockedIds()).not.toContain('account-veteran');
  });

  it('stores no earning app — an account badge is about the user', async () => {
    getForUser.mockResolvedValue([app('bot.setName("Mine")')]);
    await evaluateAccountAchievements('user-1');
    expect(unlockedEntry('account-first-bot')!.appId).toBeNull();
  });

  it('swallows a failure — it runs inside a page load and a save path', async () => {
    getForUser.mockRejectedValue(new Error('db down'));
    await expect(evaluateAccountAchievements('user-1')).resolves.toEqual([]);
  });
});

describe('awardEdgeAchievement', () => {
  it('unlocks the one badge, with no earning app', async () => {
    await awardEdgeAchievement('user-1', 'account-repair');
    expect(unlock).toHaveBeenCalledWith('user-1', [
      { id: 'account-repair', appId: null },
    ]);
  });

  it('swallows a failure — the moment is not worth failing its request over', async () => {
    unlock.mockRejectedValue(new Error('db down'));
    await expect(
      awardEdgeAchievement('user-1', 'account-mcp-token')
    ).resolves.toBeUndefined();
  });
});

// The rank badges (GitHub #121). The rank itself comes from AppService.getRanks —
// these cover the POLICY around it: the placement gate, best-of-two, and the rated
// gate that keeps a rank badge un-farmable.
describe('recordLadderResult — rank badges', () => {
  const ranked = (over: Partial<LadderResult> = {}): LadderResult => ({
    userId: 'user-1',
    stats: {},
    facts: facts(),
    rated: true,
    rankedApps: [{ appId: 'app-1', rank: 3, ratingGames: 50 }],
    ...over,
  });

  it('awards the rank badges an app has reached', async () => {
    await recordLadderResult(ranked());
    expect(unlockedIds()).toContain('ladder-top-10');
    expect(unlockedIds()).toContain('ladder-top-3');
    expect(unlockedIds()).not.toContain('ladder-top-1');
  });

  it('records the app that got there as the earner', async () => {
    await recordLadderResult(ranked());
    expect(unlockedEntry('ladder-top-3')?.appId).toBe('app-1');
  });

  // Elo's placement K-boost swings a young app's rating hard, so an early spike
  // must not mint a permanent badge.
  it('ignores an app that has not played its placement games yet', async () => {
    await recordLadderResult(
      ranked({ rankedApps: [{ appId: 'app-1', rank: 1, ratingGames: 19 }] })
    );
    expect(unlockedIds()).not.toContain('ladder-top-1');
  });

  it('awards on the placement boundary game', async () => {
    await recordLadderResult(
      ranked({ rankedApps: [{ appId: 'app-1', rank: 1, ratingGames: 20 }] })
    );
    expect(unlockedIds()).toContain('ladder-top-1');
  });

  it('ignores an app that is not on the board', async () => {
    await recordLadderResult(
      ranked({ rankedApps: [{ appId: 'app-1', ratingGames: 50 }] })
    );
    expect(unlockedIds()).not.toContain('ladder-top-10');
  });

  // A same-owner matchup fields two apps; the badge is about the better one.
  it('takes the best rank when a user fielded two apps', async () => {
    await recordLadderResult(
      ranked({
        rankedApps: [
          { appId: 'worse', rank: 9, ratingGames: 50 },
          { appId: 'better', rank: 2, ratingGames: 50 },
        ],
      })
    );
    expect(unlockedIds()).toContain('ladder-top-3');
    expect(unlockedEntry('ladder-top-3')?.appId).toBe('better');
  });

  // The entire reason a ladder badge is worth anything. Give the match some real
  // combat so it still reaches unlock() — an unrated match's shots genuinely
  // happened, so its counters count; only the ladder badges are withheld.
  it('awards no rank badge for an unrated match', async () => {
    bump.mockResolvedValue({ shotsFired: 10 });
    await recordLadderResult(
      ranked({ rated: false, stats: { shotsFired: 10 } })
    );
    expect(unlock).toHaveBeenCalled();
    expect(unlockedIds()).not.toContain('ladder-top-3');
  });

  // Rank is where you stand, not how one match went — you can hold your top-10
  // slot through a loss, and the badge says "reach", not "win while there".
  it('awards on rank even when the user lost the match', async () => {
    await recordLadderResult(ranked({ facts: facts({ won: false }) }));
    expect(unlockedIds()).toContain('ladder-top-3');
  });
});
