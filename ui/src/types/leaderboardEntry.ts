// Wire shape of one global-ladder leaderboard row, mirroring the server's
// GET /api/leaderboard response (server/src/api/leaderboard.ts, built by
// AppService.getLeaderboard). Public, spectating-friendly metadata only — bot
// name, owner display name, and ranked record; never source.
export default interface LeaderboardEntry {
  rank: number;
  appId: string;
  name: string;
  ownerName: string;
  rating: number;
  games: number;
  wins: number;
  winRate: number; // 0..1
}
