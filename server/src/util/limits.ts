// Per-user resource caps, shared by every surface that enforces or reports them:
// the REST routes (api/app.ts, api/arena.ts), the MCP tools (api/mcp.ts), and the
// admin panel's "near a cap" filter (api/admin.ts), and personal tournaments
// (api/tournament.ts). Previously each route file
// kept its own copy, kept in sync by hand.

// Caps the number of apps (bots) a single user can own. Each app compiles into
// an 8 MB isolate per arena it runs in, so this bounds a user's isolate/memory
// footprint alongside MAX_ARENAS_PER_USER.
export const MAX_APPS_PER_USER = 20;

// Caps the number of arenas a single user can create. Each arena is an
// in-memory, isolate-backed Environment, so this bounds EnvironmentService's
// store; idle arenas are also GC'd 30 minutes after they stop.
export const MAX_ARENAS_PER_USER = 10;

// Caps the number of personal tournaments (GitHub #119) a single user can create.
// Generous for a teacher running a few classes, small enough that the table
// can't be farmed. A tournament is only rows (no isolates), so this is about
// storage and abuse, not compute.
export const MAX_TOURNAMENTS_PER_USER = 10;
