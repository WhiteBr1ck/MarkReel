#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for redis..."
for i in {1..60}; do
  if (echo > /dev/tcp/redis/6379) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Starting worker..."
npm -w @markreel/worker run start:dev
