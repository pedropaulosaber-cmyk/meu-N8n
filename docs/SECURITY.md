# Checklist de segurança

Estado por item. Atualizado a cada marco; fechado no M5.

Legenda: ✅ implementado · 🟡 em andamento · ⬜ pendente · 📋 checklist de deploy
(depende de acesso ao servidor, não de código)

## Autenticação e acesso

| Item | Estado | Onde |
|---|---|---|
| Hash de senha forte (argon2id) | ⬜ | M1 |
| Rate limiting em tentativas de login | ⬜ | M1 |
| JWT de vida curta (15 min) | ⬜ | M1 |
| Refresh token rotativo, hasheado e revogável | ⬜ | M1 |
| Política de senha mínima | ✅ | `packages/shared/src/auth.ts` |
| Todo endpoint administrativo autenticado | ⬜ | M3 |

## Credenciais

| Item | Estado | Onde |
|---|---|---|
| Criptografia AES-256-GCM | ⬜ | M1 |
| Chave de criptografia fora do banco e do repositório | ✅ | `ENCRYPTION_KEY` no `.env` |
| Suporte a rotação de chave (`key_version`) | ⬜ | M1 |
| Segredo nunca retornado ao painel (só prévia mascarada) | ✅ | `credentialPublicSchema` sem campo `data` |

## Entrada e execução

| Item | Estado | Onde |
|---|---|---|
| Validação Zod em toda fronteira | 🟡 | schemas prontos; aplicação no M3 |
| Resolução de `{{ }}` sem `eval`/`new Function` | ⬜ | M2 |
| Timeout por ação | ⬜ | M2 |
| Falha de ação isolada, sem derrubar o worker | ⬜ | M2 |
| Rate limiting no endpoint público de webhook | ⬜ | M3 |
| Verificação de assinatura de webhook quando o provedor suportar | ⬜ | M3 |

## Logs

| Item | Estado | Onde |
|---|---|---|
| Mascaramento de campos sensíveis antes de gravar | ⬜ | M2 |
| Mascaramento de valores que batem com credenciais armazenadas | ⬜ | M2 |

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
