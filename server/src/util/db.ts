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
  return new Pool({
    user: process.env.RDS_USERNAME,
    host: process.env.RDS_HOSTNAME,
    database: process.env.RDS_DB_NAME,
    password: process.env.RDS_PASSWORD,
    port: parseInt(process.env.RDS_PORT || '5432'),
    ssl: sslConfig(),
  });
}

const pool = createPool();

// Surface connection/idle-client failures (lost RDS connection, auth errors)
// instead of letting them crash the process or vanish.
pool.on('error', (err) => {
  logger.error({ event: LogEvent.DB_ERROR, err }, 'database pool error');
});

export default pool;
