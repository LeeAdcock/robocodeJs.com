// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Ace } from 'ace-builds';
import CodeEditor from '../src/page/app/appEditor';

// Drives the REAL react-ace + Ace (not a stub): the bug this guards against
// lives in react-ace itself, which binds `commands` once on mount and never
// re-binds them. A command closing over the first render's props therefore ran
// stale handlers forever, and Ctrl-S saved the initial empty buffer over the
// user's code. Only the real library reproduces that.

type Handlers = {
  doExecute: () => void;
  doReboot: () => void;
  doClean: () => void;
  doCheck: () => void;
  doZoomIn: () => void;
  doZoomOut: () => void;
  doZoomReset: () => void;
};

const handlers = (): Handlers => ({
  doExecute: vi.fn(),
  doReboot: vi.fn(),
  doClean: vi.fn(),
  doCheck: vi.fn(),
  doZoomIn: vi.fn(),
  doZoomOut: vi.fn(),
  doZoomReset: vi.fn(),
});

const editorProps = (h: Handlers, code: string) => ({
  ...h,
  code,
  onChange: vi.fn(),
  fontSize: 12,
});

// The Ace instance react-ace mounted (Ace keeps it on the element's `env`).
const aceEditor = (container: HTMLElement): Ace.Editor => {
  const el = container.querySelector('.ace_editor') as unknown as {
    env: { editor: Ace.Editor };
  };
  return el.env.editor;
};

// Each shortcut, the command name it is registered under, and its handler.
const SHORTCUTS: [string, keyof Handlers][] = [
  ['save', 'doExecute'],
  ['saveAndReboot', 'doReboot'],
  ['clean', 'doClean'],
  ['check', 'doCheck'],
  ['zoomIn', 'doZoomIn'],
  ['zoomOut', 'doZoomOut'],
  ['zoomReset', 'doZoomReset'],
];

describe('CodeEditor keyboard shortcuts', () => {
  afterEach(cleanup);

  it.each(SHORTCUTS)(
    '%s runs the latest %s, not the one from the first render',
    (command, handler) => {
      const first = handlers();
      const latest = handlers();
      const { container, rerender } = render(
        <CodeEditor {...editorProps(first, '')} />
      );
      // The page re-renders with fresh handlers whenever its code changes
      // (e.g. once the app's source loads).
      rerender(<CodeEditor {...editorProps(latest, 'bot.setName("x")')} />);

      const editor = aceEditor(container);
      editor.commands.exec(command, editor, {});

      expect(latest[handler]).toHaveBeenCalledTimes(1);
      expect(first[handler]).not.toHaveBeenCalled();
    }
  );

  it('binds Ctrl-S / Cmd-S to the save command', () => {
    const { container } = render(
      <CodeEditor {...editorProps(handlers(), '')} />
    );
    const save = aceEditor(container).commands.byName.save;
    expect(save.bindKey).toEqual({ win: 'Ctrl-S', mac: 'Cmd-S' });
  });
});
