import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { AppError } from '../errors.ts';
import { Adjustment, Balance, InventoryQuery, Movement, MovementQuery, MoveResult, Page, Receipt, Warehouse } from '../schemas/index.ts';
import { listInventory, listMovements, listWarehouses, recordMovement } from '../services/stock.ts';

export const stockRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/warehouses', {
    schema: { tags: ['stock'], summary: 'List warehouses', response: { 200: Type.Array(Warehouse) } },
  }, () => listWarehouses());

  app.get('/inventory', {
    schema: { tags: ['stock'], summary: 'Current stock balances', querystring: InventoryQuery, response: { 200: Page(Balance) } },
  }, (req) => listInventory(req.query));

  app.get('/stock/movements', {
    schema: { tags: ['stock'], summary: 'Stock ledger, newest first', querystring: MovementQuery, response: { 200: Page(Movement) } },
  }, (req) => listMovements(req.query));

  app.post('/stock/receipts', {
    schema: { tags: ['stock'], summary: 'Receive stock into a warehouse', body: Receipt, response: { 201: MoveResult } },
  }, async (req, reply) => {
    const { productId, warehouseId, quantity, reference } = req.body;
    const result = await recordMovement({ productId, warehouseId, delta: quantity, type: 'receipt', referenceId: reference, actorId: req.actorId });
    return reply.status(201).send(result);
  });

  app.post('/stock/adjustments', {
    schema: { tags: ['stock'], summary: 'Correct stock up or down (stock count, damage)', body: Adjustment, response: { 201: MoveResult } },
  }, async (req, reply) => {
    const { productId, warehouseId, delta, reason } = req.body;
    if (delta === 0) throw new AppError(400, 'VALIDATION_ERROR', 'delta must not be 0.');
    const result = await recordMovement({ productId, warehouseId, delta, type: 'adjustment', referenceId: reason, actorId: req.actorId });
    return reply.status(201).send(result);
  });
};
