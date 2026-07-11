import { randomUUID } from 'node:crypto';
import pool from '../util/db';
import { AppId } from '../types/app';

// One recorded global-ladder match (GitHub #151): who played, the pre-match
// ratings, the signed rating deltas, the winning app (null if the match timed
// out undecided), and the seed used. Kept for audit and future leaderboard
// trend views; the live ratings themselves live on the `app` row.
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
`);

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

class RankedMatchService {
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
