import { describe, it, expect } from 'vitest';
import { resolveConfig, availablePaths, type ResolveScope } from './resolve.js';

const scope: ResolveScope = {
  trigger: {
    type: 'webhook',
    body: {
      cliente: { nome: 'Ana', idade: 34 },
      valorImovel: 450000,
      tags: ['lead-quente', 'apartamento'],
    },
    headers: { 'x-origem': 'site' },
    receivedAt: '2026-08-15T12:00:00.000Z',
  },
  steps: [
    { position: 0, actionType: 'ai-generate', output: { text: 'Resumo gerado' } },
  ],
};

describe('resolução de caminhos', () => {
  it('resolve caminho aninhado', () => {
    expect(resolveConfig({ v: '{{ trigger.body.cliente.nome }}' }, scope)).toEqual({
      v: 'Ana',
    });
  });

  it('preserva o tipo quando o template é o valor inteiro', () => {
    const out = resolveConfig(
      { numero: '{{ trigger.body.valorImovel }}', obj: '{{ trigger.body.cliente }}' },
      scope,
    );
    expect(out.numero).toBe(450000);
    expect(typeof out.numero).toBe('number');
    expect(out.obj).toEqual({ nome: 'Ana', idade: 34 });
  });

  it('interpola quando o template está dentro de um texto', () => {
    const out = resolveConfig(
      { msg: 'Olá {{ trigger.body.cliente.nome }}, imóvel de {{ trigger.body.valorImovel }}' },
      scope,
    );
    expect(out.msg).toBe('Olá Ana, imóvel de 450000');
  });

  it('lê índice de array e resultado de passo anterior', () => {
    const out = resolveConfig(
      { tag: '{{ trigger.body.tags.0 }}', resumo: '{{ steps.0.output.text }}' },
      scope,
    );
    expect(out.tag).toBe('lead-quente');
    expect(out.resumo).toBe('Resumo gerado');
  });

  it('resolve dentro de objetos e arrays aninhados', () => {
    const out = resolveConfig(
      { headers: { 'X-Nome': '{{ trigger.body.cliente.nome }}' }, lista: ['{{ trigger.body.tags.1 }}'] },
      scope,
    );
    expect(out.headers['X-Nome']).toBe('Ana');
    expect(out.lista[0]).toBe('apartamento');
  });

  it('caminho inexistente vira vazio, sem lançar', () => {
    expect(resolveConfig({ v: '{{ trigger.body.naoExiste }}' }, scope).v).toBeUndefined();
    expect(resolveConfig({ v: 'x={{ trigger.body.nada.aqui }}' }, scope).v).toBe('x=');
  });

  it('deixa texto sem template intacto', () => {
    expect(resolveConfig({ v: 'texto puro' }, scope).v).toBe('texto puro');
  });
});

describe('segurança', () => {
  it('não avalia expressões — trata como caminho e devolve vazio', () => {
    // Se houvesse eval, isto retornaria 4. Tem que dar undefined.
    expect(resolveConfig({ v: '{{ 2 + 2 }}' }, scope).v).toBeUndefined();
  });

  it('não executa chamada de função embutida no template', () => {
    const malicioso = { v: '{{ process.exit(1) }}' };
    expect(resolveConfig(malicioso, scope).v).toBeUndefined();
  });

  it('não alcança globais do processo', () => {
    expect(resolveConfig({ v: '{{ process.env.ENCRYPTION_KEY }}' }, scope).v).toBeUndefined();
    expect(resolveConfig({ v: '{{ global.process }}' }, scope).v).toBeUndefined();
  });

  it('bloqueia acesso a protótipo', () => {
    expect(resolveConfig({ v: '{{ trigger.__proto__ }}' }, scope).v).toBeUndefined();
    expect(resolveConfig({ v: '{{ trigger.body.constructor }}' }, scope).v).toBeUndefined();
    expect(resolveConfig({ v: '{{ trigger.constructor.prototype }}' }, scope).v).toBeUndefined();
  });

  it('não alcança métodos herdados do protótipo', () => {
    expect(resolveConfig({ v: '{{ trigger.body.toString }}' }, scope).v).toBeUndefined();
    expect(resolveConfig({ v: '{{ trigger.body.hasOwnProperty }}' }, scope).v).toBeUndefined();
  });

  it('ignora chave __proto__ vinda do config', () => {
    const out = resolveConfig(
      JSON.parse('{"__proto__":{"poluido":true},"ok":"valor"}') as Record<string, unknown>,
      scope,
    );
    expect(out.ok).toBe('valor');
    expect(({} as Record<string, unknown>).poluido).toBeUndefined();
  });

  it('não resolve raiz desconhecida', () => {
    expect(resolveConfig({ v: '{{ credentials.apiKey }}' }, scope).v).toBeUndefined();
    expect(resolveConfig({ v: '{{ env.JWT_SECRET }}' }, scope).v).toBeUndefined();
  });
});

describe('availablePaths', () => {
  it('lista caminhos para o seletor de variáveis do editor', () => {
    const paths = availablePaths(scope);
    expect(paths).toContain('trigger.body.cliente.nome');
    expect(paths).toContain('steps.0.output.text');
  });
});
