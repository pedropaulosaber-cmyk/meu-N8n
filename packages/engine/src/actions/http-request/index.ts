import { ActionError, type ActionDefinition } from '../../registry/types.js';

interface HttpRequestConfig {
  url: string;
  method: string;
  headers?: unknown;
  body?: unknown;
  parseJson?: boolean;
}

/**
 * Chamada HTTP configurável.
 *
 * É a ação-curinga: enquanto uma integração dedicada não existe, dá para
 * falar com quase qualquer serviço por aqui. Quando um serviço vira uso
 * recorrente, promova para módulo próprio — fica mais seguro (campos
 * validados) e mais simples de configurar.
 */
export const httpRequestAction: ActionDefinition<HttpRequestConfig> = {
  kind: 'action',
  id: 'http-request',
  name: 'Requisição HTTP',
  description:
    'Chama uma API externa com método, cabeçalhos e corpo configuráveis. Curinga para serviços sem integração dedicada.',
  icon: 'globe',
  color: '#3E8BFF',

  configFields: [
    {
      key: 'url',
      label: 'URL',
      type: 'text',
      required: true,
      supportsTemplate: true,
      placeholder: 'https://api.exemplo.com/leads',
    },
    {
      key: 'method',
      label: 'Método',
      type: 'select',
      required: true,
      default: 'POST',
      supportsTemplate: false,
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'PATCH', label: 'PATCH' },
        { value: 'DELETE', label: 'DELETE' },
      ],
    },
    {
      key: 'headers',
      label: 'Cabeçalhos (JSON)',
      type: 'json',
      required: false,
      default: {},
      supportsTemplate: true,
      help: 'Ex: { "authorization": "Bearer {{ steps.0.output.token }}" }',
    },
    {
      key: 'body',
      label: 'Corpo (JSON)',
      type: 'json',
      required: false,
      supportsTemplate: true,
    },
    {
      key: 'parseJson',
      label: 'Interpretar resposta como JSON',
      type: 'boolean',
      required: false,
      default: true,
      supportsTemplate: false,
    },
  ],

  credentialFields: [],

  async run(ctx) {
    const { url, method } = ctx.config;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new ActionError(`URL inválida: "${url}"`, 'INVALID_URL', { url }, false);
    }

    // Só HTTP(S). Sem isto, um `file://` interpolado de um webhook viraria
    // leitura de arquivo do servidor.
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new ActionError(
        `Protocolo não permitido: ${parsedUrl.protocol}`,
        'INVALID_PROTOCOL',
        { protocol: parsedUrl.protocol },
        false,
      );
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (ctx.config.headers && typeof ctx.config.headers === 'object') {
      for (const [k, v] of Object.entries(ctx.config.headers as Record<string, unknown>)) {
        headers[k.toLowerCase()] = String(v);
      }
    }

    const hasBody = method !== 'GET' && method !== 'DELETE' && ctx.config.body !== undefined;

    ctx.logger.info({ url: parsedUrl.origin + parsedUrl.pathname, method }, 'requisição HTTP');

    let response: Response;
    try {
      response = await fetch(parsedUrl, {
        method,
        headers,
        ...(hasBody && { body: JSON.stringify(ctx.config.body) }),
        signal: ctx.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ActionError('Tempo esgotado na requisição', 'HTTP_TIMEOUT', {}, true);
      }
      throw new ActionError(
        'Falha de rede na requisição',
        'HTTP_NETWORK_ERROR',
        { cause: err instanceof Error ? err.message : String(err) },
        true,
      );
    }

    const text = await response.text();
    let parsed: unknown = text;
    if (ctx.config.parseJson !== false && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Resposta não-JSON não é erro: devolvemos o texto cru.
      }
    }

    if (!response.ok) {
      throw new ActionError(
        `Serviço respondeu ${response.status}`,
        'HTTP_ERROR_RESPONSE',
        { status: response.status, body: parsed },
        // 5xx e 429 costumam passar na retentativa; 4xx não.
        response.status >= 500 || response.status === 429,
      );
    }

    return {
      status: response.status,
      body: parsed,
      headers: Object.fromEntries(response.headers.entries()),
    };
  },
};
