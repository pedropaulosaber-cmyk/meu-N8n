import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const EXECUTION_QUEUE = 'orbita-executions';

/** Payload enfileirado. Só identificadores — o worker recarrega do banco. */
export interface ExecutionJobData {
  executionId: string;
  automationId: string;
}

/**
 * O job carrega apenas ids, nunca a credencial nem o payload completo.
 *
 * Dois motivos: o Redis não persiste segredo em disco por tabela de job,
 * e o worker sempre trabalha com o estado atual da automação em vez de
 * uma cópia congelada no momento do enfileiramento.
 */
export function createRedis(url: string): IORedis {
  return new IORedis(url, {
    // Exigido pelo BullMQ: sem isto, um comando bloqueante pode ser
    // abortado no meio e o job fica preso em estado indefinido.
    maxRetriesPerRequest: null,
  });
}

export function createExecutionQueue(connection: IORedis): Queue<ExecutionJobData> {
  return new Queue<ExecutionJobData>(EXECUTION_QUEUE, {
    connection,
    defaultJobOptions: {
      // As retentativas por ação são do runner, que sabe distinguir erro
      // repetível de erro definitivo. Aqui a retentativa é só para falha
      // de infraestrutura (worker morto no meio do job).
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}
