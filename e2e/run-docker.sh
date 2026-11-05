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

compose() {
  env -i PATH="$PATH" HOME="$HOME" DOCKER_HOST="${DOCKER_HOST:-}" \
    DOCKER_CONFIG="${DOCKER_CONFIG:-$HOME/.docker}" \
    docker compose --env-file "$temp_dir/compose.env" --project-name "$project" \
      -f "$root/docker-compose.yml" -f "$root/e2e/docker-compose.e2e.yml" "$@"
}
cleanup() {
  compose down --volumes --remove-orphans || true
  docker image rm "janosik-e2e-local:$project" >/dev/null 2>&1 || true
  rm -rf "$temp_dir"
}
trap cleanup EXIT

compose up --build --detach --wait --wait-timeout 240
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
