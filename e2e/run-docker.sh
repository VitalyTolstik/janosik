#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
project="janosik-e2e-$(node -p 'require("node:crypto").randomBytes(6).toString("hex")')"
temp_dir=$(mktemp -d)
port=${E2E_PORT:-4300}
mail_port=${E2E_MAIL_PORT:-4802}

# An explicit env file and project name prevent this run from using the
# developer's self-host .env, volumes or containers.
cat > "$temp_dir/compose.env" <<EOF
POSTGRES_USER=janosik
POSTGRES_PASSWORD=e2e-test-only
POSTGRES_DB=janosik_e2e
JWT_SECRET=00000000000000000000000000000000000000000000000000000000000000ff
PUBLIC_ORIGIN=http://127.0.0.1:$port
COOKIE_SECURE=false
APP_BIND_ADDRESS=127.0.0.1
PORT=$port
E2E_MAIL_PORT=$mail_port
JANOSIK_IMAGE=janosik-e2e-local
JANOSIK_TAG=$project
EOF

docker_cli() {
  env -i PATH="$PATH" HOME="$HOME" DOCKER_HOST="${DOCKER_HOST:-}" \
    DOCKER_CONFIG="${DOCKER_CONFIG:-$HOME/.docker}" docker "$@"
}
compose() {
  docker_cli compose --env-file "$temp_dir/compose.env" --project-name "$project" \
    -f "$root/docker-compose.yml" -f "$root/e2e/docker-compose.e2e.yml" "$@"
}
cleanup() {
  compose down --volumes --remove-orphans || true
  docker_cli image rm "janosik-e2e-local:$project" >/dev/null 2>&1 || true
  rm -rf "$temp_dir"
}
trap cleanup EXIT

pull_prebuilt() {
  local auth_dir="$temp_dir/ghcr"
  local -a docker_args=()
  if [[ "$E2E_IMAGE" == ghcr.io/* && -n "${E2E_GHCR_TOKEN:-}" ]]; then
    # Keep the CI login in this run's temp dir, outside Docker's credential store.
    mkdir "$auth_dir" || return 1
    printf '{"auths":{"ghcr.io":{}}}\n' > "$auth_dir/config.json" || return 1
    docker_args=(--config "$auth_dir")
    printf '%s\n' "$E2E_GHCR_TOKEN" | docker_cli "${docker_args[@]}" login ghcr.io \
      --username "${GITHUB_ACTOR:-}" --password-stdin || return 1
  fi
  docker_cli "${docker_args[@]}" pull -- "$E2E_IMAGE"
}

build_flag=--build
if [[ -n "${E2E_IMAGE:-}" ]]; then
  if pull_prebuilt &&
    platform=$(docker_cli image inspect --format '{{.Os}}/{{.Architecture}}' -- "$E2E_IMAGE") &&
    [[ "$platform" == linux/amd64 ]]; then
    printf 'E2E_IMAGE=%s\nE2E_PULL_POLICY=never\n' "$E2E_IMAGE" >> "$temp_dir/compose.env"
    build_flag=--no-build
    echo "Using prebuilt e2e image $E2E_IMAGE"
  else
    echo "Could not log in, pull, or verify prebuilt e2e image $E2E_IMAGE. Falling back to a local Docker build." >&2
  fi
  rm -rf "$temp_dir/ghcr"
fi
unset E2E_GHCR_TOKEN
compose up "$build_flag" --detach --wait --wait-timeout 240
compose exec -T -e ADMIN_PASSWORD=e2e-master-password app \
  node /app/backend/scripts/admin-cli.cjs create --email master@e2e.example --owner
export E2E_SITE_URL="http://127.0.0.1:$port/"
export E2E_APP_URL="${E2E_SITE_URL}app/"
export E2E_MAIL_URL="http://127.0.0.1:$mail_port/"
export E2E_COMPOSE_PROJECT="$project"
export E2E_MASTER_EMAIL=master@e2e.example
export E2E_MASTER_PASSWORD=e2e-master-password
cd "$root"
npm run test -w e2e -- "$@"
