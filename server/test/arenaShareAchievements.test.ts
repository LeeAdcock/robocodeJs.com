import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// The add-by-reference route is where the share-link badges (GitHub #121) hook in.
// Mock everything it touches; this is about WHO earns and WHEN, not the add.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/UserService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/AppService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/ArenaService', () => ({
  default: { getDefaultForUser: vi.fn(), getForUser: vi.fn() },
}));
vi.mock('../src/services/ArenaMemberService', () => ({
  default: { getForArena: vi.fn(), create: vi.fn() },
}));
vi.mock('../src/services/EnvironmentService', () => ({
  default: { get: vi.fn(), getByArenaId: vi.fn(), has: vi.fn() },
}));
vi.mock('../src/util/awardAchievements', () => ({
  awardEdgeAchievement: vi.fn().mockResolvedValue(undefined),
}));

import userService from '../src/services/UserService';
import appService from '../src/services/AppService';
import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';
import environmentService from '../src/services/EnvironmentService';
import { awardEdgeAchievement } from '../src/util/awardAchievements';
import arenaRouter from '../src/api/arena';

const award = vi.mocked(awardEdgeAchievement);

// The arena owner is always u1 here; the bot's owner is what varies.
const mount = (viewerId: string) => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = {
      getId: () => viewerId,
      getName: () => 'Viewer',
    };
    next();
  });
  app.use(arenaRouter);
  return app;
};

const setup = (botOwnerId: string) => {
  vi.mocked(userService.get).mockResolvedValue({
    getId: () => 'u1',
  } as never);
  vi.mocked(appService.get).mockResolvedValue({
    getId: () => 'bot-1',
    getName: () => 'Rival',
    getUserId: () => botOwnerId,
  } as never);
  vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
    getId: () => 'ar1',
    getUserId: () => 'u1',
  } as never);
  vi.mocked(arenaMemberService.getForArena).mockResolvedValue([]);
  vi.mocked(environmentService.get).mockResolvedValue({
    addApp: vi.fn(),
  } as never);
  vi.mocked(arenaMemberService.create).mockResolvedValue(undefined as never);
};

// Awards are fire-and-forget, so let the microtask queue drain before asserting.
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => vi.clearAllMocks());

describe('add-by-reference — share achievements', () => {
  it("awards both halves when a user adds someone else's bot", async () => {
    setup('u2');

    const res = await request(mount('u1')).put('/api/user/u1/arena/app/bot-1');
    await settle();

    expect(res.status).toBe(201);
    // The author whose bot got picked up...
    expect(award).toHaveBeenCalledWith('u2', 'account-shared');
    // ...and the player who fielded it.
    expect(award).toHaveBeenCalledWith('u1', 'account-borrowed');
  });

  // Adding your own bot to your own arena is just using the app.
  it('awards nothing when a user adds their own bot', async () => {
    setup('u1');

    const res = await request(mount('u1')).put('/api/user/u1/arena/app/bot-1');
    await settle();

    expect(res.status).toBe(201);
    expect(award).not.toHaveBeenCalled();
  });

  // The route early-returns for an existing member, so the badge can't re-fire on
  // a re-add. (unlock is idempotent anyway — this pins the cheaper guard.)
  it('does not re-award when the bot is already a member', async () => {
    setup('u2');
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      { getAppId: () => 'bot-1' },
    ] as never);

    const res = await request(mount('u1')).put('/api/user/u1/arena/app/bot-1');
    await settle();

    expect(res.status).toBe(200);
    expect(award).not.toHaveBeenCalled();
  });

  // A roster that's full rejects the add, so nothing was shared.
  it('awards nothing when the add is rejected', async () => {
    setup('u2');
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      { getAppId: () => 'x1' },
      { getAppId: () => 'x2' },
      { getAppId: () => 'x3' },
      { getAppId: () => 'x4' },
      { getAppId: () => 'x5' },
    ] as never);

    const res = await request(mount('u1')).put('/api/user/u1/arena/app/bot-1');
    await settle();

    expect(res.status).toBe(400);
    expect(award).not.toHaveBeenCalled();
  });
});
