# Architecture

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

## Order flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API (POST /orders)
    participant DB as PostgreSQL
    C->>A: { warehouseId, items }
    A->>DB: BEGIN
    A->>DB: check warehouse, lock products FOR SHARE (exist, active)
    A->>DB: INSERT order + order_items
    loop each item, sorted by product id
        A->>DB: UPDATE balance SET qty = qty - n WHERE qty - n >= 0
        alt no row updated
            A->>DB: ROLLBACK
            A-->>C: 409 INSUFFICIENT_STOCK
        end
        A->>DB: INSERT stock_movement (-n)
    end
    A->>DB: COMMIT
    A-->>C: 201 order with items and total
```

## Why there is no repository layer
Services own their SQL. Each query is used in one place, and a repository interface would have exactly
one implementation. `src/db/pool.ts` holds the shared persistence pieces: the pool, `tx()` and `paged()`.
