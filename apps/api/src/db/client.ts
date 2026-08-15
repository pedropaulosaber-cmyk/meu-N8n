import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>['db'];

export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    // O motor pode chegar a payloads grandes; deixar o driver falhar rápido
    // é melhor do que segurar uma conexão presa indefinidamente.
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });

  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
