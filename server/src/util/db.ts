import { Pool, PoolConfig } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { isLocalDev } from './devMode';
import { logger, LogEvent } from './logger';

// AWS's public RDS root CA bundle (all regions), vendored at
// server/certs/rds-global-bundle.pem so TLS to RDS can be verified against a
// pinned trust anchor rather than blindly accepted. Read from the compiled
// layout (dist/src/util -> deploy root) or the package cwd, whichever resolves.
function loadRdsCa(): string {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'certs', 'rds-global-bundle.pem'),
    path.join(process.cwd(), 'certs', 'rds-global-bundle.pem'),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'RDS CA bundle (certs/rds-global-bundle.pem) not found; set ' +
      'RDS_SSL_NO_VERIFY=true to connect without CA verification'
  );
}

// TLS configuration for the RDS connection. RDS requires encrypted connections
// (its pg_hba.conf only accepts `hostssl` / `rds.force_ssl=1`), so cleartext is
// rejected. By default we now VERIFY the server certificate against the pinned
// RDS CA bundle (closes the MITM gap of accepting any cert). Escape hatches:
//   RDS_SSL=false          -> no TLS at all (a plain, non-RDS Postgres)
//   RDS_SSL_NO_VERIFY=true -> TLS but skip verification (previous behavior;
//                             e.g. a non-RDS cert not chaining to the AWS bundle)
export function sslConfig(): PoolConfig['ssl'] {
  if (process.env.RDS_SSL === 'false') return undefined;
  if (process.env.RDS_SSL_NO_VERIFY === 'true') {
    logger.warn(
      'RDS TLS certificate verification is DISABLED (RDS_SSL_NO_VERIFY=true) — ' +
        'the DB connection is encrypted but not authenticated'
    );
    return { rejectUnauthorized: false };
  }
  return { ca: loadRdsCa(), rejectUnauthorized: true };
}

// Pool sizing and timeouts (GitHub #411). These used to be left at pg's
// defaults (max 10, 10s idle, NO connect timeout), and RDS DatabaseConnections
// sat pinned at exactly 10-11 around the clock: the pool, not the database, was
// the ceiling, and with no connect timeout a request that found all clients
// checked out queued forever instead of failing. Every number here is a
// deliberate choice, overridable by env so it can be tuned without a deploy of
// new code.
//
// max (PG_POOL_MAX, default 20): the db.t3.micro computes max_connections as
//   LEAST(DBInstanceClassMemory/9531392, 5000) ~= 112, less a few reserved for
//   the rds superuser. Size per INSTANCE so the worst case still fits with
//   room for psql and maintenance: an Immutable deploy briefly runs the old
//   and new instance side by side (2 x 20 = 40), and the ASG ceiling is 4
//   (4 x 20 = 80, see GitHub #409). Doubling from 10 gives interactive traffic
//   headroom over the ladder without making the DB the bottleneck instead.
// connectionTimeoutMillis (PG_POOL_CONNECT_TIMEOUT_MS, default 5000): how long
//   a query waits for a free client, or for a new connection to open, before
//   failing. Fail fast enough to beat the ALB's 60s idle timeout and a user's
//   patience, but long enough to ride out a brief burst. Each timeout is logged
//   as event=db.error (see logPoolTimeouts), which feeds robocodejs-db-error.
// idleTimeoutMillis (PG_POOL_IDLE_TIMEOUT_MS, default 30000): close a client
//   idle this long. Longer than pg's 10s so the steady ladder cadence reuses
//   warm connections instead of reconnecting (a TLS handshake each time), short
//   enough that a burst's extra clients drain within a minute.
const POOL_DEFAULTS = {
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
};

// A positive integer from the environment, or the fallback (with a warning)
// when the value is missing or unusable — a typo must not silently size the
// pool to 0 or NaN.
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0) return value;
  logger.warn(
    { name, value: raw, fallback },
    'ignoring invalid pool setting; using the default'
  );
  return fallback;
}

export function poolSizing(): Pick<
  PoolConfig,
  'max' | 'connectionTimeoutMillis' | 'idleTimeoutMillis'
> {
  return {
    max: envPositiveInt('PG_POOL_MAX', POOL_DEFAULTS.max),
    connectionTimeoutMillis: envPositiveInt(
      'PG_POOL_CONNECT_TIMEOUT_MS',
      POOL_DEFAULTS.connectionTimeoutMillis
    ),
    idleTimeoutMillis: envPositiveInt(
      'PG_POOL_IDLE_TIMEOUT_MS',
      POOL_DEFAULTS.idleTimeoutMillis
    ),
  };
}

// The two errors pg-pool raises when connectionTimeoutMillis expires: waiting
// for a free client in an exhausted pool, and opening a new connection.
const POOL_TIMEOUT =
  /timeout exceeded when trying to connect|Connection terminated due to connection timeout/;

// A connect timeout rejects the caller's query promise, and callers handle that
// in their own ways (a 500, a retried ladder match...). It never reaches the
// pool 'error' event, so without this hook pool exhaustion would leave no
// consistent trace. Log every one as event=db.error, then let the rejection
// propagate untouched: the side branch below observes the promise, it does not
// replace it.
export function logPoolTimeouts(target: Pool): void {
  const query = target.query.bind(target) as (...args: unknown[]) => unknown;
  target.query = ((...args: unknown[]) => {
    const result = query(...args);
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        if (err instanceof Error && POOL_TIMEOUT.test(err.message)) {
          logger.error(
            {
              event: LogEvent.DB_ERROR,
              err,
              totalCount: target.totalCount,
              idleCount: target.idleCount,
              waitingCount: target.waitingCount,
            },
            'database pool connect timeout'
          );
        }
      });
    }
    return result;
  }) as typeof target.query;
}

// In local-dev mode the database is an in-memory Postgres (pg-mem) so no real
// server or connection details are needed. pg-mem is a devDependency, required
// lazily here so it is never loaded (or needed) in production. Otherwise connect
// to the configured RDS/Postgres instance.
function createPool(): Pool {
  if (isLocalDev) {
    logger.info('LOCAL DEV: using in-memory database (pg-mem)');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { newDb } = require('pg-mem');
    const { Pool: MemPool } = newDb().adapters.createPg();
    return new MemPool() as Pool;
  }
  const sizing = poolSizing();
  logger.info(sizing, 'database pool configured');
  const realPool = new Pool({
    user: process.env.RDS_USERNAME,
    host: process.env.RDS_HOSTNAME,
    database: process.env.RDS_DB_NAME,
    password: process.env.RDS_PASSWORD,
    port: parseInt(process.env.RDS_PORT || '5432'),
    ssl: sslConfig(),
    ...sizing,
  });
  logPoolTimeouts(realPool);
  return realPool;
}

const pool = createPool();

// Surface connection/idle-client failures (lost RDS connection, auth errors)
// instead of letting them crash the process or vanish.
pool.on('error', (err) => {
  logger.error({ event: LogEvent.DB_ERROR, err }, 'database pool error');
});

export default pool;
