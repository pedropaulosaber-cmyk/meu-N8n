/**
 * ─────────────────────────────────────────────────────────────────────
 *  ESQUELETO — adaptador de provedor de IA
 * ─────────────────────────────────────────────────────────────────────
 *
 * Exemplo usando a API da OpenAI, para mostrar a forma. Copie este
 * arquivo para `../<seu-provedor>/index.ts`, ajuste e registre.
 *
 * Está com a extensão `.example.ts` de propósito: o tsconfig não compila
 * este arquivo, então ele não entra no build enquanto for só referência.
 *
 * Compare com `../gemini/index.ts` — apesar das duas APIs serem bem
 * diferentes (formatos de corpo, de resposta e de erro), o contrato visto
 * pelo motor é idêntico. É essa uniformidade que permite trocar de
 * provedor por dropdown.
 */

import { ActionError, type AIProvider } from '../../registry/types.js';

const API_BASE = 'https://api.openai.com/v1';

export const openaiProvider: AIProvider = {
  kind: 'ai_provider',
  id: 'openai', // ← único e estável; vai para o banco
  name: 'OpenAI',
  description: 'Modelos GPT da OpenAI. Cobrado por uso, sem camada gratuita.',
  icon: 'sparkles',
  color: '#10A37F',

  // Vira o dropdown "Modelo" quando este provedor é escolhido.
  models: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini (rápido, barato)' },
    { value: 'gpt-4o', label: 'GPT-4o (mais capaz)' },
  ],

  // Vira o formulário de credencial na aba Integrações.
  credentialFields: [
    {
      key: 'apiKey',
      label: 'Chave de API',
      type: 'secret',
      required: true,
      supportsTemplate: false,
      help: 'Gere em https://platform.openai.com/api-keys',
    },
    // Campo opcional, para quem usa organização própria:
    // { key: 'organization', label: 'Organização', type: 'text',
    //   required: false, supportsTemplate: false },
  ],

  async generate(input, credentials, ctx) {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new ActionError(
        'Credencial da OpenAI sem a chave de API',
        'CREDENTIAL_MISSING_FIELD',
        { field: 'apiKey' },
      );
    }

    // Traduza o input padronizado para o formato do fornecedor.
    const messages: Array<{ role: string; content: string }> = [];
    if (input.systemPrompt) {
      messages.push({ role: 'system', content: input.systemPrompt });
    }
    messages.push({ role: 'user', content: input.prompt });

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages,
          ...(input.temperature !== undefined && { temperature: input.temperature }),
          ...(input.maxTokens !== undefined && { max_tokens: input.maxTokens }),
          ...(input.json === true && { response_format: { type: 'json_object' } }),
        }),
        // OBRIGATÓRIO: sem isto o timeout da ação não interrompe a chamada.
        signal: ctx.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ActionError('Tempo esgotado', 'PROVIDER_TIMEOUT', {}, true);
      }
      throw new ActionError('Falha de rede', 'PROVIDER_NETWORK_ERROR', {}, true);
    }

    if (!response.ok) {
      // Marque como retryable só o que adianta repetir.
      const retryable = response.status === 429 || response.status >= 500;
      throw new ActionError(
        `OpenAI retornou ${response.status}`,
        response.status === 401 ? 'CREDENTIAL_INVALID' : 'PROVIDER_ERROR',
        { status: response.status },
        retryable,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new ActionError('Resposta vazia', 'PROVIDER_EMPTY_RESPONSE', {}, false);
    }

    // Devolva sempre no formato padronizado — é isto que o motor entende.
    return {
      text,
      model: input.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  },
};
