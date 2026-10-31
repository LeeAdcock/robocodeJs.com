import os from 'node:os';
import { logger } from './logger';

// Who this server process is, for the per-user home leases (GitHub #444). Each
// instance writes its id and address into the user_home rows it holds, so
// another instance can tell whose a user is and, once forwarding lands, where
// to send their requests: `http://<private-ip>:8080`, the node port directly
// rather than nginx.
//
// In production the id and private IPv4 come from EC2 instance metadata
// (IMDSv2), so they're stable for the instance's life and meaningful in the
// console. Everywhere else, and if IMDS can't be reached, the id is synthetic
// (hostname + pid, so two local processes never collide) and the address is
// loopback.
export interface InstanceIdentity {
  id: string;
  address: string;
}

export const PORT = 8080;

const IMDS = 'http://169.254.169.254/latest';
const IMDS_TIMEOUT_MS = 1000;

export const localIdentity = (): InstanceIdentity => ({
  id: `local-${os.hostname()}-${process.pid}`,
  address: `http://127.0.0.1:${PORT}`,
});

const readImds = async (
  fetchFn: typeof fetch
): Promise<InstanceIdentity | null> => {
  const tokenRes = await fetchFn(`${IMDS}/api/token`, {
    method: 'PUT',
    headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
    signal: AbortSignal.timeout(IMDS_TIMEOUT_MS),
  });
  if (!tokenRes.ok) return null;
  const token = await tokenRes.text();
  const get = async (key: string) => {
    const res = await fetchFn(`${IMDS}/meta-data/${key}`, {
      headers: { 'X-aws-ec2-metadata-token': token },
      signal: AbortSignal.timeout(IMDS_TIMEOUT_MS),
    });
    return res.ok ? (await res.text()).trim() : '';
  };
  const [id, ip] = await Promise.all([get('instance-id'), get('local-ipv4')]);
  return id && ip ? { id, address: `http://${ip}:${PORT}` } : null;
};

export const resolveIdentity = async (
  production = process.env.NODE_ENV === 'production',
  fetchFn: typeof fetch = fetch
): Promise<InstanceIdentity> => {
  if (!production) return localIdentity();
  try {
    const identity = await readImds(fetchFn);
    if (identity) return identity;
  } catch (err) {
    logger.warn({ err }, 'instance metadata lookup failed');
  }
  const fallback = localIdentity();
  logger.warn(
    { instanceId: fallback.id },
    'no instance metadata; using a synthetic instance identity'
  );
  return fallback;
};

// Resolved once per process. Callers await it; the first await starts it.
let identity: Promise<InstanceIdentity> | undefined;
export const instanceIdentity = (): Promise<InstanceIdentity> =>
  (identity ??= resolveIdentity());
