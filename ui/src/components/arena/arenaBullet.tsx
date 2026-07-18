import React from 'react';
import { colors } from '../../util/colors';

interface BulletProps {
  appIndex: number;

  id: string;
  x: number;
  y: number;
  orientation: number;
}

// A bullet whose coordinates or orientation are momentarily undefined/NaN (e.g.
// seeded from a snapshot before its motion fields arrive) would produce an
// invalid SVG transform; the browser then drops the transform entirely and the
// sprite renders at (0,0). Coerce to finite numbers so a stray bullet can't get
// stranded in the corner (and to silence the console errors).
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);
const translate = (x: number, y: number): string =>
  'translate(' + finite(x) + ',' + finite(y) + ')';

// The bullet's (x,y) is the muzzle — the server spawns it BARREL_LENGTH (24, the
// drawn barrel tip) forward of the hull center (botTurret.ts). That single point
// is the one the collision uses and the debug view draws, so the **projectile**
// sprite is centered exactly on it (its 4×14 art centered via translate(-2,-7)):
// the visible bullet, its collision, and the debug dot all coincide.
//
// The flame (shotLarge) is only a trailing muzzle-flash effect, not the bullet's
// reference point — it keeps its original arrangement relative to the projectile
// (front at the bullet's leading tip, trailing back along the flight line), so
// it's offset by that same (-2,-7) plus the art's own (-6,0).
const BulletSvg = React.memo((props: BulletProps) => (
  <g key={props.id} name="bullet">
    <image
      href={'/sprites/shotLarge.png'}
      height="46"
      width="16"
      opacity={0.9}
      style={{
        transition: 'all 200ms linear',
      }}
      transform={[
        translate(props.x, props.y),
        'rotate(180)',
        'rotate(' + finite(props.orientation) + ')',
        'translate(-8, -7)',
      ].join(' ')}
    />

    <image
      href={
        '/sprites/bullet' +
        colors[props.appIndex][0].toUpperCase() +
        colors[props.appIndex].substring(1).toLowerCase() +
        '1_outline.png'
      }
      style={{
        transition: 'all 200ms linear',
      }}
      height="14"
      width="4"
      transform={[
        translate(props.x, props.y),
        'rotate(180)',
        'rotate(' + finite(props.orientation) + ')',
        'translate(-2, -7)',
      ].join(' ')}
    />
  </g>
));

export default BulletSvg;
