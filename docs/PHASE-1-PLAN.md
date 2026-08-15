# Fase 1 — Plano técnico

## Objetivo

Ao final desta fase deve ser possível: acessar o painel, cadastrar uma
automação simples (webhook → chamada de IA → log), dispará-la manualmente
ou por requisição real, e ver o resultado no histórico.

A prioridade é um **motor de execução robusto e extensível**, não um editor
visual. O drag-and-drop fica para uma fase futura.

## Decisões de arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Framework HTTP | Fastify | Validação por schema nativa, plugins oficiais de rate-limit e helmet, throughput alto |
| API administrativa | REST + Zod | Um paradigma só; permite que o Método CRM ou um app consuma a plataforma no futuro |
| ORM | Drizzle | SQL-first, sem binário de engine (imagem menor), boa ergonomia com `jsonb` |
| Fila | BullMQ + Redis | Chamada de IA lenta nunca segura a API; retentativa e backoff prontos |
| Worker | Container separado, mesma imagem | Escala e reinicia sem derrubar a API |
| TLS | Caddy | HTTPS automático com renovação; atende "HTTPS obrigatório" sem trabalho manual |
| Hash de senha | argon2id | Padrão atual, resistente a ataque por GPU |
| Credenciais | AES-256-GCM, chave em env | Segredo nunca em texto no banco nem no repositório |

## A decisão central: descritores de campo

Cada módulo plugável declara `configFields` e `credentialFields` como um
array de descritores. Esse array alimenta, de uma vez:

1. a **validação** no backend (`fieldsToZod()`);
2. o **formulário** no editor de automação, renderizado genericamente;
3. o **card** na aba Integrações.

Consequência prática: adicionar uma integração é criar um arquivo e
registrá-lo. Nada de mexer no motor, na API ou no painel. É isso que
sustenta o requisito de integrações ilimitadas.

Ver [`ADDING-AN-INTEGRATION.md`](ADDING-AN-INTEGRATION.md).

## Modelo de dados

```
users                id · email · password_hash(argon2id)
refresh_tokens       id · user_id · token_hash · expires_at · revoked_at · ip · user_agent
credentials          id · name · integration_id · kind
                     data_encrypted · iv · auth_tag · key_version · last_used_at
automations          id · name · description · status · trigger_type · trigger_config(jsonb)
                     webhook_token(unique) · last_run_at · last_run_status
automation_actions   id · automation_id · position · action_type · config(jsonb)
                     credential_id · on_error · retries · timeout_ms
executions           id · automation_id · status · trigger_payload(jsonb) · result(jsonb)
                     error(jsonb) · started_at · finished_at · duration_ms · queue_job_id
execution_steps      id · execution_id · automation_action_id · position · action_type
                     status · input(jsonb) · output(jsonb) · error(jsonb) · attempt · duration_ms
```

## Fluxo de execução

```
POST /hooks/:token → valida origem + rate limit → cria execution(queued)
                   → enfileira no BullMQ → responde 202 na hora
                        ↓
worker: para cada ação, em ordem →
   resolve {{ }} do config contra { trigger, steps }
   → run(ctx) com timeout e retentativas próprias
   → grava execution_step com input/output já mascarados
   → em falha, aplica on_error (stop | continue) e registra erro estruturado
   → cada ação roda isolada: uma falha nunca derruba o worker
```

A resolução de `{{ }}` usa busca por caminho, **sem `eval` e sem
`new Function`**. Payload de webhook é dado, nunca código executável.

## Marcos

| Marco | Entrega | Validação |
|---|---|---|
| M0 | Scaffolding, Compose, CI, docs | `docker compose up` sobe a infra |
| M1 | Schema + migrations + autenticação | login devolve token; rota protegida barra sem ele |
| M2 | Registry + motor + webhook + Gemini | `curl` no webhook devolve resposta da IA no histórico |
| M3 | API administrativa REST | cria e dispara automação via API |
| M4 | Painel React + aba Integrações | ciclo completo pela interface |
| M5 | Hardening + backup + checklist | `SECURITY.md` fechado |

## Fora do escopo desta fase

Gatilho de WhatsApp, gravação no Supabase do Método CRM, geração de PDF,
provedores de IA além do Gemini e editor visual de encadeamento. A
arquitetura já comporta todos — entram como módulos novos, sem alterar o
núcleo.
