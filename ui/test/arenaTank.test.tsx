// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import TankSvg from '../src/components/arena/arenaTank';

const base = {
  appName: 'Bot',
  appIndex: 0,
  tankIndex: 0,
  id: 't1',
  health: 100,
  bodyOrientation: 0,
  turretOrientation: 0,
  radarOrientation: 0,
  x: 100,
  y: 100,
  radarOn: false,
};

const renderTank = (props: Partial<typeof base> = {}) =>
  render(
    <svg>
      <TankSvg {...base} {...props} />
    </svg>
  );

describe('TankSvg health bar', () => {
  afterEach(cleanup);

  it('sizes and colors the bar from health', () => {
    const { container } = renderTank({ health: 50 });
    const bar = container.querySelector('rect[fill^="hsl"]') as SVGRectElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe('16px'); // 32 * 0.5
    expect(bar.getAttribute('fill')).toContain('hsl(60'); // 50 * 1.2 (yellow-ish)
  });

  it('is full and green at 100 health', () => {
    const { container } = renderTank({ health: 100 });
    const bar = container.querySelector('rect[fill^="hsl"]') as SVGRectElement;
    expect(bar.style.width).toBe('32px');
    expect(bar.getAttribute('fill')).toContain('hsl(120'); // green
  });

  it('hides the bar when the tank is dead', () => {
    const { container } = renderTank({ health: 0 });
    expect(container.querySelector('rect[fill^="hsl"]')).toBeNull();
  });
});

describe('TankSvg rotation', () => {
  afterEach(cleanup);

  it('crosses the 0/360 seam the short way (continuous angle)', () => {
    const { container, rerender } = renderTank({ bodyOrientation: 359 });
    const bodyTransform = () =>
      container
        .querySelector('image[href*="tankBody"]')!
        .getAttribute('transform')!;

    expect(bodyTransform()).toContain('rotate(359)');

    rerender(
      <svg>
        <TankSvg {...base} bodyOrientation={1} />
      </svg>
    );

    // 359 -> 1 must advance to 361 (turn +2), not snap back to 1 (which the CSS
    // transition would animate as a ~358 spin the wrong way).
    expect(bodyTransform()).toContain('rotate(361)');
  });
});
