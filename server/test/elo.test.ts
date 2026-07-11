import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RATING,
  PLACEMENT_GAMES,
  kFactor,
  expectedScore,
  updateRatings,
} from '../src/util/elo';

// The ladder's rating math (GitHub #151). These lock the standard-Elo contract:
// symmetric expectations, zero-sum-ish swings between equals, a placement K
// boost, and the rounding invariant the persistence/display layer relies on.

describe('expectedScore', () => {
  it('is 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });

  it('gives the favorite ~91% at a 400-point gap', () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(0.909, 3);
    expect(expectedScore(1500, 1900)).toBeCloseTo(0.091, 3);
  });

  it('is symmetric — the two sides always sum to 1', () => {
    expect(expectedScore(1650, 1480) + expectedScore(1480, 1650)).toBeCloseTo(
      1,
      10
    );
  });
});

describe('kFactor', () => {
  it('is boosted during placement, then fixed', () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(PLACEMENT_GAMES));
    expect(kFactor(PLACEMENT_GAMES - 1)).toBe(kFactor(0));
    expect(kFactor(PLACEMENT_GAMES)).toBe(kFactor(PLACEMENT_GAMES + 100));
  });
});

describe('updateRatings', () => {
  it('moves the winner up and the loser down by the same amount between equals', () => {
    const a = { rating: DEFAULT_RATING, games: PLACEMENT_GAMES };
    const b = { rating: DEFAULT_RATING, games: PLACEMENT_GAMES };
    const res = updateRatings(a, b, 'a');
    expect(res.a.delta).toBeGreaterThan(0);
    expect(res.b.delta).toBe(-res.a.delta);
    expect(res.a.rating + res.b.rating).toBe(2 * DEFAULT_RATING);
  });

  it('rewards an upset more than an expected win', () => {
    const strong = { rating: 1800, games: 50 };
    const weak = { rating: 1200, games: 50 };
    // Underdog (weak) beats the favorite.
    const upset = updateRatings(weak, strong, 'a');
    // Favorite beats the underdog as expected.
    const expected = updateRatings(strong, weak, 'a');
    expect(upset.a.delta).toBeGreaterThan(expected.a.delta);
  });

  it('preserves before + delta === after (rounding invariant)', () => {
    const a = { rating: 1512, games: 3 };
    const b = { rating: 1487, games: 40 };
    const res = updateRatings(a, b, 'b');
    expect(a.rating + res.a.delta).toBe(res.a.rating);
    expect(b.rating + res.b.delta).toBe(res.b.rating);
  });

  it('swings a placement bot more than its established opponent', () => {
    const rookie = { rating: 1500, games: 0 };
    const veteran = { rating: 1500, games: 100 };
    const res = updateRatings(rookie, veteran, 'a');
    expect(Math.abs(res.a.delta)).toBeGreaterThan(Math.abs(res.b.delta));
  });

  it('a draw between equals leaves both ratings unchanged', () => {
    const a = { rating: 1600, games: 20 };
    const b = { rating: 1600, games: 20 };
    const res = updateRatings(a, b, 'draw');
    expect(res.a.delta).toBe(0);
    expect(res.b.delta).toBe(0);
  });
});
