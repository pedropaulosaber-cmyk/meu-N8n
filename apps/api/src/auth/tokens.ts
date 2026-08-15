import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { refreshTokens, users } from '../db/schema.js';
import { generateOpaqueToken, hashToken } from '../crypto/credentials.js';

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  email: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const ISSUER = 'orbita';
const AUDIENCE = 'orbita-admin';

function secretKey(jwtSecret: string): Uint8Array {
  return new TextEncoder().encode(jwtSecret);
}

/**
 * Access token de vida curta (15 min por padrão).
 *
 * Curto de propósito: como não há lista de revogação por token, a janela
 * de estrago de um token vazado é o próprio TTL. Revogação em bloco
 * existe via `tokensValidFrom` no usuário.
 */
export async function signAccessToken(
  claims: { userId: string; email: string },
  jwtSecret: string,
  ttl: string,
): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(ttl)
    .sign(secretKey(jwtSecret));
}

export async function verifyAccessToken(
  token: string,
  jwtSecret: string,
): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(jwtSecret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new AuthError('Token sem os claims esperados', 'INVALID_TOKEN');
    }
    return payload as AccessTokenClaims;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Token inválido ou expirado', 'INVALID_TOKEN');
  }
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

/** Emite um refresh token novo. O valor em claro só existe aqui e no cliente. */
export async function issueRefreshToken(
  db: Database,
  userId: string,
  ttlDays: number,
  context: { userAgent?: string | null; ip?: string | null } = {},
): Promise<IssuedRefreshToken> {
  const token = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: context.userAgent ?? null,
    ip: context.ip ?? null,
  });

  return { token, expiresAt };
}

/**
 * Troca um refresh token por um par novo (rotação).
 *
 * Detecção de reuso: se chegar um token que já foi rotacionado, é sinal
 * de que alguém copiou o token — o legítimo e o atacante não podem os
 * dois ter o mesmo token válido. Nesse caso revogamos TODA a família de
 * tokens do usuário, forçando login novo. Prefere-se o incômodo de um
 * relogin à sessão sequestrada continuar viva.
 */
export async function rotateRefreshToken(
  db: Database,
  presentedToken: string,
  ttlDays: number,
  context: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ userId: string; email: string } & IssuedRefreshToken> {
  const presentedHash = hashToken(presentedToken);

  const [existing] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, presentedHash))
    .limit(1);

  if (!existing) {
    throw new AuthError('Refresh token não encontrado', 'REFRESH_NOT_FOUND');
  }

  if (existing.revokedAt !== null) {
    await revokeAllForUser(db, existing.userId);
    throw new AuthError(
      'Refresh token já utilizado. Todas as sessões foram encerradas por segurança.',
      'REFRESH_REUSE_DETECTED',
    );
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new AuthError('Refresh token expirado', 'REFRESH_EXPIRED');
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, existing.userId))
    .limit(1);

  if (!user) {
    throw new AuthError('Usuário não existe mais', 'USER_NOT_FOUND');
  }

  const next = await issueRefreshToken(db, user.id, ttlDays, context);

  const [inserted] = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(next.token)))
    .limit(1);

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedBy: inserted?.id ?? null })
    .where(eq(refreshTokens.id, existing.id));

  return { userId: user.id, email: user.email, ...next };
}

export async function revokeRefreshToken(
  db: Database,
  token: string,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.tokenHash, hashToken(token)),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/** Encerra todas as sessões — logout global e resposta a reuso detectado. */
export async function revokeAllForUser(db: Database, userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * Remove tokens expirados ou revogados há tempo suficiente para não
 * servirem mais nem como trilha de auditoria. Chamado pelo worker.
 */
export async function pruneRefreshTokens(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, new Date()), lt(refreshTokens.createdAt, cutoff)))
    .returning({ id: refreshTokens.id });
  return deleted.length;
}
