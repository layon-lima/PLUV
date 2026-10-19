# Como gerar o primeiro APK do PLUV no Windows (sem GitHub Actions)

A versão nativa do projeto está em `android/`. Não existe APK pré-compilado no repositório; o arquivo `app-debug.apk` só existirá depois de uma compilação real.

O projeto inclui `android/GERAR_APK.ps1`: script PowerShell para Windows 11 que:

1. Localiza o **Android SDK 35** no PC (instalado pelo Android Studio).
2. Usa o Java que vem com o Android Studio, quando disponível.
3. Baixa automaticamente o Gradle **8.13** do site oficial (uma vez).
4. Executa `assembleDebug`, **sem GitHub Actions**.
5. Mostra o caminho do APK e o hash SHA256 quando a compilação terminar com sucesso.

## Antes da primeira execução

Instale o **Android Studio** e, em **SDK Manager**, instale **Android SDK Platform 35** e **Android SDK Build-Tools**. O SDK já deve estar no computador; o script não aceita licenças silenciosamente nem tenta alterar instalações de outros aplicativos.

## Uso

Abra PowerShell na pasta `android` do projeto PLUV e execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\GERAR_APK.ps1
```

Arquivo esperado: `android/app/build/outputs/apk/debug/app-debug.apk`.

Para baixar/atualizar o projeto público no PC com Git (caso ainda não exista clone):

```powershell
git clone https://github.com/layon-lima/PLUV.git
```

ou, se já foi clonado, execute `git pull --ff-only origin main`.

A compilação ainda não foi executada nesta conversa; portanto, nenhuma versão foi validada como APK instalável. O APK de debug não deve ser considerado uma versão final de produção.

O endereço fixo da API é `https://pluv.fazendanovohorizonte.com`.

**Testes finais necessários antes de usar dados reais:** instalação no aparelho, medição sem internet, edição, reinicialização, sync no retorno da internet, histórico em dois celulares, conflitos, autenticação e recuperação de backup.
