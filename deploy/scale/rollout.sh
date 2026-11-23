#!/usr/bin/env bash
# Janosik — health-gated API replica re-create (TASK-200.12).
#
# Pulls the pinned image, optionally runs the one-shot migration job, re-creates
# the API service with --wait, then reloads whichever proxy image is running so
# it resolves the new replica addresses.
#
#   ./deploy/scale/rollout.sh
#   API_REPLICAS=4 ./deploy/scale/rollout.sh
#   RUN_MIGRATIONS=false ./deploy/scale/rollout.sh
#
# The replica count comes from API_REPLICAS in the environment or `.env`, or
# from the overlay's `deploy.replicas` default. The script never passes
# `--scale`: a stale shell default must not shrink a running deployment.
#
# Plain Compose re-creates a service as a unit, so there can be a short window
# with no API replica ready. The proxy retries another upstream and SSE clients
# reconnect with ?since=, but this is not a zero-downtime rollout. Use
# Swarm/Kubernetes when continuous availability is required.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# Report/validate the configured count without sourcing `.env` (sourcing it
# would execute arbitrary shell). Compose still reads `.env` itself.
env_replicas=""
if [ -f .env ]; then
  env_replicas="$(
    sed -n 's/^[[:space:]]*API_REPLICAS[[:space:]]*=[[:space:]]*//p' .env |
      sed 's/[[:space:]]*#.*$//' |
      tail -n 1 |
      tr -d '"'"'" |
      tr -d '[:space:]'
  )"
fi
# A value Compose can interpolate but this simple parser cannot (e.g.
# `${REPLICAS}`) is left to Compose rather than failing the preflight.
case "$env_replicas" in
  *[!0-9]*) env_replicas="" ;;
esac
replicas="${API_REPLICAS:-$env_replicas}"
if [ -n "$replicas" ]; then
  case "$replicas" in
    *[!0-9]*)
      echo "API_REPLICAS must be a whole number" >&2
      exit 1
      ;;
  esac
  if [ "$replicas" -lt 1 ] || [ "$replicas" -gt 4 ]; then
    echo "API_REPLICAS must be 2-4 for production (1 only for rollback)" >&2
    exit 1
  fi
fi

compose=(docker compose -f docker-compose.yml -f docker-compose.scale.yml)

echo "janosik: pulling the API/proxy images"
"${compose[@]}" pull

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "janosik: applying migrations once (one-shot job)"
  "${compose[@]}" run --rm migrate
fi

echo "janosik: re-creating the API replicas (${replicas:-overlay default}), waiting for health"
echo "janosik: note: plain Compose replaces the service as a unit; a short API gap is possible" >&2
"${compose[@]}" up -d --no-deps app --wait

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
