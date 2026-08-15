import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TriggerDefinition } from '../../registry/types.js';

/**
 * Webhook genérico.
 *
 * Cada automação com este gatilho ganha uma URL exclusiva:
 *   POST {PUBLIC_API_URL}/hooks/{token}
 *
 * O token é 32 bytes aleatórios — inadivinhável na prática. Para
 * integrações que assinam a requisição (Meta/WhatsApp, Stripe, GitHub),
 * dá para exigir também a assinatura HMAC, e aí o token deixa de ser a
 * única barreira.
 */
export const webhookTrigger: TriggerDefinition = {
  kind: 'trigger',
  id: 'webhook',
  name: 'Webhook',
  description:
    'Recebe uma requisição HTTP em uma URL exclusiva. Use para conectar qualquer sistema que saiba fazer POST.',
  icon: 'webhook',
  color: '#5B6CFF',
  activation: 'webhook',

  configFields: [
    {
      key: 'method',
      label: 'Método aceito',
      type: 'select',
      required: true,
      default: 'POST',
      supportsTemplate: false,
      options: [
        { value: 'POST', label: 'POST' },
        { value: 'GET', label: 'GET' },
        { value: 'ANY', label: 'Qualquer método' },
      ],
    },
    {
      key: 'requireSignature',
      label: 'Exigir assinatura HMAC',
      type: 'boolean',
      required: false,
      default: false,
      supportsTemplate: false,
      help: 'Ative quando quem chama assina o corpo (Meta, Stripe, GitHub). Preencha também o segredo na credencial.',
    },
    {
      key: 'signatureHeader',
      label: 'Cabeçalho da assinatura',
      type: 'text',
      required: false,
      default: 'x-hub-signature-256',
      supportsTemplate: false,
      help: 'Meta/WhatsApp usa x-hub-signature-256; GitHub também.',
    },
  ],

  credentialFields: [
    {
      key: 'signingSecret',
      label: 'Segredo de assinatura',
      type: 'secret',
      required: false,
      supportsTemplate: false,
      help: 'Só é necessário se "Exigir assinatura HMAC" estiver ativo.',
    },
  ],

  refineConfig(config) {
    const problems: string[] = [];
    if (config.requireSignature === true && !config.signatureHeader) {
      problems.push(
        'Informe o cabeçalho da assinatura quando a verificação HMAC estiver ativa.',
      );
    }
    return problems;
  },

  /**
   * Verifica a assinatura HMAC-SHA256 do corpo cru.
   *
   * Precisa ser o corpo CRU, byte a byte: reserializar o JSON muda
   * espaços e ordem de chaves, e o hash não bate mais. Por isso a rota do
   * webhook guarda o Buffer original antes de parsear.
   */
  verifyRequest({ rawBody, headers, config, credentials }) {
    if (config.requireSignature !== true) return { ok: true };

    const secret = credentials?.signingSecret;
    if (!secret) {
      return {
        ok: false,
        reason: 'Verificação de assinatura ativa, mas a credencial não tem signingSecret.',
      };
    }

    const headerName = String(config.signatureHeader ?? 'x-hub-signature-256').toLowerCase();
    const received = headers[headerName];
    if (!received) {
      return { ok: false, reason: `Cabeçalho ${headerName} ausente.` };
    }

    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    // Comparar tamanho antes evita o throw do timingSafeEqual; a
    // comparação em si é em tempo constante para não vazar o hash por timing.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Assinatura inválida.' };
    }

    return { ok: true };
  },
};
