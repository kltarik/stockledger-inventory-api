import { createHash } from 'node:crypto';
import { pool, tx } from './pool.ts';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

// Fictional demo data. Only runs on an empty database, so it is safe to call on every start.
export async function seed() {
  const key = process.env.DEMO_API_KEY;
  if (!key) throw new Error('Set DEMO_API_KEY (see .env.example) before seeding.');

  await tx(async (c) => {
    if ((await c.query('SELECT 1 FROM products LIMIT 1')).rowCount) return;

    await c.query('INSERT INTO api_clients (name, key_hash) VALUES ($1, $2)', ['demo', hashKey(key)]);
    await c.query(`INSERT INTO warehouses (name, code) VALUES ('Warehouse A', 'WH-A'), ('Warehouse B', 'WH-B')`);
    await c.query(`
      INSERT INTO products (sku, name, unit_price_minor, active) VALUES
        ('KB-001',  'Mechanical keyboard',      8900, true),
        ('MS-001',  'Wireless mouse',           2900, true),
        ('MN-024',  '24-inch monitor',         17900, true),
        ('CB-USBC', 'USB-C cable 1 m',           900, true),
        ('LP-DESK', 'LED desk lamp',            3400, true),
        ('HD-USB',  'USB headset',              4900, true),
        ('AD-VGA',  'VGA adapter (discontinued)', 1200, false)`);

    // Opening stock goes through the ledger too, so balances always equal the sum of movements.
    // The keyboard (KB-001) starts at zero on purpose: the demo story receives it.
    const opening: [string, string, number][] = [
      ['MS-001', 'WH-A', 40], ['MN-024', 'WH-A', 8], ['CB-USBC', 'WH-A', 120],
      ['LP-DESK', 'WH-B', 25], ['HD-USB', 'WH-B', 12], ['MS-001', 'WH-B', 10],
    ];
    for (const [sku, code, qty] of opening) {
      const params = [sku, code, qty];
      const ids = `(SELECT id FROM products WHERE sku = $1), (SELECT id FROM warehouses WHERE code = $2)`;
      await c.query(`INSERT INTO inventory_balances (product_id, warehouse_id, quantity) VALUES (${ids}, $3)`, params);
      await c.query(`INSERT INTO stock_movements (product_id, warehouse_id, delta, type, reference_id)
                     VALUES (${ids}, $3, 'receipt', 'SEED')`, params);
    }
  });
}

if (import.meta.main) {
  await seed();
  await pool.end();
}
