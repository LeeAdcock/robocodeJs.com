// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import BulletSvg from '../src/components/arena/arenaBullet';

afterEach(cleanup);

// The server now spawns a bullet at the muzzle (BARREL_LENGTH forward of the
// hull), so (x,y) is where the projectile actually is. These sprites therefore
// sit directly at (x,y) — the old forward `translate(_, -32)` that pushed them
// to the barrel tip is gone, keeping the model position and the drawing in
// agreement (what the debug view exposed).
describe('BulletSvg (scenic bullet)', () => {
  const renderBullet = () =>
    render(
      <svg>
        <BulletSvg id="b1" appIndex={0} x={200} y={140} orientation={45} />
      </svg>
    );

  it('draws both sprites translated to the bullet position, with no forward offset', () => {
    const { container } = renderBullet();
    const images = container.querySelectorAll('image');
    expect(images).toHaveLength(2);
    for (const img of images) {
      const t = img.getAttribute('transform') ?? '';
      // Positioned at the bullet's (x,y)...
      expect(t).toContain('translate(200,140)');
      // ...and oriented along its heading.
      expect(t).toContain('rotate(45)');
      // The old muzzle push-forward is gone — the sprite is at (x,y), not 32
      // units ahead of it.
      expect(t).not.toContain('-32');
    }
  });
});
