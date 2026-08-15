import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { users } from './schema.js';
import { loadEnv } from '../env.js';
import { hashPassword } from '../auth/passwords.js';
import { passwordSchema } from '@orbita/shared';

/**
 * Cria o usuário owner a partir de OWNER_EMAIL/OWNER_PASSWORD.
 *
 * Idempotente: se o e-mail já existe, não faz nada — rodar de novo nunca
 * sobrescreve uma senha trocada pelo painel.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD) {
    console.error('Defina OWNER_EMAIL e OWNER_PASSWORD no .env antes de semear.');
    process.exit(1);
  }

  const validation = passwordSchema.safeParse(env.OWNER_PASSWORD);
  if (!validation.success) {
    console.error('OWNER_PASSWORD não atende à política de senha:');
    for (const issue of validation.error.issues) console.error(`  • ${issue.message}`);
    process.exit(1);
  }

  const { db, close } = createDb(env.DATABASE_URL, { max: 1 });

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.OWNER_EMAIL))
    .limit(1);

  if (existing) {
    console.log(`Owner ${env.OWNER_EMAIL} já existe — nada a fazer.`);
    await close();
    return;
  }

  await db.insert(users).values({
    email: env.OWNER_EMAIL,
    passwordHash: await hashPassword(env.OWNER_PASSWORD),
  });

  console.log(`Owner criado: ${env.OWNER_EMAIL}`);
  await close();
}

main().catch((err: unknown) => {
  console.error('Falha ao semear:', err);
  process.exit(1);
});
