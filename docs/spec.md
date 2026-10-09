# StockLedger spec

## Goal
A small retailer's inventory and orders API: products, warehouses, stock receipts and adjustments,
orders with cancellation, and a ledger that records every stock change. The point is the business
rules and consistency, not CRUD.

## Out of scope (v1)
Payments, suppliers, shipping, multi-warehouse optimisation, real customer data, a storefront.

## Stock policy
- Stock is **deducted when an order is created** and **restored when it is cancelled**.
- An order and its stock changes commit in **one transaction**: all lines succeed or none do.
- Every change to a balance writes one row to `stock_movements` (receipt, adjustment, order, cancellation).
  Movements are never edited or deleted; a cancellation adds compensating `+quantity` rows.
- Balances can never go negative (conditional UPDATE + `CHECK (quantity >= 0)`).

## Example story
1. Receive 15 keyboards (KB-001) into Warehouse A → available 15.
2. Order 4 → 201, available 11. Ledger: receipt +15, order −4, each with timestamp and reference.
3. Order 20 → 409 `INSUFFICIENT_STOCK` (available 11, requested 20). No order, no movement, totals unchanged.

## Endpoints
| Method/path | Notes |
| --- | --- |
| `GET /health` | `{ "status": "ok" }` or 503 |
| `GET /products?query=&sort=&page=&pageSize=` | search SKU/name; sort `sku`, `name`, `newest`; pageSize ≤ 100 |
| `POST /products`, `PATCH /products/{id}` | SKU locked once the product has movements; no DELETE |
| `GET /warehouses` | |
| `GET /inventory?warehouseId=&sku=&page=` | current balances |
| `POST /stock/receipts` | product, warehouse, quantity > 0, reference |
| `POST /stock/adjustments` | non-zero delta (negative removes), reason |
| `GET /stock/movements?productId=&warehouseId=&page=` | newest first |
| `POST /orders` | 201 new; 200 when `externalReference` already exists |
| `GET /orders?page=`, `GET /orders/{id}` | |
| `POST /orders/{id}/cancel` | once; second time 409 |

Errors: `{ "code", "message", "details" }`. 400 invalid input, 401 missing/wrong API key,
404 missing resource, 409 conflicting state or not enough stock.

## Acceptance tests
1. Receive 15, order 4 → balance 11; ledger shows +15 and −4.
2. Order 20 with 11 available → 409, no order or movement created, balance still 11.
3. 20 concurrent orders of 2 with 15 in stock → exactly 7 succeed, balance 1, never negative.
4. Cancel → stock restored with a compensating movement; second cancel → 409.
5. Negative, zero or fractional quantity → 400.
6. Paging: walking all pages returns every product exactly once, in the same order every time.
7. Writes without a valid key → 401; reads are public.
8. Same `externalReference` twice → same order, stock deducted once.

## Decisions
- Auth: API key in `x-api-key` for writes, reads public. Keys are stored as sha256 hashes.
- Duplicate `externalReference` → return the existing order with 200 (idempotent retry), not 409.
  The body of the repeat is not compared with the original.
- Duplicate cancellation → 409 `ORDER_NOT_CANCELLABLE`.
- Money: integer EUR cents everywhere; formatting happens only in clients.
- Products are never deleted; deactivate with `PATCH { "active": false }`. Inactive products can't be ordered.
