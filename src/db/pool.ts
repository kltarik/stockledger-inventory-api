import pg from 'pg';
import type { PageParams } from '../schemas/index.ts';

// count(*) and sums are bigint, which pg returns as strings by default. Read them as numbers.
// ponytail: exact below 2^53, far above any count or EUR-cent total this demo can produce.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

// One shared connection pool. It connects lazily, on the first query.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// An idle connection that dies (database restarted) emits 'error'. Without a listener, Node crashes the API.
// The pool drops that connection and opens a new one on the next query.
pool.on('error', (err) => console.error('idle database connection lost:', err.message));

// Runs fn inside one transaction on one connection: everything commits together or nothing does.
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

// Runs a SELECT as one page: { items, page, pageSize, total }.
// orderBy always comes from our code, never from the request, and must end in a unique column
// (usually id) so the order is stable and pages never overlap or skip rows.
export async function paged(sql: string, params: unknown[], orderBy: string, p: PageParams) {
  const total = (await pool.query(`SELECT count(*) AS n FROM (${sql}) q`, params)).rows[0].n;
  const n = params.length;
  const items = (await pool.query(
    `${sql} ORDER BY ${orderBy} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, p.pageSize, (p.page - 1) * p.pageSize],
  )).rows;
  return { items, page: p.page, pageSize: p.pageSize, total };
}
