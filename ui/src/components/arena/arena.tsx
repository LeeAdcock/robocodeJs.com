import React, { useEffect, useState, useSyncExternalStore } from 'react';

import Arena from '../../types/arena';
import { getMotionSnap, subscribeMotionSnap } from '../../util/motionSnap';

import CraterSvg from './arenaCrater';
import TerrainSvg from './arenaTerrain';
import BulletSvg from './arenaBullet';
import BotSvg from './arenaBot';
import BotPathSvg from './arenaBotPath';
import DebugArenaSvg from './arenaDebug';

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
    {/* Soft dark scrim behind the deployment countdown digit: a radial fade to
        transparent so the number stays legible over any terrain (grass, sand,
        road) and in either theme, decoupling legibility from the stroke alone. */}
    <radialGradient id="countdownScrim">
      <stop offset="0" stopColor="rgba(0,0,0,0.45)" />
      <stop offset="0.6" stopColor="rgba(0,0,0,0.28)" />
      <stop offset="1" stopColor="rgba(0,0,0,0)" />
    </radialGradient>
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
  // Schematic "debug view": swap the terrain-and-sprites scene for a 50px grid,
  // circle tanks, motion/aim vectors, and bullet paths (see arenaDebug.tsx).
  // Optional/defaults off so the spectator page (watchArenaPage) stays scenic.
  debugMode?: boolean;
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

  // Deployment countdown visibility. `counting` is true while ticks remain before
  // deploy; when it flips false we keep the node mounted for one real-time beat so
  // the CSS fade-out (index.css .arena-countdown) can play out. The unmount is
  // timer-based, not tick-based, because the sim can advance several buffered
  // ticks in a single render at the deploy moment — a tick-count tail would be
  // leapt over before the fade finishes.
  const deployTick = props.arena.deployTick ?? 0;
  const counting = deployTick > 0 && deployTick - props.time > 0;
  const [showCountdown, setShowCountdown] = useState(counting);
  useEffect(() => {
    if (counting) {
      setShowCountdown(true);
      return;
    }
    const t = setTimeout(() => setShowCountdown(false), 350);
    return () => clearTimeout(t);
  }, [counting]);

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
      {props.debugMode ? (
        // Schematic background: a flat themed fill (no ocean/terrain), overlaid
        // by the 50px grid + vectors inside the clip group below.
        <rect
          x="-200%"
          y="-200%"
          height="500%"
          width="500%"
          fill="var(--debug-bg)"
        />
      ) : (
        <rect
          x="-200%"
          y="-200%"
          height="500%"
          width="500%"
          fill="url(#ocean)"
        />
      )}
      <g clipPath="url(#trim-extra)">
        {props.debugMode ? (
          <DebugArenaSvg arena={props.arena} onOpenBot={props.onOpenBot} />
        ) : (
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
        )}
      </g>
      {!props.debugMode && props.darkMode && (
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
      {showCountdown &&
        (() => {
          // Deployment countdown: turrets are weapons-held until deployTick, so
          // show the seconds remaining (~10 ticks/s) centered over the arena. In
          // night mode the theme's link accent (--link, the warm dark-mode anchor
          // tone) stands out against the cool night tint; white in light mode. A
          // soft dark radial scrim keeps it legible over any terrain (grass, sand,
          // road) without leaning on the stroke, and the black outline adds a crisp
          // edge. When `counting` ends, opacity flips to 0 and the group fades out
          // (index.css) instead of vanishing; each digit pops in on its own key.
          const cx = (props.arena.width || 750) / 2;
          const cy = (props.arena.height || 750) / 2;
          const seconds = Math.max(
            1,
            Math.ceil((deployTick - props.time) / 10)
          );
          return (
            <g
              className="arena-countdown"
              style={{ opacity: counting ? 1 : 0, pointerEvents: 'none' }}
            >
              <circle cx={cx} cy={cy} r="100" fill="url(#countdownScrim)" />
              <text
                key={seconds}
                className="arena-countdown-digit"
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="110"
                fontWeight="900"
                fill={props.darkMode ? 'var(--link)' : '#fff'}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth="3"
                paintOrder="stroke"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {seconds}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}
