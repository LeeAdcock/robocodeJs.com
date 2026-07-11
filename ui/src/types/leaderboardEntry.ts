// Wire shape of one global-ladder leaderboard row, mirroring the server's
// GET /api/leaderboard response (server/src/api/leaderboard.ts, built by
// AppService.getLeaderboard). Public, spectating-friendly metadata only — bot
// name, owner display name, and ranked record; never source.
//
// `color` is the tank sprite color for the row (a sprite palette name like
// 'blue'), present on every row — the UI renders /sprites/tank_<color>.png
// directly and never learns the real app id. `appId` is the REAL app id and is
// present ONLY on rows the viewer owns (undefined otherwise), so the board
// never leaks other users' app ids; its presence is the server-authoritative
// signal that a row is the viewer's own.
export default interface LeaderboardEntry {
  rank: number;
  color: string;
  appId?: string;
  name: string;
  ownerName: string;
  rating: number;
  games: number;
  wins: number;
  winRate: number; // 0..1
}
