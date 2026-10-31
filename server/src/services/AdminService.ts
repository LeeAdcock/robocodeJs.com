import pool from '../util/db';
import { DEMO_USER_ID, UserId } from '../types/user';
import { STARTER_SOURCES } from '../util/starterBots';

// Read-only queries behind the admin control panel (GitHub #469). Everything
// here reports on the whole platform from the database, so it is global across
// instances, unlike the in-memory arena state.
//
// Rules every query here follows:
// - **No secrets or source leave this file.** App source is only ever compared
//   in SQL (against the starter seeds, or the empty string) and comes back as a
//   boolean, never as text. Token hashes and OAuth client secrets are never
//   selected; a client's display name is picked out of its info JSON here.
// - **The demo account is excluded.** It's the shared anonymous /api/demo user,
//   not a person, and would skew every count.
// - **pg-mem portable**: plain COUNT / SUM(CASE…) / GROUP BY. No FILTER, window
//   functions, length(), or `= ANY($1)`, none of which the dev/test database
//   supports. Bucketing and per-user folding happen in JS instead.
//
// The user list folds everything in JS rather than paginating in SQL, which
// is fine at the platform's current scale (hundreds of accounts). If accounts
// ever reach the tens of thousands, move search, sort and paging into SQL.

const DAY_MS = 24 * 60 * 60 * 1000;

// pg returns timestamps as Date, pg-mem as ISO strings; normalize to ISO.
const iso = (v: unknown): string | null =>
  v == null ? null : new Date(v as string | Date).toISOString();

const num = (v: unknown): number => Number(v ?? 0) || 0;

// SQL fragment testing whether a column holds an untouched starter's source,
// with its parameters numbered from `first`. Starter seeds are passed as
// parameters (never interpolated) and only the boolean comes back.
const starterTest = (
  column: string,
  first: number
): { sql: string; values: string[] } => {
  const values = [...STARTER_SOURCES];
  if (values.length === 0) return { sql: 'false', values };
  const params = values.map((_, i) => `$${first + i}`).join(', ');
  return { sql: `(${column} IN (${params}))`, values };
};

export interface AdminOverviewCounts {
  users: {
    total: number;
    signups: { day: number; week: number; month: number };
    active: { day: number; week: number; month: number };
  };
  apps: { total: number; updatedWeek: number };
  arenas: { total: number };
  mcp: { users: number };
}

export interface AdminUserRow {
  id: UserId;
  name: string | null;
  email: string | null;
  picture: string | null;
  createdTimestamp: string | null;
  lastActiveAt: string | null;
  apps: number;
  // Apps whose source is neither empty nor an untouched starter.
  editedApps: number;
  lastAppEdit: string | null;
  arenas: number;
  // Users holding a live MCP refresh token (signed in from an MCP client).
  mcpClients: number;
}

export interface AdminUserDetail {
  account: AdminUserRow;
  identities: { source: string; createdTimestamp: string | null }[];
  apps: {
    id: string;
    name: string | null;
    createdTimestamp: string | null;
    updatedTimestamp: string | null;
    rating: number;
    ratingGames: number;
    ratingWins: number;
    broken: boolean;
    starter: boolean;
    empty: boolean;
  }[];
  arenas: {
    id: string;
    createdTimestamp: string | null;
    members: number;
    enabledMembers: number;
  }[];
  achievements: { id: string; unlockedTimestamp: string | null }[];
  counters: Record<string, number>;
  tokens: {
    clientName: string | null;
    kind: string;
    createdTimestamp: string | null;
    expiresAt: string | null;
  }[];
}

// Every non-deleted, non-demo app with what ladder eligibility depends on.
export interface AdminLadderAppRow {
  id: string;
  name: string | null;
  userId: UserId;
  ownerName: string | null;
  broken: boolean;
  starter: boolean;
  empty: boolean;
  updatedTimestamp: string | null;
  ownerActiveAt: string | null;
  rating: number;
  ratingGames: number;
  ratingWins: number;
}

class AdminService {
  overview = async (now = new Date()): Promise<AdminOverviewCounts> => {
    const day = new Date(now.getTime() - DAY_MS);
    const week = new Date(now.getTime() - 7 * DAY_MS);
    const month = new Date(now.getTime() - 30 * DAY_MS);

    const [users, apps, arenas, mcp] = await Promise.all([
      pool.query({
        text: `SELECT COUNT(*)::int as "total",
                 SUM(CASE WHEN createdTimestamp >= $2 THEN 1 ELSE 0 END)::int as "signupsDay",
                 SUM(CASE WHEN createdTimestamp >= $3 THEN 1 ELSE 0 END)::int as "signupsWeek",
                 SUM(CASE WHEN createdTimestamp >= $4 THEN 1 ELSE 0 END)::int as "signupsMonth",
                 SUM(CASE WHEN lastActiveAt >= $2 THEN 1 ELSE 0 END)::int as "activeDay",
                 SUM(CASE WHEN lastActiveAt >= $3 THEN 1 ELSE 0 END)::int as "activeWeek",
                 SUM(CASE WHEN lastActiveAt >= $4 THEN 1 ELSE 0 END)::int as "activeMonth"
               FROM account WHERE id <> $1`,
        values: [DEMO_USER_ID, day, week, month],
      }),
      pool.query({
        text: `SELECT COUNT(*)::int as "total",
                 SUM(CASE WHEN updatedTimestamp >= $2 THEN 1 ELSE 0 END)::int as "updatedWeek"
               FROM app WHERE NOT deleted AND userId <> $1`,
        values: [DEMO_USER_ID, week],
      }),
      pool.query({
        text: 'SELECT COUNT(*)::int as "total" FROM arena WHERE userId <> $1',
        values: [DEMO_USER_ID],
      }),
      pool.query({
        text: `SELECT COUNT(DISTINCT userId)::int as "users" FROM oauth_token
               WHERE kind = 'refresh' AND expiresAt > $1`,
        values: [now.getTime()],
      }),
    ]);
    const u = users.rows[0] ?? {};
    const a = apps.rows[0] ?? {};
    return {
      users: {
        total: num(u.total),
        signups: {
          day: num(u.signupsDay),
          week: num(u.signupsWeek),
          month: num(u.signupsMonth),
        },
        active: {
          day: num(u.activeDay),
          week: num(u.activeWeek),
          month: num(u.activeMonth),
        },
      },
      apps: { total: num(a.total), updatedWeek: num(a.updatedWeek) },
      arenas: { total: num(arenas.rows[0]?.total) },
      mcp: { users: num(mcp.rows[0]?.users) },
    };
  };

  // Every account with its per-user aggregates, unsorted and unpaged (the
  // route filters, sorts and pages in JS; see the scale note at the top).
  users = async (now = new Date()): Promise<AdminUserRow[]> => {
    const starter = starterTest('source', 2);
    const [accounts, apps, arenas, tokens] = await Promise.all([
      pool.query({
        text: `SELECT id as "id", name as "name", email as "email", picture as "picture",
                 createdTimestamp as "createdTimestamp", lastActiveAt as "lastActiveAt"
               FROM account WHERE id <> $1`,
        values: [DEMO_USER_ID],
      }),
      pool.query({
        text: `SELECT userId as "userId", COUNT(*)::int as "apps",
                 SUM(CASE WHEN ${starter.sql} OR COALESCE(source, '') = '' THEN 0 ELSE 1 END)::int as "editedApps",
                 MAX(updatedTimestamp) as "lastAppEdit"
               FROM app WHERE NOT deleted AND userId <> $1 GROUP BY userId`,
        values: [DEMO_USER_ID, ...starter.values],
      }),
      pool.query({
        text: `SELECT userId as "userId", COUNT(*)::int as "arenas"
               FROM arena WHERE userId <> $1 GROUP BY userId`,
        values: [DEMO_USER_ID],
      }),
      pool.query({
        text: `SELECT userId as "userId", COUNT(*)::int as "tokens" FROM oauth_token
               WHERE kind = 'refresh' AND expiresAt > $1 GROUP BY userId`,
        values: [now.getTime()],
      }),
    ]);

    const byUser = <T>(
      rows: Record<string, unknown>[],
      f: (r: Record<string, unknown>) => T
    ) => new Map(rows.map((r) => [String(r.userId), f(r)]));
    const appStats = byUser(apps.rows, (r) => ({
      apps: num(r.apps),
      editedApps: num(r.editedApps),
      lastAppEdit: iso(r.lastAppEdit),
    }));
    const arenaCounts = byUser(arenas.rows, (r) => num(r.arenas));
    const tokenCounts = byUser(tokens.rows, (r) => num(r.tokens));

    return accounts.rows.map((r) => {
      const id = String(r.id);
      const s = appStats.get(id);
      return {
        id,
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        picture: (r.picture as string | null) ?? null,
        createdTimestamp: iso(r.createdTimestamp),
        lastActiveAt: iso(r.lastActiveAt),
        apps: s?.apps ?? 0,
        editedApps: s?.editedApps ?? 0,
        lastAppEdit: s?.lastAppEdit ?? null,
        arenas: arenaCounts.get(id) ?? 0,
        mcpClients: tokenCounts.get(id) ?? 0,
      };
    });
  };

  userDetail = async (
    userId: UserId,
    now = new Date()
  ): Promise<AdminUserDetail | undefined> => {
    const row = (await this.users(now)).find((u) => u.id === userId);
    if (!row) return undefined;

    const starter = starterTest('source', 2);
    const [identities, apps, arenas, members, achievements, counters, tokens] =
      await Promise.all([
        pool.query({
          text: `SELECT source as "source", createdTimestamp as "createdTimestamp"
                 FROM identity WHERE userId = $1`,
          values: [userId],
        }),
        pool.query({
          text: `SELECT id as "id", name as "name", createdTimestamp as "createdTimestamp",
                   updatedTimestamp as "updatedTimestamp", rating as "rating",
                   ratingGames as "ratingGames", ratingWins as "ratingWins",
                   COALESCE(broken, false) as "broken", ${starter.sql} as "starter",
                   (COALESCE(source, '') = '') as "empty"
                 FROM app WHERE userId = $1 AND NOT deleted`,
          values: [userId, ...starter.values],
        }),
        pool.query({
          text: `SELECT id as "id", createdTimestamp as "createdTimestamp"
                 FROM arena WHERE userId = $1`,
          values: [userId],
        }),
        pool.query({
          text: `SELECT arena_member.arenaId as "arenaId", COUNT(*)::int as "members",
                   SUM(CASE WHEN arena_member.enabled THEN 1 ELSE 0 END)::int as "enabled"
                 FROM arena_member JOIN arena ON arena.id = arena_member.arenaId
                 WHERE arena.userId = $1 GROUP BY arena_member.arenaId`,
          values: [userId],
        }),
        pool.query({
          text: `SELECT achievementId as "id", unlockedTimestamp as "unlockedTimestamp"
                 FROM achievement WHERE userId = $1`,
          values: [userId],
        }),
        pool.query({
          text: 'SELECT counter as "counter", value as "value" FROM user_counter WHERE userId = $1',
          values: [userId],
        }),
        // Live tokens only. The hash is never selected; the client's info JSON
        // is read solely for its display name (it can also carry a confidential
        // client's secret, which must not leave this function).
        pool.query({
          text: `SELECT oauth_token.kind as "kind", oauth_token.createdTimestamp as "createdTimestamp",
                   oauth_token.expiresAt as "expiresAt", oauth_client.info as "info"
                 FROM oauth_token LEFT JOIN oauth_client ON oauth_client.clientId = oauth_token.clientId
                 WHERE oauth_token.userId = $1 AND oauth_token.expiresAt > $2`,
          values: [userId, now.getTime()],
        }),
      ]);

    const memberCounts = new Map(
      members.rows.map((r) => [
        String(r.arenaId),
        { members: num(r.members), enabled: num(r.enabled) },
      ])
    );
    const clientName = (info: unknown): string | null => {
      if (typeof info !== 'string') return null;
      try {
        const name = (JSON.parse(info) as { client_name?: unknown })
          .client_name;
        return typeof name === 'string' ? name : null;
      } catch {
        return null;
      }
    };

    return {
      account: row,
      identities: identities.rows.map((r) => ({
        source: String(r.source),
        createdTimestamp: iso(r.createdTimestamp),
      })),
      apps: apps.rows.map((r) => ({
        id: String(r.id),
        name: (r.name as string | null) ?? null,
        createdTimestamp: iso(r.createdTimestamp),
        updatedTimestamp: iso(r.updatedTimestamp),
        rating: Math.round(num(r.rating)),
        ratingGames: num(r.ratingGames),
        ratingWins: num(r.ratingWins),
        broken: r.broken === true,
        starter: r.starter === true,
        empty: r.empty === true,
      })),
      arenas: arenas.rows
        .map((r) => {
          const id = String(r.id);
          const m = memberCounts.get(id);
          return {
            id,
            createdTimestamp: iso(r.createdTimestamp),
            members: m?.members ?? 0,
            enabledMembers: m?.enabled ?? 0,
          };
        })
        .sort((x, y) =>
          (x.createdTimestamp ?? '').localeCompare(y.createdTimestamp ?? '')
        ),
      achievements: achievements.rows.map((r) => ({
        id: String(r.id),
        unlockedTimestamp: iso(r.unlockedTimestamp),
      })),
      counters: Object.fromEntries(
        counters.rows.map((r) => [String(r.counter), num(r.value)])
      ),
      tokens: tokens.rows.map((r) => ({
        clientName: clientName(r.info),
        kind: String(r.kind),
        createdTimestamp: iso(r.createdTimestamp),
        expiresAt: r.expiresAt == null ? null : iso(Number(r.expiresAt)),
      })),
    };
  };

  // Signups per UTC day over the last `days` days, oldest first, zero-filled.
  signupsByDay = async (
    days: number,
    now = new Date()
  ): Promise<{ date: string; count: number }[]> => {
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
    const start = today - (days - 1) * DAY_MS;
    const res = await pool.query({
      text: `SELECT createdTimestamp as "createdTimestamp" FROM account
             WHERE createdTimestamp >= $1 AND id <> $2`,
      values: [new Date(start), DEMO_USER_ID],
    });
    const counts = new Array<number>(days).fill(0);
    for (const r of res.rows) {
      const t = new Date(r.createdTimestamp as string | Date).getTime();
      const i = Math.floor((t - start) / DAY_MS);
      if (i >= 0 && i < days) counts[i]++;
    }
    return counts.map((count, i) => ({
      date: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
      count,
    }));
  };

  // Every non-deleted, non-demo app with its ladder-relevant fields, for the
  // ladder view's names and its "why isn't this app ranked?" reasons.
  ladderApps = async (): Promise<AdminLadderAppRow[]> => {
    const starter = starterTest('app.source', 2);
    const res = await pool.query({
      text: `SELECT app.id as "id", app.name as "name", app.userId as "userId",
               account.name as "ownerName", COALESCE(app.broken, false) as "broken",
               ${starter.sql} as "starter", (COALESCE(app.source, '') = '') as "empty",
               app.updatedTimestamp as "updatedTimestamp",
               COALESCE(account.lastActiveAt, account.createdTimestamp) as "ownerActiveAt",
               app.rating as "rating", app.ratingGames as "ratingGames", app.ratingWins as "ratingWins"
             FROM app JOIN account ON account.id = app.userId
             WHERE NOT app.deleted AND app.userId <> $1`,
      values: [DEMO_USER_ID, ...starter.values],
    });
    return res.rows.map((r) => ({
      id: String(r.id),
      name: (r.name as string | null) ?? null,
      userId: String(r.userId),
      ownerName: (r.ownerName as string | null) ?? null,
      broken: r.broken === true,
      starter: r.starter === true,
      empty: r.empty === true,
      updatedTimestamp: iso(r.updatedTimestamp),
      ownerActiveAt: iso(r.ownerActiveAt),
      rating: Math.round(num(r.rating)),
      ratingGames: num(r.ratingGames),
      ratingWins: num(r.ratingWins),
    }));
  };
}

export default new AdminService();
