import { describe, it, expect, vi } from 'vitest';
import { logger, logBotFault, LogEvent } from '../src/util/logger';

// The fault events are a monitoring/alerting contract: their `event` name,
// fields, and especially the `timedOut` flag (the runaway / sandbox-abuse
// signal) need to be stable. These assert the structured payload directly.
describe('logBotFault', () => {
  it('emits a structured bot.fault with ids and kind', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    logBotFault(
      { appId: 'a1', tankId: 't1', arenaId: 'ar1' },
      'handler',
      new Error('boom')
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      event: LogEvent.BOT_FAULT,
      kind: 'handler',
      timedOut: false,
      appId: 'a1',
      tankId: 't1',
      arenaId: 'ar1',
      err: 'boom',
    });
    warn.mockRestore();
  });

  it('flags timeouts so runaway/abuse can be alerted on separately', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    logBotFault(
      { appId: 'a1' },
      'timer',
      new Error('Script execution timed out.')
    );

    expect(warn.mock.calls[0][0]).toMatchObject({
      event: LogEvent.BOT_FAULT,
      kind: 'timer',
      timedOut: true,
    });
    warn.mockRestore();
  });

  it('handles non-Error throwables', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    logBotFault({ appId: 'a1' }, 'load', 'plain string failure');

    expect(warn.mock.calls[0][0]).toMatchObject({
      event: LogEvent.BOT_FAULT,
      err: 'plain string failure',
    });
    warn.mockRestore();
  });
});
