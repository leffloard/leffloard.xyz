#Requires -Version 5.1
<#
.SYNOPSIS
  Switches the site back to an earlier release (the one before the current, unless -To names one).

.DESCRIPTION
  Migrations are additive, so an earlier release runs fine on the current database. To go back further
  than the kept releases, deploy an older commit instead: deploy.ps1 -SkipPull after "git checkout <commit>".

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\leffloard\app\deploy\windows\rollback.ps1
  powershell -ExecutionPolicy Bypass -File C:\leffloard\app\deploy\windows\rollback.ps1 -To 20260926-120000
#>
param(
  [string]$Root = "C:\leffloard",
  [string]$ServiceName = "leffloard",
  [int]$Port = 3000,
  [string]$To = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Assert-Administrator

$current = Join-Path $Root "current"
$active = Get-JunctionTarget $current
$releases = Get-Releases $Root
if ($releases.Count -eq 0) { throw "No releases in $Root\releases." }

if ($To) {
  $target = $releases | Where-Object { $_.Name -eq $To } | Select-Object -First 1
  if (-not $target) { throw "No release named $To. Available: $(($releases | ForEach-Object { $_.Name }) -join ', ')" }
} else {
  $activeName = if ($active) { Split-Path -Leaf $active } else { "" }
  $older = @($releases | Where-Object { $_.Name -lt $activeName })
  if ($older.Count -eq 0) { throw "There is no release older than $activeName." }
  $target = $older[-1]
}

$settings = Read-Settings (Join-Path $Root "shared\leffloard.env")
Write-Step "Switching from $(Split-Path -Leaf $active) to $($target.Name)"
Set-Junction $current $target.FullName
Restart-Service -Name $ServiceName
if (Wait-Healthy -Port $Port -Token $settings["HEALTH_TOKEN"] -Seconds 90) {
  Write-Step "Running $($target.Name)"
} else {
  throw "$($target.Name) did not come back healthy. Check $Root\shared\logs\service.log."
}
