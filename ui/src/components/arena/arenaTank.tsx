import React, { useRef } from 'react';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { colors } from '../../util/colors';
import { shortestAngleDelta } from '../../util/geometry';

// Tracks a target angle (which wraps at 0/360) as a continuously increasing or
// decreasing value, always moving the short way. Feeding this to a CSS
// `rotate(...)` transition stops the sprite from spinning the long way around
// when the underlying angle crosses the 0/360 seam.
function useContinuousAngle(target: number): number {
  const ref = useRef(target);
  ref.current += shortestAngleDelta(ref.current, target);
  return ref.current;
}

interface TankProps {
  appName: string;
  appIndex: number;
  tankIndex: number;

  id: string;
  health: number;
  bodyOrientation: number;
  turretOrientation: number;
  radarOrientation: number;
  x: number;
  y: number;
  radarOn: boolean;
}

interface TankTurretProps {
  appIndex: number;
  turretOrientation: number;
  bodyOrientation: number;
  x: number;
  y: number;
}

interface TankRadarProps {
  appIndex: number;
  turretOrientation: number;
  bodyOrientation: number;
  radarOrientation: number;
  x: number;
  y: number;
  radarOn: boolean;
}

// Convenience method to create a readable id
const getTankId = (appIndex: number, tankIndex: number) =>
  (appIndex + 1) * 10 + (tankIndex + 1);

const TankTurretSvg = (props: TankTurretProps) => {
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
        'translate(' + props.x + ',' + props.y + ')',
        'rotate(180)',
        'rotate(' + angle + ')',
        'translate(-16, -24)',
      ].join(' ')}
    />
  );
};

const TankRadarSvg = (props: TankRadarProps) => {
  const angle = useContinuousAngle(
    props.bodyOrientation + props.turretOrientation + props.radarOrientation
  );
  return (
    <g
      style={{
        transition: 'all 200ms linear',
      }}
      transform={[
        'translate(' + props.x + ',' + props.y + ')',
        'rotate(' + angle + ')',
      ].join(' ')}
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

const TankSvg = React.memo((props: TankProps) => {
  const body = useContinuousAngle(props.bodyOrientation);
  return (
    <>
      <OverlayTrigger
        placement={'bottom'}
        overlay={
          <Tooltip id={props.id}>
            {props.appName} [{props.appIndex + 1}
            {props.tankIndex + 1}]
          </Tooltip>
        }
      >
        <g
          key={props.id}
          opacity={props.health > 0 ? 1 : 0.5}
          filter={props.health > 0 ? undefined : 'url(#blur)'}
        >
          <image
            href={'/sprites/tankBody_' + colors[props.appIndex] + '.png'}
            height="32"
            width="32"
            style={{
              transition: 'all 200ms linear',
            }}
            transform={[
              'translate(' + props.x + ',' + props.y + ')',
              'rotate(' + body + ')',
              'translate(-16, -16)',
            ].join(' ')}
          />
          <text
            textAnchor="end"
            opacity={0.5}
            transform={[
              'translate(' + props.x + ',' + props.y + ')',
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
            {getTankId(props.appIndex, props.tankIndex)}
          </text>
          <TankTurretSvg
            appIndex={props.appIndex}
            turretOrientation={props.turretOrientation}
            bodyOrientation={props.bodyOrientation}
            x={props.x}
            y={props.y}
          />

          <TankRadarSvg
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
              transform={'translate(' + props.x + ',' + props.y + ')'}
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
                width={32 * (props.health / 100)}
                height={4}
                x={-16}
                y={16}
                fill="green"
                fillOpacity="0.9"
              />
            </g>
          )}
        </g>
      </OverlayTrigger>
    </>
  );
});

export default TankSvg;
