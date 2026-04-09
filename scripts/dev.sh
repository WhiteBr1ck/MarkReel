#!/usr/bin/env bash
set -euo pipefail

echo "[MarkReel] Dev launcher"

if [ ! -f ".env" ]; then
  echo "[MarkReel] .env not found, creating from .env.example"
  cp .env.example .env
fi

SKIP_DEPS=${SKIP_DEPS:-0}
if [ "$SKIP_DEPS" != "1" ]; then
  if command -v docker >/dev/null 2>&1; then
    echo "[MarkReel] Starting dev dependencies via Docker..."
    docker compose up -d postgres redis minio minio-init
  else
    echo "[MarkReel] Docker not found; skipping deps."
    echo "          You must run Postgres/Redis/MinIO yourself."
    echo "          Tip: SKIP_DEPS=1 bash scripts/dev.sh"
  fi
fi

export WEB_BASE_URL="http://localhost:5090"
export API_BASE_URL="http://localhost:4000"
export INTERNAL_API_BASE_URL="http://localhost:4000"

export DATABASE_URL="postgresql://markreel:markreel@localhost:5432/markreel"
export REDIS_URL="redis://localhost:6379"
export S3_ENDPOINT="http://localhost:9000"

export JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET:-"dev_access_secret_change_me_123456"}
export JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-"dev_refresh_secret_change_me_123456"}

echo "[MarkReel] Installing deps..."
npm install

echo "[MarkReel] Preparing DB (generate + db push)..."
if ! npm -w @markreel/api run db:generate; then
  if [ -d "node_modules/@prisma/client" ]; then
    echo "[MarkReel] prisma generate failed; continuing with existing Prisma client." >&2
  else
    exit 1
  fi
fi
npm -w @markreel/api run db:push

echo "[MarkReel] Starting api + worker + web (watch mode)..."
npx concurrently -k -n "api,worker,web" -c "blue,magenta,green" \
  "npm -w @markreel/api run start:dev" \
  "npm -w @markreel/worker run start:dev" \
  "npm -w @markreel/web run dev"
