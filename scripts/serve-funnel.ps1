$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectRoot "dist"

if (-not (Test-Path -LiteralPath (Join-Path $distPath "index.html"))) {
  throw "dist/index.html is missing. Run scripts/start.ps1 to build the app first."
}

$listen = Get-NetTCPConnection -State Listen -LocalPort 4175 -ErrorAction SilentlyContinue
if (-not $listen) {
  $pythonLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
  if (-not $pythonLauncher) {
    throw "Python launcher (py.exe) is required to serve the Funnel build."
  }
  $server = Start-Process -FilePath $pythonLauncher.Source -ArgumentList @(
    "-m", "http.server", "4175", "--bind", "127.0.0.1", "--directory", $distPath
  ) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  Write-Host "Exposure Lab static server started (PID $($server.Id)) on http://127.0.0.1:4175/"
}

$health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4175/" -TimeoutSec 10
if ($health.StatusCode -ne 200) {
  throw "Exposure Lab local health check failed with HTTP $($health.StatusCode)."
}
Write-Host "Exposure Lab is ready at https://desktop-loi23mp.tail9c076e.ts.net/leverage-etf/"
