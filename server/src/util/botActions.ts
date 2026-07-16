import App, { AppId } from '../types/app';
import { UserId } from '../types/user';
import arenaService from '../services/ArenaService';
import environmentService from '../services/EnvironmentService';
import arenaMemberService from '../services/ArenaMemberService';

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
  await app.setSource(source);
  const members = await arenaMemberService.getForApp(app.getId());
  await Promise.all(
    members.map(async (member) => {
      const env = await environmentService.getByArenaId(member.getArenaId());
      await env?.execute(member.getAppId());
    })
  );
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
