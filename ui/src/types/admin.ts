// Wire shapes of the admin control panel API (server/src/api/admin.ts and
// services/AdminService.ts, GitHub #469). Timestamps are ISO strings.

export interface AdminInstance {
  hostname: string;
  version: string;
  uptimeSec: number;
  node: string;
}

export interface AdminOverview {
  instance: AdminInstance;
  metrics: {
    arenas: number;
    runningArenas: number;
    idlePausedArenas: number;
    isolates: number;
    maxAvgTickMs: number;
    rssMB: number;
    heapUsedMB: number;
  };
  counts: {
    users: {
      total: number;
      signups: { day: number; week: number; month: number };
      active: { day: number; week: number; month: number };
    };
    apps: { total: number; updatedWeek: number };
    arenas: { total: number };
    mcp: { users: number };
  };
  ladder: {
    enabled: boolean;
    loopRunning: boolean;
    matchesDay: number;
    unratedDay: number;
  };
}

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  createdTimestamp: string | null;
  lastActiveAt: string | null;
  apps: number;
  editedApps: number;
  lastAppEdit: string | null;
  arenas: number;
  mcpClients: number;
}

export type AdminUserFilter =
  'all' | 'never-edited' | 'near-cap' | 'dormant' | 'mcp';
export type AdminUserSort = 'lastActive' | 'created' | 'name' | 'apps';

export interface AdminUserList {
  total: number;
  offset: number;
  limit: number;
  users: AdminUserRow[];
  limits: { appsPerUser: number; arenasPerUser: number };
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

export interface AdminAppLabel {
  appId: string;
  name: string | null;
  ownerName: string | null;
}

export type AdminIneligibleReason =
  'empty' | 'starter' | 'broken' | 'stale-app' | 'stale-owner' | 'unknown';

export interface AdminLadder {
  instance: AdminInstance;
  enabled: boolean;
  loopRunning: boolean;
  config: {
    concurrency: number;
    matchIntervalMs: number;
    idleMs: number;
    maxLiveIsolates: number;
    timeoutMs: number;
    matchSpeed: number;
    retentionDays: number;
    pairMatchCap: number;
  };
  throughput: {
    hour: { total: number; unrated: number };
    day: { total: number; unrated: number };
  };
  pool: (AdminAppLabel & {
    rating: number;
    games: number;
    wins: number;
    updatedTimestamp: string;
  })[];
  pairs: { appA: string; appB: string; matches: number; saturated: boolean }[];
  pairSummary: { total: number; saturated: number; open: number };
  claims: AdminAppLabel[];
  broken: AdminAppLabel[];
  ineligible: {
    total: number;
    reasons: Partial<Record<AdminIneligibleReason, number>>;
    apps: (AdminAppLabel & {
      updatedTimestamp: string | null;
      reasons: AdminIneligibleReason[];
    })[];
  };
}
