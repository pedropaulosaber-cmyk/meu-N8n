import { ActionError, type AIProvider } from '../../registry/types.js';

/**
 * Adaptador do Google Gemini — primeiro provedor real da plataforma.
 *
 * Repare no que este arquivo NÃO faz: ele não sabe o que é uma automação,
 * não toca no banco e não conhece o motor. Ele só traduz o contrato
 * `AIProvider` para o formato da API do Google. Um provedor novo
 * (OpenAI, Claude, DeepSeek) é um arquivo irmão a este, com a mesma forma.
 *
 * Ver `../_template/` para o esqueleto comentado.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

export const geminiProvider: AIProvider = {
  kind: 'ai_provider',
  id: 'gemini',
  name: 'Google Gemini',
  description:
    'Modelos Gemini do Google. Tem camada gratuita generosa; acima dela o uso é cobrado pelo Google.',
  icon: 'sparkles',
  color: '#4285F4',

  models: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (rápido, barato)' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (mais barato)' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (mais capaz)' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],

  credentialFields: [
    {
      key: 'apiKey',
      label: 'Chave de API',
      type: 'secret',
      required: true,
      supportsTemplate: false,
      help: 'Gere em https://aistudio.google.com/apikey',
    },
  ],

  async generate(input, credentials, ctx) {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new ActionError(
        'Credencial do Gemini sem a chave de API',
        'CREDENTIAL_MISSING_FIELD',
        { field: 'apiKey' },
      );
    }

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: {
        ...(input.temperature !== undefined && { temperature: input.temperature }),
        ...(input.maxTokens !== undefined && { maxOutputTokens: input.maxTokens }),
        ...(input.json === true && { responseMimeType: 'application/json' }),
      },
    };

    if (input.systemPrompt) {
      body.systemInstruction = { parts: [{ text: input.systemPrompt }] };
    }

    let response: Response;
    try {
      response = await fetch(
        `${API_BASE}/models/${encodeURIComponent(input.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Em header, não na query string: URL costuma acabar em log de
            // proxy, header não.
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          // Repasse obrigatório: sem isto o timeout da ação não interrompe
          // a chamada e o slot do worker fica preso.
          signal: ctx.signal,
        },
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ActionError('Tempo esgotado ao chamar o Gemini', 'PROVIDER_TIMEOUT', {}, true);
      }
      throw new ActionError(
        'Falha de rede ao chamar o Gemini',
        'PROVIDER_NETWORK_ERROR',
        { cause: err instanceof Error ? err.message : String(err) },
        true,
      );
    }

    if (!response.ok) {
      throw mapHttpError(response.status, await safeReadError(response));
    }

    const data = (await response.json()) as GeminiResponse;

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      const reason = data.candidates?.[0]?.finishReason;
      // SAFETY significa que o filtro do Google bloqueou — repetir não resolve.
      throw new ActionError(
        reason === 'SAFETY'
          ? 'O Gemini bloqueou a resposta por política de conteúdo'
          : 'O Gemini não retornou texto',
        reason === 'SAFETY' ? 'PROVIDER_CONTENT_BLOCKED' : 'PROVIDER_EMPTY_RESPONSE',
        { finishReason: reason },
        false,
      );
    }

    return {
      text,
      model: input.model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
    };
  },
};

/**
 * Traduz o status HTTP para erro nosso, decidindo o que vale retentar.
 * Repetir um 401 só queima tempo; repetir um 429 ou 503 costuma resolver.
 */
function mapHttpError(status: number, message: string): ActionError {
  if (status === 401 || status === 403) {
    return new ActionError(
      'Chave de API do Gemini inválida ou sem permissão',
      'CREDENTIAL_INVALID',
      { status },
      false,
    );
  }
  if (status === 429) {
    return new ActionError(
      'Cota do Gemini excedida. Aguarde ou revise os limites no Google AI Studio.',
      'PROVIDER_RATE_LIMITED',
      { status },
      true,
    );
  }
  if (status >= 500) {
    return new ActionError(
      'Gemini indisponível no momento',
      'PROVIDER_UNAVAILABLE',
      { status },
      true,
    );
  }
  return new ActionError(
    `Gemini recusou a requisição: ${message}`,
    'PROVIDER_BAD_REQUEST',
    { status },
    false,
  );
}

/** Lê o corpo de erro sem deixar uma falha de parse mascarar o erro real. */
async function safeReadError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as GeminiResponse;
    return data.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
