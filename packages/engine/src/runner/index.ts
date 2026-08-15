import type { ExecutionError, StepStatus } from '@orbita/shared';
import {
  ActionError,
  type Logger,
  type StepResult,
  type TriggerPayload,
} from '../registry/types.js';
import type { Registry } from '../registry/index.js';
import { fieldsToZod } from '../registry/fields.js';
import { resolveConfig } from '../context/resolve.js';
import { maskSensitive, createMaskedLogger } from '../security/mask.js';

/** Uma ação configurada, como vem do banco. */
export interface PlannedAction {
  id: string;
  position: number;
  actionType: string;
  config: Record<string, unknown>;
  /** Segredos já decifrados pelo worker. Null quando a ação não usa credencial. */
  credentials: Record<string, string> | null;
  onError: 'stop' | 'continue';
  retries: number;
  timeoutMs: number;
}

export interface StepOutcome {
  automationActionId: string;
  position: number;
  actionType: string;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: ExecutionError | null;
  attempt: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

export interface RunOutcome {
  status: 'success' | 'error';
  steps: StepOutcome[];
  /** Saída da última ação bem-sucedida — o "resultado" da automação. */
  result: unknown;
  error: ExecutionError | null;
}

export interface RunOptions {
  registry: Registry;
  trigger: TriggerPayload;
  actions: PlannedAction[];
  logger: Logger;
  /** Chamado a cada passo concluído, para o painel acompanhar em tempo real. */
  onStepComplete?: (step: StepOutcome) => Promise<void>;
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Executor da sequência de ações
 * ─────────────────────────────────────────────────────────────────────
 *
 * Garantias que este código oferece, todas exigidas no escopo da fase:
 *
 *  • Cada ação roda isolada. Exceção em uma nunca derruba o worker nem
 *    interrompe o registro do histórico.
 *  • Timeout por ação, com AbortSignal repassado às chamadas de rede.
 *  • Retentativa com backoff exponencial, mas SÓ para erro marcado como
 *    retryable — repetir credencial inválida só queima tempo e cota.
 *  • Todo input e output é mascarado antes de virar histórico.
 *  • O resultado de uma ação fica acessível às seguintes via {{ steps.N }}.
 */
export async function runActions(options: RunOptions): Promise<RunOutcome> {
  const { registry, trigger, actions, logger, onStepComplete } = options;

  const steps: StepOutcome[] = [];
  const completed: StepResult[] = [];
  let lastOutput: unknown = null;
  let fatalError: ExecutionError | null = null;

  // Todos os segredos desta execução, para o mascarador reconhecê-los
  // onde quer que apareçam — inclusive dentro de mensagem de erro de API.
  const allSecrets = actions.flatMap((a) =>
    a.credentials ? Object.values(a.credentials) : [],
  );

  const ordered = [...actions].sort((a, b) => a.position - b.position);

  for (const action of ordered) {
    const startedAt = new Date();
    const definition = registry.getAction(action.actionType);

    if (!definition) {
      const error: ExecutionError = {
        message: `Ação "${action.actionType}" não está registrada. A integração foi removida?`,
        code: 'ACTION_NOT_FOUND',
        source: action.actionType,
      };
      const outcome = buildOutcome(action, 'error', null, null, error, 1, startedAt);
      steps.push(outcome);
      await onStepComplete?.(outcome);

      fatalError = error;
      break;
    }

    // Resolve {{ }} contra o gatilho e os passos já concluídos.
    let resolvedConfig: Record<string, unknown>;
    try {
      resolvedConfig = resolveConfig(action.config, { trigger, steps: completed });
    } catch (err) {
      const error: ExecutionError = {
        message: `Falha ao resolver variáveis: ${err instanceof Error ? err.message : String(err)}`,
        code: 'TEMPLATE_RESOLUTION_FAILED',
        source: action.actionType,
      };
      const outcome = buildOutcome(action, 'error', null, null, error, 1, startedAt);
      steps.push(outcome);
      await onStepComplete?.(outcome);
      if (action.onError === 'stop') {
        fatalError = error;
        break;
      }
      continue;
    }

    // Valida contra os campos declarados pelo módulo.
    const schema = fieldsToZod(definition.configFields ?? []);
    const parsed = schema.safeParse(resolvedConfig);
    if (!parsed.success) {
      const error: ExecutionError = {
        message: `Configuração inválida: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        code: 'INVALID_CONFIG',
        source: action.actionType,
      };
      const outcome = buildOutcome(
        action,
        'error',
        maskSensitive(resolvedConfig, { secretValues: allSecrets }),
        null,
        error,
        1,
        startedAt,
      );
      steps.push(outcome);
      await onStepComplete?.(outcome);
      if (action.onError === 'stop') {
        fatalError = error;
        break;
      }
      continue;
    }

    const maskedInput = maskSensitive(parsed.data, { secretValues: allSecrets });
    const stepLogger = createMaskedLogger(logger, { secretValues: allSecrets });

    const attemptResult = await runWithRetries({
      action,
      definition,
      config: parsed.data as Record<string, unknown>,
      trigger,
      completed,
      registry,
      logger: stepLogger,
    });

    const finishedAt = new Date();

    if (attemptResult.ok) {
      const output = maskSensitive(attemptResult.output, { secretValues: allSecrets });
      const outcome: StepOutcome = {
        automationActionId: action.id,
        position: action.position,
        actionType: action.actionType,
        status: 'success',
        input: maskedInput,
        output,
        error: null,
        attempt: attemptResult.attempt,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
      steps.push(outcome);
      await onStepComplete?.(outcome);

      completed.push({
        position: action.position,
        actionType: action.actionType,
        output: attemptResult.output,
      });
      lastOutput = attemptResult.output;
      continue;
    }

    // Falhou depois de esgotar as retentativas.
    const outcome: StepOutcome = {
      automationActionId: action.id,
      position: action.position,
      actionType: action.actionType,
      status: 'error',
      input: maskedInput,
      output: null,
      error: attemptResult.error,
      attempt: attemptResult.attempt,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
    steps.push(outcome);
    await onStepComplete?.(outcome);

    if (action.onError === 'stop') {
      fatalError = attemptResult.error;
      break;
    }

    // on_error = 'continue': segue para a próxima ação. O passo seguinte
    // enxerga steps sem esta entrada, então {{ steps.N }} pode vir vazio —
    // por isso o resolvedor devolve undefined em vez de lançar.
    logger.warn(
      { position: action.position, code: attemptResult.error.code },
      'ação falhou; seguindo por on_error=continue',
    );
  }

  // Ações puladas por parada antecipada entram no histórico como 'skipped',
  // para o painel mostrar exatamente onde a automação parou.
  const executedPositions = new Set(steps.map((s) => s.position));
  if (fatalError) {
    for (const action of ordered) {
      if (executedPositions.has(action.position)) continue;
      const now = new Date();
      steps.push({
        automationActionId: action.id,
        position: action.position,
        actionType: action.actionType,
        status: 'skipped',
        input: null,
        output: null,
        error: null,
        attempt: 0,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
      });
    }
  }

  return {
    status: fatalError ? 'error' : 'success',
    steps: steps.sort((a, b) => a.position - b.position),
    result: maskSensitive(lastOutput, { secretValues: allSecrets }),
    error: fatalError,
  };
}

interface AttemptSuccess {
  ok: true;
  output: unknown;
  attempt: number;
}
interface AttemptFailure {
  ok: false;
  error: ExecutionError;
  attempt: number;
}

async function runWithRetries(params: {
  action: PlannedAction;
  definition: { run(ctx: never): Promise<unknown> };
  config: Record<string, unknown>;
  trigger: TriggerPayload;
  completed: StepResult[];
  registry: Registry;
  logger: Logger;
}): Promise<AttemptSuccess | AttemptFailure> {
  const { action, definition, config, trigger, completed, registry, logger } = params;

  const maxAttempts = action.retries + 1;
  let lastError: ExecutionError = {
    message: 'Ação não executou',
    code: 'UNKNOWN',
    source: action.actionType,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), action.timeoutMs);

    try {
      const ctx = {
        config,
        credentials: action.credentials,
        trigger,
        steps: completed,
        logger,
        signal: controller.signal,
        providers: registry.providerLookup,
      };

      const output = await definition.run(ctx as never);
      clearTimeout(timer);
      return { ok: true, output, attempt };
    } catch (err) {
      clearTimeout(timer);

      // Timeout chega como AbortError; traduzimos para erro nosso, com
      // o valor configurado, para o histórico ficar autoexplicativo.
      const isAbort =
        controller.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError');

      const { error, retryable } = normalizeError(err, action, isAbort);
      lastError = error;

      const hasAttemptsLeft = attempt < maxAttempts;
      if (!retryable || !hasAttemptsLeft) {
        return { ok: false, error, attempt };
      }

      // Backoff exponencial: 500ms, 1s, 2s, 4s... Dá tempo de um 429 ou
      // uma instabilidade momentânea passar, sem martelar o serviço.
      const delay = Math.min(500 * 2 ** (attempt - 1), 10_000);
      logger.warn(
        { position: action.position, attempt, delay, code: error.code },
        'ação falhou; tentando de novo',
      );
      await sleep(delay);
    }
  }

  return { ok: false, error: lastError, attempt: maxAttempts };
}

function normalizeError(
  err: unknown,
  action: PlannedAction,
  isAbort: boolean,
): { error: ExecutionError; retryable: boolean } {
  if (isAbort) {
    return {
      error: {
        message: `A ação passou de ${action.timeoutMs}ms e foi interrompida`,
        code: 'ACTION_TIMEOUT',
        source: action.actionType,
        details: { timeoutMs: action.timeoutMs },
      },
      retryable: true,
    };
  }

  if (err instanceof ActionError) {
    return {
      error: {
        message: err.message,
        code: err.code,
        source: action.actionType,
        details: err.details,
      },
      retryable: err.retryable,
    };
  }

  // Erro inesperado do módulo: registramos, mas não repetimos — um bug
  // determinístico vai falhar igual nas próximas tentativas.
  return {
    error: {
      message: err instanceof Error ? err.message : String(err),
      code: 'ACTION_UNEXPECTED_ERROR',
      source: action.actionType,
    },
    retryable: false,
  };
}

function buildOutcome(
  action: PlannedAction,
  status: StepStatus,
  input: unknown,
  output: unknown,
  error: ExecutionError | null,
  attempt: number,
  startedAt: Date,
): StepOutcome {
  const finishedAt = new Date();
  return {
    automationActionId: action.id,
    position: action.position,
    actionType: action.actionType,
    status,
    input,
    output,
    error,
    attempt,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
