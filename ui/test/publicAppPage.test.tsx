// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));
// The read-only Ace editor is heavy; stub it to a <pre> so the page's wiring
// (fetch, header, actions) is what's under test.
vi.mock('../src/page/sample/sampleEditor', () => ({
  default: (props: { code: string }) => (
    <pre data-testid="source">{props.code}</pre>
  ),
}));
vi.mock('../src/page/app/appEditor', () => ({
  default: () => null,
  EDITOR_FONT_MIN: 8,
  EDITOR_FONT_MAX: 30,
  EDITOR_FONT_DEFAULT: 12,
}));
import axios from 'axios';
import PublicAppPage from '../src/page/app/publicAppPage';

const publicApp = {
  id: 'a2',
  name: 'skirmisher',
  ownerName: 'Dana K.',
  rating: 1655,
  games: 20,
  wins: 9,
  source: 'bot.setName("Skirmisher")',
  version: 'abc',
};

const user: any = { id: 'u1', name: 'Me', apps: [] };

// GET routing: the public app itself, and the viewer's roster (room to clone).
const setApi = (opts: { app?: unknown; members?: unknown[] } = {}) =>
  vi.mocked(axios.get).mockImplementation((url: string) => {
    if (url.startsWith('/api/public/app/'))
      return opts.app === undefined
        ? Promise.reject({ response: { status: 404 } })
        : (Promise.resolve({ data: opts.app }) as never);
    if (url.endsWith('/arena/members'))
      return Promise.resolve({ data: opts.members ?? [] } as never);
    return Promise.resolve({ data: {} } as never);
  });

const renderAt = (props: { user: any; onCloned?: () => void }) =>
  render(
    <MemoryRouter initialEntries={['/app/a2']}>
      <Routes>
        <Route path="/app/:appId" element={<PublicAppPage {...props} />} />
        <Route path="/add-app/:appId" element={<div>add-app page</div>} />
        <Route path="/user/:userId/app/:appId" element={<div>editor</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setApi({ app: publicApp });
  vi.mocked(axios.post).mockResolvedValue({ data: { appId: 'new1' } } as never);
  vi.mocked(axios.put).mockResolvedValue({ data: {} } as never);
});
afterEach(cleanup);

describe('PublicAppPage', () => {
  it('loads the public app anonymously and shows its source and record', async () => {
    renderAt({ user: null });
    expect(await screen.findByTestId('source')).toHaveProperty(
      'textContent',
      publicApp.source
    );
    expect(axios.get).toHaveBeenCalledWith('/api/public/app/a2');
    expect(screen.getByText('Skirmisher')).toBeTruthy();
    expect(screen.getByText(/by Dana K\./)).toBeTruthy();
    // The header is name + author only; the record stays on the rankings page.
    expect(screen.queryByText(/rating/)).toBeNull();
    expect(screen.queryByText(/ranked wins/)).toBeNull();
    // Signed out: no roster lookup, and the actions explain why they're off.
    expect(axios.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/arena/members')
    );
    expect(
      (screen.getByLabelText('Clone this bot') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByLabelText('Add to my arena') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText(/Sign in/)).toBeTruthy();
  });

  it('shows a not-found message for a private or unknown app', async () => {
    setApi({});
    renderAt({ user: null });
    expect(await screen.findByText('App not found')).toBeTruthy();
    expect(screen.queryByTestId('source')).toBeNull();
  });

  it('"Add to my arena" hands a signed-in viewer to the share-link page', async () => {
    renderAt({ user });
    await screen.findByTestId('source');
    // Its tooltip wrapper is a nested btn-group, so the button keeps grouped
    // corners next to Download instead of rendering as a lone rounded pill.
    expect(
      screen.getByLabelText('Add to my arena').parentElement?.className
    ).toContain('btn-group');
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Add to my arena') as HTMLButtonElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByLabelText('Add to my arena'));
    expect(await screen.findByText('add-app page')).toBeTruthy();
  });

  it('clones the public source into a new app for a signed-in viewer with room', async () => {
    const onCloned = vi.fn();
    renderAt({ user, onCloned });
    await screen.findByTestId('source');
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Clone this bot') as HTMLButtonElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByLabelText('Clone this bot'));

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('/api/user/u1/app')
    );
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith(
        '/api/user/u1/app/new1/source',
        publicApp.source,
        expect.anything()
      )
    );
    expect(axios.put).toHaveBeenCalledWith('/api/user/u1/arena/app/new1');
    expect(await screen.findByText('editor')).toBeTruthy();
    expect(onCloned).toHaveBeenCalled();
  });

  it('disables cloning when the arena is full', async () => {
    setApi({
      app: publicApp,
      members: [{}, {}, {}, {}, {}],
    });
    renderAt({ user });
    await screen.findByTestId('source');
    expect(await screen.findByText(/Arena full/)).toBeTruthy();
    expect(
      (screen.getByLabelText('Clone this bot') as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
