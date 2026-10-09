import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyError } from 'fastify';
import { requireKeyForWrites } from './auth.ts';
import { pool } from './db/pool.ts';
import { AppError } from './errors.ts';
import { orderRoutes } from './routes/orders.ts';
import { productRoutes } from './routes/products.ts';
import { stockRoutes } from './routes/stock.ts';
import { ErrorResponse } from './schemas/index.ts';

export async function buildApp({ logger = true } = {}) {
  // removeAdditional: false -> an unknown field (a typo like "unitPrice") is a 400, not silently dropped.
  const app = Fastify({ logger, ajv: { customOptions: { removeAdditional: false } } }).withTypeProvider<TypeBoxTypeProvider>();

  // OpenAPI document built from the route schemas; Swagger UI at /docs.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'StockLedger API',
        version: '1.0.0',
        description: 'Inventory and orders. Reads are public; writes need the x-api-key header. Money is in EUR cents.',
      },
      components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Every route registered after this point documents the shared error shape and, for writes, the key.
  app.addHook('onRoute', (route) => {
    const methods = [route.method].flat();
    route.schema = { ...route.schema, response: { ...(route.schema?.response as object), '4xx': ErrorResponse } };
    if (!methods.includes('GET')) route.schema = { ...route.schema, security: [{ apiKey: [] }] };
  });

  app.decorateRequest('actorId', null);
  app.addHook('onRequest', requireKeyForWrites);

  // One error shape for everything: { code, message, details }. Never a stack trace.
  app.setErrorHandler((err: FastifyError & { constraint?: string }, req, reply) => {
    if (err instanceof AppError)
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    if (err.validation)
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: err.message, details: { errors: err.validation } });
    if (err.code === '23503') // foreign key: the body names a product or warehouse that doesn't exist
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'A referenced product or warehouse does not exist.', details: {} });
    if (err.statusCode && err.statusCode < 500) // malformed JSON, wrong content type, body too large, ...
      return reply.status(err.statusCode).send({ code: 'BAD_REQUEST', message: err.message, details: {} });
    req.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: {} });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found.`, details: {} }));

  app.get('/health', { schema: { tags: ['health'], summary: 'Liveness and database check' } }, async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(productRoutes);
  await app.register(stockRoutes);
  await app.register(orderRoutes);
  return app;
}
