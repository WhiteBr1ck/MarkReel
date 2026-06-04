#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for redis..."
for i in {1..60}; do
  if (echo > /dev/tcp/redis/6379) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Waiting for minio..."
for i in {1..60}; do
  if (echo > /dev/tcp/minio/9000) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

mkdir -p /app/data

echo "Generating Prisma client..."
npm -w @markreel/api run db:generate

echo "Applying Prisma schema (db push)..."
npm -w @markreel/api run db:push

echo "Starting API..."
npm -w @markreel/api run start:dev
