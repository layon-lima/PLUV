# PLUV — Pluviômetros (PWA principal)

O **PWA em `web/`** é a interface oficial para navegador e instalação no celular. Os arquivos em `android/` continuam como legado, mas o desenvolvimento principal é **na branch `main`**.

## Funcionalidades

- Cadastro/edição/exclusão de pluviômetros com nome, localização e descrição.
- Registro de chuva em mm, data e hora automáticas, histórico, edição e exclusão.
- Banco offline **IndexedDB**, fila de envio persistente e sincronização quando houver internet.
- Conflitos entre aparelhos exigem escolha explícita; falhas de rede ficam somente no indicador discreto do cabeçalho.
- Backup JSON pelo menu `⋯`. PWA instalável quando aberto com HTTPS.
- Sem tela de login nem credenciais, conforme solicitado.

## Abrir localmente no Windows

Na pasta raiz do clone do GitHub, execute `ABRIR_PLUV.ps1`. O endereço é `http://127.0.0.1:8765`. Precisa do Python instalado e Chrome/Edge atualizado.

## Publicação na VPS

O PWA será servido **junto à API** no domínio `https://pluv.fazendanovohorizonte.com/` depois de atualizar explicitamente a VPS. A atualização existente utiliza `deploy/atualizar-vps.sh` e `deploy/setup-server.sh`. **Fazer commit na main não publica automaticamente na VPS.**

O banco PostgreSQL permanece **privado** e o dos outros aplicativos permanece separado. Não publique as portas 5432 nem 8001. Não execute `docker compose down -v`.

**ATENÇÃO:** a API de leitura/escrita do PLUV não exige autenticação. Pessoas que descobrirem a URL da API poderão ler, adicionar, alterar ou excluir dados sem instalar o app. Essa é uma limitação da escolha de acesso irrestrito; backups e controles de rede são recomendados.

## Dados locais

`http://127.0.0.1:8765` e `https://pluv.fazendanovohorizonte.com` usam bancos IndexedDB diferentes porque são origens distintas. Exporte o backup JSON no endereço local e importe no HTTPS se quiser transportar dados de testes.

Consulte `PWA-NOVO.md` para detalhes técnicos.
