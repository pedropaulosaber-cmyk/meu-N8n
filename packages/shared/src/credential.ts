import { z } from 'zod';
import { integrationKindSchema } from './enums.js';

/**
 * Uma credencial guarda os segredos de UMA integração (ex: a chave do
 * Gemini, o token do WhatsApp).  O conteúdo de `data` é criptografado com
 * AES-256-GCM antes de tocar o banco e NUNCA volta em texto para o painel.
 */
export const createCredentialSchema = z.object({
  name: z.string().min(1).max(120),
  /** id do módulo dono desta credencial, ex: 'gemini', 'whatsapp'. */
  integrationId: z.string().min(1).max(64),
  kind: integrationKindSchema,
  /** Pares campo→segredo. A forma é validada pelo credentialSchema do módulo. */
  data: z.record(z.string(), z.string()),
});
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const updateCredentialSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  /** Omitido = mantém os segredos atuais; presente = substitui todos. */
  data: z.record(z.string(), z.string()).optional(),
});
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;

/**
 * O que a API devolve. Repare que não existe campo `data`: o segredo só
 * sai do banco dentro do worker, na hora de executar a ação.
 */
export const credentialPublicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  integrationId: z.string(),
  kind: integrationKindSchema,
  /** Prévia mascarada por campo, ex: { apiKey: 'AIza••••••4f2c' }. */
  preview: z.record(z.string(), z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CredentialPublic = z.infer<typeof credentialPublicSchema>;
