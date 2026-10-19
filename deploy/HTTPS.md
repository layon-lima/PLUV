# HTTPS automático do PLUV — pluv.fazendanovohorizonte.com

Esta configuração usa Caddy em Docker como proxy reverso para a API PLUV, que já está dentro da VPS em `127.0.0.1:8001`.

## Passo 1: criar registro DNS

No painel que gerencia o DNS de `fazendanovohorizonte.com`, crie:

- Tipo: **A**
- Nome/host: **pluv**
- Valor: **IPv4 público da VPS Hostinger**
- TTL: automático ou 300.

Se houver registro A antigo para o mesmo nome, atualize-o em vez de criar entradas conflitantes. Se houver um registro AAAA para `pluv`, confirme que aponta para o IPv6 correto da VPS ou remova-o. No Cloudflare, use inicialmente **DNS only** até o certificado estar funcionando.

O registro não altera o site `fazendanovohorizonte.com`.

## Passo 2: instalar o HTTPS na VPS

Após a propagação do DNS, execute como root na VPS:

```bash
bash /opt/apps/pluviometros/source/deploy/atualizar-vps.sh && bash /opt/apps/pluviometros/source/deploy/ativar-https.sh
```

O primeiro instalador atualiza a API sem apagar dados. O segundo inicia o Caddy e libera somente as portas 80/tcp, 443/tcp e 443/udp no UFW. Se já existir serviço ouvindo em 80 ou 443, o Docker não conseguirá iniciar o Caddy; nesse caso, não desligue outros aplicativos automaticamente: verifique o conflito antes de prosseguir.

O Caddy precisa alcançar a internet e aceitar HTTP/HTTPS públicos para emitir o certificado. A emissão pode levar alguns minutos.

## Passo 3: confirmar o acesso

Abra:

https://pluv.fazendanovohorizonte.com/health

Resposta esperada: `{"status":"ok"}`.

O contêiner PostgreSQL permanece privado sem portas publicadas; a API mantém a escuta no localhost do host e é acessível pelo proxy Caddy na rede Docker `pluviometros_default`.

## Operação e atualizações

```bash
bash /opt/apps/pluviometros/source/deploy/atualizar-vps.sh
docker compose -f /opt/apps/pluviometros/source/deploy/compose.https.yaml ps
docker compose -f /opt/apps/pluviometros/source/deploy/compose.https.yaml logs --tail=80 caddy
```

Certificados persistem nos volumes Docker `pluv-https_pluv_caddy_data` e `pluv-https_pluv_caddy_config`, mesmo após reiniciar o contêiner. Não apague esses volumes. Não use `docker compose down -v`.

## Segurança

- Nunca exponha `5432` (PostgreSQL) ou `8001` (API HTTP interna) ao público.
- O Caddy publica somente 80/443. O Docker pode publicar portas independentemente do UFW.
- A API exige token Bearer para os dados. O endpoint `/auth/login` é público por necessidade.
- Antes de distribuir acesso a usuários finais, implementar e verificar proteção contra tentativas repetidas de senha, backups automáticos com restauração validada, rotação de segredos e monitoramento do servidor.
- Expor o código no GitHub não expõe os dados do PostgreSQL; nenhuma senha ou arquivo `.env` deve entrar no repositório.
