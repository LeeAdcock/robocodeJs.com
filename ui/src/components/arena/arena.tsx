import React, { useSyncExternalStore } from 'react';

import Arena from '../../types/arena';
import { getMotionSnap, subscribeMotionSnap } from '../../util/motionSnap';

import CraterSvg from './arenaCrater';
import TerrainSvg from './arenaTerrain';
import BulletSvg from './arenaBullet';
import BotSvg from './arenaBot';
import BotPathSvg from './arenaBotPath';

const ArenaStyle = React.memo((props: { width: number; height: number }) => (
  <defs>
    <clipPath id="trim-extra">
      <rect
        x="0"
        y="0"
        width={props.width || 750}
        height={props.height || 750}
      />
    </clipPath>
    <pattern id="grass" width="32" height="32" patternUnits="userSpaceOnUse">
      <image href={'/sprites/tileGrass1.png'} height="32" width="32" />
    </pattern>
    <pattern id="ocean" width="32" height="32" patternUnits="userSpaceOnUse">
      <image href={'/sprites/ocean.png'} height="32" width="32" />
    </pattern>
    <pattern id="sand" width="32" height="32" patternUnits="userSpaceOnUse">
      <image href={'/sprites/tileSand1.png'} height="32" width="32" />
    </pattern>
    <pattern id="tracks" patternUnits="userSpaceOnUse" width="32" height="32">
      <image
        href="/sprites/tracksLarge.png"
        x="0"
        y="0"
        width="32"
        height="32"
      />
    </pattern>
    <filter id="blur" x="0" y="0">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
    </filter>
    <filter id="shadow" colorInterpolationFilters="sRGB">
      <feDropShadow dx="0" dy="0" stdDeviation="3" floodOpacity="0.5" />
    </filter>
    <pattern
      id="shadedRelief"
      patternUnits="userSpaceOnUse"
      width="1600"
      height="1600"
    >
      <image href="/sprites/contour.jpg" />
    </pattern>
    <linearGradient id="radar" gradientTransform="rotate(90)">
      <stop offset="0" stopColor="white" stopOpacity=".1" />
      <stop offset="1" stopColor="white" stopOpacity="0" />
    </linearGradient>
    {/* Soft radial glow used for the damage pulse; color themes via CSS var. */}
    {/* Hold high opacity out to ~0.5 (roughly the tank's edge, since the sprite
        covers the core) so the visible halo beyond the tank reads brightly. */}
    <radialGradient id="damageGlow">
      <stop
        offset="0"
        stopColor="var(--damage-glow-color, #ff2d2d)"
        stopOpacity="0.9"
      />
      <stop
        offset="0.5"
        stopColor="var(--damage-glow-color, #ff2d2d)"
        stopOpacity="0.8"
      />
      <stop
        offset="0.8"
        stopColor="var(--damage-glow-color, #ff2d2d)"
        stopOpacity="0.35"
      />
      <stop
        offset="1"
        stopColor="var(--damage-glow-color, #ff2d2d)"
        stopOpacity="0"
      />
    </radialGradient>
  </defs>
));

interface ArenaSvgProps {
  arena: Arena;
  darkMode: boolean;
  time: number;
  // Open a bot from the arena: double-click → source, shift+double-click → logs.
  onOpenBot?: (appId: string, botIndex: number, shiftKey: boolean) => void;
  // Drop the framing border for an edge-to-edge, full-viewport render (the public
  // /watch spectator page). The ocean rect already bleeds past the viewBox, so
  // without the border the arena fills the whole container.
  hideBorder?: boolean;
}

export default function ArenaSvg(props: ArenaSvgProps) {
  const apps = props.arena.apps;
  // True while arena state is being replaced from a snapshot (tab-visible
  // resync, reconnect, restart) rather than advanced tick by tick. The
  // `motion-snap` class (index.css) suppresses the sprite CSS transitions so
  // the discontinuous jump doesn't animate as a physics-defying glide.
  const snapping = useSyncExternalStore(subscribeMotionSnap, getMotionSnap);
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="-10 -10 770 770"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      className={snapping ? 'motion-snap' : undefined}
      style={{
        border: props.hideBorder ? undefined : '2px solid rgb(33,37,41)',
        // Contain the night-mode blend overlay so it multiplies only the arena,
        // not whatever is painted behind the SVG.
        isolation: 'isolate',
      }}
    >
      <ArenaStyle width={props.arena.width} height={props.arena.height} />
      <rect x="-200%" y="-200%" height="500%" width="500%" fill="url(#ocean)" />
      <g clipPath="url(#trim-extra)">
        <TerrainSvg>
          <g name="craters">
            {apps.map((app) =>
              app.bots.map((bot) =>
                bot.bullets
                  .filter((bullet) => bullet.explodedAt)
                  .map((bullet) => (
                    <CraterSvg
                      key={bullet.id}
                      id={bullet.id}
                      x={bullet.x}
                      y={bullet.y}
                      orientation={bullet.orientation}
                    />
                  ))
              )
            )}
          </g>
          <g name="paths">
            {apps.map((app) =>
              app.bots.map((bot) => (
                <BotPathSvg
                  id={bot.id}
                  key={bot.id}
                  path={bot.path}
                  pathIndex={bot.pathIndex}
                  x={bot.x}
                  y={bot.y}
                />
              ))
            )}
          </g>
          <g name="bots">
            {apps.map((app) => {
              const appIndex =
                props.arena?.apps.map((app) => app.id).indexOf(app.id) || 0;
              return app.bots.map((bot, botIndex) => {
                return bot.health <= 0 ? (
                  <BotSvg
                    key={bot.id}
                    botIndex={botIndex}
                    appIndex={appIndex}
                    appName={app.name}
                    id={bot.id}
                    appId={app.id}
                    onOpen={props.onOpenBot}
                    health={bot.health}
                    crashed={bot.crashed}
                    faultCode={bot.faultCode}
                    bodyOrientation={bot.bodyOrientation}
                    turretOrientation={bot.turretOrientation}
                    radarOrientation={bot.radarOrientation}
                    x={bot.x}
                    y={bot.y}
                    radarOn={false}
                  />
                ) : null;
              });
            })}
            {apps.map((app) => {
              const appIndex =
                props.arena?.apps.map((app) => app.id).indexOf(app.id) || 0;
              return app.bots.map((bot, botIndex) =>
                bot.health > 0 ? (
                  <BotSvg
                    key={bot.id}
                    botIndex={botIndex}
                    appIndex={appIndex}
                    appName={app.name}
                    id={bot.id}
                    appId={app.id}
                    onOpen={props.onOpenBot}
                    health={bot.health}
                    crashed={bot.crashed}
                    faultCode={bot.faultCode}
                    bodyOrientation={bot.bodyOrientation}
                    turretOrientation={bot.turretOrientation}
                    radarOrientation={bot.radarOrientation}
                    x={bot.x}
                    y={bot.y}
                    radarOn={bot.radarOn}
                    lastDamagedAt={bot.lastDamagedAt}
                    lastDamageAmount={bot.lastDamageAmount}
                  />
                ) : null
              );
            })}
          </g>
          <g name="bullets">
            {apps.map((app, appIndex) =>
              app.bots.map((bot) => (
                <g key={bot.id}>
                  {bot.bullets
                    .filter((bullet) => !bullet.explodedAt)
                    .map((bullet) => (
                      <BulletSvg
                        key={bullet.id}
                        appIndex={appIndex}
                        id={bullet.id}
                        x={bullet.x}
                        y={bullet.y}
                        orientation={bullet.orientation}
                      />
                    ))}
                </g>
              ))
            )}
          </g>
        </TerrainSvg>
      </g>
      {props.darkMode && (
        // Night mode: multiply the whole arena (terrain, padding, and bots) by a
        // cool, near-neutral blue-grey so it reads as a dim moonlit scene rather
        // than a washed-out grey. The channels are kept balanced (blue only
        // slightly leading) so the warm desert/sand biome darkens to muted sand
        // instead of the alarm-red a red-dominant multiply produced (#259), while
        // the green biome reads as darkened grass. Keeping the tint cool also lets
        // the warm damage glow (--damage-glow-color) stand out against it.
        // pointerEvents none keeps the bots double-clickable underneath.
        <rect
          x="-200%"
          y="-200%"
          height="500%"
          width="500%"
          fill="rgb(95, 103, 130)"
          style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }}
        />
      )}
      {(props.arena.deployTick ?? 0) - props.time > 0 && (
        // Deployment countdown: turrets are weapons-held until deployTick, so show
        // the seconds remaining (~10 ticks/s) centered over the arena. In night
        // mode use the theme's link accent (--link, the same warm tone as dark-mode
        // anchor links) so its warmth stands out against the cool night tint; white
        // in light mode. A dark outline keeps it legible over terrain either way,
        // and pointerEvents none keeps bots clickable underneath.
        <text
          x={(props.arena.width || 750) / 2}
          y={(props.arena.height || 750) / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="110"
          fontWeight="bold"
          fill={props.darkMode ? 'var(--link)' : '#fff'}
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="3"
          paintOrder="stroke"
          style={{ pointerEvents: 'none' }}
        >
          {Math.ceil(((props.arena.deployTick ?? 0) - props.time) / 10)}
        </text>
      )}
    </svg>
  );
}
