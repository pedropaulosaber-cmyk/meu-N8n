/**
 * ─────────────────────────────────────────────────────────────────────
 *  ESQUELETO — novo gatilho
 * ─────────────────────────────────────────────────────────────────────
 *
 * Copie para `../<seu-gatilho>/index.ts`, preencha e registre em
 * `../../registry/index.ts`.
 *
 * Exemplos reais: ../webhook/ (com verificação HMAC) e ../schedule/ (cron).
 *
 * O gatilho de WhatsApp da próxima fase é exatamente este molde: a API da
 * Meta chama um webhook e assina o corpo com HMAC-SHA256 — o mesmo
 * mecanismo que `../webhook/` já implementa.
 */

import type { TriggerDefinition } from '../../registry/types.js';

export const meuGatilho: TriggerDefinition = {
  kind: 'trigger',
  id: 'meu-gatilho', // ← único e estável; vai para o banco
  name: 'Meu Gatilho',
  description: 'Uma frase explicando quando dispara. Aparece na aba Integrações.',
  icon: 'webhook',
  color: '#5B6CFF',

  /**
   * Como o gatilho é acionado:
   *   'webhook'  → o motor expõe URL pública e roteia por token
   *   'schedule' → o worker agenda por cron (repeatable job do BullMQ)
   *   'manual'   → só pelo botão "Testar agora" do painel
   */
  activation: 'webhook',

  configFields: [
    {
      key: 'evento',
      label: 'Tipo de evento',
      type: 'select',
      required: true,
      default: 'mensagem',
      supportsTemplate: false,
      options: [
        { value: 'mensagem', label: 'Mensagem recebida' },
        { value: 'status', label: 'Mudança de status' },
      ],
    },
  ],

  credentialFields: [
    {
      key: 'appSecret',
      label: 'App Secret',
      type: 'secret',
      required: true,
      supportsTemplate: false,
      help: 'Usado para conferir a assinatura das requisições recebidas.',
    },
  ],

  /**
   * Confirma que a requisição veio mesmo de quem diz ter vindo.
   *
   * Implemente sempre que o serviço externo assinar o corpo — é o que
   * impede alguém que descubra a URL de disparar a automação à vontade.
   *
   * Use SEMPRE o `rawBody`: reserializar o JSON muda espaços e ordem de
   * chaves, e o hash deixa de bater.
   *
   * Use SEMPRE comparação em tempo constante (`timingSafeEqual`) — comparar
   * com `===` vaza, pelo tempo de resposta, quantos bytes iniciais bateram,
   * o que permite descobrir a assinatura byte a byte.
   *
   * Ver a implementação completa em ../webhook/index.ts.
   */
  verifyRequest({ rawBody, headers, credentials }) {
    const secret = credentials?.appSecret;
    if (!secret) {
      return { ok: false, reason: 'Credencial sem appSecret.' };
    }

    const assinatura = headers['x-assinatura'];
    if (!assinatura) {
      return { ok: false, reason: 'Cabeçalho de assinatura ausente.' };
    }

    // const esperado = createHmac('sha256', secret).update(rawBody).digest('hex');
    // if (!timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado))) {
    //   return { ok: false, reason: 'Assinatura inválida.' };
    // }
    void rawBody;

    return { ok: true };
  },
};
