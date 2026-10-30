import { describe, expect, it } from 'vitest';

import { formatLogLine, isErrorLevel, levelName } from '../src/logFormat';

describe('log formatting', () => {
  it('names bunyan levels', () => {
    expect(levelName(30)).toBe('INFO');
    expect(levelName(50)).toBe('ERROR');
    expect(levelName(5)).toBe('TRACE');
    expect(isErrorLevel(50)).toBe(true);
    expect(isErrorLevel(40)).toBe(false);
  });

  it('labels a line with the tick, app name and bot number', () => {
    expect(
      formatLogLine(
        {
          id: 7,
          level: 40,
          msg: 'low health',
          appId: 'a1',
          botIndex: 2,
          time: 1234,
        },
        'Sweeper'
      )
    ).toBe('[t=1234] Sweeper #2  WARN   low health');
  });

  it('falls back to a short app id when the name is unknown', () => {
    expect(
      formatLogLine({
        id: 1,
        level: 30,
        msg: 'hi',
        appId: '0123456789ab',
        botIndex: 1,
        time: 0,
      })
    ).toBe('[t=0] 01234567 #1  INFO   hi');
  });
});
