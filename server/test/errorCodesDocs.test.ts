import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// The error-code docs page is the single source of truth for the code
// descriptions (served as the /error-codes page and the
// robocodejs://reference/error-codes MCP resource). Guard that every code that can
// actually surface to an author is documented — and with a BARE `## E0xx` heading,
// so showdown's auto-anchor is `e0xx` and the /error-codes#e0xx deep link (from
// searching a code) resolves.
const doc = fs.readFileSync(
  path.join(process.cwd(), '..', 'ui', 'public', 'docs', 'error-codes.md'),
  'utf-8'
);

// The codes actually emitted today: by the simulation engine (see compiler.ts /
// bot.ts / environment.ts / scheduleFactory.ts) and by the API layer (E022, from
// the rate limiter in middleware/rateLimit.ts; E025, the source-size cap in
// api/app.ts + api/mcp.ts).
const LIVE_CODES = [
  'E001',
  'E003',
  'E004',
  'E013',
  'E017',
  'E018',
  'E019',
  'E020',
  'E021',
  'E022',
  'E025',
];

describe('error-codes documentation', () => {
  it.each(LIVE_CODES)('documents %s under a bare anchor heading', (code) => {
    expect(doc).toMatch(new RegExp('^##\\s+' + code + '\\s*$', 'm'));
  });
});
