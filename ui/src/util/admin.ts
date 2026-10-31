import axios from 'axios';
import { useEffect, useState } from 'react';

// Client helpers for the admin control panel (GitHub #469).
//
// The server never says "forbidden" to a non-admin: /api/admin/* falls through
// to the SPA fallback exactly like an unknown path, so a non-admin gets the HTML
// shell back with a 200. A response therefore only counts if it's the JSON the
// admin API sends, never just because the request succeeded.

const isJsonObject = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null && !Array.isArray(data);

// True only when the server confirms the viewer is an admin. Any failure,
// including the HTML shell a non-admin receives, reads as "not an admin".
export const fetchIsAdmin = async (): Promise<boolean> => {
  try {
    const res = await axios.get('/api/admin/me');
    return isJsonObject(res?.data) && res.data.admin === true;
  } catch {
    return false;
  }
};

// Probe once per signed-in user; false while signed out or still checking.
export const useIsAdmin = (userId: string | undefined | null): boolean => {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!userId) {
      setAdmin(false);
      return;
    }
    let cancelled = false;
    void fetchIsAdmin().then((ok) => {
      if (!cancelled) setAdmin(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return admin;
};

// GET an admin endpoint, rejecting anything that isn't a JSON object (see above).
export const adminGet = async <T>(
  path: string,
  params?: Record<string, string | number>
): Promise<T> => {
  const res = await axios.get(path, { params });
  if (!isJsonObject(res?.data)) throw new Error('Not an admin response');
  return res.data as T;
};

// Loads an admin endpoint, optionally re-polling, and refetches when `key`
// (e.g. a serialized query) changes. Keeps the last good data while refreshing.
export const useAdminData = <T>(
  path: string | null,
  params?: Record<string, string | number>,
  refreshMs?: number
): { data: T | null; error: string | null; loading: boolean } => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify([path, params]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const d = await adminGet<T>(path, params);
        if (cancelled) return;
        setData(d);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        setError(status === 404 ? 'Not found.' : 'Could not load this data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = refreshMs ? setInterval(() => void load(), refreshMs) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
    // `key` stands in for path + params, which are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshMs]);

  return { data, error, loading };
};

// "3 min ago", "5 d ago". `now` is injectable for tests.
export const timeAgo = (iso: string | null, now = Date.now()): string => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} d ago`;
  const mo = Math.round(d / 30);
  if (mo < 24) return `${mo} mo ago`;
  return `${Math.round(d / 365)} y ago`;
};

export const formatDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

export const formatUptime = (sec: number): string => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
};

export const percent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
