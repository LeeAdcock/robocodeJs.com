import type {
  AdminAppLabel,
  AdminIneligibleReason,
  AdminLadder,
} from '../../types/admin';
import { percent, timeAgo, useAdminData } from '../../util/admin';
import { Badge, Section, Status, Tile } from './adminParts';

// The global ladder (GitHub #151) as the matchmaker sees it: throughput, the
// eligible pool, how many times each pairing has met against the cap, live
// claims, and why apps outside the pool aren't in it. The loop's enabled and
// running flags are per instance; everything else comes from the database.

const REFRESH_MS = 30000;

// Above this many apps the pair matrix stops being readable at page width.
const MATRIX_MAX = 25;

const REASONS: Record<AdminIneligibleReason, string> = {
  empty: 'Empty',
  starter: 'Untouched starter',
  broken: 'Broken (crashed in a ranked match)',
  'stale-app': 'Not edited in 3 months',
  'stale-owner': 'Owner inactive for 3 months',
  unknown: 'Unknown (eligibility rules disagree, worth a look)',
};

const appName = (a: AdminAppLabel) => (
  <>
    {a.name ?? '(unnamed)'}
    {a.ownerName && <span className="admin-note"> · {a.ownerName}</span>}
  </>
);

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

export default function LadderTab() {
  const { data, error, loading } = useAdminData<AdminLadder>(
    '/api/admin/ladder',
    undefined,
    REFRESH_MS
  );

  return (
    <div>
      <Status loading={loading} error={error} hasData={data !== null} />
      {data && <LadderBody data={data} />}
    </div>
  );
}

function LadderBody({ data }: { data: AdminLadder }) {
  const cap = data.config.pairMatchCap;
  const claimed = new Set(data.claims.map((c) => c.appId));
  return (
    <>
      <p className="admin-note">
        Loop on <code>{data.instance.hostname}</code>:{' '}
        <strong>{data.loopRunning ? 'running' : 'stopped'}</strong>
        {data.enabled ? '' : ' (LADDER_ENABLED is not set here)'}. Every
        instance runs its own loop when enabled.
      </p>

      <Section title="Throughput">
        <div className="admin-tiles">
          <Tile
            label="Matches, last hour"
            value={data.throughput.hour.total}
            sub={`${percent(data.throughput.hour.unrated, data.throughput.hour.total)} unrated`}
          />
          <Tile
            label="Matches, 24 h"
            value={data.throughput.day.total}
            sub={`${percent(data.throughput.day.unrated, data.throughput.day.total)} unrated`}
          />
          <Tile label="Eligible apps" value={data.pool.length} />
          <Tile
            label="Open pairings"
            value={data.pairSummary.open}
            sub={
              cap > 0
                ? `${data.pairSummary.saturated} of ${data.pairSummary.total} at the cap of ${cap}`
                : 'no pair cap'
            }
          />
        </div>
        <p className="admin-note" style={{ marginTop: 8 }}>
          Unrated means the match timed out or both apps crashed. Counts read
          the retained match history, which drops a pairing’s older games once
          either app is edited, so they can run low right after an edit.
        </p>
      </Section>

      <Section title="Eligible pool">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>App</th>
                <th className="num">Rating</th>
                <th className="num">Games</th>
                <th className="num">Win rate</th>
                <th>Last edited</th>
              </tr>
            </thead>
            <tbody>
              {data.pool.map((p) => (
                <tr key={p.appId}>
                  <td>
                    {appName(p)}
                    {claimed.has(p.appId) && <Badge>in a match</Badge>}
                  </td>
                  <td className="num">{p.rating}</td>
                  <td className="num">{p.games}</td>
                  <td className="num">{percent(p.wins, p.games)}</td>
                  <td>{timeAgo(p.updatedTimestamp)}</td>
                </tr>
              ))}
              {data.pool.length === 0 && (
                <tr>
                  <td colSpan={5}>No eligible apps.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {data.pool.length >= 2 && (
        <Section
          title="Pairings"
          note={
            cap > 0
              ? `Matches each pair has played since either app last changed. A pair stops being scheduled at ${cap} (✓).`
              : 'Matches each pair has played since either app last changed. No pair cap is set.'
          }
        >
          {data.pool.length > MATRIX_MAX ? (
            <p className="admin-note">
              Too many apps for a readable matrix ({data.pool.length}).
            </p>
          ) : (
            <PairMatrix data={data} />
          )}
        </Section>
      )}

      <Section
        title={`Broken apps (${data.broken.length})`}
        note="Crashed in a ranked match. Editing an app clears the flag."
      >
        {data.broken.length === 0 ? (
          <p className="admin-note">None.</p>
        ) : (
          <ul>
            {data.broken.map((b) => (
              <li key={b.appId}>{appName(b)}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Not in the pool (${data.ineligible.total})`}>
        <div className="admin-tiles" style={{ marginBottom: 12 }}>
          {(Object.keys(REASONS) as AdminIneligibleReason[])
            .filter((r) => data.ineligible.reasons[r])
            .map((r) => (
              <Tile
                key={r}
                label={REASONS[r]}
                value={data.ineligible.reasons[r]}
              />
            ))}
        </div>
        <p className="admin-note">
          Apps someone has written that still aren’t playing. Untouched starters
          and empty apps are counted above but not listed. An app can have more
          than one reason.
        </p>
        {data.ineligible.apps.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Why</th>
                  <th>Last edited</th>
                </tr>
              </thead>
              <tbody>
                {data.ineligible.apps.map((i) => (
                  <tr key={i.appId}>
                    <td>{appName(i)}</td>
                    <td>{i.reasons.map((r) => REASONS[r]).join('; ')}</td>
                    <td>{timeAgo(i.updatedTimestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Configuration">
        <div className="admin-table-wrap">
          <table className="admin-table" style={{ width: 'auto' }}>
            <tbody>
              {(
                [
                  ['Workers per instance', data.config.concurrency],
                  [
                    'Pause between matches',
                    seconds(data.config.matchIntervalMs),
                  ],
                  ['Idle backoff', seconds(data.config.idleMs)],
                  ['Yields above live isolates', data.config.maxLiveIsolates],
                  ['Match timeout', seconds(data.config.timeoutMs)],
                  ['Match speed', data.config.matchSpeed || 'unbounded'],
                  ['Pair cap', cap || 'off'],
                  [
                    'History retention',
                    data.config.retentionDays
                      ? `${data.config.retentionDays} d`
                      : 'forever',
                  ],
                ] as [string, string | number][]
              ).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td className="num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// Upper-triangle matrix of pair counts. One hue for magnitude (stronger fill =
// closer to the cap), with the number in every cell and a ✓ at the cap so the
// state never rests on colour alone.
function PairMatrix({ data }: { data: AdminLadder }) {
  const cap = data.config.pairMatchCap;
  const apps = data.pool;
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairs = new Map(data.pairs.map((p) => [key(p.appA, p.appB), p]));
  const maxMatches = Math.max(1, cap, ...data.pairs.map((p) => p.matches));

  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-matrix" style={{ width: 'auto' }}>
        <thead>
          <tr>
            <th></th>
            {apps.map((a, i) => (
              <th key={a.appId} className="num" title={a.name ?? ''}>
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {apps.map((row, r) => (
            <tr key={row.appId}>
              <th style={{ fontWeight: 400 }}>
                {r + 1}. {row.name ?? '(unnamed)'}
              </th>
              {apps.map((col, c) => {
                if (c <= r) return <td key={col.appId} className="cell" />;
                const p = pairs.get(key(row.appId, col.appId));
                const n = p?.matches ?? 0;
                const share = Math.min(1, n / maxMatches);
                return (
                  <td
                    key={col.appId}
                    className="cell"
                    title={`${row.name} vs ${col.name}: ${n}${cap > 0 ? ` of ${cap}` : ''}`}
                    style={{
                      background: n
                        ? `color-mix(in srgb, var(--chart-bar) ${Math.round(10 + share * 35)}%, transparent)`
                        : undefined,
                      fontWeight: p?.saturated ? 600 : 400,
                    }}
                  >
                    {n}
                    {p?.saturated ? ' ✓' : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
