import { useCallback, useEffect, useState } from 'react';
import type { ExecutionPublic } from '@orbita/shared';
import { api } from '../lib/api';
import { Card, Chip, EmptyState, ErrorBanner, SectionLabel, Spinner, StatusPill } from '../components/ui';

type Filter = 'Todas' | 'Sucesso' | 'Erro';

/**
 * Histórico de execuções.
 *
 * Enquanto houver execução em andamento (`queued`/`running`), a lista se
 * atualiza sozinha a cada 3s — é o intervalo em que uma automação com
 * chamada de IA costuma terminar, e evita o usuário ficar recarregando.
 */
export function ExecutionsPage({ automationId }: { automationId?: string }) {
  const [executions, setExecutions] = useState<ExecutionPublic[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('Todas');
  const [expanded, setExpanded] = useState<Record<string, ExecutionPublic | 'loading'>>({});

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await api.executions.list({
        ...(automationId && { automationId }),
        ...(filter === 'Sucesso' && { status: 'success' }),
        ...(filter === 'Erro' && { status: 'error' }),
      });
      setExecutions(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar execuções');
    } finally {
      setLoading(false);
    }
  }, [automationId, filter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const hasPending = executions.some(
    (e) => e.status === 'queued' || e.status === 'running',
  );

  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [hasPending, load]);

  const toggle = async (execution: ExecutionPublic): Promise<void> => {
    if (expanded[execution.id]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[execution.id];
        return next;
      });
      return;
    }
    // O detalhe com os passos só é buscado ao expandir — a listagem
    // carregaria dados demais se trouxesse tudo de antemão.
    setExpanded((prev) => ({ ...prev, [execution.id]: 'loading' }));
    try {
      const full = await api.executions.get(execution.id);
      setExpanded((prev) => ({ ...prev, [execution.id]: full }));
    } catch {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[execution.id];
        return next;
      });
    }
  };

  if (loading) return <Spinner label="Carregando execuções" />;

  return (
    <div className="flex flex-col gap-[18px] px-9 pb-11 pt-[26px]">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="flex flex-wrap items-center gap-2">
        {(['Todas', 'Sucesso', 'Erro'] as const).map((f) => (
          <Chip key={f} label={f} active={filter === f} onClick={() => setFilter(f)} />
        ))}
        <span className="ml-auto font-mono text-xs text-ink-dim">
          {total} execuç{total === 1 ? 'ão' : 'ões'}
          {hasPending && ' · atualizando'}
        </span>
      </div>

      {executions.length === 0 ? (
        <EmptyState
          title="Nenhuma execução registrada"
          description="Assim que uma automação for disparada — por webhook ou pelo botão de teste — o histórico aparece aqui."
        />
      ) : (
        <Card className="overflow-hidden">
          {executions.map((execution) => {
            const detail = expanded[execution.id];
            const isOpen = detail !== undefined;

            return (
              <div key={execution.id} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => void toggle(execution)}
                  aria-expanded={isOpen}
                  className="grid w-full cursor-pointer grid-cols-[96px_minmax(0,1.6fr)_130px_110px_minmax(0,1fr)_24px] items-center gap-4 border-0 bg-transparent px-[22px] py-[15px] text-left transition-colors hover:bg-[#101018] max-lg:grid-cols-[80px_1fr_100px_24px]"
                >
                  <span className="font-mono text-xs text-[#7E7E98]">
                    {formatTime(execution.createdAt)}
                  </span>
                  <span className="truncate text-[13px] text-[#E4E4F0]">
                    {execution.automationName}
                  </span>
                  <span className="justify-self-start">
                    <StatusPill tone={toneFor(execution.status)}>
                      {labelFor(execution.status)}
                    </StatusPill>
                  </span>
                  <span className="font-mono text-xs text-[#8C8CA6] max-lg:hidden">
                    {formatDuration(execution.durationMs)}
                  </span>
                  <span className="truncate text-xs text-[#6A6A82] max-lg:hidden">
                    {execution.error?.message ?? summarize(execution.result)}
                  </span>
                  <span className="justify-self-end font-mono text-[11px] text-[#6A6A82]">
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>

                {detail === 'loading' && <Spinner label="Carregando detalhe" />}

                {detail && detail !== 'loading' && (
                  <div className="grid grid-cols-2 gap-3.5 px-[22px] pb-5 pt-1 max-lg:grid-cols-1">
                    <div className="rounded-xl border border-[#1E1E2A] bg-void p-4">
                      <SectionLabel>Payload processado</SectionLabel>
                      <pre className="mt-2.5 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-[#9FB6E8]">
                        {JSON.stringify(detail.triggerPayload, null, 2)}
                      </pre>
                    </div>

                    <div className="flex flex-col gap-2.5 rounded-xl border border-[#1E1E2A] bg-void p-4">
                      <SectionLabel>Etapas</SectionLabel>
                      {(detail.steps ?? []).map((step) => (
                        <div key={step.id} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: stepColor(step.status) }}
                            />
                            <span className="text-[12.5px] text-[#C4C4D8]">
                              {step.actionType}
                            </span>
                            {step.attempt > 1 && (
                              <span className="font-mono text-[10px] text-warning">
                                {step.attempt}ª tentativa
                              </span>
                            )}
                            <span className="ml-auto font-mono text-[11.5px] text-[#6A6A82]">
                              {formatDuration(step.durationMs)}
                            </span>
                          </div>
                          {step.error && (
                            <p className="ml-4 text-[11.5px] leading-relaxed text-[#FF9AA3]">
                              {step.error.code}: {step.error.message}
                            </p>
                          )}
                        </div>
                      ))}

                      {detail.result != null && (
                        <div className="mt-1 border-t border-[#1E1E2A] pt-2.5">
                          <SectionLabel>Resultado</SectionLabel>
                          <pre className="mt-1.5 max-h-40 overflow-auto font-mono text-[11.5px] leading-relaxed text-[#9FB6E8]">
                            {JSON.stringify(detail.result, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function toneFor(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'success') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'running' || status === 'queued') return 'warning';
  return 'neutral';
}

function labelFor(status: string): string {
  const labels: Record<string, string> = {
    success: 'Sucesso',
    error: 'Erro',
    running: 'Rodando',
    queued: 'Na fila',
    cancelled: 'Cancelada',
  };
  return labels[status] ?? status;
}

function stepColor(status: string): string {
  if (status === 'success') return '#35C98B';
  if (status === 'error') return '#FF5D6C';
  if (status === 'skipped') return '#3A3A4A';
  return '#F3B33D';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function summarize(result: unknown): string {
  if (result === null || result === undefined) return '—';
  if (typeof result === 'object' && 'text' in result) {
    return String((result as { text: unknown }).text).slice(0, 80);
  }
  return JSON.stringify(result).slice(0, 80);
}
