import { Pool } from 'pg';
import { isLocalDev } from './devMode';
import { logger, LogEvent } from './logger';

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
    // RDS requires encrypted connections (its pg_hba.conf only accepts
    // `hostssl` / `rds.force_ssl=1`), so a cleartext connection is rejected with
    // "no pg_hba.conf entry ... no encryption". Enable TLS. We don't verify the
    // CA because Amazon's RDS root CA isn't in Node's default trust store; to
    // harden, download the RDS CA bundle and pass `{ ca, rejectUnauthorized: true }`.
    // Opt out with RDS_SSL=false for a non-SSL Postgres.
    ssl:
      process.env.RDS_SSL === 'false'
        ? undefined
        : { rejectUnauthorized: false },
  });
}

const pool = createPool();

// Surface connection/idle-client failures (lost RDS connection, auth errors)
// instead of letting them crash the process or vanish.
pool.on('error', (err) => {
  logger.error({ event: LogEvent.DB_ERROR, err }, 'database pool error');
});

export default pool;
