import { buildApp } from './app.ts';
import { migrate } from './db/migrate.ts';
import { seed } from './db/seed.ts';

// Startup: bring the schema up to date, seed an empty database, then listen.
await migrate();
await seed();
const app = await buildApp();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
