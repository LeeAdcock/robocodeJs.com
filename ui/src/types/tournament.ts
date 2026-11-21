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

// The creator-set board rules; `null`/`false`/'bots' mean "off" (the defaults).
// Also the PATCH /api/tournaments/:id body shape (each field optional there).
// Dates travel as ISO 8601 strings.
export interface TournamentSettings {
  // Show at most this many bots per member — their highest-rated ones.
  maxAppsPerMember: number | null;
  // Show at most this many rows on the board.
  maxEntries: number | null;
  // Hide bots with fewer ranked games than this.
  minGames: number | null;
  // 'members' ranks players (one row per member, their best bot) not bots.
  rankBy: 'bots' | 'members';
  // Leave owner names off the board.
  hideOwners: boolean;
  // Show only bots whose source is public.
  publicOnly: boolean;
  // Nobody new can join until the creator reopens it.
  joinLocked: boolean;
  // When the tournament ends; past it the standings are final.
  endsAt: string | null;
  // Count only bots edited at or after this instant.
  editedSince: string | null;
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
  settingsLimits: {
    maxAppsPerMember: number;
    maxEntries: number;
    minGames: number;
  };
  // The end date has passed: these are the final standings.
  ended: boolean;
  // Why a signed-in viewer can't join right now (lock or end date), if so.
  joinClosed?: string;
  // Abbreviated display names ("First L."), earliest joiner first. Sent only
  // to the tournament's creator.
  members?: string[];
  entries: LeaderboardEntry[];
}
