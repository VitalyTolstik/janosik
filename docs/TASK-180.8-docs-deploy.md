# TASK-180.8 — Docs, deployment paths and onboarding

Implemented on the `feat/TASK-180.8-docs-deploy` branch from `bed2f350`.

| ID | Implementation | Verification |
| --- | --- | --- |
| M36 | The board detail **Edit content** link uses React Router's basename and preserves the return target. The admin palette's **Back to the boards app** uses the configured app base for its full-page navigation. EN/RU docs use `/app/admin/…` and `/app/agents` for the self-host image. Development examples show the Vite URL. | The Chromium board-detail suite signed into `/app/agents`, loaded a deep `/app/admin/boards/…` URL, followed **Edit content**, and returned to the signed-in user's board under `/app/` through the palette. The EN/RU docs crawl checked internal links and fragments. |
| M37 | README, EN/RU quickstarts and self-hosting guides describe first-account provisioning without SMTP or bootstrap. Create the owner master through the CLI, create a board user in **Users**, verify the email in the user's details, then sign in. The local installer and configured SMTP have their own signup instructions. | Compose config validated from a fresh root env template. With an empty PostgreSQL database, defaults and no SMTP or bootstrap, the UI hid signup and `POST /api/v1/auth/register` returned `503`. The CLI created the owner. In Chromium the owner created and verified the first board user. The user signed in and created a board. All three existing mail-disabled browser tests passed. |
| L3 | Both machine-readable resources generate base-aware site links. The self-host runtime replaces the reserved build origin in `llms.txt` and `pricing.md`, preserving their paths. | Built and served the site at `/` and at `SITE_BASE=/janosik/`. Browser checks resolved the resources' links against the deployed pricing canonical and docs URL. A backend unit test checked origin substitution with a port, prefix preservation, external links and unrelated Markdown. |
| L4 | Pricing JSON-LD breadcrumb labels and URLs are localized. The last breadcrumb uses the same trailing-slash URL as the page canonical. | Chromium parsed Russian pricing JSON-LD at `/ru/pricing/` and `/janosik/ru/pricing/` and asserted both breadcrumb URLs and Russian labels. |
| L5 | The branded 404 uses the site-relative `/ru/` prefix or, on an unprefixed path, the browser language. The page title, document language, header, footer, skip link and recovery links follow the chosen locale. | Verified status `404`, localized content and links in Chromium against Node, the prefixed site build and nginx. Existing assertions cover English, explicit Russian paths and `noindex`. The new regression covers `ru-RU` on an unprefixed missing path. |
| L7 | EN/RU workflow guides specify `schemaVersion: 3` with optional agent policy and describe continued import of versions 1 and 2. | The clean-install board export returned `schemaVersion: 3`. Shared board serialization tests passed. |
| L14 | nginx redirects bare `/app` to `/app/` with the original query and serves the built site error page with status `404` and `Cache-Control: no-cache`. Site directories without an index use the same fallback. | `nginx -t` passed with generated CSP. GET and HEAD checks against Node and nginx matched the `301` status and relative Location. The SPA and branded 404 bodies matched. The checks included missing EN/RU and docs paths, `/screens/` and the separate JSON API 404. With `404.html` absent in the disposable nginx copy, the site index was returned with status `404`. |
| L15 | EN/RU landing pages, pricing and machine-readable pricing omit claims about built-in backups. The guide distinguishes manual JSON board transfer from operator-managed PostgreSQL and uploads backups. | Checked generated EN/RU landing and pricing HTML plus `pricing.md` for the removed claims. The docs crawl confirmed the account and FAQ links to the operational runbooks. |

## Checks

- Backend build and typecheck, UI production build with `UI_BASE=/app/` including its TypeScript check, shared typecheck, site check and EN/RU builds at root and under `/janosik/`, and Playwright typecheck. Shared TypeScript is consumed by the UI and backend builds.
- Targeted tests passed for backend (67), shared serialization (37), UI (59), and site (69).
- Playwright passed for shipped-base admin navigation (7), mail-disabled authentication (3), the prefixed site (12), and the root site and docs on both Node and nginx (17 per server, including all 46 EN/RU docs pages and internal fragments).
- Repository ESLint and Prettier checks, `git diff --check`, `bash -n install.sh` and `docker compose config --quiet` passed. The README first-run link was checked against the corresponding Markdown heading slug.

## Residual risks

- The install dry run used locally built frontends and API, a fresh disposable PostgreSQL container and the shipped configuration contract. Published-image installation, live SMTP delivery and the full Docker/browser matrix were outside this run.
- The static 404 falls back to English without JavaScript. A site built with a non-root `SITE_BASE` must be mounted at that path by its host.
- The backup check covered product claims and runbook links. It did not execute an operator backup or restore drill.
