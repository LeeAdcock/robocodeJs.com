import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The extension is published under the project's release version, set by the
// root `npm run release` (scripts/sync-vscode-version.cjs). A hand edit to
// either package.json would make tag vX.Y.Z describe two different things.
const version = (pkg: string): string =>
  JSON.parse(
    readFileSync(join(__dirname, '..', '..', pkg, 'package.json'), 'utf8')
  ).version;

describe('extension version', () => {
  it('matches the server release version', () => {
    expect(
      version('vscode'),
      'vscode/package.json must carry the server version; run `npm run release` from the root rather than editing either by hand'
    ).toBe(version('server'));
  });
});
