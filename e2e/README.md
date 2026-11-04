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
npm run test:docker -w e2e -- --pass-with-no-tests
npm run test:docker -w e2e -- tests/app/auth
```

The first command also works before the first scenario is added. To run more
than one stack at once, set distinct `E2E_PORT` and `E2E_MAIL_PORT` values.
Each run creates an isolated master account (`master@e2e.example`, password
`e2e-master-password`), intended solely for the disposable test stack.

To use already-running development servers instead, provide the site and app
URLs separately; point the app URL at the dev server root, not `/app/`:

```bash
E2E_SITE_URL=http://localhost:4321/ E2E_APP_URL=http://localhost:5173/ npm run test:e2e
```

The dev servers need an API and suitable isolated data. Set `E2E_MAIL_URL` for
tests that read messages from Mailpit. PWA and cross-site flows require the
appropriate production build and origin configuration. Tests can use
`helpers/urls.ts` for these addresses. To target a folder, append it after `--`.

The HTML report is written to `e2e/playwright-report/`; failed tests retain a
trace and screenshot under `e2e/test-results/`. CI uploads both on failure.
