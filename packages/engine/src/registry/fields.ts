import { z } from 'zod';
import type { FieldDescriptor } from '@orbita/shared';

/**
 * Converte descritores de campo em um schema Zod.
 *
 * É o que evita duplicação: o módulo declara `configFields` uma vez e
 * ganha validação no backend, formulário no painel e card na aba
 * Integrações. Sem isso, a mesma informação viveria em três lugares.
 */
export function fieldsToZod(fields: FieldDescriptor[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let schema = baseSchemaFor(field);

    // Campo com template (`{{ ... }}`) só pode ser validado como texto:
    // o valor real só existe depois da resolução, em tempo de execução.
    // Ex: `maxTokens` recebendo `{{ trigger.body.limite }}`.
    if (field.supportsTemplate && field.type !== 'text' && field.type !== 'textarea') {
      schema = z.union([schema, z.string().regex(TEMPLATE_ONLY)]);
    }

    if (field.default !== undefined) {
      schema = schema.default(field.default);
    } else if (!field.required) {
      schema = schema.optional();
    }

    shape[field.key] = schema;
  }

  // `strict` de propósito: campo desconhecido no config indica módulo
  // desatualizado ou payload adulterado. Falhar cedo, com mensagem clara.
  return z.object(shape).strict();
}

/** Uma string que é exclusivamente um template, ex: "{{ trigger.body.x }}". */
const TEMPLATE_ONLY = /^\s*\{\{[^}]+\}\}\s*$/;

function baseSchemaFor(field: FieldDescriptor): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'code': {
      let s = z.string();
      if (field.required) s = s.min(1, `${field.label} é obrigatório`);
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      return s;
    }

    case 'secret':
      return field.required
        ? z.string().min(1, `${field.label} é obrigatório`)
        : z.string();

    case 'number': {
      let s = z.number();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      return s;
    }

    case 'boolean':
      return z.boolean();

    case 'select': {
      const values = (field.options ?? []).map((o) => o.value);
      if (values.length === 0) return z.string();
      // Options dinâmicas (ex: modelos que dependem do provedor) não podem
      // virar enum fechado aqui — a lista muda conforme o outro campo.
      if (field.optionsDependOn) return z.string().min(1);
      return z.enum(values as [string, ...string[]]);
    }

    case 'json':
      return z.unknown();

    default: {
      const exhaustive: never = field.type;
      throw new Error(`Tipo de campo não tratado: ${String(exhaustive)}`);
    }
  }
}

/** Extrai os defaults declarados — usado para pré-preencher o formulário. */
export function defaultsFor(fields: FieldDescriptor[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}
