import { randomUUID } from 'node:crypto';
import pool from '../util/db';
import { UserId } from '../types/user';

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
// Same lazy-DDL idiom as the other services (see the accepted "lazy DDL startup"
// risk in CLAUDE.md); Promise.resolve tolerates a mocked pool.query. The member
// table is chained off the tournament table so the order is fixed.
Promise.resolve(
  pool.query(`
    CREATE TABLE IF NOT EXISTS tournament (
      id UUID PRIMARY KEY,
      name text,
      ownerUserId UUID,
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
  .catch(() => undefined);

// How many tournaments one user may create. Generous for a teacher running a few
// classes, small enough that the table can't be farmed.
export const MAX_TOURNAMENTS_PER_USER = Number(
  process.env.MAX_TOURNAMENTS_PER_USER ?? 10
);
// How many users may join one tournament. Bounds the board query (each member
// brings up to MAX_APPS_PER_USER apps) and the member list in the response.
export const MAX_TOURNAMENT_MEMBERS = Number(
  process.env.MAX_TOURNAMENT_MEMBERS ?? 100
);

export interface Tournament {
  id: string;
  name: string;
  ownerUserId: UserId;
  createdTimestamp: Date;
}

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

const toTournament = (row: Record<string, unknown>): Tournament => ({
  id: row.id as string,
  name: (row.name as string | null) ?? 'Tournament',
  ownerUserId: row.ownerUserId as UserId,
  createdTimestamp: new Date(row.createdTimestamp as string | Date),
});

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
      text: 'SELECT id, name, ownerUserId as "ownerUserId", createdTimestamp as "createdTimestamp" FROM tournament WHERE id=$1',
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
