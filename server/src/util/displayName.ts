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
