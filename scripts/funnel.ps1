param(
  [ValidateSet("Start", "Status", "Reset")]
  [string]$Action = "Start"
)

$ErrorActionPreference = "Stop"

if ($Action -eq "Status") {
  tailscale funnel status
  exit $LASTEXITCODE
}

if ($Action -eq "Reset") {
  tailscale funnel reset
  exit $LASTEXITCODE
}

# Existing vocabulary service remains on 4174. Exposure Lab runs on 4175.
# Tailscale strips the public path prefix and proxies to the target path.
tailscale funnel --bg --yes --set-path /eng-vocabulary http://127.0.0.1:4174/
# Tailscale strips /leverage-etf before proxying.  The static server therefore
# receives / and serves dist/index.html without a Vite base-path redirect loop.
tailscale funnel --bg --yes --set-path /leverage-etf http://127.0.0.1:4175/
tailscale funnel status

