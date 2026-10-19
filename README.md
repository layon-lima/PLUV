# PLUV — Pluviômetros Offline

Aplicativo de registro de chuva com funcionamento offline e sincronização posterior com servidor próprio.

## Arquitetura

- `preview/`: protótipo visual navegável no navegador, sem servidor e com dados locais de demonstração.
- `backend/`: API FastAPI com autenticação, PostgreSQL e sincronização idempotente.
- `deploy/`: instruções e configuração Docker para a API na VPS; o PostgreSQL já está na VPS e não será recriado por esse projeto.
- `android/`: documentação e preparação da aplicação nativa Kotlin/Room/WorkManager.

**Importante:** o protótipo web não é o aplicativo Android final. O armazenamento real offline do Android será SQLite/Room; a API central não deve ser exposta publicamente antes da configuração de HTTPS, criação de usuários, testes e backups.

Nenhuma senha ou dado privado deve ser enviado ao GitHub.
