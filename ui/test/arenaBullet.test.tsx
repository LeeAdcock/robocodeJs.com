// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import BulletSvg from '../src/components/arena/arenaBullet';

afterEach(cleanup);

// The server spawns a bullet at the muzzle (BARREL_LENGTH forward of the hull),
// so (x,y) is the single point the collision uses and the debug view draws. The
// projectile sprite is centered exactly on it; the flame only trails from it.
describe('BulletSvg (scenic bullet)', () => {
  const renderBullet = () =>
    render(
      <svg>
        <BulletSvg id="b1" appIndex={0} x={200} y={140} orientation={45} />
      </svg>
    );

  const spriteByHref = (root: ParentNode, needle: string) =>
    Array.from(root.querySelectorAll('image')).find((img) =>
      (img.getAttribute('href') ?? '').includes(needle)
    );

  it('anchors both sprites at the bullet position, oriented along its heading', () => {
    const { container } = renderBullet();
    const images = container.querySelectorAll('image');
    expect(images).toHaveLength(2);
    for (const img of images) {
      const t = img.getAttribute('transform') ?? '';
      expect(t).toContain('translate(200,140)');
      expect(t).toContain('rotate(45)');
      // The old muzzle push-forward is gone (the model moved to the muzzle).
      expect(t).not.toContain('-32');
    }
  });

  it('centers the projectile outline exactly on (x,y); the flame only trails', () => {
    const { container } = renderBullet();
    // The actual bullet (4×14 outline) is centered on the point: translate(-2,-7).
    const bullet = spriteByHref(container, 'outline');
    expect(bullet?.getAttribute('transform')).toContain('translate(-2, -7)');
    // The flame is a trailing effect, offset back from the bullet — not centered
    // on the point.
    const flame = spriteByHref(container, 'shotLarge');
    expect(flame?.getAttribute('transform')).toContain('translate(-8, -7)');
  });
});
