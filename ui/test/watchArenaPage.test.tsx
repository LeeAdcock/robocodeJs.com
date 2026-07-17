// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Network + streaming are stubbed so the page mounts in isolation. The value is
// catching crash-on-render regressions and confirming the public watch page hits
// the unauthenticated /api/arena/:arenaId endpoints (not the signed-in ones).
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import axios from 'axios';
import WatchArenaPage from '../src/page/watch/watchArenaPage';
import { setDarkMode } from '../src/util/theme';

class FakeEventSource {
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close() {
    /* no-op */
  }
  addEventListener() {
    /* no-op */
  }
}

describe('WatchArenaPage', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setDarkMode(false);
    document.body.classList.remove('dark');
    vi.clearAllMocks();
  });

  it('renders the arena and streams from the PUBLIC /api/arena/:id endpoints', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { id: 'arena-9', clock: { time: 0 }, apps: [], running: true },
    } as never);

    const { container } = render(<WatchArenaPage arenaId="arena-9" />);

    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith('/api/arena/arena-9')
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('overlays the roster legend (swatch + name per app) on the spectator board', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        id: 'arena-9',
        clock: { time: 0 },
        apps: [{ id: 'a0', name: 'tracker', bots: [] }],
        running: true,
      },
    } as never);

    const { findByText, container } = render(
      <WatchArenaPage arenaId="arena-9" />
    );

    expect(await findByText('Tracker')).toBeTruthy();
    // The arena SVG uses <image href>, so the only <img> is the legend swatch —
    // app index 0 maps to the 'blue' hue.
    const swatch = container.querySelector('img');
    expect(swatch?.getAttribute('src')).toContain('tank_blue.png');
  });

  it('shows a not-found message when the arena snapshot 404s', async () => {
    vi.mocked(axios.get).mockRejectedValue({
      response: { status: 404 },
    } as never);

    const { findByText } = render(<WatchArenaPage arenaId="gone" />);

    expect(await findByText(/not found/i)).toBeTruthy();
  });
});
