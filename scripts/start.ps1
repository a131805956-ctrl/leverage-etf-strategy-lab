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
  $required = (Get-Date -Day 1).AddDays(-1).ToString("yyyy-MM-dd")
  $coveredThrough = $bundle.requiredCutoff
  $refresh = -not $coveredThrough -or $coveredThrough -lt $required
}

if ($refresh) {
  npm run data:update
}

npm run build
npm run preview

