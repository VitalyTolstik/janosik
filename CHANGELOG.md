# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Self-hosting deliverables (TASK-38a/38b).** A multi-stage `Dockerfile`
  builds the SPA and the API into a single image that serves both; a root
  `docker-compose.yml` brings up app + PostgreSQL + Redis with healthchecks
  and runs `prisma migrate deploy` on boot; `.env.example` documents every
  variable; images publish to `ghcr.io` from CI on a version tag.
- **Self-host hardening (TASK-38a).** `COOKIE_SECURE` with a fail-fast boot
  guard (a production install on plain HTTP refuses to start rather than
  silently drop the refresh cookie); `ALLOW_REGISTRATION`; a public
  `GET /auth/config` the sign-in screen reads to hide registration when
  closed; `PURGE_AFTER_DAYS` retention fallback; SSE asserts
  `X-Accel-Buffering: no` so realtime works behind nginx.
- **File attachments & avatars** on local disk (no S3 needed), Jira-style
  media paste, video transcoding to a compact MP4, image thumbnails and video
  posters generated in the background.
- **Public read-only board sharing** (frozen snapshot and live), with
  per-token rate limits, OG previews and `?embed=1`.
- **Master admin panel** (`/admin`): users, boards, entities, moderation,
  support actions, feature flags, ops/maintenance, comms/announcements, data
  export & compliance, observability, security (TOTP 2FA, IP allowlist),
  and a Bull Board queue dashboard.
- **Collaboration**: realtime SSE, presence and attribution, comments with
  history diffs, board members with roles and expiring access.
- **Backend**: command log with idempotency and conflict handling, BullMQ
  queues (mail, transcode, maintenance, media, exports, comms, demo), OAuth
  login (Google / Yandex), email flows (verification, change, templates),
  Redis fan-out for multi-node realtime.
- **Documentation site** at `/docs` (Astro Starlight): a getting-started
  guide, self-hosting with the full environment reference and operations
  runbooks, a complete user guide, an admin-panel guide, an HTTP API reference
  with the command catalog, an FAQ and a security policy, in English and
  Russian with full-text search and a light/dark theme.
- **Real feature clips.** The landing page's seven clips are now genuine
  recordings of the running app (light and dark), produced by a Playwright
  pipeline in `video/record/` that seeds a demo board, records the real UI and
  the self-host terminal, and encodes mp4/webm/posters.
- **Screenshots in the user guide.** The user guide is rewritten around
  functions, with real screenshots of the running app on every screen
  (produced by `video/record/screenshots.mjs`), a new calendar-and-table views
  page, and a dedicated section for the card right-click quick menu.
- **In-app 404.** An unknown URL or an unknown board id now shows a themed
  not-found screen with a "Back to boards" action, instead of silently
  redirecting to another board (which hid typos and stale links). Revoking a
  member's access still moves them to another board. The marketing site's 404
  is now bilingual (English / Russian) and reads the language from the URL.
- **Dead card links.** A `?card=` that points at a card not on the board no
  longer fails silently: the stale param is dropped from the address bar and a
  short "Card not found" toast explains why nothing opened.
- **Docs version and an in-app Help menu.** The docs header now shows the
  version it describes (`v0.1.0`, read from the repo version at build time);
  the docs track the latest release and gain a version switcher once a second
  major exists. In the app, the header's "?" button is a Help menu that opens
  the keyboard-shortcut sheet and links to the documentation in the reader's
  language (`/docs/`, `/ru/docs/`).

- **MCP server (`@janosik/mcp`).** AI agents can drive a board through a
  personal API key, from any MCP client (`npx @janosik/mcp`). Every write goes
  through the command log, so changes stay undoable and stream live.
  - Tools come in groups. Boards, columns, cards, labels, checklists, card
    links, comments, activity and attachments are on by default; members,
    invitations, share links and the account are opt-in
    (`JANOSIK_MCP_TOOLSETS`), and `JANOSIK_MCP_READONLY=1` registers only
    tools that change nothing. With every group enabled there are 68 tools.
  - A write that changed nothing (an unknown id) is reported as an error, not
    as success. Tools that compute a write from a read send it with `ifMatch`
    and retry when another agent got there first; `janosik_update_card`
    offers compare-and-set through `expectedDescription`. Network failures
    are retried with the same idempotency key, and every request has a
    timeout.
  - API keys are managed only in the app: an API key can no longer create,
    list or revoke keys, so an agent cannot mint itself a key that outlives
    its own.
  - Ids are validated and percent-encoded, so an id can never re-target a
    request to another route.
  - Attachment upload/download and export to a file are opt-in
    (`JANOSIK_MCP_ALLOW_FS=1`) and can be confined with
    `JANOSIK_MCP_FS_ROOT`; symlinks out of the root are refused and existing
    files are never overwritten.
  - A card is created in one round-trip: `janosik_create_card` sends the card
    and its fields as a single batch to `POST /boards/:id/commands/batch`,
    which the server applies in one transaction under the board's write lock.
    On a 200-card board this roughly doubles write throughput (≈43 → ≈102
    commands/s) and more than halves per-command latency (TASK-160;
    `docs/PERF-ONE-BOARD.md`).

- **Agent skill (`skills/janosik`).** A behaviour playbook for agents working a
  board through the MCP tools: read before writing, claim and fill a card so it
  stands on its own, comment at every step, move it through the columns, and —
  when a bug turns up — return the card with the evidence (a comment and a
  checklist item) instead of marking it Done, so the board keeps an honest
  history. Plain `SKILL.md` plus `references/` for card/comment templates and
  lifecycle recipes; installs into Claude Code, opencode and any
  agent-compatible harness.

- **"Simplify design" card density (TASK-142).** A persisted board-view
  checkbox swaps the full card face for a compact one-line card: title, labels
  as colour dots, a blocked marker, checklist progress, priority and the
  assignee — everything else (description, due date, the hover quick actions)
  stays one click away in the card dialog. On a synthetic 2400-card board the
  compact face mounts **46% fewer DOM nodes** (4 482 → 2 414), renders the
  first card **~30% sooner** (1 060 → 740 ms) and fits ~45% more cards on
  screen. A live stream of 240 swarm updates (≈9/s) was applied with **no long
  tasks** on the main thread in either density. The choice is stored next to
  the board/calendar/table view (`janosik-board-density`), and the compact row
  height is wired through the same virtualization maths as the full face.
- **Watch view (TASK-142).** A fourth board view for observing a swarm: no
  cards, no drag & drop, no animations or transitions. It shows a large status
  (cards / columns / online), a column-count and online rail, and a live
  newest-first feed of the board's activity (commands + comments), re-read on a
  short timer and on realtime frames. On a 2400-card board it mounts **zero
  cards and ~405 DOM nodes** instead of 2 414 (compact) or 4 482 (full). The
  user guide gains a *Calendar, table and watch views* page (en/ru) with real
  screenshots of both the watch view and the compact cards; the README feature
  list, the landing copy and the docs generator
  (`video/record/screenshots.mjs`) are updated to match.
- **Watch clip on the landing page (TASK-142).** The home page gains a fifth
  feature row for the watch view, with a real recording of it in light and dark
  (a `feature-watch` clip from the `video/record/` pipeline: two teammates move
  cards and comment on another tab while the feed fills on its own). The
  user-guide watch section embeds the clip, and the pricing table and landing
  copy now list watch as a fourth view. The recorder can grab a poster from
  later in a scene (`posterMs`), so a clip whose opening frame is not the
  payoff still gets a useful still.
- **Agent-ready cards (TASK-157).** The card description is raised from 10k to
  64k characters — 10k was a leftover of the 5 MB localStorage budget of
  local/offline mode, which server mode never uses — and the `janosik` skill
  gains a canonical card shape a swarm can pick up cold: description sections
  (`Why` / `Scope` / `Acceptance criteria` / `Out of scope` / `Verify`), a
  `Definition of Done` checklist, typed comments (`[status]` / `[question]` /
  `[blocker]` / `[evidence]` / `[handoff]`) and reserved `agent:*` state labels.
- **Card claims with a lease (TASK-157).** A `CLAIM_CARD` command takes a
  temporary work lease on a card (`claimedBy` + `leaseUntil`) so a swarm can
  coordinate without two agents grabbing the same card: the server refuses a
  claim while another member holds a live lease, and the lease expires on its
  own so a dead agent never leaves a card stuck. New MCP tools
  `janosik_claim_card` / `janosik_release_card`, plus a history entry.
- **Machine-readable task contract (TASK-157).** A `SET_CARD_TASK_SPEC`
  command sets a card's `acceptanceCriteria` and `definitionOfDone` as lists
  of short strings an agent reads directly instead of parsing prose; each
  field is independent (omit to leave it, pass an empty list to clear it) and
  the items are trimmed, de-blanked, clamped and capped. The MCP tool
  `janosik_set_card_task_spec` writes it, `janosik_get_card` renders it, and
  the card dialog shows it read-only.
- **Actor attribution (TASK-157).** Every command and activity row now records
  whether a person (`"human"`, a browser session) or an agent (`"agent"`, a
  personal API token) caused it; the activity feed carries the type and the
  card history marks agent entries with an "Agent" badge.
- **API-token scopes and per-token rate limit (TASK-157).** A personal API
  token can now be scoped to a single board, made read-only (writes answer
  `403 pat_read_only`) and given its own requests-per-minute budget (over the
  budget answers `429`). The account panel exposes the three options and the
  token list shows the scope.
- **Longer checklist items (TASK-157).** A checklist item's text limit rose
  from 200 to 500 characters, so an agent can park a sub-prompt or an exact
  command in an item without truncation.

### Fixed

- **Large-board rendering (TASK-139).** A full board no longer mounts every
  card: kanban columns, table rows and the calendar's unbounded lists
  (unscheduled panel, week cells and the day panel) now mount only the rows
  around the viewport, with spacer elements preserving the exact scroll
  height. A 2400-card board went from 4.8 s / 67.7k DOM / 1.1 GB heap / 3.9 s
  main-thread block to ~0.7 s / 4.0k DOM / 90 MB / 176 ms; a 2400-row table
  from 49k DOM / 513 MB to 26 mounted rows. Dragging, filtering, archive and
  the keyboard cursor (which now scrolls its column to the target row) are
  unchanged, and `SortableContext` still receives every card id.
- **Retention, admin, realtime and upload hardening (TASK-148…156).**
  Retention sweeps and the board purge are paged; a soft-deleted board is
  restored as a whole subtree (children, labels, links, members and live
  shares), while previously deleted checklists stay deleted. Admin bulk
  restores replay in position order, report refused ids, and audit failures.
  Card/column restores keep their attachment badge and link snapshot;
  `RESTORE_COLUMN` has a finite internal size cap. Revoked live shares
  survive until the board purge window ends; snapshot shares are detached
  from a purged board instead of being deleted.
  Realtime re-attaches after a transient 404/410; the service worker reloads
  every open tab on `controllerchange`, refuses HTML-as-JS (including a
  poisoned previous cache), and announces an update once per waiting worker.
  Uploads stream to disk, clean the final blob on any failure after `rename`,
  and leave no `.tmp-*` scratch. `since`/cursor overflow is a 400, not a 500;
  the ops-settings cache cannot be overwritten by an in-flight stale read.
- **Share-dialog link lifetime.** The "Expires in" picker was a native
  `<select>` that rendered as a black browser control in the dark theme; it is
  now a themed popover with the project's check-mark radio rows, matching the
  role and expiry pickers elsewhere.
- **Board integrity under concurrent writers.**
  - A stale `MOVE_CARD` (wrong source column, archived card) could leave a card
    in two columns on every watching client; it is now a no-op.
  - `DUPLICATE_COLUMN` and the `RESTORE_*` undo commands can no longer reuse
    an id that is already on the board, which could overwrite another card.
  - Collection caps hold even for undo commands.
  - Undoing a card delete was refused by the server because the validator
    checked a non-existent activity field; it works again.
  - Undo of a move returns the card to its real former position.
  - Board import validates types, limits and integrity, and names the bad
    field instead of failing with a type error.
- **Realtime.**
  - A tab no longer drops changes made by the same account elsewhere, such as
    an MCP agent on your API key: echoes are matched by `commandId`, not by
    author.
  - A focus refetch can no longer overwrite newer changes.
  - A failed command refetches the board instead of restoring a stale
    snapshot.
  - A truncated catch-up triggers a full resync instead of silently
    diverging, and multi-node event streams re-read the log instead of
    dropping out-of-order events.
- **Edits survive leaving the page.** The description draft and queued edits
  are sent on page hide and before sign-out.
- **Command performance.** Card and column positions are written in one
  batched statement: a move between two 100-card columns went from 231 SQL
  statements and ~77 ms to 33 statements and ~20 ms (median, test database).
  New `Command` indexes back the admin metrics and the retention sweep.
- **`deploy/nginx.conf`.** App assets and the SPA fallback returned `404`, the
  1 MB default body limit refused imports and attachments, and share pages
  were not marked `noindex`. All three are fixed, and security headers were
  added.
- **Docs links.** 86 relative links in the documentation pointed at
  non-existent pages; a test now checks every internal link.

### Security

- **API keys cannot manage credentials.** Listing, creating and revoking keys,
  changing the password and changing the email need a browser session
  (`403 pat_forbidden` for a key). Changing the password revokes every key.
  Keys created through the API without an expiry last 90 days.
- **OAuth pre-account takeover.** Signing in with a provider into an existing
  unverified account now removes its password and revokes its sessions and
  keys before linking. Unverified accounts cannot accept invitations.
- **No account enumeration through invites.** Every address answers `201`.
- **Login backoff** per account, and rate limits per user or key rather than
  per IP (Redis-backed when configured).
- **Forged command clocks.** An `at` more than five minutes off is replaced
  with server time, so a client can no longer backdate a delete past the
  restore window. Unknown action fields are dropped, and a reused `commandId`
  with a different action answers `409`.
- **Streams re-check access** on every keep-alive and close when membership,
  the API key or the share is gone.
- **Impersonation links** are accepted only on `/impersonate` and only when
  the server confirms the token is a support session.
- **Admin.** The IP allowlist applies to every request, not just sign-in, and
  only an owner can delete a user.
- **Hardening.**
  - The CSP no longer allows inline scripts (hashes instead).
  - JSON bodies are capped at 256 KB outside import and commands.
  - Snapshot shares hide comments and attachments added after the snapshot.
  - The Docker image runs as an unprivileged user.
  - The container refuses the example database password.
  - CI publishes an image only after the tests pass, pins actions by commit,
    and runs CodeQL and Dependabot.

## [0.1.0] - 2026-10-26

Initial self-hosted release: offline-first PWA Kanban board with drag & drop,
calendar and table views, undo/redo, WIP limits, labels, checklists, links,
priorities, assignees, due dates, i18n (en/ru) and a NestJS + PostgreSQL
backend.

[Unreleased]: https://github.com/VitalyTolstik/janosik/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VitalyTolstik/janosik/releases/tag/v0.1.0
