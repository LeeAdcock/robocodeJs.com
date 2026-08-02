import { describe, it, expect, vi, beforeEach } from 'vitest';

// establishSession drives axios directly; mock it so we can assert the call
// sequence without a server. nextSessionProbeState is pure.
vi.mock('axios', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));
import axios from 'axios';
import { establishSession, nextSessionProbeState } from '../src/util/session';

const post = vi.mocked(axios.post);
const get = vi.mocked(axios.get);

beforeEach(() => vi.clearAllMocks());

describe('establishSession', () => {
  it('posts the credential then loads whoami → full profile', async () => {
    post.mockResolvedValue({} as never);
    get
      .mockResolvedValueOnce({ data: { id: 'u1' } } as never) // whoami
      .mockResolvedValueOnce({ data: { id: 'u1', name: 'Ada' } } as never); // full

    const user = await establishSession('cred-abc');

    expect(post).toHaveBeenCalledWith('/api/session', {
      credential: 'cred-abc',
    });
    expect(get).toHaveBeenNthCalledWith(1, '/api/user');
    expect(get).toHaveBeenNthCalledWith(2, '/api/user/u1');
    expect(user).toEqual({ id: 'u1', name: 'Ada' });
  });

  it('rejects (and does not swallow) when /api/session fails', async () => {
    post.mockRejectedValue(new Error('bad credential'));
    await expect(establishSession('cred')).rejects.toThrow('bad credential');
    expect(get).not.toHaveBeenCalled(); // never proceeds to load the user
  });
});

describe('nextSessionProbeState', () => {
  it('resets on success — never clears', () => {
    expect(nextSessionProbeState(5, true)).toEqual({
      failures: 0,
      clear: false,
    });
  });

  it('does NOT clear on a single failure (transient blip / in-flight refresh)', () => {
    expect(nextSessionProbeState(0, false)).toEqual({
      failures: 1,
      clear: false,
    });
  });

  it('clears once failures reach the threshold', () => {
    // Second consecutive failure hits the default threshold of 2.
    expect(nextSessionProbeState(1, false)).toEqual({
      failures: 2,
      clear: true,
    });
  });

  it('honors a custom threshold', () => {
    expect(nextSessionProbeState(2, false, 4)).toEqual({
      failures: 3,
      clear: false,
    });
  });
});
