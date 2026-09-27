#Requires -Version 5.1
<#
.SYNOPSIS
  Checks the public site from the outside: the main pages answer 200 with the security headers.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\windows\smoke.ps1
  powershell -ExecutionPolicy Bypass -File deploy\windows\smoke.ps1 -BaseUrl https://staging.leffloard.xyz
#>
param(
  [string]$BaseUrl = "https://leffloard.xyz"
)

. (Join-Path $PSScriptRoot "common.ps1")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$paths = @("/", "/work", "/services", "/pricing", "/about", "/cv", "/cv.pdf", "/contact", "/blog", "/sitemap.xml", "/robots.txt", "/api/health")
$failures = 0

foreach ($path in $paths) {
  $url = $BaseUrl.TrimEnd("/") + $path
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 20
    $problems = @()
    if ($response.StatusCode -ne 200) { $problems += "status $($response.StatusCode)" }
    if (-not $response.Headers["Content-Security-Policy"]) { $problems += "no Content-Security-Policy" }
    if ($BaseUrl.StartsWith("https://") -and -not $response.Headers["Strict-Transport-Security"]) { $problems += "no HSTS" }
    if ($problems.Count -eq 0) {
      Write-Host ("  ok    {0}" -f $path) -ForegroundColor Green
    } else {
      $failures++
      Write-Host ("  FAIL  {0}: {1}" -f $path, ($problems -join ", ")) -ForegroundColor Red
    }
  } catch {
    $failures++
    Write-Host ("  FAIL  {0}: {1}" -f $path, $_.Exception.Message) -ForegroundColor Red
  }
}

if ($failures -gt 0) { throw "$failures check(s) failed." }
Write-Step "All $($paths.Count) checks passed for $BaseUrl"
