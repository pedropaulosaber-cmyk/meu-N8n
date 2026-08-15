# Checklist de segurança

Estado por item. Atualizado a cada marco; fechado no M5.

Legenda: ✅ implementado · 🟡 em andamento · ⬜ pendente · 📋 checklist de deploy
(depende de acesso ao servidor, não de código)

## Autenticação e acesso

| Item | Estado | Onde |
|---|---|---|
| Hash de senha forte (argon2id) | ✅ | `src/auth/passwords.ts` — perfil OWASP 19 MiB/t=2 |
| Rate limiting em tentativas de login | ✅ | 5/min por IP em `src/routes/auth.ts` |
| JWT de vida curta (15 min) | ✅ | `ACCESS_TOKEN_TTL`, assinado com jose |
| Refresh token rotativo, hasheado e revogável | ✅ | `src/auth/tokens.ts` |
| Detecção de reuso de refresh token | ✅ | reapresentar token rotacionado revoga a família inteira |
| Revogação em bloco por corte temporal | ✅ | `users.tokens_valid_from`; troca de senha derruba as sessões |
| Resposta idêntica para e-mail inexistente e senha errada | ✅ | `fakeVerify()` iguala o tempo, evitando enumeração de contas |
| Política de senha mínima | ✅ | `packages/shared/src/auth.ts` |
| Todo endpoint administrativo autenticado | 🟡 | `requireAuth` pronto; aplicado às demais rotas no M3 |

## Credenciais

| Item | Estado | Onde |
|---|---|---|
| Criptografia AES-256-GCM | ✅ | `src/crypto/credentials.ts`, com testes |
| Chave de criptografia fora do banco e do repositório | ✅ | `ENCRYPTION_KEY` no `.env`, validada no boot |
| Suporte a rotação de chave (`key_version`) | ✅ | coluna `credentials.key_version` |
| Ciphertext amarrado à credencial (AAD) | ✅ | mover a linha cifrada no banco quebra a decifragem |
| Detecção de adulteração | ✅ | auth tag do GCM; testado |
| Segredo nunca retornado ao painel (só prévia mascarada) | ✅ | `credentialPublicSchema` sem campo `data` |

## Entrada e execução

| Item | Estado | Onde |
|---|---|---|
| Validação Zod em toda fronteira | 🟡 | `fieldsToZod` valida config das ações; rotas HTTP no M3 |
| Resolução de `{{ }}` sem `eval`/`new Function` | ✅ | `context/resolve.ts` — busca por caminho, 9 testes de segurança |
| Bloqueio de acesso a protótipo e globais no template | ✅ | `__proto__`/`constructor` barrados; raiz desconhecida devolve vazio |
| Timeout por ação | ✅ | `AbortSignal` repassado aos módulos; testado |
| Falha de ação isolada, sem derrubar o worker | ✅ | exceção crua vira `ACTION_UNEXPECTED_ERROR`; testado |
| Retentativa só para erro seguro de repetir | ✅ | credencial inválida não é repetida; testado |
| URL de requisição HTTP restrita a http(s) | ✅ | bloqueia `file://` interpolado de webhook |
| Rate limiting no endpoint público de webhook | ⬜ | M3 |
| Verificação de assinatura de webhook quando o provedor suportar | ⬜ | M3 |

## Logs

| Item | Estado | Onde |
|---|---|---|
| Mascaramento de campos sensíveis antes de gravar | ✅ | `security/mask.ts`, por nome de campo e por dado pessoal |
| Mascaramento de valores que batem com credenciais armazenadas | ✅ | pega o segredo até quando ecoado em mensagem de erro; testado |
| Headers de autenticação fora do log | ✅ | `redact` no logger do Fastify |

## Infraestrutura

| Item | Estado | Onde |
|---|---|---|
| `.env` no `.gitignore` desde o primeiro commit | ✅ | `.gitignore` |
| CI falha se um `.env` for versionado | ✅ | `.github/workflows/ci.yml` |
| Auditoria de dependências no build | ✅ | `pnpm audit --audit-level=high` no CI |
| Banco exposto só no loopback | ✅ | `docker-compose.yml` |
| Container rodando como usuário não-root | ⬜ | M5 |
| HTTPS obrigatório com certificado válido | ⬜ | M5 (Caddy) |
| Backup automático do banco com retenção | ⬜ | M5 |
| Firewall liberando só portas necessárias | 📋 | `docs/DEPLOY.md` |
| SSH por chave, nunca senha | 📋 | `docs/DEPLOY.md` |

## Observações

Os itens marcados 📋 dependem de acesso ao VPS e não podem ser resolvidos
no código. Eles viram passos obrigatórios do guia de deploy, com comando
exato, para não serem esquecidos na hora de subir.
