# PLUV Android — mesma interface e API do PWA

A partir da versão Android 1.0.0 (`versionCode 2`), o aplicativo é um **WebView** que carrega `https://pluv.fazendanovohorizonte.com/`. A interface vem de `web/` e o banco central é o PostgreSQL `pluv_db` na VPS.

## Funcionamento

- PWA no navegador e APK Android usam o **mesmo código de interface**, sem usuário ou senha, e sincronizam com a mesma API na VPS.
- Os registros são salvos offline no IndexedDB de **cada instalação**; a sincronização online compartilha as informações. O WebView deve ser aberto ao menos uma vez com internet para carregar seus arquivos e habilitar o cache do Service Worker.
- O botão ou gesto **Voltar** retorna do pluviômetro à lista e fecha formulários e janelas abertas antes de sair.
- Backup JSON: importar via seletor de arquivos do Android e exportar via janela nativa para escolher onde salvar.
- O ícone foi derivado da **arte SVG oficial enviada pelo proprietário** e é o mesmo do PWA.
- O projeto antigo com Room/WorkManager não é mais a interface ativa. A sincronização Kotlin anterior está desativada.

**Atenção aos dados antigos:** o IndexedDB do novo WebView é separado do armazenamento Room/SQLite do APK Kotlin antigo e também do IndexedDB do PWA no Chrome. Uma atualização de APK não migra os registros antigos automaticamente. Antes de substituir o APK anterior, confirme que os registros dele estão presentes na VPS ou guarde uma cópia.

## Gerar APK pelo Android Studio

1. Na pasta raiz `PLUV`, execute `git pull --ff-only origin main`.
2. Abra a subpasta `PLUV/android` no Android Studio.
3. Aguarde **Sync Project with Gradle Files** (JDK 21, SDK 35).
4. Use **Build → Generate App Bundles or APKs → Generate APKs**.
5. Arquivo previsto: `android/app/build/outputs/apk/debug/app-debug.apk`.

O commit do código no GitHub **não compila automaticamente um APK**. É necessário executar a compilação e testar no Android Studio.

## Atualização do servidor web

Na VPS, execute `bash /opt/apps/pluviometros/source/deploy/atualizar-vps.sh` depois que o código estiver publicado na branch `main`. Esse script preserva o banco PostgreSQL atual.
