#!/bin/sh
# Janosik container entrypoint (TASK-38a/38b).
#
# Migrations are applied here, not as a manual README step: `docker compose
# pull && up -d` must upgrade the schema on its own, otherwise a newer image
# boots against an old schema and fails at runtime.
set -e

echo "janosik: applying database migrations"
# `prisma` is a runtime dependency of the backend image, so this never hits
# the network. It retries a few times in case postgres is still warming up
# despite the compose healthcheck.
attempts=0
until npx prisma migrate deploy; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 10 ]; then
    echo "janosik: migrations failed after $attempts attempts" >&2
    exit 1
  fi
  echo "janosik: database not ready, retrying ($attempts/10)…" >&2
  sleep 3
done

echo "janosik: starting API"
exec node dist/main.js
