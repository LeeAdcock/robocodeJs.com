// Shape validation for the UUID path params (:userId, :appId, :arenaId).
//
// Every id in the API is a Postgres `uuid` column, so a malformed id reaches the
// database as a cast it cannot perform ("invalid input syntax for type uuid")
// and surfaces as an unhandled 500 rather than the 400 it actually is. That is
// not just noise: those 500s land in the http.error metric the ops alarm watches,
// so ordinary user typos (pasting a bot's *name* into an id field) look like
// server faults. Validate the shape at the edge instead — see the loaders in
// middleware/resource.ts.
//
// Canonical 8-4-4-4-12 hex only, case-insensitive. Postgres also accepts brace-
// and hyphen-free spellings, but nothing in this system emits them, so rejecting
// them keeps the check simple and the accepted surface small.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);
