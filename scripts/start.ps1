$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath "node_modules")) {
  npm install
}

$marketFile = Join-Path $projectRoot "public\data\market.json"
$refresh = -not (Test-Path -LiteralPath $marketFile)
if (-not $refresh) {
  $bundle = Get-Content -Raw -LiteralPath $marketFile | ConvertFrom-Json
  $latest = ($bundle.series.PSObject.Properties.Value | ForEach-Object {
    $_.bars[-1].date
  } | Sort-Object | Select-Object -First 1)
  $required = (Get-Date -Day 1).AddDays(-1).ToString("yyyy-MM-dd")
  $refresh = $latest -lt $required
}

if ($refresh) {
  npm run data:update
}

npm run build
npm run preview

