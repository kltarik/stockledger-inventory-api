import pg from 'pg';

// Tests always use their own database. Set these BEFORE the app code is loaded (it reads them on import).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://stockledger:stockledger@localhost:5433/stockledger_test';
process.env.DEMO_API_KEY = 'test-key';

const { buildApp } = await import('../src/app.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seed } = await import('../src/db/seed.ts');
export const { pool } = await import('../src/db/pool.ts');

// Drops and re-creates the test database, then migrates and seeds it. Every test file starts from the same data.
async function resetDb() {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);
  // Guard: a destructive reset must never hit a dev or shared database by accident.
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset "${name}": the test database name must end in _test.`);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  await migrate();
  await seed();
}

export async function startApp() {
  await resetDb();
  const app = await buildApp({ logger: false });

  // Small wrappers around Fastify's inject(): a real HTTP request through routing, validation,
  // auth and the database, without opening a network port.
  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, body?: object, key: string | null = 'test-key') => {
    const res = await app.inject({ method, url, payload: body, headers: key ? { 'x-api-key': key } : {} });
    return { status: res.statusCode, body: res.json() };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: object, key?: string | null) => call('POST', url, body, key),
    patch: (url: string, body: object) => call('PATCH', url, body),
    close: async () => { await app.close(); await pool.end(); },
  };
}

// Seeded ids on a fresh database (identity columns start at 1, in insert order).
export const WH_A = 1, KEYBOARD = 1, MOUSE = 2, VGA_ADAPTER = 7;
