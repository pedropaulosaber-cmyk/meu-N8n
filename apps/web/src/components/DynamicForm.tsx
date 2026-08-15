import { useEffect, useState } from 'react';
import type { FieldDescriptor } from '@orbita/shared';
import { api } from '../lib/api';
import { Field, Select, TextArea, TextInput, Toggle } from './ui';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Formulário gerado a partir de descritores de campo
 * ─────────────────────────────────────────────────────────────────────
 *
 * Este componente é o retorno prático da decisão de arquitetura central.
 * Ele não sabe o que é Gemini, webhook ou WhatsApp — recebe um
 * `FieldDescriptor[]` vindo do registry e renderiza.
 *
 * Consequência: quando uma integração nova é registrada no backend, o
 * formulário dela aparece aqui funcionando, com validação e tudo, sem
 * uma linha escrita neste arquivo.
 */

interface DynamicFormProps {
  fields: FieldDescriptor[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Caminhos oferecidos no seletor de variáveis dos campos com template. */
  availableVariables?: string[];
}

export function DynamicForm({
  fields,
  values,
  onChange,
  availableVariables = [],
}: DynamicFormProps) {
  const setValue = (key: string, value: unknown): void => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="flex flex-col gap-[18px]">
      {fields.map((field) => (
        <DynamicField
          key={field.key}
          field={field}
          value={values[field.key]}
          allValues={values}
          onChange={(v) => setValue(field.key, v)}
          availableVariables={availableVariables}
        />
      ))}
    </div>
  );
}

function DynamicField({
  field,
  value,
  allValues,
  onChange,
  availableVariables,
}: {
  field: FieldDescriptor;
  value: unknown;
  allValues: Record<string, unknown>;
  onChange: (v: unknown) => void;
  availableVariables: string[];
}) {
  const [dynamicOptions, setDynamicOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Campos como `model` dependem de `provider`. Quando a dependência muda,
  // recarregamos as opções do backend — o painel não guarda catálogo de
  // modelo nenhum, quem sabe isso é o registry.
  const dependency = field.optionsDependOn;
  const dependencyValue = dependency ? allValues[dependency] : undefined;

  useEffect(() => {
    if (!dependency) return;

    let cancelled = false;
    setLoadingOptions(true);

    api
      .integrationOptions(dependency, allValues)
      .then((res) => {
        if (!cancelled) setDynamicOptions(res.options);
      })
      .catch(() => {
        if (!cancelled) setDynamicOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
    // `allValues` inteiro na dependência causaria refetch a cada tecla
    // digitada em qualquer campo. Só o valor de que este campo depende
    // deve provocar recarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency, dependencyValue]);

  const options = field.optionsDependOn ? dynamicOptions : (field.options ?? []);

  const help = field.supportsTemplate
    ? [field.help, 'Aceita variáveis como {{ trigger.body.campo }}.']
        .filter(Boolean)
        .join(' ')
    : field.help;

  switch (field.type) {
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-4 rounded-[11px] border border-line-strong bg-inset px-3.5 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-[13px]">{field.label}</span>
            {help && <span className="text-[11px] text-ink-dim">{help}</span>}
          </div>
          <Toggle
            checked={value === true}
            onChange={() => onChange(value !== true)}
            label={field.label}
          />
        </div>
      );

    case 'select':
      return (
        <Field label={field.label} help={help} required={field.required}>
          <Select
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            options={options}
            placeholder={
              loadingOptions
                ? 'Carregando…'
                : options.length === 0 && field.optionsDependOn
                  ? `Escolha ${field.optionsDependOn} primeiro`
                  : 'Selecione'
            }
          />
        </Field>
      );

    case 'textarea':
    case 'code':
      return (
        <Field label={field.label} help={help} required={field.required}>
          <TextArea
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            placeholder={field.placeholder}
            rows={field.rows ?? 4}
            mono={field.type === 'code'}
          />
          {field.supportsTemplate && availableVariables.length > 0 && (
            <VariablePicker
              variables={availableVariables}
              onPick={(path) =>
                onChange(`${typeof value === 'string' ? value : ''}{{ ${path} }}`)
              }
            />
          )}
        </Field>
      );

    case 'number':
      return (
        <Field label={field.label} help={help} required={field.required}>
          <TextInput
            type="number"
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(v) => onChange(v === '' ? undefined : Number(v))}
            placeholder={field.placeholder}
          />
        </Field>
      );

    case 'secret':
      return (
        <Field label={field.label} help={help} required={field.required}>
          <TextInput
            type="password"
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            placeholder={field.placeholder ?? '••••••••'}
          />
        </Field>
      );

    case 'json':
      return (
        <Field
          label={field.label}
          help={[help, 'Formato JSON.'].filter(Boolean).join(' ')}
          required={field.required}
        >
          <JsonInput value={value} onChange={onChange} />
        </Field>
      );

    case 'text':
    default:
      return (
        <Field label={field.label} help={help} required={field.required}>
          <TextInput
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            placeholder={field.placeholder}
          />
        </Field>
      );
  }
}

/**
 * Editor de JSON que mantém o texto do usuário enquanto ele digita.
 *
 * Guardar só o objeto parseado faria o campo apagar caracteres sozinho no
 * meio da digitação — `{"a":` é JSON inválido e viraria `undefined`,
 * perdendo o que já foi escrito.
 */
function JsonInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(() =>
    value === undefined ? '' : JSON.stringify(value, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  const handle = (next: string): void => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      onChange(undefined);
      return;
    }
    try {
      onChange(JSON.parse(next));
      setError(null);
    } catch {
      setError('JSON inválido — corrija antes de salvar.');
    }
  };

  return (
    <>
      <TextArea value={text} onChange={handle} rows={5} mono placeholder="{}" />
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </>
  );
}

/** Atalhos para inserir variáveis sem decorar os caminhos disponíveis. */
function VariablePicker({
  variables,
  onPick,
}: {
  variables: string[];
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-fit cursor-pointer text-[11px] text-accent hover:underline"
      >
        {open ? 'Ocultar' : 'Inserir'} variável
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {variables.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => onPick(path)}
              className="cursor-pointer rounded-md border border-line-strong bg-inset px-2 py-1 font-mono text-[10.5px] text-[#9FB6E8] hover:border-accent"
            >
              {path}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
