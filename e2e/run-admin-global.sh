#!/usr/bin/env bash
# Global admin E2E: two one-off stacks, in this order.
#
# The first stack runs every global scenario while the SMTP_* env transport is
# still active. The second stack runs `email.spec.ts`, where saving the sandbox
# transport overrides that env bootstrap for the rest of the stack's life.
set -euo pipefail

root=$(cd "$(dirname "$0")" && pwd)
export E2E_PORT="${E2E_PORT:-4310}"
export E2E_MAIL_PORT="${E2E_MAIL_PORT:-4803}"

cd "$root"
E2E_ADMIN_GLOBAL_TEST=1 bash run-docker.sh tests/admin/global \
  --output=test-results-admin-global
E2E_ADMIN_GLOBAL_TEST=1 E2E_ADMIN_EMAIL_SAVE_TEST=1 \
  bash run-docker.sh tests/admin/global/email.spec.ts \
  --output=test-results-admin-global-email
