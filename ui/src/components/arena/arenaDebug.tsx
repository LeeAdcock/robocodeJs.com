import React, { useState } from 'react';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';

import Arena from '../../types/arena';
import Bot from '../../types/bot';
import Bullet from '../../types/bullet';
import { colors } from '../../util/colors';

import {
  HEALTH_BAR_TRACK,
  healthBarFill,
  useContinuousAngle,
} from './arenaBot';

// Debug (schematic) render of the arena — the "practical" view that mirrors how
// the simulation actually models things: tanks are the circles they really are
// (radius 16), motion and aim are drawn as explicit vectors, and bullets show
// their projected path. It replaces the terrain-and-sprites scene (arena.tsx
// gates on the debugMode flag) rather than overlaying it. Colors come from CSS
// vars (--debug-*) so the schematic re-themes with light/dark automatically.
//
// Smooth motion, same as the sprites: nothing animates the geometry attributes
// (SVG x1/y1/x2/y2 aren't CSS-transitionable, which is what made the first cut
// jitter at the ~10Hz tick re-render). Instead every moving part is a fixed
// shape positioned by a `transform` (translate + rotate) with a CSS transition,
// and angles run through `useContinuousAngle` so they ease the short way across
// the 0/360 seam — the exact technique arenaBot.tsx uses for the sprites.
//
// Click a tank to focus it: the rest dim, and its telemetry panel, range rings,
// and per-vector angle tags appear. Grid coordinate labels, lead-prediction
// ghosts, radar detection lines, and bullet remaining-travel are always on.

const BOT_RADIUS = 16;
const GRID = 50;
// Grid coordinate labels are drawn every this-many units (a subset of the 50px
// lines so the numbers don't crowd).
const LABEL_STEP = 100;
// Aim rays extend just past the tank circle — turret slightly beyond, radar
// nested a touch shorter — so the aim reads clearly against the rim. The heading
// ray grows further past it with the bot's speed (see headingLen).
const TURRET_RAY = 24;
const RADAR_RAY = 20;
const SPEED_SCALE = 22;
// Lead prediction: extrapolate each bot's position this many ticks ahead from
// its current velocity, so you can see where to aim.
const PREDICT_TICKS = 12;
// Range rings around the focused bot: this many, at this spacing (units).
const RANGE_RING_STEP = 100;
const RANGE_RING_COUNT = 3;
// Radar beam cone, matched to the server's detection shape (botRadar.ts: base
// widening to ±122 at range 600 → atan(122/600) ≈ 11.5°).
const RADAR_HALF_ANGLE = 11.5;
const RADAR_RANGE = 600;
const TRANSITION = { transition: 'transform 200ms linear' } as const;

// Coordinates/orientations can be momentarily NaN (resync, between-frames gap);
// feeding those into an SVG attribute produces errors, so guard at the boundary
// (same approach as arenaBot.tsx).
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);
// Wrap an angle (which may be a sum of relative orientations) into [0, 360) for
// display.
const normalizeDeg = (a: number): number => ((finite(a) % 360) + 360) % 360;
// Unit displacement of a heading, in the 0°=up, clockwise convention shared with
// util/simulate.ts (a tank at `angle` moves along this each tick × its speed).
const unit = (angle: number) => ({
  x: Math.sin((-finite(angle) * Math.PI) / 180),
  y: Math.cos((-finite(angle) * Math.PI) / 180),
});

// Local endpoint of a ray of `length` at sub-`angle` (degrees). Used for the
// fixed beam-cone corners and to place upright labels at a rotating ray's tip;
// live rays rotate via a transform instead (see Ray).
const localPoint = (angle: number, length: number) => {
  const u = unit(angle);
  return { x: u.x * length, y: u.y * length };
};
// Beam corners are constant in the radar's local frame; the group rotates them.
const BEAM = (() => {
  const near = localPoint(0, 0);
  const a = localPoint(-RADAR_HALF_ANGLE, RADAR_RANGE);
  const b = localPoint(RADAR_HALF_ANGLE, RADAR_RANGE);
  return `${near.x},${near.y} ${a.x},${a.y} ${b.x},${b.y}`;
})();

// Distance from (x,y) along `angle` to the arena boundary — a bullet's remaining
// travel before it leaves the arena (server removes it at the wall).
const distanceToEdge = (
  x: number,
  y: number,
  angle: number,
  width: number,
  height: number
): number => {
  const u = unit(angle);
  let t = Infinity;
  if (u.x > 1e-6) t = Math.min(t, (width - x) / u.x);
  else if (u.x < -1e-6) t = Math.min(t, (0 - x) / u.x);
  if (u.y > 1e-6) t = Math.min(t, (height - y) / u.y);
  else if (u.y < -1e-6) t = Math.min(t, (0 - y) / u.y);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
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

// One ray, drawn as a fixed line pointing along local +y and rotated into place
// by a transitioned transform (so it eases between ticks instead of snapping).
// Rendered inside the bot's translated group, so it needs no x/y. Solid +
// arrowed = current; dashed + faded = target.
const Ray = (props: {
  angle: number;
  length: number;
  color: string;
  dashed?: boolean;
  marker?: string;
  opacity?: number;
}) => {
  const angle = useContinuousAngle(props.angle);
  return (
    <g transform={`rotate(${angle})`} style={TRANSITION}>
      <line
        x1={0}
        y1={0}
        x2={0}
        y2={finite(props.length)}
        stroke={props.color}
        strokeWidth={1.5}
        strokeDasharray={props.dashed ? '4 3' : undefined}
        strokeOpacity={props.opacity}
        markerEnd={props.marker ? `url(#${props.marker})` : undefined}
      />
    </g>
  );
};

const RadarBeam = (props: { angle: number }) => {
  const angle = useContinuousAngle(props.angle);
  return (
    <g transform={`rotate(${angle})`} style={TRANSITION}>
      <polygon
        points={BEAM}
        fill="var(--debug-radar)"
        opacity={0.1}
        pointerEvents="none"
      />
    </g>
  );
};

// A small upright label at a ray's tip (angle readout for the focused bot).
const AngleTag = (props: { angle: number; length: number; color: string }) => {
  const p = localPoint(props.angle, props.length + 8);
  return (
    <text
      x={p.x}
      y={p.y}
      textAnchor="middle"
      dominantBaseline="central"
      fill={props.color}
      style={{ fontSize: '7px', fontFamily: 'monospace' }}
    >
      {normalizeDeg(props.angle)}°
    </text>
  );
};

const DebugBot = (props: {
  bot: Bot;
  appIndex: number;
  botIndex: number;
  appName: string;
  appId?: string;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onOpen?: (appId: string, botIndex: number, shiftKey: boolean) => void;
}) => {
  const { bot, appIndex, botIndex, selected, dimmed } = props;
  const alive = bot.health > 0;

  // Absolute orientations: turret is relative to the body, radar to the turret.
  const turretAngle = bot.bodyOrientation + bot.turretOrientation;
  const turretTarget = bot.bodyOrientation + bot.turretOrientationTarget;
  const radarAngle =
    bot.bodyOrientation + bot.turretOrientation + bot.radarOrientation;
  const radarTarget =
    bot.bodyOrientation + bot.turretOrientation + bot.radarOrientationTarget;

  // The heading ray reaches the rim when stopped and extends past it while
  // moving (length grows with speed; a negative speed points backward). Only
  // when moving does it break the circle and get an arrowhead.
  const moving = Math.abs(bot.speed) > 0.01;
  const headingLen = moving
    ? Math.sign(bot.speed) * (BOT_RADIUS + Math.abs(bot.speed) * SPEED_SCALE)
    : BOT_RADIUS;

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
        transform={`translate(${finite(bot.x)},${finite(bot.y)})`}
        style={{
          ...TRANSITION,
          opacity: dimmed ? 0.3 : alive ? 1 : 0.35,
          cursor: 'pointer',
        }}
        onClick={() => props.onSelect(bot.id)}
        onDoubleClick={(e) => {
          if (props.onOpen && props.appId)
            props.onOpen(props.appId, botIndex + 1, e.shiftKey);
        }}
      >
        {alive && !dimmed && (
          <>
            {bot.radarOn && <RadarBeam angle={radarAngle} />}

            {/* Each aim/heading is a solid current ray with its dashed, dimmed
                target ray drawn underneath. The target is always drawn (not
                gated on "is turning"): the current ray's CSS transition lags the
                underlying data, so unmounting the target on-target would blink it
                out a frame before the animated current ray finishes aligning.
                When on-target the solid current ray covers the target exactly. */}
            <Ray
              angle={radarTarget}
              length={RADAR_RAY}
              color="var(--debug-radar)"
              dashed
              opacity={0.45}
            />
            <Ray
              angle={radarAngle}
              length={RADAR_RAY}
              color="var(--debug-radar)"
            />
            <Ray
              angle={turretTarget}
              length={TURRET_RAY}
              color="var(--debug-turret)"
              dashed
              opacity={0.45}
            />
            <Ray
              angle={turretAngle}
              length={TURRET_RAY}
              color="var(--debug-turret)"
            />
            {/* Target heading: same length as the current heading so the two
                fan apart visibly by the turn angle. */}
            <Ray
              angle={bot.bodyOrientationTarget}
              length={headingLen}
              color="var(--debug-speed)"
              dashed
              opacity={0.45}
            />
            <Ray
              angle={bot.bodyOrientation}
              length={headingLen}
              color="var(--debug-speed)"
              marker={moving ? 'debug-arrow-speed' : undefined}
            />

            {/* Angle readouts at the ray tips, focused bot only. */}
            {selected && (
              <>
                <AngleTag
                  angle={bot.bodyOrientation}
                  length={Math.abs(headingLen)}
                  color="var(--debug-speed)"
                />
                <AngleTag
                  angle={turretAngle}
                  length={TURRET_RAY}
                  color="var(--debug-turret)"
                />
                <AngleTag
                  angle={radarAngle}
                  length={RADAR_RAY}
                  color="var(--debug-radar)"
                />
              </>
            )}
          </>
        )}

        {/* Focus highlight ring. */}
        {selected && (
          <circle
            cx={0}
            cy={0}
            r={BOT_RADIUS + 4}
            fill="none"
            stroke="var(--debug-fg)"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.6}
          />
        )}

        {/* The tank as the sim's collision circle. A transparent fill makes the
            whole disc a click target (not just the 1px stroke). */}
        <circle
          cx={0}
          cy={0}
          r={BOT_RADIUS}
          fill="transparent"
          stroke={teamStroke(appIndex)}
          strokeWidth={selected ? 3 : 2}
          strokeDasharray={alive ? undefined : '4 3'}
        />

        {/* Numeric id (the non-color team/bot differentiator). */}
        <text
          x={0}
          y={-(BOT_RADIUS + 3)}
          textAnchor="middle"
          fill="var(--debug-fg)"
          pointerEvents="none"
          style={{
            fontSize: '7px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
          }}
        >
          {getBotId(appIndex, botIndex)}
        </text>

        {/* Compact health bar under the circle. */}
        <g
          transform={`translate(${-BOT_RADIUS},${BOT_RADIUS + 3})`}
          pointerEvents="none"
        >
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
// arena bounds by the caller's clipPath), a dimmer back-trace to the firing
// point, a dot at the current position, and its remaining travel to the wall.
const DebugBullet = (props: { bullet: Bullet; remaining: number }) => {
  const { bullet } = props;
  const x = finite(bullet.x);
  const y = finite(bullet.y);
  // A bullet travels in a straight line from its origin along `orientation`, so
  // in this rotated local frame the firing point lies directly behind it.
  const dx = x - finite(bullet.origin?.x);
  const dy = y - finite(bullet.origin?.y);
  const traveled = Math.sqrt(dx * dx + dy * dy);
  return (
    <g
      transform={`translate(${x},${y})`}
      style={TRANSITION}
      pointerEvents="none"
    >
      <g transform={`rotate(${finite(bullet.orientation)})`}>
        {/* Forward projected path — long enough to always reach the far wall;
            the arena clip trims it. */}
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={1500}
          stroke="var(--debug-bullet)"
          strokeWidth={1}
          strokeDasharray="2 4"
          opacity={0.7}
        />
        {/* Travelled path back to the firing point — same dotted style, dimmed. */}
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={-traveled}
          stroke="var(--debug-bullet)"
          strokeWidth={1}
          strokeDasharray="2 4"
          opacity={0.3}
        />
      </g>
      <circle cx={0} cy={0} r={2.5} fill="var(--debug-bullet)" />
      <text
        x={4}
        y={-4}
        fill="var(--debug-bullet)"
        style={{ fontSize: '6px', fontFamily: 'monospace' }}
      >
        {Math.round(props.remaining)}
      </text>
    </g>
  );
};

// Faint ghost of where a moving bot will be PREDICT_TICKS from now, from its
// current velocity — the lead a shooter needs.
const LeadGhost = (props: { bot: Bot; appIndex: number }) => {
  const { bot } = props;
  if (bot.health <= 0 || Math.abs(bot.speed) <= 0.01) return null;
  const u = unit(bot.bodyOrientation);
  const x = finite(bot.x);
  const y = finite(bot.y);
  const px = x + u.x * bot.speed * PREDICT_TICKS;
  const py = y + u.y * bot.speed * PREDICT_TICKS;
  const stroke = teamStroke(props.appIndex);
  return (
    <g
      pointerEvents="none"
      opacity={0.28}
      style={{ transition: 'all 200ms linear' }}
    >
      <line
        x1={x}
        y1={y}
        x2={px}
        y2={py}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray="1 3"
      />
      <circle
        cx={px}
        cy={py}
        r={BOT_RADIUS}
        fill="none"
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
    </g>
  );
};

// Distance rings around the focused bot (100/200/300 …), each labelled.
const RangeRings = (props: { x: number; y: number }) => (
  <g
    transform={`translate(${finite(props.x)},${finite(props.y)})`}
    pointerEvents="none"
    style={TRANSITION}
  >
    {Array.from({ length: RANGE_RING_COUNT }, (_v, i) => {
      const r = (i + 1) * RANGE_RING_STEP;
      return (
        <g key={r}>
          <circle
            cx={0}
            cy={0}
            r={r}
            fill="none"
            stroke="var(--debug-fg)"
            strokeWidth={0.75}
            strokeDasharray="2 4"
            opacity={0.3}
          />
          <text
            x={0}
            y={-r}
            textAnchor="middle"
            fill="var(--debug-fg)"
            opacity={0.5}
            style={{ fontSize: '7px', fontFamily: 'monospace' }}
          >
            {r}
          </text>
        </g>
      );
    })}
  </g>
);

// Bottom-left telemetry panel for the focused bot: the exact values a bot's code
// reads, so it can be checked against the arena.
const TelemetryPanel = (props: {
  bot: Bot;
  appIndex: number;
  botIndex: number;
  appName: string;
  height: number;
}) => {
  const { bot } = props;
  const turret = normalizeDeg(bot.bodyOrientation + bot.turretOrientation);
  const radar = normalizeDeg(
    bot.bodyOrientation + bot.turretOrientation + bot.radarOrientation
  );
  const headTarget = normalizeDeg(bot.bodyOrientationTarget);
  const head = normalizeDeg(bot.bodyOrientation);
  const rows: [string, string][] = [
    ['pos', `${Math.round(finite(bot.x))}, ${Math.round(finite(bot.y))}`],
    ['head', head === headTarget ? `${head}°` : `${head}° → ${headTarget}°`],
    [
      'speed',
      Math.abs(bot.speed - bot.speedTarget) < 0.05
        ? bot.speed.toFixed(1)
        : `${bot.speed.toFixed(1)} → ${bot.speedTarget.toFixed(1)}`,
    ],
    ['turret', `${turret}°`],
    ['radar', `${radar}°`],
    ['health', `${Math.round(bot.health)}`],
  ];
  const lineH = 14;
  const padX = 8;
  const padY = 8;
  const w = 150;
  const h = padY * 2 + lineH * (rows.length + 1);
  const y0 = props.height - h - 8;
  return (
    <g pointerEvents="none">
      <rect
        x={8}
        y={y0}
        width={w}
        height={h}
        rx={4}
        fill="var(--debug-bg)"
        fillOpacity={0.92}
        stroke="var(--debug-grid)"
        strokeWidth={1}
      />
      <text
        x={8 + padX}
        y={y0 + padY + 9}
        fill="var(--debug-fg)"
        style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 'bold' }}
      >
        {props.appName} [{props.appIndex + 1}
        {props.botIndex + 1}]
      </text>
      {rows.map(([label, value], i) => (
        <text
          key={label}
          x={8 + padX}
          y={y0 + padY + 9 + lineH * (i + 1)}
          fill="var(--debug-fg)"
          style={{ fontSize: '9px', fontFamily: 'monospace' }}
        >
          <tspan opacity={0.6}>{label.padEnd(7)}</tspan>
          {value}
        </text>
      ))}
    </g>
  );
};

export default function DebugArenaSvg(props: {
  arena: Arena;
  onOpenBot?: (appId: string, botIndex: number, shiftKey: boolean) => void;
}) {
  const width = props.arena.width || 750;
  const height = props.arena.height || 750;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const apps = props.arena.apps;
  // Position lookup (for detection lines) and the focused-bot resolution.
  const posById: Record<string, { x: number; y: number }> = {};
  let selected:
    | { bot: Bot; appIndex: number; botIndex: number; appName: string }
    | undefined;
  apps.forEach((app, appIndex) =>
    app.bots.forEach((bot, botIndex) => {
      posById[bot.id] = { x: finite(bot.x), y: finite(bot.y) };
      if (bot.id === selectedId)
        selected = { bot, appIndex, botIndex, appName: app.name };
    })
  );
  const anySelected = !!selected;

  const labels: number[] = [];
  for (let v = LABEL_STEP; v < width; v += LABEL_STEP) labels.push(v);

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
        {/* Only the heading ray is arrowed (turret/radar rays sit at the circle
            where an arrowhead would be cramped and redundant). */}
        <marker
          id="debug-arrow-speed"
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={5}
          markerHeight={5}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--debug-speed)" />
        </marker>
      </defs>

      {/* 50px measurement grid. The pattern draws each cell's line along its
          top/left edge, so the arena's far right/bottom edges get no line and the
          clip would shave the outermost half-pixel — an inset 1px border closes
          the grid off crisply on all four sides. Clicking the grid clears focus. */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="url(#debugGrid)"
        onClick={() => setSelectedId(null)}
      />
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        fill="none"
        stroke="var(--debug-grid)"
        strokeWidth={1}
        shapeRendering="crispEdges"
        pointerEvents="none"
      />

      {/* Grid coordinate labels along the top (x) and left (y) edges. */}
      <g pointerEvents="none" fill="var(--debug-fg)" opacity={0.5}>
        {labels.map((v) => (
          <text
            key={`x${v}`}
            x={v}
            y={9}
            textAnchor="middle"
            style={{ fontSize: '7px', fontFamily: 'monospace' }}
          >
            {v}
          </text>
        ))}
        {labels.map((v) => (
          <text
            key={`y${v}`}
            x={3}
            y={v}
            dominantBaseline="central"
            style={{ fontSize: '7px', fontFamily: 'monospace' }}
          >
            {v}
          </text>
        ))}
      </g>

      {/* Lead-prediction ghosts for every moving bot. */}
      <g name="debug-ghosts">
        {apps.map((app, appIndex) =>
          app.bots.map((bot) => (
            <LeadGhost key={bot.id} bot={bot} appIndex={appIndex} />
          ))
        )}
      </g>

      {/* Radar detection lines: scanner → each detected target (transient). */}
      <g
        name="debug-detections"
        pointerEvents="none"
        stroke="var(--debug-radar)"
      >
        {apps.map((app) =>
          app.bots.map((bot) =>
            (bot.detected ?? []).map((targetId) => {
              const target = posById[targetId];
              if (!target) return null;
              return (
                <line
                  key={`${bot.id}-${targetId}`}
                  x1={finite(bot.x)}
                  y1={finite(bot.y)}
                  x2={target.x}
                  y2={target.y}
                  strokeWidth={1}
                  strokeDasharray="5 3"
                  opacity={0.55}
                />
              );
            })
          )
        )}
      </g>

      {/* Range rings around the focused bot. */}
      {selected && <RangeRings x={selected.bot.x} y={selected.bot.y} />}

      {/* Bullet paths under the tanks. */}
      <g name="debug-bullets">
        {apps.map((app) =>
          app.bots.map((bot) =>
            bot.bullets
              .filter((bullet) => !bullet.explodedAt)
              .map((bullet) => (
                <DebugBullet
                  key={bullet.id}
                  bullet={bullet}
                  remaining={distanceToEdge(
                    finite(bullet.x),
                    finite(bullet.y),
                    bullet.orientation,
                    width,
                    height
                  )}
                />
              ))
          )
        )}
      </g>

      <g name="debug-bots">
        {apps.map((app, appIndex) =>
          app.bots.map((bot, botIndex) => (
            <DebugBot
              key={bot.id}
              bot={bot}
              appIndex={appIndex}
              botIndex={botIndex}
              appName={app.name}
              appId={app.id}
              selected={bot.id === selectedId}
              dimmed={anySelected && bot.id !== selectedId}
              onSelect={setSelectedId}
              onOpen={props.onOpenBot}
            />
          ))
        )}
      </g>

      {selected && (
        <TelemetryPanel
          bot={selected.bot}
          appIndex={selected.appIndex}
          botIndex={selected.botIndex}
          appName={selected.appName}
          height={height}
        />
      )}
    </>
  );
}
