import type { FieldDescriptor, FieldOption, IntegrationKind } from '@orbita/shared';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Contratos dos módulos plugáveis
 * ─────────────────────────────────────────────────────────────────────
 *
 * Estes três tipos são a fronteira entre o motor e as integrações.
 * O motor conhece apenas o que está aqui; ele nunca sabe o que é um
 * "Gemini" ou um "WhatsApp". É isso que permite adicionar integração
 * sem tocar no núcleo.
 *
 * Ver docs/ADDING-AN-INTEGRATION.md para a receita prática.
 */

export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Erro de execução com código estável, para o histórico ficar diagnosticável. */
export class ActionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
    /**
     * Se vale a pena tentar de novo. Timeout e 5xx são retryable;
     * credencial inválida e config errada não são — repetir só queima
     * tempo e cota.
     */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

/** Dados do disparo que iniciou a automação. */
export interface TriggerPayload {
  /** id do módulo de gatilho, ex: 'webhook'. */
  type: string;
  /** Corpo já validado e sanitizado. */
  body: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  receivedAt: string;
}

/** Resultado de uma ação anterior, acessível via `{{ steps.N.output }}`. */
export interface StepResult {
  position: number;
  actionType: string;
  output: unknown;
}

export interface ActionContext<TConfig = Record<string, unknown>> {
  /** Config já validado pelo configFields e com os `{{ }}` resolvidos. */
  config: TConfig;
  /**
   * Segredos decifrados. Existem só em memória, durante esta execução —
   * nunca são persistidos nem logados.
   */
  credentials: Record<string, string> | null;
  trigger: TriggerPayload;
  steps: StepResult[];
  /** Já passa pelo mascarador; pode receber objeto vindo de fora. */
  logger: Logger;
  /**
   * Cancelamento por timeout. SEMPRE repasse para chamadas de rede
   * (`fetch(url, { signal: ctx.signal })`) — sem isso o timeout não
   * funciona e um serviço lento prende um slot do worker.
   */
  signal: AbortSignal;
  /** Acesso aos provedores de IA. Usado pela ação `ai-generate`. */
  providers: ProviderLookup;
}

export interface ProviderLookup {
  get(id: string): AIProvider | undefined;
  list(): AIProvider[];
}

/** Campos comuns a qualquer módulo — alimentam o card da aba Integrações. */
interface ModuleBase {
  id: string;
  name: string;
  description: string;
  /** Nome do ícone resolvido pelo painel. */
  icon: string;
  color?: string;
  /** Campos de configuração por automação. */
  configFields?: FieldDescriptor[];
  /** Campos de segredo. Vazio/ausente = não precisa de credencial. */
  credentialFields?: FieldDescriptor[];
  /**
   * Validação que o descritor de campo não expressa, ex: "se A for X,
   * então B é obrigatório". Retorne a lista de problemas; vazio = ok.
   */
  refineConfig?(config: Record<string, unknown>): string[];
}

export interface TriggerDefinition extends ModuleBase {
  kind: 'trigger';
  /**
   * Como o gatilho é acionado:
   *  - 'webhook'   → expõe URL pública; o motor cuida do roteamento
   *  - 'schedule'  → o worker agenda por cron
   *  - 'manual'    → só pelo botão do painel
   */
  activation: 'webhook' | 'schedule' | 'manual';
  /**
   * Valida a autenticidade do disparo (ex: assinatura HMAC da Meta).
   * Ausente = basta o token secreto da URL.
   */
  verifyRequest?(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    config: Record<string, unknown>;
    credentials: Record<string, string> | null;
  }): { ok: true } | { ok: false; reason: string };
}

export interface ActionDefinition<TConfig = Record<string, unknown>>
  extends ModuleBase {
  kind: 'action';
  /** O trabalho em si. O retorno vira `steps[N].output`. */
  run(ctx: ActionContext<TConfig>): Promise<unknown>;
}

export interface AIGenerateInput {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Pede resposta em JSON quando o provedor suporta modo estruturado. */
  json?: boolean;
}

export interface AIGenerateResult {
  text: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Contrato único de provedor de IA.
 *
 * Deliberadamente pequeno: quanto menor a superfície, mais fácil encaixar
 * um fornecedor novo. O adaptador é quem traduz o formato da API dele
 * para este — o motor e as automações nunca veem essa diferença.
 */
export interface AIProvider extends ModuleBase {
  kind: 'ai_provider';
  /** Modelos oferecidos; vira o dropdown "Modelo" da ação de IA. */
  models: FieldOption[];
  generate(
    input: AIGenerateInput,
    credentials: Record<string, string>,
    ctx: { signal: AbortSignal; logger: Logger },
  ): Promise<AIGenerateResult>;
}

export type AnyModule = TriggerDefinition | ActionDefinition | AIProvider;

export function moduleKind(m: AnyModule): IntegrationKind {
  return m.kind;
}
