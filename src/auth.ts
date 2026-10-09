import type { FastifyRequest } from 'fastify';
import { pool } from './db/pool.ts';
import { hashKey } from './db/seed.ts';
import { AppError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    actorId: number | null; // the api_clients.id behind the request's key; null on public reads
  }
}

const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Send a valid API key in the x-api-key header.');

// Reads are public. Every other method (POST, PATCH, ...) needs a valid key, so a new write
// route is protected automatically instead of relying on someone remembering to add a check.
export async function requireKeyForWrites(req: FastifyRequest) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string' || !key) throw unauthorized();
  // Only the sha256 of each key is stored, so a leaked database doesn't leak working keys.
  const client = (await pool.query('SELECT id FROM api_clients WHERE key_hash = $1', [hashKey(key)])).rows[0];
  if (!client) throw unauthorized();
  req.actorId = client.id;
}
