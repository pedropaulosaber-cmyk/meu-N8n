/**
 * ─────────────────────────────────────────────────────────────────────
 *  Mascaramento de dados sensíveis
 * ─────────────────────────────────────────────────────────────────────
 *
 * Todo payload que vai para o histórico de execução ou para o log passa
 * por aqui primeiro. São duas defesas complementares:
 *
 *  1. Por NOME de campo — pega `authorization`, `apiKey`, `senha`, etc.
 *     Cobre o caso comum de um webhook trazer um token no corpo.
 *
 *  2. Por VALOR conhecido — recebe os segredos realmente carregados
 *     nesta execução e mascara qualquer ocorrência deles, esteja onde
 *     estiver. Pega o caso em que uma ação ecoa a chave de API dentro de
 *     uma mensagem de erro, onde nenhuma regra por nome alcançaria.
 *
 * A segunda é a que salva na prática: mensagens de erro de API externa
 * frequentemente incluem a requisição inteira, chave junto.
 */

const SENSITIVE_KEY_PATTERN =
  /(senha|password|secret|token|api[-_]?key|apikey|authorization|auth|credential|private[-_]?key|access[-_]?key|client[-_]?secret|session|cookie|bearer|assinatura|signature)/i;

/** Campos que carregam dado pessoal e não deveriam repousar no histórico. */
const PII_KEY_PATTERN = /(^|[-_])(cpf|cnpj|rg|passaporte|cartao|card[-_]?number|cvv)($|[-_])/i;

export const MASK = '••••••••';

export interface MaskOptions {
  /**
   * Valores literais a mascarar onde aparecerem — passe aqui os segredos
   * decifrados usados na execução.
   */
  secretValues?: string[];
  maxDepth?: number;
  /** Corta strings gigantes; evita histórico inchado por resposta de IA longa. */
  maxStringLength?: number;
}

export function maskSensitive(value: unknown, options: MaskOptions = {}): unknown {
  const {
    secretValues = [],
    maxDepth = 8,
    maxStringLength = 10_000,
  } = options;

  // Segredos curtos demais dariam falso positivo em texto normal.
  const secrets = secretValues.filter((s) => typeof s === 'string' && s.length >= 8);

  const walk = (current: unknown, depth: number): unknown => {
    if (depth > maxDepth) return '[profundidade máxima atingida]';

    if (current === null || current === undefined) return current;

    if (typeof current === 'string') {
      return truncate(redactSecrets(current, secrets), maxStringLength);
    }

    if (typeof current === 'number' || typeof current === 'boolean') return current;

    if (current instanceof Date) return current.toISOString();

    if (Array.isArray(current)) {
      // Array enorme não precisa ir inteiro para o histórico.
      const capped = current.length > 100 ? current.slice(0, 100) : current;
      const mapped: unknown[] = capped.map((item) => walk(item, depth + 1));
      if (current.length > 100) {
        mapped.push(`[... mais ${current.length - 100} itens omitidos]`);
      }
      return mapped;
    }

    if (typeof current === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(current)) {
        if (SENSITIVE_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key)) {
          out[key] = MASK;
          continue;
        }
        out[key] = walk(val, depth + 1);
      }
      return out;
    }

    // Function, symbol, bigint — não têm por que estar num payload.
    return `[${typeof current}]`;
  };

  return walk(value, 0);
}

function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (result.includes(secret)) {
      result = result.split(secret).join(MASK);
    }
  }
  return result;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncado, ${text.length} caracteres no total]`;
}

/**
 * Envolve um logger para que tudo que passe por ele já saia mascarado.
 * É o logger entregue às ações em `ctx.logger`.
 */
export function createMaskedLogger(
  base: {
    debug(obj: unknown, msg?: string): void;
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  },
  options: MaskOptions = {},
) {
  const wrap =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (obj: unknown, msg?: string): void => {
      base[level](maskSensitive(obj, options), msg);
    };

  return {
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
  };
}
