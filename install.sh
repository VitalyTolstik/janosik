#!/usr/bin/env bash
set -euo pipefail

# Install a local, single-user trial. Existing configuration is never replaced.
for command in docker curl openssl; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done
docker compose version >/dev/null
docker info >/dev/null 2>&1 || { echo "Docker is not running or is not accessible." >&2; exit 1; }

install_dir=${JANOSIK_INSTALL_DIR:-janosik}
install_port=${JANOSIK_INSTALL_PORT:-3210}
case "$install_port" in ''|*[!0-9]*) echo "JANOSIK_INSTALL_PORT must be a port number." >&2; exit 1;; esac
if (( 10#$install_port < 1 || 10#$install_port > 65535 )); then
  echo "JANOSIK_INSTALL_PORT must be between 1 and 65535." >&2; exit 1
fi

mkdir -p "$install_dir"
cd "$install_dir"
if [[ -e .env || -e docker-compose.yml ]]; then
  echo "An existing .env or docker-compose.yml was found in $install_dir; nothing was overwritten." >&2
  echo "To restart it, run: cd $install_dir && docker compose up -d" >&2
  exit 1
fi

umask 077
unset COMPOSE_PROJECT_NAME
compose_tmp=$(mktemp ./compose.XXXXXX)
env_tmp=$(mktemp ./env.XXXXXX)
trap 'rm -f "$compose_tmp" "$env_tmp"' EXIT
release_tag=
if [[ -n ${JANOSIK_COMPOSE_FILE:-} ]]; then
  cp "$JANOSIK_COMPOSE_FILE" "$compose_tmp"
else
  release_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/VitalyTolstik/janosik/releases/latest) || {
    echo "Could not find a public Janosik release. Check the releases page and your network connection." >&2; exit 1;
  }
  release_tag=${release_url##*/}
  if [[ ! $release_tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "No stable Janosik release was found. Check the releases page." >&2; exit 1
  fi
  curl -fsSL "https://raw.githubusercontent.com/VitalyTolstik/janosik/$release_tag/docker-compose.yml" -o "$compose_tmp"
fi
project_suffix=$(openssl rand -hex 4)
cat > "$env_tmp" <<EOF
# Keep this file safe and back it up together with the database and uploads.
COMPOSE_PROJECT_NAME=janosik-$project_suffix
POSTGRES_USER=janosik
POSTGRES_DB=janosik
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
PUBLIC_ORIGIN=http://localhost:$install_port
COOKIE_SECURE=false
APP_BIND_ADDRESS=127.0.0.1
PORT=$install_port
ALLOW_REGISTRATION=true
# Allows the very first account on a fresh install without SMTP. It is inert
# after that account exists; set it to false (or configure SMTP first).
ALLOW_BOOTSTRAP_USER=true
EOF
if [[ -n $release_tag ]]; then
  printf 'JANOSIK_TAG=%s\n' "$release_tag" >> "$env_tmp"
fi
mv "$compose_tmp" docker-compose.yml
mv "$env_tmp" .env
echo "Starting Janosik. The first download may take a few minutes..."
docker compose up -d --wait --wait-timeout 240
echo "Janosik is ready: http://localhost:$install_port/app/"
echo "Create the first account (one-time bootstrap without SMTP)."
echo "Then disable open registration and ALLOW_BOOTSTRAP_USER for a shared installation."
echo "Create the platform master with: docker compose exec app node /app/backend/scripts/admin-cli.cjs create --email you@example.com"
echo "Configuration: $install_dir/.env. Stop with: cd $install_dir && docker compose down"
