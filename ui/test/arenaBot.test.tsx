// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import BotSvg from '../src/components/arena/arenaBot';

const base = {
  appName: 'Bot',
  appIndex: 0,
  botIndex: 0,
  id: 't1',
  health: 100,
  bodyOrientation: 0,
  turretOrientation: 0,
  radarOrientation: 0,
  x: 100,
  y: 100,
  radarOn: false,
};

const renderBot = (props: Partial<typeof base> = {}) =>
  render(
    <svg>
      <BotSvg {...base} {...props} />
    </svg>
  );

describe('BotSvg health bar', () => {
  afterEach(cleanup);

  it('sizes and colors the bar from health', () => {
    const { container } = renderBot({ health: 50 });
    const bar = container.querySelector('rect[fill^="hsl"]') as SVGRectElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe('16px'); // 32 * 0.5
    expect(bar.getAttribute('fill')).toContain('hsl(60'); // 50 * 1.2 (yellow-ish)
  });

  it('is full and green at 100 health', () => {
    const { container } = renderBot({ health: 100 });
    const bar = container.querySelector('rect[fill^="hsl"]') as SVGRectElement;
    expect(bar.style.width).toBe('32px');
    expect(bar.getAttribute('fill')).toContain('hsl(120'); // green
  });

  it('hides the bar when the bot is dead', () => {
    const { container } = renderBot({ health: 0 });
    expect(container.querySelector('rect[fill^="hsl"]')).toBeNull();
  });
});

describe('BotSvg crash indicator', () => {
  afterEach(cleanup);

  it('shows a warning triangle with the fault code when crashed', () => {
    const { container } = render(
      <svg>
        <BotSvg {...base} health={0} crashed faultCode="E017" />
      </svg>
    );
    const triangle = container.querySelector('polygon[fill="gold"]');
    expect(triangle).toBeTruthy();
    expect(container.querySelector('title')?.textContent).toContain('E017');
  });

  it('shows no triangle when not crashed', () => {
    const { container } = render(
      <svg>
        <BotSvg {...base} />
      </svg>
    );
    expect(container.querySelector('polygon[fill="gold"]')).toBeNull();
  });
});

describe('BotSvg open-bot interaction', () => {
  afterEach(cleanup);

  it('double-click opens source; shift+double-click opens logs (with 1-based bot index)', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <svg>
        {/* botIndex 2 (0-based) → the log stream's bot index 3 */}
        <BotSvg {...base} appId="a1" botIndex={2} onOpen={onOpen} />
      </svg>
    );
    // The bot body image sits inside the clickable group; the dblclick bubbles.
    const body = container.querySelector('image') as SVGElement;

    fireEvent.dblClick(body);
    expect(onOpen).toHaveBeenLastCalledWith('a1', 3, false);

    fireEvent.dblClick(body, { shiftKey: true });
    expect(onOpen).toHaveBeenLastCalledWith('a1', 3, true);
  });

  it('is inert (no pointer, no handler) when onOpen is absent', () => {
    const { container } = render(
      <svg>
        <BotSvg {...base} />
      </svg>
    );
    // No cursor:pointer group when the bot isn't openable (e.g. the demo arena).
    expect(container.querySelector('g[style*="cursor"]')).toBeNull();
  });
});

describe('BotSvg rotation', () => {
  afterEach(cleanup);

  it('crosses the 0/360 seam the short way (continuous angle)', () => {
    const { container, rerender } = renderBot({ bodyOrientation: 359 });
    const bodyTransform = () =>
      container
        .querySelector('image[href*="tankBody"]')!
        .getAttribute('transform')!;

    expect(bodyTransform()).toContain('rotate(359)');

    rerender(
      <svg>
        <BotSvg {...base} bodyOrientation={1} />
      </svg>
    );

    // 359 -> 1 must advance to 361 (turn +2), not snap back to 1 (which the CSS
    // transition would animate as a ~358 spin the wrong way).
    expect(bodyTransform()).toContain('rotate(361)');
  });
});
