// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import ProfilePage from '../src/page/profile/profilePage';

// The server ships the whole catalog, so the page holds no per-badge knowledge —
// these fixtures stand in for it exactly as the API sends it.
const profile = {
  user: { name: 'Ada L.', picture: 'https://example.test/a.png' },
  catalog: [
    {
      id: 'ladder-flawless',
      scope: 'ladder',
      name: 'Flawless Victory',
      description: 'Win a ranked match without being hit.',
      icon: '✨',
    },
    {
      id: 'first-kill',
      scope: 'sandbox',
      name: 'First Kill',
      description: 'Destroy an enemy bot.',
      icon: '💥',
      counter: 'kills',
      threshold: 1,
    },
    {
      id: 'shots-1000',
      scope: 'sandbox',
      name: 'Trigger Happy',
      description: 'Fire 1,000 shots.',
      icon: '🔫',
      counter: 'shotsFired',
      threshold: 1000,
    },
  ],
  unlocked: [
    {
      id: 'first-kill',
      appId: null,
      unlockedTimestamp: '2026-01-02T03:04:05.000Z',
    },
  ],
  counters: { kills: 3, shotsFired: 812 },
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.mocked(axios.get).mockReset();
});
afterEach(cleanup);

describe('ProfilePage', () => {
  it('loads the profile from the own-profile endpoint (no userId in the path)', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: profile });
    renderPage();
    await screen.findByText('First Kill');
    expect(axios.get).toHaveBeenCalledWith('/api/profile');
  });

  it('renders locked badges alongside earned ones', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: profile });
    renderPage();

    // Earned.
    await screen.findByLabelText('First Kill');
    // Still out there — showing these is the point of the page.
    expect(screen.getByLabelText('Locked: Trigger Happy')).toBeTruthy();
    expect(screen.getByLabelText('Locked: Flawless Victory')).toBeTruthy();
    expect(screen.getByText('1 of 3 earned')).toBeTruthy();
  });

  it('shows progress toward a locked counter badge', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: profile });
    renderPage();
    expect(await screen.findByText('812 / 1,000')).toBeTruthy();
  });

  it('groups badges by scope, explaining that ranked ones cannot be farmed', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: profile });
    renderPage();
    await screen.findByText('Ranked');
    expect(screen.getByText('Career')).toBeTruthy();
    expect(screen.getByText(/can’t be farmed/)).toBeTruthy();
  });

  it('omits a scope with no badges rather than rendering an empty heading', async () => {
    // Account badges land in a later slice; until then the group shouldn't appear.
    vi.mocked(axios.get).mockResolvedValue({ data: profile });
    renderPage();
    await screen.findByText('Ranked');
    expect(screen.queryByText('Milestones')).toBeNull();
  });

  it('prompts a signed-out visitor to sign in rather than showing an error', async () => {
    vi.mocked(axios.get).mockRejectedValue({ response: { status: 401 } });
    renderPage();
    expect(await screen.findByText(/Sign in to see the badges/)).toBeTruthy();
  });

  it('reports a real failure as an error', async () => {
    vi.mocked(axios.get).mockRejectedValue({ response: { status: 500 } });
    renderPage();
    expect(await screen.findByText('Could not load your badges.')).toBeTruthy();
  });

  it('shows a loading state before the profile arrives', () => {
    vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading your badges…')).toBeTruthy();
  });
});
