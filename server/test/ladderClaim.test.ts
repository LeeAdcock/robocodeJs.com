import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// The cross-instance ladder guards (GitHub #409), run against a real pg-mem
// database rather than a mocked pool, because what matters is that the SQL
// itself behaves: a claim is all-or-nothing and can't be stolen, a stale claim
// expires, and concurrent rating results compose instead of overwriting.
vi.mock('../src/util/db', async () => {
  const { newDb } = await import('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  return { default: new Pool() };
});

import pool from '../src/util/db';
import ladderClaimService from '../src/services/LadderClaimService';
import App from '../src/types/app';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeAll(async () => {
  // ladder_claim is created by LadderClaimService's own DDL at import.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app (
      id UUID PRIMARY KEY, rating real default 1500,
      ratingGames integer default 0, ratingWins integer default 0,
      lastRankedAt timestamp)`);
});

beforeEach(async () => {
  await pool.query('DELETE FROM ladder_claim');
});

describe('LadderClaimService', () => {
  it('claims both apps when both are free', async () => {
    const claim = await ladderClaimService.claim(
      A,
      B,
      new Date(),
      minutesAgo(5)
    );
    expect(claim).not.toBeNull();
    expect(await ladderClaimService.claimedApps(minutesAgo(5))).toEqual(
      new Set([A, B])
    );
  });

  it('refuses a pair sharing an app with a live claim, all-or-nothing', async () => {
    const first = await ladderClaimService.claim(
      A,
      B,
      new Date(),
      minutesAgo(5)
    );
    const second = await ladderClaimService.claim(
      C,
      B,
      new Date(),
      minutesAgo(5)
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    // The loser kept nothing (C released), and didn't disturb the winner's B.
    expect(await ladderClaimService.claimedApps(minutesAgo(5))).toEqual(
      new Set([A, B])
    );
  });

  it('frees the apps on release, and a release only removes its own rows', async () => {
    const first = await ladderClaimService.claim(
      A,
      B,
      new Date(),
      minutesAgo(5)
    );
    // A release from some other (stale) attempt must not free the live claim.
    await ladderClaimService.release({ appIds: [A, B], token: 'not-mine' });
    expect(await ladderClaimService.claimedApps(minutesAgo(5))).toEqual(
      new Set([A, B])
    );

    await ladderClaimService.release(first!);
    expect(await ladderClaimService.claimedApps(minutesAgo(5))).toEqual(
      new Set()
    );
    expect(
      await ladderClaimService.claim(A, C, new Date(), minutesAgo(5))
    ).not.toBeNull();
  });

  it('lets a claim left by a dead instance expire', async () => {
    // Claimed 10 minutes ago and never released.
    await ladderClaimService.claim(A, B, minutesAgo(10), minutesAgo(15));
    // Not live any more against a 5-minute lease...
    expect(await ladderClaimService.claimedApps(minutesAgo(5))).toEqual(
      new Set()
    );
    // ...so a new match can take the apps over.
    expect(
      await ladderClaimService.claim(A, B, new Date(), minutesAgo(5))
    ).not.toBeNull();
  });
});

describe('App.applyRatingResult', () => {
  it('composes concurrent results instead of the last write winning', async () => {
    await pool.query({
      text: 'INSERT INTO app(id, rating, ratingGames, ratingWins) VALUES ($1, 1500, 20, 10)',
      values: [A],
    });
    // Two matches for the same app, both started from 1500 / 20 games, finish
    // at once. With the old absolute write the second erased the first.
    const one = new App(A, 'owner');
    const two = new App(A, 'owner');
    await Promise.all([
      one.applyRatingResult(16, true),
      two.applyRatingResult(-12, false),
    ]);

    const row = (
      await pool.query({
        text: 'SELECT rating as "rating", ratingGames as "ratingGames", ratingWins as "ratingWins" FROM app WHERE id=$1',
        values: [A],
      })
    ).rows[0];
    expect(Number(row.rating)).toBe(1504);
    expect(Number(row.ratingGames)).toBe(22);
    expect(Number(row.ratingWins)).toBe(11);
  });

  it('syncs the in-memory view to the row after the update', async () => {
    await pool.query({
      text: 'INSERT INTO app(id, rating, ratingGames, ratingWins) VALUES ($1, 1600, 5, 3)',
      values: [B],
    });
    const app = new App(B, 'owner');
    await app.applyRatingResult(10, true);
    expect(app.getRating()).toBe(1610);
    expect(app.getRatingGames()).toBe(6);
    expect(app.getRatingWins()).toBe(4);
  });
});
