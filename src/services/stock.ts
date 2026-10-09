import type pg from 'pg';
import { paged, pool, tx } from '../db/pool.ts';
import { AppError } from '../errors.ts';
import type { InventoryQuery, MovementQuery, MovementType } from '../schemas/index.ts';

const movementCols = `m.id, m.product_id AS "productId", p.sku, m.warehouse_id AS "warehouseId", m.delta, m.type,
  m.reference_id AS "referenceId", m.actor_id AS "actorId", m.created_at AS "createdAt"`;

type Move = {
  productId: number; warehouseId: number; delta: number;
  type: MovementType; referenceId: string; actorId: number | null;
};

// The ONLY code that changes stock. It must run inside a transaction (tx), so the balance change,
// the ledger row, and whatever the caller writes (an order, a cancellation) commit together.
export async function move(c: pg.PoolClient, m: Move) {
  const key = [m.productId, m.warehouseId];

  // Make sure a balance row exists (quantity 0) so the UPDATE below always has a row to work on.
  // A missing product or warehouse fails here with a foreign-key error -> 404.
  await c.query(
    'INSERT INTO inventory_balances (product_id, warehouse_id, quantity) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', key);

  // The stock check and the write are ONE statement. UPDATE locks the row; a concurrent order for the
  // same product waits here, then re-checks "quantity + delta >= 0" against the NEW quantity.
  // So two orders can never both take the last units.
  const updated = await c.query(
    `UPDATE inventory_balances SET quantity = quantity + $3
     WHERE product_id = $1 AND warehouse_id = $2 AND quantity + $3 >= 0
     RETURNING quantity`,
    [...key, m.delta]);

  if (!updated.rowCount) {
    const available = (await c.query(
      'SELECT quantity FROM inventory_balances WHERE product_id = $1 AND warehouse_id = $2', key)).rows[0].quantity;
    throw new AppError(409, 'INSUFFICIENT_STOCK',
      `Not enough stock for product ${m.productId}: ${available} available, ${-m.delta} requested.`,
      { productId: m.productId, warehouseId: m.warehouseId, available, requested: -m.delta });
  }

  const movement = (await c.query(
    `WITH m AS (
       INSERT INTO stock_movements (product_id, warehouse_id, delta, type, reference_id, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *)
     SELECT ${movementCols} FROM m JOIN products p ON p.id = m.product_id`,
    [...key, m.delta, m.type, m.referenceId, m.actorId])).rows[0];

  return { movement, quantity: updated.rows[0].quantity };
}

// A receipt or an adjustment on its own: one movement in its own transaction.
export const recordMovement = (m: Move) => tx((c) => move(c, m));

export const listWarehouses = async () =>
  (await pool.query('SELECT id, name, code FROM warehouses ORDER BY code')).rows;

export const listInventory = (q: InventoryQuery) => paged(
  `SELECT b.product_id AS "productId", p.sku, p.name AS "productName",
          b.warehouse_id AS "warehouseId", w.code AS "warehouseCode", b.quantity
   FROM inventory_balances b
   JOIN products p ON p.id = b.product_id
   JOIN warehouses w ON w.id = b.warehouse_id
   WHERE ($1::int IS NULL OR b.warehouse_id = $1) AND ($2::text IS NULL OR p.sku = $2)`,
  [q.warehouseId ?? null, q.sku ?? null], '"warehouseCode", sku', q);

export const listMovements = (q: MovementQuery) => paged(
  `SELECT ${movementCols} FROM stock_movements m JOIN products p ON p.id = m.product_id
   WHERE ($1::int IS NULL OR m.product_id = $1) AND ($2::int IS NULL OR m.warehouse_id = $2)`,
  [q.productId ?? null, q.warehouseId ?? null], 'm.created_at DESC, m.id DESC', q);
