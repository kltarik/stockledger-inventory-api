import { paged, pool, tx } from '../db/pool.ts';
import { AppError, isUniqueViolation, notFound } from '../errors.ts';
import type { NewProduct, ProductPatch, ProductQuery } from '../schemas/index.ts';

const cols = `id, sku, name, unit_price_minor AS "unitPriceMinor", active, created_at AS "createdAt"`;
const sorts = { sku: 'sku, id', name: 'name, id', newest: 'created_at DESC, id DESC' };

const skuTaken = (err: unknown) =>
  isUniqueViolation(err, 'products_sku_key') ? new AppError(409, 'SKU_TAKEN', 'Another product already uses this SKU.') : err;

export function listProducts(q: ProductQuery) {
  // Escape % and _ so a search for "50%" means the text "50%", not a wildcard.
  const like = q.query ? `%${q.query.replace(/[\\%_]/g, '\\$&')}%` : null;
  return paged(
    `SELECT ${cols} FROM products WHERE $1::text IS NULL OR sku ILIKE $1 OR name ILIKE $1`,
    [like], sorts[q.sort], q);
}

export async function createProduct(p: NewProduct) {
  try {
    const r = await pool.query(
      `INSERT INTO products (sku, name, unit_price_minor, active) VALUES ($1, $2, $3, $4) RETURNING ${cols}`,
      [p.sku, p.name.trim(), p.unitPriceMinor, p.active]);
    return r.rows[0];
  } catch (err) {
    throw skuTaken(err);
  }
}

export async function updateProduct(id: number, p: ProductPatch) {
  try {
    return await tx(async (c) => {
      // FOR UPDATE locks the product, so no stock movement for it can start while we decide.
      const current = (await c.query('SELECT sku FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!current) throw notFound('Product', { productId: id });

      const skuChanges = p.sku !== undefined && p.sku !== current.sku;
      if (skuChanges && (await c.query('SELECT 1 FROM stock_movements WHERE product_id = $1 LIMIT 1', [id])).rowCount)
        throw new AppError(409, 'SKU_LOCKED', 'The SKU cannot change once the product has stock movements.', { productId: id });

      // coalesce($n, column): a field missing from the request keeps its current value.
      const r = await c.query(
        `UPDATE products SET sku = coalesce($2, sku), name = coalesce($3, name),
                unit_price_minor = coalesce($4, unit_price_minor), active = coalesce($5, active)
         WHERE id = $1 RETURNING ${cols}`,
        [id, p.sku ?? null, p.name?.trim() ?? null, p.unitPriceMinor ?? null, p.active ?? null]);
      return r.rows[0];
    });
  } catch (err) {
    throw skuTaken(err);
  }
}
