import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Estes enums espelham os schemas Zod em @orbita/shared/enums.
 * Ao alterar um lado, altere o outro — o typecheck não cruza os dois.
 */
export const automationStatus = pgEnum('automation_status', [
  'draft',
  'active',
  'inactive',
]);
export const executionStatus = pgEnum('execution_status', [
  'queued',
  'running',
  'success',
  'error',
  'cancelled',
]);
export const stepStatus = pgEnum('step_status', [
  'pending',
  'running',
  'success',
  'error',
  'skipped',
]);
export const onErrorBehavior = pgEnum('on_error_behavior', ['stop', 'continue']);
export const integrationKind = pgEnum('integration_kind', [
  'trigger',
  'action',
  'ai_provider',
]);

/** `bytea` tipado como Buffer — usado no ciphertext das credenciais. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// ─────────────────────────────────────────────────────────────────────
//  Autenticação
// ─────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  /** argon2id. Nunca comparar com `===`; usar verifyPassword(). */
  passwordHash: text('password_hash').notNull(),
  /**
   * Invalida em bloco todos os access tokens emitidos antes deste
   * instante — usado na troca de senha e no "sair de todos os
   * dispositivos". Access token curto não tem como ser revogado
   * individualmente, então revogamos por corte temporal.
   */
  tokensValidFrom: timestamp('tokens_valid_from', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 do token. O valor em claro só existe no cliente. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Aponta para o token que substituiu este na rotação. Se um token já
     * rotacionado for reapresentado, é sinal de roubo — a cadeia inteira
     * é revogada.
     */
    replacedBy: uuid('replaced_by'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_expires_idx').on(t.expiresAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────
//  Credenciais
// ─────────────────────────────────────────────────────────────────────

/**
 * Segredos de integrações (chave do Gemini, token do WhatsApp, ...).
 *
 * O conteúdo vai criptografado com AES-256-GCM. A chave mestra fica na
 * env ENCRYPTION_KEY, nunca no banco — quem vazar um dump não consegue
 * ler nada aqui.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** id do módulo dono, ex: 'gemini'. */
    integrationId: text('integration_id').notNull(),
    kind: integrationKind('kind').notNull(),

    dataEncrypted: bytea('data_encrypted').notNull(),
    iv: bytea('iv').notNull(),
    authTag: bytea('auth_tag').notNull(),
    /** Permite rotacionar a chave mestra sem reescrever tudo de uma vez. */
    keyVersion: integer('key_version').notNull().default(1),

    /** Prévia mascarada por campo, ex: { apiKey: 'AIza••••••4f2c' }. Seguro de exibir. */
    preview: jsonb('preview').notNull().$type<Record<string, string>>().default({}),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('credentials_integration_idx').on(t.integrationId)],
);

// ─────────────────────────────────────────────────────────────────────
//  Automações
// ─────────────────────────────────────────────────────────────────────

export const automations = pgTable(
  'automations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: automationStatus('status').notNull().default('draft'),

    /** id do módulo de gatilho, ex: 'webhook'. */
    triggerType: text('trigger_type').notNull(),
    triggerConfig: jsonb('trigger_config')
      .notNull()
      .$type<Record<string, unknown>>()
      .default({}),

    /**
     * Segredo da URL pública do webhook. Alto o suficiente para não ser
     * adivinhável; é o que autentica o disparo junto com a assinatura
     * HMAC quando o provedor externo suporta.
     */
    webhookToken: text('webhook_token').notNull(),

    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: executionStatus('last_run_status'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('automations_webhook_token_idx').on(t.webhookToken),
    index('automations_status_idx').on(t.status),
    index('automations_trigger_type_idx').on(t.triggerType),
  ],
);

export const automationActions = pgTable(
  'automation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    /** Ordem de execução, base 0. */
    position: integer('position').notNull(),
    /** id do módulo de ação, ex: 'ai-generate'. */
    actionType: text('action_type').notNull(),
    config: jsonb('config').notNull().$type<Record<string, unknown>>().default({}),

    /**
     * `set null` de propósito: apagar uma credencial não deve apagar a
     * automação. Ela passa a falhar com erro claro de credencial ausente,
     * que é muito mais diagnosticável do que sumir.
     */
    credentialId: uuid('credential_id').references(() => credentials.id, {
      onDelete: 'set null',
    }),

    onError: onErrorBehavior('on_error').notNull().default('stop'),
    retries: integer('retries').notNull().default(2),
    timeoutMs: integer('timeout_ms').notNull().default(30_000),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('automation_actions_automation_idx').on(t.automationId, t.position),
  ],
);

// ─────────────────────────────────────────────────────────────────────
//  Execuções
// ─────────────────────────────────────────────────────────────────────

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    status: executionStatus('status').notNull().default('queued'),

    /** Todos os jsonb abaixo já passaram pelo mascarador antes de gravar. */
    triggerPayload: jsonb('trigger_payload'),
    result: jsonb('result'),
    error: jsonb('error').$type<Record<string, unknown>>(),

    /** Disparo manual pelo painel, em vez de gatilho real. */
    isManual: boolean('is_manual').notNull().default(false),

    queueJobId: text('queue_job_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Consulta dominante do painel: histórico de uma automação, mais recente primeiro.
    index('executions_automation_created_idx').on(t.automationId, t.createdAt.desc()),
    index('executions_status_idx').on(t.status),
    index('executions_created_idx').on(t.createdAt.desc()),
  ],
);

export const executionSteps = pgTable(
  'execution_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    /**
     * Sem FK: a ação pode ser apagada da automação depois, e o histórico
     * precisa continuar legível. Guardamos o id só como referência fraca.
     */
    automationActionId: uuid('automation_action_id'),
    position: integer('position').notNull(),
    actionType: text('action_type').notNull(),
    status: stepStatus('status').notNull().default('pending'),

    input: jsonb('input'),
    output: jsonb('output'),
    error: jsonb('error').$type<Record<string, unknown>>(),

    /** Tentativa em que o passo terminou (1 = passou de primeira). */
    attempt: integer('attempt').notNull().default(1),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (t) => [index('execution_steps_execution_idx').on(t.executionId, t.position)],
);

// ─────────────────────────────────────────────────────────────────────
//  Relações
// ─────────────────────────────────────────────────────────────────────

export const automationsRelations = relations(automations, ({ many }) => ({
  actions: many(automationActions),
  executions: many(executions),
}));

export const automationActionsRelations = relations(automationActions, ({ one }) => ({
  automation: one(automations, {
    fields: [automationActions.automationId],
    references: [automations.id],
  }),
  credential: one(credentials, {
    fields: [automationActions.credentialId],
    references: [credentials.id],
  }),
}));

export const executionsRelations = relations(executions, ({ one, many }) => ({
  automation: one(automations, {
    fields: [executions.automationId],
    references: [automations.id],
  }),
  steps: many(executionSteps),
}));

export const executionStepsRelations = relations(executionSteps, ({ one }) => ({
  execution: one(executions, {
    fields: [executionSteps.executionId],
    references: [executions.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));
