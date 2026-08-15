#!/bin/sh
# ─────────────────────────────────────────────────────────────────────
#  Backup automático do Postgres
# ─────────────────────────────────────────────────────────────────────
#
# Roda em loop dentro do container `backup`. Faz um dump comprimido por
# dia e apaga os mais velhos que BACKUP_RETENTION_DAYS.
#
# Por que loop e não cron: mantém a rotina junto da stack — sobe com ela,
# usa as mesmas variáveis e aparece em `docker compose logs backup`. Um
# cron no host seria um lugar a mais para lembrar de configurar (e de
# migrar, se o servidor mudar).
#
# IMPORTANTE: este backup fica no MESMO servidor. Se o disco morrer, ele
# morre junto. Copiar para fora (S3, Backblaze, outro VPS) é um passo do
# docs/DEPLOY.md — está fora do escopo desta fase porque envolve escolher
# um serviço e credenciais.

set -eu

BACKUP_DIR=/backups
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"

mkdir -p "$BACKUP_DIR"

log() {
	echo "[backup $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

run_backup() {
	timestamp=$(date -u '+%Y%m%d-%H%M%S')
	target="$BACKUP_DIR/orbita-$timestamp.sql.gz"

	# Escreve em .partial e só renomeia no fim: se o processo morrer no
	# meio, não fica um arquivo truncado parecendo backup válido.
	if pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
		| gzip -9 > "$target.partial"; then
		mv "$target.partial" "$target"
		size=$(du -h "$target" | cut -f1)
		log "ok: $(basename "$target") ($size)"
	else
		rm -f "$target.partial"
		log "ERRO: falha ao gerar o dump"
		return 1
	fi
}

prune_old() {
	removed=$(find "$BACKUP_DIR" -name 'orbita-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
	[ "$removed" -gt 0 ] && log "removidos $removed backup(s) com mais de $RETENTION_DAYS dias"
	# Limpa também restos de execuções interrompidas.
	find "$BACKUP_DIR" -name '*.partial' -mtime +1 -delete 2>/dev/null || true
	return 0
}

log "rotina iniciada — retenção de $RETENTION_DAYS dias, intervalo de ${INTERVAL_SECONDS}s"

while true; do
	# `|| true` para uma falha pontual (banco reiniciando) não derrubar o
	# loop inteiro: a próxima tentativa acontece no ciclo seguinte.
	run_backup || true
	prune_old || true
	sleep "$INTERVAL_SECONDS"
done
