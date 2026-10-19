# PLUV WEB — aplicativo principal

Aplicativo web progressivo (PWA), sem contas, sem senha, com armazenamento offline em IndexedDB e fila de sincronizacao por versoes. Os aplicativos nativos Android anteriores continuam no repositorio, mas o PWA assume a interface principal.

## Fluxo

- Pluviometros ilimitados (nome, localizacao, descricao); CRUD completo.
- Registros de chuva em mm, duas casas decimais; data e hora automáticas na inclusao, mantidas na edicao, notas opcionais; exclusoes preservadas para o servidor.
- Banco no navegador (IndexedDB) e outbox local gravados em uma mesma transacao.
- Online, envia fila na ordem, consulta atualizacoes de outros aparelhos e aplica versoes novas.
- Conflito nao apaga dados locais; exige escolha do usuario.
- Exportacao/importacao de backup JSON no menu. Importa apenas IDs ausentes, sem sobrescrever registros locais.
- Service Worker faz cache da interface; app instalavel pela opcao do Chrome/Edge quando hospedado em HTTPS.

## Rodar local no Windows

Execute `ABRIR_PLUV.ps1` na raiz do projeto. Abra http://127.0.0.1:8765. Precisa de Python e navegador atualizado. Nao abra `web/index.html` diretamente por file:// (PWA precisa HTTP/HTTPS).

## Publicação pela branch main

A pasta `web/`, a API FastAPI e os arquivos de implantação agora vivem em `main`. Faça atualizações exclusivamente nessa branch; mudanças no repositório não atualizam a VPS automaticamente.

1. Após revisar o commit na `main`, atualizar a VPS usando o script existente `/opt/apps/pluviometros/source/deploy/atualizar-vps.sh`, que executa SQL aditivo e reconstrói a API+PWA.
2. Verificar https://pluv.fazendanovohorizonte.com/health e abrir https://pluv.fazendanovohorizonte.com/ para instalar o app.
3. Testar em dois aparelhos, offline e online, antes de usar dados criticos.

**Atenção:** a API nao possui autenticacao (solicitado pelo proprietario). Qualquer pessoa que saiba a URL pode consultar, criar, alterar ou excluir registros PLUV. Recomendavel backups frequentes, rate limiting em Caddy, logs e monitoramento. Nao exponha as portas 5432 ou 8001.

## Importante

A copia do navegador local (`http://127.0.0.1:8765`) e a versao definitiva (`https://pluv.fazendanovohorizonte.com`) tem bases IndexedDB separadas por origem. **Exporte um backup JSON local e importe na versao HTTPS** caso queira levar os dados ja registrados localmente.

**Interface:** falhas comuns de conexao nao geram aviso amarelo grande. O estado permanece no indicador compacto do topo, enquanto conflitos que exigem decisao continuam destacados.
