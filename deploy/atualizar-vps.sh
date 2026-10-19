#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Execute como root no terminal da VPS"; exit 1
fi

ROOT="/opt/apps/pluviometros"
SOURCE="$ROOT/source"
KEY="/root/.ssh/pluv_deploy_ed25519"

if [[ ! -f "$KEY" ]]; then
  echo "Chave de deploy SSH nao encontrada em $KEY"; exit 1
fi
chmod 600 "$KEY"
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"

if [[ ! -d "$SOURCE/.git" ]]; then
  echo "O clone do PLUV ainda nao foi feito em $SOURCE"; exit 1
fi

echo "Atualizando a branch main do PLUV..."
git -C "$SOURCE" pull --ff-only origin main

echo "Instalando ou atualizando API sem excluir dados..."
bash "$SOURCE/deploy/setup-server.sh"

echo ""
echo "API pronta para uso interno (loopback)."
echo "Publicacao externa HTTPS deve ser configurada separadamente."
