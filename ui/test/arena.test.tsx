// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ArenaSvg from '../src/components/arena/arena';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arena: any = { width: 750, height: 750, clock: { time: 0 }, apps: [] };

afterEach(cleanup);

describe('ArenaSvg night mode', () => {
  it('overlays a multiply tint only in dark mode', () => {
    const { container, rerender } = render(
      <ArenaSvg arena={arena} darkMode={false} time={0} />
    );
    expect(container.querySelector('[style*="multiply"]')).toBeNull();

    rerender(<ArenaSvg arena={arena} darkMode={true} time={0} />);
    const overlay = container.querySelector('[style*="multiply"]');
    expect(overlay).toBeTruthy();
    // The overlay must not intercept clicks meant for the tanks underneath.
    expect((overlay as SVGElement).getAttribute('style')).toContain(
      'pointer-events: none'
    );
  });
});
