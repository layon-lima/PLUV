# INSTALAÇÃO DO PLUV NA VPS — REPOSITÓRIO PÚBLICO

Este procedimento exige que o repositório **layon-lima/PLUV** esteja público. O acesso público permite clonar o **código-fonte**, não o banco PostgreSQL, as senhas ou dados reais da VPS.

## 1. Tornar o repositório público

GitHub → repositório PLUV → Settings → Danger Zone → Change repository visibility → Public.

**Cuidado:** o código e todo o histórico Git ficam públicos. Antes de publicar, confira se nunca houve credenciais privadas no histórico. O arquivo de senha do PostgreSQL está na VPS, em /opt/apps/pluviometros/config, e NÃO deve ser enviado ao GitHub.

## 2. Instalar e iniciar a API (uma só execução no terminal Ubuntu da VPS)

```bash
apt-get update && apt-get install -y git curl ca-certificates openssl && bash -c 'set -e; mkdir -p /opt/apps/pluviometros; if [ ! -d /opt/apps/pluviometros/source/.git ]; then git clone --depth 1 --branch main https://github.com/layon-lima/PLUV.git /opt/apps/pluviometros/source; fi; bash /opt/apps/pluviometros/source/deploy/atualizar-vps.sh'
```

A instalação preserva o contêiner existente `pluviometros-db-1` e o volume persistente `pluviometros_pluv_data`; aplica tabelas ao banco `pluv_db`; cria usuário `pluv_api` restrito e senha local, instala a API com Docker, e aguarda a rota `http://127.0.0.1:8001/health` responder. Se falhar, o script interrompe com erro e exibe os últimos logs. Não significa que tenha sido validado até ser executado na VPS.

Não abra as portas 5432 (PostgreSQL) nem 8001 (API interna) no firewall.

## 3. Criar o primeiro administrador (senha digitada somente na VPS)

```bash
docker compose -f /opt/apps/pluviometros/source/deploy/compose.api.yaml run --rm api python scripts/bootstrap_admin.py
```

O terminal pedirá usuário e senha. **Não compartilhe senhas aqui no chat.**

## 4. Atualizar depois

```bash
bash /opt/apps/pluviometros/source/deploy/atualizar-vps.sh
```

## Próxima etapa

A API ficará disponível apenas para a própria VPS (127.0.0.1:8001) até configurarmos domínio HTTPS, proxy reverso e proteção contra tentativas repetidas de login. Também precisamos configurar backup externo e testar a restauração. O aplicativo Android necessita de HTTPS para sincronização.
