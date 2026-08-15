import { z } from 'zod';
import { executionStatusSchema, stepStatusSchema } from './enums.js';

/** Erro estruturado — o mesmo formato para falha de ação, de gatilho ou do motor. */
export const executionErrorSchema = z.object({
  message: z.string(),
  /** Código estável para tratar programaticamente, ex: 'ACTION_TIMEOUT'. */
  code: z.string().optional(),
  /** Módulo onde ocorreu, ex: 'ai-generate'. */
  source: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ExecutionError = z.infer<typeof executionErrorSchema>;

export const executionStepPublicSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
  actionType: z.string(),
  status: stepStatusSchema,
  /** Já mascarado — segredos nunca chegam aqui. */
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: executionErrorSchema.nullable(),
  attempt: z.number().int(),
  durationMs: z.number().int().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type ExecutionStepPublic = z.infer<typeof executionStepPublicSchema>;

export const executionPublicSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  automationName: z.string(),
  status: executionStatusSchema,
  triggerPayload: z.unknown().nullable(),
  result: z.unknown().nullable(),
  error: executionErrorSchema.nullable(),
  durationMs: z.number().int().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  steps: z.array(executionStepPublicSchema).optional(),
});
export type ExecutionPublic = z.infer<typeof executionPublicSchema>;

export const listExecutionsQuerySchema = z.object({
  automationId: z.string().uuid().optional(),
  status: executionStatusSchema.optional(),
});
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;

/** Disparo manual pelo painel — o "Testar agora" da tela de automação. */
export const manualRunSchema = z.object({
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type ManualRunInput = z.infer<typeof manualRunSchema>;
