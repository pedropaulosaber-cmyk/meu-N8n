import { describe, it, expect } from 'vitest';
import { maskSensitive, MASK } from './mask.js';

describe('mascaramento por nome de campo', () => {
  it('mascara variações comuns de campo secreto', () => {
    const out = maskSensitive({
      apiKey: 'AIzaSyD1234567890',
      api_key: 'x',
      password: 'senha',
      senha: 'senha',
      authorization: 'Bearer abc',
      accessToken: 'tok',
      client_secret: 's',
      nome: 'Ana',
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe(MASK);
    expect(out.api_key).toBe(MASK);
    expect(out.password).toBe(MASK);
    expect(out.senha).toBe(MASK);
    expect(out.authorization).toBe(MASK);
    expect(out.accessToken).toBe(MASK);
    expect(out.client_secret).toBe(MASK);
    // Campo comum não é tocado.
    expect(out.nome).toBe('Ana');
  });

  it('mascara dado pessoal sensível', () => {
    const out = maskSensitive({ cpf: '123.456.789-00', cidade: 'Recife' }) as Record<
      string,
      unknown
    >;
    expect(out.cpf).toBe(MASK);
    expect(out.cidade).toBe('Recife');
  });

  it('desce em objetos e arrays aninhados', () => {
    const out = maskSensitive({
      cfg: { headers: { authorization: 'Bearer segredo' } },
      lista: [{ token: 'abc' }],
    }) as any;
    expect(out.cfg.headers.authorization).toBe(MASK);
    expect(out.lista[0].token).toBe(MASK);
  });
});

describe('mascaramento por valor conhecido', () => {
  const CHAVE = 'AIzaSyD-chave-real-do-gemini-4f2c';

  it('mascara o segredo mesmo em campo de nome inocente', () => {
    const out = maskSensitive(
      { mensagemDeErro: `Requisição falhou com key=${CHAVE}` },
      { secretValues: [CHAVE] },
    ) as Record<string, string>;

    expect(out.mensagemDeErro).not.toContain(CHAVE);
    expect(out.mensagemDeErro).toContain(MASK);
  });

  it('pega o segredo dentro de string aninhada em array', () => {
    const out = maskSensitive(
      { erros: [`falha: ${CHAVE}`] },
      { secretValues: [CHAVE] },
    ) as { erros: string[] };
    expect(out.erros[0]).not.toContain(CHAVE);
  });

  it('ignora segredo curto demais para evitar falso positivo', () => {
    const out = maskSensitive({ texto: 'o valor é abc' }, { secretValues: ['abc'] }) as {
      texto: string;
    };
    expect(out.texto).toBe('o valor é abc');
  });
});

describe('limites de tamanho', () => {
  it('trunca string gigante', () => {
    const out = maskSensitive({ t: 'x'.repeat(20_000) }, { maxStringLength: 100 }) as {
      t: string;
    };
    expect(out.t).toContain('truncado');
    expect(out.t.length).toBeLessThan(200);
  });

  it('limita array muito longo', () => {
    const out = maskSensitive({ l: Array.from({ length: 500 }, (_, i) => i) }) as {
      l: unknown[];
    };
    expect(out.l.length).toBe(101);
    expect(String(out.l[100])).toContain('omitidos');
  });

  it('corta recursão profunda', () => {
    let deep: Record<string, unknown> = { fim: 1 };
    for (let i = 0; i < 20; i++) deep = { nivel: deep };
    expect(JSON.stringify(maskSensitive(deep))).toContain('profundidade máxima');
  });
});

describe('tipos diversos', () => {
  it('preserva primitivos e converte data', () => {
    const out = maskSensitive({
      n: 42,
      b: true,
      nulo: null,
      d: new Date('2026-08-15T12:00:00Z'),
    }) as Record<string, unknown>;
    expect(out.n).toBe(42);
    expect(out.b).toBe(true);
    expect(out.nulo).toBeNull();
    expect(out.d).toBe('2026-08-15T12:00:00.000Z');
  });
});
