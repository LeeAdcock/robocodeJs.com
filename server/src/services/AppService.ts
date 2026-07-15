import { UserId, DEMO_USER_ID } from '../types/user';
import App, { AppId } from '../types/app';
import pool from '../util/db';
import { randomUUID } from 'node:crypto';
import { DEFAULT_RATING } from '../util/elo';
import { abbreviateName } from '../util/displayName';
import { sanitizeBotName } from '../util/botName';
import { isNameProfane } from '../util/nameFilter';
import rankedMatchService from './RankedMatchService';

// Tank sprite color names, mirroring the UI palette (ui/src/util/colors.ts;
// sprites at ui/public/sprites/tank_<color>.png). The leaderboard derives each
// row's color from its app id and returns only the color, so the wire value is
// a self-evident sprite color, never an identifier.
const LEADERBOARD_PALETTE = ['sand', 'blue', 'red', 'dark', 'green'] as const;

// Deterministic char-rolling hash so a given app id always maps to the same
// palette color (matching the arena/roster visual language). Only the resulting
// color leaves the server — the app id and hash stay internal.
const colorForAppId = (appId: string): string => {
  let h = 0;
  for (let i = 0; i < appId.length; i++)
    h = (h * 31 + appId.charCodeAt(i)) >>> 0;
  return LEADERBOARD_PALETTE[h % LEADERBOARD_PALETTE.length];
};

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
//
// `color` is the tank sprite color for the row (derived from the real app id),
// present on EVERY row — the UI renders it directly and never learns the real
// id. `appId` is the REAL app id and is present ONLY on rows the viewer owns
// (undefined otherwise), so the board never leaks other users' app ids while
// the viewer can still recognize and act on their own bots.
export interface LeaderboardEntry {
  rank: number;
  color: string;
  appId?: AppId;
  name: string;
  ownerName: string;
  rating: number;
  games: number;
  wins: number;
  winRate: number;
  // The app's rank on the board as it stood ~24h ago, reconstructed by rewinding
  // its rating by the deltas it earned since then (see getLeaderboard). The UI
  // renders an up/down movement arrow from `previousRank` vs `rank`. Omitted when
  // the app wasn't on the board 24h ago (a new entrant), which the UI marks as new.
  previousRank?: number;
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
  getLeaderboard = async (
    limit = 20,
    viewerUserId?: UserId
  ): Promise<LeaderboardEntry[]> => {
    const MAX_APPS_PER_OWNER_ON_BOARD = 3;
    const LEADERBOARD_SCAN_LIMIT = 500;
    // How far back "movement" looks: the up/down arrow compares each app's
    // current rank to where it stood this long ago. A rolling day is stable
    // enough to be meaningful (vs. per-match jitter) yet fresh for daily movers.
    const MOVEMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

    const res = await pool.query({
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
    });

    // Reconstruct the board as of MOVEMENT_WINDOW_MS ago: rewind each app's
    // rating by the deltas it earned inside the window, then re-rank with the
    // same sort + owner cap so the two ranks are on a comparable scale. Derived
    // from ranked_match history (no rank is persisted), so it needs no schema.
    const cutoff = new Date(Date.now() - MOVEMENT_WINDOW_MS);
    const windowDeltas = await rankedMatchService.deltasSince(cutoff);
    // appId -> { sumDelta, matches } over the window. `matches` (one delta row
    // per match the app played) rewinds ratingGames so an app that first crossed
    // the ratingGames > 0 threshold inside the window reads as a new entrant.
    const rewind = new Map<string, { sumDelta: number; matches: number }>();
    for (const d of windowDeltas) {
      const acc = rewind.get(d.appId) ?? { sumDelta: 0, matches: 0 };
      acc.sumDelta += d.delta;
      acc.matches += 1;
      rewind.set(d.appId, acc);
    }

    // Build the previous ordering from the same candidate rows, using each app's
    // rating/games as of the cutoff. Apps that hadn't yet played a ranked game
    // then (prevGames <= 0) simply don't appear — they get no previousRank.
    const previousRankByApp = new Map<string, number>();
    const prevOrdered = res.rows
      .map((row) => {
        const w = rewind.get(row.appId as string);
        const currentRating = (row.rating as number | null) ?? DEFAULT_RATING;
        const currentGames = (row.ratingGames as number | null) ?? 0;
        return {
          appId: row.appId as string,
          ownerId: row.ownerUserId as string,
          prevRating: currentRating - (w?.sumDelta ?? 0),
          prevGames: currentGames - (w?.matches ?? 0),
        };
      })
      .filter((r) => r.prevGames > 0)
      .sort((a, b) =>
        b.prevRating !== a.prevRating
          ? b.prevRating - a.prevRating
          : b.prevGames - a.prevGames
      );
    const prevPerOwner = new Map<string, number>();
    for (const r of prevOrdered) {
      const count = prevPerOwner.get(r.ownerId) ?? 0;
      if (count >= MAX_APPS_PER_OWNER_ON_BOARD) continue;
      prevPerOwner.set(r.ownerId, count + 1);
      // Rank across the full ordering (not truncated to `limit`) so a bot that
      // climbed from, say, #34 into the visible board still shows real movement.
      previousRankByApp.set(r.appId, previousRankByApp.size + 1);
    }

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
        // Sprite color for every row, derived from the app id (the id itself
        // never leaves the server).
        color: colorForAppId(row.appId as string),
        // Real app id ONLY on the viewer's own rows; omitted for others so
        // the public board never leaks foreign app ids.
        appId: ownerId === viewerUserId ? (row.appId as AppId) : undefined,
        name: (row.name as string | null) ?? 'Unnamed',
        // Abbreviate to "First L." so the public endpoint never exposes a
        // full surname.
        ownerName: isNameProfane(owner) ? 'Anonymous' : abbreviateName(owner),
        rating: Math.round((row.rating as number | null) ?? DEFAULT_RATING),
        games,
        wins,
        winRate: games > 0 ? wins / games : 0,
        // Where this app sat 24h ago; undefined for a new entrant (no game then).
        previousRank: previousRankByApp.get(row.appId as string),
      });
    }
    return entries;
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
