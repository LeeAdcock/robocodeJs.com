// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

// The editor page's guarantees that a user's code is never lost or written
// into the wrong app: across app switches, before the source has loaded, on
// leaving the page, and on closing the tab. The server keeps no history of
// app source, so every one of these writes would be unrecoverable.

vi.mock('axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
// Stub Ace: these tests are about the page's save logic. A controlled
// textarea, so the stub shows whichever app's buffer the page holds.
vi.mock('../src/page/app/appEditor', () => ({
  default: (props: { code: string; onChange?: (value: string) => void }) => (
    <textarea
      data-testid="editor"
      value={props.code}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
  EDITOR_FONT_MIN: 8,
  EDITOR_FONT_MAX: 30,
  EDITOR_FONT_DEFAULT: 12,
}));
import axios from 'axios';
import AppPage from '../src/page/app/appPage';

const emitter = { addListener: vi.fn(), removeListener: vi.fn() } as any;
const arena = { clock: { time: 0 }, apps: [] } as any;

class FakeEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  close() {
    /* no-op */
  }
}

const SOURCES: Record<string, string> = {
  a1: 'bot.setName("One")',
  a2: 'bot.setName("Two")',
};

// Per-app source GETs; an app listed in `held` stays pending until released.
let held: Record<string, (data: string) => void> = {};
let hold = new Set<string>();

// Navigation buttons rendered outside the page, as the navbar's app list is.
function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/user/u1/app/a2')}>to a2</button>
      <button onClick={() => navigate('/')}>home</button>
    </>
  );
}

const renderPage = (initial = '/user/u1/app/a1') =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Nav />
      <Routes>
        <Route path="/" element={<div data-testid="home">home</div>} />
        <Route
          path="/user/:userId/app/:appId"
          element={
            <AppPage
              arena={arena}
              doDelete={() => undefined}
              emitter={emitter}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );

const editor = () => screen.getByTestId('editor') as HTMLTextAreaElement;
const edit = (value: string) =>
  fireEvent.change(editor(), { target: { value } });
const putsTo = (appId: string) =>
  vi
    .mocked(axios.put)
    .mock.calls.filter(([url]) => url === `/api/user/u1/app/${appId}/source`)
    .map(([, body]) => body);
const loaded = (source: string) =>
  waitFor(() => expect(editor().value).toBe(source));

describe('AppPage never loses or misdirects source', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    localStorage.clear();
    vi.clearAllMocks();
    held = {};
    hold = new Set();
    vi.mocked(axios.put).mockResolvedValue({ data: {} } as never);
    vi.mocked(axios.post).mockResolvedValue({ data: {} } as never);
    vi.mocked(axios.delete).mockResolvedValue({ data: {} } as never);
    vi.mocked(axios.get).mockImplementation((url: string) => {
      const appId = url.split('/')[5];
      if (!url.endsWith('/source'))
        return Promise.resolve({ data: { id: appId, name: appId } }) as never;
      if (hold.has(appId))
        return new Promise((resolve) => {
          held[appId] = (data) => resolve({ data });
        }) as never;
      return Promise.resolve({ data: SOURCES[appId] }) as never;
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('switching apps', () => {
    it('flushes the unsaved edit to the app it belongs to', async () => {
      renderPage();
      await loaded(SOURCES.a1);
      edit('bot.turn(1)');

      fireEvent.click(screen.getByText('to a2'));
      await loaded(SOURCES.a2);

      expect(putsTo('a1')).toEqual(['bot.turn(1)']);
      expect(putsTo('a2')).toEqual([]);
    });

    it('never shows or saves the previous app’s code in the next app', async () => {
      hold.add('a2');
      renderPage();
      await loaded(SOURCES.a1);
      edit('bot.turn(1)');

      fireEvent.click(screen.getByText('to a2'));
      // a2's source is still loading: the buffer must not be a1's code, and
      // Deploy must not write anything into a2.
      await waitFor(() => expect(editor().value).toBe(''));
      fireEvent.click(screen.getByLabelText('Deploy bot'));
      await act(async () => undefined);
      expect(putsTo('a2')).toEqual([]);
      expect(axios.post).not.toHaveBeenCalled();

      await act(async () => held.a2(SOURCES.a2));
      await loaded(SOURCES.a2);
      expect(putsTo('a2')).toEqual([]);
    });

    it('does not flush when nothing changed', async () => {
      renderPage();
      await loaded(SOURCES.a1);
      fireEvent.click(screen.getByText('to a2'));
      await loaded(SOURCES.a2);
      expect(axios.put).not.toHaveBeenCalled();
    });
  });

  describe('before the source has loaded', () => {
    it('Deploy writes nothing (the empty buffer is not the app’s code)', async () => {
      hold.add('a1');
      renderPage();
      await screen.findByTestId('editor');

      fireEvent.click(screen.getByLabelText('Deploy bot'));
      fireEvent.click(screen.getByLabelText('Reboot bot'));
      await act(async () => undefined);

      expect(axios.put).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('leaving writes nothing', async () => {
      hold.add('a1');
      renderPage();
      await screen.findByTestId('editor');
      fireEvent.click(screen.getByText('home'));
      await screen.findByTestId('home');
      expect(axios.put).not.toHaveBeenCalled();
    });
  });

  describe('leaving the editor', () => {
    it('flushes an unsaved edit when navigating to another page', async () => {
      renderPage();
      await loaded(SOURCES.a1);
      edit('bot.turn(2)');

      fireEvent.click(screen.getByText('home'));
      await screen.findByTestId('home');

      expect(putsTo('a1')).toEqual(['bot.turn(2)']);
    });

    it('does not flush a cleared editor over the saved code', async () => {
      renderPage();
      await loaded(SOURCES.a1);
      edit('');

      fireEvent.click(screen.getByText('home'));
      await screen.findByTestId('home');

      expect(axios.put).not.toHaveBeenCalled();
    });

    it('does not re-save an app that was just deleted', async () => {
      renderPage();
      await loaded(SOURCES.a1);
      edit('bot.turn(3)');

      fireEvent.click(screen.getByLabelText('Delete app'));
      fireEvent.click(screen.getByLabelText('Confirm delete app'));
      await screen.findByTestId('home');

      expect(axios.delete).toHaveBeenCalledWith('/api/user/u1/app/a1');
      expect(axios.put).not.toHaveBeenCalled();
    });

    it('still flushes after a delete that failed', async () => {
      vi.mocked(axios.delete).mockRejectedValue(new Error('500') as never);
      renderPage();
      await loaded(SOURCES.a1);
      edit('bot.turn(4)');

      fireEvent.click(screen.getByLabelText('Delete app'));
      fireEvent.click(screen.getByLabelText('Confirm delete app'));
      await act(async () => undefined);
      fireEvent.click(screen.getByText('home'));
      await screen.findByTestId('home');

      expect(putsTo('a1')).toEqual(['bot.turn(4)']);
    });
  });

  describe('closing the tab', () => {
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };

    it('warns while there are unsaved changes', async () => {
      renderPage();
      await loaded(SOURCES.a1);
      expect(unload()).toBe(false);

      edit('bot.turn(5)');
      expect(unload()).toBe(true);
    });

    it('stops warning once the change is saved', async () => {
      renderPage();
      await loaded(SOURCES.a1);
      edit('bot.turn(5)');

      fireEvent.click(screen.getByLabelText('Deploy bot'));
      await screen.findByText('Saved. The arena is running your latest code.');

      expect(unload()).toBe(false);
    });
  });
});
