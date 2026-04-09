Param(
  [switch]$SkipInstall,
  [switch]$SkipDbPush,
  [switch]$RequireMediaDeps
)

$ErrorActionPreference = "Stop"

function Test-Cmd($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-TcpPort($HostName, $Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400)
    if (-not $ok) {
      $client.Close()
      return $false
    }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

Write-Host "[MarkReel] Preflight check" -ForegroundColor Cyan

$missing = @()
if (-not (Test-Cmd "node")) { $missing += "node" }
if (-not (Test-Cmd "npm")) { $missing += "npm" }
if (-not (Test-Cmd "ffmpeg")) { $missing += "ffmpeg" }
if (-not (Test-Cmd "ffprobe")) { $missing += "ffprobe" }

if ($missing.Count -gt 0) {
  Write-Host "[MarkReel] Missing required tools: $($missing -join ', ')" -ForegroundColor Red
  throw "missing_required_tools"
}

$sqliteDbPath = Join-Path (Get-Location) ".local/sqlite/markreel.db"
$redisUp = Test-TcpPort "localhost" 6379
$minioUp = Test-TcpPort "localhost" 9000

Write-Host "[MarkReel] Dependency status:" -ForegroundColor DarkCyan
Write-Host "  SQLite     : $(if (Test-Path $sqliteDbPath) { 'ready' } else { 'will be created' })"
Write-Host "  Redis      : $(if ($redisUp) { 'up' } else { 'down' })"
Write-Host "  MinIO      : $(if ($minioUp) { 'up' } else { 'down' })"

if ($RequireMediaDeps -and (-not $redisUp -or -not $minioUp)) {
  Write-Host "[MarkReel] Media pipeline deps are not fully ready." -ForegroundColor Red
  throw "missing_media_dependencies"
}

Write-Host "[MarkReel] Handing off to scripts/dev-local.ps1" -ForegroundColor Cyan

$forward = @()
if ($SkipInstall) { $forward += "-SkipInstall" }
if ($SkipDbPush) { $forward += "-SkipDbPush" }

powershell -ExecutionPolicy Bypass -File "$PSScriptRoot/dev-local.ps1" @forward
exit $LASTEXITCODE
