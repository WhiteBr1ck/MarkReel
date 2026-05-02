#!/usr/bin/env bash
set -euo pipefail

SKIP_INSTALL=0
SKIP_DB_PUSH=0
for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-db-push) SKIP_DB_PUSH=1 ;;
    *) ;;
  esac
done

echo "[MarkReel] Local dev launcher (unix, no Docker)"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  echo "[MarkReel] .env not found, creating from .env.example"
  cp .env.example .env
fi

mkdir -p .local/sqlite

cat > .env.local <<'EOF'
WEB_BASE_URL=http://localhost:5090
API_BASE_URL=http://localhost:4000
INTERNAL_API_BASE_URL=http://localhost:4000
MARKREEL_STORE=sqlite
JWT_ACCESS_SECRET=dev_access_secret_change_me_123456
JWT_REFRESH_SECRET=dev_refresh_secret_change_me_123456
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=604800
DATABASE_URL=file:./../../.local/sqlite/markreel.db
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=markreel
S3_SECRET_KEY=markreel_secret
S3_BUCKET_ORIGINAL=markreel-original
S3_BUCKET_DERIVED=markreel-derived
S3_BUCKET_ATTACHMENTS=markreel-attachments
FFMPEG_THREADS=2
HLS_SEGMENT_SECONDS=4
EOF

echo "[MarkReel] Wrote local env: $(pwd)/.env.local"

export MARKREEL_ENV_FILE="$(pwd)/.env.local"
export WEB_BASE_URL="http://localhost:5090"
export API_BASE_URL="http://localhost:4000"
export INTERNAL_API_BASE_URL="http://localhost:4000"
export MARKREEL_STORE="sqlite"
export DATABASE_URL="file:./../../.local/sqlite/markreel.db"
export REDIS_URL="redis://localhost:6379"
export S3_ENDPOINT="http://localhost:9000"
export JWT_ACCESS_SECRET="dev_access_secret_change_me_123456"
export JWT_REFRESH_SECRET="dev_refresh_secret_change_me_123456"

if [ "$SKIP_INSTALL" != "1" ]; then
  echo "[MarkReel] Installing deps..."
  npm install
fi

echo "[MarkReel] Generating Prisma client..."
if ! npm -w @markreel/api run db:generate; then
  if [ -d "node_modules/@prisma/client" ]; then
    echo "[MarkReel] prisma generate failed; continuing with existing Prisma client." >&2
    echo "          If API breaks after schema changes, rerun once no node process holds the engine." >&2
  else
    exit 1
  fi
fi

if [ "$SKIP_DB_PUSH" != "1" ]; then
  echo "[MarkReel] Syncing SQLite schema (prisma db push)..."
  npm -w @markreel/api run db:push
fi

if ! (exec 3<>/dev/tcp/127.0.0.1/6379) 2>/dev/null; then
  echo "[MarkReel] Redis not reachable at localhost:6379; worker will be skipped." >&2
  unset REDIS_URL
  REDIS_UP=0
else
  exec 3>&-
  REDIS_UP=1
fi

CMDS=(
  "npm -w @markreel/api run start:dev"
  "npm -w @markreel/web run dev"
)
if [ "$REDIS_UP" = "1" ]; then
  CMDS+=("npm -w @markreel/worker run start:dev")
fi

if [ "$REDIS_UP" = "1" ]; then
  npx concurrently -k -n "api,web,worker" -c "blue,magenta,green" "${CMDS[@]}"
else
  npx concurrently -k -n "api,web" -c "blue,magenta" "${CMDS[@]}"
fi
