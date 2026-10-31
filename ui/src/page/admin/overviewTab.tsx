import type { AdminOverview } from '../../types/admin';
import { formatUptime, percent, useAdminData } from '../../util/admin';
import { Section, Status, Tile } from './adminParts';

// Headline numbers. Database counts are platform-wide; the "This instance"
// block is only the server that answered, so it's labelled with its hostname.
const REFRESH_MS = 30000;

export default function OverviewTab() {
  const { data, error, loading } = useAdminData<AdminOverview>(
    '/api/admin/overview',
    undefined,
    REFRESH_MS
  );

  return (
    <div>
      <Status loading={loading} error={error} hasData={data !== null} />
      {data && (
        <>
          <Section title="People">
            <div className="admin-tiles">
              <Tile label="Users" value={data.counts.users.total} />
              <Tile
                label="Signups, 24 h"
                value={data.counts.users.signups.day}
                sub={`${data.counts.users.signups.week} in 7 d · ${data.counts.users.signups.month} in 30 d`}
              />
              <Tile
                label="Active, 24 h"
                value={data.counts.users.active.day}
                sub={`${data.counts.users.active.week} in 7 d · ${data.counts.users.active.month} in 30 d`}
              />
              <Tile
                label="MCP users"
                value={data.counts.mcp.users}
                sub="with a live MCP sign-in"
              />
            </div>
          </Section>

          <Section title="Content">
            <div className="admin-tiles">
              <Tile
                label="Apps"
                value={data.counts.apps.total}
                sub={`${data.counts.apps.updatedWeek} created or edited in 7 d`}
              />
              <Tile label="Arenas" value={data.counts.arenas.total} />
            </div>
          </Section>

          <Section title="Ladder">
            <div className="admin-tiles">
              <Tile
                label="Ranked matches, 24 h"
                value={data.ladder.matchesDay}
                sub={`${percent(data.ladder.unratedDay, data.ladder.matchesDay)} unrated`}
              />
              <Tile
                label="Loop on this instance"
                value={data.ladder.loopRunning ? 'Running' : 'Stopped'}
                sub={data.ladder.enabled ? 'LADDER_ENABLED' : 'not enabled'}
              />
            </div>
          </Section>

          <Section
            title="This instance"
            note={
              <>
                Live gauges from <code>{data.instance.hostname}</code> only.
                With more than one instance, each holds its own arenas.
              </>
            }
          >
            <div className="admin-tiles">
              <Tile
                label="Version"
                value={data.instance.version}
                sub={`up ${formatUptime(data.instance.uptimeSec)} · Node ${data.instance.node}`}
              />
              <Tile
                label="Arenas in memory"
                value={data.metrics.arenas}
                sub={`${data.metrics.runningArenas} running · ${data.metrics.idlePausedArenas} idle-paused`}
              />
              <Tile label="Isolates" value={data.metrics.isolates} />
              <Tile
                label="Slowest arena tick"
                value={`${data.metrics.maxAvgTickMs} ms`}
                sub="average per tick"
              />
              <Tile
                label="Memory"
                value={`${data.metrics.rssMB} MB`}
                sub={`resident · ${data.metrics.heapUsedMB} MB heap`}
              />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
