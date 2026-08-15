import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';
import { loadEnv } from '../env.js';

/** Aplica as migrations pendentes. Idempotente — seguro rodar sempre no deploy. */
async function main(): Promise<void> {
  const env = loadEnv();
  const { db, close } = createDb(env.DATABASE_URL, { max: 1 });

  console.log('Aplicando migrations...');
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  console.log('Migrations aplicadas.');

  await close();
}

main().catch((err: unknown) => {
  console.error('Falha ao migrar:', err);
  process.exit(1);
});
