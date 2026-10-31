import React, { useState } from 'react';

// Small shared building blocks for the admin panel tabs (GitHub #469). Styling
// lives in index.css under the .admin-* classes so it follows the light/dark
// theme tokens.

export function Tile(props: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="admin-tile">
      <div className="admin-tile-value">{props.value}</div>
      <div className="admin-tile-label">{props.label}</div>
      {props.sub != null && <div className="admin-tile-sub">{props.sub}</div>}
    </div>
  );
}

export function Section(props: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="admin-section-title">{props.title}</h2>
      {props.note != null && <p className="admin-note">{props.note}</p>}
      {props.children}
    </section>
  );
}

export function Badge(props: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span
      className={props.warn ? 'admin-badge admin-badge-warn' : 'admin-badge'}
    >
      {props.children}
    </span>
  );
}

export function Status(props: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
}) {
  if (props.error) return <p style={{ color: '#c0392b' }}>{props.error}</p>;
  if (props.loading && !props.hasData) return <p>Loading…</p>;
  return null;
}

// Signups per day as a single-series bar chart. One hue (--chart-bar), no
// legend (the title names the series), recessive grid, hover tooltip per day
// with a hit target the full height of the plot, and a table view for anyone
// who can't use the chart.
export function DailyBars(props: {
  title: string;
  days: { date: string; count: number }[];
}) {
  const { days } = props;
  const [hover, setHover] = useState<number | null>(null);
  // Drawn close to the width it displays at in the content pane (~550px), so
  // the 12-unit axis text renders at a readable size rather than scaling down.
  const W = 560;
  const H = 150;
  const PAD = { top: 10, right: 6, bottom: 22, left: 26 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...days.map((d) => d.count));
  // A tidy top for the axis: the max rounded up to an even number.
  const top = max <= 2 ? max : Math.ceil(max / 2) * 2;
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.max(1, slot - 2); // 2px surface gap between bars
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const total = days.reduce((n, d) => n + d.count, 0);
  const tickIdx =
    days.length > 2 ? [0, Math.floor(days.length / 2), days.length - 1] : [0];

  // Bar with a 4px rounded data end, square at the baseline.
  const bar = (x: number, h: number) => {
    const r = Math.min(4, barW / 2, h);
    const yTop = PAD.top + plotH - h;
    const yBase = PAD.top + plotH;
    return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yBase} Z`;
  };

  const hovered = hover != null ? days[hover] : null;

  return (
    <div>
      <div className="admin-note" style={{ marginBottom: 6 }}>
        {props.title}: <strong>{total}</strong> in the last {days.length} days
      </div>
      <div className="admin-chart" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${props.title}, ${total} over the last ${days.length} days, peak ${max} in a day`}
        >
          {[0, top / 2, top].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="currentColor"
                strokeOpacity={v === 0 ? 0.35 : 0.12}
              />
              <text
                x={PAD.left - 6}
                y={y(v) + 4}
                textAnchor="end"
                fontSize="12"
                fill="currentColor"
                fillOpacity={0.65}
              >
                {Number.isInteger(v) ? v : ''}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = PAD.left + i * slot + 1;
            const h = (d.count / top) * plotH;
            return (
              <g key={d.date}>
                {d.count > 0 && (
                  <path
                    d={bar(x, h)}
                    fill="var(--chart-bar)"
                    fillOpacity={hover == null || hover === i ? 1 : 0.55}
                  />
                )}
                <rect
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
          {tickIdx.map((i) => (
            <text
              key={i}
              x={PAD.left + i * slot + slot / 2}
              y={H - 6}
              textAnchor={
                i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'
              }
              fontSize="12"
              fill="currentColor"
              fillOpacity={0.65}
            >
              {days[i]?.date}
            </text>
          ))}
        </svg>
        {hovered && hover != null && (
          <div
            className="admin-chart-tip"
            style={{
              left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%`,
              top: `${(y(hovered.count) / H) * 100}%`,
            }}
          >
            {hovered.date}: {hovered.count}
          </div>
        )}
      </div>
      <details>
        <summary className="admin-note">Show as table</summary>
        <div
          className="admin-table-wrap"
          style={{ maxHeight: 240, overflowY: 'auto' }}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th className="num">Count</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td className="num">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
