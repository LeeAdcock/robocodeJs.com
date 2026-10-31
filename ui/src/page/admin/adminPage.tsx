import { useEffect, useState } from 'react';
import { Nav } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { brandTitle, useDocumentTitle } from '../../util/useDocumentTitle';
import { fetchIsAdmin } from '../../util/admin';
import NotFoundPage from '../notFoundPage';
import OverviewTab from './overviewTab';
import UsersTab from './usersTab';
import LadderTab from './ladderTab';

// The admin control panel (GitHub #469). Reached only by typing /admin: nothing
// in the app links here. Lazy-loaded, so none of this ships in the bundle
// ordinary visitors download, and left out of the server's SEO pages and
// sitemap.
//
// To anyone who isn't an admin it's the ordinary "Page not found" page: the
// server answers a non-admin's /api/admin/me exactly like an unknown path, and
// this page never says "forbidden". It shows nothing at all while checking, so
// a non-admin never sees a flash of the panel.

type Tab = 'overview' | 'users' | 'ladder';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'ladder', label: 'Ladder' },
];

export default function AdminPage() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    void fetchIsAdmin().then((ok) => {
      if (!cancelled) setAdmin(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (admin === null) return null;
  if (!admin) return <NotFoundPage />;
  return <AdminPanel params={params} setParams={setParams} />;
}

function AdminPanel(props: {
  params: URLSearchParams;
  setParams: ReturnType<typeof useSearchParams>[1];
}) {
  useDocumentTitle(brandTitle('Admin'));
  const requested = props.params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.key === requested)
    ? (requested as Tab)
    : 'overview';

  // Switching tabs drops the other tabs' query state (search, selected user).
  const select = (key: string | null) => {
    if (!key || key === tab) return;
    props.setParams(key === 'overview' ? {} : { tab: key });
  };

  return (
    <div>
      <div className="markdown">
        <h1>Admin</h1>
      </div>
      <div className="admin-page">
        <Nav variant="tabs" activeKey={tab} onSelect={select}>
          {TABS.map((t) => (
            <Nav.Item key={t.key}>
              <Nav.Link eventKey={t.key}>{t.label}</Nav.Link>
            </Nav.Item>
          ))}
        </Nav>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'ladder' && <LadderTab />}
      </div>
    </div>
  );
}
