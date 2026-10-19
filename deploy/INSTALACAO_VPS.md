# INSTALAR A API PLUV NA VPS — PRIMEIRA VEZ

O repositório é privado. A VPS precisa de uma chave SSH exclusiva e de leitura antes de baixar o código.

## 1. Gerar a chave pública (somente na VPS)
Execute no terminal da Hostinger:

```bash
install -d -m 700 /root/.ssh
test -f /root/.ssh/pluv_deploy_ed25519 || ssh-keygen -q -t ed25519 -f /root/.ssh/pluv_deploy_ed25519 -N '' -C pluv-hostinger-readonly
cat /root/.ssh/pluv_deploy_ed25519.pub
```

Copie **apenas a linha que começa com ssh-ed25519**. Nunca copie o arquivo sem `.pub`.

## 2. Autorizar a chave no GitHub
Abra https://github.com/layon-lima/PLUV/settings/keys
Clique em **Add deploy key**. Nome sugerido: VPS PLUV. Cole a chave pública e NÃO habilite Allow write access.

## 3. Instalar API (somente depois de autorizar a chave)
No terminal da VPS:

```bash
apt-get update && apt-get install -y git openssh-client ca-certificates curl
install -d -m 700 /root/.ssh
printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >> /root/.ssh/known_hosts
chmod 600 /root/.ssh/known_hosts
if [ ! -d /opt/apps/pluviometros/source/.git ]; then
  GIT_SSH_COMMAND='ssh -i /root/.ssh/pluv_deploy_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes' git clone --depth 1 --branch main git@github.com:layon-lima/PLUV.git /opt/apps/pluviometros/source
fi
bash /opt/apps/pluviometros/source/deploy/atualizar-vps.sh
```

Este comando:
- Usa a chave pública autorizada no GitHub.
- Baixa o código na pasta `source` ou atualiza a cópia existente.
- Aplica o esquema sem apagar o banco pré-existente.
- Cria login restrito ao PostgreSQL para a API.
- Constrói o contêiner de FastAPI com Docker.
- Aguarda até a API responder em `http://127.0.0.1:8001/health`.

## 4. Criar o administrador no servidor (após instalação)
```bash
docker compose -f /opt/apps/pluviometros/source/deploy/compose.api.yaml run --rm api python scripts/bootstrap_admin.py
```

Digite nome e senha quando o programa solicitar. A senha não será exibida ao digitar e não deve ser enviada por chat.

## Estado esperado
A API escuta somente em `127.0.0.1:8001`, sem publicação na internet. Isso é intencional: antes de conectar celulares, falta configurar domínio, proxy HTTPS, limites contra tentativas de login, backups e testes finais. NÃO abrir a porta 5432 ou 8001 no firewall.

A chave de servidor `/root/.ssh/pluv_deploy_ed25519` deve permanecer **privada** na VPS. Nunca enviá-la para GitHub ou ChatGPT.

A chave oficial de host SSH do GitHub na etapa 3 corresponde à publicada em https://docs.github.com/pt/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints

## Atualizações futuras
Após a instalação, use:
```bash
bash /opt/apps/pluviometros/source/deploy/atualizar-vps.sh
```

A configuração é manual, sem dependência de GitHub Actions.
