#!/bin/sh
# Janosik container entrypoint (TASK-38a/38b).
#
# Migrations are applied here, not as a manual README step: `docker compose
# pull && up -d` must upgrade the schema on its own, otherwise a newer image
# boots against an old schema and fails at runtime.
set -e

# Drop root. The image starts as root only so it can hand the uploads volume
# to the unprivileged `node` user — volumes created by older images are owned
# by root, and a plain `USER node` would make them unwritable after an
# upgrade. Everything below (migrations, the API, ffmpeg) runs as `node`.
if [ "$(id -u)" = "0" ]; then
  upload_dir="${UPLOAD_DIR:-/data/uploads}"
  mkdir -p "$upload_dir"
  if [ "$(stat -c %u "$upload_dir")" != "1000" ]; then
    echo "janosik: handing $upload_dir to the node user"
    chown -R node:node "$upload_dir"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

# The example password must never reach production: refuse it outright.
case "${DATABASE_URL:-}" in
  *:change-me@*)
    echo "janosik: POSTGRES_PASSWORD is still the example value 'change-me'." >&2
    echo "janosik: set a real password in .env (e.g. openssl rand -hex 24)." >&2
    exit 1
    ;;
esac

migrate_only="${MIGRATE_ONLY:-false}"
migrate_on_boot="${MIGRATE_ON_BOOT:-true}"

# TASK-200.12: several API replicas must not race the schema on every boot.
# The scaled overlay runs one `MIGRATE_ONLY=true` job and starts replicas with
# `MIGRATE_ON_BOOT=false`; a single-container install keeps both defaults.
if [ "$migrate_only" != "true" ] && [ "${ALLOW_REGISTRATION:-true}" = "true" ]; then
  echo "janosik: ALLOW_REGISTRATION is ON. Password signup requires SMTP or" \
    "one-time bootstrap. Set ALLOW_REGISTRATION=false for a private instance."
fi

if [ "$migrate_only" = "true" ] || [ "$migrate_on_boot" = "true" ]; then
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
fi

if [ "$migrate_only" = "true" ]; then
  echo "janosik: migrations complete (one-shot job); not starting the API"
  exit 0
fi

echo "janosik: starting API"
exec node dist/main.js
