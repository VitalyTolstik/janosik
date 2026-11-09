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
npm run test:admin -w e2e
npm run test:admin:global -w e2e
```

`test:admin` is the master-panel suite (`tests/admin/`) on its own disposable
stack. `test:admin:global` runs the server-wide settings scenarios in
`tests/admin/global/`: it opens two one-off stacks, because saving the email
sandbox transport must be the last mail-dependent test, and always runs with a
single worker. Never point the global suite at a shared or developer stack —
it changes email/OAuth/traffic/ops/demo settings and the cleanup restores them
via the panel/API, not by reverting the database. The core run uses ports
4300/4802; the global script defaults to 4310/4803 and writes reports to
`e2e/playwright-report-admin-{core,global}/`.

The last command runs the admin-settings scenario separately: it changes
global settings and must only target a disposable isolated stack. The
normal suite excludes it. CI runs both commands even if the first test suite fails,
and saves separate failure reports. To run more than one stack at
once, set distinct `E2E_PORT` and `E2E_MAIL_PORT` values.
Concurrent Playwright runs also need separate output directories: set
`PLAYWRIGHT_HTML_OUTPUT_DIR` and pass `--output` to the test command.
Each run creates an isolated master account (`master@e2e.example`, password
`e2e-master-password`), intended solely for the disposable test stack.

`tests/app/views/` covers the calendar, table and watch projections. Calendar:
month/week scale, Prev/Next/Today and scale persistence, rescheduling a chip
between days while keeping its time, dragging an unscheduled card onto a day,
the three-chip day cap with `+N more` and the full day panel, the day composer
with a chosen column and labels (including Cancel), read-only VIEWER controls,
and the 12/24-hour preference. Table: inline due date (set and remove), title,
labels and column edits, sorting every header asc → desc → board order with
`aria-sort` on the column header, optional columns persisted across reloads,
and the filtered empty state. Watch: status counts (archived cards excluded),
WIP limits, online roster, agent attribution, empty feed, board deletion
(visible feed error + retry), paging with page sizes 20/50/100 and retention
boundaries. The watch scenarios cover board, column and card activity, diffs,
comments, attachments, membership and paging. They also check the Undo/Redo
controls, administrator attribution, viewer access and public-link secrecy.
Each test has its own user and board. The retention and legacy-record scenarios
additionally adjust their own feed rows in the disposable Docker database; they
are skipped when using external development servers. E2E imports use `@/` for
paths relative to `e2e/`.

`tests/app/sharing/` covers public live and snapshot boards, read-only content,
link limits and revocation, and iframe themes on a separate local origin. Its
fixtures create a fresh user and board per test.

`tests/app/filters/` covers the board filter toolbar: title, description, label
and checklist search; the due, created, label, priority, assignee and link
facets; removable chips for every facet (including priority, assignee and
links); reset of the query and all facets; the active-facet and result counts;
per-column empty states; disabled drag & drop; a faceted filter in the table and
calendar views; and the filter living in the URL so a reload or shared link
restores it. Tests are independent and cover one behaviour each. They prove
the facets combine with AND by using a card that breaks exactly one facet, and
that switching boards does not leak the filter. Creation-date cases age cards
in the disposable Docker database, so they are skipped when running against
external development servers.

`tests/app/search/` covers the header global search (button and Ctrl/Cmd+K,
cross-board card and board hits, title/description/label/checklist matches,
highlights, archived badges and ranking, keyboard navigation and the 20-result
cap, opening the card dialog or the board), active-board cards ranking before
archived-board cards, whitespace-only/max-length queries and ArrowUp at the
first result, whitespace trimming in the board query and the card archive search
(filtering, no matches, empty archive, reset and opening an archived card). Each
test starts from its own user and board; extra boards are created through the
API.

`tests/app/history/` covers undo and redo through the header buttons and the
Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y shortcuts: button availability, clearing
the redo stack with a new edit, multi-step replay, per-board stacks, and the
saved result (but not the stack) surviving reload. It exercises every UI inverse
for cards, columns, labels, checklists and board rename, including nested
restores (a deleted card with its checklist, a deleted column with its cards,
a deleted label with its assignments). Two independent contexts verify that a
foreign card or board edit marks the overtaken step dead and undo leaves the
other member's text untouched; an unrelated foreign edit does not block local
undo. Each test starts from its own user and board.

`tests/app/collaboration/` covers the two-account flows: an admin invites an
account by email, the invitee sees the invitation in the bell with board,
inviter and role, accepts it (the board appears without a reload) or declines
it, and a pending invitation grants no access. Roles are exercised end to end:
a live promotion to ADMIN, a live demotion to a read-only VIEWER, the
last-ADMIN guard and a live removal that revokes access on an open board. Two
independent Chrome contexts verify realtime updates in under two seconds, the
presence roster and its departure within a minute, delta catch-up through
`?since=` after the stream is closed and reopened, and `commandId` retry
idempotency. Description conflicts are surfaced rather than silently
overwritten, «Keep mine» and «Reload» resolve them, and undo skips an edit made
in the other context. Each test starts from its own owner and board; the
two-account tests also get their own invited account and an independent browser
context.

`tests/app/account/` covers the personal account panel: profile name, avatar
color, photo upload (including a rejected non-image), the digest opt-out and
the persisted display preferences (theme, language, time format, board
background). The security flows rotate the password (happy path, wrong current
password, validation), verify that another browser session is signed out while
the caller stays in, and exercise the email change double opt-in with a real
code from Mailpit. API keys are created and copied through the UI, used for a
real API request, revoked with confirmation, refused afterwards, and refused
the right to mint more keys. Each test starts from its own verified account.

`tests/app/data/` covers the JSON data menu in server mode: exporting the whole
workspace and the columns, cards and labels of a board; importing a valid file,
several boards from one file, the preserved content and the board surviving a
reload; a workspace exported through the UI importing back; and the rejection of
malformed JSON, foreign files, unsupported schema versions, structurally
invalid board data, files over the 5 MB limit and an empty envelope the server
refuses (with no success toast). It also checks that restoring a local backup
stays unavailable in server mode. Each test starts from its own account and
board; fixtures build import envelopes through the API and delete their source
boards.

`tests/app/auth/`, `tests/app/account/`, `tests/app/boards/`,
`tests/app/columns/`, `tests/app/cards/`, `tests/app/data/` and
`tests/app/pwa/` also carry the coverage-audit follow-up. Auth adds the
account backoff after repeated wrong passwords and two tabs rotating one
refresh cookie under simultaneous reloads; account adds a board-scoped
read-only API key, key expiry/last-used metadata, the 2 MB avatar limit and
the email-change error paths; boards cover switcher grouping and role icons,
the ten-board limit and cancelling an archive; columns cover the WIP drop
refusal (with the card staying put), removing a WIP limit and the twelve-
column cap; cards cover attachment download through the authenticated blob
stream and its delete/type/20-file limits, rapid composer entry with
Shift+Enter and labels, own-comment deletion, Ctrl+Enter/Cancel and comment
pagination, insert-between cards, delete-forever, duplicate content and
move-to-column; data covers a full export → import round-trip (description,
label, priority, due, cover, checklist, link and an archived card), importing
the same file twice, deleting saved copies and a server-side import failure;
PWA covers the update banner (waiting worker, dismissal, reload and a second
tab following `controllerchange`) and rollback of an offline card edit. The
`mail-disabled` scenario now runs serially and snapshots/restores the global
email and registration settings per test.

`tests/app/navigation/` covers direct board and card links (including signing in
on the linked URL and the `/app/` deploy base), the home redirect, the board 404
and its recovery, archived-board redirects (a dead archived-card link explains
the redirect), browser Back/Forward, the all-archived empty state and its deep
link, and the board switcher's no-match, Escape focus return and ArrowUp
selection. Ctrl+click opens a card in a new tab from the board, table and
calendar. The keyboard layer covers the `?` cheat sheet (and the Help menu
trigger), the `j`/`k` cursor, `e`/Enter, the `n` and `c` composers, Escape, and
the guards that keep shortcuts out of text fields and open menus. Each test
starts from its own account and board; extra boards are created through the
API.

`tests/app/pwa/` covers the production PWA surface: the service worker is
registered under the app base and controls the page (also after a reload); the
precached shell and entry assets boot the app with the network switched off;
an offline card creation shows a clear "not saved" error and leaves no ghost
card on the server; reconnecting applies a change made by another writer during
the outage; an offline reload followed by a reconnect restores the session and
the saved board; API and event-stream responses never enter Cache Storage; and
the manifest and its icons resolve under `/app/`. The suite needs the production
self-host build (`E2E_APP_URL` ending in `/app/`) and skips itself when the app
is not served from that layout (for example, a dev server at the root). Only the
shell is cached: boards require a connection, so an offline reload lands on the
sign-in screen, as documented in the user guide.

Offline testing found a real crash: animated header icon chunks are prefetched
on idle, and a failed import took the whole board down with the global error
screen. `LazyAnimatedIcon` now keeps its static fallback when a chunk cannot
load, and a failed preload no longer announces a "new version" when no update
is actually waiting.

`tests/admin/` covers the master panel under `/app/admin`. The core suite
(`npm run test:admin`) is split by feature: login/auth-security (lockout,
TOTP enrollment/login/replay/disable, IP allowlist at login and per request,
login throttle, admin/user session isolation), shell (all 26 sidebar entries
in EN and RU, collapse/Ctrl+B, theme, language, six-type omnibox, Back/Forward,
deep links, unknown-route redirect), permissions (owner-only areas and
read-only settings for operators), dashboard, users and support actions
(search/status, create with a chosen password, verify/unverify/resend, change
email, session/token revocation, reset, promote, blocked impersonation, export,
detail counters/tabs), masters (create OWNER/OPERATOR, duplicate, block/enable,
reset, revoke, remove, self/last-owner guards), boards and board detail
(create/archive/restore/delete, bulk, members/roles/owner transfer), board
content (columns/cards through the command log), cards and the full card graph,
content browsers (columns/labels/checklists/links/comments/attachments/
sessions/tokens/activity/command payload/pagination), settings that do not
change the global transport (email status, observability), communications
(announcements, banner+email, template preview), security alerts, public shares,
audit families and error states. Each test provisions its own users, masters,
boards, cards and files through the API; assertions search a unique id or
email, and mutation tests verify their own audit event.

`tests/admin/global/` covers the server-wide settings: email status/test/save,
OAuth (both providers and the runtime login buttons), the traffic limit, demo
runner start/stop/live view/cleanup, all feature flags, maintenance mode,
per-user rate limit, retention purge, scheduled sweeps, one-off email and
template reset. The folder is only matched with `E2E_ADMIN_GLOBAL_TEST=1`;
the ordinary `browser-e2e` and `test:admin` runs ignore it. The global stack is
serial and one-off, and every destructive change is restored in `finally`.

`tests/admin/queue.spec.ts` expects the E2E Compose stack to set
`QUEUES_DASHBOARD=true` and start Redis; the owner opens Bull Board, the
operator sees the button disabled.

`tests/site/` covers the public marketing site. The landing checks the hero,
every section heading, the feature rows and an expandable FAQ answer; pricing
checks the plan cards with prices and limits, the comparison table, both plan
CTAs and the closing CTA. Navigation covers the header and footer links to
home, pricing and documentation (including the home features anchor, the
self-hosting guide, external project URLs and browser Back), while the CTA
suite clicks Sign in, Create account, hero and pricing links and verifies that
the app really opens its login or registration screen under the `/app/` base,
with the Russian `?lng=ru` handoff. Language tests switch home and pricing
between English and Russian in place and check `<html lang>`, translated
content and hreflang alternates. The theme tests toggle light/dark, survive a
reload, follow the system colour scheme until the visitor chooses, and carry
the shared `starlight-theme` choice into the documentation; the dual-language
404 page gets its own theme test. SEO tests assert title, description,
canonical, hreflang, Open Graph, Twitter and JSON-LD on the home, pricing, RU
and 404 pages, plus sitemap.xml, robots.txt, llms.txt, pricing.md and the
social cards. A mobile test checks 375px and the 720–879px tablet range (no
horizontal overflow, both auth CTAs reachable), analytics tests check the
delegated `dataLayer` event, Do Not Track and the CSP allow-list for the
optional Plausible script, and reduced-motion/accessibility tests cover paused
clips, the skip link, landmarks and visible focus. The 404 tests verify the
status, English and Russian copy, the docs link, language switch and noindex.
The site is public, so these tests need no account, fixture or API setup.

`tests/docs/` covers the Starlight documentation under `/docs/` and
`/ru/docs/`: all 22 English and 22 Russian pages (status, `<html lang>`, one
H1, title, description and canonical), a full crawl of every internal link and
`#fragment` across those 44 pages, the landing and the five sidebar groups,
Pagefind search (header button and Ctrl/Cmd+K, English and Russian indexes,
opening a result, keyboard navigation and focus return, empty query, no matches
and a recoverable bundle failure), code-block copy, tables, heading anchors,
the table of contents and the version badge, previous/next pagination,
language switching across user-guide, admin and API sections, docs SEO
(canonical, hreflang, docs social card), the localized 404 for unknown docs
paths, mobile search/sidebar and skip-link/landmark/keyboard basics. Explicit
and automatic theme persistence between the docs and the marketing site
(including after reload) and the site ↔ docs ↔ app links (header/footer
«Docs», the docs brand, the docs app entry point and the app Help menu) are
covered too. Most tests need no account; the app Help entry point signs in
with its own isolated account. Run just this set with
`npm run test:docker -w e2e -- tests/docs`.

To use already-running development servers instead, provide the site and app
URLs separately; point the app URL at the dev server root, not `/app/`. The
marketing CTAs must point at the same dev app, so start the site with
`PUBLIC_APP_URL` as well — otherwise it builds `/app/` links for the self-host
image and the CTA tests land on the site's 404:

```bash
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site
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
