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

`tests/app/filters/` covers the board filter toolbar: title, description, label
and checklist search; the due, created, label, priority, assignee and link
facets; removable chips; reset; the active-facet count; per-column empty states;
disabled drag & drop; and the same filter in the table and calendar views (the
watch view hides the toolbar). Tests are independent and cover one behaviour
each. Creation-date cases age cards in the disposable Docker database, so they
are skipped when running against external development servers.

`tests/app/search/` covers the header global search (button and Ctrl/Cmd+K,
cross-board card and board hits, title/description/label/checklist matches,
highlights, archived badges and ranking, keyboard navigation and the 20-result
cap, opening the card dialog or the board), whitespace trimming in the board
query and the card archive search (filtering, no matches, empty archive, reset
and opening an archived card). Each test starts from its own user and board;
extra boards are created through the API.

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

`tests/app/navigation/` covers direct board and card links (including signing in
on the linked URL and the `/app/` deploy base), the home redirect, the board 404
and its recovery, archived-board redirects, browser Back/Forward and the
all-archived empty state. Ctrl+click opens a card in a new tab from the board,
table and calendar. The keyboard layer covers the `?` cheat sheet (and the Help
menu trigger), the `j`/`k` cursor, `e`/Enter, the `n` and `c` composers, Escape,
and the guards that keep shortcuts out of text fields and open menus. Each test
starts from its own account and board; extra boards are created through the API.

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

`tests/admin/` covers the master panel under `/app/admin`: signing in (a wrong
password, a regular account, session restore after a reload and sign-out), the
sidebar sections and direct URLs, the global omnibox and the return to the
boards app. Owner-only rights are checked from both sides: an operator does not
see the masters, email and OAuth entries, gets the 403 screen from the masters
URL, sees the IP allowlist read-only and no owner-only user actions, while the
operator can still block a user. Owners create a user, block and unblock one,
delete with the typed confirmation, mint an operator master and open a support
impersonation session in a new tab. Audit and Security are asserted with events
the test itself creates: a successful master sign-in, a failed sign-in (matched
by email and test IP) and user block/delete entries. Every test creates its own
unique target users and masters (through the admin API or the panel itself),
and assertions filter by a unique email or id; the shared owner session is used
only for setup and reading. The suite never changes global email, OAuth,
traffic or security settings.

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
