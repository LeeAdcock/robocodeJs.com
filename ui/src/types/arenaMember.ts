// Wire shape of one arena roster entry, mirroring the server's `listMembers`
// response (server/src/api/arena.ts). Metadata only — never source. `enabled`
// is the roster's own state (a disabled bot stays listed but holds no live
// bots); `isOwn` is true when the signed-in arena owner also owns the bot;
// `public` is true when the bot's owner opened its source to everyone, so the
// roster can link to the read-only /app/:appId view (GitHub #117).
export default interface ArenaMember {
  appId: string;
  name?: string;
  ownerUserId?: string;
  ownerName?: string;
  enabled: boolean;
  addedTimestamp: number;
  isOwn: boolean;
  public?: boolean;
}
