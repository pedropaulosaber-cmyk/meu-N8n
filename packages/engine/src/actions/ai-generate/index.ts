import { ActionError, type ActionDefinition } from '../../registry/types.js';

interface AiGenerateConfig {
  provider: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

/**
 * Chama um modelo de IA.
 *
 * Esta ação não conhece nenhum fornecedor — ela pede o provedor ao
 * registry pelo id configurado. Adicionar Claude ou DeepSeek amanhã não
 * muda uma linha deste arquivo, e automações existentes seguem
 * funcionando: trocar de modelo é trocar o valor de um dropdown.
 */
export const aiGenerateAction: ActionDefinition<AiGenerateConfig> = {
  kind: 'action',
  id: 'ai-generate',
  name: 'Chamar IA',
  description:
    'Envia um prompt para um modelo de IA e devolve o texto gerado. O provedor e o modelo são escolhidos por automação.',
  icon: 'sparkles',
  color: '#7C5CFF',

  configFields: [
    {
      key: 'provider',
      label: 'Provedor',
      type: 'select',
      required: true,
      supportsTemplate: false,
      // Opções preenchidas em runtime a partir dos provedores registrados.
      optionsDependOn: '$providers',
      help: 'Cadastre a credencial do provedor na aba Integrações.',
    },
    {
      key: 'model',
      label: 'Modelo',
      type: 'select',
      required: true,
      supportsTemplate: false,
      // A lista muda conforme o provedor escolhido.
      optionsDependOn: 'provider',
    },
    {
      key: 'prompt',
      label: 'Prompt',
      type: 'textarea',
      required: true,
      rows: 8,
      supportsTemplate: true,
      placeholder: 'Resuma este lead: {{ trigger.body.mensagem }}',
      help: 'Use {{ }} para inserir dados do gatilho ou de passos anteriores.',
    },
    {
      key: 'systemPrompt',
      label: 'Instrução de sistema',
      type: 'textarea',
      required: false,
      rows: 3,
      supportsTemplate: true,
      placeholder: 'Você é um assistente especializado em mercado imobiliário.',
    },
    {
      key: 'temperature',
      label: 'Temperatura',
      type: 'number',
      required: false,
      default: 0.7,
      min: 0,
      max: 2,
      supportsTemplate: false,
      help: 'Perto de 0 é mais previsível; perto de 2, mais criativo.',
    },
    {
      key: 'maxTokens',
      label: 'Máximo de tokens',
      type: 'number',
      required: false,
      min: 1,
      max: 32_000,
      supportsTemplate: false,
    },
    {
      key: 'json',
      label: 'Exigir resposta em JSON',
      type: 'boolean',
      required: false,
      default: false,
      supportsTemplate: false,
      help: 'Peça o formato explicitamente no prompt também.',
    },
  ],

  /** A credencial usada é a do provedor escolhido, então não há campo próprio aqui. */
  credentialFields: [],

  async run(ctx) {
    const { provider: providerId, model, prompt } = ctx.config;

    const provider = ctx.providers.get(providerId);
    if (!provider) {
      throw new ActionError(
        `Provedor de IA "${providerId}" não está registrado`,
        'PROVIDER_NOT_FOUND',
        { providerId, disponiveis: ctx.providers.list().map((p) => p.id) },
        false,
      );
    }

    if (!ctx.credentials) {
      throw new ActionError(
        `Nenhuma credencial associada. Cadastre uma credencial de ${provider.name} na aba Integrações e selecione-a nesta ação.`,
        'CREDENTIAL_REQUIRED',
        { providerId },
        false,
      );
    }

    // O prompt já chega com os {{ }} resolvidos pelo runner.
    if (!prompt.trim()) {
      throw new ActionError(
        'O prompt ficou vazio depois de resolver as variáveis — confira se os caminhos {{ }} existem.',
        'EMPTY_PROMPT',
        {},
        false,
      );
    }

    ctx.logger.info(
      { provider: providerId, model, promptLength: prompt.length },
      'chamando provedor de IA',
    );

    const result = await provider.generate(
      {
        model,
        prompt,
        systemPrompt: ctx.config.systemPrompt,
        temperature: ctx.config.temperature,
        maxTokens: ctx.config.maxTokens,
        json: ctx.config.json,
      },
      ctx.credentials,
      { signal: ctx.signal, logger: ctx.logger },
    );

    ctx.logger.info(
      { provider: providerId, model: result.model, usage: result.usage },
      'resposta recebida',
    );

    // Se pediram JSON, entregamos já parseado para o próximo passo poder
    // navegar com {{ steps.N.output.json.campo }}.
    let parsed: unknown;
    if (ctx.config.json === true) {
      try {
        parsed = JSON.parse(result.text);
      } catch {
        ctx.logger.warn({}, 'resposta não é JSON válido apesar de json=true');
      }
    }

    return {
      text: result.text,
      ...(parsed !== undefined && { json: parsed }),
      model: result.model,
      provider: providerId,
      usage: result.usage,
    };
  },
};
