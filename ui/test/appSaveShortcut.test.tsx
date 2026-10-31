// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Ace } from 'ace-builds';

vi.mock('axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
import axios from 'axios';
import AppPage from '../src/page/app/appPage';

// End-to-end over the real editor (react-ace + Ace, unstubbed): open an app,
// let its source load, press the save shortcut, and assert what reaches the
// server. In production the shortcut used to PUT an empty body here, wiping
// the app's code (the first render's handler, holding the initial '' buffer).

const SOURCE = 'bot.setName("Keeper")\nbot.turn(90)\n';

const emitter = { addListener: vi.fn(), removeListener: vi.fn() } as any;
const arena = { clock: { time: 0 }, apps: [] } as any;

class FakeEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  close() {
    /* no-op */
  }
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/user/u1/app/a1']}>
      <Routes>
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

// Resolves once Ace has mounted and shows the loaded source.
const loadedEditor = async (): Promise<Ace.Editor> => {
  let editor: Ace.Editor | undefined;
  await waitFor(() => {
    const el = document.querySelector('.ace_editor') as unknown as {
      env?: { editor: Ace.Editor };
    } | null;
    editor = el?.env?.editor;
    expect(editor?.getValue()).toBe(SOURCE);
  });
  return editor!;
};

const sourcePuts = () =>
  vi
    .mocked(axios.put)
    .mock.calls.filter(([url]) => url === '/api/user/u1/app/a1/source');

describe('AppPage save shortcuts over the real editor', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(axios.put).mockResolvedValue({ data: {} } as never);
    vi.mocked(axios.post).mockResolvedValue({ data: {} } as never);
    vi.mocked(axios.get).mockImplementation((url: string) =>
      url.endsWith('/source')
        ? (Promise.resolve({ data: SOURCE }) as never)
        : (Promise.resolve({ data: { id: 'a1', name: 'Keeper' } }) as never)
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Ctrl-S saves the loaded source, not an empty buffer, then deploys', async () => {
    renderPage();
    const editor = await loadedEditor();

    editor.commands.exec('save', editor, {});

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('/api/user/u1/app/a1/compile')
    );
    expect(sourcePuts()).toEqual([
      [
        '/api/user/u1/app/a1/source',
        SOURCE,
        { headers: { 'content-type': 'application/octet-stream' } },
      ],
    ]);
  });

  it('Ctrl-S saves edits made after the load', async () => {
    renderPage();
    const editor = await loadedEditor();
    // A keystroke is its own event, so React re-renders before the shortcut.
    await act(async () => {
      editor.setValue('bot.turn(180)\n', 1);
    });

    editor.commands.exec('save', editor, {});

    await waitFor(() => expect(sourcePuts()).toHaveLength(1));
    expect(sourcePuts()[0][1]).toBe('bot.turn(180)\n');
  });

  it('Ctrl-Shift-S saves the loaded source, then reboots', async () => {
    renderPage();
    const editor = await loadedEditor();

    editor.commands.exec('saveAndReboot', editor, {});

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('/api/user/u1/app/a1/reboot')
    );
    expect(sourcePuts()).toHaveLength(1);
    expect(sourcePuts()[0][1]).toBe(SOURCE);
  });

  it('Ctrl-S on a cleared editor asks before erasing, and declining saves nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const editor = await loadedEditor();
    await act(async () => {
      editor.setValue('', 1);
    });

    editor.commands.exec('save', editor, {});

    expect(confirm).toHaveBeenCalledTimes(1);
    // Give any (wrongly) queued save/compile a chance to land.
    await new Promise((r) => setTimeout(r, 20));
    expect(sourcePuts()).toHaveLength(0);
    expect(axios.post).not.toHaveBeenCalled();
    expect(screen.queryByText(/Could not save/)).toBeNull();
  });
});
