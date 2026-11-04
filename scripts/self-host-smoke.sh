#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d)
export JANOSIK_INSTALL_DIR="$test_dir/instance"
export JANOSIK_COMPOSE_FILE="$root/docker-compose.yml"
export JANOSIK_IMAGE=${JANOSIK_IMAGE:-janosik-selfhost-local}
export JANOSIK_TAG=${JANOSIK_TAG:-codex}
unset COMPOSE_PROJECT_NAME
export JANOSIK_INSTALL_PORT
JANOSIK_INSTALL_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
cleanup() {
  if [[ -f "$JANOSIK_INSTALL_DIR/.env" && -f "$JANOSIK_INSTALL_DIR/docker-compose.yml" ]]; then
    (cd "$JANOSIK_INSTALL_DIR" && docker compose down -v --remove-orphans) || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

bash "$root/install.sh"
original_env=$(sha256sum "$JANOSIK_INSTALL_DIR/.env")
if bash "$root/install.sh"; then
  echo "Installer overwrote an existing installation" >&2; exit 1
fi
[[ $(sha256sum "$JANOSIK_INSTALL_DIR/.env") == "$original_env" ]]

(cd "$JANOSIK_INSTALL_DIR" && SMTP_HOST=smtp.example.test SMTP_PORT=2525 SETTINGS_SECRET=test-secret ALLOW_PUBLIC_SHARES=false docker compose config --format json) | python3 -c '
import json, sys
env = json.load(sys.stdin)["services"]["app"]["environment"]
expected = {"SMTP_HOST":"smtp.example.test", "SMTP_PORT":"2525", "SETTINGS_SECRET":"test-secret", "ALLOW_PUBLIC_SHARES":"false"}
assert all(str(env[key]) == value for key, value in expected.items())
print("Compose optional settings: OK")
'

python3 - <<'PY'
import json, os, urllib.request
base = 'http://localhost:' + os.environ['JANOSIK_INSTALL_PORT'] + '/api/v1'
def post(path, data, token=None):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path, json.dumps(data).encode(), headers)
    with urllib.request.urlopen(req) as response: return json.load(response)
auth = post('/auth/register', {'email':'smoke@example.test', 'password':'smoke-test-password'})
assert auth['user']['email'] == 'smoke@example.test'
key = post('/users/me/tokens', {'name':'smoke'}, auth['accessToken'])['token']
post('/boards', {'title':'Persistence smoke'}, key)
print('Registration, API key, and board creation: OK')
PY

(cd "$JANOSIK_INSTALL_DIR" && docker compose exec -T app sh -c 'printf backup-marker > /data/uploads/.smoke-marker')
(cd "$JANOSIK_INSTALL_DIR" && docker compose exec -T postgres pg_dump --clean --if-exists -U janosik janosik > "$test_dir/backup.sql")
(cd "$JANOSIK_INSTALL_DIR" && docker run --rm --volumes-from "$(docker compose ps -aq app):ro" -v "$test_dir:/out" alpine tar czf /out/uploads.tar.gz -C /data/uploads .)
python3 - <<'PY'
import json, os, urllib.request
base = 'http://localhost:' + os.environ['JANOSIK_INSTALL_PORT'] + '/api/v1'
def post(path, data, token=None):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path, json.dumps(data).encode(), headers)
    with urllib.request.urlopen(req) as response: return json.load(response)
auth = post('/auth/login', {'email':'smoke@example.test', 'password':'smoke-test-password'})
post('/boards', {'title':'Created after backup'}, auth['accessToken'])
PY
(cd "$JANOSIK_INSTALL_DIR" && docker compose exec -T app sh -c 'printf changed > /data/uploads/.smoke-marker')
(cd "$JANOSIK_INSTALL_DIR" && docker compose stop app)
(cd "$JANOSIK_INSTALL_DIR" && docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U janosik janosik < "$test_dir/backup.sql" > /dev/null)
(cd "$JANOSIK_INSTALL_DIR" && docker run --rm --volumes-from "$(docker compose ps -aq app)" -v "$test_dir:/out" alpine sh -c 'find /data/uploads -mindepth 1 -delete && tar xzf /out/uploads.tar.gz -C /data/uploads')
(cd "$JANOSIK_INSTALL_DIR" && docker compose start app && docker compose up -d --wait --wait-timeout 240)
(cd "$JANOSIK_INSTALL_DIR" && docker compose exec -T app sh -c 'test "$(cat /data/uploads/.smoke-marker)" = backup-marker')
python3 - <<'PY'
import json, os, urllib.request
base = 'http://localhost:' + os.environ['JANOSIK_INSTALL_PORT'] + '/api/v1'
req = urllib.request.Request(base + '/auth/login', json.dumps({'email':'smoke@example.test','password':'smoke-test-password'}).encode(), {'Content-Type':'application/json'})
with urllib.request.urlopen(req) as response: token = json.load(response)['accessToken']
req = urllib.request.Request(base + '/boards', headers={'Authorization':'Bearer ' + token})
with urllib.request.urlopen(req) as response: boards = json.load(response)
assert any(board['title'] == 'Persistence smoke' for board in boards), boards
assert not any(board['title'] == 'Created after backup' for board in boards), boards
print('Database and uploads restored, login and board persistence: OK')
PY
(cd "$JANOSIK_INSTALL_DIR" && docker compose exec -T app node /app/backend/scripts/admin-cli.cjs list)
