#!/usr/bin/env sh
set -eu

until mc alias set local http://minio:9000 "${S3_ACCESS_KEY:-markreel}" "${S3_SECRET_KEY:-markreel_secret}"; do
  sleep 1
done

mc mb -p "local/${S3_BUCKET_ORIGINAL:-markreel-original}" || true
mc mb -p "local/${S3_BUCKET_DERIVED:-markreel-derived}" || true
mc mb -p "local/${S3_BUCKET_ATTACHMENTS:-markreel-attachments}" || true
mc anonymous set download "local/${S3_BUCKET_DERIVED:-markreel-derived}" || true

echo "MinIO buckets ready"
