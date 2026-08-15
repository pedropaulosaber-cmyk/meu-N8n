import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { registry } from '@orbita/engine';
import type { Database } from '../db/client.js';
import { automations } from '../db/schema.js';
import { createQueuedExecution, markExecutionFailed } from '../services/executions.js';
import { loadSecrets } from '../services/credentials.js';
import type { ExecutionJobData } from '../queue/index.js';
import type { Env } from '../env.js';

interface Deps {
  db: Database;
  env: Env;
  queue: Queue<ExecutionJobData>;
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Endpoint público de webhook
 * ─────────────────────────────────────────────────────────────────────
 *
 * É a única rota da plataforma exposta sem autenticação de sessão — por
 * definição, já que quem chama é um sistema externo. As defesas são:
 *
 *  1. Token de 32 bytes na URL, inadivinhável na prática
 *  2. Assinatura HMAC quando o gatilho está configurado para exigir
 *  3. Rate limit por token, para uma URL vazada não virar canal de abuso
 *  4. Limite de tamanho de corpo (1 MiB, no server.ts)
 *  5. Resposta 202 imediata: nada de trabalho pesado no ciclo da requisição
 */
export async function webhookRoutes(
  app: FastifyInstance,
  { db, env, queue }: Deps,
): Promise<void> {
  /**
   * Guarda o corpo cru antes de parsear.
   *
   * A verificação HMAC precisa dos bytes exatos que o remetente assinou —
   * reserializar o JSON muda espaços e ordem de chaves e o hash não bate.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      (req as { rawBody?: Buffer }).rawBody = body;
      if (body.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch {
        done(new Error('Corpo não é JSON válido'), undefined);
      }
    },
  );

  app.all<{ Params: { token: string } }>(
    '/:token',
    {
      config: {
        // Por token, não por IP: um serviço legítimo pode chamar de vários
        // IPs, e uma URL vazada precisa ser contida no próprio token.
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request) => (request.params as { token: string }).token,
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params;

      const [automation] = await db
        .select()
        .from(automations)
        .where(eq(automations.webhookToken, token))
        .limit(1);

      // 404 genérico para token inexistente: não confirmamos se um token
      // "quase certo" existe.
      if (!automation) {
        return reply.code(404).send({ error: 'Webhook não encontrado' });
      }

      const trigger = registry.getTrigger(automation.triggerType);
      if (!trigger || trigger.activation !== 'webhook') {
        return reply
          .code(400)
          .send({ error: 'Esta automação não é acionada por webhook' });
      }

      if (automation.status !== 'active') {
        // 200 e não erro: um serviço externo que recebe erro costuma
        // reenviar em loop. Pausar a automação não deve gerar avalanche.
        return reply
          .code(200)
          .send({ accepted: false, reason: 'Automação inativa' });
      }

      const config = automation.triggerConfig;
      const method = String(config.method ?? 'POST');
      if (method !== 'ANY' && request.method !== method) {
        return reply
          .code(405)
          .send({ error: `Esta automação aceita apenas ${method}` });
      }

      // ── Verificação de assinatura ───────────────────────────────────
      if (trigger.verifyRequest) {
        let credentials: Record<string, string> | null = null;

        if (config.requireSignature === true) {
          const [withCredential] = await db
            .select({ credentialId: automations.id })
            .from(automations)
            .where(eq(automations.id, automation.id))
            .limit(1);
          void withCredential;

          // O segredo de assinatura fica na credencial do próprio gatilho.
          // Convenção: a primeira credencial cadastrada para o módulo.
          try {
            const credentialId = String(config.credentialId ?? '');
            if (credentialId) {
              credentials = await loadSecrets(db, credentialId, env.ENCRYPTION_KEY);
            }
          } catch {
            credentials = null;
          }
        }

        const verdict = trigger.verifyRequest({
          rawBody: (request as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
          headers: request.headers as Record<string, string>,
          config,
          credentials,
        });

        if (!verdict.ok) {
          request.log.warn(
            { automationId: automation.id, reason: verdict.reason },
            'webhook rejeitado na verificação de assinatura',
          );
          return reply.code(401).send({ error: 'Assinatura inválida' });
        }
      }

      // ── Registra e enfileira ────────────────────────────────────────
      const payload = {
        type: automation.triggerType,
        body: request.body ?? {},
        headers: pickSafeHeaders(request.headers as Record<string, unknown>),
        query: request.query as Record<string, string>,
        receivedAt: new Date().toISOString(),
      };

      const execution = await createQueuedExecution(db, {
        automationId: automation.id,
        triggerPayload: payload,
      });

      try {
        await queue.add(
          'execute',
          { executionId: execution.id, automationId: automation.id },
          { jobId: execution.id },
        );
      } catch (err) {
        // Fila fora do ar: a execução já existe no banco e vira falha
        // visível no histórico, em vez de o disparo sumir sem rastro.
        request.log.error({ err, executionId: execution.id }, 'falha ao enfileirar');
        await markExecutionFailed(db, execution.id, {
          message: 'Não foi possível enfileirar a execução. A fila está indisponível.',
          code: 'QUEUE_UNAVAILABLE',
        });
        return reply.code(503).send({ error: 'Serviço temporariamente indisponível' });
      }

      // 202 imediato: o trabalho acontece no worker. Segurar a resposta
      // até a IA responder faria o chamador estourar timeout.
      return reply.code(202).send({
        accepted: true,
        executionId: execution.id,
      });
    },
  );
}

/**
 * Só os headers úteis para a automação.
 *
 * Guardar o conjunto inteiro colocaria authorization e cookie no
 * histórico. O mascarador pegaria pelo nome, mas não gravar é melhor
 * do que gravar mascarado.
 */
const SAFE_HEADERS = new Set([
  'content-type',
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
  'x-origem',
  'x-event-type',
  'x-request-id',
]);

function pickSafeHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SAFE_HEADERS.has(key.toLowerCase())) out[key.toLowerCase()] = String(value);
  }
  return out;
}
