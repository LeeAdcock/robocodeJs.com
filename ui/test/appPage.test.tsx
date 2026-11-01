// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
// The Ace editor is heavy/DOM-hungry; stub it so we test the page's wiring
// (loading source, rendering the editor + toolbar) rather than Ace itself.
vi.mock('../src/page/app/appEditor', () => ({
  default: (props: {
    code: string;
    clearMarkersSignal?: number;
    faultAnnotation?: unknown;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      data-testid="editor"
      data-clear-markers={props.clearMarkersSignal ?? 0}
      data-fault={props.faultAnnotation ? 'set' : 'none'}
      defaultValue={props.code}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
  // The toolbar and page import these bounds from appEditor; the real module
  // pulls in Ace, so the mock supplies them directly.
  EDITOR_FONT_MIN: 8,
  EDITOR_FONT_MAX: 30,
  EDITOR_FONT_DEFAULT: 12,
}));
import axios from 'axios';
import AppPage, { EMPTY_SAVE_PROMPT } from '../src/page/app/appPage';

const emitter = { addListener: vi.fn(), removeListener: vi.fn() } as any;
const arena = { clock: { time: 0 }, apps: [] } as any;

// The docked log console subscribes to the shared /arena/logs SSE stream.
class FakeEventSource {
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close() {
    /* no-op */
  }
}

describe('AppPage (bot editor)', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(axios.put).mockResolvedValue({ data: {} } as never);
    vi.mocked(axios.post).mockResolvedValue({ data: {} } as never);
    vi.mocked(axios.get).mockImplementation((url: string) =>
      url.endsWith('/source')
        ? (Promise.resolve({ data: 'bot.setName("x")' }) as never)
        : (Promise.resolve({ data: { id: 'a1', name: 'My Bot' } }) as never)
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={['/user/u1/app/a1']}>
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

  it('mounts, loads the bot source, and renders the editor', async () => {
    renderPage();

    const editor = (await screen.findByTestId('editor')) as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    expect(axios.get).toHaveBeenCalledWith('/api/user/u1/app/a1/source');
  });

  it('zooms the editor font in and out and persists the size', async () => {
    renderPage();
    await screen.findByTestId('editor');

    // The reset button doubles as the current-size indicator (default 12).
    const reset = screen.getByLabelText('Reset text size');
    expect(reset.textContent).toBe('12');

    fireEvent.click(screen.getByLabelText('Larger text'));
    expect(reset.textContent).toBe('13');
    expect(localStorage.getItem('editorFontSize')).toBe('13');

    fireEvent.click(screen.getByLabelText('Smaller text'));
    fireEvent.click(screen.getByLabelText('Smaller text'));
    expect(reset.textContent).toBe('11');

    // Reset returns to the default and persists it.
    fireEvent.click(reset);
    expect(reset.textContent).toBe('12');
    expect(localStorage.getItem('editorFontSize')).toBe('12');
  });

  it('restores the persisted font size on mount', async () => {
    localStorage.setItem('editorFontSize', '18');
    renderPage();
    await screen.findByTestId('editor');
    expect(screen.getByLabelText('Reset text size').textContent).toBe('18');
  });

  it('deleting the app (after confirming) redirects to the homepage, not a stub route', async () => {
    vi.mocked(axios.delete).mockResolvedValue({ data: {} } as never);
    renderPage();
    await screen.findByTestId('editor');

    // First click only opens the confirmation; delete fires on confirm.
    fireEvent.click(screen.getByLabelText('Delete app'));
    fireEvent.click(screen.getByLabelText('Confirm delete app'));

    expect(axios.delete).toHaveBeenCalledWith('/api/user/u1/app/a1');
    // Lands on the homepage ('/'), not the old '/user/:userId' placeholder.
    expect(await screen.findByTestId('home')).toBeTruthy();
  });

  it('share button copies the /add-app link and shows a copied notice', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPage();
    await screen.findByTestId('editor');

    fireEvent.click(screen.getByLabelText('Copy share link'));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('/add-app/a1')
    );
    expect(
      await screen.findByText('Share link copied to your clipboard.')
    ).toBeTruthy();
  });

  it('the visibility switch publishes the app and reflects the server-confirmed state', async () => {
    // GitHub #117: the app loads private; flipping the switch PUTs the new
    // state and only then shows Public (and says what public means).
    renderPage();
    await screen.findByTestId('editor');
    const toggle = (await screen.findByLabelText(
      'Public source'
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(axios.put).toHaveBeenCalledWith('/api/user/u1/app/a1/visibility', {
      public: true,
    });
    expect(await screen.findByText(/This app is now public/)).toBeTruthy();
    expect(
      (screen.getByLabelText('Public source') as HTMLInputElement).checked
    ).toBe(true);
  });

  it('a failed visibility change leaves the switch where it was', async () => {
    vi.mocked(axios.put).mockRejectedValueOnce(new Error('offline'));
    renderPage();
    await screen.findByTestId('editor');
    fireEvent.click(await screen.findByLabelText('Public source'));
    expect(
      await screen.findByText(/Could not change the app’s visibility/)
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Public source') as HTMLInputElement).checked
    ).toBe(false);
  });

  it('does NOT re-save the just-loaded source when the debounce elapses', async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      // Flush the source/app GETs (sets code + the "already saved" ref), then
      // let the 30s debounce elapse. The loaded source equals what's on the
      // server, so the auto-save must be skipped — no round-trip on open.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30000);
      expect(axios.put).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-saves after a real edit once the debounce elapses', async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      // Let the initial load settle before editing.
      await vi.advanceTimersByTimeAsync(0);
      const editor = screen.getByTestId('editor') as HTMLTextAreaElement;
      fireEvent.change(editor, { target: { value: 'bot.turn(90)' } });
      await vi.advanceTimersByTimeAsync(30000);
      expect(axios.put).toHaveBeenCalledWith(
        '/api/user/u1/app/a1/source',
        'bot.turn(90)',
        { headers: { 'content-type': 'application/octet-stream' } }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks the buffer against the server: saved → unsaved on edit → saved once the auto-save lands', async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      await vi.advanceTimersByTimeAsync(0);
      // The just-loaded source is what the arena is running.
      expect(screen.getByRole('status').textContent).toBe('Saved and Deployed');

      fireEvent.change(screen.getByTestId('editor'), {
        target: { value: 'bot.turn(90)' },
      });
      expect(screen.getByRole('status').textContent).toBe('Unsaved changes');

      // act() so React flushes the re-render the resolved PUT triggers.
      await act(() => vi.advanceTimersByTimeAsync(30000));
      expect(screen.getByRole('status').textContent).toBe('Saved and Deployed');
      expect(screen.getByText('Saved automatically.')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deploying saves, compiles, and confirms the arena has the new code', async () => {
    renderPage();
    await screen.findByTestId('editor');
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'bot.turn(90)' },
    });

    fireEvent.click(screen.getByLabelText('Deploy bot'));

    expect(
      await screen.findByText('Saved. The arena is running your latest code.')
    ).toBeTruthy();
    expect(axios.put).toHaveBeenCalledWith(
      '/api/user/u1/app/a1/source',
      'bot.turn(90)',
      { headers: { 'content-type': 'application/octet-stream' } }
    );
    expect(axios.post).toHaveBeenCalledWith('/api/user/u1/app/a1/compile');
    expect(screen.getByRole('status').textContent).toBe('Saved and Deployed');
  });

  it('a failed save keeps the editor honest — still "Unsaved changes", with an error', async () => {
    vi.mocked(axios.put).mockRejectedValue(new Error('offline') as never);
    renderPage();
    await screen.findByTestId('editor');
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'bot.turn(90)' },
    });

    fireEvent.click(screen.getByLabelText('Deploy bot'));

    expect(
      await screen.findByText(
        'Could not save your changes. Check your connection.'
      )
    ).toBeTruthy();
    // The save failed, so the arena is NOT running this code — never claim it is.
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('reformatting confirms what it did, and distinguishes a no-op tidy', async () => {
    renderPage();
    await screen.findByTestId('editor');
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'bot.turn( 90 )' },
    });

    fireEvent.click(screen.getByLabelText('Reformat code'));
    expect(await screen.findByText('Code reformatted.')).toBeTruthy();

    // Already-tidy code isn't a failure, but saying "reformatted" would be a
    // lie — nothing changed.
    fireEvent.click(screen.getByLabelText('Reformat code'));
    expect(await screen.findByText('Code is already tidy.')).toBeTruthy();
  });

  it('reformatting unparseable code says so instead of silently doing nothing', async () => {
    renderPage();
    await screen.findByTestId('editor');
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'bot.turn(' },
    });

    fireEvent.click(screen.getByLabelText('Reformat code'));

    expect(await screen.findByText(/Could not reformat/)).toBeTruthy();
  });

  it('a clean recompile hides the previous error and clears editor markers', async () => {
    renderPage();
    const editor = (await screen.findByTestId('editor')) as HTMLTextAreaElement;
    const check = screen.getByLabelText('Check for errors');
    const markersBefore = editor.getAttribute('data-clear-markers');

    // First Check fails → the red banner shows the code + message.
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        valid: false,
        errorCode: 'E017',
        message: 'Unexpected end of input (line 1, char 12)',
      },
    } as never);
    fireEvent.click(check);
    expect(
      await screen.findByText(/E017: Unexpected end of input/)
    ).toBeTruthy();

    // Second Check is clean → banner gone, success notice shown, and the editor
    // is told to clear its gutter markers.
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { valid: true },
    } as never);
    fireEvent.click(check);
    expect(await screen.findByText('No errors found.')).toBeTruthy();
    expect(screen.queryByText(/E017:/)).toBeNull();
    expect(editor.getAttribute('data-clear-markers')).not.toBe(markersBefore);
  });

  describe('never silently saves an empty buffer over saved code', () => {
    // The stub is an uncontrolled textarea whose DOM value starts at '', and
    // React ignores a change to the value the node already holds, so type
    // something first and then clear it (select-all + delete).
    const clearEditor = () => {
      const editor = screen.getByTestId('editor');
      fireEvent.change(editor, { target: { value: 'x' } });
      fireEvent.change(editor, { target: { value: '' } });
    };
    const sourcePuts = () =>
      vi
        .mocked(axios.put)
        .mock.calls.filter(([url]) => url === '/api/user/u1/app/a1/source');

    afterEach(() => vi.restoreAllMocks());

    it('does not auto-save a cleared editor over the stored code', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      vi.useFakeTimers();
      try {
        renderPage();
        await vi.advanceTimersByTimeAsync(0);
        clearEditor();
        await vi.advanceTimersByTimeAsync(60000);
        expect(axios.put).not.toHaveBeenCalled();
        // Auto-save skips quietly; it never pops a prompt on its own.
        expect(confirm).not.toHaveBeenCalled();
        expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
      } finally {
        vi.useRealTimers();
      }
    });

    it('asks before Deploy erases the code, and declining saves and compiles nothing', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      renderPage();
      await screen.findByTestId('editor');
      await act(async () => undefined);
      clearEditor();

      fireEvent.click(screen.getByLabelText('Deploy bot'));
      await act(async () => undefined);

      expect(confirm).toHaveBeenCalledWith(EMPTY_SAVE_PROMPT);
      expect(sourcePuts()).toHaveLength(0);
      expect(axios.post).not.toHaveBeenCalled();
      expect(screen.queryByText(/Could not save/)).toBeNull();
    });

    it('declining on Reboot saves nothing and does not reboot', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      renderPage();
      await screen.findByTestId('editor');
      await act(async () => undefined);
      clearEditor();

      fireEvent.click(screen.getByLabelText('Reboot bot'));
      await act(async () => undefined);

      expect(sourcePuts()).toHaveLength(0);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('saves the empty app and deploys once the user confirms', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderPage();
      await screen.findByTestId('editor');
      await act(async () => undefined);
      clearEditor();

      fireEvent.click(screen.getByLabelText('Deploy bot'));

      expect(
        await screen.findByText('Saved. The arena is running your latest code.')
      ).toBeTruthy();
      expect(sourcePuts()).toEqual([
        [
          '/api/user/u1/app/a1/source',
          '',
          { headers: { 'content-type': 'application/octet-stream' } },
        ],
      ]);
      expect(axios.post).toHaveBeenCalledWith('/api/user/u1/app/a1/compile');
    });

    it('does not prompt for an ordinary non-empty save', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      renderPage();
      await screen.findByTestId('editor');
      fireEvent.change(screen.getByTestId('editor'), {
        target: { value: 'bot.turn(90)' },
      });

      fireEvent.click(screen.getByLabelText('Deploy bot'));

      expect(
        await screen.findByText('Saved. The arena is running your latest code.')
      ).toBeTruthy();
      expect(confirm).not.toHaveBeenCalled();
    });

    it('does not prompt when the app was already empty (nothing to erase)', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      vi.mocked(axios.get).mockImplementation((url: string) =>
        url.endsWith('/source')
          ? (Promise.resolve({ data: '' }) as never)
          : (Promise.resolve({ data: { id: 'a1', name: 'New' } }) as never)
      );
      renderPage();
      await screen.findByTestId('editor');
      await act(async () => undefined);

      fireEvent.click(screen.getByLabelText('Deploy bot'));

      expect(
        await screen.findByText('Saved. The arena is running your latest code.')
      ).toBeTruthy();
      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
