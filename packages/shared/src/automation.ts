import { z } from 'zod';
import { automationStatusSchema, onErrorSchema } from './enums.js';

/**
 * Uma ação configurada dentro de uma automação.
 *
 * `config` é deliberadamente um record aberto aqui: a forma real de cada
 * ação é definida pelo `configSchema` do módulo correspondente no registry
 * e validada em runtime pela API. É isso que permite adicionar integrações
 * novas sem tocar neste arquivo.
 */
export const automationActionInputSchema = z.object({
  /** id do módulo de ação, ex: 'ai-generate', 'http-request'. */
  actionType: z.string().min(1).max(64),
  config: z.record(z.string(), z.unknown()).default({}),
  credentialId: z.string().uuid().nullable().default(null),
  onError: onErrorSchema.default('stop'),
  retries: z.number().int().min(0).max(10).default(2),
  timeoutMs: z.number().int().min(1000).max(300_000).default(30_000),
});
export type AutomationActionInput = z.infer<typeof automationActionInputSchema>;

export const createAutomationSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).default(''),
  status: automationStatusSchema.default('draft'),
  /** id do módulo de gatilho, ex: 'webhook', 'schedule'. */
  triggerType: z.string().min(1).max(64),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  /** Executadas em ordem; o resultado de uma fica disponível para as seguintes. */
  actions: z.array(automationActionInputSchema).max(50).default([]),
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = createAutomationSchema.partial();
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

export const automationActionPublicSchema = automationActionInputSchema.extend({
  id: z.string().uuid(),
  position: z.number().int(),
});
export type AutomationActionPublic = z.infer<typeof automationActionPublicSchema>;

export const automationPublicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  status: automationStatusSchema,
  triggerType: z.string(),
  triggerConfig: z.record(z.string(), z.unknown()),
  /** URL completa do webhook, montada a partir do token. Null se o gatilho não for webhook. */
  webhookUrl: z.string().nullable(),
  actions: z.array(automationActionPublicSchema),
  lastRunAt: z.string().datetime().nullable(),
  lastRunStatus: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AutomationPublic = z.infer<typeof automationPublicSchema>;

export const listAutomationsQuerySchema = z.object({
  status: automationStatusSchema.optional(),
  triggerType: z.string().max(64).optional(),
  q: z.string().max(160).optional(),
});
export type ListAutomationsQuery = z.infer<typeof listAutomationsQuerySchema>;
