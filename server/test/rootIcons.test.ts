import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

import { ROOT_ICON_FILES, rootIconRouter } from '../src/util/rootIcons';
import { isSubresourceRequest } from '../src/util/staticAssets';

// The icon set as authored. `ui build` copies ui/public/** verbatim into
// server/dist/public, which is the directory the server serves at runtime, so
// testing against the source tree exercises the same relative layout without
// requiring a build.
const UI_PUBLIC = path.resolve(__dirname, '../../ui/public');

// Mirrors the wiring in src/index.ts: the icon routes are mounted ahead of the
// SPA fallback, which 404s anything that looks like a subresource.
const buildApp = (publicDir = UI_PUBLIC) => {
  const app = express();
  app.use(rootIconRouter(publicDir));
  app.use((req, res) => {
    if (isSubresourceRequest(req.path)) {
      res.status(404).type('txt').send('Not found');
      return;
    }
    res.type('html').send('<!doctype html><html></html>');
  });
  return app;
};

describe('root icon routes', () => {
  it('answers a bare /favicon.ico with the icon, not the HTML shell', async () => {
    // The whole point of the route: every browser asks for this path whatever
    // the shell's <link rel="icon"> says, and until it existed each request
    // fell through to the SPA fallback and logged an asset.missing 404.
    const res = await request(buildApp()).get('/favicon.ico');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/icon|image/);
    expect(res.headers['content-type']).not.toMatch(/text\/html/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('answers /apple-touch-icon.png, which iOS probes at the root', async () => {
    const res = await request(buildApp()).get('/apple-touch-icon.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('points at files that actually ship', async () => {
    // A rename or reorganization of ui/public/icons should fail here rather
    // than in production.
    for (const file of Object.values(ROOT_ICON_FILES)) {
      expect(fs.existsSync(path.join(UI_PUBLIC, file)), file).toBe(true);
    }
  });

  it('leaves every other path to the fallback', async () => {
    // The load-bearing guarantee this route sits in front of: a stale hashed
    // chunk (or any unknown subresource) must still 404, never receive the HTML
    // shell — a 200 of HTML makes the browser execute it as JavaScript and
    // blanks the page.
    for (const p of ['/assets/index-DjTJXfoE.js', '/icons/nope.png']) {
      const res = await request(buildApp()).get(p);
      expect(res.status, p).toBe(404);
    }
    // Navigations keep reaching the shell.
    const nav = await request(buildApp()).get('/about');
    expect(nav.status).toBe(200);
    expect(nav.headers['content-type']).toMatch(/text\/html/);
  });

  it('falls through to the 404 path when the file is missing', async () => {
    // An incomplete build shouldn't turn a favicon request into a 500.
    const res = await request(buildApp('/nonexistent-public-dir')).get(
      '/favicon.ico'
    );
    expect(res.status).toBe(404);
  });
});
