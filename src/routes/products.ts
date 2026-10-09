import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { IdParams, NewProduct, Page, Product, ProductPatch, ProductQuery } from '../schemas/index.ts';
import { createProduct, listProducts, updateProduct } from '../services/products.ts';

// No DELETE route on purpose: products with history must stay. Deactivate with PATCH { "active": false }.
export const productRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/products', {
    schema: { tags: ['products'], summary: 'Search the catalog (paginated)', querystring: ProductQuery, response: { 200: Page(Product) } },
  }, (req) => listProducts(req.query));

  app.post('/products', {
    schema: { tags: ['products'], summary: 'Create a product', body: NewProduct, response: { 201: Product } },
  }, async (req, reply) => reply.status(201).send(await createProduct(req.body)));

  app.patch('/products/:id', {
    schema: { tags: ['products'], summary: 'Edit a product (SKU is locked once it has stock movements)', params: IdParams, body: ProductPatch, response: { 200: Product } },
  }, (req) => updateProduct(req.params.id, req.body));
};
