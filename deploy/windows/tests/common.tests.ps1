#Requires -Version 5.1
# Checks for the deploy scripts that need no service or administrator rights. Runs in CI on Windows and
# anywhere PowerShell runs:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\tests\common.tests.ps1

. (Join-Path $PSScriptRoot "..\common.ps1")
$script:failures = 0

function Assert-Equal($Actual, $Expected, [string]$What) {
  if ($Actual -ceq $Expected) {
    Write-Host "ok    $What"
  } else {
    Write-Host "FAIL  ${What}: expected [$Expected], got [$Actual]" -ForegroundColor Red
    $script:failures++
  }
}

# Every script parses (Windows PowerShell 5.1 included).
foreach ($file in Get-ChildItem -Path (Join-Path $PSScriptRoot "..") -Filter "*.ps1") {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  Assert-Equal $errors.Count 0 "$($file.Name) parses"
}

# Read-Settings reads the settings file like the launcher does.
$settingsFile = [IO.Path]::GetTempFileName()
$lines = @(
  "# comment",
  "HEALTH_TOKEN=abc123abc123abc123abc123  # trailing comment",
  'SMTP_FROM="Mert Kaan Koparan <me@example.com>"',
  "QUOTED='kept # as text'",
  "PASSWORD=abc#def",
  "export BACKUP_DIR=C:\leffloard\shared\backups",
  "EMPTY="
)
[IO.File]::WriteAllText($settingsFile, ($lines -join "`r`n"), (New-Object Text.UTF8Encoding($true)))
$settings = Read-Settings $settingsFile
Assert-Equal $settings["HEALTH_TOKEN"] "abc123abc123abc123abc123" "unquoted value, trailing comment dropped"
Assert-Equal $settings["SMTP_FROM"] "Mert Kaan Koparan <me@example.com>" "double-quoted value"
Assert-Equal $settings["QUOTED"] "kept # as text" "single-quoted value keeps #"
Assert-Equal $settings["PASSWORD"] "abc#def" "# inside a value is not a comment"
Assert-Equal $settings["BACKUP_DIR"] "C:\leffloard\shared\backups" "export prefix and backslashes"
Assert-Equal $settings["EMPTY"] "" "empty value"
Assert-Equal $settings.Count 6 "no other names"
Remove-Item -LiteralPath $settingsFile

# Get-Releases lists release folders oldest first and ignores anything else.
$root = Join-Path ([IO.Path]::GetTempPath()) ("leffloard-test-" + [guid]::NewGuid())
foreach ($name in @("20260926-120000", "20260101-000000", "not-a-release", "20261201-235959")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root "releases\$name") | Out-Null
}
Assert-Equal ((Get-Releases $root | ForEach-Object { $_.Name }) -join ",") "20260101-000000,20260926-120000,20261201-235959" "release order"
Assert-Equal @(Get-Releases (Join-Path $root "missing")).Count 0 "no releases folder"
Remove-Item -LiteralPath $root -Recurse -Force

if ($script:failures -gt 0) {
  Write-Host "$($script:failures) check(s) failed." -ForegroundColor Red
  exit 1
}
Write-Host "All checks passed."
