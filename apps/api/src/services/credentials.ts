import { eq } from 'drizzle-orm';
import type { CredentialPublic, CreateCredentialInput, UpdateCredentialInput } from '@orbita/shared';
import { registry, fieldsToZod } from '@orbita/engine';
import type { Database } from '../db/client.js';
import { credentials } from '../db/schema.js';
import {
  encryptCredentialData,
  decryptCredentialData,
  buildPreview,
} from '../crypto/credentials.js';

export class CredentialError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

/** O AAD amarra o ciphertext a esta credencial específica. */
function aadFor(credentialId: string): string {
  return `credential:${credentialId}`;
}

type CredentialRow = typeof credentials.$inferSelect;

function toPublic(row: CredentialRow): CredentialPublic {
  return {
    id: row.id,
    name: row.name,
    integrationId: row.integrationId,
    kind: row.kind,
    preview: row.preview,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Valida os segredos contra o `credentialFields` declarado pelo módulo. */
function validateAgainstModule(integrationId: string, data: Record<string, string>): void {
  const module = registry.findAny(integrationId);
  if (!module) {
    throw new CredentialError(
      `Integração "${integrationId}" não existe`,
      'INTEGRATION_NOT_FOUND',
      404,
    );
  }

  const fields = module.credentialFields ?? [];
  if (fields.length === 0) {
    throw new CredentialError(
      `A integração "${module.name}" não usa credencial`,
      'INTEGRATION_HAS_NO_CREDENTIALS',
    );
  }

  const parsed = fieldsToZod(fields).safeParse(data);
  if (!parsed.success) {
    throw new CredentialError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      'INVALID_CREDENTIAL_DATA',
    );
  }
}

export async function listCredentials(db: Database): Promise<CredentialPublic[]> {
  const rows = await db.select().from(credentials).orderBy(credentials.createdAt);
  return rows.map(toPublic);
}

export async function createCredential(
  db: Database,
  input: CreateCredentialInput,
  encryptionKey: string,
): Promise<CredentialPublic> {
  validateAgainstModule(input.integrationId, input.data);

  // Insere primeiro para obter o id, que entra no AAD. Sem o id não dá
  // para amarrar o ciphertext à linha — por isso a cifragem vem depois.
  const [created] = await db
    .insert(credentials)
    .values({
      name: input.name,
      integrationId: input.integrationId,
      kind: input.kind,
      dataEncrypted: Buffer.alloc(0),
      iv: Buffer.alloc(0),
      authTag: Buffer.alloc(0),
      preview: {},
    })
    .returning();

  if (!created) throw new CredentialError('Falha ao criar credencial', 'INSERT_FAILED', 500);

  const encrypted = encryptCredentialData(input.data, encryptionKey, aadFor(created.id));

  const [updated] = await db
    .update(credentials)
    .set({
      dataEncrypted: encrypted.dataEncrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      preview: buildPreview(input.data),
      updatedAt: new Date(),
    })
    .where(eq(credentials.id, created.id))
    .returning();

  return toPublic(updated!);
}

export async function updateCredential(
  db: Database,
  id: string,
  input: UpdateCredentialInput,
  encryptionKey: string,
): Promise<CredentialPublic> {
  const [existing] = await db.select().from(credentials).where(eq(credentials.id, id)).limit(1);
  if (!existing) throw new CredentialError('Credencial não encontrada', 'NOT_FOUND', 404);

  const patch: Partial<typeof credentials.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) patch.name = input.name;

  // `data` ausente mantém os segredos atuais — assim dá para renomear a
  // credencial sem precisar redigitar a chave.
  if (input.data !== undefined) {
    validateAgainstModule(existing.integrationId, input.data);
    const encrypted = encryptCredentialData(input.data, encryptionKey, aadFor(id));
    patch.dataEncrypted = encrypted.dataEncrypted;
    patch.iv = encrypted.iv;
    patch.authTag = encrypted.authTag;
    patch.keyVersion = encrypted.keyVersion;
    patch.preview = buildPreview(input.data);
  }

  const [updated] = await db
    .update(credentials)
    .set(patch)
    .where(eq(credentials.id, id))
    .returning();

  return toPublic(updated!);
}

export async function deleteCredential(db: Database, id: string): Promise<void> {
  const deleted = await db
    .delete(credentials)
    .where(eq(credentials.id, id))
    .returning({ id: credentials.id });

  if (deleted.length === 0) {
    throw new CredentialError('Credencial não encontrada', 'NOT_FOUND', 404);
  }
  // As ações que a usavam ficam com credential_id nulo (ON DELETE SET NULL)
  // e passam a falhar com CREDENTIAL_REQUIRED, que é diagnosticável.
}

/**
 * Decifra para uso do worker.
 *
 * O retorno só deve viver em memória durante a execução da ação. Nunca
 * persista, nunca inclua em resposta HTTP.
 */
export async function loadSecrets(
  db: Database,
  id: string,
  encryptionKey: string,
): Promise<Record<string, string>> {
  const [row] = await db.select().from(credentials).where(eq(credentials.id, id)).limit(1);
  if (!row) throw new CredentialError('Credencial não encontrada', 'NOT_FOUND', 404);

  const secrets = decryptCredentialData(
    {
      dataEncrypted: row.dataEncrypted,
      iv: row.iv,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
    },
    encryptionKey,
    aadFor(id),
  );

  await db
    .update(credentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(credentials.id, id));

  return secrets;
}
