// Resolving whatever a user pastes into an "app id" field into an actual app id.
//
// The share link for an app is `<origin>/add-app/<appId>`, so the natural thing
// to paste is the whole URL — the roster's own label offers "its id (or share
// link)". Accept both, plus the surrounding whitespace a copy/paste drags along.
// Anything else (most often the app's *name*, copied off the rankings page) is
// rejected here rather than sent to the server, which can only answer it with an
// error.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The same shape, unanchored, for pulling an id back out of a share link.
const UUID_IN_TEXT_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const isUuid = (value: string): boolean => UUID_RE.test(value.trim());

// Returns the app id `input` refers to, or null if it doesn't refer to one.
// Accepts a bare id, a full `/add-app/<id>` share link, and the same with query
// string, fragment, or trailing slash attached.
export const extractAppId = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
  // Only pull an id out of something that actually looks like one of our share
  // links — a bare uuid embedded in arbitrary prose is more likely a mistake
  // than an intent, and silently accepting it would mask a real typo.
  if (!/\/add-app\//i.test(trimmed)) return null;
  const match = trimmed.split(/\/add-app\//i)[1]?.match(UUID_IN_TEXT_RE);
  return match ? match[0].toLowerCase() : null;
};
