# StockLedger

Transactional inventory and order REST API with PostgreSQL, TypeScript, OpenAPI and integration tests.

A small retailer's backend: receive stock into warehouses, take orders, cancel them, and see every
stock change in an append-only ledger. Orders and their stock changes commit in one transaction,
and concurrent orders can't oversell.

<!-- TODO after deploying: **Live API docs:** https://your-app.onrender.com/docs (free tier: the first request may take ~1 minute to wake it) · **Video:** link -->

<!-- TODO after taking the screenshot: ![Swagger UI](docs/screenshots/swagger.png) -->

## The demo story in 4 steps

1. Receive 15 keyboards into Warehouse A → available **15**
2. Order 4 → **201**, available **11**; the ledger shows `receipt +15` and `order −4`
3. Order 20 → **409 INSUFFICIENT_STOCK**, nothing changes:

   ```json
   { "code": "INSUFFICIENT_STOCK",
     "message": "Not enough stock for product 1: 11 available, 20 requested.",
     "details": { "productId": 1, "warehouseId": 1, "available": 11, "requested": 20 } }
   ```
4. Cancel the first order → stock back to 15 with a compensating `+4`; cancelling again → 409

Run it yourself: [`examples/demo.http`](examples/demo.http).

**Stack:** Node.js 22 · TypeScript · Fastify 5 · PostgreSQL 16 · TypeBox + OpenAPI · node:test · GitHub Actions

## Architecture

```text
Client (curl, Swagger UI at /docs, examples/demo.http)
   │  JSON over HTTP; writes carry x-api-key
   ▼
Fastify routes (src/routes)      ── TypeBox schemas: validation, response shape, OpenAPI
   │
   ▼
Services (src/services)          ── business rules; one transaction per write
   │  move() is the only code that changes stock
   ▼
PostgreSQL 16                    ── CHECK quantity >= 0, unique SKU/reference, append-only ledger trigger
```

Order-flow sequence diagram: [`docs/architecture.md`](docs/architecture.md).

## Run locally

Prerequisites: Docker, Node 22.18+.

```bash
cp .env.example .env
docker compose up -d db        # PostgreSQL on port 5433
npm ci
npm run dev                    # migrates, seeds, serves http://localhost:3000 (docs at /docs)
```

Reset the demo data: `docker compose down -v && docker compose up -d db`, then restart.

## Tests

```bash
npm test          # 15 integration + concurrency tests against a throwaway stockledger_test database
npm run typecheck
```

## API

| Method/path | |
| --- | --- |
| `GET /health` | status only |
| `GET /products?query=&sort=&page=&pageSize=` | paginated, stable sort |
| `POST /products` · `PATCH /products/{id}` | SKU locked after the first stock movement |
| `GET /warehouses` · `GET /inventory?warehouseId=&sku=` | balances |
| `POST /stock/receipts` · `POST /stock/adjustments` | stock in / corrections |
| `GET /stock/movements?productId=&warehouseId=&page=` | the ledger |
| `POST /orders` · `GET /orders` · `GET /orders/{id}` · `POST /orders/{id}/cancel` | orders |

Errors are always `{ code, message, details }`: 400 validation, 401 missing/wrong key, 404 missing, 409 conflict/stock.

## Auth (demo)

Reads are public. Writes need `x-api-key`; locally it's `dev-demo-key` (from `.env.example`).
The hosted demo's key is private, so visitors can browse but not change data. Run the write requests locally.

## Design decisions and trade-offs

- **Stock policy:** deduct on order creation, restore on cancellation, one transaction for both.
- **No overselling:** the stock check and the write are one conditional `UPDATE`; Postgres locks the row
  and re-checks the condition for the waiting transaction. `CHECK (quantity >= 0)` is the backstop.
- **Deadlock-free multi-line orders:** balance rows are always locked in product-id order.
- **Append-only ledger:** a trigger rejects UPDATE/DELETE on `stock_movements`; cancellations add compensating rows.
- **Idempotent order creation:** a repeated `externalReference` returns the existing order (200).
- **Plain SQL over an ORM:** the locking is the point, so it stays visible.
- **Money in integer cents** (EUR); formatting is the client's job.
- Not built: payments, suppliers, warehouse management endpoints, rate limiting, read-only keys.
