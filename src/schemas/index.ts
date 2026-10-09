import { Type, type Static, type TSchema } from 'typebox';

// One TypeBox schema = request validation + response shape + OpenAPI docs + TypeScript type.

// ---- shared -----------------------------------------------------------------

export const Id = Type.Integer({ minimum: 1, maximum: 2147483647 });
export const IdParams = Type.Object({ id: Id });
const Timestamp = Type.Unsafe<Date>({ type: 'string', format: 'date-time' }); // pg returns Date; JSON gets ISO text
const Money = Type.Integer({ minimum: 0, maximum: 10_000_000, description: 'EUR cents (integer minor units)' });

const PageParams = {
  page: Type.Integer({ minimum: 1, default: 1 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
};
export type PageParams = { page: number; pageSize: number };
export const Page = <T extends TSchema>(item: T) =>
  Type.Object({ items: Type.Array(item), page: Type.Integer(), pageSize: Type.Integer(), total: Type.Integer() });

export const ErrorResponse = Type.Object(
  { code: Type.String(), message: Type.String(), details: Type.Record(Type.String(), Type.Unknown()) },
  {
    examples: [{
      code: 'INSUFFICIENT_STOCK',
      message: 'Not enough stock for product 1: 11 available, 20 requested.',
      details: { productId: 1, warehouseId: 1, available: 11, requested: 20 },
    }],
  },
);

// ---- products -----------------------------------------------------------------

const Sku = Type.String({ pattern: '^[A-Z0-9][A-Z0-9-]{1,31}$', description: 'Uppercase letters, digits and dashes', examples: ['KB-001'] });
const Name = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' }); // at least one non-space character

export const Product = Type.Object({
  id: Id, sku: Sku, name: Name, unitPriceMinor: Money, active: Type.Boolean(), createdAt: Timestamp,
});
export const NewProduct = Type.Object(
  { sku: Sku, name: Name, unitPriceMinor: Money, active: Type.Boolean({ default: true }) },
  { additionalProperties: false, examples: [{ sku: 'WC-HD', name: 'HD webcam', unitPriceMinor: 5900 }] },
);
export const ProductPatch = Type.Object(
  { sku: Type.Optional(Sku), name: Type.Optional(Name), unitPriceMinor: Type.Optional(Money), active: Type.Optional(Type.Boolean()) },
  { additionalProperties: false, minProperties: 1, examples: [{ active: false }] },
);
export const ProductQuery = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 100, description: 'Search in SKU and name' })),
  sort: Type.Enum(['sku', 'name', 'newest'], { default: 'sku' }),
  ...PageParams,
});
export type NewProduct = Static<typeof NewProduct>;
export type ProductPatch = Static<typeof ProductPatch>;
export type ProductQuery = Static<typeof ProductQuery>;

// ---- warehouses, inventory, stock movements ------------------------------------------

export const Warehouse = Type.Object({ id: Id, name: Type.String(), code: Type.String() });

export const Balance = Type.Object({
  productId: Id, sku: Type.String(), productName: Type.String(),
  warehouseId: Id, warehouseCode: Type.String(), quantity: Type.Integer(),
});
export const InventoryQuery = Type.Object({ warehouseId: Type.Optional(Id), sku: Type.Optional(Type.String({ maxLength: 32 })), ...PageParams });
export type InventoryQuery = Static<typeof InventoryQuery>;

export const MovementType = Type.Enum(['receipt', 'adjustment', 'order', 'cancellation']);
export type MovementType = Static<typeof MovementType>;
export const Movement = Type.Object({
  id: Id, productId: Id, sku: Type.String(), warehouseId: Id, delta: Type.Integer(), type: MovementType,
  referenceId: Type.String(), actorId: Type.Union([Id, Type.Null()]), createdAt: Timestamp,
});
export const MovementQuery = Type.Object({ productId: Type.Optional(Id), warehouseId: Type.Optional(Id), ...PageParams });
export type MovementQuery = Static<typeof MovementQuery>;

const Reference = Type.String({ minLength: 1, maxLength: 100 });
export const Receipt = Type.Object(
  { productId: Id, warehouseId: Id, quantity: Type.Integer({ minimum: 1, maximum: 100_000 }), reference: Reference },
  { additionalProperties: false, examples: [{ productId: 1, warehouseId: 1, quantity: 15, reference: 'PO-1001' }] },
);
export const Adjustment = Type.Object(
  { productId: Id, warehouseId: Id, delta: Type.Integer({ minimum: -100_000, maximum: 100_000, description: 'Non-zero; negative removes stock' }), reason: Reference },
  { additionalProperties: false, examples: [{ productId: 2, warehouseId: 1, delta: -2, reason: 'Damaged in storage' }] },
);
export const MoveResult = Type.Object({ movement: Movement, quantity: Type.Integer({ description: 'Balance after the movement' }) });

// ---- orders -----------------------------------------------------------------

const OrderStatus = Type.Enum(['placed', 'cancelled']);
const OrderFields = {
  id: Id, externalReference: Type.Union([Type.String(), Type.Null()]), warehouseId: Id,
  status: OrderStatus, totalMinor: Type.Integer({ description: 'EUR cents' }), createdAt: Timestamp,
};
export const OrderSummary = Type.Object(OrderFields);
export const Order = Type.Object({
  ...OrderFields,
  updatedAt: Timestamp,
  items: Type.Array(Type.Object({
    productId: Id, sku: Type.String(), name: Type.String(), quantity: Type.Integer(),
    unitPriceMinor: Type.Integer(), lineTotalMinor: Type.Integer(),
  })),
});
export const NewOrder = Type.Object(
  {
    warehouseId: Id,
    externalReference: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Repeating a reference returns the existing order (200) instead of creating a new one' })),
    items: Type.Array(
      Type.Object({ productId: Id, quantity: Type.Integer({ minimum: 1, maximum: 10_000 }) }, { additionalProperties: false }),
      { minItems: 1, maxItems: 50 },
    ),
  },
  { additionalProperties: false, examples: [{ warehouseId: 1, externalReference: 'SHOP-5001', items: [{ productId: 1, quantity: 4 }] }] },
);
export type NewOrder = Static<typeof NewOrder>;
export const OrderListQuery = Type.Object({ ...PageParams });
