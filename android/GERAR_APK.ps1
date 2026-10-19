# PLUV — Compilar APK debug no Windows 11 sem GitHub Actions.
# Requisitos: Android SDK plataforma 35 instalada (Android Studio), internet, JDK 17+.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CacheRoot = Join-Path $env:LOCALAPPDATA 'PLUV\build-tools'
$GradleVersion = '8.13'
$GradleDir = Join-Path $CacheRoot ('gradle-' + $GradleVersion)
$GradleExe = Join-Path $GradleDir 'bin\gradle.bat'
$GradleZip = Join-Path $CacheRoot ('gradle-' + $GradleVersion + '-bin.zip')
$AndroidStudioJbr = 'C:\Program Files\Android\Android Studio\jbr'

Write-Host 'PLUV - COMPILADOR ANDROID' -ForegroundColor Cyan
Write-Host 'Pasta:' $ProjectRoot

$SdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))
$Sdk = $SdkCandidates | Where-Object { $_ -and (Test-Path (Join-Path $_ 'platforms\android-35\android.jar')) } | Select-Object -First 1
if (-not $Sdk) {
    throw "SDK Android 35 nao encontrado. Abra Android Studio > SDK Manager e instale Android SDK Platform 35 e Android SDK Build-Tools; depois execute este script novamente."
}
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
Write-Host 'Android SDK:' $Sdk

if (Test-Path (Join-Path $AndroidStudioJbr 'bin\java.exe')) {
    $env:JAVA_HOME = $AndroidStudioJbr
    $env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
}
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw 'Java nao encontrado. Instale o Android Studio com seu JDK integrado.'
}
& java -version

New-Item -Path $CacheRoot -ItemType Directory -Force | Out-Null
if (-not (Test-Path $GradleExe)) {
    Write-Host 'Baixando Gradle 8.13 (somente na primeira vez)...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri ('https://services.gradle.org/distributions/gradle-' + $GradleVersion + '-bin.zip') -OutFile $GradleZip -UseBasicParsing
    Write-Host 'Extraindo Gradle...'
    Expand-Archive -Path $GradleZip -DestinationPath $CacheRoot -Force
}
if (-not (Test-Path $GradleExe)) { throw 'Nao foi possivel preparar o Gradle.' }

Write-Host 'Compilando APK; a primeira execucao pode levar varios minutos...' -ForegroundColor Yellow
& $GradleExe --no-daemon --project-dir $ProjectRoot assembleDebug
if ($LASTEXITCODE -ne 0) {
    throw 'A compilacao falhou. Copie a mensagem BUILD FAILED (sem senhas) para corrigirmos no GitHub.'
}

$Apk = Join-Path $ProjectRoot 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $Apk)) { throw 'Gradle terminou, mas o APK nao foi encontrado.' }
$Hash = (Get-FileHash -Path $Apk -Algorithm SHA256).Hash
$SizeMb = [math]::Round((Get-Item $Apk).Length / 1MB, 2)
Write-Host ''
Write-Host 'APK PLUV GERADO:' -ForegroundColor Green
Write-Host $Apk
Write-Host ('Tamanho: ' + $SizeMb + ' MB')
Write-Host ('SHA256: ' + $Hash)
Write-Host 'Copie esse APK para o celular Android para instalar o aplicativo de teste.'
