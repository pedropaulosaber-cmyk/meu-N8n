import { z } from 'zod';

/**
 * Valores canônicos compartilhados entre API, worker e painel.
 * Cada um vira também um enum do Postgres em apps/api/src/db/schema.ts —
 * mantenha os dois lados em sincronia ao alterar.
 */

export const automationStatusSchema = z.enum(['draft', 'active', 'inactive']);
export type AutomationStatus = z.infer<typeof automationStatusSchema>;

export const executionStatusSchema = z.enum([
  'queued',
  'running',
  'success',
  'error',
  'cancelled',
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const stepStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'error',
  'skipped',
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/** O que fazer quando uma ação falha depois de esgotar as retentativas. */
export const onErrorSchema = z.enum(['stop', 'continue']);
export type OnError = z.infer<typeof onErrorSchema>;

/**
 * As três famílias de módulo plugável da plataforma.
 * Adicionar uma integração nova significa registrar um módulo de um
 * destes tipos — nunca alterar o motor.
 */
export const integrationKindSchema = z.enum(['trigger', 'action', 'ai_provider']);
export type IntegrationKind = z.infer<typeof integrationKindSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;
