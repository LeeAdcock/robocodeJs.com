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
  { id: 'a1', name: 'Bot A', tankCount: 2 },
  { id: 'a2', name: 'Bot B', tankCount: 2 },
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

  it('can hide an individual tank within an application', () => {
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', tankCount: 2 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', tankIndex: 1, msg: 'from tank one' }),
            entry({ appId: 'a1', tankIndex: 2, msg: 'from tank two' }),
          ],
          index: 2,
        }}
      />
    );
    expect(screen.queryByText('from tank one')).toBeTruthy();
    expect(screen.queryByText('from tank two')).toBeTruthy();

    // Open the Bots dropdown and hide just Tank 1.
    fireEvent.click(screen.getByText('Bots'));
    fireEvent.click(screen.getByText('Tank 1'));

    expect(screen.queryByText('from tank one')).toBeNull();
    expect(screen.queryByText('from tank two')).toBeTruthy();
  });
});
