import type {
  AuthTokens,
  AutomationPublic,
  CreateAutomationInput,
  CreateCredentialInput,
  CredentialPublic,
  ExecutionPublic,
  IntegrationCatalogItem,
  UpdateAutomationInput,
} from '@orbita/shared';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Cliente da API
 * ─────────────────────────────────────────────────────────────────────
 *
 * Sobre onde guardar os tokens: o access token fica só em memória, e o
 * refresh token no localStorage.
 *
 * Não é o ideal absoluto — cookie httpOnly seria imune a XSS —, mas o
 * backend hoje devolve tokens no corpo, e essa combinação já limita o
 * estrago: o access token (que dá acesso imediato) morre ao fechar a
 * aba, e o refresh é rotativo com detecção de reuso, então um roubo
 * derruba a sessão inteira na primeira renovação. Migrar para cookie
 * httpOnly está anotado como melhoria no docs/SECURITY.md.
 */

const REFRESH_STORAGE_KEY = 'orbita.refresh';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly issues?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeTokens(tokens: AuthTokens): void {
  accessToken = tokens.accessToken;
  try {
    localStorage.setItem(REFRESH_STORAGE_KEY, tokens.refreshToken);
  } catch {
    // Modo privado sem storage: a sessão dura só enquanto a aba viver.
  }
}

export function clearTokens(): void {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function hasSession(): boolean {
  return accessToken !== null || getStoredRefreshToken() !== null;
}

/**
 * Renova o access token.
 *
 * As chamadas concorrentes compartilham a mesma promise: sem isso, três
 * requisições expirando juntas disparariam três refreshes, e como o
 * token é rotativo, duas delas apresentariam um token já usado — o que o
 * backend trata (corretamente) como roubo e derruba a sessão.
 */
async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        clearTokens();
        return false;
      }

      storeTokens((await response.json()) as AuthTokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Uso interno: evita laço infinito de renovação. */
  isRetry?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, isRetry = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  // Token expirou: renova uma vez e repete a requisição original.
  if (response.status === 401 && !isRetry && getStoredRefreshToken()) {
    if (await refreshSession()) {
      return request<T>(path, { ...options, isRetry: true });
    }
    clearTokens();
    window.dispatchEvent(new CustomEvent('orbita:session-expired'));
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    issues?: string[];
  };

  if (!response.ok) {
    throw new ApiError(
      payload.error ?? `Erro ${response.status}`,
      response.status,
      payload.code,
      payload.issues,
    );
  }

  return payload as T;
}

// ── Autenticação ────────────────────────────────────────────────────
export const auth = {
  async login(email: string, password: string): Promise<AuthTokens> {
    const tokens = await request<AuthTokens>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    storeTokens(tokens);
    return tokens;
  },

  async logout(): Promise<void> {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      await request('/api/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      }).catch(() => {
        // Falha ao avisar o servidor não pode impedir a saída local.
      });
    }
    clearTokens();
  },

  me: () => request<{ user: { id: string; email: string } }>('/api/auth/me'),

  /** Restaura a sessão ao abrir o painel, usando o refresh guardado. */
  restore: refreshSession,
};

// ── Recursos ────────────────────────────────────────────────────────
export const api = {
  stats: () =>
    request<{
      automations: { total: number; active: number };
      executions24h: {
        total: number;
        errors: number;
        successRate: number;
        avgDurationMs: number;
      };
    }>('/api/stats'),

  integrations: () =>
    request<{ items: IntegrationCatalogItem[] }>('/api/integrations'),

  /** Opções de select que dependem de outro campo (ex: modelos do provedor). */
  integrationOptions: (dependsOn: string, config: Record<string, unknown>) =>
    request<{ options: Array<{ value: string; label: string }> }>(
      '/api/integrations/options',
      { method: 'POST', body: { dependsOn, config } },
    ),

  automations: {
    list: () => request<{ items: AutomationPublic[] }>('/api/automations'),
    get: (id: string) => request<AutomationPublic>(`/api/automations/${id}`),
    create: (input: CreateAutomationInput) =>
      request<AutomationPublic>('/api/automations', { method: 'POST', body: input }),
    update: (id: string, input: UpdateAutomationInput) =>
      request<AutomationPublic>(`/api/automations/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    remove: (id: string) =>
      request<void>(`/api/automations/${id}`, { method: 'DELETE' }),
    run: (id: string, payload: Record<string, unknown> = {}) =>
      request<{ executionId: string }>(`/api/automations/${id}/run`, {
        method: 'POST',
        body: { payload },
      }),
    rotateWebhook: (id: string) =>
      request<AutomationPublic>(`/api/automations/${id}/rotate-webhook`, {
        method: 'POST',
      }),
  },

  credentials: {
    list: () => request<{ items: CredentialPublic[] }>('/api/credentials'),
    create: (input: CreateCredentialInput) =>
      request<CredentialPublic>('/api/credentials', { method: 'POST', body: input }),
    update: (id: string, input: { name?: string; data?: Record<string, string> }) =>
      request<CredentialPublic>(`/api/credentials/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    remove: (id: string) =>
      request<void>(`/api/credentials/${id}`, { method: 'DELETE' }),
  },

  executions: {
    list: (params: { automationId?: string; status?: string; page?: number } = {}) => {
      const search = new URLSearchParams();
      if (params.automationId) search.set('automationId', params.automationId);
      if (params.status) search.set('status', params.status);
      if (params.page) search.set('page', String(params.page));
      const qs = search.toString();
      return request<{ items: ExecutionPublic[]; total: number }>(
        `/api/executions${qs ? `?${qs}` : ''}`,
      );
    },
    get: (id: string) => request<ExecutionPublic>(`/api/executions/${id}`),
  },
};
