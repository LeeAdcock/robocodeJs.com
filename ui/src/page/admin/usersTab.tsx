import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Form } from 'react-bootstrap';
import type {
  AdminUserDetail,
  AdminUserFilter,
  AdminUserList,
  AdminUserSort,
} from '../../types/admin';
import { formatDate, timeAgo, useAdminData } from '../../util/admin';
import { Badge, DailyBars, Section, Status } from './adminParts';

// Users: a searchable, filterable list, and a per-user detail view. All state
// lives in the URL (?user=, ?q=, ?filter=, ?sort=, ?page=) so a view can be
// linked to and the back button works. Detail is metadata only; the server
// never sends app source.

const PAGE_SIZE = 50;

const FILTERS: { value: AdminUserFilter; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Every account' },
  {
    value: 'never-edited',
    label: 'Never edited',
    title: 'Has written nothing beyond the starter apps',
  },
  {
    value: 'near-cap',
    label: 'Near a cap',
    title: 'At 80% or more of the per-user app or arena limit',
  },
  { value: 'dormant', label: 'Dormant', title: 'No activity in 3 months' },
  { value: 'mcp', label: 'MCP', title: 'Has a live MCP sign-in' },
];

const SORTS: { value: AdminUserSort; label: string }[] = [
  { value: 'lastActive', label: 'Last active' },
  { value: 'created', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'apps', label: 'Most apps' },
];

export default function UsersTab() {
  const [params, setParams] = useSearchParams();
  const userId = params.get('user');
  return userId ? (
    <UserDetail
      userId={userId}
      onBack={() => {
        const next = new URLSearchParams(params);
        next.delete('user');
        setParams(next);
      }}
    />
  ) : (
    <UserList />
  );
}

function UserList() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filter = (params.get('filter') as AdminUserFilter) || 'all';
  const sort = (params.get('sort') as AdminUserSort) || 'lastActive';
  const page = Math.max(0, parseInt(params.get('page') ?? '0', 10) || 0);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Typing updates the box immediately and the URL (and so the query) after a
  // short pause.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => update({ q: draft.trim(), page: null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const signups = useAdminData<{ days: { date: string; count: number }[] }>(
    '/api/admin/signups',
    { days: 90 }
  );
  const { data, error, loading } = useAdminData<AdminUserList>(
    '/api/admin/users',
    {
      search: q,
      filter,
      sort,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }
  );

  const openUser = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('user', id);
    setParams(next);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <Section title="Signups">
        {signups.data ? (
          <DailyBars title="Signups per day" days={signups.data.days} />
        ) : (
          <Status
            loading={signups.loading}
            error={signups.error}
            hasData={false}
          />
        )}
      </Section>

      <Section title="Accounts">
        <div className="admin-controls">
          <Form.Control
            type="search"
            size="sm"
            placeholder="Search name or email"
            aria-label="Search users"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: 240 }}
          />
          <div
            role="group"
            aria-label="Filter users"
            className="admin-controls"
            style={{ margin: 0 }}
          >
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? 'secondary' : 'outline-secondary'}
                aria-pressed={filter === f.value}
                title={f.title}
                onClick={() =>
                  update({
                    filter: f.value === 'all' ? null : f.value,
                    page: null,
                  })
                }
              >
                {f.label}
              </Button>
            ))}
          </div>
          <Form.Select
            size="sm"
            aria-label="Sort users"
            value={sort}
            onChange={(e) =>
              update({
                sort: e.target.value === 'lastActive' ? null : e.target.value,
                page: null,
              })
            }
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </Form.Select>
        </div>

        <Status loading={loading} error={error} hasData={data !== null} />
        {data && (
          <>
            <p className="admin-note">
              {data.total} {data.total === 1 ? 'account' : 'accounts'}
              {loading ? ' · refreshing…' : ''}
            </p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Signed up</th>
                    <th>Last active</th>
                    <th
                      className="num"
                      title={`Edited / total (limit ${data.limits.appsPerUser})`}
                    >
                      Apps
                    </th>
                    <th
                      className="num"
                      title={`Limit ${data.limits.arenasPerUser}`}
                    >
                      Arenas
                    </th>
                    <th className="num" title="Live MCP sign-ins">
                      MCP
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr
                      key={u.id}
                      className="admin-row-link"
                      tabIndex={0}
                      onClick={() => openUser(u.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') openUser(u.id);
                      }}
                    >
                      <td>
                        {u.picture && (
                          <img
                            className="admin-avatar"
                            src={u.picture}
                            alt=""
                          />
                        )}
                        <strong>{u.name ?? '(no name)'}</strong>
                        <div className="admin-note">{u.email}</div>
                      </td>
                      <td title={u.createdTimestamp ?? ''}>
                        {formatDate(u.createdTimestamp)}
                      </td>
                      <td title={u.lastActiveAt ?? ''}>
                        {timeAgo(u.lastActiveAt)}
                      </td>
                      <td className="num">
                        {u.editedApps} / {u.apps}
                      </td>
                      <td className="num">{u.arenas}</td>
                      <td className="num">{u.mcpClients || ''}</td>
                    </tr>
                  ))}
                  {data.users.length === 0 && (
                    <tr>
                      <td colSpan={6}>No accounts match.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="admin-controls" style={{ marginTop: 12 }}>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={page === 0}
                  onClick={() =>
                    update({ page: page - 1 > 0 ? String(page - 1) : null })
                  }
                >
                  ← Previous
                </Button>
                <span className="admin-note">
                  Page {page + 1} of {pages}
                </span>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={page + 1 >= pages}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  Next →
                </Button>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

function UserDetail(props: { userId: string; onBack: () => void }) {
  const { data, error, loading } = useAdminData<AdminUserDetail>(
    `/api/admin/users/${encodeURIComponent(props.userId)}`
  );

  return (
    <div>
      <Button size="sm" variant="outline-secondary" onClick={props.onBack}>
        ← All users
      </Button>
      <Status loading={loading} error={error} hasData={data !== null} />
      {data && <UserDetailBody detail={data} />}
    </div>
  );
}

function UserDetailBody({ detail }: { detail: AdminUserDetail }) {
  const a = detail.account;
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '16px 0',
        }}
      >
        {a.picture && (
          <img
            src={a.picture}
            alt=""
            style={{ width: 48, height: 48, borderRadius: '50%' }}
          />
        )}
        <div>
          <div style={{ fontSize: '1.3em', fontWeight: 600 }}>
            {a.name ?? '(no name)'}
          </div>
          <div className="admin-note">
            {a.email} · signed up {formatDate(a.createdTimestamp)} · last active{' '}
            {timeAgo(a.lastActiveAt)}
            {detail.identities.length > 0 &&
              ` · via ${detail.identities.map((i) => i.source).join(', ')}`}
          </div>
          <div className="admin-note">
            <code>{a.id}</code>
          </div>
        </div>
      </div>

      <Section
        title={`Apps (${detail.apps.length})`}
        note="Metadata only; source is never shown here."
      >
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Rating</th>
                <th className="num">Games</th>
                <th className="num">Wins</th>
                <th>Last edited</th>
              </tr>
            </thead>
            <tbody>
              {detail.apps.map((app) => (
                <tr key={app.id}>
                  <td>
                    {app.name ?? '(unnamed)'}
                    {app.starter && <Badge>starter</Badge>}
                    {app.empty && <Badge>empty</Badge>}
                    {app.broken && <Badge warn>broken</Badge>}
                  </td>
                  <td className="num">
                    {app.ratingGames > 0 ? app.rating : '—'}
                  </td>
                  <td className="num">{app.ratingGames}</td>
                  <td className="num">{app.ratingWins}</td>
                  <td title={app.updatedTimestamp ?? ''}>
                    {timeAgo(app.updatedTimestamp)}
                  </td>
                </tr>
              ))}
              {detail.apps.length === 0 && (
                <tr>
                  <td colSpan={5}>No apps.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`Arenas (${detail.arenas.length})`}>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Arena</th>
                <th className="num">Roster</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {detail.arenas.map((arena, i) => (
                <tr key={arena.id}>
                  <td>
                    <code>{arena.id.slice(0, 8)}</code>
                    {i === 0 && <Badge>default</Badge>}
                  </td>
                  <td
                    className="num"
                    title="Enabled / total apps in the roster"
                  >
                    {arena.enabledMembers} / {arena.members}
                  </td>
                  <td>{formatDate(arena.createdTimestamp)}</td>
                  <td>
                    <Link to={`/watch/${arena.id}`}>Watch</Link>
                  </td>
                </tr>
              ))}
              {detail.arenas.length === 0 && (
                <tr>
                  <td colSpan={4}>No arenas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="MCP sign-ins">
        {detail.tokens.length === 0 ? (
          <p className="admin-note">None live.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Token</th>
                  <th>Issued</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {detail.tokens.map((t, i) => (
                  <tr key={i}>
                    <td>{t.clientName ?? '(unnamed client)'}</td>
                    <td>{t.kind}</td>
                    <td>{timeAgo(t.createdTimestamp)}</td>
                    <td>{formatDate(t.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Badges (${detail.achievements.length})`}>
        {detail.achievements.length === 0 ? (
          <p className="admin-note">None yet.</p>
        ) : (
          <p>
            {detail.achievements.map((ach) => (
              <Badge key={ach.id}>{ach.id}</Badge>
            ))}
          </p>
        )}
      </Section>

      {Object.keys(detail.counters).length > 0 && (
        <Section title="Lifetime counters">
          <div className="admin-tiles">
            {Object.entries(detail.counters)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, v]) => (
                <div className="admin-tile" key={k}>
                  <div className="admin-tile-value">{v.toLocaleString()}</div>
                  <div className="admin-tile-label">{k}</div>
                </div>
              ))}
          </div>
        </Section>
      )}
    </>
  );
}
