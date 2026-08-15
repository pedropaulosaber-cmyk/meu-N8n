import { useEffect, useState } from 'react';
import type { CredentialPublic, IntegrationCatalogItem } from '@orbita/shared';
import { api } from '../lib/api';
import { Card, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { IntegrationIcon } from '../components/icons';

/**
 * Lista plana de credenciais.
 *
 * O cadastro em si acontece na aba Integrações, junto do módulo que a
 * usa — que é onde o contexto ajuda a entender qual chave vai onde. Esta
 * tela serve para auditoria: o que existe, de quem é e quando foi usada.
 */
export function CredentialsPage({ onGoToIntegrations }: { onGoToIntegrations: () => void }) {
  const [credentials, setCredentials] = useState<CredentialPublic[]>([]);
  const [catalog, setCatalog] = useState<IntegrationCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [credentialsRes, catalogRes] = await Promise.all([
        api.credentials.list(),
        api.integrations(),
      ]);
      setCredentials(credentialsRes.items);
      setCatalog(catalogRes.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar credenciais');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <Spinner label="Carregando credenciais" />;

  return (
    <div className="flex flex-col gap-[18px] px-9 pb-11 pt-[26px]">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {credentials.length === 0 ? (
        <EmptyState
          title="Nenhuma credencial cadastrada"
          description="As credenciais são cadastradas junto da integração que as usa, na aba Integrações."
          action={
            <button
              type="button"
              onClick={onGoToIntegrations}
              className="cursor-pointer text-[13px] text-accent hover:underline"
            >
              Ir para Integrações
            </button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_140px] gap-4 border-b border-line-soft px-[22px] py-2.5 text-[10px] uppercase tracking-[0.12em] text-ink-faint max-lg:hidden">
            <div>Credencial</div>
            <div>Integração</div>
            <div>Valor</div>
            <div>Último uso</div>
          </div>

          {credentials.map((credential) => {
            const module = catalog.find((c) => c.id === credential.integrationId);
            return (
              <div
                key={credential.id}
                className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_140px] items-center gap-4 border-b border-line px-[22px] py-4 last:border-0 max-lg:grid-cols-1 max-lg:gap-2"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[#242432]"
                    style={{
                      background: `${module?.color ?? '#5B6CFF'}1F`,
                      color: module?.color ?? '#5B6CFF',
                    }}
                  >
                    <IntegrationIcon name={module?.icon ?? 'key'} size={14} />
                  </div>
                  <span className="truncate text-[13px]">{credential.name}</span>
                </div>

                <span className="truncate text-[12.5px] text-[#A9A9C0]">
                  {module?.name ?? credential.integrationId}
                </span>

                <span className="truncate font-mono text-[11.5px] text-ink-faint">
                  {Object.entries(credential.preview)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </span>

                <span className="font-mono text-[11.5px] text-ink-dim">
                  {credential.lastUsedAt
                    ? new Date(credential.lastUsedAt).toLocaleDateString('pt-BR')
                    : 'nunca usada'}
                </span>
              </div>
            );
          })}
        </Card>
      )}

      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        Os segredos são cifrados com AES-256-GCM antes de ir para o banco e nunca
        retornam em texto para o painel — só a prévia mascarada acima.
      </p>
    </div>
  );
}
