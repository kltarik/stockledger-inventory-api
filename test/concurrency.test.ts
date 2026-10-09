import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { KEYBOARD, MOUSE, WH_A, pool, startApp } from './helpers.ts';

let api: Awaited<ReturnType<typeof startApp>>;
before(async () => { api = await startApp(); });
after(() => api.close());

// The pool has 10 connections, so these requests really run as parallel transactions in PostgreSQL.

test('20 simultaneous orders for 2 keyboards with 15 in stock: exactly 7 succeed, stock never negative', async () => {
  await api.post('/stock/receipts', { productId: KEYBOARD, warehouseId: WH_A, quantity: 15, reference: 'PO-1' });

  const results = await Promise.all(Array.from({ length: 20 }, () =>
    api.post('/orders', { warehouseId: WH_A, items: [{ productId: KEYBOARD, quantity: 2 }] })));

  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, 7);
  assert.equal(statuses.filter((s) => s === 409).length, 13);
  assert.equal((await api.get(`/inventory?warehouseId=${WH_A}&sku=KB-001`)).body.items[0].quantity, 1);
});

test('orders locking the same products in opposite order do not deadlock', async () => {
  await api.post('/stock/receipts', { productId: KEYBOARD, warehouseId: WH_A, quantity: 100, reference: 'PO-2' });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => api.post('/orders', {
    warehouseId: WH_A,
    items: i % 2 ? [{ productId: KEYBOARD, quantity: 1 }, { productId: MOUSE, quantity: 1 }]
                 : [{ productId: MOUSE, quantity: 1 }, { productId: KEYBOARD, quantity: 1 }],
  })));
  assert.deepEqual([...new Set(results.map((r) => r.status))], [201]);
});

test('the same externalReference sent 10 times at once creates one order', async () => {
  const body = { warehouseId: WH_A, externalReference: 'RACE-1', items: [{ productId: MOUSE, quantity: 1 }] };
  const results = await Promise.all(Array.from({ length: 10 }, () => api.post('/orders', body)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
});

test('the ledger adds up: every balance equals the sum of its movements', async () => {
  const { rows } = await pool.query(`
    SELECT b.product_id, b.warehouse_id, b.quantity, coalesce(sum(m.delta), 0) AS ledger
    FROM inventory_balances b
    LEFT JOIN stock_movements m ON m.product_id = b.product_id AND m.warehouse_id = b.warehouse_id
    GROUP BY b.product_id, b.warehouse_id, b.quantity`);
  for (const r of rows) assert.equal(r.quantity, r.ledger, `product ${r.product_id} in warehouse ${r.warehouse_id}`);
});
