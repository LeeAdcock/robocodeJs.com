// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import Logs from '../src/page/arena/logs';

// jsdom doesn't implement Element.scrollTo; the log panel calls it when it
// re-renders to keep pinned to the bottom.
Element.prototype.scrollTo = () => {};

interface Entry {
  id: string;
  name: string;
  appId: string;
  botIndex: number;
  level: number;
  levelName: string;
  msg: string;
  time: number;
}
let seq = 0;
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: `e${seq++}`,
  name: '<11>',
  appId: 'a1',
  botIndex: 1,
  level: 30,
  levelName: 'info',
  msg: 'hi',
  time: 0,
  ...over,
});
const bots = [
  { id: 'a1', name: 'Bot A', botCount: 2, index: 0 },
  { id: 'a2', name: 'Bot B', botCount: 2, index: 1 },
];

afterEach(cleanup);

describe('Logs (per-bot filtering)', () => {
  it('selectedApp shows only the chosen bot’s messages', () => {
    render(
      <Logs
        bots={bots}
        selectedApp="a1"
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', msg: 'from A' }),
            entry({ appId: 'a2', msg: 'from B' }),
          ],
          index: 2,
        }}
      />
    );
    expect(screen.queryByText('from A')).toBeTruthy();
    expect(screen.queryByText('from B')).toBeNull();
  });

  it('selectedBot narrows to one bot instance and reflects it in the filter', () => {
    const { container } = render(
      <Logs
        bots={bots}
        selectedApp="a1"
        selectedBot={2}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', botIndex: 1, msg: 'a1 bot one' }),
            entry({ appId: 'a1', botIndex: 2, msg: 'a1 bot two' }),
            entry({ appId: 'a2', botIndex: 2, msg: 'a2 bot two' }),
          ],
          index: 3,
        }}
      />
    );
    // Only app a1's bot 2 is shown.
    expect(screen.queryByText('a1 bot two')).toBeTruthy();
    expect(screen.queryByText('a1 bot one')).toBeNull();
    expect(screen.queryByText('a2 bot two')).toBeNull();

    // ...and the Bots filter reflects it: only that bot's checkbox is checked.
    fireEvent.click(screen.getByText('Bots'));
    const selected = container.querySelector(
      '[id="bot-a1:2"]'
    ) as HTMLInputElement;
    const other = container.querySelector(
      '[id="bot-a1:1"]'
    ) as HTMLInputElement;
    expect(selected.checked).toBe(true);
    expect(other.checked).toBe(false);
  });

  it('labels a bot from its actual log name, not the computed index', () => {
    // index 5 would compute (5+1)*10+1 = 61, but the log name is authoritative.
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', botCount: 1, index: 5 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [entry({ appId: 'a1', botIndex: 1, name: '<99>', msg: 'x' })],
          index: 1,
        }}
      />
    );
    fireEvent.click(screen.getByText('Bots'));
    expect(screen.getByText('Bot 99')).toBeTruthy();
    expect(screen.queryByText('Bot 61')).toBeNull();
  });

  it('zooms the log font in and out and persists the size', () => {
    localStorage.clear();
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{ logs: [], index: 0 }}
      />
    );
    // The reset button doubles as the current-size indicator (default 12).
    const reset = screen.getByLabelText('Reset log text size');
    expect(reset.textContent).toBe('12');

    fireEvent.click(screen.getByLabelText('Larger log text'));
    expect(reset.textContent).toBe('13');
    expect(localStorage.getItem('logFontSize')).toBe('13');

    fireEvent.click(screen.getByLabelText('Smaller log text'));
    fireEvent.click(screen.getByLabelText('Smaller log text'));
    expect(reset.textContent).toBe('11');
  });

  it('lists all arena bots in the filter even before any logs arrive', () => {
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{ logs: [], index: 0 }}
      />
    );
    // Open the Bots dropdown; both names are present despite an empty log buffer.
    fireEvent.click(screen.getByText('Bots'));
    expect(screen.getByText('Bot A')).toBeTruthy();
    expect(screen.getByText('Bot B')).toBeTruthy();
  });

  it('can hide an individual bot (labelled by its bot id) within an application', () => {
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', botCount: 2, index: 0 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({
              appId: 'a1',
              botIndex: 1,
              name: '<11>',
              msg: 'from bot one',
            }),
            entry({
              appId: 'a1',
              botIndex: 2,
              name: '<12>',
              msg: 'from bot two',
            }),
          ],
          index: 2,
        }}
      />
    );
    expect(screen.queryByText('from bot one')).toBeTruthy();
    expect(screen.queryByText('from bot two')).toBeTruthy();

    // Open the Bots dropdown and hide just the first bot — labelled from its log
    // name "<11>" → "Bot 11".
    fireEvent.click(screen.getByText('Bots'));
    fireEvent.click(screen.getByText('Bot 11'));

    expect(screen.queryByText('from bot one')).toBeNull();
    expect(screen.queryByText('from bot two')).toBeTruthy();
  });
});
