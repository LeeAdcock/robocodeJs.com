import { UserId, DEMO_USER_ID } from '../types/user';
import App, { AppId } from '../types/app';
import pool from '../util/db';
import { randomUUID } from 'node:crypto';
import { DEFAULT_RATING } from '../util/elo';
import { abbreviateName } from '../util/displayName';
import { sanitizeBotName } from '../util/botName';
import { isNameProfane } from '../util/nameFilter';

// A single app eligible for global-ladder matchmaking, with just the fields the
// selector needs (see AppService.getLadderCandidates).
export interface LadderCandidate {
  appId: AppId;
  userId: UserId;
  rating: number;
  ratingGames: number;
  source: string;
}

// One row of the public global-ladder leaderboard (see getLeaderboard). Wire
// shape mirrored by the UI (ui/src/types/leaderboardEntry.ts). No source.
export interface LeaderboardEntry {
  rank: number;
  appId: AppId;
  name: string;
  ownerName: string;
  rating: number;
  games: number;
  wins: number;
  winRate: number;
}

pool.query(`
  CREATE TABLE IF NOT EXISTS app (
    id UUID,
    userId UUID,
    source text default '',
    name text,
    deleted boolean default false,
    rating real default 1500,
    ratingGames integer default 0,
    ratingWins integer default 0,
    lastRankedAt timestamp,
    broken boolean default false,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    updatedTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`);
// Backfill the global-ladder columns (GitHub #151) on databases whose `app`
// table predates them. No-ops where the CREATE above already added them (fresh
// pg-mem in dev/test). Wrapped like ArenaMemberService so a mocked pool.query is
// safe and an engine lacking `ADD COLUMN IF NOT EXISTS` can't crash boot.
Promise.resolve(
  pool.query(`
    ALTER TABLE app ADD COLUMN IF NOT EXISTS rating real default 1500;
    ALTER TABLE app ADD COLUMN IF NOT EXISTS ratingGames integer default 0;
    ALTER TABLE app ADD COLUMN IF NOT EXISTS ratingWins integer default 0;
    ALTER TABLE app ADD COLUMN IF NOT EXISTS lastRankedAt timestamp;
    ALTER TABLE app ADD COLUMN IF NOT EXISTS broken boolean default false;
  `)
).catch(() => undefined);

export class AppService {
  create = (userId: UserId): Promise<App> => {
    const appId = randomUUID();
    const app = new App(appId, userId);
    return pool
      .query({
        // Insert an empty-string source rather than leaving it NULL: a NULL
        // source reads back as an empty bot before setSource lands and is a
        // foot-gun for any consumer that assumes a string (get_app_source, the
        // compiler, the editor). See App.hydrate for the read-side guard.
        text: 'INSERT INTO app(id, userId, name, source) VALUES($1, $2, $3, $4)',
        values: [app.getId(), app.getUserId(), app.getName(), app.getSource()],
      })
      .then(() => Promise.resolve(app));
  };

  get = (appId: AppId): Promise<App | undefined> => {
    return pool
      .query({
        text: 'SELECT app.userId as "userId", app.name as "name", app.source as "source", app.rating as "rating", app.ratingGames as "ratingGames", app.ratingWins as "ratingWins", app.broken as "broken" FROM app WHERE id=$1 AND NOT deleted',
        values: [appId],
      })
      .then((res) => {
        if (res.rowCount === 0) return undefined;
        const row = res.rows[0];
        return new App(appId, row.userId).hydrate(row.name, row.source, {
          rating: row.rating,
          ratingGames: row.ratingGames,
          ratingWins: row.ratingWins,
          broken: row.broken,
        });
      });
  };

  // Global-ladder leaderboard rows (GitHub #151): the top `limit` rated apps by
  // Elo, joined to their owner's display name. Only apps that have actually
  // played a ranked game appear (ratingGames > 0), so never-played 1500 defaults
  // and untouched starters don't clutter the board; broken/deleted apps are
  // excluded. Public — exposes only name/owner/rating/record, never source.
  //
  // Each owner is capped at MAX_APPS_PER_OWNER_ON_BOARD rows so one prolific
  // player can't fill the board. The cap is applied in JS (portable — no window
  // function needed) over a wider scan than we display: LEADERBOARD_SCAN_LIMIT.
  // That ceiling is provably sufficient — with MAX_APPS_PER_USER (20) and a
  // 3-per-owner cap, filling a 20-row board scans well under it — so it never
  // truncates the visible board in practice.
  getLeaderboard = (limit = 20): Promise<LeaderboardEntry[]> => {
    const MAX_APPS_PER_OWNER_ON_BOARD = 3;
    const LEADERBOARD_SCAN_LIMIT = 500;
    return pool
      .query({
        text: `SELECT app.id as "appId", app.userId as "ownerUserId", app.name as "name", account.name as "ownerName",
                      app.rating as "rating", app.ratingGames as "ratingGames", app.ratingWins as "ratingWins"
               FROM app JOIN account ON account.id = app.userId
               WHERE NOT app.deleted
                 AND NOT COALESCE(app.broken, false)
                 AND COALESCE(app.ratingGames, 0) > 0
                 AND app.userId <> $2
               ORDER BY app.rating DESC, app.ratingGames DESC
               LIMIT $1`,
        values: [LEADERBOARD_SCAN_LIMIT, DEMO_USER_ID],
      })
      .then((res) => {
        const perOwner = new Map<string, number>();
        const entries: LeaderboardEntry[] = [];
        for (const row of res.rows) {
          if (entries.length >= limit) break;
          const ownerId = row.ownerUserId as string;
          const count = perOwner.get(ownerId) ?? 0;
          // Skip an owner's 4th+ bot so a single player can't dominate.
          if (count >= MAX_APPS_PER_OWNER_ON_BOARD) continue;
          perOwner.set(ownerId, count + 1);

          const games = (row.ratingGames as number | null) ?? 0;
          const wins = (row.ratingWins as number | null) ?? 0;
          // The owner name comes from Google (account.name); apply the same
          // precautions bot names get before showing it publicly. We can't
          // reject a sign-in, so a profane owner name falls back to Anonymous
          // (their real name is untouched elsewhere, e.g. their own avatar).
          const owner = sanitizeBotName(row.ownerName as string | null);
          entries.push({
            rank: entries.length + 1,
            appId: row.appId as AppId,
            name: (row.name as string | null) ?? 'Unnamed',
            // Abbreviate to "First L." so the public endpoint never exposes a
            // full surname.
            ownerName: isNameProfane(owner)
              ? 'Anonymous'
              : abbreviateName(owner),
            rating: Math.round((row.rating as number | null) ?? DEFAULT_RATING),
            games,
            wins,
            winRate: games > 0 ? wins / games : 0,
          });
        }
        return entries;
      });
  };

  // Lightweight rows for global-ladder matchmaking (GitHub #151): every app
  // eligible to be picked for a ranked match. Eligibility (all must hold):
  //   - not deleted, not flagged broken (a prior compile/crash failure)
  //   - non-empty source
  //   - edited within the last 3 months (updatedTimestamp)
  //   - owner active within the last 3 months (account.lastActiveAt, falling
  //     back to createdTimestamp so pre-tracking accounts get a grace period)
  //   - not owned by the demo user (its bots aren't real competitors)
  // Untouched starter bots are filtered out by the caller (source comparison),
  // which SQL can't do cleanly. Returns `source` so that filter can run.
  getLadderCandidates = (): Promise<LadderCandidate[]> => {
    return pool
      .query({
        text: `SELECT app.id as "appId", app.userId as "userId", app.rating as "rating", app.ratingGames as "ratingGames", app.source as "source"
               FROM app JOIN account ON account.id = app.userId
               WHERE NOT app.deleted
                 AND NOT COALESCE(app.broken, false)
                 AND COALESCE(app.source, '') <> ''
                 AND app.updatedTimestamp >= CURRENT_TIMESTAMP - interval '3 months'
                 AND COALESCE(account.lastActiveAt, account.createdTimestamp) >= CURRENT_TIMESTAMP - interval '3 months'
                 AND app.userId <> $1`,
        values: [DEMO_USER_ID],
      })
      .then((res) =>
        res.rows.map((row) => ({
          appId: row.appId as AppId,
          userId: row.userId as UserId,
          rating: (row.rating as number | null) ?? DEFAULT_RATING,
          ratingGames: (row.ratingGames as number | null) ?? 0,
          source: (row.source as string | null) ?? '',
        }))
      );
  };

  getForUser = (userId: UserId): Promise<App[]> => {
    return pool
      .query({
        text: 'SELECT app.id as "appId", app.name as "name", app.source as "source", app.rating as "rating", app.ratingGames as "ratingGames", app.ratingWins as "ratingWins", app.broken as "broken" FROM app WHERE userId=$1 AND NOT deleted ORDER BY app.id',
        values: [userId],
      })
      .then((res) =>
        res.rows.map((row) =>
          new App(row.appId, userId).hydrate(row.name, row.source, {
            rating: row.rating,
            ratingGames: row.ratingGames,
            ratingWins: row.ratingWins,
            broken: row.broken,
          })
        )
      );
  };
}

export default new AppService();
