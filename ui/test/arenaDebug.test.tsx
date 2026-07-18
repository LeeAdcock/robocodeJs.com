// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import ArenaSvg from '../src/components/arena/arena';

// One live bot with a bullet in flight, enough to exercise every schematic
// element (circle, aim/speed vectors, radar beam, bullet path).
const bot: any = {
  id: 'b1',
  x: 100,
  y: 120,
  speed: 2,
  speedTarget: 2,
  speedAcceleration: 0.1,
  speedMax: 5,
  bodyOrientation: 45,
  bodyOrientationTarget: 45,
  bodyOrientationVelocity: 5,
  turretOrientation: 10,
  turretOrientationTarget: 30,
  turretOrientationVelocity: 5,
  radarOrientation: 0,
  radarOrientationTarget: 20,
  radarOrientationVelocity: 5,
  radarOn: true,
  health: 80,
  bullets: [
    {
      id: 'bullet1',
      origin: { x: 100, y: 120 },
      x: 130,
      y: 150,
      speed: 6,
      orientation: 45,
      explodedAt: undefined,
    },
  ],
  path: [],
  pathIndex: 0,
};

const arena: any = {
  width: 750,
  height: 750,
  clock: { time: 0 },
  apps: [{ id: 'a1', name: 'Test', bots: [bot] }],
};

afterEach(cleanup);

describe('ArenaSvg debug (schematic) view', () => {
  it('draws sprites, not the schematic, when debug is off', () => {
    const { container } = render(
      <ArenaSvg arena={arena} darkMode={false} debugMode={false} time={0} />
    );
    // The scenic render uses PNG sprites for the tank body.
    expect(container.querySelector('image[href*="tankBody"]')).toBeTruthy();
    expect(container.querySelector('[fill="url(#debugGrid)"]')).toBeNull();
  });

  it('replaces sprites with grid, circle tanks, and vectors when debug is on', () => {
    const { container } = render(
      <ArenaSvg arena={arena} darkMode={false} debugMode={true} time={0} />
    );
    // No tank sprite in schematic mode.
    expect(container.querySelector('image[href*="tankBody"]')).toBeNull();
    // The 50px measurement grid.
    expect(container.querySelector('[fill="url(#debugGrid)"]')).toBeTruthy();
    // The tank drawn as the sim's collision circle (radius 16).
    const circle = container.querySelector('circle[r="16"]');
    expect(circle).toBeTruthy();
    // The heading ray (bot is moving) carries the arrowhead marker.
    expect(
      container.querySelector('[marker-end="url(#debug-arrow-speed)"]')
    ).toBeTruthy();
    // Turret + radar aim rays are drawn (circle-contained, by color).
    expect(
      container.querySelector('[stroke="var(--debug-turret)"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[stroke="var(--debug-radar)"]')
    ).toBeTruthy();
    // The bullet's projected path is drawn.
    expect(
      container.querySelector('[stroke="var(--debug-bullet)"]')
    ).toBeTruthy();
  });

  it('suppresses the night-mode multiply tint in debug mode', () => {
    const { container } = render(
      <ArenaSvg arena={arena} darkMode={true} debugMode={true} time={0} />
    );
    // Debug view is its own flat themed surface; the scenic multiply overlay
    // must not paint over it even when the app theme is dark.
    expect(container.querySelector('[style*="multiply"]')).toBeNull();
  });

  it('draws scanner→target detection lines from a bot that just scanned', () => {
    // Two bots; the scanner (b1) has a transient `detected` list naming the
    // other (b2). The reducer sets this on a radarScan and clears it shortly
    // after — while set, the debug view draws a line between the two.
    const scanner = { ...bot, id: 'b1', detected: ['b2'] };
    const target = { ...bot, id: 'b2', x: 300, y: 400, detected: undefined };
    const twoBotArena: any = {
      width: 750,
      height: 750,
      clock: { time: 0 },
      apps: [{ id: 'a1', name: 'Test', bots: [scanner, target] }],
    };
    const { container } = render(
      <ArenaSvg
        arena={twoBotArena}
        darkMode={false}
        debugMode={true}
        time={0}
      />
    );
    const lines = container.querySelectorAll('g[name="debug-detections"] line');
    expect(lines).toHaveLength(1);
    // The line spans scanner → target.
    const line = lines[0];
    expect(line.getAttribute('x1')).toBe('100');
    expect(line.getAttribute('x2')).toBe('300');
    expect(line.getAttribute('y2')).toBe('400');
  });

  it('focuses a tank on click: range rings and telemetry appear', () => {
    const { container } = render(
      <ArenaSvg arena={arena} darkMode={false} debugMode={true} time={0} />
    );
    // Nothing focused initially — the focus-only range rings aren't drawn.
    expect(container.querySelector('circle[r="100"]')).toBeNull();

    // Click the tank's collision circle to focus it.
    fireEvent.click(container.querySelector('circle[r="16"]')!);

    // The focused bot gets range rings (100/200/300) and a telemetry panel.
    expect(container.querySelector('circle[r="100"]')).toBeTruthy();
    expect(container.textContent).toContain('health');
  });
});
