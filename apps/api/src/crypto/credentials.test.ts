import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptCredentialData,
  decryptCredentialData,
  CredentialCryptoError,
  buildPreview,
  maskSecret,
  hashToken,
  safeCompare,
  generateOpaqueToken,
} from './credentials.js';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');
const AAD = 'credential:11111111-1111-1111-1111-111111111111';

describe('encrypt/decrypt', () => {
  it('faz o round-trip preservando o conteúdo', () => {
    const data = { apiKey: 'AIzaSyD-exemplo-de-chave-do-gemini-4f2c' };
    const enc = encryptCredentialData(data, KEY, AAD);
    expect(decryptCredentialData(enc, KEY, AAD)).toEqual(data);
  });

  it('nunca deixa o segredo aparecer no ciphertext', () => {
    const secret = 'super-secreto-nao-pode-vazar';
    const enc = encryptCredentialData({ apiKey: secret }, KEY, AAD);
    expect(enc.dataEncrypted.toString('utf8')).not.toContain(secret);
    expect(enc.dataEncrypted.toString('base64')).not.toContain(secret);
  });

  it('usa IV novo a cada chamada, então cifras iguais não se repetem', () => {
    const data = { apiKey: 'mesma-chave' };
    const a = encryptCredentialData(data, KEY, AAD);
    const b = encryptCredentialData(data, KEY, AAD);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.dataEncrypted.equals(b.dataEncrypted)).toBe(false);
  });

  it('recusa a chave errada', () => {
    const enc = encryptCredentialData({ apiKey: 'x' }, KEY, AAD);
    expect(() => decryptCredentialData(enc, OTHER_KEY, AAD)).toThrow(CredentialCryptoError);
  });

  it('detecta adulteração do ciphertext', () => {
    const enc = encryptCredentialData({ apiKey: 'valor-original' }, KEY, AAD);
    const tampered = Buffer.from(enc.dataEncrypted);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptCredentialData({ ...enc, dataEncrypted: tampered }, KEY, AAD),
    ).toThrow(/adulterado/i);
  });

  it('impede reaproveitar o segredo de uma credencial em outra', () => {
    // O AAD amarra o ciphertext ao id: mover a linha no banco não funciona.
    const enc = encryptCredentialData({ apiKey: 'da-credencial-A' }, KEY, AAD);
    const outraCredencial = 'credential:22222222-2222-2222-2222-222222222222';
    expect(() => decryptCredentialData(enc, KEY, outraCredencial)).toThrow(
      CredentialCryptoError,
    );
  });

  it('rejeita chave com tamanho inválido', () => {
    const curta = randomBytes(16).toString('base64');
    expect(() => encryptCredentialData({ a: 'b' }, curta, AAD)).toThrow(
      /32 bytes/,
    );
  });
});

describe('mascaramento', () => {
  it('mostra pontas de segredos longos', () => {
    expect(maskSecret('AIzaSyD1234567890abcdef4f2c')).toBe('AIza••••••••4f2c');
  });

  it('mascara segredo curto por inteiro', () => {
    expect(maskSecret('curta12')).toBe('••••••••');
    expect(maskSecret('')).toBe('••••••••');
  });

  it('gera prévia campo a campo', () => {
    const preview = buildPreview({
      apiKey: 'AIzaSyD1234567890abcdef4f2c',
      region: 'us-central1',
    });
    expect(preview.apiKey).toBe('AIza••••••••4f2c');
    expect(preview.apiKey).not.toContain('SyD1234567890');
  });
});

describe('tokens', () => {
  it('hash é estável e diferente do valor original', () => {
    const token = 'token-de-teste';
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });

  it('safeCompare distingue iguais de diferentes', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('abc', 'abcd')).toBe(false);
  });

  it('gera tokens únicos e url-safe', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
