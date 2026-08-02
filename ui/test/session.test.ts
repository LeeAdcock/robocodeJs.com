// @vitest-environment jsdom
// jsdom (not the default node env) because the deliberate-sign-out record is
// backed by window.localStorage.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// establishSession drives axios directly; mock it so we can assert the call
// sequence without a server. nextSessionProbeState is pure.
vi.mock('axios', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));
import axios from 'axios';
import {
  establishSession,
  nextSessionProbeState,
  classifyCredential,
  shouldAcceptCredential,
  isSignedOutDeliberately,
  markSignedOut,
  clearSignedOut,
} from '../src/util/session';

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

describe('classifyCredential', () => {
  it("treats select_by 'auto' as an automatic credential", () => {
    expect(classifyCredential('auto')).toBe('auto');
  });

  it('treats every user-driven select_by as interactive', () => {
    for (const s of ['btn', 'btn_confirm', 'user', 'user_1tap', 'user_2tap']) {
      expect(classifyCredential(s)).toBe('interactive');
    }
  });

  it('defaults to interactive when GIS reports nothing', () => {
    // Fail safe: an unknown credential is treated as user-chosen, so a real
    // sign-in is never silently dropped.
    expect(classifyCredential(undefined)).toBe('interactive');
  });
});

describe('shouldAcceptCredential', () => {
  it('accepts an automatic credential when the user has not signed out', () => {
    expect(shouldAcceptCredential('auto', false)).toBe(true);
  });

  it('REFUSES an automatic credential after a deliberate sign-out', () => {
    // The logout regression: One Tap auto-select re-signed the user in ~30s
    // after they clicked Sign out.
    expect(shouldAcceptCredential('auto', true)).toBe(false);
  });

  it('always accepts a credential the user actively chose', () => {
    expect(shouldAcceptCredential('interactive', true)).toBe(true);
    expect(shouldAcceptCredential('interactive', false)).toBe(true);
  });
});

describe('deliberate sign-out record', () => {
  beforeEach(() => window.localStorage.clear());

  it('is not set by default', () => {
    expect(isSignedOutDeliberately()).toBe(false);
  });

  it('round-trips through mark → clear', () => {
    markSignedOut();
    expect(isSignedOutDeliberately()).toBe(true);
    clearSignedOut();
    expect(isSignedOutDeliberately()).toBe(false);
  });

  it('survives a reload (persisted, not in-memory)', () => {
    markSignedOut();
    // A fresh read is all a reload does — the value lives in localStorage.
    expect(window.localStorage.getItem('robocodejs.signedOut')).toBe('1');
    expect(isSignedOutDeliberately()).toBe(true);
  });

  it('degrades quietly when storage throws (private mode / blocked cookies)', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage disabled');
      });
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage disabled');
      });

    // Neither throws, and an unreadable record reads as "not signed out" so
    // sign-in is never blocked by a storage failure.
    expect(() => markSignedOut()).not.toThrow();
    expect(isSignedOutDeliberately()).toBe(false);

    setItem.mockRestore();
    getItem.mockRestore();
  });
});
