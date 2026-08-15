import type {
  ActionDefinition,
  AIProvider,
  AnyModule,
  TriggerDefinition,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
//  REGISTRO DE MÓDULOS
//
//  Para adicionar uma integração: importe o módulo e coloque na lista
//  correspondente abaixo. É o único ponto do sistema que precisa mudar.
//  Ver docs/ADDING-AN-INTEGRATION.md.
// ─────────────────────────────────────────────────────────────────────

import { webhookTrigger } from '../triggers/webhook/index.js';
import { scheduleTrigger } from '../triggers/schedule/index.js';
import { aiGenerateAction } from '../actions/ai-generate/index.js';
import { httpRequestAction } from '../actions/http-request/index.js';
import { geminiProvider } from '../providers/gemini/index.js';

const TRIGGERS: TriggerDefinition[] = [webhookTrigger, scheduleTrigger];

const ACTIONS: ActionDefinition<never>[] = [
  aiGenerateAction as ActionDefinition<never>,
  httpRequestAction as ActionDefinition<never>,
];

const PROVIDERS: AIProvider[] = [
  geminiProvider,
  // Próximos provedores entram aqui. Ver providers/_template/.
];

// ─────────────────────────────────────────────────────────────────────

export class Registry {
  private readonly triggers = new Map<string, TriggerDefinition>();
  private readonly actions = new Map<string, ActionDefinition<never>>();
  private readonly providers = new Map<string, AIProvider>();

  constructor(
    modules: {
      triggers?: TriggerDefinition[];
      actions?: ActionDefinition<never>[];
      providers?: AIProvider[];
    } = {},
  ) {
    for (const t of modules.triggers ?? TRIGGERS) this.registerTrigger(t);
    for (const a of modules.actions ?? ACTIONS) this.registerAction(a);
    for (const p of modules.providers ?? PROVIDERS) this.registerProvider(p);
  }

  private assertUnique(id: string, taken: boolean, kind: string): void {
    if (taken) {
      // Id duplicado silencioso levaria a automação a executar o módulo
      // errado. Falhar no boot é a única resposta segura.
      throw new Error(`Módulo ${kind} com id duplicado: "${id}"`);
    }
  }

  registerTrigger(t: TriggerDefinition): void {
    this.assertUnique(t.id, this.triggers.has(t.id), 'trigger');
    this.triggers.set(t.id, t);
  }

  registerAction(a: ActionDefinition<never>): void {
    this.assertUnique(a.id, this.actions.has(a.id), 'action');
    this.actions.set(a.id, a);
  }

  registerProvider(p: AIProvider): void {
    this.assertUnique(p.id, this.providers.has(p.id), 'ai_provider');
    this.providers.set(p.id, p);
  }

  getTrigger(id: string): TriggerDefinition | undefined {
    return this.triggers.get(id);
  }
  getAction(id: string): ActionDefinition<never> | undefined {
    return this.actions.get(id);
  }
  getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  listTriggers(): TriggerDefinition[] {
    return [...this.triggers.values()];
  }
  listActions(): ActionDefinition<never>[] {
    return [...this.actions.values()];
  }
  listProviders(): AIProvider[] {
    return [...this.providers.values()];
  }

  /** Tudo junto — alimenta o catálogo da aba Integrações. */
  listAll(): AnyModule[] {
    return [...this.listTriggers(), ...this.listActions(), ...this.listProviders()];
  }

  /** Busca por id em qualquer família. */
  findAny(id: string): AnyModule | undefined {
    return this.triggers.get(id) ?? this.actions.get(id) ?? this.providers.get(id);
  }

  /** Passado às ações como `ctx.providers`. */
  get providerLookup() {
    return {
      get: (id: string) => this.providers.get(id),
      list: () => this.listProviders(),
    };
  }
}

/** Instância padrão, com todos os módulos registrados. */
export const registry = new Registry();

export * from './types.js';
export * from './fields.js';
