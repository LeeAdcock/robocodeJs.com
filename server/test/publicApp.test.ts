import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The public app route (GitHub #117) is the ONE place an app's source leaves the
// owner gate, and only on the owner's say-so. These tests pin that contract: a
// public app is readable anonymously; a private, unknown, or malformed id is a
// plain 404 (indistinguishable, so the route can't probe private ids); and the
// response carries no owner identifiers beyond the abbreviated display name.
vi.mock('../src/services/AppService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/UserService', () => ({ default: { get: vi.fn() } }));

import appService from '../src/services/AppService';
import userService from '../src/services/UserService';
import publicAppRouter from '../src/api/publicApp';
import { sourceVersion } from '../src/util/sourceVersion';

// No auth middleware, no injected req.user — anonymous, like the real mount.
const anonApp = () => {
  const app = express();
  app.use(publicAppRouter);
  return app;
};

const APP_ID = 'aaaaaaa1-1111-4111-8111-aaaaaaaaaaa1';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';

const fakeApp = (isPublic: boolean) => ({
  getId: () => APP_ID,
  getName: () => 'Open Bot',
  getUserId: () => OWNER_ID,
  getSource: () => '// the code',
  getRating: () => 1642.4,
  getRatingGames: () => 12,
  getRatingWins: () => 7,
  isPublic: () => isPublic,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.get).mockResolvedValue({
    getId: () => OWNER_ID,
    getName: () => 'Ada Lovelace',
    getEmail: () => 'ada@example.test',
  } as never);
});

describe('GET /api/public/app/:appId', () => {
  it('serves a public app’s source and record to an anonymous visitor', async () => {
    vi.mocked(appService.get).mockResolvedValue(fakeApp(true) as never);
    const res = await request(anonApp()).get(`/api/public/app/${APP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: APP_ID,
      name: 'Open Bot',
      // Abbreviated like the rankings board — never the full surname.
      ownerName: 'Ada L.',
      rating: 1642,
      games: 12,
      wins: 7,
      source: '// the code',
      version: sourceVersion('// the code'),
    });
    // No owner identifiers: not the userId, not the email.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(OWNER_ID);
    expect(body).not.toContain('ada@example.test');
    expect(body).not.toContain('Lovelace');
  });

  it('404s a private app without revealing anything about it', async () => {
    vi.mocked(appService.get).mockResolvedValue(fakeApp(false) as never);
    const res = await request(anonApp()).get(`/api/public/app/${APP_ID}`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('the code');
    expect(res.text).not.toContain('Open Bot');
  });

  it('404s an unknown id the same way', async () => {
    vi.mocked(appService.get).mockResolvedValue(undefined);
    const res = await request(anonApp()).get(`/api/public/app/${APP_ID}`);
    expect(res.status).toBe(404);
  });

  it('404s a malformed id without touching the database', async () => {
    const res = await request(anonApp()).get('/api/public/app/not-a-uuid');
    expect(res.status).toBe(404);
    expect(appService.get).not.toHaveBeenCalled();
  });
});
