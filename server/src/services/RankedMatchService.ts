import { randomUUID } from 'node:crypto';
import pool from '../util/db';
import { AppId } from '../types/app';

// One recorded global-ladder match (GitHub #151): who played, the pre-match
// ratings, the signed rating deltas, the winning app (null if the match timed
// out undecided), and the seed used. Kept for audit and future leaderboard
// trend views; the live ratings themselves live on the `app` row.
// Index createdTimestamp: the leaderboard "movement" query (deltasSince) filters
// on it every request, and this table grows one row per ranked match forever, so
// an index keeps that scan off a full-table seq scan as history accumulates.
// Chained off the CREATE so the table exists first; Promise.resolve tolerates a
// mocked pool.query returning undefined, and errors are swallowed (same lazy-DDL
// idiom as the other services — see the accepted "lazy DDL startup" risk).
Promise.resolve(
  pool.query(`
    CREATE TABLE IF NOT EXISTS ranked_match (
      id UUID,
      appA UUID,
      appB UUID,
      winnerId UUID,
      ratingABefore real,
      ratingBBefore real,
      deltaA integer,
      deltaB integer,
      seed bigint,
      createdTimestamp timestamp default CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
  `)
)
  .then(() =>
    pool.query(
      'CREATE INDEX IF NOT EXISTS idx_ranked_match_created ON ranked_match(createdTimestamp)'
    )
  )
  .catch(() => undefined);

export interface RankedMatchRecord {
  appA: AppId;
  appB: AppId;
  winnerId: AppId | null;
  ratingABefore: number;
  ratingBBefore: number;
  deltaA: number;
  deltaB: number;
  seed: number;
}

// Raw both-sides rows for matches played since a cutoff. Each match yields two
// rows (one per participant) so a caller can fold them per app in JS — used to
// rewind ratings for the leaderboard "movement" arrows (rank change over a
// window). Kept as raw rows rather than a SQL GROUP BY to stay portable across
// pg-mem (dev/test) and Postgres.
export interface RankedMatchDelta {
  appId: AppId;
  delta: number;
}

class RankedMatchService {
  // Every per-app rating delta from RATED matches at or after `cutoff`. Folds
  // the two sides (appA/deltaA, appB/deltaB) of each match into one flat list;
  // the caller sums the deltas per app to rewind ratings AND counts the rows to
  // rewind ratingGames, so both must reflect only matches that actually moved a
  // rating. `winnerId IS NOT NULL` selects exactly those: the ladder records a
  // row for every match but leaves winnerId null (and deltas 0) for unrated ones
  // — timeouts and double-crashes — which never bumped ratingGames. Counting
  // those would understate an app's pre-window games and wrongly flag a busy,
  // crash-prone but long-established bot as a brand-new entrant. (Sudden death
  // forces a winner, so a rated draw with a null winnerId isn't produced.)
  deltasSince = (cutoff: Date): Promise<RankedMatchDelta[]> => {
    return pool
      .query({
        text: 'SELECT appA, appB, deltaA, deltaB FROM ranked_match WHERE createdTimestamp >= $1 AND winnerId IS NOT NULL',
        values: [cutoff],
      })
      .then((res) =>
        res.rows.flatMap((row) => [
          { appId: row.appa as AppId, delta: (row.deltaa as number) ?? 0 },
          { appId: row.appb as AppId, delta: (row.deltab as number) ?? 0 },
        ])
      );
  };

  record = (m: RankedMatchRecord): Promise<void> => {
    return pool
      .query({
        text: 'INSERT INTO ranked_match(id, appA, appB, winnerId, ratingABefore, ratingBBefore, deltaA, deltaB, seed) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        values: [
          randomUUID(),
          m.appA,
          m.appB,
          m.winnerId,
          m.ratingABefore,
          m.ratingBBefore,
          m.deltaA,
          m.deltaB,
          m.seed,
        ],
      })
      .then(() => undefined);
  };
}

export default new RankedMatchService();
