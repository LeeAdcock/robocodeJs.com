import LeaderboardEntry from './leaderboardEntry';

// Wire shapes for personal tournaments (GitHub #119), mirroring
// server/src/api/tournament.ts. A tournament is a filtered view of the global
// Elo ladder: its `entries` are ordinary leaderboard rows, ranked 1..N within
// the members' apps.

// One row of GET /api/tournaments — a tournament the viewer created or joined.
export interface TournamentSummary {
  id: string;
  name: string;
  isOwner: boolean;
  joined: boolean;
  memberCount: number;
}

// The creator-set board rules; `null` means no limit (the default). Also the
// PATCH /api/tournaments/:id body shape (each field optional there).
export interface TournamentSettings {
  // Show at most this many bots per member — their highest-rated ones.
  maxAppsPerMember: number | null;
  // Show at most this many rows on the board.
  maxEntries: number | null;
}

// GET /api/tournaments/:id — the public board, plus the viewer's own state.
export interface TournamentBoard {
  id: string;
  name: string;
  ownerName?: string;
  isOwner: boolean;
  joined: boolean;
  memberCount: number;
  maxMembers: number;
  // The rules the board was built under, and the most each may be set to.
  settings: TournamentSettings;
  settingsLimits: { maxAppsPerMember: number; maxEntries: number };
  // Abbreviated display names ("First L."), earliest joiner first. Sent only
  // to the tournament's creator.
  members?: string[];
  entries: LeaderboardEntry[];
}
