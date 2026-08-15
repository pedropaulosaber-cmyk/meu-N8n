import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import {
  createAutomationSchema,
  updateAutomationSchema,
  listAutomationsQuerySchema,
  createCredentialSchema,
  updateCredentialSchema,
  listExecutionsQuerySchema,
  manualRunSchema,
  paginationSchema,
} from '@orbita/shared';
import { registry, buildCatalog, resolveDynamicOptions } from '@orbita/engine';
import type { Database } from '../db/client.js';
import { credentials as credentialsTable, automations } from '../db/schema.js';
import { requireAuth } from '../auth/middleware.js';
import * as automationService from '../services/automations.js';
import * as credentialService from '../services/credentials.js';
import * as executionService from '../services/executions.js';
import type { ExecutionJobData } from '../queue/index.js';
import type { Env } from '../env.js';

interface Deps {
  db: Database;
  env: Env;
  queue: Queue<ExecutionJobData>;
}

export async function adminRoutes(
  app: FastifyInstance,
  { db, env, queue }: Deps,
): Promise<void> {
  // Todas as rotas deste plugin exigem autenticação. Um preHandler no
  // escopo garante que uma rota nova nasça protegida por padrão, em vez
  // de depender de alguém lembrar de adicionar o guard.
  app.addHook('preHandler', requireAuth({ db, jwtSecret: env.JWT_SECRET }));

  // ── Integrações ───────────────────────────────────────────────────
  /**
   * Catálogo da aba Integrações.
   *
   * Derivado inteiramente do registry: registrar um módulo novo faz ele
   * aparecer aqui sem tocar nesta rota nem no painel.
   */
  app.get('/integrations', async () => {
    const credentialCounts = await db
      .select({
        integrationId: credentialsTable.integrationId,
        total: sql<number>`count(*)::int`,
      })
      .from(credentialsTable)
      .groupBy(credentialsTable.integrationId);

    const credentialsByIntegration: Record<string, number> = {};
    for (const row of credentialCounts) {
      credentialsByIntegration[row.integrationId] = row.total;
    }

    const activeAutomationsByIntegration =
      await automationService.countActiveByIntegration(db);

    return {
      items: buildCatalog(registry, {
        credentialsByIntegration,
        activeAutomationsByIntegration,
      }),
    };
  });

  /** Opções de select dinâmico, ex: modelos do provedor escolhido. */
  app.post<{ Body: { dependsOn?: string; config?: Record<string, unknown> } }>(
    '/integrations/options',
    async (request) => {
      const { dependsOn = '', config = {} } = request.body ?? {};
      return { options: resolveDynamicOptions(registry, dependsOn, config) };
    },
  );

  // ── Credenciais ───────────────────────────────────────────────────
  app.get('/credentials', async () => ({
    items: await credentialService.listCredentials(db),
  }));

  app.post('/credentials', async (request, reply) => {
    const parsed = createCredentialSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Dados inválidos',
        code: 'BAD_REQUEST',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    try {
      const created = await credentialService.createCredential(
        db,
        parsed.data,
        env.ENCRYPTION_KEY,
      );
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof credentialService.CredentialError) {
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/credentials/:id', async (request, reply) => {
    const parsed = updateCredentialSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos', code: 'BAD_REQUEST' });
    }

    try {
      return await credentialService.updateCredential(
        db,
        request.params.id,
        parsed.data,
        env.ENCRYPTION_KEY,
      );
    } catch (err) {
      if (err instanceof credentialService.CredentialError) {
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/credentials/:id', async (request, reply) => {
    try {
      await credentialService.deleteCredential(db, request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof credentialService.CredentialError) {
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // ── Automações ────────────────────────────────────────────────────
  app.get('/automations', async (request) => {
    const query = listAutomationsQuerySchema.parse(request.query);
    return {
      items: await automationService.listAutomations(db, query, env.PUBLIC_API_URL),
    };
  });

  app.get<{ Params: { id: string } }>('/automations/:id', async (request, reply) => {
    try {
      return await automationService.getAutomation(db, request.params.id, env.PUBLIC_API_URL);
    } catch (err) {
      if (err instanceof automationService.AutomationError) {
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.post('/automations', async (request, reply) => {
    const parsed = createAutomationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Dados inválidos',
        code: 'BAD_REQUEST',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    try {
      const created = await automationService.createAutomation(
        db,
        parsed.data,
        env.PUBLIC_API_URL,
      );
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof automationService.AutomationError) {
        return reply
          .code(err.statusCode)
          .send({ error: err.message, code: err.code, issues: err.issues });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/automations/:id', async (request, reply) => {
    const parsed = updateAutomationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos', code: 'BAD_REQUEST' });
    }

    try {
      return await automationService.updateAutomation(
        db,
        request.params.id,
        parsed.data,
        env.PUBLIC_API_URL,
      );
    } catch (err) {
      if (err instanceof automationService.AutomationError) {
        return reply
          .code(err.statusCode)
          .send({ error: err.message, code: err.code, issues: err.issues });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/automations/:id', async (request, reply) => {
    try {
      await automationService.deleteAutomation(db, request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof automationService.AutomationError) {
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  /** Gera uma URL de webhook nova, invalidando a anterior. */
  app.post<{ Params: { id: string } }>(
    '/automations/:id/rotate-webhook',
    async (request, reply) => {
      try {
        return await automationService.rotateWebhookToken(
          db,
          request.params.id,
          env.PUBLIC_API_URL,
        );
      } catch (err) {
        if (err instanceof automationService.AutomationError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  /** Disparo manual — o "Testar agora" do painel. Roda mesmo se inativa. */
  app.post<{ Params: { id: string } }>('/automations/:id/run', async (request, reply) => {
    const parsed = manualRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Payload inválido', code: 'BAD_REQUEST' });
    }

    const [automation] = await db
      .select()
      .from(automations)
      .where(eq(automations.id, request.params.id))
      .limit(1);

    if (!automation) {
      return reply.code(404).send({ error: 'Automação não encontrada', code: 'NOT_FOUND' });
    }

    const execution = await executionService.createQueuedExecution(db, {
      automationId: automation.id,
      triggerPayload: {
        type: automation.triggerType,
        body: parsed.data.payload,
        receivedAt: new Date().toISOString(),
      },
      isManual: true,
    });

    try {
      await queue.add(
        'execute',
        { executionId: execution.id, automationId: automation.id },
        { jobId: execution.id },
      );
    } catch (err) {
      request.log.error({ err }, 'falha ao enfileirar disparo manual');
      await executionService.markExecutionFailed(db, execution.id, {
        message: 'Fila indisponível',
        code: 'QUEUE_UNAVAILABLE',
      });
      return reply.code(503).send({ error: 'Fila indisponível', code: 'QUEUE_UNAVAILABLE' });
    }

    return reply.code(202).send({ executionId: execution.id });
  });

  // ── Execuções ─────────────────────────────────────────────────────
  app.get('/executions', async (request) => {
    const query = listExecutionsQuerySchema.parse(request.query);
    const pagination = paginationSchema.parse(request.query);
    return executionService.listExecutions(db, query, pagination);
  });

  app.get<{ Params: { id: string } }>('/executions/:id', async (request, reply) => {
    try {
      return await executionService.getExecution(db, request.params.id);
    } catch (err) {
      if (err instanceof executionService.ExecutionError) {
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // ── Painel ────────────────────────────────────────────────────────
  /** Métricas do topo da tela de automações. */
  app.get('/stats', async () => {
    const [automationStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        ativas: sql<number>`count(*) filter (where ${automations.status} = 'active')::int`,
      })
      .from(automations);

    const executionStats = await db.execute<{
      total_24h: number;
      erros_24h: number;
      duracao_media: number | null;
    }>(sql`
      select
        count(*)::int as total_24h,
        count(*) filter (where status = 'error')::int as erros_24h,
        avg(duration_ms)::int as duracao_media
      from executions
      where created_at > now() - interval '24 hours'
    `);

    const row = executionStats[0];
    const total24h = row?.total_24h ?? 0;
    const erros24h = row?.erros_24h ?? 0;

    return {
      automations: {
        total: automationStats?.total ?? 0,
        active: automationStats?.ativas ?? 0,
      },
      executions24h: {
        total: total24h,
        errors: erros24h,
        successRate: total24h > 0 ? Math.round(((total24h - erros24h) / total24h) * 100) : 100,
        avgDurationMs: row?.duracao_media ?? 0,
      },
    };
  });
}
