import { Pool } from 'pg';
import { isLocalDev } from './devMode';

// In local-dev mode the database is an in-memory Postgres (pg-mem) so no real
// server or connection details are needed. pg-mem is a devDependency, required
// lazily here so it is never loaded (or needed) in production. Otherwise connect
// to the configured RDS/Postgres instance.
function createPool(): Pool {
  if (isLocalDev) {
    console.log('⚙  LOCAL DEV: using in-memory database (pg-mem)');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
  });
}

const pool = createPool();

export default pool;
