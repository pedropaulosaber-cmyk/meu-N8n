import { useEffect, useState } from 'react';
import type {
  AutomationPublic,
  CredentialPublic,
  IntegrationCatalogItem,
} from '@orbita/shared';
import { api, ApiError } from '../lib/api';
import { DynamicForm } from '../components/DynamicForm';
import { Modal } from '../components/Modal';
import {
  ErrorBanner,
  Field,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  Select,
  TextInput,
} from '../components/ui';

/**
 * Editor de automação.
 *
 * O formulário de configuração do gatilho e de cada ação é montado pelo
 * DynamicForm a partir do catálogo — este arquivo não conhece nenhuma
 * integração específica.
 */

/**
 * Valores iniciais de um módulo, a partir dos defaults que ele declara.
 * Vale tanto para gatilho quanto para ação — os dois expõem configFields.
 */
function defaultsFor(
  module: IntegrationCatalogItem | undefined,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of module?.configFields ?? []) {
    if (field.default !== undefined) defaults[field.key] = field.default;
  }
  return defaults;
}

interface ActionDraft {
  actionType: string;
  config: Record<string, unknown>;
  credentialId: string | null;
  onError: 'stop' | 'continue';
  retries: number;
  timeoutMs: number;
}

export function AutomationEditor({
  automation,
  catalog,
  onClose,
  onSaved,
}: {
  automation: AutomationPublic | null;
  catalog: IntegrationCatalogItem[];
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const triggers = catalog.filter((c) => c.kind === 'trigger');
  const actions = catalog.filter((c) => c.kind === 'action');

  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const initialTriggerType = automation?.triggerType ?? triggers[0]?.id ?? 'webhook';
  const [triggerType, setTriggerType] = useState(initialTriggerType);
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(() =>
    // Automação nova precisa nascer com os defaults que o módulo declara.
    // Sem isto, um campo obrigatório com default (ex: método POST do
    // webhook) aparece vazio e só falha na validação ao salvar.
    automation
      ? automation.triggerConfig
      : defaultsFor(triggers.find((t) => t.id === initialTriggerType)),
  );
  const [draftActions, setDraftActions] = useState<ActionDraft[]>(
    automation?.actions.map((a) => ({
      actionType: a.actionType,
      config: a.config,
      credentialId: a.credentialId,
      onError: a.onError,
      retries: a.retries,
      timeoutMs: a.timeoutMs,
    })) ?? [],
  );
  const [credentials, setCredentials] = useState<CredentialPublic[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; issues?: string[] } | null>(null);

  useEffect(() => {
    void api.credentials
      .list()
      .then((res) => setCredentials(res.items))
      .catch(() => setCredentials([]));
  }, []);

  const triggerModule = triggers.find((t) => t.id === triggerType);

  // Ao trocar de gatilho, recomeça com os defaults do novo módulo — os
  // campos do anterior não fazem sentido aqui.
  const changeTrigger = (nextType: string): void => {
    setTriggerType(nextType);
    setTriggerConfig(defaultsFor(triggers.find((t) => t.id === nextType)));
  };

  const addAction = (actionType: string): void => {
    setDraftActions([
      ...draftActions,
      {
        actionType,
        config: defaultsFor(actions.find((a) => a.id === actionType)),
        credentialId: null,
        onError: 'stop',
        retries: 2,
        timeoutMs: 30_000,
      },
    ]);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim() || 'Automação sem nome',
        description,
        triggerType,
        triggerConfig,
        actions: draftActions.map((a) => ({
          actionType: a.actionType,
          config: a.config,
          credentialId: a.credentialId,
          onError: a.onError,
          retries: a.retries,
          timeoutMs: a.timeoutMs,
        })),
      };

      if (automation) {
        await api.automations.update(automation.id, payload);
        await onSaved('Alterações salvas');
      } else {
        // Nasce como rascunho: ativar é uma decisão consciente, depois de
        // testar. Evita automação disparando em produção sem querer.
        await api.automations.create({ ...payload, status: 'draft' });
        await onSaved('Automação criada como rascunho');
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, issues: err.issues }
          : { message: 'Falha ao salvar automação' },
      );
    } finally {
      setSaving(false);
    }
  };

  // Caminhos oferecidos no seletor de variáveis. As ações enxergam o
  // gatilho e as saídas das ações anteriores a elas.
  const variablesFor = (index: number): string[] => {
    const base = ['trigger.body', 'trigger.headers', 'trigger.receivedAt'];
    for (let i = 0; i < index; i++) {
      base.push(`steps.${i}.output`);
    }
    return base;
  };

  return (
    <Modal
      width={720}
      title={automation ? 'Editar automação' : 'Nova automação'}
      subtitle="Defina o gatilho e a sequência de ações. Cada ação recebe o resultado das anteriores."
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-ink-faint">
            {automation
              ? 'As alterações valem a partir da próxima execução.'
              : 'A automação nasce como rascunho até você ativá-la.'}
          </span>
          <GhostButton onClick={onClose}>Cancelar</GhostButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>
            {saving ? 'Salvando…' : automation ? 'Salvar alterações' : 'Criar automação'}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {error && <ErrorBanner message={error.message} issues={error.issues} />}

        <Field label="Nome da automação" required>
          <TextInput
            value={name}
            onChange={setName}
            placeholder="Ex: WhatsApp → CRM"
            autoFocus
          />
        </Field>

        <Field label="Descrição">
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder="O que essa automação faz"
          />
        </Field>

        {/* ── Gatilho ── */}
        <section className="flex flex-col gap-3.5 rounded-[14px] border border-line-soft bg-inset p-4">
          <SectionLabel>Gatilho</SectionLabel>
          <Select
            value={triggerType}
            onChange={changeTrigger}
            options={triggers.map((t) => ({ value: t.id, label: t.name }))}
          />
          {triggerModule && (
            <>
              <p className="text-[11.5px] leading-relaxed text-ink-dim">
                {triggerModule.description}
              </p>
              <DynamicForm
                fields={triggerModule.configFields}
                values={triggerConfig}
                onChange={setTriggerConfig}
              />
            </>
          )}
          {automation?.webhookUrl && (
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-line-strong bg-void p-3">
              <SectionLabel>URL do webhook</SectionLabel>
              <code className="break-all font-mono text-[11px] text-[#9FB6E8]">
                {automation.webhookUrl}
              </code>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(automation.webhookUrl!)}
                className="w-fit cursor-pointer text-[11px] text-accent hover:underline"
              >
                Copiar
              </button>
            </div>
          )}
        </section>

        {/* ── Ações ── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Ações · executadas em ordem</SectionLabel>
            <Select
              value=""
              onChange={(v) => v && addAction(v)}
              options={actions.map((a) => ({ value: a.id, label: `+ ${a.name}` }))}
              placeholder="Adicionar ação"
            />
          </div>

          {draftActions.length === 0 && (
            <p className="rounded-[14px] border border-dashed border-[#242430] p-6 text-center text-[12.5px] text-ink-dim">
              Nenhuma ação ainda. Adicione ao menos uma para a automação fazer algo.
            </p>
          )}

          {draftActions.map((draft, index) => {
            const module = actions.find((a) => a.id === draft.actionType);
            if (!module) return null;

            // Ação de IA usa a credencial do provedor escolhido no config;
            // as demais usam a credencial da própria integração.
            const credentialIntegration =
              draft.actionType === 'ai-generate'
                ? String(draft.config.provider ?? '')
                : module.id;
            const eligible = credentials.filter(
              (c) => c.integrationId === credentialIntegration,
            );

            const patch = (changes: Partial<ActionDraft>): void => {
              setDraftActions((prev) =>
                prev.map((a, i) => (i === index ? { ...a, ...changes } : a)),
              );
            };

            return (
              <div
                key={index}
                className="flex flex-col gap-3.5 rounded-[14px] border border-line-soft bg-inset p-4"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 font-mono text-[11px] text-accent">
                    {index + 1}
                  </span>
                  <span className="text-[13px] font-medium">{module.name}</span>
                  <div className="ml-auto flex gap-1">
                    {index > 0 && (
                      <IconAction
                        label="Mover para cima"
                        onClick={() =>
                          setDraftActions((prev) => {
                            const next = [...prev];
                            [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                            return next;
                          })
                        }
                      >
                        ↑
                      </IconAction>
                    )}
                    {index < draftActions.length - 1 && (
                      <IconAction
                        label="Mover para baixo"
                        onClick={() =>
                          setDraftActions((prev) => {
                            const next = [...prev];
                            [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                            return next;
                          })
                        }
                      >
                        ↓
                      </IconAction>
                    )}
                    <IconAction
                      label="Remover ação"
                      danger
                      onClick={() =>
                        setDraftActions((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      ×
                    </IconAction>
                  </div>
                </div>

                <DynamicForm
                  fields={module.configFields}
                  values={draft.config}
                  onChange={(config) => patch({ config })}
                  availableVariables={variablesFor(index)}
                />

                {credentialIntegration && (
                  <Field
                    label="Credencial"
                    help={
                      eligible.length === 0
                        ? 'Nenhuma credencial cadastrada para esta integração — conecte na aba Integrações.'
                        : undefined
                    }
                  >
                    <Select
                      value={draft.credentialId ?? ''}
                      onChange={(v) => patch({ credentialId: v || null })}
                      options={eligible.map((c) => ({ value: c.id, label: c.name }))}
                      placeholder="Nenhuma"
                    />
                  </Field>
                )}

                <div className="grid grid-cols-3 gap-2.5 max-sm:grid-cols-1">
                  <Field label="Se falhar">
                    <Select
                      value={draft.onError}
                      onChange={(v) => patch({ onError: v as 'stop' | 'continue' })}
                      options={[
                        { value: 'stop', label: 'Parar automação' },
                        { value: 'continue', label: 'Continuar' },
                      ]}
                    />
                  </Field>
                  <Field label="Retentativas">
                    <TextInput
                      type="number"
                      value={String(draft.retries)}
                      onChange={(v) => patch({ retries: Math.max(0, Number(v) || 0) })}
                    />
                  </Field>
                  <Field label="Timeout (ms)">
                    <TextInput
                      type="number"
                      value={String(draft.timeoutMs)}
                      onChange={(v) => patch({ timeoutMs: Math.max(1000, Number(v) || 30000) })}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </Modal>
  );
}

function IconAction({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-line-strong bg-transparent text-xs transition-colors ${
        danger ? 'text-ink-dim hover:border-danger hover:text-danger' : 'text-ink-dim hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
