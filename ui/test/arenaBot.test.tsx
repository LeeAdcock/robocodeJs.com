// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import BotSvg, {
  HEALTH_BAR_FILL,
  HEALTH_BAR_TRACK,
} from '../src/components/arena/arenaBot';

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

describe('BotSvg health bar (greyscale, fixed fill, width-only drain)', () => {
  afterEach(cleanup);

  // Health reads purely from the bar's *width*: a constant dark fill over a
  // lighter track, with no color fade as it drains. Greyscale is color-blind-safe
  // by construction — the green->red ramp it replaced was the canonical
  // red-green-CVD failure mode (#132), so guard against any color ramp returning.
  const fillRect = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('rect')).find(
      (r) => r.getAttribute('fill') === HEALTH_BAR_FILL
    ) as SVGRectElement | undefined;

  it('sizes the fill from health, over a lighter track', () => {
    const { container } = renderBot({ health: 50 });
    const fill = fillRect(container);
    const track = Array.from(container.querySelectorAll('rect')).find(
      (r) => r.getAttribute('fill') === HEALTH_BAR_TRACK
    );
    expect(fill).toBeTruthy();
    expect(track).toBeTruthy();
    expect(fill!.style.width).toBe('16px'); // 32 * 0.5
    // Width animates, but the fill color does not.
    expect(fill!.style.transition).toContain('width');
    expect(fill!.style.transition).not.toContain('fill');
  });

  it('keeps the same fixed fill color at every health level (no fade)', () => {
    for (const health of [100, 50, 10]) {
      const { container } = renderBot({ health });
      expect(fillRect(container)?.getAttribute('fill')).toBe(HEALTH_BAR_FILL);
      cleanup();
    }
  });

  it('is a full-width bar at 100 health', () => {
    const { container } = renderBot({ health: 100 });
    expect(fillRect(container)!.style.width).toBe('32px');
  });

  it('hides the bar when the bot is dead', () => {
    const { container } = renderBot({ health: 0 });
    expect(fillRect(container)).toBeUndefined();
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
