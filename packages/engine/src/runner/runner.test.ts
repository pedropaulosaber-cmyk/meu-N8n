import { describe, it, expect, vi } from 'vitest';
import { runActions, type PlannedAction } from './index.js';
import { Registry } from '../registry/index.js';
import { ActionError, type ActionDefinition, type TriggerPayload } from '../registry/types.js';
import { MASK } from '../security/mask.js';

const silentLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const trigger: TriggerPayload = {
  type: 'webhook',
  body: { nome: 'Ana', valor: 1000 },
  receivedAt: '2026-08-15T12:00:00.000Z',
};

/** Cria um registry só com as ações de teste, sem os módulos reais. */
function makeRegistry(actions: ActionDefinition<never>[]): Registry {
  return new Registry({ triggers: [], actions, providers: [] });
}

function plan(overrides: Partial<PlannedAction> = {}): PlannedAction {
  return {
    id: 'a1',
    position: 0,
    actionType: 'test',
    config: {},
    credentials: null,
    onError: 'stop',
    retries: 0,
    timeoutMs: 5000,
    ...overrides,
  };
}

function echoAction(
  id: string,
  run: ActionDefinition<never>['run'],
  configFields: ActionDefinition<never>['configFields'] = [],
): ActionDefinition<never> {
  return {
    kind: 'action',
    id,
    name: id,
    description: '',
    icon: 'zap',
    configFields,
    credentialFields: [],
    run,
  };
}

describe('sequência de ações', () => {
  it('executa em ordem e passa o resultado adiante', async () => {
    const registry = makeRegistry([
      echoAction('primeiro', async () => ({ texto: 'olá' })),
      echoAction(
        'segundo',
        async (ctx) => ({ recebido: (ctx.config as { entrada: string }).entrada }),
        [{ key: 'entrada', label: 'Entrada', type: 'text', required: true, supportsTemplate: true }],
      ),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [
        plan({ id: 'a1', position: 0, actionType: 'primeiro' }),
        plan({
          id: 'a2',
          position: 1,
          actionType: 'segundo',
          config: { entrada: '{{ steps.0.output.texto }}' },
        }),
      ],
    });

    expect(out.status).toBe('success');
    expect(out.steps).toHaveLength(2);
    expect(out.steps[1]?.output).toEqual({ recebido: 'olá' });
    // O resultado da automação é a saída da última ação.
    expect(out.result).toEqual({ recebido: 'olá' });
  });

  it('resolve dados do gatilho no config', async () => {
    const registry = makeRegistry([
      echoAction(
        'usa-trigger',
        async (ctx) => ctx.config,
        [{ key: 'quem', label: 'Quem', type: 'text', required: true, supportsTemplate: true }],
      ),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'usa-trigger', config: { quem: '{{ trigger.body.nome }}' } })],
    });

    expect(out.steps[0]?.output).toEqual({ quem: 'Ana' });
  });
});

describe('tratamento de erro', () => {
  it('para a automação com on_error=stop e marca as seguintes como skipped', async () => {
    const terceira = vi.fn(async () => ({ nunca: true }));
    const registry = makeRegistry([
      echoAction('falha', async () => {
        throw new ActionError('estourou', 'BOOM');
      }),
      echoAction('depois', terceira),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [
        plan({ id: 'a1', position: 0, actionType: 'falha', onError: 'stop' }),
        plan({ id: 'a2', position: 1, actionType: 'depois' }),
      ],
    });

    expect(out.status).toBe('error');
    expect(out.error?.code).toBe('BOOM');
    expect(out.steps[0]?.status).toBe('error');
    expect(out.steps[1]?.status).toBe('skipped');
    // A ação seguinte nem chegou a rodar.
    expect(terceira).not.toHaveBeenCalled();
  });

  it('segue adiante com on_error=continue', async () => {
    const seguinte = vi.fn(async () => ({ rodou: true }));
    const registry = makeRegistry([
      echoAction('falha', async () => {
        throw new ActionError('estourou', 'BOOM');
      }),
      echoAction('depois', seguinte),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [
        plan({ id: 'a1', position: 0, actionType: 'falha', onError: 'continue' }),
        plan({ id: 'a2', position: 1, actionType: 'depois' }),
      ],
    });

    expect(out.status).toBe('success');
    expect(out.steps[0]?.status).toBe('error');
    expect(out.steps[1]?.status).toBe('success');
    expect(seguinte).toHaveBeenCalledOnce();
  });

  it('uma exceção crua não derruba o motor', async () => {
    const registry = makeRegistry([
      echoAction('bug', async () => {
        throw new TypeError('undefined is not a function');
      }),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'bug' })],
    });

    expect(out.status).toBe('error');
    expect(out.error?.code).toBe('ACTION_UNEXPECTED_ERROR');
    expect(out.error?.message).toContain('undefined is not a function');
  });

  it('registra ação inexistente sem quebrar', async () => {
    const out = await runActions({
      registry: makeRegistry([]),
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'nao-existe' })],
    });

    expect(out.status).toBe('error');
    expect(out.error?.code).toBe('ACTION_NOT_FOUND');
  });

  it('rejeita config que não bate com os campos declarados', async () => {
    const registry = makeRegistry([
      echoAction('exige', async () => ({}), [
        { key: 'obrigatorio', label: 'Obrigatório', type: 'text', required: true, supportsTemplate: false },
      ]),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'exige', config: {} })],
    });

    expect(out.status).toBe('error');
    expect(out.error?.code).toBe('INVALID_CONFIG');
  });
});

describe('retentativas', () => {
  it('repete erro retryable e sucede na segunda tentativa', async () => {
    let chamadas = 0;
    const registry = makeRegistry([
      echoAction('instavel', async () => {
        chamadas++;
        if (chamadas === 1) throw new ActionError('instabilidade', 'TEMP', {}, true);
        return { ok: true };
      }),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'instavel', retries: 2 })],
    });

    expect(out.status).toBe('success');
    expect(chamadas).toBe(2);
    expect(out.steps[0]?.attempt).toBe(2);
  });

  it('NÃO repete erro não-retryable', async () => {
    let chamadas = 0;
    const registry = makeRegistry([
      echoAction('credencial-ruim', async () => {
        chamadas++;
        throw new ActionError('chave inválida', 'CREDENTIAL_INVALID', {}, false);
      }),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'credencial-ruim', retries: 3 })],
    });

    expect(out.status).toBe('error');
    // Repetir credencial inválida só queimaria tempo e cota.
    expect(chamadas).toBe(1);
  });
});

describe('timeout', () => {
  it('interrompe ação que passa do limite', async () => {
    const registry = makeRegistry([
      echoAction('lenta', async (ctx) => {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
        return { nuncaChega: true };
      }),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'lenta', timeoutMs: 100, retries: 0 })],
    });

    expect(out.status).toBe('error');
    expect(out.error?.code).toBe('ACTION_TIMEOUT');
  }, 10_000);
});

describe('mascaramento no histórico', () => {
  it('não deixa o segredo da credencial chegar ao histórico', async () => {
    const SEGREDO = 'AIzaSyD-chave-secreta-do-gemini-4f2c';

    const registry = makeRegistry([
      // Ação mal-comportada de propósito: ecoa a credencial na saída,
      // como faria uma API externa devolvendo a requisição no erro.
      echoAction('vaza', async (ctx) => ({
        mensagem: `falhou usando a chave ${ctx.credentials?.apiKey}`,
      })),
    ]);

    const out = await runActions({
      registry,
      trigger,
      logger: silentLogger,
      actions: [plan({ actionType: 'vaza', credentials: { apiKey: SEGREDO } })],
    });

    const serializado = JSON.stringify(out);
    expect(serializado).not.toContain(SEGREDO);
    expect(serializado).toContain(MASK);
  });

  it('mascara campo sensível vindo do gatilho', async () => {
    const registry = makeRegistry([echoAction('eco', async (ctx) => ctx.trigger.body)]);

    const out = await runActions({
      registry,
      trigger: {
        type: 'webhook',
        body: { usuario: 'ana', password: 'senha-super-secreta' },
        receivedAt: '2026-08-15T12:00:00.000Z',
      },
      logger: silentLogger,
      actions: [plan({ actionType: 'eco' })],
    });

    expect(JSON.stringify(out)).not.toContain('senha-super-secreta');
  });
});

describe('callback de progresso', () => {
  it('notifica cada passo concluído, para o painel acompanhar', async () => {
    const onStepComplete = vi.fn(async () => {});
    const registry = makeRegistry([
      echoAction('um', async () => ({ a: 1 })),
      echoAction('dois', async () => ({ b: 2 })),
    ]);

    await runActions({
      registry,
      trigger,
      logger: silentLogger,
      onStepComplete,
      actions: [
        plan({ id: 'a1', position: 0, actionType: 'um' }),
        plan({ id: 'a2', position: 1, actionType: 'dois' }),
      ],
    });

    expect(onStepComplete).toHaveBeenCalledTimes(2);
  });
});
