import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pg pool and the EnvironmentService (which would otherwise pull in the
// simulation engine + isolated-vm). UserService.create wires up a new user's
// starter arena, so we only need to observe the order of its database writes.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/EnvironmentService', () => ({
  default: { get: vi.fn(), has: vi.fn() },
}));

import pool from '../src/util/db';
import environmentService from '../src/services/EnvironmentService';
import userService from '../src/services/UserService';

const query = vi.mocked(pool.query);

const queryText = (arg: unknown): string =>
  typeof arg === 'string'
    ? arg
    : ((arg as { text?: string } | undefined)?.text ?? '');

// Count of arena_member inserts that have actually *committed* (resolved), as
// opposed to merely been issued.
let committedMembers = 0;

beforeEach(() => {
  vi.clearAllMocks();
  committedMembers = 0;
  // Delay the membership insert's resolution. The bug is a read-after-write
  // race: if the setSource -> arenaMemberService.create chain isn't awaited
  // before the environment is fetched, get() runs while these inserts are still
  // in flight, so the resumed arena reads zero members.
  query.mockImplementation(((arg: unknown) => {
    const text = queryText(arg);
    if (/INSERT INTO arena_member/i.test(text)) {
      return new Promise((resolve) =>
        setTimeout(() => {
          committedMembers += 1;
          resolve({ rows: [], rowCount: 0 });
        }, 20)
      );
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }) as never);
});

describe('UserService.create — starter arena bootstrap', () => {
  it('commits both arena memberships before resuming the environment', async () => {
    // Capture how many memberships have committed at the moment the environment
    // is fetched (right before resume). Both must be in, or the arena resumes
    // empty (the race we fixed by returning the membership-creation chain).
    let committedAtResume = -1;
    const resume = vi.fn();
    vi.mocked(environmentService.get).mockImplementation((() => {
      committedAtResume = committedMembers;
      return Promise.resolve({ resume } as never);
    }) as never);

    await userService.create('Local Dev', undefined, 'dev@localhost');

    expect(committedAtResume).toBe(2);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
