# Checklist de segurança

Estado de cada item exigido no escopo da Fase 1.

Legenda: ✅ implementado · 🟡 melhoria anotada para fase futura ·
📋 passo de deploy (depende do servidor, não de código)

---

## Autenticação e acesso

| Item | Estado | Onde |
|---|---|---|
| Hash de senha forte (argon2id) | ✅ | `apps/api/src/auth/passwords.ts` — perfil OWASP, 19 MiB / t=2 |
| Rate limiting em tentativas de login | ✅ | 5/min por IP em `routes/auth.ts`; verificado na prática |
| JWT de vida curta (15 min) | ✅ | `ACCESS_TOKEN_TTL`, assinado com `jose` |
| Refresh token rotativo, hasheado e revogável | ✅ | `auth/tokens.ts` — SHA-256 no banco, valor em claro só no cliente |
| Detecção de reuso de refresh token | ✅ | reapresentar token já rotacionado revoga a **família inteira**; verificado |
| Revogação em bloco por corte temporal | ✅ | `users.tokens_valid_from`; troca de senha derruba todas as sessões |
| Resposta idêntica para e-mail inexistente e senha errada | ✅ | `fakeVerify()` iguala também o **tempo**, evitando enumeração de contas |
| Política de senha mínima | ✅ | `packages/shared/src/auth.ts` — 12+ caracteres, maiúscula e número |
| Todo endpoint administrativo autenticado | ✅ | hook no escopo do plugin: **rota nova nasce protegida** |

## Credenciais

| Item | Estado | Onde |
|---|---|---|
| Criptografia AES-256-GCM | ✅ | `crypto/credentials.ts`, com 13 testes |
| Chave mestra fora do banco e do repositório | ✅ | `ENCRYPTION_KEY` no `.env`, validada no boot (32 bytes exatos) |
| Suporte a rotação de chave | ✅ | coluna `credentials.key_version` |
| Ciphertext amarrado à credencial (AAD) | ✅ | mover a linha cifrada no banco quebra a decifragem; testado |
| Detecção de adulteração | ✅ | auth tag do GCM; testado com byte corrompido |
| Segredo nunca retornado ao painel | ✅ | `credentialPublicSchema` não tem campo `data` — só prévia mascarada |
| Segredo cifrado em repouso, verificado | ✅ | busca por texto claro no dump do banco: 0 ocorrências |

## Entrada e execução

| Item | Estado | Onde |
|---|---|---|
| Validação Zod em toda fronteira | ✅ | schemas nas rotas + `fieldsToZod` nos módulos |
| Resolução de `{{ }}` sem `eval` / `new Function` | ✅ | `context/resolve.ts` — busca por caminho; 9 testes de segurança |
| Bloqueio de protótipo e globais no template | ✅ | `__proto__`/`constructor` barrados; `{{ process.env.X }}` devolve vazio |
| Timeout por ação | ✅ | `AbortSignal` repassado aos módulos; testado |
| Falha de ação isolada, sem derrubar o worker | ✅ | exceção crua vira `ACTION_UNEXPECTED_ERROR`; testado |
| Retentativa só para erro seguro de repetir | ✅ | credencial inválida não é repetida — não queima cota à toa |
| URL de requisição HTTP restrita a http(s) | ✅ | bloqueia `file://` interpolado de um webhook |
| Rate limiting no webhook público | ✅ | 60/min **por token**, não por IP |
| Verificação de assinatura quando o provedor suportar | ✅ | HMAC sobre o **corpo cru**, comparação em tempo constante |
| Token de webhook rotacionável se a URL vazar | ✅ | `POST /api/automations/:id/rotate-webhook` |
| Headers sensíveis fora do histórico | ✅ | allowlist em `pickSafeHeaders` |
| Limite de tamanho de corpo | ✅ | 1 MiB no Fastify |

## Logs

| Item | Estado | Onde |
|---|---|---|
| Mascaramento de campos sensíveis antes de gravar | ✅ | `security/mask.ts` — por nome de campo e por dado pessoal |
| Mascaramento por valor conhecido dos segredos | ✅ | pega a chave até quando ecoada em mensagem de erro de API externa |
| Headers de autenticação fora do log | ✅ | `redact` no Fastify e no worker |
| Verificado na prática | ✅ | chave de teste não apareceu na resposta da API, no banco nem nos logs |

## Painel

| Item | Estado | Onde |
|---|---|---|
| Access token só em memória | ✅ | `apps/web/src/lib/api.ts` — morre ao fechar a aba |
| Renovações concorrentes compartilham uma promise | ✅ | evita que 2 refresh simultâneos disparem a detecção de reuso |
| CSP restritiva | ✅ | `Caddyfile` — sem `unsafe-eval`, `frame-ancestors 'none'` |
| HSTS, nosniff, X-Frame-Options, Referrer-Policy | ✅ | `Caddyfile` |
| Refresh token em `localStorage` | 🟡 | ver nota abaixo |

## Infraestrutura

| Item | Estado | Onde |
|---|---|---|
| `.env` no `.gitignore` desde o primeiro commit | ✅ | `.gitignore` |
| CI falha se um `.env` for versionado | ✅ | `.github/workflows/ci.yml` |
| Auditoria de dependências no build | ✅ | `pnpm audit --audit-level=high` bloqueia o merge |
| Sem vulnerabilidade alta ou crítica | ✅ | ver nota abaixo |
| Container como usuário não-root | ✅ | `Dockerfile` — usuário `orbita` (uid 1001) |
| `no-new-privileges` nos containers | ✅ | `docker-compose.prod.yml` |
| Banco e fila sem porta publicada em produção | ✅ | só rede interna do Compose; nem o loopback do host alcança |
| HTTPS obrigatório com certificado válido | ✅ | Caddy com Let's Encrypt automático |
| Backup automático com retenção | ✅ | `scripts/backup.sh` — diário, 14 dias, escrita atômica |
| Restauração testada | ✅ | ver nota abaixo |
| Firewall liberando só 22/80/443 | 📋 | `docs/DEPLOY.md` §1 |
| SSH por chave, nunca senha | 📋 | `docs/DEPLOY.md` §1 |
| Backup replicado fora do servidor | 📋 | `docs/DEPLOY.md` §6 |

---

## Notas

### Vulnerabilidades de dependência

A auditoria do M5 encontrou 1 crítica e 2 altas. Todas corrigidas:

| Pacote | Severidade | Problema | Ação |
|---|---|---|---|
| `drizzle-orm` | alta | SQL injection por identificador mal escapado | 0.38 → 0.45.2 |
| `vitest` | crítica | leitura/execução de arquivo pelo servidor de UI | 2.1 → 3.2 |
| `vite` | alta | bypass de `server.fs.deny` no Windows | 6.0 → 6.4.3 |

A do `drizzle-orm` era a única que atingia produção — as outras são de
desenvolvimento (a crítica do `vitest` só vale com a UI ativa, que este
projeto não usa). Restam 2 moderadas em dependências transitivas de
desenvolvimento, abaixo do limite que o CI bloqueia.

### Restauração de backup, testada

O ciclo completo foi exercitado: dump comprimido → restauração em banco
limpo → **credencial cifrada decifrando normalmente**. Isso confirma que
o vínculo por AAD não atrapalha a restauração, já que o `id` da
credencial é preservado no dump.

O `scripts/restore.sh` para o worker antes de restaurar — sem isso, uma
execução em andamento escreveria num banco sendo substituído.

### `localStorage` em vez de cookie httpOnly

Cookie `httpOnly` seria imune a XSS e é a escolha ideal. Hoje o backend
devolve os tokens no corpo da resposta, e o arranjo atual já limita o
estrago: o access token, que dá acesso imediato, só existe em memória; o
refresh é rotativo com detecção de reuso, então um roubo derruba a sessão
inteira na primeira renovação. Migrar para cookie `httpOnly` + token CSRF
fica para uma fase posterior.

### O que depende do servidor

Os itens 📋 não podem ser resolvidos em código. Estão no `docs/DEPLOY.md`
com o comando exato e marcados **🔒 obrigatório**, para não passarem
despercebidos na hora de subir.

O mais importante deles é replicar o backup para fora do servidor: hoje
ele vive no mesmo disco da aplicação, então uma falha de disco leva os
dois juntos.
