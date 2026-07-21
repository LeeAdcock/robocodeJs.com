// The public origin of this deployment (e.g. https://robocodejs.com), read once
// from PUBLIC_ORIGIN with the production host as the default and any trailing
// slashes stripped. This is the single source of truth for building absolute,
// user-facing URLs on the server side (SEO/OG tags in index.ts, and the MCP
// `watch` links below) so the host is defined in exactly one place.
export const PUBLIC_ORIGIN = (
  process.env.PUBLIC_ORIGIN || 'https://robocodejs.com'
).replace(/\/+$/, '');

// The public, controls-free spectator page for an arena — the same
// `/watch/:arenaId` share link the UI's "Share" button copies (ui/src/App.tsx).
// Anyone with the link can watch that arena's live match in a browser, no
// sign-in required, so it's what an MCP client hands the user when it wants to
// say "open this to watch the fight."
export const watchUrl = (arenaId: string): string =>
  `${PUBLIC_ORIGIN}/watch/${arenaId}`;
