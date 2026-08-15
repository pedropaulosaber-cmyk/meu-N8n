import type { StepResult, TriggerPayload } from '../registry/types.js';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Resolução de templates  `{{ caminho }}`
 * ─────────────────────────────────────────────────────────────────────
 *
 * DECISÃO DE SEGURANÇA — leia antes de "melhorar" este arquivo.
 *
 * A tentação óbvia é usar `eval`, `new Function` ou uma engine de
 * template com expressões, para permitir coisas como
 * `{{ trigger.body.valor * 1.1 }}`. NÃO FAÇA ISSO.
 *
 * O conteúdo interpolado vem de webhook — ou seja, de qualquer um na
 * internet que descubra a URL. Qualquer avaliação de expressão
 * transformaria esse payload em código executando dentro do worker,
 * com acesso às credenciais decifradas em memória. É execução remota
 * de código, direta.
 *
 * Este resolvedor faz uma coisa só: busca por caminho. Sem operadores,
 * sem chamada de função, sem acesso a protótipo. Se um dia for preciso
 * transformar dados, a resposta certa é uma ação dedicada no registry
 * (que roda código nosso, revisado), nunca uma expressão no template.
 */

export interface ResolveScope {
  trigger: TriggerPayload;
  steps: StepResult[];
}

/** `{{ caminho }}` — captura tudo que não seja chave de fechamento. */
const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

/** Chaves que dão acesso ao protótipo. Bloqueadas em qualquer posição. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resolve recursivamente todos os templates de um config.
 *
 * Quando o valor é exatamente um template (`"{{ trigger.body.x }}"`), o
 * tipo original é preservado — um número continua número, um objeto
 * continua objeto. Quando o template está no meio de um texto
 * (`"Olá {{ trigger.body.nome }}"`), o resultado é interpolado como string.
 */
export function resolveConfig<T>(config: T, scope: ResolveScope): T {
  return resolveValue(config, scope) as T;
}

function resolveValue(value: unknown, scope: ResolveScope): unknown {
  if (typeof value === 'string') return resolveString(value, scope);

  if (Array.isArray(value)) return value.map((v) => resolveValue(v, scope));

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = resolveValue(v, scope);
    }
    return out;
  }

  return value;
}

function resolveString(input: string, scope: ResolveScope): unknown {
  const exact = /^\s*\{\{([^}]+)\}\}\s*$/.exec(input);
  if (exact) {
    // Template puro: devolve o valor com o tipo original preservado.
    return lookup(exact[1]!.trim(), scope);
  }

  if (!input.includes('{{')) return input;

  // Template no meio de texto: interpola como string.
  return input.replace(TEMPLATE_PATTERN, (_match, path: string) => {
    const resolved = lookup(path.trim(), scope);
    if (resolved === undefined || resolved === null) return '';
    if (typeof resolved === 'object') return JSON.stringify(resolved);
    return String(resolved);
  });
}

/**
 * Busca um caminho no escopo. Retorna undefined se qualquer segmento
 * não existir — nunca lança, para um template errado não derrubar a
 * execução inteira (o erro aparece no histórico como valor vazio).
 *
 * Caminhos suportados:
 *   trigger.body.cliente.nome
 *   trigger.headers.x-origem
 *   steps.0.output.text
 *   steps.1.output
 */
function lookup(path: string, scope: ResolveScope): unknown {
  const segments = path.split('.').filter((s) => s.length > 0);
  if (segments.length === 0) return undefined;

  const [root, ...rest] = segments;

  let current: unknown;
  if (root === 'trigger') {
    current = scope.trigger;
  } else if (root === 'steps') {
    current = scope.steps;
  } else {
    return undefined;
  }

  for (const segment of rest) {
    if (FORBIDDEN_KEYS.has(segment)) return undefined;
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (typeof current !== 'object') return undefined;

    // hasOwn e não `in`: assim uma chave herdada do protótipo (toString,
    // valueOf) nunca é alcançável por um caminho vindo de fora.
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Lista os caminhos disponíveis no escopo atual.
 * Alimenta o seletor de variáveis do editor de automação.
 */
export function availablePaths(scope: ResolveScope, maxDepth = 4): string[] {
  const paths: string[] = [];

  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (depth > maxDepth || value === null || value === undefined) return;

    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${prefix}.${i}`, depth + 1));
      return;
    }

    if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        const next = `${prefix}.${key}`;
        paths.push(next);
        walk((value as Record<string, unknown>)[key], next, depth + 1);
      }
      return;
    }
  };

  walk(scope.trigger, 'trigger', 0);
  walk(scope.steps, 'steps', 0);
  return paths;
}
