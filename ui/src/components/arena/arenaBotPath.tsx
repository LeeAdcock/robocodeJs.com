import React from 'react';
import PointInTime from '../../types/pointInTime';

interface BotPathProps {
  id: string;
  path: PointInTime[];
  pathIndex: number;
  x: number;
  y: number;
}

type Point = { x: number; y: number };

// Fade the trail from the bot backwards: the newest segment (nearest the live
// position) is fully opaque and older ones fade out. `count` is the number of
// points; there are `count - 1` segments, indexed 0 (oldest) .. count-2 (newest).
// Keyed off the newest end (not absolute index) so a brand-new trail with a
// single segment — the spawn→current line before the first turn — is drawn at
// full opacity instead of fading to 0.
export const trailSegmentOpacity = (
  pointIndex: number,
  count: number
): number => 0.45 * ((pointIndex + 1) / Math.max(1, count - 1));

// Reconstruct the trail as an ordered list of points: the recorded vertices in
// ring-buffer insertion order (oldest → newest), followed by the bot's live
// position. Ordering by pathIndex — not by the points' `time` field — is what
// keeps the trail a single polyline. The seed point (path[0]) and the recorded
// vertices are stamped from two different clocks (the displayed playback time
// vs. the arena clock), so a time-sort could place the original point after the
// vertices, drawing a spurious line straight from the origin to the current
// position on top of the real path.
export const buildTrailPoints = (
  path: PointInTime[],
  pathIndex: number,
  x: number,
  y: number
): Point[] => {
  const len = path.length;
  // Start at the next write slot (the oldest surviving entry once the buffer has
  // wrapped); before it wraps, the empty leading slots are skipped below.
  const start = pathIndex % len || 0;
  const points: Point[] = [];
  for (let i = 0; i < len; i++) {
    const p = path[(start + i) % len];
    if (p && p.x && p.y) points.push({ x: p.x, y: p.y });
  }
  points.push({ x, y });
  return points;
};

const BotPathSvg = (props: BotPathProps) => {
  if (!props.path) return null;

  const points = buildTrailPoints(
    props.path,
    props.pathIndex ?? 0,
    props.x,
    props.y
  );

  return (
    <g name="path" key={props.id}>
      {points.map((point, pointIndex) => {
        const next = points[pointIndex + 1];
        if (!next) return null;

        const distance = Math.sqrt(
          Math.pow(next.x - point.x, 2) + Math.pow(next.y - point.y, 2)
        );

        if (distance < 5) return null;
        const angle: number =
          Math.atan2(point.y - next.y, point.x - next.x) * (180 / Math.PI) - 90;

        return (
          <rect
            key={pointIndex}
            opacity={trailSegmentOpacity(pointIndex, points.length)}
            fill="url(#tracks)"
            x={-16}
            y={-16}
            height={distance}
            width={32}
            transform={[
              'translate(' + point.x + ',' + point.y + ')',
              'rotate(180)',
              'rotate(' + angle + ')',
            ].join(' ')}
          />
        );
      })}
    </g>
  );
};

export default BotPathSvg;
