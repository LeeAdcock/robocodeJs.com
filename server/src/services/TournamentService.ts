import { randomUUID } from 'node:crypto';
import pool from '../util/db';
import { UserId } from '../types/user';
import type { BoardRow } from './AppService';

// Personal tournaments: a named, shareable *view* over the global Elo ladder
// (GitHub #119). A tournament plays no matches of its own — its board is the
// global ratings filtered to the apps of the users who have joined it (see
// AppService.getLeaderboard's `tournamentId` option). So joining costs the
// ladder nothing, and a member's rating in a tournament is by construction their
// rating everywhere.
//
// Membership is per USER, not per app: joining brings in every rated app the
// member owns, including ones they write later, and leaving takes them all out.
//
// Tournaments are unlisted rather than private: anyone holding the id/link can
// view the board (a spectating surface, like /watch), and joining needs sign-in.
//
// The creator can shape how the board reads (GitHub #119 follow-up) — see
// TournamentSettings. Every rule's column defaults to "off" (NULL / false /
// 'bots'), so a tournament made before the columns existed is unchanged.
// `finalBoard` is the frozen standings once `endsAt` has passed (JSON of
// BoardRow[], written once by the first board read after the deadline).
//
// Same lazy-DDL idiom as the other services (see the accepted "lazy DDL startup"
// risk in CLAUDE.md); Promise.resolve tolerates a mocked pool.query. The member
// table and the settings backfill are chained off the tournament table so the
// order is fixed; the backfill is a no-op where the CREATE already added the
// columns (fresh pg-mem in dev/test) and is last so an engine that lacks
// `ADD COLUMN IF NOT EXISTS` can't take the member table down with it.
Promise.resolve(
  pool.query(`
    CREATE TABLE IF NOT EXISTS tournament (
      id UUID PRIMARY KEY,
      name text,
      ownerUserId UUID,
      maxAppsPerMember integer,
      maxEntries integer,
      minGames integer,
      rankBy text default 'bots',
      hideOwners boolean default false,
      publicOnly boolean default false,
      joinLocked boolean default false,
      endsAt timestamp,
      editedSince timestamp,
      finalBoard text,
      createdTimestamp timestamp default CURRENT_TIMESTAMP
    )
  `)
)
  .then(() =>
    pool.query(`
      CREATE TABLE IF NOT EXISTS tournament_member (
        tournamentId UUID,
        userId UUID,
        joinedTimestamp timestamp default CURRENT_TIMESTAMP,
        PRIMARY KEY (tournamentId, userId)
      )
    `)
  )
  .then(() =>
    pool.query(`
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS maxAppsPerMember integer;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS maxEntries integer;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS minGames integer;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS rankBy text default 'bots';
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS hideOwners boolean default false;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS publicOnly boolean default false;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS joinLocked boolean default false;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS endsAt timestamp;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS editedSince timestamp;
      ALTER TABLE tournament ADD COLUMN IF NOT EXISTS finalBoard text;
    `)
  )
  .catch(() => undefined);

// How many users may join one tournament. Bounds the board query (each member
// brings up to MAX_APPS_PER_USER apps) and the member list in the response.
export const MAX_TOURNAMENT_MEMBERS = Number(
  process.env.MAX_TOURNAMENT_MEMBERS ?? 100
);

// The creator-set board rules. Each defaults to "off": `null` for a limit or a
// date, `false` for a switch, 'bots' for the ranking mode.
export interface TournamentSettings {
  // Show at most this many bots per member — their highest-rated ones.
  maxAppsPerMember: number | null;
  // Show at most this many rows on the board.
  maxEntries: number | null;
  // Hide bots with fewer ranked games than this (a fresh rating is noise).
  minGames: number | null;
  // 'members' ranks players — one row per member, their best bot — instead of
  // every bot (it is a per-member cap of 1 with a player-first table).
  rankBy: 'bots' | 'members';
  // Leave owner names off the board (classroom privacy).
  hideOwners: boolean;
  // Show only bots whose source is public (a code-reading exercise).
  publicOnly: boolean;
  // Close the roster: no one can join until it is reopened.
  joinLocked: boolean;
  // When the tournament ends. The first board read after this instant stores
  // the standings as final, and the board stops moving.
  endsAt: Date | null;
  // Count only bots edited at or after this instant (so pre-existing bots don't
  // count toward work done during the tournament).
  editedSince: Date | null;
}

export const DEFAULT_SETTINGS: TournamentSettings = {
  maxAppsPerMember: null,
  maxEntries: null,
  minGames: null,
  rankBy: 'bots',
  hideOwners: false,
  publicOnly: false,
  joinLocked: false,
  endsAt: null,
  editedSince: null,
};

export interface Tournament extends TournamentSettings {
  id: string;
  name: string;
  ownerUserId: UserId;
  createdTimestamp: Date;
  // The frozen standings, present once the board has been read after `endsAt`.
  finalBoard: BoardRow[] | null;
}

// Has the tournament's end date passed? (No end date = never.)
export const hasEnded = (t: Tournament, now = new Date()): boolean =>
  t.endsAt !== null && t.endsAt.getTime() <= now.getTime();

// A tournament as seen by one user in their own list: the ones they created or
// joined.
export interface TournamentSummary {
  id: string;
  name: string;
  isOwner: boolean;
  joined: boolean;
  memberCount: number;
}

export interface TournamentMember {
  userId: UserId;
  name: string | null;
}

const toDate = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(v as string | Date);

const parseFinalBoard = (v: unknown): BoardRow[] | null => {
  if (typeof v !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as BoardRow[]) : null;
  } catch {
    return null;
  }
};

const toTournament = (row: Record<string, unknown>): Tournament => ({
  id: row.id as string,
  name: (row.name as string | null) ?? 'Tournament',
  ownerUserId: row.ownerUserId as UserId,
  maxAppsPerMember: (row.maxAppsPerMember as number | null) ?? null,
  maxEntries: (row.maxEntries as number | null) ?? null,
  minGames: (row.minGames as number | null) ?? null,
  rankBy: row.rankBy === 'members' ? 'members' : 'bots',
  hideOwners: (row.hideOwners as boolean | null) ?? false,
  publicOnly: (row.publicOnly as boolean | null) ?? false,
  joinLocked: (row.joinLocked as boolean | null) ?? false,
  endsAt: toDate(row.endsAt),
  editedSince: toDate(row.editedSince),
  finalBoard: parseFinalBoard(row.finalBoard),
  createdTimestamp: new Date(row.createdTimestamp as string | Date),
});

const TOURNAMENT_COLUMNS = `id, name, ownerUserId as "ownerUserId",
  maxAppsPerMember as "maxAppsPerMember", maxEntries as "maxEntries", minGames as "minGames",
  rankBy as "rankBy", hideOwners as "hideOwners", publicOnly as "publicOnly", joinLocked as "joinLocked",
  endsAt as "endsAt", editedSince as "editedSince", finalBoard as "finalBoard",
  createdTimestamp as "createdTimestamp"`;

export type JoinResult = 'joined' | 'already' | 'full';

class TournamentService {
  create = async (ownerUserId: UserId, name: string): Promise<Tournament> => {
    const id = randomUUID();
    await pool.query({
      text: 'INSERT INTO tournament(id, name, ownerUserId) VALUES($1, $2, $3)',
      values: [id, name, ownerUserId],
    });
    // The creator is a member from the start: making a tournament and then
    // having to join it is a step nobody wants. They can still leave.
    await this.join(id, ownerUserId);
    return (await this.get(id)) as Tournament;
  };

  get = async (id: string): Promise<Tournament | undefined> => {
    const res = await pool.query({
      text: `SELECT ${TOURNAMENT_COLUMNS} FROM tournament WHERE id=$1`,
      values: [id],
    });
    return res.rows.length ? toTournament(res.rows[0]) : undefined;
  };

  countOwnedBy = async (userId: UserId): Promise<number> => {
    const res = await pool.query({
      text: 'SELECT id FROM tournament WHERE ownerUserId=$1',
      values: [userId],
    });
    return res.rows.length;
  };

  rename = async (id: string, name: string): Promise<void> => {
    await pool.query({
      text: 'UPDATE tournament SET name=$2 WHERE id=$1',
      values: [id, name],
    });
  };

  // Replace every board rule at once; the route merges a partial PATCH onto the
  // stored values first, so this never has to express "leave this one alone".
  // Moving or clearing the end date discards any final standings, so the board
  // goes live again (and will freeze afresh when the new date passes).
  updateSettings = async (
    id: string,
    settings: TournamentSettings,
    opts: { clearFinalBoard?: boolean } = {}
  ): Promise<void> => {
    await pool.query({
      text: `UPDATE tournament SET maxAppsPerMember=$2, maxEntries=$3, minGames=$4, rankBy=$5,
               hideOwners=$6, publicOnly=$7, joinLocked=$8, endsAt=$9, editedSince=$10
             WHERE id=$1`,
      values: [
        id,
        settings.maxAppsPerMember,
        settings.maxEntries,
        settings.minGames,
        settings.rankBy,
        settings.hideOwners,
        settings.publicOnly,
        settings.joinLocked,
        settings.endsAt,
        settings.editedSince,
      ],
    });
    if (opts.clearFinalBoard)
      await pool.query({
        text: 'UPDATE tournament SET finalBoard=NULL WHERE id=$1',
        values: [id],
      });
  };

  // Record the final standings. Write-once: two instances reading the board in
  // the same moment both compute it, but only the first write lands, so every
  // later read serves one agreed snapshot. Returns the rows now stored.
  setFinalBoard = async (id: string, rows: BoardRow[]): Promise<BoardRow[]> => {
    await pool.query({
      text: 'UPDATE tournament SET finalBoard=$2 WHERE id=$1 AND finalBoard IS NULL',
      values: [id, JSON.stringify(rows)],
    });
    return (await this.get(id))?.finalBoard ?? rows;
  };

  // Members first, so a failure part-way leaves a tournament with no members
  // (harmless, still deletable) rather than orphaned member rows.
  delete = async (id: string): Promise<void> => {
    await pool.query({
      text: 'DELETE FROM tournament_member WHERE tournamentId=$1',
      values: [id],
    });
    await pool.query({
      text: 'DELETE FROM tournament WHERE id=$1',
      values: [id],
    });
  };

  // Idempotent: joining twice is 'already', not an error, so a double-click or a
  // re-opened join link is harmless. The member cap is check-then-act; two joins
  // racing past it overshoot by one, which only matters as a soft bound.
  join = async (id: string, userId: UserId): Promise<JoinResult> => {
    if (await this.isMember(id, userId)) return 'already';
    if ((await this.memberCount(id)) >= MAX_TOURNAMENT_MEMBERS) return 'full';
    await pool.query({
      text: 'INSERT INTO tournament_member(tournamentId, userId) VALUES($1, $2) ON CONFLICT DO NOTHING',
      values: [id, userId],
    });
    return 'joined';
  };

  leave = async (id: string, userId: UserId): Promise<void> => {
    await pool.query({
      text: 'DELETE FROM tournament_member WHERE tournamentId=$1 AND userId=$2',
      values: [id, userId],
    });
  };

  isMember = async (id: string, userId: UserId): Promise<boolean> => {
    const res = await pool.query({
      text: 'SELECT userId FROM tournament_member WHERE tournamentId=$1 AND userId=$2',
      values: [id, userId],
    });
    return res.rows.length > 0;
  };

  memberCount = async (id: string): Promise<number> => {
    const res = await pool.query({
      text: 'SELECT userId FROM tournament_member WHERE tournamentId=$1',
      values: [id],
    });
    return res.rows.length;
  };

  // Members with their account display names, earliest joiner first. The caller
  // abbreviates/filters names before anything public sees them.
  members = async (id: string): Promise<TournamentMember[]> => {
    const res = await pool.query({
      text: `SELECT tm.userId as "userId", account.name as "name"
             FROM tournament_member tm JOIN account ON account.id = tm.userId
             WHERE tm.tournamentId=$1
             ORDER BY tm.joinedTimestamp ASC`,
      values: [id],
    });
    return res.rows.map((row) => ({
      userId: row.userId as UserId,
      name: (row.name as string | null) ?? null,
    }));
  };

  // The tournaments a user created or joined, newest first. Two small queries
  // folded in JS rather than one aggregate (no GROUP BY / window functions, the
  // same portability choice the leaderboard makes for pg-mem).
  listForUser = async (userId: UserId): Promise<TournamentSummary[]> => {
    const res = await pool.query({
      text: `SELECT DISTINCT t.id, t.name, t.ownerUserId as "ownerUserId", t.createdTimestamp as "createdTimestamp"
             FROM tournament t
             LEFT JOIN tournament_member tm ON tm.tournamentId = t.id AND tm.userId = $1
             WHERE t.ownerUserId = $1 OR tm.userId = $1
             ORDER BY t.createdTimestamp DESC`,
      values: [userId],
    });
    const summaries: TournamentSummary[] = [];
    for (const row of res.rows) {
      const t = toTournament(row);
      const members = await pool.query({
        text: 'SELECT userId as "userId" FROM tournament_member WHERE tournamentId=$1',
        values: [t.id],
      });
      summaries.push({
        id: t.id,
        name: t.name,
        isOwner: t.ownerUserId === userId,
        joined: members.rows.some((m) => m.userId === userId),
        memberCount: members.rows.length,
      });
    }
    return summaries;
  };
}

export default new TournamentService();
