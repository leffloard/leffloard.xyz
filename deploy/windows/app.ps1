#Requires -Version 5.1
<#
.SYNOPSIS
  Runs one of the app's command-line tools with the production settings.

.DESCRIPTION
  The tools in scripts/ (npm run admin, migrate-legacy, backup, restore, migrate) read their settings from
  the environment; this passes them the service's settings file, from the Git checkout.

.EXAMPLE
  app.ps1 admin create
  app.ps1 admin status
  app.ps1 migrate-legacy --apply
  app.ps1 backup
  app.ps1 restore C:\leffloard\shared\backups\leffloard-leffloard-20260926T031500Z.lfbak --check
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("admin", "migrate", "migrate-legacy", "backup", "restore")]
  [string]$Tool,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments = @(),
  [string]$Root = "C:\leffloard"
)

. (Join-Path $PSScriptRoot "common.ps1")
Assert-Command "node" "Install Node.js 24 LTS from https://nodejs.org."

$settingsFile = Join-Path $Root "shared\leffloard.env"
$app = Join-Path $Root "app"
if (-not (Test-Path -LiteralPath $settingsFile)) { throw "No settings at $settingsFile. Run install-service.ps1 first." }
if (-not (Test-Path -LiteralPath (Join-Path $app "node_modules\tsx"))) { throw "Run deploy.ps1 once first: it installs what the tools need." }

Push-Location $app
try {
  & node "--env-file=$settingsFile" "--conditions=react-server" "--import" "tsx" "scripts/$Tool.ts" @Arguments
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
