# Abra este script dentro da pasta principal do projeto PLUV.
# Servidor HTTP local so para seu computador; dados ficam no IndexedDB do navegador.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Web = Join-Path $Root 'web'
if (-not (Test-Path (Join-Path $Web 'index.html'))) { throw 'Pasta web nao encontrada. Execute dentro da pasta PLUV.' }
$cmd = Get-Command py -ErrorAction SilentlyContinue
if ($cmd) { $python=$cmd.Source; $prefix=@('-3') } else {
  $cmd=Get-Command python -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'Python nao encontrado. Instale Python ou execute pelo terminal do Android Studio que tenha Python.' }
  $python=$cmd.Source; $prefix=@()
}
Write-Host 'PLUV — PWA WEB LOCAL' -ForegroundColor Cyan
Write-Host 'Abrindo: http://127.0.0.1:8765' -ForegroundColor Green
Write-Host 'Se ja existe uma instancia na porta 8765, use a aba aberta.'
Write-Host 'Para desligar o servidor local: Ctrl+C (isso NAO apaga seus registros).'
Start-Process 'http://127.0.0.1:8765'
& $python @prefix -m http.server 8765 --bind 127.0.0.1 --directory $Web
