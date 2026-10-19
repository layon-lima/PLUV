#!/usr/bin/env bash
set -Eeuo pipefail

# Instala somente schema, usuario do banco e API PLUV.
# Nao altera/recria postgres Compose ja em funcionamento.
if [[ "$EUID" -ne 0 ]]; then
  echo "Execute como root na VPS"; exit 1
fi
command -v docker >/dev/null || { echo "Docker ausente"; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL ausente"; exit 1; }
APP_ROOT="/opt/apps/pluviometros"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$SRC/deploy/compose.api.yaml"
CONFIG="$APP_ROOT/config"
DB="pluviometros-db-1"

if ! docker inspect "$DB" >/dev/null 2>&1; then
  echo "Container do PostgreSQL nao encontrado; abortando sem alterar o banco"
  exit 1
fi
docker exec "$DB" pg_isready -U pluv_admin -d pluv_db >/dev/null || {
  echo "Banco pluv_db indisponivel"; exit 1;
}
umask 077
mkdir -p "$CONFIG"
chmod 700 "$CONFIG"
echo "Aplicando esquema PLUV..."
docker exec -i "$DB" psql -X -v ON_ERROR_STOP=1 -U pluv_admin -d pluv_db < "$SRC/backend/schema.sql" >/dev/null

PASSFILE="$CONFIG/api_password"
if [[ ! -s "$PASSFILE" ]]; then
  openssl rand -hex 32 > "$PASSFILE"
fi
chmod 600 "$PASSFILE"
DB_PASS="$(cat "$PASSFILE")"
[[ "$DB_PASS" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Arquivo de senha invalido; abortando"; exit 1;
}

ROLE_EXISTS="$(docker exec "$DB" psql -X -At -U pluv_admin -d pluv_db -c "SELECT 1 FROM pg_roles WHERE rolname='pluv_api'")"
if [[ "$ROLE_EXISTS" != "1" ]]; then
  docker exec "$DB" psql -X -v ON_ERROR_STOP=1 -U pluv_admin -d pluv_db \
    -c "CREATE ROLE pluv_api LOGIN PASSWORD '$DB_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;" >/dev/null
else
  docker exec "$DB" psql -X -v ON_ERROR_STOP=1 -U pluv_admin -d pluv_db \
    -c "ALTER ROLE pluv_api PASSWORD '$DB_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;" >/dev/null
fi
docker exec "$DB" psql -X -v ON_ERROR_STOP=1 -U pluv_admin -d pluv_db -c "
GRANT CONNECT ON DATABASE pluv_db TO pluv_api;
GRANT USAGE ON SCHEMA public TO pluv_api;
GRANT SELECT, INSERT ON TABLE pluv_users TO pluv_api;
GRANT SELECT, INSERT, DELETE ON TABLE pluv_sessions TO pluv_api;
GRANT SELECT, INSERT, UPDATE ON TABLE pluv_gauges, pluv_readings TO pluv_api;
GRANT SELECT, INSERT ON TABLE pluv_changes, pluv_operations TO pluv_api;
GRANT USAGE, SELECT ON SEQUENCE pluv_changes_id_seq TO pluv_api;
" >/dev/null

ENV_FILE="$CONFIG/api.env"
printf 'DATABASE_URL=postgresql://pluv_api:%s@pluviometros-db-1:5432/pluv_db\n' "$DB_PASS" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset DB_PASS

echo "Preparando API (somente em 127.0.0.1:8001)..."
docker compose -f "$COMPOSE" up -d --build
echo "Aguardando a API inicializar (ate 120 segundos)..."
READY=0
for attempt in $(seq 1 60); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:8001/health" > /dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
if [[ "$READY" -ne 1 ]]; then
  echo ""
  echo "ERRO: API nao respondeu depois de esperar inicializacao."
  echo "--- STATUS DOS CONTEINERES ---"
  docker compose -f "$COMPOSE" ps -a || true
  echo "--- LOGS DO CONTEINER PLUV ---"
  docker compose -f "$COMPOSE" logs --no-color --tail=100 api || true
  echo "--- TESTE HTTP LOCAL ---"
  curl -v --max-time 5 "http://127.0.0.1:8001/health" 2>&1 || true
  exit 1
fi
echo "API respondeu ao health check."
echo ""
echo "API PLUV iniciada e respondendo localmente; PostgreSQL existente preservado."
echo "PLUV PWA + API preparados em 127.0.0.1:8001."
echo "Se o proxy HTTPS Caddy estiver ativo, acesse https://pluv.fazendanovohorizonte.com/"
echo "Atencao: sincronizacao sem login torna os dados do PLUV acessiveis a terceiros pela API publica."
echo "NAO exponha as portas 8001 ou 5432 diretamente na internet."
