#Requires -Version 5.1
<#
.SYNOPSIS
  One-time setup of the leffloard.xyz Windows service (run as administrator).

.DESCRIPTION
  Creates the folder layout, locks down the settings file, and registers a service with NSSM that runs
  the current release as the virtual account "NT SERVICE\<name>" (no password, no rights beyond what is
  granted here). The site listens on 127.0.0.1 only; the Cloudflare Tunnel brings visitors to it.

    C:\leffloard\app        the Git checkout (build happens here)
    C:\leffloard\releases   one folder per deploy
    C:\leffloard\current    junction to the running release
    C:\leffloard\shared     leffloard.env (settings), backups\, logs\
    C:\leffloard\tools      nssm.exe

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1
#>
param(
  [string]$Root = "C:\leffloard",
  [string]$ServiceName = "leffloard",
  [int]$Port = 3000,
  [string]$Nssm = "",
  [string]$Node = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Assert-Administrator

if (-not $Nssm) { $Nssm = Join-Path $Root "tools\nssm.exe" }
if (-not (Test-Path -LiteralPath $Nssm)) {
  throw "nssm.exe not found at $Nssm. Download NSSM 2.24 from https://nssm.cc/download, and copy win64\nssm.exe there."
}
if (-not $Node) {
  Assert-Command "node" "Install Node.js 24 LTS from https://nodejs.org and open a new PowerShell window."
  $Node = (Get-Command node).Source
}

Write-Step "Folders under $Root"
$shared = Join-Path $Root "shared"
foreach ($dir in @("releases", "shared", "shared\backups", "shared\logs", "tools")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Root $dir) | Out-Null
}
$settings = Join-Path $shared "leffloard.env"
if (-not (Test-Path -LiteralPath $settings)) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "leffloard.env.example") -Destination $settings
  Write-Note "Created $settings from the template. Fill it in before the first deploy."
}

$account = "NT SERVICE\$ServiceName"

Write-Step "Service $ServiceName"
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Note "The service exists; updating its settings."
  if ($existing.Status -ne "Stopped") { Stop-Service -Name $ServiceName }
} else {
  Invoke-Checked $Nssm @("install", $ServiceName, $Node, (Join-Path $Root "current\start-production.cjs"))
}
$log = Join-Path $shared "logs\service.log"
$settingsList = @(
  @("Application", $Node),
  @("AppParameters", (Join-Path $Root "current\start-production.cjs")),
  @("AppDirectory", (Join-Path $Root "current")),
  @("AppEnvironmentExtra", "PORT=$Port"),
  @("DisplayName", "leffloard.xyz"),
  @("Description", "leffloard.xyz website and admin (Next.js). Settings: $settings"),
  @("Start", "SERVICE_AUTO_START"),
  @("AppStdout", $log),
  @("AppStderr", $log),
  @("AppRotateFiles", "1"),
  @("AppRotateOnline", "1"),
  @("AppRotateBytes", "10485760"),
  @("AppStopMethodConsole", "15000"),
  @("AppExit", "Default", "Restart"),
  @("AppRestartDelay", "5000"),
  @("AppThrottle", "10000")
)
foreach ($entry in $settingsList) {
  Invoke-Checked $Nssm (@("set", $ServiceName) + $entry)
}
# A virtual account: Windows manages it, it has no password and only the rights granted below.
Invoke-Checked "sc.exe" @("config", $ServiceName, "obj=", $account)

Write-Step "Permissions for $account"
# Settings: readable by the service and administrators only (it holds the database password and keys).
Invoke-Checked "icacls.exe" @($settings, "/inheritance:r", "/grant:r", "Administrators:F", "/grant:r", "SYSTEM:F", "/grant:r", "${account}:R")
Invoke-Checked "icacls.exe" @((Join-Path $Root "releases"), "/grant", "${account}:(OI)(CI)RX")
Invoke-Checked "icacls.exe" @($Root, "/grant", "${account}:RX")
Invoke-Checked "icacls.exe" @($shared, "/grant", "${account}:RX")
Invoke-Checked "icacls.exe" @((Join-Path $shared "backups"), "/grant", "${account}:(OI)(CI)M")
Invoke-Checked "icacls.exe" @((Join-Path $shared "logs"), "/grant", "${account}:(OI)(CI)M")

Write-Step "Done"
Write-Note "Next: fill in $settings, then run deploy\windows\deploy.ps1 (it builds, checks and starts the service)."
Write-Note "The service starts automatically with Windows and restarts itself 5 seconds after a crash."
