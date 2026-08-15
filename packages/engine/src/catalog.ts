import type { FieldDescriptor, IntegrationCatalogItem } from '@orbita/shared';
import type { Registry } from './registry/index.js';
import type { AnyModule } from './registry/types.js';

/**
 * Monta o catálogo consumido pela aba Integrações.
 *
 * Note que não há nada específico de integração aqui: o catálogo é
 * derivado do que os módulos declaram. Registrar um módulo novo faz ele
 * aparecer na aba automaticamente, sem tocar neste arquivo nem no painel.
 */
export interface CatalogCounts {
  /** integrationId → quantidade de credenciais cadastradas. */
  credentialsByIntegration: Record<string, number>;
  /** integrationId → quantidade de automações ATIVAS que usam o módulo. */
  activeAutomationsByIntegration: Record<string, number>;
}

export function buildCatalog(
  registry: Registry,
  counts: CatalogCounts,
): IntegrationCatalogItem[] {
  return registry.listAll().map((module) => toCatalogItem(module, counts));
}

function toCatalogItem(
  module: AnyModule,
  counts: CatalogCounts,
): IntegrationCatalogItem {
  const credentialFields: FieldDescriptor[] = module.credentialFields ?? [];

  // "Precisa de credencial" = tem ao menos um campo de segredo obrigatório.
  // O webhook, por exemplo, declara signingSecret opcional: só é exigido
  // quando a verificação HMAC está ligada, então ele não conta como pendente.
  const requiresCredential = credentialFields.some((f) => f.required);

  return {
    id: module.id,
    name: module.name,
    description: module.description,
    kind: module.kind,
    icon: module.icon,
    ...(module.color !== undefined && { color: module.color }),
    configFields: module.configFields ?? [],
    credentialFields,
    requiresCredential,
    credentialCount: counts.credentialsByIntegration[module.id] ?? 0,
    activeAutomationCount: counts.activeAutomationsByIntegration[module.id] ?? 0,
    ...(module.kind === 'ai_provider' && { models: module.models }),
  };
}

/**
 * Resolve as opções de um select dinâmico.
 *
 * Dois casos hoje:
 *  • `$providers` → lista os provedores de IA registrados
 *  • `provider`   → lista os modelos do provedor já escolhido
 *
 * O painel chama isto ao montar o formulário, sem saber nada sobre IA.
 */
export function resolveDynamicOptions(
  registry: Registry,
  dependsOn: string,
  currentConfig: Record<string, unknown>,
): Array<{ value: string; label: string }> {
  if (dependsOn === '$providers') {
    return registry.listProviders().map((p) => ({ value: p.id, label: p.name }));
  }

  if (dependsOn === 'provider') {
    const providerId = String(currentConfig.provider ?? '');
    return registry.getProvider(providerId)?.models ?? [];
  }

  return [];
}
