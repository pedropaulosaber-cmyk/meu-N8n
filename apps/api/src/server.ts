import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createDb, type Database } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { webhookRoutes } from './routes/webhooks.js';
import { createExecutionQueue, createRedis } from './queue/index.js';
import type { Env } from './env.js';

export interface BuildServerOptions {
  env: Env;
  /** Injetável para os testes usarem um banco próprio. */
  db?: Database;
}

export async function buildServer({
  env,
  db: injectedDb,
}: BuildServerOptions): Promise<{ app: FastifyInstance; db: Database; close: () => Promise<void> }> {
  const owned = injectedDb ? null : createDb(env.DATABASE_URL);
  const db = injectedDb ?? owned!.db;

  const redis = createRedis(env.REDIS_URL);
  const queue = createExecutionQueue(redis);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Nenhum header de autenticação vai para o log. `authorization`
      // carrega o access token e `cookie` pode carregar sessão.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-hub-signature-256"]',
        ],
        remove: true,
      },
    },
    // Confia no proxy reverso (Caddy) para ler o IP real do cliente,
    // sem o qual o rate limit por IP limitaria o proxy inteiro como um só.
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 1_048_576, // 1 MiB — payload de webhook não precisa de mais
  });

  await app.register(helmet, {
    // A API não serve HTML; CSP restritiva por padrão não atrapalha nada.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } },
  });

  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Limite global. Rotas sensíveis (login) apertam ainda mais no próprio handler.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  await app.register(async (instance) => authRoutes(instance, { db, env }), {
    prefix: '/api/auth',
  });

  await app.register(async (instance) => adminRoutes(instance, { db, env, queue }), {
    prefix: '/api',
  });

  // Rota pública — autenticada por token na URL + HMAC, não por sessão.
  await app.register(async (instance) => webhookRoutes(instance, { db, env, queue }), {
    prefix: '/hooks',
  });

  /**
   * Handler de erro único.
   *
   * Em produção nunca devolvemos a mensagem crua de um erro inesperado:
   * ela pode conter caminho de arquivo, query SQL ou nome de coluna.
   * O log guarda o detalhe completo; o cliente recebe só o id da falha.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      request.log.error({ err: error }, 'erro não tratado');
      return reply.code(status).send({
        error: env.NODE_ENV === 'production' ? 'Erro interno' : error.message,
        code: 'INTERNAL_ERROR',
        requestId: request.id,
      });
    }

    return reply.code(status).send({
      error: error.message,
      code: error.code ?? 'REQUEST_ERROR',
    });
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: 'Rota não encontrada', code: 'NOT_FOUND' });
  });

  return {
    app,
    db,
    close: async () => {
      await app.close();
      await queue.close();
      redis.disconnect();
      if (owned) await owned.close();
    },
  };
}
