# Deploy em VPS

Guia do zero até a plataforma no ar com HTTPS.

Os passos marcados **🔒 obrigatório** são itens do checklist de segurança
que dependem do servidor e não podem ser resolvidos em código. Não pule.

---

## 1. Servidor

Mínimo confortável: 2 vCPU, 4 GB de RAM, 40 GB de disco. Debian 12 ou
Ubuntu 24.04. O gargalo costuma ser memória (Postgres + Redis + Node), não
CPU — automações passam a maior parte do tempo esperando resposta de API
externa.

### 🔒 SSH por chave, nunca senha

No **seu computador**, se ainda não tiver uma chave:

```bash
ssh-keygen -t ed25519 -C "orbita"
ssh-copy-id root@SEU_IP
```

Confirme que a chave funciona **antes** de desativar a senha — senão você
se tranca do lado de fora:

```bash
ssh root@SEU_IP   # deve entrar sem pedir senha
```

Agora, **no servidor**, edite `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

```bash
systemctl restart ssh
```

Deixe a sessão atual aberta e teste uma nova em outro terminal. Se algo
der errado, você ainda tem a sessão original para desfazer.

### 🔒 Firewall

```bash
apt update && apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (o Caddy redireciona para HTTPS)
ufw allow 443/tcp   # HTTPS
ufw enable
ufw status
```

Postgres (5432) e Redis (6379) **não** entram na lista: no
`docker-compose.prod.yml` eles não publicam portas e só são alcançáveis
pela rede interna do Compose.

### Atualizações automáticas de segurança

```bash
apt install -y unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades
```

---

## 2. Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

---

## 3. DNS

Aponte o domínio para o IP do servidor:

| Tipo | Nome | Valor |
|---|---|---|
| A | `orbita` (ou `@`) | IP do VPS |

Confirme a propagação antes de seguir — o Caddy só consegue emitir o
certificado quando o domínio já resolve para este servidor:

```bash
dig +short orbita.seudominio.com
```

---

## 4. Código e segredos

```bash
git clone https://github.com/SEU_USUARIO/meu-N8n.git /opt/orbita
cd /opt/orbita
cp .env.example .env
```

Gere os segredos:

```bash
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)" >> .env
```

Edite o `.env` e remova as linhas duplicadas dessas três variáveis,
mantendo só as geradas. Preencha também:

```
ORBITA_DOMAIN=orbita.seudominio.com
OWNER_EMAIL=voce@seudominio.com
OWNER_PASSWORD=<senha forte, mínimo 12 caracteres com maiúscula e número>
NODE_ENV=production
```

### 🔒 A ENCRYPTION_KEY

É ela que protege as chaves de API guardadas no banco.

- **Perdeu a chave** → todas as credenciais viram lixo irrecuperável e
  precisam ser cadastradas de novo pelo painel.
- **Vazou a chave** → quem tiver um dump do banco consegue ler as
  credenciais. Troque-a e recadastre tudo.

Guarde uma cópia em gerenciador de senhas, **fora do servidor**. Um
backup do banco sem a chave não restaura nada; a chave sem o backup
também não. Os dois precisam existir, e de preferência em lugares
diferentes.

```bash
chmod 600 .env
```

---

## 5. Subir

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api pnpm --filter @orbita/api db:migrate
docker compose -f docker-compose.prod.yml exec api pnpm --filter @orbita/api db:seed
```

O `db:seed` cria o usuário owner a partir do `.env`. É idempotente — se o
e-mail já existe, não faz nada, então rodar de novo nunca sobrescreve uma
senha trocada pelo painel.

Acompanhe o Caddy emitir o certificado:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

Acesse `https://orbita.seudominio.com`. O cadeado deve aparecer sem aviso.

### Verificação rápida

```bash
curl -s https://orbita.seudominio.com/health
curl -sI https://orbita.seudominio.com | grep -i strict-transport
# HTTP deve redirecionar para HTTPS:
curl -sI http://orbita.seudominio.com | head -1
```

---

## 6. Depois de subir

### Trocar a senha do owner

Entre no painel e troque a senha em Configurações. A senha do `.env` foi
digitada em texto num arquivo e pode ter ficado no histórico do shell.
Trocar pelo painel derruba todas as sessões e passa a valer só o hash
novo no banco.

### Confirmar que o backup está rodando

A rotina de backup sobe junto com a stack:

```bash
docker compose -f docker-compose.prod.yml logs backup | tail -5
ls -lh backups/
```

### 🔒 Testar a restauração

**Backup que nunca foi restaurado não é backup, é esperança.** Faça o
teste uma vez, agora, enquanto não é urgente:

```bash
./scripts/restore.sh backups/orbita-AAAAMMDD-HHMMSS.sql.gz
```

### Backup fora do servidor

O backup atual fica no mesmo disco da aplicação — se o disco morrer, os
dois morrem juntos. Copie para outro lugar. Um cron simples com `rclone`
resolve:

```bash
apt install -y rclone
rclone config          # configure o destino (S3, Backblaze, Drive...)
crontab -e
# 0 4 * * * rclone sync /opt/orbita/backups remoto:orbita-backups
```

---

## Operação

| Tarefa | Comando |
|---|---|
| Ver logs | `docker compose -f docker-compose.prod.yml logs -f api worker` |
| Reiniciar o worker | `docker compose -f docker-compose.prod.yml restart worker` |
| Atualizar a plataforma | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Aplicar migrations | `docker compose -f docker-compose.prod.yml exec api pnpm --filter @orbita/api db:migrate` |
| Backup manual | `docker compose -f docker-compose.prod.yml exec backup sh /usr/local/bin/backup.sh` |

O worker tem `stop_grace_period: 60s`: ao reiniciar, ele espera os jobs em
andamento terminarem antes de morrer, para não deixar execução pela
metade sem registro no histórico.

---

## Problemas comuns

**O certificado não é emitido.** O DNS provavelmente ainda não propagou,
ou a porta 80 está fechada. O Caddy precisa das duas coisas. Confira com
`dig +short SEU_DOMINIO` e `ufw status`.

**A API não sobe.** Quase sempre é `.env` incompleto — o processo valida
as variáveis no boot e se recusa a subir com configuração inválida, de
propósito. A mensagem diz qual variável falta:
`docker compose -f docker-compose.prod.yml logs api`.

**Automação não dispara.** Confira se ela está com status `active` (uma
automação nova nasce como rascunho) e se o worker está de pé:
`docker compose -f docker-compose.prod.yml ps`.

**Credenciais pararam de decifrar.** A `ENCRYPTION_KEY` mudou. Se você
tem a chave antiga, restaure-a no `.env`. Se não tem, recadastre as
credenciais pelo painel.
