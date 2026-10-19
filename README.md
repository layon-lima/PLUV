# PLUV — Pluviômetros Offline

Sistema de registro de chuva com aplicativo Android offline e sincronização com backend próprio na VPS.

## O que está no repositório

- `preview/index.html`: prévia visual navegável para abrir no navegador, sem instalar APK. Os dados ficam no armazenamento local do navegador.
- `android/`: código-fonte inicial do aplicativo nativo em Kotlin / Jetpack Compose, com SQLite (Room), fila de alterações persistente e WorkManager.
- `backend/`: API FastAPI, autenticação, controle de versões e esquema PostgreSQL do banco central.
- `deploy/`: configuração Docker da API e instalador do backend para a VPS.

## Situação atual

- PostgreSQL da VPS foi instalado e considerado saudável no último teste informado pelo administrador.
- API e aplicação Android estão no GitHub, mas **a API ainda não foi instalada na VPS**.
- O **APK ainda não foi compilado/validado** e não deve ser tratado como pronto.
- HTTPS público, administrador, backups, testes de conflito e testes reais de sincronização ainda estão pendentes.
- A prévia web **não sincroniza com o servidor**: ela é apenas para testar o visual e o fluxo.

## Regras do projeto

- Um banco central PLUV e uma API PLUV para todos os usuários autorizados; jamais um banco por usuário.
- Cada Android grava localmente, independentemente da internet.
- Quando houver rede, tenta enviar alterações confirmadas de modo idempotente, com WorkManager.
- Conflitos não são sobrescritos silenciosamente; precisam de uma resolução.
- Outros aplicativos na VPS ficam isolados; não publicar PostgreSQL (5432) na internet.
- Nenhuma senha/credencial vai para GitHub.
- O servidor hospeda API + banco de dados; a interface executa nos dispositivos.

## Implantação

Leia `deploy/README.md`. Não altere o contêiner PostgreSQL existente nem execute comandos de remoção do volume de dados.

## Compilação Android

O projeto contém scripts Gradle e código-fonte Kotlin, porém **a compilação ainda precisa ser executada** em ambiente com Android SDK, Gradle e JDK compatíveis. O repositório não contém o arquivo binário `gradle-wrapper.jar`: será necessário gerar o wrapper com Gradle ou utilizar uma configuração Gradle compatível no Android Studio.

Não declarar o APK pronto antes de uma compilação real, instalação e testes de operação offline e sincronização.
