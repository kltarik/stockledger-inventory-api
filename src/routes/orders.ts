import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { IdParams, NewOrder, Order, OrderListQuery, OrderSummary, Page } from '../schemas/index.ts';
import { cancelOrder, createOrder, getOrder, listOrders } from '../services/orders.ts';
import { pool } from '../db/pool.ts';

export const orderRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/orders', {
    schema: { tags: ['orders'], summary: 'List orders, newest first', querystring: OrderListQuery, response: { 200: Page(OrderSummary) } },
  }, (req) => listOrders(req.query));

  app.get('/orders/:id', {
    schema: { tags: ['orders'], summary: 'Order with its items', params: IdParams, response: { 200: Order } },
  }, (req) => getOrder(pool, req.params.id));

  app.post('/orders', {
    schema: {
      tags: ['orders'],
      summary: 'Place an order; deducts stock in the same transaction',
      description: '201 = new order. 200 = an order with this externalReference already exists and is returned unchanged.',
      body: NewOrder, response: { 200: Order, 201: Order },
    },
  }, async (req, reply) => {
    const { order, created } = await createOrder(req.body, req.actorId!);
    return reply.status(created ? 201 : 200).send(order);
  });

  app.post('/orders/:id/cancel', {
    schema: { tags: ['orders'], summary: 'Cancel once; puts the stock back', params: IdParams, response: { 200: Order } },
  }, (req) => cancelOrder(req.params.id, req.actorId!));
};
