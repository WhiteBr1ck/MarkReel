Param(
  [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"

function HasCommand($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  return $null -ne $cmd
}

Write-Host "[MarkReel] Dev launcher" -ForegroundColor Cyan

if (-not (Test-Path -Path ".env")) {
  Write-Host "[MarkReel] .env not found, creating from .env.example" -ForegroundColor Yellow
  Copy-Item ".env.example" ".env"
}

if (-not $SkipDeps) {
  if (HasCommand "docker") {
    Write-Host "[MarkReel] Starting dev dependencies via Docker..." -ForegroundColor Cyan
    docker compose up -d postgres redis minio minio-init
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
  } else {
    Write-Host "[MarkReel] Docker not found; skipping deps." -ForegroundColor Yellow
    Write-Host "          You must run Postgres/Redis/MinIO yourself." -ForegroundColor Yellow
    Write-Host "          Tip: npm run dev:debug:skip-deps" -ForegroundColor Yellow
  }
}

# Local dev overrides (host talks to mapped ports)
$env:WEB_BASE_URL = "http://localhost:5090"
$env:API_BASE_URL = "http://localhost:4000"
$env:INTERNAL_API_BASE_URL = "http://localhost:4000"

$env:DATABASE_URL = "postgresql://markreel:markreel@localhost:5432/markreel"
$env:REDIS_URL = "redis://localhost:6379"
$env:S3_ENDPOINT = "http://localhost:9000"

if (-not $env:JWT_ACCESS_SECRET -or $env:JWT_ACCESS_SECRET.Length -lt 16) {
  $env:JWT_ACCESS_SECRET = "dev_access_secret_change_me_123456"
}
if (-not $env:JWT_REFRESH_SECRET -or $env:JWT_REFRESH_SECRET.Length -lt 16) {
  $env:JWT_REFRESH_SECRET = "dev_refresh_secret_change_me_123456"
}

Write-Host "[MarkReel] Installing deps..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "[MarkReel] Preparing DB (generate + db push)..." -ForegroundColor Cyan
npm -w @markreel/api run db:generate
if ($LASTEXITCODE -ne 0) {
  if (Test-Path -Path "node_modules/@prisma/client") {
    Write-Host "[MarkReel] prisma generate failed (often Windows file lock / antivirus)." -ForegroundColor Yellow
    Write-Host "          Continuing with existing Prisma client." -ForegroundColor Yellow
  } else {
    throw "prisma generate failed"
  }
}
npm -w @markreel/api run db:push
if ($LASTEXITCODE -ne 0) {
  Write-Host "[MarkReel] DB not reachable. If you skipped deps, start Postgres first." -ForegroundColor Yellow
  throw "prisma db push failed"
}

Write-Host "[MarkReel] Starting api + worker + web (watch mode)..." -ForegroundColor Cyan

if (-not (HasCommand "npx")) {
  throw "npx not found (npm install failed?)"
}

# Use concurrently so one command starts everything
npx concurrently -k -n "api,worker,web" -c "blue,magenta,green" `
  "npm -w @markreel/api run start:dev" `
  "npm -w @markreel/worker run start:dev" `
  "npm -w @markreel/web run dev"
