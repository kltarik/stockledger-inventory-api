import { readFile, readdir } from 'node:fs/promises';
import { pool, tx } from './pool.ts';

const dir = new URL('../../migrations/', import.meta.url);

// Applies every migrations/*.sql file that hasn't run yet, in name order, each in its own transaction.
export async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, dir), 'utf8');
    await tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`applied ${file}`);
  }
}

if (import.meta.main) {
  await migrate();
  await pool.end();
}
