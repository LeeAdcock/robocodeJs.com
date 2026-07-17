import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { sslConfig } from '../src/util/db';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

// TLS posture for the RDS connection (OWASP A02-1). By default we verify the
// server certificate against the pinned AWS RDS CA bundle; two env escape
// hatches downgrade that. These lock the three branches in.
describe('sslConfig (RDS TLS)', () => {
  afterEach(() => {
    delete process.env.RDS_SSL;
    delete process.env.RDS_SSL_NO_VERIFY;
  });

  it('verifies against the pinned CA bundle by default', () => {
    const ssl = sslConfig() as { ca: string; rejectUnauthorized: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(typeof ssl.ca).toBe('string');
    expect(ssl.ca).toContain('BEGIN CERTIFICATE');
  });

  it('RDS_SSL=false disables TLS entirely', () => {
    process.env.RDS_SSL = 'false';
    expect(sslConfig()).toBeUndefined();
  });

  it('RDS_SSL_NO_VERIFY=true keeps TLS but skips verification', () => {
    process.env.RDS_SSL_NO_VERIFY = 'true';
    expect(sslConfig()).toEqual({ rejectUnauthorized: false });
  });
});

// pg-mem portability gate. Dev and test run an in-memory Postgres (pg-mem, see
// db.ts createPool), and the achievement counters lean on SQL features that a
// re-implementation can plausibly lack: multi-row VALUES with ON CONFLICT DO
// UPDATE referencing EXCLUDED, RETURNING on an upsert, and quoted camelCase
// aliases. AchievementService relies on all of them being atomic — there is no
// JS read-modify-write to fall back on — so lock the behavior here rather than
// discover a divergence through a wrong counter in local dev.
describe('pg-mem support for the achievement SQL', () => {
  const USER = '11111111-1111-1111-1111-111111111111';
  let pool: Pool;

  beforeEach(async () => {
    const { Pool: MemPool } = newDb().adapters.createPg();
    pool = new MemPool() as Pool;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS achievement (
        userId UUID, achievementId text, appId UUID,
        unlockedTimestamp timestamp default CURRENT_TIMESTAMP,
        PRIMARY KEY (userId, achievementId))`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_counter (
        userId UUID, counter text, value bigint default 0,
        updatedTimestamp timestamp default CURRENT_TIMESTAMP,
        PRIMARY KEY (userId, counter))`);
  });

  const bump = (
    counter: string,
    delta: number,
    counter2: string,
    delta2: number
  ) =>
    pool.query({
      text: `INSERT INTO user_counter(userId, counter, value) VALUES ($1,$2,$3),($1,$4,$5)
             ON CONFLICT (userId, counter)
             DO UPDATE SET value = user_counter.value + EXCLUDED.value,
                           updatedTimestamp = CURRENT_TIMESTAMP
             RETURNING counter, value`,
      values: [USER, counter, delta, counter2, delta2],
    });

  it('upserts multiple counters in one statement and returns the new totals', async () => {
    const first = await bump('shotsFired', 10, 'kills', 1);
    expect(
      Object.fromEntries(first.rows.map((r) => [r.counter, Number(r.value)]))
    ).toEqual({ shotsFired: 10, kills: 1 });
  });

  it('accumulates on conflict rather than replacing — the core counter contract', async () => {
    await bump('shotsFired', 10, 'kills', 1);
    const second = await bump('shotsFired', 5, 'kills', 2);
    expect(
      Object.fromEntries(second.rows.map((r) => [r.counter, Number(r.value)]))
    ).toEqual({ shotsFired: 15, kills: 3 });
  });

  it('honors ON CONFLICT DO NOTHING: a re-unlock stores no duplicate', async () => {
    const insert = (ids: string[]) =>
      pool.query({
        text: `INSERT INTO achievement(userId, achievementId) VALUES ${ids
          .map((_, i) => `($1,$${i + 2})`)
          .join(',')}
               ON CONFLICT (userId, achievementId) DO NOTHING
               RETURNING achievementId as "achievementId"`,
        values: [USER, ...ids],
      });
    await insert(['first-kill']);
    await insert(['first-kill', 'shots-1000']);

    const all = await pool.query('SELECT achievementId FROM achievement');
    expect(all.rows).toHaveLength(2);
    // The badge is unlocked once and stays that way: passing an already-held id is
    // a no-op, which is what lets the evaluator send the full eligible list every
    // time instead of diffing against what's already stored.
    const dupes = await pool.query({
      text: 'SELECT count(*) as c FROM achievement WHERE achievementId = $1',
      values: ['first-kill'],
    });
    expect(Number(dupes.rows[0].c)).toBe(1);
  });

  it('supports quoted camelCase aliases (pg lowercases bare identifiers)', async () => {
    await pool.query({
      text: 'INSERT INTO achievement(userId, achievementId, appId) VALUES ($1,$2,$3)',
      values: [USER, 'ladder-flawless', USER],
    });
    const res = await pool.query({
      text: 'SELECT achievementId as "achievementId", appId as "appId" FROM achievement WHERE userId = $1',
      values: [USER],
    });
    expect(res.rows[0]).toMatchObject({
      achievementId: 'ladder-flawless',
      appId: USER,
    });
  });

  // KNOWN DIVERGENCE, asserted so it's a documented fact rather than a surprise:
  // real Postgres returns only rows it actually inserted, but pg-mem's RETURNING
  // also includes the conflicting rows it skipped. The stored data is still right
  // (the test above proves DO NOTHING is honored), so this only makes
  // AchievementService.unlock's "newly unlocked" list over-report in local dev.
  // Nothing user-visible is built on it. If that ever changes — a notification, an
  // email — this test is where you'll find out it can't be trusted on pg-mem.
  it('over-reports RETURNING on DO NOTHING (pg-mem quirk, real PG does not)', async () => {
    const insert = (ids: string[]) =>
      pool.query({
        text: `INSERT INTO achievement(userId, achievementId) VALUES ${ids
          .map((_, i) => `($1,$${i + 2})`)
          .join(',')}
               ON CONFLICT (userId, achievementId) DO NOTHING
               RETURNING achievementId as "achievementId"`,
        values: [USER, ...ids],
      });
    await insert(['first-kill']);
    const again = await insert(['first-kill', 'shots-1000']);
    expect(again.rows.map((r) => r.achievementId)).toEqual([
      'first-kill', // real Postgres would omit this — it was not inserted
      'shots-1000',
    ]);
  });
});
