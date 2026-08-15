import { useCallback, useEffect, useState } from 'react';
import { api, auth, hasSession } from './lib/api';
import { Icon } from './components/icons';
import { Card, PrimaryButton, Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { AutomationsPage } from './pages/Automations';
import { IntegrationsPage } from './pages/Integrations';
import { ExecutionsPage } from './pages/Executions';
import { CredentialsPage } from './pages/Credentials';

type View = 'automations' | 'integrations' | 'executions' | 'credentials' | 'settings';

const PAGE_META: Record<View, { title: string; subtitle: string }> = {
  automations: {
    title: 'Automações',
    subtitle:
      'Fluxos entre webhooks, agendamentos e modelos de IA. Cada automação roda isolada e registra suas execuções.',
  },
  integrations: {
    title: 'Integrações',
    subtitle:
      'Tudo que a plataforma sabe fazer hoje. Conecte credenciais aqui e consulte o que está disponível antes de montar um fluxo.',
  },
  executions: {
    title: 'Execuções',
    subtitle:
      'Histórico cronológico. Expanda uma linha para ver o payload processado e o tempo de cada etapa.',
  },
  credentials: {
    title: 'Credenciais',
    subtitle: 'Chaves e conexões usadas pelos fluxos, com prévia mascarada.',
  },
  settings: {
    title: 'Configurações',
    subtitle: 'Preferências da conta e do worker de execução.',
  },
};

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>('automations');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [createSignal, setCreateSignal] = useState(0);
  const [filterAutomationId, setFilterAutomationId] = useState<string | undefined>();
  const [stats, setStats] = useState<{ total: number; active: number } | null>(null);

  // Tenta restaurar a sessão pelo refresh token guardado, para não pedir
  // login a cada recarga da página.
  useEffect(() => {
    if (!hasSession()) {
      setAuthed(false);
      return;
    }
    void auth
      .restore()
      .then((ok) => setAuthed(ok))
      .catch(() => setAuthed(false));
  }, []);

  // O cliente HTTP avisa quando a renovação falhou de vez.
  useEffect(() => {
    const onExpired = (): void => setAuthed(false);
    window.addEventListener('orbita:session-expired', onExpired);
    return () => window.removeEventListener('orbita:session-expired', onExpired);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2600);
  }, []);

  useEffect(() => {
    if (authed !== true) return;
    void api.stats
      .call(api)
      .then((s) => setStats(s.automations))
      .catch(() => setStats(null));
  }, [authed, view]);

  if (authed === null) return <Spinner label="Restaurando sessão" />;
  if (!authed) return <LoginPage onSuccess={() => setAuthed(true)} />;

  const meta = PAGE_META[view];

  const goTo = (next: View): void => {
    setView(next);
    if (next !== 'executions') setFilterAutomationId(undefined);
  };

  return (
    <div className="flex min-h-screen bg-void text-ink">
      <aside className="sticky top-0 flex h-screen w-[252px] shrink-0 flex-col border-r border-[#1A1A24] bg-surface px-4 pb-[18px] pt-[22px] max-lg:hidden">
        <div className="flex items-center gap-3 px-2 pb-6">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-linear-140 from-accent to-accent-alt">
            <span className="h-[11px] w-[11px] rotate-45 rounded-[3px] border-2 border-white" />
          </div>
          <div className="flex flex-col gap-px">
            <span className="font-display text-[15.5px] font-semibold tracking-[-0.02em]">
              Órbita
            </span>
            <span className="text-[10.5px] tracking-[0.04em] text-ink-dim">
              Método CRM · Automações
            </span>
          </div>
        </div>

        <div className="px-2.5 pb-2.5 text-[10px] uppercase tracking-[0.13em] text-ink-faint">
          Plataforma
        </div>

        <nav className="flex flex-col gap-[3px]">
          <NavItem icon="zap" label="Automações" active={view === 'automations'} onClick={() => goTo('automations')} badge={stats?.total} />
          <NavItem icon="plug" label="Integrações" active={view === 'integrations'} onClick={() => goTo('integrations')} />
          <NavItem icon="list" label="Execuções" active={view === 'executions'} onClick={() => goTo('executions')} />
          <NavItem icon="key" label="Credenciais" active={view === 'credentials'} onClick={() => goTo('credentials')} />
          <NavItem icon="settings" label="Configurações" active={view === 'settings'} onClick={() => goTo('settings')} />
        </nav>

        <div className="mt-auto flex flex-col gap-3.5">
          <div className="rounded-xl border border-[#1E1E2A] bg-raised p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(53,201,139,0.14)]" />
              <span className="text-xs font-semibold">Worker online</span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-dim">
              {stats ? `${stats.active} de ${stats.total} automações ativas` : 'Consultando…'}
            </p>
          </div>

          <button
            type="button"
            onClick={async () => {
              await auth.logout();
              setAuthed(false);
            }}
            className="cursor-pointer rounded-lg px-2 py-2 text-left text-[12px] text-ink-dim transition-colors hover:text-ink"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-[#15151E] px-9 pb-6 pt-[30px]">
          <div className="flex flex-col gap-[7px]">
            <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.03em]">
              {meta.title}
            </h1>
            <p className="m-0 max-w-[60ch] text-[13.5px] text-[#74748C]">{meta.subtitle}</p>
          </div>

          {view === 'automations' && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-[38px] items-center gap-2 rounded-[10px] border border-[#22222E] bg-raised px-3">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6E6E85" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="m10.5 10.5 3 3" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar automação"
                  aria-label="Buscar automação"
                  className="w-[168px] border-0 bg-transparent text-[13px] text-ink outline-none"
                />
              </div>
              <PrimaryButton onClick={() => setCreateSignal((n) => n + 1)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
                Nova Automação
              </PrimaryButton>
            </div>
          )}
        </header>

        {view === 'automations' && (
          <AutomationsPage
            query={query}
            onToast={showToast}
            createSignal={createSignal}
            onViewLogs={(id) => {
              setFilterAutomationId(id);
              setView('executions');
            }}
          />
        )}
        {view === 'integrations' && <IntegrationsPage onToast={showToast} />}
        {view === 'executions' && <ExecutionsPage automationId={filterAutomationId} />}
        {view === 'credentials' && (
          <CredentialsPage onGoToIntegrations={() => goTo('integrations')} />
        )}
        {view === 'settings' && <SettingsPage />}
      </main>

      {toast && (
        <div
          role="status"
          className="fixed bottom-[26px] left-1/2 z-90 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-line-strong bg-overlay px-[18px] py-[11px] text-[13px] shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {toast}
        </div>
      )}
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: 'zap' | 'plug' | 'list' | 'key' | 'settings';
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 px-2.5 py-2.5 text-left text-[13.5px] transition-colors ${
        active
          ? 'bg-accent/13 font-medium text-[#DCDCF5] shadow-[inset_0_0_0_1px_rgba(91,108,255,0.28)]'
          : 'bg-transparent text-ink-muted hover:text-ink-soft'
      }`}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-auto font-mono text-[11px] text-[#7A7A94]">{badge}</span>
      )}
    </button>
  );
}

function SettingsPage() {
  return (
    <div className="px-9 pb-11 pt-[26px]">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="m-0 font-display text-base font-semibold">Worker de execução</h2>
        <p className="m-0 text-[13px] leading-relaxed text-ink-dim">
          Concorrência, timeout padrão das ações, retentativas e retenção do histórico
          são configurados por variáveis de ambiente no servidor
          (<code className="font-mono text-[12px] text-[#9FB6E8]">WORKER_CONCURRENCY</code>,{' '}
          <code className="font-mono text-[12px] text-[#9FB6E8]">ACTION_DEFAULT_TIMEOUT_MS</code>,{' '}
          <code className="font-mono text-[12px] text-[#9FB6E8]">EXECUTION_RETENTION_DAYS</code>).
          Editá-los pelo painel entra numa fase futura.
        </p>
      </Card>
    </div>
  );
}
