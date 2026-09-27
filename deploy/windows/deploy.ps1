#Requires -Version 5.1
<#
.SYNOPSIS
  Builds and deploys leffloard.xyz on the Windows server, with a trial start and automatic rollback.

.DESCRIPTION
  1. Updates the Git checkout in <Root>\app and builds it (npm ci, npm run build).
  2. Assembles a new release folder <Root>\releases\<yyyyMMdd-HHmmss>.
  3. Backs up the database, then applies the migrations (they are additive, so the running release keeps
     working on the new schema).
  4. Starts the new release on a trial port without background jobs and waits for its deep health check.
  5. Points <Root>\current at the new release and restarts the service. If the service does not come back
     healthy, it switches back to the previous release and restarts again.
  6. Keeps the newest -Keep releases.
  The live site is only touched in step 5, and only after the trial passed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\leffloard\app\deploy\windows\deploy.ps1
#>
param(
  [string]$Root = "C:\leffloard",
  [string]$ServiceName = "leffloard",
  [int]$Port = 3000,
  [int]$TrialPort = 3101,
  [string]$Branch = "main",
  [int]$Keep = 5,
  [switch]$SkipPull,
  [switch]$SkipBackup
)

. (Join-Path $PSScriptRoot "common.ps1")
Assert-Administrator
Assert-Command "git" "Install Git for Windows from https://git-scm.com."
Assert-Command "node" "Install Node.js 24 LTS from https://nodejs.org."
Assert-Command "npm" "It comes with Node.js."

$app = Join-Path $Root "app"
$settingsFile = Join-Path $Root "shared\leffloard.env"
$current = Join-Path $Root "current"
if (-not (Test-Path -LiteralPath $settingsFile)) { throw "No settings at $settingsFile. Run install-service.ps1 first." }
$settings = Read-Settings $settingsFile
$token = $settings["HEALTH_TOKEN"]
if (-not $token) { throw "Set HEALTH_TOKEN in ${settingsFile}: the deploy checks each release with it." }
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { throw "Service $ServiceName not found. Run install-service.ps1 first." }

# Scripts from the checkout run with the production settings, exactly like the service.
$nodeScript = @("--env-file=$settingsFile", "--conditions=react-server", "--import", "tsx")

Write-Step "Source ($Branch)"
if (-not $SkipPull) {
  Invoke-Checked "git" @("fetch", "--prune", "origin", $Branch) $app
  Invoke-Checked "git" @("checkout", $Branch) $app
  Invoke-Checked "git" @("merge", "--ff-only", "origin/$Branch") $app
}
$commit = (& git -C $app rev-parse --short HEAD).Trim()
Write-Note "Commit $commit"

Write-Step "Build"
Invoke-Checked "npm" @("ci", "--no-audit", "--no-fund") $app
Invoke-Checked "npm" @("run", "build") $app

Write-Step "Release folder"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$release = Join-Path $Root "releases\$stamp"
Copy-Tree (Join-Path $app ".next\standalone") $release
Copy-Tree (Join-Path $app ".next\static") (Join-Path $release ".next\static")
if (Test-Path -LiteralPath (Join-Path $app "public")) { Copy-Tree (Join-Path $app "public") (Join-Path $release "public") }
Copy-Item -LiteralPath (Join-Path $app "deploy\start-production.cjs") -Destination $release
"commit=$commit`r`nbuilt=$(Get-Date -Format o)`r`n" | Set-Content -LiteralPath (Join-Path $release "RELEASE.txt") -Encoding ASCII
Write-Note $release

try {
  if ($SkipBackup) {
    Write-Step "Backup skipped (-SkipBackup)"
  } elseif (-not $settings["BACKUP_KEY"]) {
    Write-Step "No backup: BACKUP_KEY is not set in $settingsFile"
  } else {
    Write-Step "Backup before the migrations"
    Invoke-Checked "node" ($nodeScript + @("scripts/backup.ts")) $app
  }

  Write-Step "Migrations"
  $attempt = 0
  while ($true) {
    $attempt++
    Push-Location $app
    try { & node @nodeScript "scripts/migrate.ts"; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -eq 0) { break }
    if ($code -eq 2 -and $attempt -lt 5) { Write-Note "Another process holds the migration lock; waiting."; Start-Sleep -Seconds 15; continue }
    throw "The migrations failed (exit code $code). The live site was not changed."
  }

  Write-Step "Trial start on port $TrialPort"
  $trialLog = Join-Path $Root "shared\logs\trial-$stamp.log"
  $saved = @{ PORT = $env:PORT; BACKGROUND_JOBS = $env:BACKGROUND_JOBS; LEFFLOARD_ENV_FILE = $env:LEFFLOARD_ENV_FILE }
  $env:PORT = "$TrialPort"
  $env:BACKGROUND_JOBS = "off"
  $env:LEFFLOARD_ENV_FILE = $settingsFile
  try {
    $trial = Start-Process -FilePath "node" -ArgumentList @("start-production.cjs") -WorkingDirectory $release `
      -RedirectStandardOutput $trialLog -RedirectStandardError "$trialLog.err" -PassThru -WindowStyle Hidden
  } finally {
    # The trial's variables must not leak into the service restart below.
    foreach ($name in @($saved.Keys)) {
      if ($null -eq $saved[$name]) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
      else { Set-Item -Path "Env:$name" -Value $saved[$name] }
    }
  }
  $healthy = Wait-Healthy -Port $TrialPort -Token $token -Seconds 90
  if (-not $trial.HasExited) { Stop-Process -Id $trial.Id -Force }
  if (-not $healthy) {
    Write-Note "Trial output: $trialLog"
    throw "The new release did not pass its health check. The live site was not changed."
  }
  Write-Note "Healthy: version $($healthy.version)"
} catch {
  Remove-Item -LiteralPath $release -Recurse -Force -ErrorAction SilentlyContinue
  throw
}

Write-Step "Switch to $stamp"
$previous = Get-JunctionTarget $current
Set-Junction $current $release
Restart-Service -Name $ServiceName
$live = Wait-Healthy -Port $Port -Token $token -Seconds 90
if (-not $live) {
  if ($previous) {
    Write-Step "Rolling back to $previous"
    Set-Junction $current $previous
    Restart-Service -Name $ServiceName
    if (Wait-Healthy -Port $Port -Token $token -Seconds 90) {
      throw "The new release failed after the switch; the previous one is running again. Logs: $Root\shared\logs\service.log"
    }
    throw "The rollback did not come back healthy either. Check $Root\shared\logs\service.log now."
  }
  throw "The first release did not start. Check $Root\shared\logs\service.log."
}
Write-Note "Live and healthy."

Write-Step "Old releases"
$keepNames = @((Split-Path -Leaf $release))
if ($previous) { $keepNames += (Split-Path -Leaf $previous) }
$releases = Get-Releases $Root
$removable = @($releases | Where-Object { $keepNames -notcontains $_.Name })
$excess = $releases.Count - [Math]::Max($Keep, 2)
if ($excess -gt 0) {
  foreach ($old in ($removable | Select-Object -First $excess)) {
    Remove-Item -LiteralPath $old.FullName -Recurse -Force
    Write-Note "Removed $($old.Name)"
  }
}
Get-ChildItem -LiteralPath (Join-Path $Root "shared\logs") -Filter "trial-*" |
  Sort-Object Name -Descending | Select-Object -Skip 10 | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Step "Deployed $commit as $stamp"
Write-Note "Check the public site with: deploy\windows\smoke.ps1"
