import React from 'react';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';

import Arena from '../../types/arena';
import Bot from '../../types/bot';
import Bullet from '../../types/bullet';
import { colors } from '../../util/colors';

import { HEALTH_BAR_TRACK, healthBarFill } from './arenaBot';

// Debug (schematic) render of the arena — the "practical" view that mirrors how
// the simulation actually models things: tanks are the circles they really are
// (radius 16), motion and aim are drawn as explicit vectors, and bullets show
// their projected path. It replaces the terrain-and-sprites scene (arena.tsx
// gates on the debugMode flag) rather than overlaying it. Colors come from CSS
// vars (--debug-*) so the schematic re-themes with light/dark automatically.

// The tank body radius the server models (server collides tanks as circles of
// this radius; the 32px sprites are centered on it). See util/simulation.ts.
const BOT_RADIUS = 16;
const GRID = 50;
// Fixed lengths for the aim rays (just past the tank circle) and the scale that
// turns a per-tick speed into a visible arrow.
const AIM_RAY = 42;
const SPEED_SCALE = 22;
// Radar beam half-angle and range, matched to the server's detection cone
// (botRadar.ts: ±16 base widening to ±122 at range 600 → atan(122/600) ≈ 11.5°).
const RADAR_HALF_ANGLE = 11.5;
const RADAR_RANGE = 600;

// Coordinates/orientations can be momentarily NaN (resync, between-frames gap);
// feeding those into an SVG attribute produces errors, so guard at the boundary
// (same approach as arenaBot.tsx).
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

// Endpoint of a ray from (x,y) at heading `angle` (degrees) and `length`, using
// the exact 0°=up, clockwise convention of util/simulate.ts so a drawn ray lands
// where the sim would actually send a tank (speed) or a bullet (turret aim).
const rayEnd = (x: number, y: number, angle: number, length: number) => {
  const a = finite(angle);
  const l = finite(length);
  return {
    x: finite(x) + l * Math.sin((-a * Math.PI) / 180),
    y: finite(y) + l * Math.cos((-a * Math.PI) / 180),
  };
};

// Vivid per-team stroke for the tank circle — the one place team identity is
// encoded in the schematic (paired with the numeric id label). Tuned to read on
// both the light and dark debug backgrounds; keyed by the same names as `colors`.
const TEAM_STROKE: Record<string, string> = {
  blue: '#2f9be0',
  dark: '#8b93a1',
  sand: '#c99a3a',
  red: '#e6483a',
  green: '#26b862',
};
const teamStroke = (appIndex: number): string =>
  TEAM_STROKE[colors[appIndex]] ?? '#888';

const getBotId = (appIndex: number, botIndex: number) =>
  (appIndex + 1) * 10 + (botIndex + 1);

// A straight ray as an SVG line, optionally dashed (target/aim-toward) and with
// an arrowhead marker at the tip.
const Ray = (props: {
  x: number;
  y: number;
  angle: number;
  length: number;
  color: string;
  dashed?: boolean;
  marker?: string;
}) => {
  const end = rayEnd(props.x, props.y, props.angle, props.length);
  return (
    <line
      x1={finite(props.x)}
      y1={finite(props.y)}
      x2={end.x}
      y2={end.y}
      stroke={props.color}
      strokeWidth={1.5}
      strokeDasharray={props.dashed ? '3 3' : undefined}
      markerEnd={props.marker ? `url(#${props.marker})` : undefined}
      style={{ transition: 'all 200ms linear' }}
    />
  );
};

const DebugBot = (props: {
  bot: Bot;
  appIndex: number;
  botIndex: number;
  appName: string;
  appId?: string;
  onOpen?: (appId: string, botIndex: number, shiftKey: boolean) => void;
}) => {
  const { bot, appIndex, botIndex } = props;
  const x = finite(bot.x);
  const y = finite(bot.y);
  const alive = bot.health > 0;
  const stroke = teamStroke(appIndex);

  // Absolute orientations: turret is relative to the body, radar to the turret.
  const bodyAngle = bot.bodyOrientation;
  const turretAngle = bot.bodyOrientation + bot.turretOrientation;
  const turretTarget = bot.bodyOrientation + bot.turretOrientationTarget;
  const radarAngle =
    bot.bodyOrientation + bot.turretOrientation + bot.radarOrientation;
  const radarTarget =
    bot.bodyOrientation + bot.turretOrientation + bot.radarOrientationTarget;

  const beamNear = rayEnd(x, y, radarAngle - RADAR_HALF_ANGLE, BOT_RADIUS);
  const beamFar1 = rayEnd(x, y, radarAngle - RADAR_HALF_ANGLE, RADAR_RANGE);
  const beamFar2 = rayEnd(x, y, radarAngle + RADAR_HALF_ANGLE, RADAR_RANGE);

  return (
    <OverlayTrigger
      placement="bottom"
      overlay={
        <Tooltip id={bot.id}>
          {props.appName} [{appIndex + 1}
          {botIndex + 1}]
        </Tooltip>
      }
    >
      <g
        style={{
          opacity: alive ? 1 : 0.35,
          cursor: props.onOpen ? 'pointer' : undefined,
        }}
        onDoubleClick={(e) => {
          if (props.onOpen && props.appId)
            props.onOpen(props.appId, botIndex + 1, e.shiftKey);
        }}
      >
        {alive && bot.radarOn && (
          <polygon
            points={`${beamNear.x},${beamNear.y} ${beamFar1.x},${beamFar1.y} ${beamFar2.x},${beamFar2.y}`}
            fill="var(--debug-radar)"
            opacity={0.12}
            pointerEvents="none"
          />
        )}

        {/* The tank as the sim's collision circle. */}
        <circle
          cx={x}
          cy={y}
          r={BOT_RADIUS}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={alive ? undefined : '4 3'}
          style={{ transition: 'all 200ms linear' }}
        />

        {alive && (
          <>
            {/* Aim: turret + radar, each a solid current-direction ray and a
                dashed ray toward its target angle. */}
            <Ray
              x={x}
              y={y}
              angle={radarAngle}
              length={AIM_RAY}
              color="var(--debug-radar)"
              marker="debug-arrow-radar"
            />
            <Ray
              x={x}
              y={y}
              angle={radarTarget}
              length={AIM_RAY}
              color="var(--debug-radar)"
              dashed
            />
            <Ray
              x={x}
              y={y}
              angle={turretAngle}
              length={AIM_RAY}
              color="var(--debug-turret)"
              marker="debug-arrow-turret"
            />
            <Ray
              x={x}
              y={y}
              angle={turretTarget}
              length={AIM_RAY}
              color="var(--debug-turret)"
              dashed
            />
            {/* Speed: an arrow along the heading, length ∝ current speed
                (reverse points backward). Hidden when stationary. */}
            {Math.abs(bot.speed) > 0.01 && (
              <Ray
                x={x}
                y={y}
                angle={bodyAngle}
                length={bot.speed * SPEED_SCALE}
                color="var(--debug-speed)"
                marker="debug-arrow-speed"
              />
            )}
          </>
        )}

        {/* Numeric id (the non-color team/bot differentiator). */}
        <text
          x={x}
          y={y - BOT_RADIUS - 3}
          textAnchor="middle"
          fill="var(--debug-fg)"
          style={{
            fontSize: '7px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
          }}
        >
          {getBotId(appIndex, botIndex)}
        </text>

        {/* Compact health bar under the circle. */}
        <g transform={`translate(${x - BOT_RADIUS},${y + BOT_RADIUS + 3})`}>
          <rect
            width={BOT_RADIUS * 2}
            height={3}
            fill={HEALTH_BAR_TRACK}
            fillOpacity={0.6}
          />
          <rect
            width={BOT_RADIUS * 2 * (Math.max(0, bot.health) / 100)}
            height={3}
            fill={healthBarFill(appIndex)}
            style={{ transition: 'width 300ms linear' }}
          />
        </g>
      </g>
    </OverlayTrigger>
  );
};

// A bullet: its projected path (dashed, along the flight heading — clipped to the
// arena bounds by the caller's clipPath) plus a dot at the current position.
const DebugBullet = (props: { bullet: Bullet }) => {
  const x = finite(props.bullet.x);
  const y = finite(props.bullet.y);
  // A ray long enough to always reach the far wall; the arena clip trims it.
  const end = rayEnd(x, y, props.bullet.orientation, 1500);
  return (
    <g pointerEvents="none">
      <line
        x1={x}
        y1={y}
        x2={end.x}
        y2={end.y}
        stroke="var(--debug-bullet)"
        strokeWidth={1}
        strokeDasharray="2 4"
        opacity={0.7}
      />
      <circle cx={x} cy={y} r={2.5} fill="var(--debug-bullet)" />
    </g>
  );
};

export default function DebugArenaSvg(props: {
  arena: Arena;
  onOpenBot?: (appId: string, botIndex: number, shiftKey: boolean) => void;
}) {
  const width = props.arena.width || 750;
  const height = props.arena.height || 750;
  return (
    <>
      <defs>
        <pattern
          id="debugGrid"
          width={GRID}
          height={GRID}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${GRID} 0 L 0 0 0 ${GRID}`}
            fill="none"
            stroke="var(--debug-grid)"
            strokeWidth={1}
          />
        </pattern>
        {[
          ['debug-arrow-speed', 'var(--debug-speed)'],
          ['debug-arrow-turret', 'var(--debug-turret)'],
          ['debug-arrow-radar', 'var(--debug-radar)'],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX={8}
            refY={5}
            markerWidth={5}
            markerHeight={5}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={color} />
          </marker>
        ))}
      </defs>

      {/* 50px measurement grid. */}
      <rect x={0} y={0} width={width} height={height} fill="url(#debugGrid)" />

      {/* Bullet paths under the tanks. */}
      <g name="debug-bullets">
        {props.arena.apps.map((app) =>
          app.bots.map((bot) =>
            bot.bullets
              .filter((bullet) => !bullet.explodedAt)
              .map((bullet) => <DebugBullet key={bullet.id} bullet={bullet} />)
          )
        )}
      </g>

      <g name="debug-bots">
        {props.arena.apps.map((app, appIndex) =>
          app.bots.map((bot, botIndex) => (
            <DebugBot
              key={bot.id}
              bot={bot}
              appIndex={appIndex}
              botIndex={botIndex}
              appName={app.name}
              appId={app.id}
              onOpen={props.onOpenBot}
            />
          ))
        )}
      </g>
    </>
  );
}
