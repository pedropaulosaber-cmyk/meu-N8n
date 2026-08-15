import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Criptografia das credenciais de integração
 * ─────────────────────────────────────────────────────────────────────
 *
 * AES-256-GCM. GCM foi escolhido por ser autenticado: além de cifrar, ele
 * detecta adulteração do ciphertext — se alguém editar o `bytea` direto
 * no banco, a decifragem falha em vez de devolver lixo silenciosamente.
 *
 * A chave mestra vive só em ENCRYPTION_KEY (env), nunca no banco. Um dump
 * do Postgres, sozinho, não revela nenhum segredo.
 */

const ALGORITHM = 'aes-256-gcm';
/** 96 bits é o tamanho de nonce recomendado para GCM. */
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export const CURRENT_KEY_VERSION = 1;

export interface EncryptedPayload {
  dataEncrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export class CredentialCryptoError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new CredentialCryptoError(
      `ENCRYPTION_KEY precisa ter ${KEY_LENGTH} bytes (base64); recebeu ${key.length}`,
      'INVALID_KEY_LENGTH',
    );
  }
  return key;
}

/**
 * Cifra o mapa de segredos de uma credencial.
 *
 * `aad` (additional authenticated data) amarra o ciphertext ao id da
 * credencial: mover a linha cifrada da credencial A para a B faz a
 * decifragem falhar, em vez de a integração B passar a usar o segredo de A.
 */
export function encryptCredentialData(
  data: Record<string, string>,
  base64Key: string,
  aad: string,
): EncryptedPayload {
  const key = parseKey(base64Key);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const dataEncrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    dataEncrypted,
    iv,
    authTag: cipher.getAuthTag(),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Decifra. O resultado só deve existir em memória, no worker, pelo tempo
 * da execução da ação — nunca é persistido nem enviado ao painel.
 */
export function decryptCredentialData(
  payload: EncryptedPayload,
  base64Key: string,
  aad: string,
): Record<string, string> {
  const key = parseKey(base64Key);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, payload.iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(payload.authTag);

    const plaintext = Buffer.concat([
      decipher.update(payload.dataEncrypted),
      decipher.final(),
    ]);

    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CredentialCryptoError(
        'Conteúdo decifrado não é um objeto de credencial',
        'MALFORMED_PLAINTEXT',
      );
    }
    return parsed as Record<string, string>;
  } catch (err) {
    if (err instanceof CredentialCryptoError) throw err;
    // Auth tag inválida cai aqui. Não vazamos o erro original: ele pode
    // servir de oráculo para quem estiver sondando o sistema.
    throw new CredentialCryptoError(
      'Falha ao decifrar a credencial. A ENCRYPTION_KEY mudou ou o dado foi adulterado.',
      'DECRYPTION_FAILED',
    );
  }
}

/**
 * Gera a prévia segura de exibição, ex: 'AIzaSyD...4f2c' → 'AIza••••4f2c'.
 *
 * Mostra o suficiente para o usuário reconhecer qual chave está ali, sem
 * revelar material utilizável. Segredos curtos são mascarados por inteiro,
 * porque neles qualquer pedaço já é uma fração grande do todo.
 */
export function buildPreview(data: Record<string, string>): Record<string, string> {
  const preview: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    preview[key] = maskSecret(value);
  }
  return preview;
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••';
  const head = value.slice(0, 4);
  const tail = value.slice(-4);
  return `${head}••••••••${tail}`;
}

/**
 * Hash usado para guardar refresh tokens.
 *
 * SHA-256 puro (sem argon2) é adequado aqui e em nenhum outro lugar: o
 * token é 256 bits de entropia aleatória, não uma senha escolhida por
 * humano, então não existe ataque de dicionário a mitigar. O que importa
 * é a comparação ser rápida e em tempo constante.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparação em tempo constante, para não vazar informação por timing. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Token opaco de alta entropia — refresh tokens e tokens de webhook. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
