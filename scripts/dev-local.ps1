Param(
  [switch]$SkipInstall,
  [switch]$SkipDbPush
)

$ErrorActionPreference = "Stop"

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

function Get-PortPid($Port) {
  # netstat output example: TCP    0.0.0.0:4000   0.0.0.0:0   LISTENING   1234
  $lines = (netstat -ano -p TCP | Select-String ":$Port\s+")
  foreach ($l in $lines) {
    $parts = ($l -replace "\s+", " ").Trim().Split(" ")
    if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
      return [int]$parts[4]
    }
  }
  return $null
}

function Try-StopPortProcess($Port, $ProcessId) {
  try {
    $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $p) { return $false }

    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" | Select-Object -ExpandProperty CommandLine)
    if ($cmd -and $cmd -match "\\MarkReel\\") {
      Write-Host "[MarkReel] Port $Port is used by MarkReel (pid=$ProcessId). Stopping..." -ForegroundColor Yellow
      Stop-Process -Id $ProcessId -Force
      Start-Sleep -Milliseconds 300
      return $true
    }
  } catch {
    return $false
  }
  return $false
}

Write-Host "[MarkReel] Local dev launcher (no Docker)" -ForegroundColor Cyan

if (-not (Test-Path -Path ".env")) {
  Write-Host "[MarkReel] .env not found, creating from .env.example" -ForegroundColor Yellow
  Copy-Item ".env.example" ".env"
}

$localEnvPath = Join-Path (Get-Location) ".env.local"
$localDbRoot = Join-Path (Get-Location) ".local/sqlite"
$localDbPath = Join-Path $localDbRoot "markreel.db"
$localDbUrl = "file:./../../.local/sqlite/markreel.db"
$env:MARKREEL_ENV_FILE = $localEnvPath
$storeMode = "sqlite"

# Write a local env file so both Next.js and API use localhost endpoints.
$localLines = @(
  "WEB_BASE_URL=http://localhost:5090",
  "API_BASE_URL=http://localhost:4000",
  "INTERNAL_API_BASE_URL=http://localhost:4000",
  "MARKREEL_STORE=$storeMode",
  "JWT_ACCESS_SECRET=dev_access_secret_change_me_123456",
  "JWT_REFRESH_SECRET=dev_refresh_secret_change_me_123456",
  "JWT_ACCESS_TTL_SECONDS=900",
  "JWT_REFRESH_TTL_SECONDS=604800",
  "MARKREEL_ADMIN_USERNAME=admin",
  "MARKREEL_ADMIN_PASSWORD=adminadmin",
  "MARKREEL_ADMIN_DISPLAY_NAME=管理员",
  "MARKREEL_ALLOW_PUBLIC_REGISTRATION=false",
  "DATABASE_URL=$localDbUrl",
  "S3_ENDPOINT=http://localhost:9000",
  "S3_REGION=us-east-1",
  "S3_ACCESS_KEY=markreel",
  "S3_SECRET_KEY=markreel_secret",
  "S3_BUCKET_ORIGINAL=markreel-original",
  "S3_BUCKET_DERIVED=markreel-derived",
  "S3_BUCKET_ATTACHMENTS=markreel-attachments",
  "FFMPEG_THREADS=2",
  "HLS_SEGMENT_SECONDS=4"
)

Set-Content -Path $localEnvPath -Value ($localLines -join "`n") -Encoding ASCII
Write-Host "[MarkReel] Wrote local env: $localEnvPath" -ForegroundColor DarkGray

# Ensure this shell uses the values written to .env.local.
$env:MARKREEL_STORE = $storeMode
$env:JWT_ACCESS_SECRET = "dev_access_secret_change_me_123456"
$env:JWT_REFRESH_SECRET = "dev_refresh_secret_change_me_123456"

# Local dev overrides (host talks to localhost ports)
$webPort = 5090
$apiPort = 4000

$webPid = Get-PortPid $webPort
if ($webPid) {
  if (Try-StopPortProcess $webPort $webPid) {
    $webPid = Get-PortPid $webPort
  }
}

if ($webPid) {
  $p = Get-Process -Id $webPid -ErrorAction SilentlyContinue
  $name = if ($p) { $p.ProcessName } else { "unknown" }
  Write-Host "[MarkReel] Web port already in use: $webPort (pid=$webPid, process=$name)" -ForegroundColor Yellow
  Write-Host "          Stop it, or change the port." -ForegroundColor Yellow
  Write-Host "          Tip: netstat -ano | findstr :$webPort" -ForegroundColor Yellow
  throw "web_port_in_use"
}

$apiPid = Get-PortPid $apiPort
if ($apiPid) {
  if (Try-StopPortProcess $apiPort $apiPid) {
    $apiPid = Get-PortPid $apiPort
  }
}

if ($apiPid) {
  $p = Get-Process -Id $apiPid -ErrorAction SilentlyContinue
  $name = if ($p) { $p.ProcessName } else { "unknown" }
  Write-Host "[MarkReel] API port already in use: $apiPort (pid=$apiPid, process=$name)" -ForegroundColor Yellow
  Write-Host "          Stop it, or change the port." -ForegroundColor Yellow
  Write-Host "          Tip: netstat -ano | findstr :$apiPort" -ForegroundColor Yellow
  throw "api_port_in_use"
}

$env:WEB_BASE_URL = "http://localhost:5090"
$env:API_BASE_URL = "http://localhost:4000"
$env:INTERNAL_API_BASE_URL = "http://localhost:4000"

if (-not (Test-Path -Path $localDbRoot)) {
  New-Item -ItemType Directory -Path $localDbRoot | Out-Null
}

$env:DATABASE_URL = $localDbUrl
$env:REDIS_URL = "redis://localhost:6379"
$env:S3_ENDPOINT = "http://localhost:9000"

# The repository-level .env may contain short secrets (e.g. 'admin').
# Override them for local dev so API can boot.
$env:JWT_ACCESS_SECRET = "dev_access_secret_change_me_123456"
$env:JWT_REFRESH_SECRET = "dev_refresh_secret_change_me_123456"

if (-not $env:JWT_ACCESS_SECRET -or $env:JWT_ACCESS_SECRET.Length -lt 16) {
  $env:JWT_ACCESS_SECRET = "dev_access_secret_change_me_123456"
}
if (-not $env:JWT_REFRESH_SECRET -or $env:JWT_REFRESH_SECRET.Length -lt 16) {
  $env:JWT_REFRESH_SECRET = "dev_refresh_secret_change_me_123456"
}



if (-not $SkipInstall) {
  Write-Host "[MarkReel] Installing deps..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

# When using the in-memory store, Prisma isn't required to iterate UI quickly.
if ($env:MARKREEL_STORE -ne "inmemory") {
  Write-Host "[MarkReel] Generating Prisma client..." -ForegroundColor Cyan
  npm -w @markreel/api run db:generate
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -Path "node_modules/@prisma/client") {
      Write-Host "[MarkReel] prisma generate failed (often Windows file lock / antivirus)." -ForegroundColor Yellow
      Write-Host "          Continuing with existing Prisma client." -ForegroundColor Yellow
      Write-Host "          If API breaks after schema changes, rerun once no node process holds the engine." -ForegroundColor Yellow
    } else {
      throw "prisma generate failed"
    }
  }
}

if (($env:MARKREEL_STORE -ne "inmemory") -and (-not $SkipDbPush)) {
  Write-Host "[MarkReel] Syncing SQLite schema (prisma db push)..." -ForegroundColor Cyan
  npm -w @markreel/api run db:push
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[MarkReel] prisma db push failed for SQLite." -ForegroundColor Yellow
    throw "db push failed"
  }
}

$redisUp = Test-TcpPort "localhost" 6379
if (-not $redisUp) {
  Write-Host "[MarkReel] Redis not reachable at localhost:6379; worker will be skipped." -ForegroundColor Yellow
  Remove-Item Env:REDIS_URL -ErrorAction SilentlyContinue
}

$cmds = @(
  "npm -w @markreel/api run start:dev",
  "npm -w @markreel/web run dev"
)
if ($redisUp) {
  $cmds += "npm -w @markreel/worker run start:dev"
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npx not found (npm install failed?)"
}

if ($redisUp) {
  Write-Host "[MarkReel] Starting api + web + worker (watch mode)..." -ForegroundColor Cyan
  npx concurrently -k -n "api,web,worker" -c "blue,green,magenta" @cmds
} else {
  Write-Host "[MarkReel] Starting api + web (watch mode)..." -ForegroundColor Cyan
  npx concurrently -k -n "api,web" -c "blue,green" @cmds
}
