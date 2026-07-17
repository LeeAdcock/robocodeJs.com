// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import ArenaLegend from '../src/components/arena/arenaLegend';
import Arena from '../src/types/arena';

const arena = (names: string[]): Arena =>
  ({
    apps: names.map((name, i) => ({ id: `a${i}`, name, bots: [] })),
    clock: { time: 0 },
    width: 750,
    height: 750,
  }) as Arena;

afterEach(cleanup);

describe('ArenaLegend', () => {
  it('lists each app with its arena-index color swatch and name', () => {
    const { container } = render(
      <ArenaLegend arena={arena(['tracker', 'ambush'])} />
    );
    // Names are title-cased, matching the navbar/roster.
    expect(screen.getByText('Tracker')).toBeTruthy();
    expect(screen.getByText('Ambush')).toBeTruthy();
    // Swatches follow the arena color order (index 0 → 'blue', 1 → 'dark').
    const srcs = [...container.querySelectorAll('img')].map((img) =>
      img.getAttribute('src')
    );
    expect(srcs[0]).toContain('tank_blue.png');
    expect(srcs[1]).toContain('tank_dark.png');
  });

  it('renders nothing when the arena has no apps', () => {
    const { container } = render(<ArenaLegend arena={arena([])} />);
    expect(container.firstChild).toBeNull();
  });
});
