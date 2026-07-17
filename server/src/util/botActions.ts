import App, { AppId } from '../types/app';
import { UserId } from '../types/user';
import arenaService from '../services/ArenaService';
import environmentService from '../services/EnvironmentService';
import arenaMemberService from '../services/ArenaMemberService';
import {
  awardEdgeAchievement,
  evaluateAccountAchievements,
} from './awardAchievements';
import { ACCOUNT_REPAIR } from './achievements';

// Bot lifecycle operations shared by the REST API (api/app.ts) and the MCP tools
// (api/mcp.ts). Each was originally inlined in a route handler; extracting them
// keeps the two callers behaving identically.

// Maximum byte length (UTF-8) of a bot's source. Bots are tiny programs, so this
// is a generous ceiling; its job is to bound the memory a single save can consume
// (resource exhaustion is a primary security axis here), alongside the per-user
// app/arena caps. Enforced identically by the REST source PUT (api/app.ts) and the
// MCP set_app_source/create_app tools (api/mcp.ts) via sourceSizeError below, so
// both entry points reject oversized source with a documented error (E025). The
// octet-stream body parser (index.ts) keeps a higher hard limit as a backstop.
export const MAX_SOURCE_BYTES = 256 * 1024; // 256 KB

// Shared source-size guard. Returns a human-readable error message if `source`
// exceeds MAX_SOURCE_BYTES, otherwise null. Callers translate the message into
// their own error shape (REST: 413 + E025; MCP: a tool error).
export const sourceSizeError = (source: string): string | null => {
  const bytes = Buffer.byteLength(source, 'utf-8');
  if (bytes <= MAX_SOURCE_BYTES) return null;
  return (
    `Source is too large (${bytes} bytes); the limit is ${MAX_SOURCE_BYTES} ` +
    `bytes (256 KB). Bots are small programs — trim the source below the limit.`
  );
};

// Persist new source, then re-run it in every *live* arena the bot belongs to so
// a running bot picks up the change. Saving deliberately does NOT re-fire START
// (see Environment.execute) — use reboot for that.
export const propagateSource = async (
  app: App,
  source: string
): Promise<void> => {
  // Capture this BEFORE setSource mutates the app's stored source.
  const changed = source !== app.getSource();
  // Same reason, different field: setSource clears `broken` in the same UPDATE, so
  // this is the only moment we can still tell that the ladder had benched this app
  // for crashing. Editing it is what puts it back in the running (GitHub #121).
  const wasBroken = app.isBroken();
  // Always persist: setSource also clears the ladder `broken` flag and bumps
  // updatedTimestamp, so re-saving identical source is how a user un-breaks a
  // ladder-broken app and marks it "actively edited" — never guard this.
  await app.setSource(source);
  // The isolate re-execute (reload/recompile) is the expensive part; skip it
  // when the source did not actually change.
  if (changed) {
    const members = await arenaMemberService.getForApp(app.getId());
    await Promise.all(
      members.map(async (member) => {
        const env = await environmentService.getByArenaId(member.getArenaId());
        await env?.execute(member.getAppId());
      })
    );
  }

  // Achievements (GitHub #121). Hooked here rather than in the route because this
  // is the shared save path — both the REST source write and the MCP
  // set_app_source land on it, so neither can drift out of sync.
  //
  // Fire-and-forget: a badge must never fail or slow a save.
  if (wasBroken) void awardEdgeAchievement(app.getUserId(), ACCOUNT_REPAIR);
  // Writing a bot is itself an account milestone, so re-derive those too.
  void evaluateAccountAchievements(app.getUserId());
};

// Re-run a bot's current source in each of the user's arenas that have a live
// environment (the editor's "compile").
export const executeInUserArenas = async (
  userId: UserId,
  appId: AppId
): Promise<void> => {
  const arenas = await arenaService.getForUser(userId);
  await Promise.all(
    arenas
      .filter((arena) => environmentService.has(arena.getId()))
      .map((arena) =>
        environmentService.get(arena).then((env) => env.execute(appId))
      )
  );
};

// Reload a bot and re-fire START in each of the user's live arenas (the editor's
// "reboot").
export const rebootInUserArenas = async (
  userId: UserId,
  appId: AppId
): Promise<void> => {
  const arenas = await arenaService.getForUser(userId);
  await Promise.all(
    arenas
      .filter((arena) => environmentService.has(arena.getId()))
      .map((arena) =>
        environmentService.get(arena).then((env) => env.reboot(appId))
      )
  );
};

// Remove a bot from every arena it's in (tearing it out of any live environment),
// then soft-delete the app.
export const deleteAppEverywhere = async (app: App): Promise<void> => {
  const memberships = await arenaMemberService.getForApp(app.getId());
  await Promise.all(
    memberships.map(async (membership) => {
      const env = await environmentService.getByArenaId(
        membership.getArenaId()
      );
      if (env) env.removeApp(app.getId());
      await membership.delete();
    })
  );
  await app.delete();
};
