#!/bin/sh
# Restaura um backup gerado por backup.sh.
#
# Backup que nunca foi restaurado não é backup — é esperança. Teste este
# procedimento pelo menos uma vez, num banco descartável, antes de
# precisar dele de verdade.
#
# Uso, a partir da raiz do projeto:
#   ./scripts/restore.sh backups/orbita-20260815-030000.sql.gz

set -eu

if [ $# -ne 1 ]; then
	echo "Uso: $0 <arquivo.sql.gz>" >&2
	exit 1
fi

ARQUIVO="$1"

if [ ! -f "$ARQUIVO" ]; then
	echo "Arquivo não encontrado: $ARQUIVO" >&2
	exit 1
fi

echo "ATENÇÃO: isto SOBRESCREVE o banco atual com o conteúdo de:"
echo "  $ARQUIVO"
echo
printf 'Digite "restaurar" para confirmar: '
read -r resposta
[ "$resposta" = "restaurar" ] || { echo "Cancelado."; exit 1; }

# O worker precisa parar antes: restaurar com ele rodando deixaria
# execuções em andamento escrevendo num banco que está sendo substituído.
echo "Parando o worker..."
docker compose -f docker-compose.prod.yml stop worker

echo "Restaurando..."
gunzip -c "$ARQUIVO" | docker compose -f docker-compose.prod.yml exec -T postgres \
	psql -U "${POSTGRES_USER:-orbita}" -d "${POSTGRES_DB:-orbita}"

echo "Subindo o worker..."
docker compose -f docker-compose.prod.yml start worker

echo
echo "Restauração concluída."
echo
echo "LEMBRE-SE: as credenciais no banco estão cifradas com a ENCRYPTION_KEY"
echo "que valia na época do backup. Se a chave foi trocada desde então, elas"
echo "não vão decifrar e precisarão ser cadastradas de novo pelo painel."
