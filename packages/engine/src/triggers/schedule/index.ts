import type { TriggerDefinition } from '../../registry/types.js';

/**
 * Agendamento por cron.
 *
 * O gatilho apenas declara a configuração; quem agenda de fato é o worker,
 * usando repeatable jobs do BullMQ. Assim o agendamento sobrevive a
 * reinício do processo — o estado vive no Redis, não em memória.
 */
export const scheduleTrigger: TriggerDefinition = {
  kind: 'trigger',
  id: 'schedule',
  name: 'Agendamento',
  description:
    'Executa a automação em horários fixos, por expressão cron. Útil para rotinas diárias como follow-up e sincronização.',
  icon: 'clock',
  color: '#35C98B',
  activation: 'schedule',

  configFields: [
    {
      key: 'cron',
      label: 'Expressão cron',
      type: 'text',
      required: true,
      default: '0 9 * * *',
      supportsTemplate: false,
      placeholder: '0 9 * * *',
      help: 'minuto hora dia mês dia-da-semana. Ex: "0 9 * * *" = todo dia às 09:00.',
    },
    {
      key: 'timezone',
      label: 'Fuso horário',
      type: 'text',
      required: false,
      default: 'America/Sao_Paulo',
      supportsTemplate: false,
      help: 'Nome IANA, ex: America/Sao_Paulo.',
    },
  ],

  credentialFields: [],

  refineConfig(config) {
    const problems: string[] = [];
    const cron = String(config.cron ?? '').trim();

    const parts = cron.split(/\s+/);
    if (parts.length !== 5) {
      problems.push(
        'A expressão cron precisa ter 5 campos: minuto hora dia mês dia-da-semana.',
      );
      return problems;
    }

    // Validação de forma. A semântica fica com o parser do BullMQ no
    // agendamento — aqui só barramos o obviamente errado, cedo.
    const FIELD = /^(\*|\?|(\d+|\*)(\/\d+)?(-\d+)?)(,(\d+|\*)(\/\d+)?(-\d+)?)*$/;
    const names = ['minuto', 'hora', 'dia do mês', 'mês', 'dia da semana'];
    parts.forEach((part, i) => {
      if (!FIELD.test(part)) {
        problems.push(`Campo "${names[i]}" da expressão cron é inválido: "${part}".`);
      }
    });

    return problems;
  },
};
