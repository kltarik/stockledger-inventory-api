-- Money is stored as integer minor units (cents). Currency for the whole demo: EUR.

CREATE TABLE api_clients (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  key_hash   text NOT NULL UNIQUE,            -- sha256 of the API key; the key itself is never stored
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku              text NOT NULL UNIQUE,
  name             text NOT NULL,
  unit_price_minor integer NOT NULL CHECK (unit_price_minor >= 0),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE
);

CREATE TABLE inventory_balances (
  product_id   integer NOT NULL REFERENCES products,
  warehouse_id integer NOT NULL REFERENCES warehouses,
  quantity     integer NOT NULL CHECK (quantity >= 0),  -- last line of defence against overselling
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE stock_movements (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   integer NOT NULL REFERENCES products,
  warehouse_id integer NOT NULL REFERENCES warehouses,
  delta        integer NOT NULL CHECK (delta <> 0),
  type         text NOT NULL CHECK (type IN ('receipt', 'adjustment', 'order', 'cancellation')),
  reference_id text NOT NULL,
  actor_id     integer REFERENCES api_clients,      -- null for seed data
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON stock_movements (product_id, warehouse_id);

-- The ledger is append-only: the database itself refuses to change or delete a movement.
CREATE FUNCTION forbid_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only';
END $$;
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

CREATE TABLE orders (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_reference text UNIQUE,                    -- optional; NULLs never clash with each other
  warehouse_id       integer NOT NULL REFERENCES warehouses,
  status             text NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'cancelled')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id                  integer NOT NULL REFERENCES orders,
  product_id                integer NOT NULL REFERENCES products,
  quantity                  integer NOT NULL CHECK (quantity > 0),
  unit_price_minor_at_order integer NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
