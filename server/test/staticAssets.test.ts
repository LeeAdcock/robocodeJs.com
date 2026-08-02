import { describe, it, expect } from 'vitest';
import path from 'node:path';

import {
  isSubresourceRequest,
  isHashedAsset,
  IMMUTABLE_CACHE_CONTROL,
  SHELL_CACHE_CONTROL,
} from '../src/util/staticAssets';

describe('isSubresourceRequest', () => {
  it('claims every content-hashed build asset', () => {
    // The case that matters: a browser on a previous deploy asking for a chunk
    // whose hash is gone. Answering with index.html made the browser execute
    // HTML as JavaScript and blanked the page.
    expect(isSubresourceRequest('/assets/index-DjTJXfoE.js')).toBe(true);
    expect(isSubresourceRequest('/assets/appEditor-ComWu4dC.js')).toBe(true);
    expect(isSubresourceRequest('/assets/index-B7wh5nsz.css')).toBe(true);
    expect(isSubresourceRequest('/assets/logo-a1b2c3d4.svg')).toBe(true);
  });

  it('claims runtime data files and fonts the SPA fetches', () => {
    for (const p of [
      '/docs/dev.md',
      '/blog-index.json',
      '/samples/marksman.js',
      '/robots.txt',
      '/sitemap.xml',
      '/fonts/inter.woff2',
      '/og-card.png',
      '/favicon.ico',
    ]) {
      expect(isSubresourceRequest(p), p).toBe(true);
    }
  });

  it('leaves every client-side route alone', () => {
    // These must keep falling through to the HTML shell — that is how the SPA
    // routes, and how an unknown page renders the in-app not-found view. Every
    // route in App.tsx is extension-free, which is what makes this safe.
    for (const p of [
      '/',
      '/about',
      '/leaderboard',
      '/learn/survival',
      '/samples/marksman',
      '/blog/some-post',
      '/watch/2f1c8f6e-0000-4a1b-9c3d-1a2b3c4d5e6f',
      '/user/u1/app/a1',
      '/mcp/authorize',
      '/definitely-not-a-page',
    ]) {
      expect(isSubresourceRequest(p), p).toBe(false);
    }
  });

  it('is case-insensitive about the extension', () => {
    expect(isSubresourceRequest('/assets/X.JS')).toBe(true);
    expect(isSubresourceRequest('/OG-CARD.PNG')).toBe(true);
  });
});

describe('isHashedAsset', () => {
  it('recognizes files under the build assets directory', () => {
    expect(
      isHashedAsset(path.join('dist', 'public', 'assets', 'x-abc.js'))
    ).toBe(true);
  });

  it('excludes stable-name public files, which must stay revalidated', () => {
    // These keep their name across deploys, so caching them forever would pin
    // users to stale content.
    expect(isHashedAsset(path.join('dist', 'public', 'index.html'))).toBe(
      false
    );
    expect(isHashedAsset(path.join('dist', 'public', 'docs', 'dev.md'))).toBe(
      false
    );
    expect(isHashedAsset(path.join('dist', 'public', 'og-card.png'))).toBe(
      false
    );
  });
});

describe('cache-control policy', () => {
  it('caches hashed assets immutably — the hash is the cache key', () => {
    expect(IMMUTABLE_CACHE_CONTROL).toContain('immutable');
    expect(IMMUTABLE_CACHE_CONTROL).toContain('max-age=31536000');
  });

  it('forces the shell to revalidate — it carries the current asset hashes', () => {
    // Must not be a max-age that lets a browser reuse an old shell, which is
    // precisely how a client ends up requesting a previous build's chunks.
    expect(SHELL_CACHE_CONTROL).toBe('no-cache');
  });
});
