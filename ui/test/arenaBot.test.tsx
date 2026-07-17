// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import BotSvg, { healthColor } from '../src/components/arena/arenaBot';

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
    const bar = container.querySelector('rect[fill^="rgb"]') as SVGRectElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe('16px'); // 32 * 0.5
    // Mid-health is a desaturated midpoint of the blue<->orange ramp.
    expect(bar.getAttribute('fill')).toBe('rgb(146, 132, 146)');
  });

  it('is full and blue at 100 health', () => {
    const { container } = renderBot({ health: 100 });
    const bar = container.querySelector('rect[fill^="rgb"]') as SVGRectElement;
    expect(bar.style.width).toBe('32px');
    expect(bar.getAttribute('fill')).toBe('rgb(59, 130, 232)'); // blue
  });

  it('hides the bar when the bot is dead', () => {
    const { container } = renderBot({ health: 0 });
    expect(container.querySelector('rect[fill^="rgb"]')).toBeNull();
  });
});

describe('healthColor (color-blind-safe ramp, #132)', () => {
  // Guard against a regression to a green->red (or any green-passing) ramp: the
  // green channel must never dominate across the whole health range.
  it('is blue at full, orange at empty, and never green in between', () => {
    expect(healthColor(100)).toBe('rgb(59, 130, 232)'); // blue
    expect(healthColor(0)).toBe('rgb(232, 134, 59)'); // orange
    for (let h = 0; h <= 100; h += 5) {
      const [r, g, b] = healthColor(h).match(/\d+/g)!.map(Number);
      // "green" would mean g clearly the largest channel; it never is here.
      expect(g).toBeLessThanOrEqual(Math.max(r, b));
    }
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
