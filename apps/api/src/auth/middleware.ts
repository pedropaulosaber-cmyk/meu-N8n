import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { verifyAccessToken, AuthError } from './tokens.js';
import { users } from '../db/schema.js';
import type { Database } from '../db/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido pelo requireAuth. Ausente em rotas públicas. */
    currentUser?: { id: string; email: string };
  }
}

export interface AuthDeps {
  db: Database;
  jwtSecret: string;
}

/**
 * Exige um access token válido.
 *
 * Registrado como preHandler em TODAS as rotas administrativas. As únicas
 * rotas sem ele são /api/auth/login, /api/auth/refresh, /health e os
 * webhooks públicos (que têm sua própria autenticação por token + HMAC).
 */
export function requireAuth({ db, jwtSecret }: AuthDeps) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      await reply
        .code(401)
        .send({ error: 'Autenticação obrigatória', code: 'MISSING_TOKEN' });
      return;
    }

    try {
      const claims = await verifyAccessToken(header.slice(7), jwtSecret);

      // Revogação em bloco: um token emitido antes da última troca de senha
      // (ou do logout global) é recusado mesmo estando dentro da validade.
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          tokensValidFrom: users.tokensValidFrom,
        })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);

      if (!user) {
        await reply
          .code(401)
          .send({ error: 'Usuário não existe mais', code: 'USER_NOT_FOUND' });
        return;
      }

      const issuedAt = typeof claims.iat === 'number' ? claims.iat * 1000 : 0;
      if (issuedAt < user.tokensValidFrom.getTime()) {
        await reply.code(401).send({
          error: 'Sessão encerrada. Entre novamente.',
          code: 'TOKEN_REVOKED',
        });
        return;
      }

      request.currentUser = { id: user.id, email: user.email };
    } catch (err) {
      const code = err instanceof AuthError ? err.code : 'INVALID_TOKEN';
      await reply.code(401).send({ error: 'Token inválido ou expirado', code });
    }
  };
}
