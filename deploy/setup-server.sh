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
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
pluv_users, pluv_sessions, pluv_gauges, pluv_readings, pluv_changes, pluv_operations
TO pluv_api;
GRANT USAGE, SELECT ON SEQUENCE pluv_changes_id_seq TO pluv_api;
" >/dev/null

ENV_FILE="$CONFIG/api.env"
printf 'DATABASE_URL=postgresql://pluv_api:%s@pluviometros-db-1:5432/pluv_db\n' "$DB_PASS" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset DB_PASS

echo "Preparando API (somente em 127.0.0.1:8001)..."
docker compose -f "$COMPOSE" up -d --build
echo ""
echo "API iniciada; PostgreSQL existente foi preservado."
echo "Para criar o primeiro administrador, execute:"
echo "docker compose -f $COMPOSE run --rm api python scripts/bootstrap_admin.py"
echo "NAO abra a porta 8001 ou 5432 para internet. Falta HTTPS."
