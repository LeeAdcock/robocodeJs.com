import { describe, it, expect } from 'vitest';
import {
  ACHIEVEMENTS,
  counterAchievements,
  testAchievements,
  LadderFacts,
} from '../src/util/achievements';

// The catalog is data, so these are the invariants that keep it honest as entries
// are added. A badge is a promise to the user; most of these exist to stop that
// promise being broken silently.

const win = (over: Partial<LadderFacts> = {}): LadderFacts => ({
  won: true,
  myRatingBefore: 1500,
  opponentRatingBefore: 1500,
  timesHit: 5,
  botsAlive: 3,
  botsTotal: 5,
  ...over,
});

const ids = (list: { id: string }[]) => list.map((a) => a.id).sort();

describe('achievement catalog invariants', () => {
  it('has unique ids', () => {
    const seen = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives every badge a name, description and icon', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name, a.id).toBeTruthy();
      expect(a.description, a.id).toBeTruthy();
      expect(a.icon, a.id).toBeTruthy();
    }
  });

  it('defines each badge as exactly one of counter+threshold or test', () => {
    for (const a of ACHIEVEMENTS) {
      const isCounter = a.counter !== undefined;
      const isTest = a.test !== undefined;
      expect(
        isCounter !== isTest,
        `${a.id} must be exactly one of counter/test`
      ).toBe(true);
      if (isCounter) {
        expect(a.threshold, `${a.id} needs a threshold`).toBeTypeOf('number');
        expect(
          a.threshold!,
          `${a.id} threshold must be positive`
        ).toBeGreaterThan(0);
      }
    }
  });

  // Encodes the sink's limitation so it can't regress into a badge that silently
  // never unlocks: the sandbox flush carries only summed counter deltas, and a
  // sandbox arena has no winner concept (its game-over fires when EVERY app is
  // dead), so a per-match predicate is not expressible there. If you need one, the
  // flush has to carry per-app match facts first.
  it('has no test-based sandbox badge — sandbox is counter-only by construction', () => {
    const offenders = ACHIEVEMENTS.filter(
      (a) => a.scope === 'sandbox' && a.test
    );
    expect(offenders.map((a) => a.id)).toEqual([]);
  });

  // The whole point of the scope split: a ladder badge must be un-farmable, which
  // is only true if it is never evaluated outside a rated ladder match.
  it('scopes every test badge to the ladder', () => {
    const offenders = ACHIEVEMENTS.filter(
      (a) => a.test && a.scope !== 'ladder'
    );
    expect(offenders.map((a) => a.id)).toEqual([]);
  });
});

describe('counterAchievements', () => {
  it('unlocks at the threshold, not before', () => {
    expect(ids(counterAchievements({ shotsFired: 999 }))).not.toContain(
      'shots-1000'
    );
    expect(ids(counterAchievements({ shotsFired: 1000 }))).toContain(
      'shots-1000'
    );
  });

  it('returns every tier the counter has passed, not just the highest', () => {
    // The evaluator relies on this: it passes the full eligible list every time and
    // lets ON CONFLICT DO NOTHING absorb the ones already held.
    const unlocked = ids(counterAchievements({ shotsFired: 10000 }));
    expect(unlocked).toContain('shots-1000');
    expect(unlocked).toContain('shots-10000');
  });

  it('unlocks first-kill on the very first kill', () => {
    expect(ids(counterAchievements({ kills: 0 }))).not.toContain('first-kill');
    expect(ids(counterAchievements({ kills: 1 }))).toContain('first-kill');
  });

  it('treats a missing counter as zero rather than unlocking', () => {
    expect(counterAchievements({})).toEqual([]);
  });
});

describe('testAchievements (ladder)', () => {
  it('awards First Blood for a win and nothing at all for a loss', () => {
    expect(ids(testAchievements('ladder', win()))).toContain(
      'ladder-first-win'
    );
    expect(testAchievements('ladder', win({ won: false }))).toEqual([]);
  });

  it('awards Flawless Victory only when no bot was hit', () => {
    expect(
      ids(testAchievements('ladder', win({ timesHit: 0, botsAlive: 5 })))
    ).toContain('ladder-flawless');
    expect(ids(testAchievements('ladder', win({ timesHit: 1 })))).not.toContain(
      'ladder-flawless'
    );
  });

  it('awards Untouchable only with the whole squad alive', () => {
    expect(
      ids(testAchievements('ladder', win({ botsAlive: 5, botsTotal: 5 })))
    ).toContain('ladder-untouchable');
    expect(
      ids(testAchievements('ladder', win({ botsAlive: 4, botsTotal: 5 })))
    ).not.toContain('ladder-untouchable');
  });

  it('awards Giant Slayer at a 150-point gap, but not for beating a peer', () => {
    const upset = win({ myRatingBefore: 1400, opponentRatingBefore: 1550 });
    expect(ids(testAchievements('ladder', upset))).toContain(
      'ladder-giant-slayer'
    );
    const nearly = win({ myRatingBefore: 1400, opponentRatingBefore: 1549 });
    expect(ids(testAchievements('ladder', nearly))).not.toContain(
      'ladder-giant-slayer'
    );
    // Beating someone weaker is never an upset.
    const stomp = win({ myRatingBefore: 1800, opponentRatingBefore: 1200 });
    expect(ids(testAchievements('ladder', stomp))).not.toContain(
      'ladder-giant-slayer'
    );
  });

  it('never awards a ladder badge when asked for another scope', () => {
    expect(
      testAchievements('sandbox', win({ timesHit: 0, botsAlive: 5 }))
    ).toEqual([]);
    expect(testAchievements('account', win())).toEqual([]);
  });
});
