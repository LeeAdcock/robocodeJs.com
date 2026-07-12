import React, { useRef } from 'react';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { colors } from '../../util/colors';
import { shortestAngleDelta } from '../../util/geometry';

// Coordinates and orientations can be momentarily undefined/NaN — e.g. during an
// arena reload or a between-frames interpolation gap. Feeding those into an SVG
// `transform` produces `translate(NaN,NaN)` / `rotate(undefined)`, which the
// browser rejects and logs. Guard the values at the render boundary.
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);
const translate = (x: number, y: number): string =>
  'translate(' + finite(x) + ',' + finite(y) + ')';

// Tracks a target angle (which wraps at 0/360) as a continuously increasing or
// decreasing value, always moving the short way. Feeding this to a CSS
// `rotate(...)` transition stops the sprite from spinning the long way around
// when the underlying angle crosses the 0/360 seam. A non-finite target (a not-
// yet-populated orientation) is ignored so the last good angle is kept rather
// than poisoning the accumulator with NaN.
function useContinuousAngle(target: number): number {
  const ref = useRef(finite(target));
  if (Number.isFinite(target)) {
    ref.current += shortestAngleDelta(ref.current, target);
  }
  return ref.current;
}

// Damage-glow timing (attack / sustain / release). The glow ramps in fast on a
// hit, holds while damage keeps landing, then fades out slowly once it stops —
// so repeated hits (a collision, a bullet burst) read as one steady glow rather
// than a strobe. GLOW_SUSTAIN_MS spans ~2.5 nominal ticks (~100ms each) so
// continuous per-tick damage keeps the glow lit with no gaps.
const GLOW_ATTACK_MS = 90;
const GLOW_RELEASE_MS = 650;
const GLOW_SUSTAIN_MS = 260;

interface BotProps {
  appName: string;
  appIndex: number;
  botIndex: number;

  id: string;
  appId?: string;
  // Open this bot: double-click → source editor, shift+double-click → this bot's
  // logs. botIndex is 1-based to match the log stream's bot index.
  onOpen?: (appId: string, botIndex: number, shiftKey: boolean) => void;
  health: number;
  crashed?: boolean;
  faultCode?: string;
  bodyOrientation: number;
  turretOrientation: number;
  radarOrientation: number;
  x: number;
  y: number;
  radarOn: boolean;
  // Drives the damage-pulse glow: a fresh timestamp (bumped on each hit) keeps
  // the glow lit; it sustains while hits keep landing, then fades (see below).
  lastDamagedAt?: number;
  lastDamageAmount?: number;
}

interface BotTurretProps {
  appIndex: number;
  turretOrientation: number;
  bodyOrientation: number;
  x: number;
  y: number;
}

interface BotRadarProps {
  appIndex: number;
  turretOrientation: number;
  bodyOrientation: number;
  radarOrientation: number;
  x: number;
  y: number;
  radarOn: boolean;
}

// Convenience method to create a readable id
const getBotId = (appIndex: number, botIndex: number) =>
  (appIndex + 1) * 10 + (botIndex + 1);

const BotTurretSvg = (props: BotTurretProps) => {
  const angle = useContinuousAngle(
    props.bodyOrientation + props.turretOrientation
  );
  return (
    <image
      href={
        '/sprites/tank' +
        colors[props.appIndex][0].toUpperCase() +
        colors[props.appIndex].substring(1).toLowerCase() +
        '_barrel2_outline.png'
      }
      style={{
        transition: 'all 200ms linear',
      }}
      height="32"
      width="32"
      transform={[
        translate(props.x, props.y),
        'rotate(180)',
        'rotate(' + angle + ')',
        'translate(-16, -24)',
      ].join(' ')}
    />
  );
};

const BotRadarSvg = (props: BotRadarProps) => {
  const angle = useContinuousAngle(
    props.bodyOrientation + props.turretOrientation + props.radarOrientation
  );
  return (
    <g
      style={{
        transition: 'all 200ms linear',
      }}
      transform={[translate(props.x, props.y), 'rotate(' + angle + ')'].join(
        ' '
      )}
    >
      {props.radarOn && (
        <polygon points="-4,0,4,0,60,300,-60,300" fill="url(#radar)"></polygon>
      )}
      <image
        href={'/sprites/barrelRust_top.png'}
        height="8"
        width="16"
        preserveAspectRatio="xMinYMin slice"
        transform={'translate(-8, -2)'}
      />
    </g>
  );
};

const BotSvg = React.memo((props: BotProps) => {
  const body = useContinuousAngle(props.bodyOrientation);

  // The glow is "active" for a short window after the most recent hit. Repeated
  // hits keep bumping lastDamagedAt, so the window keeps extending and the glow
  // sustains; once hits stop, the window lapses and the glow releases.
  const glowing =
    props.health > 0 &&
    props.lastDamagedAt !== undefined &&
    performance.now() - props.lastDamagedAt < GLOW_SUSTAIN_MS;

  // BotSvg is memoized and normally only re-renders on tick prop changes, but the
  // release has to fire even if ticks stall (e.g. the sim is paused mid-burst).
  // Force one re-render when the sustain window lapses so `glowing` flips to false
  // and the fade-out transition kicks in.
  const [, forceRerender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (props.lastDamagedAt === undefined) return;
    const remaining =
      GLOW_SUSTAIN_MS - (performance.now() - props.lastDamagedAt);
    if (remaining <= 0) return;
    const id = window.setTimeout(forceRerender, remaining + 20);
    return () => window.clearTimeout(id);
  }, [props.lastDamagedAt]);

  return (
    <>
      <OverlayTrigger
        placement={'bottom'}
        overlay={
          <Tooltip id={props.id}>
            {props.appName} [{props.appIndex + 1}
            {props.botIndex + 1}]
          </Tooltip>
        }
      >
        <g
          key={props.id}
          opacity={props.health > 0 ? 1 : 0.5}
          filter={props.health > 0 ? undefined : 'url(#blur)'}
          style={props.onOpen ? { cursor: 'pointer' } : undefined}
          onDoubleClick={(e) => {
            if (props.onOpen && props.appId)
              // props.botIndex is 0-based; the log stream is 1-based.
              props.onOpen(props.appId, props.botIndex + 1, e.shiftKey);
          }}
        >
          {/* Damage pulse (behind the tank). The circle stays mounted (invisible
              at opacity 0) so its opacity animates via a CSS transition rather than
              snapping on mount: a fast attack ramps it up on a hit, it holds while
              damage keeps landing, then a slow release fades it out. --glow-peak
              scales the flash with how hard the hit was. */}
          {props.health > 0 && (
            <g
              style={{ transition: 'all 200ms linear' }}
              transform={translate(props.x, props.y)}
            >
              <circle
                // The tank sprite (~16px radius) sits on top and hides the glow's
                // core, so the radius reaches well past it to leave a visible halo.
                r={32}
                fill="url(#damageGlow)"
                pointerEvents="none"
                style={
                  {
                    // Peak opacity scales with the hit; a heavy bullet approaches
                    // the cap, a collision graze (~3) still reads. Kept subtle so
                    // the glow suggests damage rather than dominating the sprite.
                    '--glow-peak': Math.min(
                      0.75,
                      0.4 + (props.lastDamageAmount ?? 0) / 40
                    ),
                    opacity: glowing ? 'var(--glow-peak)' : 0,
                    transition: `opacity ${
                      glowing ? GLOW_ATTACK_MS : GLOW_RELEASE_MS
                    }ms ease-out`,
                  } as React.CSSProperties
                }
              />
            </g>
          )}
          <image
            href={'/sprites/tankBody_' + colors[props.appIndex] + '.png'}
            height="32"
            width="32"
            style={{
              transition: 'all 200ms linear',
            }}
            transform={[
              translate(props.x, props.y),
              'rotate(' + body + ')',
              'translate(-16, -16)',
            ].join(' ')}
          />
          <text
            textAnchor="end"
            opacity={0.5}
            transform={[
              translate(props.x, props.y),
              'rotate(' + body + ')',
              'rotate(180)',
              'translate(10, 14)',
            ].join(' ')}
            style={{
              transition: 'all 200ms linear',
              fontSize: '5pt',
              fontFamily: 'monospace',
              fontWeight: 'bold',
            }}
          >
            {getBotId(props.appIndex, props.botIndex)}
          </text>
          <BotTurretSvg
            appIndex={props.appIndex}
            turretOrientation={props.turretOrientation}
            bodyOrientation={props.bodyOrientation}
            x={props.x}
            y={props.y}
          />

          <BotRadarSvg
            appIndex={props.appIndex}
            turretOrientation={props.turretOrientation}
            bodyOrientation={props.bodyOrientation}
            radarOrientation={props.radarOrientation}
            x={props.x}
            y={props.y}
            radarOn={props.radarOn}
          />

          {props.health > 0 && (
            <g
              style={{
                transition: 'all 200ms linear',
              }}
              opacity={0.75}
              transform={translate(props.x, props.y)}
            >
              <rect
                width={32}
                height={4}
                x={-16}
                y={16}
                stroke={'black'}
                fill="#DE7A4A"
                fillOpacity="0.9"
              />
              <rect
                height={4}
                x={-16}
                y={16}
                fillOpacity="0.9"
                // Color shifts green -> yellow -> red as health drains, and the
                // width animates, so the slow collision bleed reads as visible
                // motion instead of imperceptible per-tick steps.
                fill={'hsl(' + Math.max(0, props.health) * 1.2 + ', 70%, 40%)'}
                style={{
                  width: 32 * (Math.max(0, props.health) / 100),
                  transition: 'width 300ms linear, fill 300ms linear',
                }}
              />
            </g>
          )}

          {props.crashed && (
            // A crisp warning triangle above the bot (outside the dead-bot blur)
            // marking a bot that crashed rather than died in combat.
            <g transform={translate(props.x, props.y - 26)}>
              <title>{`Crashed${props.faultCode ? ` (${props.faultCode})` : ''}`}</title>
              <polygon
                points="0,-8 8,6 -8,6"
                fill="gold"
                stroke="black"
                strokeWidth={1}
                strokeLinejoin="round"
              />
              <text
                x={0}
                y={5}
                fontSize={9}
                fontWeight="bold"
                textAnchor="middle"
                fill="black"
              >
                !
              </text>
            </g>
          )}
        </g>
      </OverlayTrigger>
    </>
  );
});

export default BotSvg;
