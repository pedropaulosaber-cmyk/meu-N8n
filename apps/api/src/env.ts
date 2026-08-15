import { z } from 'zod';

/**
 * Validação do ambiente no boot.
 *
 * O processo se recusa a subir com configuração inválida — em especial
 * ENCRYPTION_KEY e JWT_SECRET. Falhar aqui, alto e claro, é muito melhor
 * do que subir e só descobrir o problema quando uma credencial não
 * descriptografa em produção.
 */

/** Aceita a chave AES em base64 e confirma que são exatamente 32 bytes. */
const encryptionKeySchema = z
  .string()
  .min(1, 'ENCRYPTION_KEY é obrigatória — gere com: openssl rand -base64 32')
  .refine((raw) => {
    try {
      return Buffer.from(raw, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'ENCRYPTION_KEY precisa ser base64 de 32 bytes — gere com: openssl rand -base64 32');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  ENCRYPTION_KEY: encryptionKeySchema,
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de ao menos 32 caracteres'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  OWNER_EMAIL: z.string().email().optional(),
  OWNER_PASSWORD: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  ACTION_DEFAULT_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  ACTION_DEFAULT_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  EXECUTION_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${problems}\n`);
  }

  if (parsed.data.NODE_ENV === 'production') {
    assertProductionSafety(parsed.data);
  }

  cached = parsed.data;
  return cached;
}

/** Erros que só importam em produção, mas que lá são graves. */
function assertProductionSafety(env: Env): void {
  const problems: string[] = [];

  if (env.PUBLIC_API_URL.startsWith('http://')) {
    problems.push('PUBLIC_API_URL precisa ser https:// em produção');
  }
  if (env.WEB_ORIGIN.startsWith('http://')) {
    problems.push('WEB_ORIGIN precisa ser https:// em produção');
  }
  if (env.JWT_SECRET.includes('ci-only') || env.JWT_SECRET.includes('change')) {
    problems.push('JWT_SECRET ainda está com valor de exemplo');
  }

  if (problems.length > 0) {
    throw new Error(
      `Configuração insegura para produção:\n${problems.map((p) => `  • ${p}`).join('\n')}\n`,
    );
  }
}

/** Apenas para testes — descarta o cache entre casos. */
export function resetEnvCache(): void {
  cached = null;
}
