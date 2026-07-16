import pool from '../util/db';
import { UserId } from '../types/user';
import { AppId } from '../types/app';
import { CounterKey } from '../util/achievements';

// Persistence for achievements (GitHub #121): which badges a user has unlocked,
// and the lifetime counters that feed the cumulative ones.
//
// Two tables, both new, so this needs no migration (#142) to land:
//
//  achievement   one row per (user, badge). appId records WHICH app earned it —
//                populated only for ladder badges, where a single winning app is
//                genuinely responsible; NULL for counter badges (they accrue
//                across every app the user owns) and for account badges (not about
//                a bot at all). So a non-null appId always means "this bot did
//                this", never "this bot happened to be there" — safe to quote in a
//                dashboard or an announcement.
//
//  user_counter  key/value rather than a column per counter, so adding a counter
//                stays a catalog edit instead of an ALTER TABLE. `value` is bigint
//                because distanceTraveled accumulates fast.
//
// Both primary keys lead with userId, so the profile's `WHERE userId = $1` reads
// are covered by the PK — no extra index (unlike ranked_match, which indexes a
// non-PK column).
//
// Chained off the CREATE so the table exists first; Promise.resolve tolerates a
// mocked pool.query returning undefined, and errors are swallowed (the same lazy-DDL
// idiom as the other services — see the accepted "lazy DDL startup" risk).
Promise.resolve(
  pool.query(`
    CREATE TABLE IF NOT EXISTS achievement (
      userId UUID,
      achievementId text,
      appId UUID,
      unlockedTimestamp timestamp default CURRENT_TIMESTAMP,
      PRIMARY KEY (userId, achievementId)
    )
  `)
)
  .then(() =>
    pool.query(`
      CREATE TABLE IF NOT EXISTS user_counter (
        userId UUID,
        counter text,
        value bigint default 0,
        updatedTimestamp timestamp default CURRENT_TIMESTAMP,
        PRIMARY KEY (userId, counter)
      )
    `)
  )
  .catch(() => undefined);

// A badge to unlock, and the app that earned it (omitted when no single app did).
export interface AchievementUnlock {
  id: string;
  appId?: AppId | null;
}

export interface UnlockedAchievement {
  achievementId: string;
  appId: AppId | null;
  unlockedTimestamp: Date;
}

export type CounterTotals = Partial<Record<CounterKey, number>>;

class AchievementService {
  // Add each delta to the user's lifetime counters and return the POST-increment
  // totals, so the caller can test thresholds against a value that is already
  // durable.
  //
  // One statement, no read-modify-write in JS: `value = value + EXCLUDED.value`
  // makes concurrent callers correct by construction. That matters — LadderService's
  // inFlight set is keyed by appId (it guards the Elo update), NOT by user, so two
  // workers can hold two apps of the same user, and a user can have several arenas
  // ticking at once. Concurrent bumps for one user are expected, not exceptional.
  //
  // Deltas of zero or less are dropped: the counters are monotonic, so a bump is
  // only ever an increase, and an all-zero call costs no query at all.
  bump = async (
    userId: UserId,
    deltas: CounterTotals
  ): Promise<CounterTotals> => {
    const entries = (
      Object.entries(deltas) as [CounterKey, number | undefined][]
    ).filter(
      (e): e is [CounterKey, number] => typeof e[1] === 'number' && e[1] > 0
    );
    if (entries.length === 0) return {};

    const values: unknown[] = [userId];
    const tuples = entries.map(([counter, delta]) => {
      values.push(counter, delta);
      return `($1, $${values.length - 1}, $${values.length})`;
    });

    const res = await pool.query({
      text: `INSERT INTO user_counter(userId, counter, value) VALUES ${tuples.join(', ')}
             ON CONFLICT (userId, counter)
             DO UPDATE SET value = user_counter.value + EXCLUDED.value,
                           updatedTimestamp = CURRENT_TIMESTAMP
             RETURNING counter, value`,
      values,
    });
    return rowsToCounters(res.rows);
  };

  getCounters = (userId: UserId): Promise<CounterTotals> =>
    pool
      .query({
        text: 'SELECT counter, value FROM user_counter WHERE userId = $1',
        values: [userId],
      })
      .then((res) => rowsToCounters(res.rows));

  // Unlock every id, ignoring the ones already held, and return only those this
  // call actually inserted.
  //
  // Idempotent and race-free via ON CONFLICT DO NOTHING, so callers are free to
  // pass the full eligible list every time rather than diffing against what's
  // already unlocked — which removes a whole class of cache-staleness bug. A
  // conflicting row keeps its FIRST unlock (timestamp and earning app), which is
  // the correct semantic for a once-only badge.
  //
  // Caveat: on pg-mem (local dev only) RETURNING wrongly includes conflicting rows
  // that were NOT inserted, so the returned list over-reports there. The stored
  // data is still correct — pg-mem does honor DO NOTHING — and real Postgres
  // returns only inserted rows. Don't build anything user-visible on the return
  // value without accounting for that.
  unlock = async (
    userId: UserId,
    entries: AchievementUnlock[]
  ): Promise<string[]> => {
    if (entries.length === 0) return [];

    const values: unknown[] = [userId];
    const tuples = entries.map((entry) => {
      values.push(entry.id, entry.appId ?? null);
      return `($1, $${values.length - 1}, $${values.length})`;
    });

    const res = await pool.query({
      text: `INSERT INTO achievement(userId, achievementId, appId) VALUES ${tuples.join(', ')}
             ON CONFLICT (userId, achievementId) DO NOTHING
             RETURNING achievementId as "achievementId"`,
      values,
    });
    return res.rows.map((row) => row.achievementId as string);
  };

  getForUser = (userId: UserId): Promise<UnlockedAchievement[]> =>
    pool
      .query({
        text: `SELECT achievementId as "achievementId",
                      appId as "appId",
                      unlockedTimestamp as "unlockedTimestamp"
               FROM achievement WHERE userId = $1
               ORDER BY unlockedTimestamp`,
        values: [userId],
      })
      .then((res) =>
        res.rows.map((row) => ({
          achievementId: row.achievementId as string,
          appId: (row.appId as AppId | null) ?? null,
          unlockedTimestamp: row.unlockedTimestamp as Date,
        }))
      );
}

// `value` is a bigint: node-postgres hands it back as a STRING (it exceeds the
// safe integer range in principle), while pg-mem hands back a number. Number()
// normalizes both — the real totals stay far below 2^53.
const rowsToCounters = (
  rows: { counter: string; value: unknown }[]
): CounterTotals =>
  Object.fromEntries(
    rows.map((row) => [row.counter as CounterKey, Number(row.value)])
  ) as CounterTotals;

export default new AchievementService();
