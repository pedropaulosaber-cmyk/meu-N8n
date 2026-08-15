# Órbita

Plataforma própria de criação de agentes e automações de IA.

Independente do Método CRM: domínio, banco e infraestrutura próprios, sem
licenciamento de terceiros. O motor é plugável por design — gatilhos, ações
e provedores de IA são módulos registráveis, e adicionar um novo não exige
alterar o núcleo.

---

## Como rodar

Pré-requisitos: Node 22+, pnpm 10+, Docker.

```bash
# 1. Segredos
cp .env.example .env
openssl rand -base64 32   # cole em ENCRYPTION_KEY
openssl rand -base64 48   # cole em JWT_SECRET
#   preencha também OWNER_EMAIL e OWNER_PASSWORD

# 2. Infraestrutura (Postgres + Redis)
pnpm infra:up

# 3. Dependências e banco
pnpm install
pnpm db:migrate

# 4. Tudo em modo dev (API + worker + painel)
pnpm dev
```

Painel em `http://localhost:5173`, API em `http://localhost:3001`.

---

## Estrutura

```
apps/
  api/       Fastify — API administrativa + endpoint público de webhook
  worker/    BullMQ — consome a fila e roda o motor
  web/       React + Vite + Tailwind — o painel
packages/
  shared/    Schemas Zod e tipos compartilhados entre API e painel
  engine/    O motor: registry, runner e todas as integrações
design/      Referência visual original (Claude Design)
docs/        Plano de fase, receita de integração e checklist de segurança
```

## Documentação

| Documento | Para quê |
|---|---|
| [`docs/ADDING-AN-INTEGRATION.md`](docs/ADDING-AN-INTEGRATION.md) | **Comece por aqui** para adicionar gatilho, ação ou provedor de IA |
| [`docs/PHASE-1-PLAN.md`](docs/PHASE-1-PLAN.md) | Escopo, arquitetura e decisões da Fase 1 |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Checklist de segurança, item a item |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Subir em VPS com HTTPS |

## Custos

Zero licenciamento — toda a stack é open source e self-hosted. Os únicos
custos recorrentes são o **VPS** e o **uso das APIs de IA** que você
conectar (o Gemini tem free tier; acima dele é cobrado pelo Google).
