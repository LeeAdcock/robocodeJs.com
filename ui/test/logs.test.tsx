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
  tankIndex: number;
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
  tankIndex: 1,
  level: 30,
  levelName: 'info',
  msg: 'hi',
  time: 0,
  ...over,
});
const bots = [
  { id: 'a1', name: 'Bot A', tankCount: 2, index: 0 },
  { id: 'a2', name: 'Bot B', tankCount: 2, index: 1 },
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

  it('selectedTank narrows to one tank instance and reflects it in the filter', () => {
    const { container } = render(
      <Logs
        bots={bots}
        selectedApp="a1"
        selectedTank={2}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', tankIndex: 1, msg: 'a1 tank one' }),
            entry({ appId: 'a1', tankIndex: 2, msg: 'a1 tank two' }),
            entry({ appId: 'a2', tankIndex: 2, msg: 'a2 tank two' }),
          ],
          index: 3,
        }}
      />
    );
    // Only app a1's tank 2 is shown.
    expect(screen.queryByText('a1 tank two')).toBeTruthy();
    expect(screen.queryByText('a1 tank one')).toBeNull();
    expect(screen.queryByText('a2 tank two')).toBeNull();

    // ...and the Bots filter reflects it: only that tank's checkbox is checked.
    fireEvent.click(screen.getByText('Bots'));
    const selected = container.querySelector(
      '[id="tank-a1:2"]'
    ) as HTMLInputElement;
    const other = container.querySelector(
      '[id="tank-a1:1"]'
    ) as HTMLInputElement;
    expect(selected.checked).toBe(true);
    expect(other.checked).toBe(false);
  });

  it('labels a tank from its actual log name, not the computed index', () => {
    // index 5 would compute (5+1)*10+1 = 61, but the log name is authoritative.
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', tankCount: 1, index: 5 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [entry({ appId: 'a1', tankIndex: 1, name: '<99>', msg: 'x' })],
          index: 1,
        }}
      />
    );
    fireEvent.click(screen.getByText('Bots'));
    expect(screen.getByText('Bot 99')).toBeTruthy();
    expect(screen.queryByText('Bot 61')).toBeNull();
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

  it('can hide an individual tank (labelled by its bot id) within an application', () => {
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', tankCount: 2, index: 0 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({
              appId: 'a1',
              tankIndex: 1,
              name: '<11>',
              msg: 'from tank one',
            }),
            entry({
              appId: 'a1',
              tankIndex: 2,
              name: '<12>',
              msg: 'from tank two',
            }),
          ],
          index: 2,
        }}
      />
    );
    expect(screen.queryByText('from tank one')).toBeTruthy();
    expect(screen.queryByText('from tank two')).toBeTruthy();

    // Open the Bots dropdown and hide just the first tank — labelled from its log
    // name "<11>" → "Bot 11".
    fireEvent.click(screen.getByText('Bots'));
    fireEvent.click(screen.getByText('Bot 11'));

    expect(screen.queryByText('from tank one')).toBeNull();
    expect(screen.queryByText('from tank two')).toBeTruthy();
  });
});
