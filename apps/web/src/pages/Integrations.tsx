import { useEffect, useMemo, useState } from 'react';
import {
  resolveIntegrationStatus,
  type CredentialPublic,
  type IntegrationCatalogItem,
} from '@orbita/shared';
import { api, ApiError } from '../lib/api';
import { DynamicForm } from '../components/DynamicForm';
import {
  Card,
  Chip,
  ErrorBanner,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  Spinner,
  StatusPill,
  TextInput,
  Field,
} from '../components/ui';
import { Modal } from '../components/Modal';
import { IntegrationIcon } from '../components/icons';

/**
 * Aba Integrações — catálogo do que a plataforma sabe fazer.
 *
 * Serve a dois usos: conectar credenciais sem precisar entrar numa
 * automação, e consultar rapidamente o que já está disponível antes de
 * montar um fluxo novo.
 *
 * Todo o conteúdo vem do registry do backend. Registrar um módulo novo
 * faz o card dele aparecer aqui sem alterar este arquivo.
 */

const KIND_LABEL = {
  trigger: 'Gatilho',
  action: 'Ação',
  ai_provider: 'Provedor de IA',
} as const;

type Filter = 'Todas' | 'Gatilhos' | 'Ações' | 'Provedores de IA' | 'Pendentes';

export function IntegrationsPage({ onToast }: { onToast: (msg: string) => void }) {
  const [catalog, setCatalog] = useState<IntegrationCatalogItem[]>([]);
  const [credentials, setCredentials] = useState<CredentialPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('Todas');
  const [connecting, setConnecting] = useState<IntegrationCatalogItem | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [catalogRes, credentialsRes] = await Promise.all([
        api.integrations(),
        api.credentials.list(),
      ]);
      setCatalog(catalogRes.items);
      setCredentials(credentialsRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar integrações');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    return catalog.filter((item) => {
      switch (filter) {
        case 'Gatilhos':
          return item.kind === 'trigger';
        case 'Ações':
          return item.kind === 'action';
        case 'Provedores de IA':
          return item.kind === 'ai_provider';
        case 'Pendentes':
          return resolveIntegrationStatus(item) === 'pending';
        default:
          return true;
      }
    });
  }, [catalog, filter]);

  const pendingCount = catalog.filter(
    (i) => resolveIntegrationStatus(i) === 'pending',
  ).length;

  if (loading) return <Spinner label="Carregando integrações" />;

  return (
    <div className="flex flex-col gap-[26px] px-9 pb-11 pt-[26px]">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="flex flex-wrap items-center gap-2">
        {(['Todas', 'Gatilhos', 'Ações', 'Provedores de IA', 'Pendentes'] as const).map(
          (f) => (
            <Chip
              key={f}
              label={f === 'Pendentes' && pendingCount > 0 ? `Pendentes (${pendingCount})` : f}
              active={filter === f}
              onClick={() => setFilter(f)}
            />
          ),
        )}
        <span className="ml-auto font-mono text-xs text-ink-dim">
          {catalog.length} integrações disponíveis
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
        {visible.map((item) => (
          <IntegrationCard
            key={`${item.kind}:${item.id}`}
            item={item}
            credentials={credentials.filter((c) => c.integrationId === item.id)}
            onConnect={() => setConnecting(item)}
            onDeleted={async () => {
              onToast('Credencial removida');
              await load();
            }}
          />
        ))}
      </div>

      {visible.length === 0 && (
        <div className="p-11 text-center text-[13px] text-ink-dim">
          Nenhuma integração neste filtro.
        </div>
      )}

      {connecting && (
        <ConnectModal
          item={connecting}
          onClose={() => setConnecting(null)}
          onSaved={async () => {
            setConnecting(null);
            onToast('Credencial conectada');
            await load();
          }}
        />
      )}
    </div>
  );
}

function IntegrationCard({
  item,
  credentials,
  onConnect,
  onDeleted,
}: {
  item: IntegrationCatalogItem;
  credentials: CredentialPublic[];
  onConnect: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const status = resolveIntegrationStatus(item);

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#242432]"
            style={{ background: `${item.color ?? '#5B6CFF'}1F`, color: item.color ?? '#5B6CFF' }}
          >
            <IntegrationIcon name={item.icon} />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="truncate text-[13.5px] font-medium">{item.name}</div>
            <div className="text-[11px] text-ink-dim">{KIND_LABEL[item.kind]}</div>
          </div>
        </div>

        {status === 'connected' && <StatusPill tone="success">Conectada</StatusPill>}
        {status === 'pending' && <StatusPill tone="warning">Pendente</StatusPill>}
        {status === 'optional' && (
          <StatusPill tone="neutral">Credencial opcional</StatusPill>
        )}
        {status === 'no_credential_needed' && (
          <StatusPill tone="neutral">Sem credencial</StatusPill>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-ink-dim">{item.description}</p>

      {item.models && item.models.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.models.slice(0, 3).map((m) => (
            <span
              key={m.value}
              className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-ink-dim"
            >
              {m.value}
            </span>
          ))}
          {item.models.length > 3 && (
            <span className="px-1 py-0.5 text-[10px] text-ink-faint">
              +{item.models.length - 3}
            </span>
          )}
        </div>
      )}

      {credentials.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line-soft bg-inset p-2.5">
          <SectionLabel>Credenciais</SectionLabel>
          {credentials.map((credential) => (
            <div key={credential.id} className="flex items-center gap-2 text-[11.5px]">
              <span className="truncate text-ink-soft">{credential.name}</span>
              <span className="ml-auto font-mono text-[10.5px] text-ink-faint">
                {Object.values(credential.preview)[0]}
              </span>
              <button
                type="button"
                aria-label={`Remover credencial ${credential.name}`}
                onClick={async () => {
                  if (!confirm(`Remover a credencial "${credential.name}"?`)) return;
                  await api.credentials.remove(credential.id);
                  await onDeleted();
                }}
                className="cursor-pointer text-ink-faint transition-colors hover:text-danger"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-[11.5px] text-ink-dim">
          {item.activeAutomationCount === 0
            ? 'Nenhuma automação ativa'
            : `${item.activeAutomationCount} automação${item.activeAutomationCount > 1 ? 'ões' : ''} ativa${item.activeAutomationCount > 1 ? 's' : ''}`}
        </span>
        {item.credentialFields.length > 0 && (
          <button
            type="button"
            onClick={onConnect}
            className="cursor-pointer rounded-lg border border-line-strong px-2.5 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-ink"
          >
            {credentials.length > 0 ? 'Adicionar' : 'Conectar'}
          </button>
        )}
      </div>
    </Card>
  );
}

function ConnectModal({
  item,
  onClose,
  onSaved,
}: {
  item: IntegrationCatalogItem;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(`${item.name} — principal`);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; issues?: string[] } | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.credentials.create({
        name: name.trim() || item.name,
        integrationId: item.id,
        kind: item.kind,
        // Os campos de segredo são sempre string; o backend valida a
        // forma contra o credentialFields do módulo.
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v ?? '')]),
        ),
      });
      await onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, issues: err.issues }
          : { message: 'Falha ao salvar credencial' },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Conectar ${item.name}`}
      subtitle="Os segredos são criptografados antes de ir para o banco e nunca voltam em texto para o painel."
      onClose={onClose}
      footer={
        <div className="flex gap-2.5">
          <GhostButton onClick={onClose}>Cancelar</GhostButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar credencial'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="flex flex-col gap-[18px]">
        {error && <ErrorBanner message={error.message} issues={error.issues} />}

        <Field label="Nome da credencial" help="Só para você identificar na lista.">
          <TextInput value={name} onChange={setName} autoFocus />
        </Field>

        <DynamicForm fields={item.credentialFields} values={data} onChange={setData} />
      </div>
    </Modal>
  );
}
