import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { KEYBOARD, MOUSE, VGA_ADAPTER, WH_A, startApp } from './helpers.ts';

let api: Awaited<ReturnType<typeof startApp>>;
before(async () => { api = await startApp(); });
after(() => api.close());

const keyboardStock = async () =>
  (await api.get(`/inventory?warehouseId=${WH_A}&sku=KB-001`)).body.items[0]?.quantity ?? 0;
const orderCount = async () => (await api.get('/orders')).body.total;

// The demo story. The steps share state, so they run in order (node:test runs top-level tests sequentially).

test('receive 15 keyboards, then an order for 4 leaves 11', async () => {
  const receipt = await api.post('/stock/receipts', { productId: KEYBOARD, warehouseId: WH_A, quantity: 15, reference: 'PO-1001' });
  assert.equal(receipt.status, 201);
  assert.equal(await keyboardStock(), 15);

  const order = await api.post('/orders', { warehouseId: WH_A, items: [{ productId: KEYBOARD, quantity: 4 }] });
  assert.equal(order.status, 201);
  assert.equal(order.body.totalMinor, 4 * 8900);
  assert.equal(await keyboardStock(), 11);

  const ledger = (await api.get(`/stock/movements?productId=${KEYBOARD}`)).body.items;
  assert.deepEqual(ledger.map((m: { type: string; delta: number }) => [m.type, m.delta]), [['order', -4], ['receipt', 15]]);
  assert.equal(ledger[0].referenceId, `order:${order.body.id}`);
});

test('an order for 20 fails with 409 and changes nothing', async () => {
  const [ordersBefore, movementsBefore] = [await orderCount(), (await api.get('/stock/movements')).body.total];

  const res = await api.post('/orders', { warehouseId: WH_A, items: [{ productId: KEYBOARD, quantity: 20 }] });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(res.body.details, { productId: KEYBOARD, warehouseId: WH_A, available: 11, requested: 20 });
  assert.equal(await keyboardStock(), 11);
  assert.equal(await orderCount(), ordersBefore);
  assert.equal((await api.get('/stock/movements')).body.total, movementsBefore);
});

test('one short line rolls back the whole order, including lines that had stock', async () => {
  const mouseBefore = (await api.get(`/inventory?warehouseId=${WH_A}&sku=MS-001`)).body.items[0].quantity;
  const res = await api.post('/orders', {
    warehouseId: WH_A, items: [{ productId: MOUSE, quantity: 1 }, { productId: KEYBOARD, quantity: 999 }],
  });
  assert.equal(res.status, 409);
  assert.equal((await api.get(`/inventory?warehouseId=${WH_A}&sku=MS-001`)).body.items[0].quantity, mouseBefore);
});

test('cancelling restores stock once; a second cancel is 409', async () => {
  const order = await api.post('/orders', { warehouseId: WH_A, items: [{ productId: KEYBOARD, quantity: 3 }] });
  assert.equal(await keyboardStock(), 8);

  const first = await api.post(`/orders/${order.body.id}/cancel`);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'cancelled');
  assert.equal(await keyboardStock(), 11);

  const second = await api.post(`/orders/${order.body.id}/cancel`);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'ORDER_NOT_CANCELLABLE');
  assert.equal(await keyboardStock(), 11);

  const ledger = (await api.get(`/stock/movements?productId=${KEYBOARD}`)).body.items;
  assert.deepEqual([ledger[0].type, ledger[0].delta], ['cancellation', 3]); // compensating row, original kept
  assert.deepEqual([ledger[1].type, ledger[1].delta], ['order', -3]);
});

test('a repeated externalReference returns the existing order (200) and deducts stock only once', async () => {
  const body = { warehouseId: WH_A, externalReference: 'SHOP-5001', items: [{ productId: KEYBOARD, quantity: 1 }] };
  const first = await api.post('/orders', body);
  const repeat = await api.post('/orders', body);
  assert.equal(first.status, 201);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.id, first.body.id);
  assert.equal(await keyboardStock(), 10);
});

test('inactive products cannot be ordered', async () => {
  const res = await api.post('/orders', { warehouseId: WH_A, items: [{ productId: VGA_ADAPTER, quantity: 1 }] });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'PRODUCT_INACTIVE');
});

test('invalid input is rejected with 400 and the error shape', async () => {
  for (const quantity of [-1, 0, 1.5]) {
    const res = await api.post('/orders', { warehouseId: WH_A, items: [{ productId: KEYBOARD, quantity }] });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  }
  assert.equal((await api.post('/stock/receipts', { productId: KEYBOARD, warehouseId: WH_A, quantity: -5, reference: 'x' })).status, 400);
  assert.equal((await api.patch(`/products/${KEYBOARD}`, { unitPrice: 1 })).status, 400); // unknown field
  assert.equal((await api.get('/products?pageSize=1000')).status, 400);
  assert.equal((await api.get('/products?sort=price')).status, 400);
  assert.equal((await api.get('/orders/abc')).status, 400);
});

test('the SKU is locked once a product has stock movements', async () => {
  const locked = await api.patch(`/products/${KEYBOARD}`, { sku: 'KB-002' });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, 'SKU_LOCKED');

  const fresh = await api.post('/products', { sku: 'WC-HD', name: 'HD webcam', unitPriceMinor: 5900 });
  assert.equal(fresh.status, 201);
  assert.equal((await api.patch(`/products/${fresh.body.id}`, { sku: 'WC-FHD' })).body.sku, 'WC-FHD');
  assert.equal((await api.post('/products', { sku: 'WC-FHD', name: 'Dup', unitPriceMinor: 1 })).body.code, 'SKU_TAKEN');
});

test('paging is deterministic: pages do not overlap and cover every product', async () => {
  const all = (await api.get('/products?pageSize=100')).body;
  const ids: number[] = [];
  for (let page = 1; page <= Math.ceil(all.total / 3); page++)
    ids.push(...(await api.get(`/products?pageSize=3&page=${page}`)).body.items.map((p: { id: number }) => p.id));
  assert.deepEqual(ids, all.items.map((p: { id: number }) => p.id));
  assert.deepEqual((await api.get('/products?pageSize=3&page=2')).body, (await api.get('/products?pageSize=3&page=2')).body);
});

test('writes need a valid API key; reads are public', async () => {
  const receipt = { productId: KEYBOARD, warehouseId: WH_A, quantity: 1, reference: 'x' };
  for (const key of [null, 'wrong-key']) {
    const res = await api.post('/stock/receipts', receipt, key);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
  }
  assert.equal(await keyboardStock(), 10);
  assert.equal((await api.get('/products')).status, 200);
});

test('health answers without internals; unknown routes get the error shape', async () => {
  assert.deepEqual((await api.get('/health')).body, { status: 'ok' });
  const res = await api.get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});
