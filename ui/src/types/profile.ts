// Mirrors the shape served by GET /api/profile (server/src/api/profile.ts).
// The server sends the whole badge CATALOG alongside what's unlocked, so the UI
// holds no per-badge knowledge — adding a badge is a server-side edit only.

export type AchievementScope = 'ladder' | 'sandbox' | 'account';

export interface CatalogEntry {
  id: string;
  scope: AchievementScope;
  name: string;
  description: string;
  // Emoji.
  icon: string;
  // Present only on counter-based badges; together they drive the progress bar on
  // a locked one. Absent for badges judged by a server-side match predicate.
  counter?: string;
  threshold?: number;
}

export interface UnlockedAchievement {
  id: string;
  // The app that earned it — set only for ladder badges, where one winning app is
  // genuinely responsible. Null for cumulative and account badges.
  appId: string | null;
  unlockedTimestamp: string;
}

export interface Profile {
  user: { name?: string; picture?: string };
  catalog: CatalogEntry[];
  unlocked: UnlockedAchievement[];
  // Lifetime totals, keyed by counter name. A missing key means zero.
  counters: Record<string, number>;
}
