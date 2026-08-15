import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type {
  AutomationPublic,
  CreateAutomationInput,
  ListAutomationsQuery,
  UpdateAutomationInput,
} from '@orbita/shared';
import { registry, fieldsToZod } from '@orbita/engine';
import type { Database } from '../db/client.js';
import { automationActions, automations } from '../db/schema.js';
import { generateOpaqueToken } from '../crypto/credentials.js';

export class AutomationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
    readonly issues?: string[],
  ) {
    super(message);
  }
}

/**
 * Valida gatilho e ações contra o que os módulos declaram.
 *
 * Roda na criação e na edição, e não na execução: erro de configuração
 * deve aparecer para quem está montando a automação, não como falha
 * silenciosa três dias depois num disparo real.
 */
function validateDefinition(input: {
  triggerType?: string;
  triggerConfig?: Record<string, unknown>;
  actions?: Array<{ actionType: string; config: Record<string, unknown> }>;
}): void {
  const issues: string[] = [];

  if (input.triggerType !== undefined) {
    const trigger = registry.getTrigger(input.triggerType);
    if (!trigger) {
      issues.push(`Gatilho "${input.triggerType}" não está registrado.`);
    } else {
      const parsed = fieldsToZod(trigger.configFields ?? []).safeParse(
        input.triggerConfig ?? {},
      );
      if (!parsed.success) {
        for (const i of parsed.error.issues) {
          issues.push(`Gatilho: ${i.path.join('.')} ${i.message}`);
        }
      } else if (trigger.refineConfig) {
        issues.push(...trigger.refineConfig(parsed.data as Record<string, unknown>));
      }
    }
  }

  for (const [index, action] of (input.actions ?? []).entries()) {
    const definition = registry.getAction(action.actionType);
    if (!definition) {
      issues.push(`Ação ${index + 1}: "${action.actionType}" não está registrada.`);
      continue;
    }

    // Campo com template só é validável em runtime — aqui aceitamos a
    // string `{{ ... }}` e a validação real acontece após a resolução.
    const parsed = fieldsToZod(definition.configFields ?? []).safeParse(action.config);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push(`Ação ${index + 1} (${definition.name}): ${i.path.join('.')} ${i.message}`);
      }
    } else if (definition.refineConfig) {
      issues.push(
        ...definition
          .refineConfig(parsed.data as Record<string, unknown>)
          .map((p) => `Ação ${index + 1} (${definition.name}): ${p}`),
      );
    }
  }

  if (issues.length > 0) {
    throw new AutomationError(
      'A automação tem erros de configuração',
      'INVALID_DEFINITION',
      400,
      issues,
    );
  }
}

type AutomationRow = typeof automations.$inferSelect;
type ActionRow = typeof automationActions.$inferSelect;

function toPublic(
  row: AutomationRow,
  actions: ActionRow[],
  publicApiUrl: string,
): AutomationPublic {
  const trigger = registry.getTrigger(row.triggerType);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    triggerType: row.triggerType,
    triggerConfig: row.triggerConfig,
    // A URL só faz sentido para gatilho do tipo webhook.
    webhookUrl:
      trigger?.activation === 'webhook'
        ? `${publicApiUrl.replace(/\/$/, '')}/hooks/${row.webhookToken}`
        : null,
    actions: actions
      .sort((a, b) => a.position - b.position)
      .map((a) => ({
        id: a.id,
        position: a.position,
        actionType: a.actionType,
        config: a.config,
        credentialId: a.credentialId,
        onError: a.onError,
        retries: a.retries,
        timeoutMs: a.timeoutMs,
      })),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row.lastRunStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAutomations(
  db: Database,
  query: ListAutomationsQuery,
  publicApiUrl: string,
): Promise<AutomationPublic[]> {
  const filters = [];
  if (query.status) filters.push(eq(automations.status, query.status));
  if (query.triggerType) filters.push(eq(automations.triggerType, query.triggerType));
  if (query.q) {
    filters.push(
      or(ilike(automations.name, `%${query.q}%`), ilike(automations.description, `%${query.q}%`)),
    );
  }

  const rows = await db
    .select()
    .from(automations)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(automations.createdAt));

  if (rows.length === 0) return [];

  const allActions = await db.select().from(automationActions);
  const byAutomation = new Map<string, ActionRow[]>();
  for (const action of allActions) {
    const list = byAutomation.get(action.automationId) ?? [];
    list.push(action);
    byAutomation.set(action.automationId, list);
  }

  return rows.map((row) => toPublic(row, byAutomation.get(row.id) ?? [], publicApiUrl));
}

export async function getAutomation(
  db: Database,
  id: string,
  publicApiUrl: string,
): Promise<AutomationPublic> {
  const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
  if (!row) throw new AutomationError('Automação não encontrada', 'NOT_FOUND', 404);

  const actions = await db
    .select()
    .from(automationActions)
    .where(eq(automationActions.automationId, id));

  return toPublic(row, actions, publicApiUrl);
}

export async function createAutomation(
  db: Database,
  input: CreateAutomationInput,
  publicApiUrl: string,
): Promise<AutomationPublic> {
  validateDefinition(input);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(automations)
      .values({
        name: input.name,
        description: input.description,
        status: input.status,
        triggerType: input.triggerType,
        triggerConfig: input.triggerConfig,
        webhookToken: generateOpaqueToken(32),
      })
      .returning();

    if (!created) throw new AutomationError('Falha ao criar', 'INSERT_FAILED', 500);

    if (input.actions.length > 0) {
      await tx.insert(automationActions).values(
        input.actions.map((action, index) => ({
          automationId: created.id,
          position: index,
          actionType: action.actionType,
          config: action.config,
          credentialId: action.credentialId,
          onError: action.onError,
          retries: action.retries,
          timeoutMs: action.timeoutMs,
        })),
      );
    }

    const actions = await tx
      .select()
      .from(automationActions)
      .where(eq(automationActions.automationId, created.id));

    return toPublic(created, actions, publicApiUrl);
  });
}

export async function updateAutomation(
  db: Database,
  id: string,
  input: UpdateAutomationInput,
  publicApiUrl: string,
): Promise<AutomationPublic> {
  const [existing] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
  if (!existing) throw new AutomationError('Automação não encontrada', 'NOT_FOUND', 404);

  validateDefinition({
    triggerType: input.triggerType ?? existing.triggerType,
    triggerConfig: input.triggerConfig ?? existing.triggerConfig,
    ...(input.actions !== undefined && { actions: input.actions }),
  });

  return db.transaction(async (tx) => {
    await tx
      .update(automations)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.triggerType !== undefined && { triggerType: input.triggerType }),
        ...(input.triggerConfig !== undefined && { triggerConfig: input.triggerConfig }),
        updatedAt: new Date(),
      })
      .where(eq(automations.id, id));

    // Ações são substituídas em bloco: reordenar e remover no mesmo
    // request fica muito mais simples do que reconciliar item a item, e
    // o histórico já guarda o actionType de cada execução passada.
    if (input.actions !== undefined) {
      await tx.delete(automationActions).where(eq(automationActions.automationId, id));
      if (input.actions.length > 0) {
        await tx.insert(automationActions).values(
          input.actions.map((action, index) => ({
            automationId: id,
            position: index,
            actionType: action.actionType,
            config: action.config,
            credentialId: action.credentialId,
            onError: action.onError,
            retries: action.retries,
            timeoutMs: action.timeoutMs,
          })),
        );
      }
    }

    const [updated] = await tx.select().from(automations).where(eq(automations.id, id)).limit(1);
    const actions = await tx
      .select()
      .from(automationActions)
      .where(eq(automationActions.automationId, id));

    return toPublic(updated!, actions, publicApiUrl);
  });
}

export async function deleteAutomation(db: Database, id: string): Promise<void> {
  const deleted = await db
    .delete(automations)
    .where(eq(automations.id, id))
    .returning({ id: automations.id });
  if (deleted.length === 0) {
    throw new AutomationError('Automação não encontrada', 'NOT_FOUND', 404);
  }
}

/** Gera um token novo, invalidando a URL antiga. Usado se a URL vazar. */
export async function rotateWebhookToken(
  db: Database,
  id: string,
  publicApiUrl: string,
): Promise<AutomationPublic> {
  const [updated] = await db
    .update(automations)
    .set({ webhookToken: generateOpaqueToken(32), updatedAt: new Date() })
    .where(eq(automations.id, id))
    .returning();

  if (!updated) throw new AutomationError('Automação não encontrada', 'NOT_FOUND', 404);

  const actions = await db
    .select()
    .from(automationActions)
    .where(eq(automationActions.automationId, id));

  return toPublic(updated, actions, publicApiUrl);
}

/** Contagens para a aba Integrações: quantas automações ativas usam cada módulo. */
export async function countActiveByIntegration(
  db: Database,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  const triggerRows = await db
    .select({ triggerType: automations.triggerType, total: sql<number>`count(*)::int` })
    .from(automations)
    .where(eq(automations.status, 'active'))
    .groupBy(automations.triggerType);

  for (const row of triggerRows) counts[row.triggerType] = row.total;

  const actionRows = await db
    .select({ actionType: automationActions.actionType, total: sql<number>`count(distinct ${automations.id})::int` })
    .from(automationActions)
    .innerJoin(automations, eq(automationActions.automationId, automations.id))
    .where(eq(automations.status, 'active'))
    .groupBy(automationActions.actionType);

  for (const row of actionRows) {
    counts[row.actionType] = (counts[row.actionType] ?? 0) + row.total;
  }

  return counts;
}
