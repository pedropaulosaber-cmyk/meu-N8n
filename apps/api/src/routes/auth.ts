import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  type AuthTokens,
} from '@orbita/shared';
import { users } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { hashPassword, verifyPassword, fakeVerify } from '../auth/passwords.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  AuthError,
} from '../auth/tokens.js';
import { requireAuth } from '../auth/middleware.js';
import type { Env } from '../env.js';

interface Deps {
  db: Database;
  env: Env;
}

/** Converte '15m' / '2h' em segundos, para o campo expiresIn da resposta. */
function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit ?? 's'] ?? 1);
}

export async function authRoutes(app: FastifyInstance, { db, env }: Deps): Promise<void> {
  const accessTtlSeconds = ttlToSeconds(env.ACCESS_TOKEN_TTL);

  async function buildTokens(
    user: { id: string; email: string },
    request: { headers: Record<string, unknown>; ip: string },
  ): Promise<AuthTokens> {
    const accessToken = await signAccessToken(
      { userId: user.id, email: user.email },
      env.JWT_SECRET,
      env.ACCESS_TOKEN_TTL,
    );
    const refresh = await issueRefreshToken(db, user.id, env.REFRESH_TOKEN_TTL_DAYS, {
      userAgent: String(request.headers['user-agent'] ?? '').slice(0, 400) || null,
      ip: request.ip,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: accessTtlSeconds,
      user: { id: user.id, email: user.email },
    };
  }

  /**
   * POST /api/auth/login
   *
   * Rate limit agressivo: 5 tentativas por minuto por IP. É a defesa
   * contra força bruta exigida no checklist de segurança.
   */
  app.post(
    '/login',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Credenciais inválidas', code: 'BAD_REQUEST' });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, parsed.data.email.toLowerCase()))
        .limit(1);

      if (!user) {
        // Gasta o mesmo tempo de uma verificação real para que e-mail
        // inexistente e senha errada sejam indistinguíveis por timing.
        await fakeVerify();
        return reply
          .code(401)
          .send({ error: 'E-mail ou senha incorretos', code: 'INVALID_CREDENTIALS' });
      }

      const ok = await verifyPassword(user.passwordHash, parsed.data.password);
      if (!ok) {
        // Mensagem idêntica ao caso acima: não revelamos qual dos dois falhou.
        return reply
          .code(401)
          .send({ error: 'E-mail ou senha incorretos', code: 'INVALID_CREDENTIALS' });
      }

      request.log.info({ userId: user.id }, 'login bem-sucedido');
      return reply.send(await buildTokens(user, request));
    },
  );

  /** POST /api/auth/refresh — rotaciona o par de tokens. */
  app.post(
    '/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Requisição inválida', code: 'BAD_REQUEST' });
      }

      try {
        const rotated = await rotateRefreshToken(
          db,
          parsed.data.refreshToken,
          env.REFRESH_TOKEN_TTL_DAYS,
          {
            userAgent: String(request.headers['user-agent'] ?? '').slice(0, 400) || null,
            ip: request.ip,
          },
        );

        const accessToken = await signAccessToken(
          { userId: rotated.userId, email: rotated.email },
          env.JWT_SECRET,
          env.ACCESS_TOKEN_TTL,
        );

        return reply.send({
          accessToken,
          refreshToken: rotated.token,
          expiresIn: accessTtlSeconds,
          user: { id: rotated.userId, email: rotated.email },
        } satisfies AuthTokens);
      } catch (err) {
        if (err instanceof AuthError) {
          if (err.code === 'REFRESH_REUSE_DETECTED') {
            request.log.warn({ ip: request.ip }, 'reuso de refresh token detectado');
          }
          return reply.code(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  /** POST /api/auth/logout — encerra a sessão atual. */
  app.post('/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (parsed.success) {
      await revokeRefreshToken(db, parsed.data.refreshToken);
    }
    // Sempre 204: não revelamos se o token existia.
    return reply.code(204).send();
  });

  /** GET /api/auth/me — quem sou eu. */
  app.get('/me', { preHandler: requireAuth({ db, jwtSecret: env.JWT_SECRET }) }, async (request) => {
    return { user: request.currentUser };
  });

  /**
   * POST /api/auth/change-password
   *
   * Ao trocar a senha, todas as outras sessões caem: os refresh tokens são
   * revogados e `tokensValidFrom` avança, invalidando os access tokens já
   * emitidos. Se a senha foi trocada por suspeita de invasão, deixar a
   * sessão do invasor viva anularia o propósito.
   */
  app.post(
    '/change-password',
    {
      preHandler: requireAuth({ db, jwtSecret: env.JWT_SECRET }),
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Senha nova não atende à política',
          code: 'WEAK_PASSWORD',
          issues: parsed.error.issues.map((i) => i.message),
        });
      }

      const userId = request.currentUser!.id;
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        return reply.code(401).send({ error: 'Usuário não encontrado', code: 'USER_NOT_FOUND' });
      }

      const ok = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
      if (!ok) {
        return reply
          .code(401)
          .send({ error: 'Senha atual incorreta', code: 'INVALID_CREDENTIALS' });
      }

      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(parsed.data.newPassword),
          tokensValidFrom: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await revokeAllForUser(db, userId);

      request.log.info({ userId }, 'senha alterada; sessões encerradas');
      return reply.send({ ok: true, message: 'Senha alterada. Entre novamente.' });
    },
  );
}
