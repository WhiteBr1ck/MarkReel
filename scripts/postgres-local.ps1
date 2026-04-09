Param(
  [ValidateSet("status", "start", "stop", "ensure")]
  [string]$Action = "status",
  [switch]$ForceInit,
  [switch]$SkipDbBootstrap
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PgRoot = Join-Path $RepoRoot ".local/postgres"
$PgBin = Join-Path $PgRoot "bin"
$PgData = Join-Path $PgRoot "data"
$PgLogDir = Join-Path $PgRoot "log"
$PgLog = Join-Path $PgLogDir "postgres.log"
$InitDb = Join-Path $PgBin "initdb.exe"
$PgCtl = Join-Path $PgBin "pg_ctl.exe"
$Psql = Join-Path $PgBin "psql.exe"
$Createdb = Join-Path $PgBin "createdb.exe"
$env:PATH = "$PgBin;$env:PATH"
$DbName = "markreel"
$DbUser = "postgres"
$Port = 5432

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

function Require-Binary($Path, $Label) {
  if (-not (Test-Path $Path)) {
    Write-Host "[MarkReel] Missing portable PostgreSQL binary: $Label" -ForegroundColor Yellow
    Write-Host "          Expected at: $Path" -ForegroundColor Yellow
    throw "portable_postgres_missing_$Label"
  }
}

function Ensure-Dirs() {
  foreach ($dir in @($PgRoot, $PgLogDir)) {
    if (-not (Test-Path $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
  }
}

function Initialize-Cluster() {
  Require-Binary $InitDb "initdb.exe"
  Ensure-Dirs

  if ($ForceInit -and (Test-Path $PgData)) {
    Remove-Item $PgData -Recurse -Force
  }

  if (Test-Path (Join-Path $PgData "PG_VERSION")) {
    return
  }

  if (-not (Test-Path $PgData)) {
    New-Item -ItemType Directory -Path $PgData -Force | Out-Null
  }

  Write-Host "[MarkReel] Initializing portable PostgreSQL cluster..." -ForegroundColor Cyan
  & $InitDb -D $PgData -U $DbUser -A trust --encoding=UTF8
  if ($LASTEXITCODE -ne 0) {
    throw "portable_postgres_init_failed"
  }

  $configPath = Join-Path $PgData "postgresql.conf"
  if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw
    $config = $config -replace "(?m)^#?listen_addresses\s*=.*$", "listen_addresses = '127.0.0.1'"
    $config = $config -replace "(?m)^#?port\s*=.*$", "port = $Port"
    Set-Content -Path $configPath -Value $config -Encoding ASCII
  }
}

function Start-Cluster() {
  Require-Binary $PgCtl "pg_ctl.exe"
  Ensure-Dirs

  if (Test-TcpPort "localhost" $Port) {
    Write-Host "[MarkReel] Portable PostgreSQL already listening on localhost:$Port" -ForegroundColor DarkGray
    return
  }

  Write-Host "[MarkReel] Starting portable PostgreSQL..." -ForegroundColor Cyan
  & $PgCtl -D $PgData -l $PgLog -o "-p $Port" start
  if ($LASTEXITCODE -ne 0) {
    throw "portable_postgres_start_failed"
  }

  for ($i = 0; $i -lt 20; $i++) {
    if (Test-TcpPort "localhost" $Port) { return }
    Start-Sleep -Milliseconds 300
  }

  throw "portable_postgres_not_ready"
}

function Stop-Cluster() {
  Require-Binary $PgCtl "pg_ctl.exe"
  if (-not (Test-Path (Join-Path $PgData "postmaster.pid"))) {
    Write-Host "[MarkReel] Portable PostgreSQL is not running." -ForegroundColor DarkGray
    return
  }

  Write-Host "[MarkReel] Stopping portable PostgreSQL..." -ForegroundColor Cyan
  & $PgCtl -D $PgData stop
  if ($LASTEXITCODE -ne 0) {
    throw "portable_postgres_stop_failed"
  }
}

function Ensure-AppDatabase() {
  if ($SkipDbBootstrap) { return }

  Require-Binary $Psql "psql.exe"
  Require-Binary $Createdb "createdb.exe"

  $env:PGHOST = "localhost"
  $env:PGPORT = "$Port"
  $env:PGUSER = $DbUser
  $exists = & $Psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
  if ($LASTEXITCODE -ne 0) {
    throw "portable_postgres_check_db_failed"
  }

  if ($exists.Trim() -ne "1") {
    Write-Host "[MarkReel] Creating database '$DbName'..." -ForegroundColor Cyan
    & $Createdb $DbName
    if ($LASTEXITCODE -ne 0) {
      throw "portable_postgres_createdb_failed"
    }
  }
}

switch ($Action) {
  "status" {
    $hasBin = Test-Path $PgBin
    $hasData = Test-Path (Join-Path $PgData "PG_VERSION")
    $isUp = Test-TcpPort "localhost" $Port
    Write-Host "portable_root=$PgRoot"
    Write-Host "bin_present=$hasBin"
    Write-Host "cluster_present=$hasData"
    Write-Host "listening=$isUp"
  }
  "start" {
    Initialize-Cluster
    Start-Cluster
    Ensure-AppDatabase
  }
  "stop" {
    Stop-Cluster
  }
  "ensure" {
    Initialize-Cluster
    Start-Cluster
    Ensure-AppDatabase
  }
}
