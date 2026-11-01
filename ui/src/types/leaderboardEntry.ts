// Wire shape of one global-ladder leaderboard row, mirroring the server's
// GET /api/leaderboard response (server/src/api/leaderboard.ts, built by
// AppService.getLeaderboard). Public, spectating-friendly metadata only — bot
// name, owner display name, and ranked record; never source.
//
// `color` is the tank sprite color for the row (a sprite palette name like
// 'blue'), present on every row — the UI renders /sprites/tank_<color>.png
// directly and never learns a private app's real id. `appId` is the REAL app
// id and is present only on rows the viewer owns or whose owner made the app
// `public` (undefined otherwise), so the board never leaks a private app's id.
// `own` is the server-authoritative "this row is the viewer's" signal; `public`
// means anyone may read the source at /app/:appId (GitHub #117).
export default interface LeaderboardEntry {
  rank: number;
  color: string;
  appId?: string;
  own: boolean;
  public: boolean;
  name: string;
  ownerName: string;
  rating: number;
  games: number;
  wins: number;
  winRate: number; // 0..1
  // Rank on the board ~24h ago; drives the up/down movement arrow (compare to
  // `rank`). Omitted when the app wasn't ranked 24h ago — a new entrant.
  previousRank?: number;
}
