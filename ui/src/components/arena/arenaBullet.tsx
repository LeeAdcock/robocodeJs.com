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

// The bullet's (x,y) is now the muzzle — the server spawns it BARREL_LENGTH (32)
// forward of the hull center (botTurret.ts), where these sprites were already
// drawn. So the sprites sit directly at (x,y): the old `translate(_, -32)` that
// pushed them to the barrel tip is gone (the model moved forward by that same
// 32, so the on-screen position is unchanged — the point just agrees with the
// art now). The flame trails back along the flight line from the muzzle.
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
        'translate(-6, 0)',
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
        'translate(0, 0)',
      ].join(' ')}
    />
  </g>
));

export default BulletSvg;
