#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Execute como root no terminal da VPS"; exit 1
fi

ROOT="/opt/apps/pluviometros"
SOURCE="$ROOT/source"
REPO="https://github.com/layon-lima/PLUV.git"

if [[ ! -d "$SOURCE/.git" ]]; then
  echo "Baixando PLUV da branch main..."
  mkdir -p "$ROOT"
  git clone --depth 1 --branch main "$REPO" "$SOURCE"
else
  echo "Atualizando a branch main do PLUV..."
  git -C "$SOURCE" remote set-url origin "$REPO"
  git -C "$SOURCE" pull --ff-only origin main
fi

echo "Instalando/atualizando API sem remover o PostgreSQL existente..."
bash "$SOURCE/deploy/setup-server.sh"

echo ""
echo "API PLUV respondendo somente na VPS (127.0.0.1:8001)."
echo "Ainda sera necessario configurar HTTPS externo, backups e demais protecoes."
