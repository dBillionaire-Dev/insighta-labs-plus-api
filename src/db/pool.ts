import { Pool } from 'pg';

/**
 * Single shared connection pool for the entire process.
 *
 * Why a pool and not a new Client() per request?
 * - Opening a TCP connection to a remote PostgreSQL instance (Railway) costs
 *   ~20-80ms per request at baseline. Under hundreds of concurrent requests
 *   this becomes the dominant latency source.
 * - A pool keeps N persistent connections alive and hands them out to
 *   concurrent requests, reducing that cost to near-zero.
 * - max: 20 is a safe default for a single Railway Postgres instance whose
 *   max_connections is typically 100. Leaves headroom for admin connections
 *   and the ingestion worker.
 *
 * Replace every `new Pool()` or `new Client()` in the codebase with this
 * import. Do NOT create additional Pool instances.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,                // max concurrent connections
  idleTimeoutMillis: 30_000,   // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail fast if pool is exhausted
});

pool.on('error', (err) => {
  console.error('[pool] unexpected error on idle client', err);
});

export default pool;
