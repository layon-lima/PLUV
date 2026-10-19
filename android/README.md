# PLUV Android nativo — estado do desenvolvimento

Código Android em Kotlin + Jetpack Compose + Room/SQLite + WorkManager. O aplicativo ainda precisa de compilação real e validação em aparelhos. Os componentes principais estão em `app/src/main/java/com/pluv/app`:

- `MainActivity.kt`: telas de lista, detalhes, cadastro de pluviômetros, registro de chuvas e conexão.
- `PluvDatabase.kt`: banco local SQLite/Room, pluviômetros, medições, fila persistente e cursor de sincronização.
- `PluvRepository.kt`: gravação local transacional de dados e das operações pendentes.
- `PluvSyncWorker.kt`: envia alterações por HTTPS, recebe atualizações e agenda novas tentativas.
- `SecureConfig.kt`: guarda o token cifrado com o Android Keystore, em vez de embutir senhas.

**Estado:** código-fonte enviado à main, ainda sem APK compilado ou teste de integração com a VPS. A lógica de conflitos guarda divergências, mas a interface de resolução ainda não está concluída. Portanto ainda não é uma versão de produção.

## Requisitos de validação final

- Compilar com Android SDK/Gradle compatíveis (projeto usa Gradle 8.13 / AGP 8.11.1), gerar wrapper completo.
- Instalar APK e testar salvamento/edição/exclusão sem internet.
- Testar milhares de registros, reinício do app e do celular, e envio após retorno da internet.
- Verificar idempotência, alterações em vários aparelhos, conflitos, autenticação, expiração de sessão e backups.
- Conferir integridade após interrupção e repetição de envios.
- Garantir que só usuários autorizados sincronizam e que o PostgreSQL não é exposto.

O aplicativo offline não depende de servidor para gravar medições. A sincronização, login inicial e consultas compartilhadas dependem de conexão e de API HTTPS ativa.

## Gerar o APK no Windows

Foi adicionado `GERAR_APK.ps1`: execute na pasta `android` em um PC com Android Studio + SDK 35 para baixar Gradle 8.13 e gerar `app/build/outputs/apk/debug/app-debug.apk` sem GitHub Actions. Veja `COMPILAR_APK.md`.

O aplicativo utiliza `https://pluv.fazendanovohorizonte.com` como URL padrão para autenticação e sincronização.

## Segurança de sincronização

- A fila offline é persistente e enviada na ordem de inserção.
- O cursor remoto não avança sobre alterações conflitantes ainda não aplicadas.
- Conflitos são mantidos até o usuário escolher **Manter alteração do celular** ou **Usar versão do servidor**; se o servidor não retornou dados suficientes, o lançamento permanece protegido e pendente de suporte.
