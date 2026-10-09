import type pg from 'pg';
import { paged, pool, tx } from '../db/pool.ts';
import { AppError, isUniqueViolation, notFound } from '../errors.ts';
import type { NewOrder, PageParams } from '../schemas/index.ts';
import { move } from './stock.ts';

// Stock policy: stock is deducted when an order is created and restored when it is cancelled.

const orderCols = `o.id, o.external_reference AS "externalReference", o.warehouse_id AS "warehouseId", o.status,
  o.created_at AS "createdAt",
  (SELECT coalesce(sum(i.quantity::bigint * i.unit_price_minor_at_order), 0) FROM order_items i WHERE i.order_id = o.id) AS "totalMinor"`;

export async function getOrder(c: pg.Pool | pg.PoolClient, id: number) {
  const order = (await c.query(`SELECT ${orderCols}, o.updated_at AS "updatedAt" FROM orders o WHERE o.id = $1`, [id])).rows[0];
  if (!order) throw notFound('Order', { orderId: id });
  order.items = (await c.query(
    `SELECT i.product_id AS "productId", p.sku, p.name, i.quantity, i.unit_price_minor_at_order AS "unitPriceMinor",
            i.quantity::bigint * i.unit_price_minor_at_order AS "lineTotalMinor"
     FROM order_items i JOIN products p ON p.id = i.product_id
     WHERE i.order_id = $1 ORDER BY p.sku`, [id])).rows;
  return order;
}

export const listOrders = (q: PageParams) => paged(`SELECT ${orderCols} FROM orders o`, [], 'o.id DESC', q);

const findByReference = async (c: pg.Pool | pg.PoolClient, ref: string) => {
  const id = (await c.query('SELECT id FROM orders WHERE external_reference = $1', [ref])).rows[0]?.id;
  return id ? getOrder(c, id) : null;
};

// Returns { order, created }. created = false means the externalReference already existed.
export async function createOrder(input: NewOrder, actorId: number) {
  // The same product twice in one order counts as one line.
  const qty = new Map<number, number>();
  for (const i of input.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.quantity);
  // Always lock balance rows in the same order (by product id). Two orders that share products
  // then queue behind each other instead of each holding one lock and waiting for the other (deadlock).
  const productIds = [...qty.keys()].sort((a, b) => a - b);

  try {
    return await tx(async (c) => {
      if (input.externalReference) {
        const existing = await findByReference(c, input.externalReference);
        if (existing) return { order: existing, created: false };
      }

      if (!(await c.query('SELECT 1 FROM warehouses WHERE id = $1', [input.warehouseId])).rowCount)
        throw notFound('Warehouse', { warehouseId: input.warehouseId });

      // FOR SHARE: nobody can deactivate or reprice these products until this order commits.
      const products = new Map((await c.query(
        'SELECT id, active, unit_price_minor FROM products WHERE id = ANY($1) FOR SHARE', [productIds],
      )).rows.map((p) => [p.id, p]));
      const missing = productIds.filter((id) => !products.has(id));
      if (missing.length) throw notFound('Product', { productIds: missing });
      const inactive = productIds.filter((id) => !products.get(id).active);
      if (inactive.length)
        throw new AppError(409, 'PRODUCT_INACTIVE', 'Inactive products cannot be ordered.', { productIds: inactive });

      const orderId = (await c.query(
        'INSERT INTO orders (external_reference, warehouse_id) VALUES ($1, $2) RETURNING id',
        [input.externalReference ?? null, input.warehouseId])).rows[0].id;

      for (const productId of productIds) {
        const quantity = qty.get(productId)!;
        await c.query(
          'INSERT INTO order_items (order_id, product_id, quantity, unit_price_minor_at_order) VALUES ($1, $2, $3, $4)',
          [orderId, productId, quantity, products.get(productId).unit_price_minor]);
        // Throws INSUFFICIENT_STOCK if any line can't be covered; tx() then rolls back the whole order.
        await move(c, { productId, warehouseId: input.warehouseId, delta: -quantity, type: 'order', referenceId: `order:${orderId}`, actorId });
      }

      return { order: await getOrder(c, orderId), created: true };
    });
  } catch (err) {
    // Two requests with the same new reference at the same moment: the second INSERT hits the
    // unique constraint. Its transaction is rolled back, so answer with the order the first one made.
    if (input.externalReference && isUniqueViolation(err, 'orders_external_reference_key'))
      return { order: (await findByReference(pool, input.externalReference))!, created: false };
    throw err;
  }
}

// Cancelling is allowed once. It puts the stock back with compensating ledger rows (+quantity);
// the original "order" movements stay in the ledger untouched.
export function cancelOrder(id: number, actorId: number) {
  return tx(async (c) => {
    // Conditional UPDATE: of two simultaneous cancels, only the first matches status = 'placed'.
    const cancelled = await c.query(
      `UPDATE orders SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND status = 'placed' RETURNING warehouse_id`, [id]);
    if (!cancelled.rowCount) {
      if (!(await c.query('SELECT 1 FROM orders WHERE id = $1', [id])).rowCount) throw notFound('Order', { orderId: id });
      throw new AppError(409, 'ORDER_NOT_CANCELLABLE', 'This order is already cancelled.', { orderId: id });
    }

    const items = (await c.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id', [id])).rows;
    for (const i of items)
      await move(c, {
        productId: i.product_id, warehouseId: cancelled.rows[0].warehouse_id, delta: i.quantity,
        type: 'cancellation', referenceId: `order:${id}`, actorId,
      });

    return getOrder(c, id);
  });
}
