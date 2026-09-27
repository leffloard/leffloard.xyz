#Requires -Version 5.1
# Shared helpers for the deploy scripts. Written for Windows PowerShell 5.1, which every Windows Server
# has, so no PowerShell 7 syntax (no ??, no ternary, no && between commands).

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Note([string]$Message) {
  Write-Host "    $Message"
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from a PowerShell window opened with 'Run as administrator'."
  }
}

function Assert-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $Hint"
  }
}

# Runs a program and stops the script when it fails. Output goes straight to the console.
function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = (Get-Location).Path) {
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "'$FilePath $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

# Robocopy exit codes 0-7 mean success (files copied, extra files, ...); 8 and above are failures.
function Copy-Tree([string]$Source, [string]$Destination) {
  & robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Copying $Source to $Destination failed (robocopy exit code $LASTEXITCODE)."
  }
  $global:LASTEXITCODE = 0
}

# Reads NAME=value lines from the settings file (for the few values the scripts need themselves).
function Read-Settings([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    if ($trimmed -match '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      # Keep the name first: every -match below replaces $Matches.
      $name = $Matches[1]
      $value = $Matches[2]
      if ($value -match '^"(.*)"\s*(#.*)?$') { $value = $Matches[1] }
      elseif ($value -match "^'(.*)'\s*(#.*)?$") { $value = $Matches[1] }
      else { $value = ($value -replace '\s+#.*$', '').Trim() }
      $values[$name] = $value
    }
  }
  return $values
}

# The deep health check of a running copy: $null when it does not answer at all.
function Get-DeepHealth([int]$Port, [string]$Token) {
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health?deep=1" -Headers @{ "x-health-token" = $Token } -TimeoutSec 5
  } catch {
    $details = $_.ErrorDetails
    if ($details -and $details.Message) {
      try { return $details.Message | ConvertFrom-Json } catch { return $null }
    }
    return $null
  }
}

function Wait-Healthy([int]$Port, [string]$Token, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    $last = Get-DeepHealth -Port $Port -Token $Token
    if ($last -and $last.ok) { return $last }
    Start-Sleep -Seconds 2
  }
  if ($last) {
    Write-Note ("Last health answer: " + ($last | ConvertTo-Json -Compress -Depth 5))
  } else {
    Write-Note "The app did not answer on port $Port."
  }
  return $null
}

function Get-JunctionTarget([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType -ne "Junction") { throw "$Path exists but is not a junction. Move it away and run again." }
  return [string]($item.Target | Select-Object -First 1)
}

# Points $Path (a junction) at $Target. Removing a junction never touches the folder it points to.
function Set-Junction([string]$Path, [string]$Target) {
  if (Test-Path -LiteralPath $Path) {
    Get-JunctionTarget $Path | Out-Null
    & cmd.exe /c rmdir "$Path"
    if ($LASTEXITCODE -ne 0) { throw "Could not remove the junction $Path." }
  }
  New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
}

# Release folders are named yyyyMMdd-HHmmss, so sorting by name sorts by age.
function Get-Releases([string]$Root) {
  $dir = Join-Path $Root "releases"
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  return @(Get-ChildItem -LiteralPath $dir -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}$' } | Sort-Object Name)
}
