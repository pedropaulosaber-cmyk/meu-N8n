import { useEffect, useMemo, useState } from 'react';
import type { AutomationPublic, IntegrationCatalogItem } from '@orbita/shared';
import { api } from '../lib/api';
import {
  Card,
  Chip,
  EmptyState,
  ErrorBanner,
  PrimaryButton,
  Spinner,
  Toggle,
} from '../components/ui';
import { AutomationEditor } from './AutomationEditor';

type Filter = 'Todas' | 'Ativas' | 'Com erro';

interface Props {
  query: string;
  onToast: (msg: string) => void;
  onViewLogs: (automationId: string) => void;
  createSignal: number;
}

const TRIGGER_STYLE: Record<string, { bg: string; color: string; round: boolean }> = {
  webhook: { bg: 'rgba(168,107,255,0.13)', color: '#A86BFF', round: false },
  schedule: { bg: 'rgba(243,179,61,0.13)', color: '#F3B33D', round: true },
};

export function AutomationsPage({ query, onToast, onViewLogs, createSignal }: Props) {
  const [automations, setAutomations] = useState<AutomationPublic[]>([]);
  const [catalog, setCatalog] = useState<IntegrationCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('Todas');
  const [editing, setEditing] = useState<AutomationPublic | 'new' | null>(null);

  const load = async (): Promise<void> => {
    setError(null);
    try {
      const [automationsRes, catalogRes] = await Promise.all([
        api.automations.list(),
        api.integrations(),
      ]);
      setAutomations(automationsRes.items);
      setCatalog(catalogRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar automações');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // O botão "Nova Automação" vive no cabeçalho global; o incremento do
  // contador é o sinal de que ele foi clicado.
  useEffect(() => {
    if (createSignal > 0) setEditing('new');
  }, [createSignal]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return automations.filter((a) => {
      if (filter === 'Ativas' && a.status !== 'active') return false;
      if (filter === 'Com erro' && a.lastRunStatus !== 'error') return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [automations, filter, query]);

  const toggleStatus = async (automation: AutomationPublic): Promise<void> => {
    const next = automation.status === 'active' ? 'inactive' : 'active';
    // Atualiza a lista na hora e reverte se o servidor recusar: o toggle
    // parecer instantâneo importa mais que a consistência de um segundo.
    setAutomations((prev) =>
      prev.map((a) => (a.id === automation.id ? { ...a, status: next } : a)),
    );
    try {
      await api.automations.update(automation.id, { status: next });
      onToast(next === 'active' ? `${automation.name} ativada` : `${automation.name} desativada`);
    } catch {
      setAutomations((prev) =>
        prev.map((a) => (a.id === automation.id ? { ...a, status: automation.status } : a)),
      );
      onToast('Não foi possível alterar o status');
    }
  };

  if (loading) return <Spinner label="Carregando automações" />;

  return (
    <div className="flex flex-col gap-[26px] px-9 pb-11 pt-[26px]">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-[22px] py-4">
          <div className="flex items-center gap-2.5">
            <h2 className="m-0 font-display text-[14.5px] font-semibold">
              Automações cadastradas
            </h2>
            <span className="rounded-full border border-[#23232F] px-2.5 py-0.5 font-mono text-[11px] text-ink-dim">
              {visible.length} de {automations.length}
            </span>
          </div>
          <div className="flex gap-1.5">
            {(['Todas', 'Ativas', 'Com erro'] as const).map((f) => (
              <Chip key={f} label={f} active={filter === f} onClick={() => setFilter(f)} />
            ))}
          </div>
        </div>

        {automations.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="Nenhuma automação ainda"
              description="Crie a primeira automação escolhendo um gatilho e as ações que devem rodar quando ele disparar."
              action={
                <PrimaryButton onClick={() => setEditing('new')}>
                  Criar primeira automação
                </PrimaryButton>
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,2.1fr)_minmax(0,1.5fr)_120px_minmax(0,1.4fr)_88px] gap-4 border-b border-line-soft px-[22px] py-2.5 text-[10px] uppercase tracking-[0.12em] text-ink-faint max-lg:hidden">
              <div>Automação</div>
              <div>Gatilho</div>
              <div>Status</div>
              <div>Última execução</div>
              <div />
            </div>

            {visible.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                catalog={catalog}
                onToggle={() => void toggleStatus(automation)}
                onEdit={() => setEditing(automation)}
                onLogs={() => onViewLogs(automation.id)}
                onRun={async () => {
                  try {
                    await api.automations.run(automation.id);
                    onToast('Execução enfileirada — acompanhe em Execuções');
                  } catch {
                    onToast('Falha ao disparar');
                  }
                }}
                onDelete={async () => {
                  if (!confirm(`Excluir a automação "${automation.name}"?`)) return;
                  await api.automations.remove(automation.id);
                  onToast('Automação excluída');
                  await load();
                }}
              />
            ))}

            {visible.length === 0 && (
              <div className="p-11 text-center text-[13px] text-ink-dim">
                Nenhuma automação encontrada para esse filtro.
              </div>
            )}
          </>
        )}
      </Card>

      {editing && (
        <AutomationEditor
          automation={editing === 'new' ? null : editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            onToast(msg);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AutomationRow({
  automation,
  catalog,
  onToggle,
  onEdit,
  onLogs,
  onRun,
  onDelete,
}: {
  automation: AutomationPublic;
  catalog: IntegrationCatalogItem[];
  onToggle: () => void;
  onEdit: () => void;
  onLogs: () => void;
  onRun: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    // `setTimeout` para o clique que abriu o menu não fechá-lo na mesma volta.
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [menuOpen]);

  const triggerModule = catalog.find(
    (c) => c.kind === 'trigger' && c.id === automation.triggerType,
  );
  const style = TRIGGER_STYLE[automation.triggerType] ?? {
    bg: 'rgba(53,201,139,0.13)',
    color: '#35C98B',
    round: true,
  };

  const initials = automation.name
    .replace(/[^A-Za-zÀ-ú ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const active = automation.status === 'active';
  const failed = automation.lastRunStatus === 'error';

  return (
    <div className="grid grid-cols-[minmax(0,2.1fr)_minmax(0,1.5fr)_120px_minmax(0,1.4fr)_88px] items-center gap-4 border-b border-line px-[22px] py-[18px] max-lg:grid-cols-1 max-lg:gap-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <div
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-[#242432] bg-[#131320] font-display text-[13px] font-semibold"
          style={{ color: style.color }}
        >
          {initials || '—'}
        </div>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <button
            type="button"
            onClick={onEdit}
            className="cursor-pointer truncate text-left text-[13.5px] font-medium text-ink hover:text-accent"
          >
            {automation.name}
          </button>
          <div className="truncate text-[11.5px] text-[#6A6A82]">
            {automation.description || `${automation.actions.length} ação(ões) configurada(s)`}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
          style={{ background: style.bg }}
        >
          <span
            className="h-[7px] w-[7px]"
            style={{
              background: style.color,
              borderRadius: style.round ? '50%' : '2px',
            }}
          />
        </div>
        <span className="truncate text-[12.5px] text-[#A9A9C0]">
          {triggerModule?.name ?? automation.triggerType}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <Toggle
          checked={active}
          onChange={onToggle}
          label={`${active ? 'Desativar' : 'Ativar'} ${automation.name}`}
        />
        <span
          className="text-xs"
          style={{ color: active ? '#35C98B' : '#6A6A82' }}
        >
          {active ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <div className="flex flex-col gap-[3px]">
        <span className="font-mono text-[12.5px] text-ink-soft">
          {formatDateTime(automation.lastRunAt)}
        </span>
        {automation.lastRunStatus && (
          <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: failed ? '#FF5D6C' : '#5F8F78' }}>
            <span
              className="h-[5px] w-[5px] rounded-full"
              style={{ background: failed ? '#FF5D6C' : '#5F8F78' }}
            />
            {failed ? 'Erro na execução' : 'Sucesso'}
          </span>
        )}
      </div>

      <div className="relative flex justify-end gap-1">
        <button
          type="button"
          onClick={() => void onRun()}
          title="Testar agora"
          aria-label={`Testar ${automation.name} agora`}
          className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[9px] border border-transparent text-[#7A7A94] transition-colors hover:border-[#2E2E40] hover:bg-hover hover:text-ink"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.5 3.2v9.6l8-4.8z" />
          </svg>
        </button>

        <button
          type="button"
          aria-label={`Ações de ${automation.name}`}
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className={`flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[9px] border text-[#7A7A94] transition-colors ${
            menuOpen ? 'border-[#2E2E40] bg-hover' : 'border-transparent hover:bg-hover'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3.2" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="8" cy="12.8" r="1.3" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-[34px] z-30 flex w-44 flex-col gap-0.5 rounded-xl border border-[#262634] bg-overlay p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
            <MenuItem onClick={onEdit}>Editar</MenuItem>
            <MenuItem onClick={onLogs}>Ver execuções</MenuItem>
            {automation.webhookUrl && (
              <MenuItem
                onClick={() => {
                  void navigator.clipboard?.writeText(automation.webhookUrl!);
                }}
              >
                Copiar URL do webhook
              </MenuItem>
            )}
            <div className="my-1 h-px bg-[#23232F]" />
            <MenuItem danger onClick={() => void onDelete()}>
              Excluir
            </MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[12.5px] transition-colors ${
        danger
          ? 'text-[#FF7A86] hover:bg-danger/10'
          : 'text-[#D6D6E6] hover:bg-[#1E1E2A]'
      }`}
    >
      {children}
    </button>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
