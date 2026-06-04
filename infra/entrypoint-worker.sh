#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for redis..."
for i in {1..60}; do
  if (echo > /dev/tcp/redis/6379) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Waiting for api..."
for i in {1..60}; do
  if (echo > /dev/tcp/api/4000) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Generating Prisma client..."
npm -w @markreel/api run db:generate

echo "Starting worker..."
npm -w @markreel/worker run start:dev
