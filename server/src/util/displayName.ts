import { sanitizeBotName } from './botName';
import { isNameProfane } from './nameFilter';

// Reduce a stored account display name (the Google `name`, typically
// "First Last") to a privacy-preserving "First L." for public surfaces like the
// global-ladder leaderboard (GitHub #151). We only store the full display name —
// not separate given/family fields — so this is a best-effort split on
// whitespace: first token in full, last token's initial. Applied server-side so
// the full surname never leaves the server on the unauthenticated endpoint.
//
//   "Ada Lovelace"      -> "Ada L."
//   "Grace B. Hopper"   -> "Grace H."   (middle tokens dropped)
//   "Prince"            -> "Prince"     (single token: nothing to abbreviate)
//   "" / null           -> "Anonymous"
export const abbreviateName = (name?: string | null): string => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Anonymous';
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0].toUpperCase();
  return `${first} ${lastInitial}.`;
};

// The owner name as it may be shown on a PUBLIC surface (the rankings board,
// the public app page). The stored name comes from Google (account.name), so
// apply the same precautions bot names get before showing it: sanitize, fall
// back to Anonymous when it trips the profanity filter (we can't reject a
// sign-in, and their real name is untouched elsewhere, e.g. their own avatar),
// and abbreviate to "First L." so an unauthenticated endpoint never exposes a
// full surname.
export const publicOwnerName = (name?: string | null): string => {
  const clean = sanitizeBotName(name);
  return isNameProfane(clean) ? 'Anonymous' : abbreviateName(clean);
};
