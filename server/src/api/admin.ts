import express, { Request, Response } from 'express';
import os from 'node:os';
import auth from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import adminService, { AdminUserRow } from '../services/AdminService';
import ladderService from '../services/LadderService';
import rankedMatchService from '../services/RankedMatchService';
import { collectMetrics } from '../util/metrics';
import { VERSION } from '../util/version';
import { isUuid } from '../util/uuid';
import { MAX_APPS_PER_USER, MAX_ARENAS_PER_USER } from '../util/limits';
import { logger, LogEvent } from '../util/logger';

// The admin control panel's API (GitHub #469), backing the UI's /admin page.
// Read-only. Every route sits behind auth(false) + requireAdmin, which sends
// anyone who isn't an admin out of this router entirely (see
// middleware/admin.ts), so to a non-admin these paths behave exactly like
// paths that don't exist. Cookie session only: auth never honours a bearer
// token, so an MCP token can't reach any of this.
//
// Data comes from the database (global across instances) except the
// `instance` block and the live gauges, which describe only the instance that
// served the request and are labelled as such.
const router = express.Router();

router.use('/api/admin', auth(false), requireAdmin);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Mirrors the 3-month activity window in AppService.getLadderCandidates.
const threeMonthsAgo = (now: Date): Date => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - 3);
  return d;
};

const instanceInfo = () => ({
  // On Elastic Beanstalk the EC2 hostname (ip-10-…) identifies the instance.
  hostname: os.hostname(),
  version: VERSION,
  uptimeSec: Math.round(process.uptime()),
  node: process.version,
});

// Wraps a handler so a failure is logged and answered with a 500 rather than
// left to the default handler.
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err: unknown) {
      logger.error(
        {
          event: LogEvent.HTTP_ERROR,
          path: req.path,
          err: err instanceof Error ? err.message : String(err),
        },
        'admin API request failed'
      );
      res.status(500).json({ error: 'Internal server error' });
    }
  };

// The UI's probe: a 200 here is what shows the admin link. Non-admins never
// reach it (see requireAdmin), so they get whatever an unknown path gets.
router.get('/api/admin/me', (_req, res) => {
  res.json({ admin: true });
});

router.get(
  '/api/admin/overview',
  handle(async (_req, res) => {
    const now = new Date();
    const [counts, ladderDay] = await Promise.all([
      adminService.overview(now),
      rankedMatchService.outcomesSince(new Date(now.getTime() - DAY_MS)),
    ]);
    res.json({
      instance: instanceInfo(),
      metrics: collectMetrics(),
      counts,
      ladder: {
        enabled: process.env.LADDER_ENABLED === 'true',
        loopRunning: ladderService.isLoopRunning(),
        matchesDay: ladderDay.total,
        unratedDay: ladderDay.unrated,
      },
    });
  })
);

type UserFilter = 'all' | 'never-edited' | 'near-cap' | 'dormant' | 'mcp';
type UserSort = 'lastActive' | 'created' | 'name' | 'apps';
const FILTERS: UserFilter[] = [
  'all',
  'never-edited',
  'near-cap',
  'dormant',
  'mcp',
];
const SORTS: UserSort[] = ['lastActive', 'created', 'name', 'apps'];

// "Near a cap" = at 80% or more of either per-user limit.
const NEAR_APPS = Math.ceil(MAX_APPS_PER_USER * 0.8);
const NEAR_ARENAS = Math.ceil(MAX_ARENAS_PER_USER * 0.8);

const lastSeen = (u: AdminUserRow): string | null =>
  u.lastActiveAt ?? u.createdTimestamp;

const matchesFilter = (
  u: AdminUserRow,
  filter: UserFilter,
  dormantBefore: string
): boolean => {
  switch (filter) {
    case 'never-edited':
      return u.editedApps === 0;
    case 'near-cap':
      return u.apps >= NEAR_APPS || u.arenas >= NEAR_ARENAS;
    case 'dormant':
      return (lastSeen(u) ?? '') < dormantBefore;
    case 'mcp':
      return u.mcpClients > 0;
    default:
      return true;
  }
};

// Newest first, with missing timestamps last.
const byTimeDesc = (a: string | null, b: string | null): number =>
  (b ?? '').localeCompare(a ?? '');

const compareUsers: Record<
  UserSort,
  (a: AdminUserRow, b: AdminUserRow) => number
> = {
  lastActive: (a, b) => byTimeDesc(lastSeen(a), lastSeen(b)),
  created: (a, b) => byTimeDesc(a.createdTimestamp, b.createdTimestamp),
  name: (a, b) => (a.name ?? '').localeCompare(b.name ?? ''),
  apps: (a, b) => b.apps - a.apps,
};

const intParam = (v: unknown, dflt: number, min: number, max: number) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

router.get(
  '/api/admin/users',
  handle(async (req, res) => {
    const now = new Date();
    const search = String(req.query.search ?? '')
      .trim()
      .toLowerCase();
    const filter = FILTERS.includes(req.query.filter as UserFilter)
      ? (req.query.filter as UserFilter)
      : 'all';
    const sort = SORTS.includes(req.query.sort as UserSort)
      ? (req.query.sort as UserSort)
      : 'lastActive';
    const limit = intParam(req.query.limit, 50, 1, 200);
    const offset = intParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const dormantBefore = threeMonthsAgo(now).toISOString();

    const all = await adminService.users(now);
    const matched = all
      .filter(
        (u) =>
          !search ||
          (u.name ?? '').toLowerCase().includes(search) ||
          (u.email ?? '').toLowerCase().includes(search) ||
          u.id === search
      )
      .filter((u) => matchesFilter(u, filter, dormantBefore))
      .sort(compareUsers[sort]);

    res.json({
      total: matched.length,
      offset,
      limit,
      users: matched.slice(offset, offset + limit),
      limits: {
        appsPerUser: MAX_APPS_PER_USER,
        arenasPerUser: MAX_ARENAS_PER_USER,
      },
    });
  })
);

router.get(
  '/api/admin/users/:userId',
  handle(async (req, res) => {
    const userId = String(req.params.userId);
    const detail = isUuid(userId)
      ? await adminService.userDetail(userId)
      : undefined;
    if (!detail) {
      res.status(404).json({ error: 'No such user' });
      return;
    }
    res.json(detail);
  })
);

router.get(
  '/api/admin/signups',
  handle(async (req, res) => {
    const days = intParam(req.query.days, 90, 1, 365);
    res.json({ days: await adminService.signupsByDay(days) });
  })
);

// Why an app outside the ladder pool isn't in it, by the same rules as
// AppService.getLadderCandidates plus the untouched-starter filter. 'unknown'
// would mean the two have drifted apart, and is shown rather than hidden.
type IneligibleReason =
  'empty' | 'starter' | 'broken' | 'stale-app' | 'stale-owner' | 'unknown';

router.get(
  '/api/admin/ladder',
  handle(async (_req, res) => {
    const now = new Date();
    const [snapshot, apps, hour, day] = await Promise.all([
      ladderService.adminSnapshot(),
      adminService.ladderApps(),
      rankedMatchService.outcomesSince(new Date(now.getTime() - HOUR_MS)),
      rankedMatchService.outcomesSince(new Date(now.getTime() - DAY_MS)),
    ]);

    const byId = new Map(apps.map((a) => [a.id, a]));
    const label = (appId: string) => {
      const a = byId.get(appId);
      return { appId, name: a?.name ?? null, ownerName: a?.ownerName ?? null };
    };
    const inPool = new Set(snapshot.pool.map((p) => p.appId));
    const staleBefore = threeMonthsAgo(now).toISOString();

    const ineligible = apps
      .filter((a) => !inPool.has(a.id))
      .map((a) => {
        const reasons: IneligibleReason[] = [];
        if (a.empty) reasons.push('empty');
        if (a.starter) reasons.push('starter');
        if (a.broken) reasons.push('broken');
        if ((a.updatedTimestamp ?? '') < staleBefore) reasons.push('stale-app');
        if ((a.ownerActiveAt ?? '') < staleBefore) reasons.push('stale-owner');
        if (reasons.length === 0) reasons.push('unknown');
        return {
          ...label(a.id),
          updatedTimestamp: a.updatedTimestamp,
          reasons,
        };
      });

    const reasonCounts: Record<string, number> = {};
    for (const i of ineligible)
      for (const r of i.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;

    const saturated = snapshot.pairs.filter((p) => p.saturated).length;

    res.json({
      instance: instanceInfo(),
      enabled: snapshot.enabled,
      loopRunning: snapshot.loopRunning,
      config: snapshot.config,
      throughput: { hour, day },
      pool: snapshot.pool
        .map((p) => {
          const a = byId.get(p.appId);
          return {
            ...label(p.appId),
            rating: Math.round(p.rating),
            games: p.ratingGames,
            wins: a?.ratingWins ?? 0,
            updatedTimestamp: p.updatedTimestamp.toISOString(),
          };
        })
        .sort((x, y) => y.rating - x.rating),
      pairs: snapshot.pairs,
      pairSummary: {
        total: snapshot.pairs.length,
        saturated,
        open: snapshot.pairs.length - saturated,
      },
      claims: snapshot.claimedAppIds.map(label),
      broken: apps.filter((a) => a.broken).map((a) => label(a.id)),
      ineligible: {
        total: ineligible.length,
        reasons: reasonCounts,
        // Untouched starters and empty apps are the bulk of this list and need
        // no explanation, so the itemised list is the rest: the apps someone
        // actually wrote that still aren't playing.
        apps: ineligible
          .filter(
            (i) =>
              !i.reasons.includes('starter') && !i.reasons.includes('empty')
          )
          .slice(0, 200),
      },
    });
  })
);

export default router;
