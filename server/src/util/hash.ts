import { createHash } from 'node:crypto';

// Secrets we accept from clients (OAuth access/refresh tokens, authorization
// codes, client secrets) are stored only as their sha256 hash, never in the
// clear — a database read never yields a usable credential. The same hashing is
// applied to a presented value before lookup. Kept in one place so every call
// site hashes identically and the two can never drift.
export const sha256hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export default sha256hex;
