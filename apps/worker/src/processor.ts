import { eq } from 'drizzle-orm';
import { registry, runActions, type PlannedAction } from '@orbita/engine';
import type { Database } from '@orbita/api/src/db/client.js';
import {
  automationActions,
  automations,
  executionSteps,
  executions,
} from '@orbita/api/src/db/schema.js';
import { loadSecrets } from '@orbita/api/src/services/credentials.js';
import type { Logger } from './logger.js';

export interface ProcessDeps {
  db: Database;
  encryptionKey: string;
  logger: Logger;
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Processamento de uma execução
 * ─────────────────────────────────────────────────────────────────────
 *
 * Fluxo: carrega a automação → decifra as credenciais necessárias →
 * chama o runner → grava histórico.
 *
 * Este arquivo nunca lança para o BullMQ em caso de falha de NEGÓCIO
 * (ação que deu erro, credencial inválida). Falha de negócio é resultado
 * legítimo: fica registrada no histórico com status 'error' e o job é
 * considerado concluído. Só falha de INFRAESTRUTURA (banco fora do ar)
 * propaga, porque aí a retentativa do BullMQ faz sentido.
 */
export async function processExecution(
  executionId: string,
  { db, encryptionKey, logger }: ProcessDeps,
): Promise<void> {
  const startedAt = new Date();

  const [execution] = await db
    .select()
    .from(executions)
    .where(eq(executions.id, executionId))
    .limit(1);

  if (!execution) {
    logger.warn({ executionId }, 'execução não encontrada; job descartado');
    return;
  }

  await db
    .update(executions)
    .set({ status: 'running', startedAt })
    .where(eq(executions.id, executionId));

  const [automation] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, execution.automationId))
    .limit(1);

  if (!automation) {
    await finishExecution(db, executionId, startedAt, 'error', null, {
      message: 'A automação foi removida antes da execução',
      code: 'AUTOMATION_DELETED',
    });
    return;
  }

  const actionRows = await db
    .select()
    .from(automationActions)
    .where(eq(automationActions.automationId, automation.id));

  if (actionRows.length === 0) {
    await finishExecution(db, executionId, startedAt, 'error', null, {
      message: 'A automação não tem nenhuma ação configurada',
      code: 'NO_ACTIONS',
    });
    return;
  }

  // ── Decifra as credenciais ────────────────────────────────────────
  // Feito uma vez por execução, e não por ação, para não repetir trabalho
  // criptográfico quando várias ações usam a mesma credencial.
  const secretsCache = new Map<string, Record<string, string> | null>();

  const planned: PlannedAction[] = [];
  for (const row of actionRows) {
    let credentials: Record<string, string> | null = null;

    if (row.credentialId) {
      if (secretsCache.has(row.credentialId)) {
        credentials = secretsCache.get(row.credentialId) ?? null;
      } else {
        try {
          credentials = await loadSecrets(db, row.credentialId, encryptionKey);
        } catch (err) {
          // Não aborta a execução inteira: o runner vai reportar
          // CREDENTIAL_REQUIRED naquela ação específica, que é bem mais
          // diagnosticável do que uma falha global sem indicar onde.
          logger.error(
            { credentialId: row.credentialId, err },
            'falha ao decifrar credencial',
          );
          credentials = null;
        }
        secretsCache.set(row.credentialId, credentials);
      }
    }

    planned.push({
      id: row.id,
      position: row.position,
      actionType: row.actionType,
      config: row.config,
      credentials,
      onError: row.onError,
      retries: row.retries,
      timeoutMs: row.timeoutMs,
    });
  }

  const triggerPayload = execution.triggerPayload as {
    type: string;
    body: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    receivedAt: string;
  };

  // ── Executa ───────────────────────────────────────────────────────
  const outcome = await runActions({
    registry,
    trigger: triggerPayload,
    actions: planned,
    logger: logger.child({ executionId, automationId: automation.id }),
    // Grava cada passo assim que termina, para o painel poder acompanhar
    // uma execução longa em andamento em vez de só ver o resultado final.
    onStepComplete: async (step) => {
      await db.insert(executionSteps).values({
        executionId,
        automationActionId: step.automationActionId,
        position: step.position,
        actionType: step.actionType,
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error,
        attempt: step.attempt,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
        durationMs: step.durationMs,
      });
    },
  });

  await finishExecution(
    db,
    executionId,
    startedAt,
    outcome.status,
    outcome.result,
    outcome.error,
  );

  await db
    .update(automations)
    .set({ lastRunAt: new Date(), lastRunStatus: outcome.status })
    .where(eq(automations.id, automation.id));

  logger.info(
    {
      executionId,
      automationId: automation.id,
      status: outcome.status,
      steps: outcome.steps.length,
    },
    'execução concluída',
  );
}

async function finishExecution(
  db: Database,
  executionId: string,
  startedAt: Date,
  status: 'success' | 'error',
  result: unknown,
  error: { message: string; code?: string } | null,
): Promise<void> {
  const finishedAt = new Date();
  await db
    .update(executions)
    .set({
      status,
      result,
      error,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    })
    .where(eq(executions.id, executionId));
}
