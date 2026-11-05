# Browser E2E

The suite uses Playwright with **Google Chrome** (`channel: "chrome"`), not the
bundled Chromium. Install dependencies and Chrome once:

```bash
npm ci
npx playwright install chrome
```

Run against a fresh isolated self-host stack (Docker Compose, PostgreSQL,
Redis and Mailpit). The script builds the image from this checkout and removes
its containers and volumes on exit. Ports 4300 and 4802 must be free.

```bash
npm run test:docker -w e2e
npm run test:docker -w e2e -- tests/app/auth
E2E_MAIL_DISABLED_TEST=1 npm run test:docker -w e2e
```

The last command runs the admin-settings scenario separately: it changes
global settings and must only target a disposable isolated stack. The
normal suite excludes it. CI runs both commands even if the first test suite fails,
and saves separate failure reports. To run more than one stack at
once, set distinct `E2E_PORT` and `E2E_MAIL_PORT` values.
Concurrent Playwright runs also need separate output directories: set
`PLAYWRIGHT_HTML_OUTPUT_DIR` and pass `--output` to the test command.
Each run creates an isolated master account (`master@e2e.example`, password
`e2e-master-password`), intended solely for the disposable test stack.

`tests/app/views/` covers calendar and table card actions, watch column counts,
view switching and persistence after reload. The watch scenarios cover board,
column and card activity, diffs, comments, attachments, membership and paging.
They also check the Undo/Redo controls, administrator attribution, viewer
access and public-link secrecy. Each test has its own user and board.
The retention and legacy-record scenarios additionally adjust their own feed
rows in the disposable Docker database; they are skipped when using external
development servers. E2E imports use `@/` for paths relative to `e2e/`.

`tests/app/sharing/` covers public live and snapshot boards, read-only content,
link limits and revocation, and iframe themes on a separate local origin. Its
fixtures create a fresh user and board per test.

To use already-running development servers instead, provide the site and app
URLs separately; point the app URL at the dev server root, not `/app/`:

```bash
E2E_SITE_URL=http://localhost:4321/ E2E_APP_URL=http://localhost:5173/ npm run test:e2e
```

The dev servers need an API and suitable isolated data. Set `E2E_MAIL_URL` for
tests that read messages from Mailpit, and configure `TRUST_PROXY=1` on the
isolated API so each browser test has an independent rate-limit bucket. The
test-only Compose setup already does this. PWA and cross-site flows require the
appropriate production build and origin configuration. Tests can use
`helpers/urls.ts` for these addresses. To target a folder, append it after `--`.

The HTML report is written to `e2e/playwright-report/`; failed tests retain a
trace and screenshot under `e2e/test-results/`. CI uploads both on failure, with
separate artifacts for the normal and email-disabled suites.
