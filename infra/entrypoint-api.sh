#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for postgres..."
for i in {1..60}; do
  if (echo > /dev/tcp/postgres/5432) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Waiting for redis..."
for i in {1..60}; do
  if (echo > /dev/tcp/redis/6379) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Applying Prisma schema (db push)..."
npm -w @markreel/api run db:push

echo "Starting API..."
npm -w @markreel/api run start:dev
