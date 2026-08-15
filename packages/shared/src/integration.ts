import { z } from 'zod';
import { integrationKindSchema } from './enums.js';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Descritor de campo
 * ─────────────────────────────────────────────────────────────────────
 * É a peça central do design plugável.  Cada módulo (gatilho, ação ou
 * provedor de IA) declara seus campos uma única vez e ganha de graça:
 *
 *   1. o formulário no editor de automação (renderizado genericamente)
 *   2. a validação no backend (via fieldsToZod(), em @orbita/engine)
 *   3. o card na aba Integrações
 *
 * Ou seja: adicionar uma integração nova nunca exige mexer no frontend
 * nem no motor de execução.
 */

export const fieldTypeSchema = z.enum([
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'secret', // input mascarado; só aparece em credenciais
  'json',
  'code', // textarea monoespaçado, ex: corpo de requisição
]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

export const fieldOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type FieldOption = z.infer<typeof fieldOptionSchema>;

export const fieldDescriptorSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: fieldTypeSchema,
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  placeholder: z.string().optional(),
  /** Texto de ajuda mostrado abaixo do campo. */
  help: z.string().optional(),
  /** Opções de um select estático. */
  options: z.array(fieldOptionSchema).optional(),
  /**
   * Quando as opções dependem de outro campo — ex: `model` depende de
   * `provider`. O painel recarrega as opções ao mudar o campo citado.
   */
  optionsDependOn: z.string().optional(),
  /**
   * Se o campo aceita interpolação `{{ trigger.body.x }}` /
   * `{{ steps.1.output.text }}`. O painel mostra o seletor de variáveis.
   */
  supportsTemplate: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  rows: z.number().int().optional(),
});
export type FieldDescriptor = z.infer<typeof fieldDescriptorSchema>;

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Catálogo de integrações  (GET /api/integrations)
 * ─────────────────────────────────────────────────────────────────────
 * Alimenta a aba Integrações do painel.
 */
export const integrationCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  kind: integrationKindSchema,
  /** Identificador de ícone resolvido pelo painel. */
  icon: z.string(),
  /** Cor de destaque do card, em hex. */
  color: z.string().optional(),
  /** Campos de configuração por automação (não são segredos). */
  configFields: z.array(fieldDescriptorSchema),
  /** Campos de credencial. Vazio = integração não precisa de segredo. */
  credentialFields: z.array(fieldDescriptorSchema),
  /** True quando a integração exige credencial para funcionar. */
  requiresCredential: z.boolean(),
  /** Quantas credenciais já foram cadastradas para esta integração. */
  credentialCount: z.number().int(),
  /** Quantas automações ATIVAS usam esta integração hoje. */
  activeAutomationCount: z.number().int(),
  /** Modelos disponíveis — só para kind === 'ai_provider'. */
  models: z.array(fieldOptionSchema).optional(),
});
export type IntegrationCatalogItem = z.infer<typeof integrationCatalogItemSchema>;

/** Status derivado, usado para o selo colorido do card na aba Integrações. */
export type IntegrationStatus = 'connected' | 'pending' | 'no_credential_needed';

export function resolveIntegrationStatus(
  item: Pick<IntegrationCatalogItem, 'requiresCredential' | 'credentialCount'>,
): IntegrationStatus {
  if (!item.requiresCredential) return 'no_credential_needed';
  return item.credentialCount > 0 ? 'connected' : 'pending';
}
