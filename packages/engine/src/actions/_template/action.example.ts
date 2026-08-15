/**
 * ─────────────────────────────────────────────────────────────────────
 *  ESQUELETO — nova ação
 * ─────────────────────────────────────────────────────────────────────
 *
 * Copie para `../<sua-acao>/index.ts`, preencha e registre em
 * `../../registry/index.ts`.
 *
 * Extensão `.example.ts` de propósito: não entra no build enquanto for
 * só referência.
 *
 * Exemplos reais para comparar:
 *   ../ai-generate/    → usa credencial e chama provedor de IA
 *   ../http-request/   → chama serviço externo genérico
 */

import { ActionError, type ActionDefinition } from '../../registry/types.js';

/** Tipe o config: é o que `ctx.config` entrega já validado e resolvido. */
interface MinhaAcaoConfig {
  destino: string;
  mensagem: string;
  tentarDeNovo?: boolean;
}

export const minhaAcao: ActionDefinition<MinhaAcaoConfig> = {
  kind: 'action',
  id: 'minha-acao', // ← único e estável; vai para o banco
  name: 'Minha Ação',
  description: 'Uma frase explicando o que faz. Aparece no card da aba Integrações.',
  icon: 'zap',
  color: '#5B6CFF',

  /**
   * Estes descritores geram, de uma vez:
   *   1. a validação no backend (fieldsToZod)
   *   2. o formulário no editor de automação
   *   3. o card na aba Integrações
   * Declare uma vez, funciona nos três lugares.
   */
  configFields: [
    {
      key: 'destino',
      label: 'Destino',
      type: 'text',
      required: true,
      supportsTemplate: true, // permite {{ trigger.body.telefone }}
      placeholder: '+55 81 90000-0000',
    },
    {
      key: 'mensagem',
      label: 'Mensagem',
      type: 'textarea',
      required: true,
      rows: 5,
      supportsTemplate: true,
      help: 'Use {{ }} para inserir dados do gatilho ou de passos anteriores.',
    },
    {
      key: 'tentarDeNovo',
      label: 'Reenviar em caso de falha',
      type: 'boolean',
      required: false,
      default: true,
      supportsTemplate: false,
    },
  ],

  /** Vazio quando a ação não fala com serviço autenticado. */
  credentialFields: [
    {
      key: 'apiToken',
      label: 'Token de API',
      type: 'secret',
      required: true,
      supportsTemplate: false,
    },
  ],

  /** Validação que o descritor sozinho não expressa. Vazio = tudo certo. */
  refineConfig(config) {
    const problems: string[] = [];
    if (String(config.destino ?? '').startsWith('+') === false) {
      problems.push('O destino deve começar com o código do país, ex: +55.');
    }
    return problems;
  },

  async run(ctx) {
    // ctx.config      → validado e com {{ }} já resolvidos
    // ctx.credentials → segredos decifrados, só em memória
    // ctx.trigger     → payload que iniciou a automação
    // ctx.steps       → saídas das ações anteriores
    // ctx.logger      → já mascarado; seguro para objeto vindo de fora
    // ctx.signal      → AbortSignal do timeout

    if (!ctx.credentials?.apiToken) {
      throw new ActionError(
        'Credencial não configurada para esta ação',
        'CREDENTIAL_REQUIRED',
        {},
        false, // não adianta repetir
      );
    }

    ctx.logger.info({ destino: ctx.config.destino }, 'enviando');

    const response = await fetch('https://api.exemplo.com/enviar', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.credentials.apiToken}`,
      },
      body: JSON.stringify({
        to: ctx.config.destino,
        text: ctx.config.mensagem,
      }),
      // OBRIGATÓRIO. Sem isto o timeout não interrompe a chamada e um
      // serviço lento prende um slot do worker.
      signal: ctx.signal,
    });

    if (!response.ok) {
      throw new ActionError(
        `Serviço respondeu ${response.status}`,
        'ENVIO_FALHOU',
        { status: response.status },
        // Só marque retryable o que a repetição resolve.
        response.status >= 500 || response.status === 429,
      );
    }

    // O retorno vira `steps[N].output`, acessível pelas ações seguintes
    // como {{ steps.N.output.id }}.
    return {
      id: (await response.json()) as unknown,
      enviadoEm: new Date().toISOString(),
    };
  },
};
