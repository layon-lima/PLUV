#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Execute como root na VPS Hostinger."; exit 1
fi

command -v docker >/dev/null || { echo "Docker ausente."; exit 1; }
command -v curl >/dev/null || { echo "curl ausente."; exit 1; }

SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$SOURCE/deploy/compose.https.yaml"
HOST="pluv.fazendanovohorizonte.com"

echo "Confirmando que a API local do PLUV esta funcionando..."
if ! curl --silent --fail --max-time 10 "http://127.0.0.1:8001/health" >/dev/null; then
  echo "API PLUV nao responde em 127.0.0.1:8001."
  echo "Atualize a API antes de habilitar HTTPS."
  exit 1
fi

echo "Verificando o DNS do PLUV..."
EXPECTED_IPV4="187.127.63.29"
RESOLVED_IPV4="$(getent ahostsv4 "$HOST" | awk '$2 == "STREAM" {print $1}' | sort -u || true)"
if [[ "$RESOLVED_IPV4" != "$EXPECTED_IPV4" ]]; then
  echo "O DNS de $HOST ainda nao aponta exclusivamente para a VPS."
  echo "Esperado: $EXPECTED_IPV4"
  echo "Encontrado: ${RESOLVED_IPV4:-nenhum}"
  echo "Confira se os nameservers ativos ja sao os da Hostinger."
  echo "O HTTPS nao sera iniciado antes de o DNS estar correto."
  exit 1
fi

echo "Liberando somente portas HTTP/HTTPS no firewall UFW..."
if command -v ufw >/dev/null; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  # HTTP/3 usa QUIC. Sem UDP/443 a API segue em HTTPS por TCP.
  ufw allow 443/udp
fi

echo "Criando contêiner do proxy HTTPS, sem alterar o PostgreSQL..."
docker compose -f "$COMPOSE" config --quiet
docker compose -f "$COMPOSE" up -d

echo ""
echo "Proxy HTTPS iniciado. O Caddy solicita e renova o certificado automaticamente."
echo "Endereço: https://$HOST/health"
echo "O DNS deve apontar para esta VPS e as portas 80 e 443 devem estar acessiveis."
echo "Para acompanhar a emissao de certificado: docker compose -f $COMPOSE logs --tail=80 caddy"
