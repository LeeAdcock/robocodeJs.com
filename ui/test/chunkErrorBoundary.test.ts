import { describe, it, expect } from 'vitest';
import {
  isChunkLoadError,
  shouldReloadForChunkError,
} from '../src/components/chunkErrorBoundary';

describe('isChunkLoadError', () => {
  it('recognizes how each browser phrases a failed dynamic import', () => {
    // Chrome, Firefox, and Safari all word this differently, and none of it is
    // standardized — the boundary has to match every form or it will show the
    // error fallback where a reload would have fixed things.
    for (const message of [
      'Failed to fetch dynamically imported module: https://robocodejs.com/assets/appEditor-ComWu4dC.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/index-abc.css',
      'Loading chunk 42 failed.',
      'Loading CSS chunk 7 failed.',
    ]) {
      expect(isChunkLoadError(new Error(message)), message).toBe(true);
    }
  });

  it('recognizes the MIME-type failure the old server behaviour produced', () => {
    // A missing chunk used to be answered with index.html and a 200, so the
    // browser refused it as a module. Fixed server-side, but a cached response
    // from before the fix can still surface this.
    expect(
      isChunkLoadError(
        new Error(
          'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html.'
        )
      )
    ).toBe(true);
  });

  it('recognizes a ChunkLoadError by name whatever its message says', () => {
    const err = new Error('unhelpful');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('does NOT claim an ordinary render bug', () => {
    // Reloading cannot fix these, and treating them as chunk errors would turn
    // a visible bug into a reload loop.
    expect(
      isChunkLoadError(new TypeError('Cannot read properties of undefined'))
    ).toBe(false);
    expect(isChunkLoadError(new Error('arena is not defined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('handles a thrown non-Error without blowing up', () => {
    expect(isChunkLoadError('Loading chunk 3 failed')).toBe(true);
    expect(isChunkLoadError({ nope: true })).toBe(false);
  });
});

describe('shouldReloadForChunkError', () => {
  const COOLDOWN = 30_000;

  it('reloads when nothing has been tried yet', () => {
    expect(shouldReloadForChunkError(1_000_000, null, COOLDOWN)).toBe(true);
  });

  it('refuses a second reload inside the cooldown', () => {
    // The reload already happened and did not help, so the new build is the
    // problem — showing the fallback beats spinning in a reload loop.
    expect(shouldReloadForChunkError(1_005_000, 1_000_000, COOLDOWN)).toBe(
      false
    );
  });

  it('allows another reload once the cooldown has passed', () => {
    // A later deploy is a legitimately new failure, not a loop.
    expect(shouldReloadForChunkError(1_040_000, 1_000_000, COOLDOWN)).toBe(
      true
    );
  });

  it('treats the cooldown boundary as elapsed', () => {
    expect(shouldReloadForChunkError(1_030_000, 1_000_000, COOLDOWN)).toBe(
      true
    );
  });
});
