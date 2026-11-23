#!/usr/bin/env bash
# Janosik — rolling re-create of the API replicas (TASK-200.12).
#
# Pulls the pinned image, optionally runs the one-shot migration job, re-creates
# the replicas with --wait (health-gated), then reloads whichever proxy image
# is running so it resolves the new replica addresses.
#
#   ./deploy/scale/rollout.sh
#   API_REPLICAS=4 ./deploy/scale/rollout.sh
#   RUN_MIGRATIONS=false ./deploy/scale/rollout.sh
#
# This is the supported middle ground in plain Compose: each replica is
# re-created and health-checked, the proxy retries a connection to another
# replica, and SSE clients reconnect with ?since=. It is not a zero-downtime
# guarantee; use Swarm/Kubernetes when that is required.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

replicas="${API_REPLICAS:-3}"
case "$replicas" in
  ''|*[!0-9]*)
    echo "API_REPLICAS must be a whole number" >&2
    exit 1
    ;;
esac
if [ "$replicas" -lt 1 ]; then
  echo "API_REPLICAS must be at least 1" >&2
  exit 1
fi

compose=(docker compose -f docker-compose.yml -f docker-compose.scale.yml)

echo "janosik: pulling the API/proxy images"
"${compose[@]}" pull

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "janosik: applying migrations once (one-shot job)"
  "${compose[@]}" run --rm migrate
fi

echo "janosik: re-creating ${replicas} API replica(s), waiting for health"
"${compose[@]}" up -d --no-deps --scale app="$replicas" app --wait

echo "janosik: reloading the proxy's replica list"
# One command works for both supported proxy images; `exec` keeps the signal in
# the container and returns a non-zero status if the reload fails.
"${compose[@]}" exec -T proxy sh -c '
  if command -v caddy >/dev/null 2>&1; then
    caddy reload --config /etc/caddy/Caddyfile
  else
    nginx -s reload
  fi
'

echo "janosik: rollout complete"
"${compose[@]}" ps
