import React from 'react';
import Arena from '../../types/arena';
import { colors } from '../../util/colors';
import { titleCase } from '../../util/titleCase';

// A small always-visible roster legend for the arena: each live app's color
// swatch (the same mini tank sprite the navbar/roster use) beside its name, so
// you can tell which app a team of bots belongs to at a glance without opening
// the Apps menu or hovering a bot (GitHub #253). An app's color is its index in
// `arena.apps`, matching the sprite hues drawn in the arena and the per-bot id
// tag. The name is the non-color cue that keeps teams distinguishable when hues
// repeat past five apps or are confusable under color blindness (GitHub #132).
export default function ArenaLegend(props: { arena: Arena }) {
  const apps = props.arena.apps;
  if (!apps || apps.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '6px 8px',
        borderRadius: '6px',
        // A neutral scrim so the list stays legible over both the grass/sand
        // terrain and the cool night-mode tint, in either app theme.
        background: 'rgba(33, 37, 41, 0.55)',
        color: '#fff',
        fontSize: '0.8rem',
        lineHeight: 1.3,
        pointerEvents: 'none',
        maxWidth: '12em',
      }}
    >
      {apps.map((app, index) => (
        <div
          key={app.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            minWidth: 0,
          }}
        >
          <img
            src={`/sprites/tank_${colors[index]}.png`}
            alt=""
            style={{ height: '1.1em', flexShrink: 0 }}
          />
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {titleCase(app.name || 'Unknown')}
          </span>
        </div>
      ))}
    </div>
  );
}
