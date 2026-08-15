import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { ExecutionPublic, ListExecutionsQuery, Pagination } from '@orbita/shared';
import type { Database } from '../db/client.js';
import { automations, executionSteps, executions } from '../db/schema.js';

export class ExecutionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

type ExecutionRow = typeof executions.$inferSelect;
type StepRow = typeof executionSteps.$inferSelect;

function toPublic(
  row: ExecutionRow,
  automationName: string,
  steps?: StepRow[],
): ExecutionPublic {
  return {
    id: row.id,
    automationId: row.automationId,
    automationName,
    status: row.status,
    triggerPayload: row.triggerPayload,
    result: row.result,
    error: (row.error as ExecutionPublic['error']) ?? null,
    durationMs: row.durationMs,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(steps && {
      steps: steps
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          id: s.id,
          position: s.position,
          actionType: s.actionType,
          status: s.status,
          input: s.input,
          output: s.output,
          error: (s.error as ExecutionPublic['error']) ?? null,
          attempt: s.attempt,
          durationMs: s.durationMs,
          startedAt: s.startedAt?.toISOString() ?? null,
          finishedAt: s.finishedAt?.toISOString() ?? null,
        })),
    }),
  };
}

export async function listExecutions(
  db: Database,
  query: ListExecutionsQuery,
  pagination: Pagination,
): Promise<{ items: ExecutionPublic[]; total: number }> {
  const filters = [];
  if (query.automationId) filters.push(eq(executions.automationId, query.automationId));
  if (query.status) filters.push(eq(executions.status, query.status));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const countRows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(executions)
    .where(where);
  const total = countRows[0]?.total ?? 0;

  const rows = await db
    .select({ execution: executions, automationName: automations.name })
    .from(executions)
    .innerJoin(automations, eq(executions.automationId, automations.id))
    .where(where)
    .orderBy(desc(executions.createdAt))
    .limit(pagination.perPage)
    .offset((pagination.page - 1) * pagination.perPage);

  return {
    items: rows.map((r) => toPublic(r.execution, r.automationName)),
    total,
  };
}

/** Detalhe com os passos — alimenta a linha expansível da tela de execuções. */
export async function getExecution(db: Database, id: string): Promise<ExecutionPublic> {
  const [row] = await db
    .select({ execution: executions, automationName: automations.name })
    .from(executions)
    .innerJoin(automations, eq(executions.automationId, automations.id))
    .where(eq(executions.id, id))
    .limit(1);

  if (!row) throw new ExecutionError('Execução não encontrada', 'NOT_FOUND', 404);

  const steps = await db
    .select()
    .from(executionSteps)
    .where(eq(executionSteps.executionId, id));

  return toPublic(row.execution, row.automationName, steps);
}

/**
 * Cria a execução em estado 'queued'.
 *
 * A linha nasce antes do job entrar na fila: se o Redis estiver fora do
 * ar, a tentativa fica registrada como falha visível em vez de sumir sem
 * deixar rastro.
 */
export async function createQueuedExecution(
  db: Database,
  input: {
    automationId: string;
    triggerPayload: unknown;
    isManual?: boolean;
  },
): Promise<{ id: string }> {
  const [created] = await db
    .insert(executions)
    .values({
      automationId: input.automationId,
      status: 'queued',
      triggerPayload: input.triggerPayload,
      isManual: input.isManual ?? false,
    })
    .returning({ id: executions.id });

  if (!created) throw new ExecutionError('Falha ao registrar execução', 'INSERT_FAILED', 500);
  return created;
}

export async function markExecutionFailed(
  db: Database,
  id: string,
  error: { message: string; code: string },
): Promise<void> {
  const now = new Date();
  await db
    .update(executions)
    .set({ status: 'error', error, finishedAt: now, durationMs: 0 })
    .where(eq(executions.id, id));
}

/** Remove execuções antigas. Chamado periodicamente pelo worker. */
export async function pruneExecutions(db: Database, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(executions)
    .where(lt(executions.createdAt, cutoff))
    .returning({ id: executions.id });
  return deleted.length;
}
