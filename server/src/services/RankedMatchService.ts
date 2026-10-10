import { randomUUID } from 'node:crypto';
import pool from '../util/db';
import { AppId } from '../types/app';

// One recorded global-ladder match (GitHub #151): who played, the pre-match
// ratings, the signed rating deltas, the winning app (null if the match timed
// out undecided), and the seed used. Kept as a short rolling audit trail (see
// deleteOlderThan); the live ratings themselves live on the `app` row, so
// pruning this table loses no rankings.
// Index createdTimestamp: BOTH readers filter on it — the leaderboard "movement"
// query (deltasSince) on every request, and the retention sweep
// (deleteOlderThan) — so an index keeps them off a full-table seq scan.
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

  // Drop rows older than `cutoff`, returning how many went. The ladder appends
  // one row per match and nothing ever read the far history, so without this the
  // table grew linearly forever (~4,500 rows/day in prod on 2026-10-10) and its
  // index with it — the most plausible driver of the steady RDS FreeableMemory
  // decline that tripped robocodejs-rds-freeable-memory on 2026-10-09. The only
  // programmatic reader is deltasSince, which looks back 24h
  // (AppService's MOVEMENT_WINDOW_MS), so anything past the retention window is
  // unreferenced. This bounds the table at steady state rather than shrinking
  // it: DELETE leaves the freed pages for the next INSERT to reuse, which is
  // exactly what we want for a table that is written continuously.
  //
  // Capped at `batchSize` rows per call so clearing a large accumulated backlog
  // is spread over several small transactions instead of one long one — a single
  // DELETE of the whole history would burst WAL and leave one huge autovacuum
  // pass on an instance already short of memory. The caller re-invokes until a
  // call comes back short. (pg-mem, used only for local dev, ignores the LIMIT
  // and deletes every matching row in one go; harmless, since a dev database
  // holds almost no history and resets on restart.)
  //
  // `rowCount` is defensively coalesced because a mocked/pg-mem pool.query may
  // not report one (same tolerance as the lazy DDL above).
  deleteOlderThan = (cutoff: Date, batchSize: number): Promise<number> => {
    return pool
      .query({
        text:
          'DELETE FROM ranked_match WHERE id IN ' +
          '(SELECT id FROM ranked_match WHERE createdTimestamp < $1 LIMIT $2)',
        values: [cutoff, batchSize],
      })
      .then((res) => res?.rowCount ?? 0);
  };

  // Every match this app played since `since`, as (opponent, when) pairs — the
  // raw input to LadderService's per-pair saturation cap. One query per anchor
  // instead of one per candidate pair, folded per opponent in JS (the same
  // portability choice getLeaderboard makes: no GROUP BY, no window function,
  // works under pg-mem).
  //
  // `appA`/`appB` record the order the match ran in, which is arbitrary, so both
  // orientations have to be matched and the opponent picked from whichever
  // column isn't this app.
  matchesForApp = (
    appId: AppId,
    since: Date
  ): Promise<{ opponentId: AppId; at: Date }[]> => {
    return pool
      .query({
        text:
          'SELECT appA, appB, createdTimestamp FROM ranked_match ' +
          'WHERE (appA=$1 OR appB=$1) AND createdTimestamp > $2',
        values: [appId, since],
      })
      .then((res) =>
        (res?.rows ?? []).map((row) => ({
          opponentId: (row.appa === appId ? row.appb : row.appa) as AppId,
          // pg returns a Date, pg-mem an ISO string.
          at: new Date(row.createdtimestamp as string | Date),
        }))
      );
  };

  // Drop a pair's matches that predate `cutoff` (the later of the two apps' last
  // edits), so what remains for the pair is exactly the head-to-head record
  // between their CURRENT versions — which is also what the saturation cap
  // counts. Called right after recording a match, so a pair is tidied on the
  // first match after either side changes; see LadderService.
  deleteStaleForPair = (
    appA: AppId,
    appB: AppId,
    cutoff: Date
  ): Promise<number> => {
    return pool
      .query({
        text:
          'DELETE FROM ranked_match WHERE ' +
          '((appA=$1 AND appB=$2) OR (appA=$2 AND appB=$1)) ' +
          'AND createdTimestamp < $3',
        values: [appA, appB, cutoff],
      })
      .then((res) => res?.rowCount ?? 0);
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
