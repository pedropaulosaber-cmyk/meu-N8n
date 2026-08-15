import { Worker } from 'bullmq';
import { loadEnv } from '@orbita/api/src/env.js';
import { createDb } from '@orbita/api/src/db/client.js';
import {
  EXECUTION_QUEUE,
  createRedis,
  type ExecutionJobData,
} from '@orbita/api/src/queue/index.js';
import { pruneExecutions } from '@orbita/api/src/services/executions.js';
import { pruneRefreshTokens } from '@orbita/api/src/auth/tokens.js';
import { processExecution } from './processor.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const { db, close: closeDb } = createDb(env.DATABASE_URL);
  const connection = createRedis(env.REDIS_URL);

  const worker = new Worker<ExecutionJobData>(
    EXECUTION_QUEUE,
    async (job) => {
      await processExecution(job.data.executionId, {
        db,
        encryptionKey: env.ENCRYPTION_KEY,
        logger,
      });
    },
    {
      connection,
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    // Só chega aqui falha de infraestrutura: erro de negócio vira status
    // 'error' no histórico e é considerado job concluído.
    logger.error(
      { jobId: job?.id, executionId: job?.data.executionId, err: err.message },
      'job falhou por erro de infraestrutura',
    );
  });

  worker.on('ready', () => {
    logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker pronto');
  });

  /**
   * Manutenção periódica: poda o histórico e os refresh tokens vencidos.
   * De hora em hora — não precisa de precisão, só não pode deixar crescer
   * para sempre.
   */
  const maintenance = setInterval(
    () => {
      void (async () => {
        try {
          const execucoes = await pruneExecutions(db, env.EXECUTION_RETENTION_DAYS);
          const tokens = await pruneRefreshTokens(db);
          if (execucoes > 0 || tokens > 0) {
            logger.info({ execucoes, tokens }, 'manutenção: registros removidos');
          }
        } catch (err) {
          logger.error({ err }, 'falha na manutenção periódica');
        }
      })();
    },
    60 * 60 * 1000,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'encerrando worker...');
    clearInterval(maintenance);
    // close(false) espera os jobs em andamento terminarem, para não
    // deixar execução pela metade sem registro no histórico.
    await worker.close(false);
    connection.disconnect();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Falha ao subir o worker:', err);
  process.exit(1);
});
