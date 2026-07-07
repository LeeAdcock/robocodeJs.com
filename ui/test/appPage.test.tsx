// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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
  }) => (
    <textarea
      data-testid="editor"
      data-clear-markers={props.clearMarkersSignal ?? 0}
      data-fault={props.faultAnnotation ? 'set' : 'none'}
      defaultValue={props.code}
    />
  ),
  // The toolbar and page import these bounds from appEditor; the real module
  // pulls in Ace, so the mock supplies them directly.
  EDITOR_FONT_MIN: 8,
  EDITOR_FONT_MAX: 30,
  EDITOR_FONT_DEFAULT: 12,
}));
import axios from 'axios';
import AppPage from '../src/page/app/appPage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const emitter = { addListener: vi.fn(), removeListener: vi.fn() } as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arena = { clock: { time: 0 }, apps: [] } as any;

describe('AppPage (bot editor)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(axios.get).mockImplementation((url: string) =>
      url.endsWith('/source')
        ? (Promise.resolve({ data: 'bot.setName("x")' }) as never)
        : (Promise.resolve({ data: { id: 'a1', name: 'My Bot' } }) as never)
    );
  });
  afterEach(cleanup);

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
});
