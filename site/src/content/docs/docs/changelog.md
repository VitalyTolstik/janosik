---
title: Changelog
description: The release history and the versioning scheme.
---

## Versioning

Notable changes are documented here in the style of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged
in git as `v<version>` (for example `v0.2.0`), and the container image is
published to `ghcr.io/vitalytolstik/janosik` from CI on a version tag. To run a
specific release, set `JANOSIK_TAG` in `.env` (see
[Self-hosting](/docs/self-hosting/)).

## Unreleased

- The agent surfaces now have three layers: the global
  [Agents](/docs/user-guide/agents/) control room (Attention / Sessions /
  Runs), a board-scoped Agent Control modal (Inbox / Live / Runs) and policy in
  Board Settings → Agents & automation. URL state, deep links and the testid
  migration are documented; MEMBER/VIEWER get read-only Live/Runs and no
  approval requests.
- Agent control adds scoped keys, sessions, human approvals, pause, plans and
  run inspection/rollback. Follow the [launch guide](/docs/agent-launch/).
- New keys default to worker without Trusted CI; legacy non-read-only keys
  retain admin and Trusted CI and should be reviewed. Sensitive account operations and human-control
  actions are session-only.
- Export schema v3 includes board policy; old clients reject v3. Board exports omit
  uploads and agent-control history. See the [runbook](/docs/runbooks/) for
  backup, restore drill and rollback.

## 0.2.0 - 2026-11-08

### Added

- **Secure password recovery.** Sign-in has a `Forgot password?` flow: an
  eligible account receives a single-use recovery code by e-mail, and the new
  password is accepted only inside its 15-minute window. A reset revokes every
  other session and every API key.
- **Richer public sharing.** Read-only links can now expose existing comments
  and attachments, keep a snapshot's comments and files frozen at capture time,
  and embed the board through an `<iframe>` with system, light or dark theme.
  Revoked links can be deleted from the owner's list, while the audit trail
  keeps the creation, revocation and deletion record.
- **Admin security tools.** The master panel records security events and lets
  an owner restrict master access by IP allowlist.

### Changed

- **Redesigned card details.** The dialog now keeps the title and labels in an
  inline header, moves destructive and less-used actions into a menu, splits
  content and properties into two columns, and collapses the link editor until
  it is needed. Long titles wrap, and comments and checklists sit tighter
  without losing their actions. Mobile puts the properties first.
- **Broader browser coverage.** The Chrome suite now covers authentication,
  boards, cards, calendar/table/watch views, filters, global and archive
  search, undo/redo history, two-account collaboration, and the account and
  API-key flows, including realtime updates, presence and conflicts.

### Fixed

- Deleting the open card no longer shows a false `Card not found` toast or
  leaves a stale `?card=` parameter behind.
- The card link editor keeps its focus and first click, closes on Escape, and
  stays open while the relation type is chosen.
- Undo after another member renamed the board marks the step dead instead of
  overwriting the newer name, and a live role change refreshes the caller's
  permissions without a reload.
- Description attachments are removed together with the description text and
  remain reversible through undo.
- The account panel now shows an uploaded avatar in its identity band, resets
  the email-change dialog after closing, and describes a password change as
  revoking API keys, which the server already did. Confirming an email change
  also revokes the old caller refresh token.

## 0.1.1 - 2026-11-04

### Added

- Self-hosting deliverables. A multi-stage `Dockerfile` builds the SPA and the
  API into a single image that serves both. A root `docker-compose.yml` brings
  up app, PostgreSQL and Redis with healthchecks and runs
  `prisma migrate deploy` on boot. `.env.example` documents every variable.
  Images publish to `ghcr.io` from CI on a version tag.
- Self-host hardening. `COOKIE_SECURE` with a fail-fast boot guard, so a
  production install on plain HTTP refuses to start rather than silently drop
  the refresh cookie. `ALLOW_REGISTRATION`, plus a public `GET /auth/config`
  the sign-in screen reads to hide registration when closed. `PURGE_AFTER_DAYS`
  retention fallback. SSE asserts `X-Accel-Buffering: no` so realtime works
  behind nginx.
- File attachments and avatars on local disk, with media paste, video
  transcoding to a compact MP4, and image thumbnails and video posters
  generated in the background.
- Public read-only board sharing, both a frozen snapshot and a live view, with
  per-token rate limits, OG previews and `?embed=1`.
- Master admin panel at `/admin`: users, boards, entities, moderation, support
  actions, feature flags, operations and maintenance, communications and
  announcements, data export and compliance, observability, security (TOTP 2FA
  and IP allowlist), and a Bull Board queue dashboard.
- Collaboration: realtime SSE, presence and attribution, comments with history
  diffs, and board members with roles and expiring access.
- Four board views — kanban, calendar, table and a read-only **watch** view for
  observing a swarm: a large status, a panel showing columns and online members, and a live
  activity feed with from → to diffs and paging. A persisted "Simplify design"
  toggle swaps the full card for a compact one-line face.
- Backend: command log with idempotency and conflict handling, BullMQ queues
  (mail, transcode, maintenance, media, exports, comms, demo), OAuth login
  (Google and Yandex), email flows (verification, change, templates), and Redis
  fan-out for multi-node realtime.
- **Agent-ready cards (TASK-157).** The card description is now the card's
  document: the limit is raised from 10k to 64k characters — 10k was a leftover
  of the 5 MB localStorage budget of local/offline mode, which server mode
  never uses. The `janosik` skill also defines a canonical card shape a swarm
  can pick up cold: description sections (`Why` / `Scope` / `Acceptance
  criteria` / `Out of scope` / `Verify`), a `Definition of Done` checklist,
  typed comments (a structured `kind`: `status` / `question` / `blocker` /
  `evidence` / `handoff`) and `agent:*` state labels used by the skill.
- **Card claims with a lease (TASK-157).** A `CLAIM_CARD` command takes a
  temporary work lease on a card (`claimedBy` + `leaseUntil`), so a swarm of
  agents can coordinate without two of them grabbing the same card: the server
  refuses a claim while another member holds a live lease, and the lease
  expires on its own, so a dead agent never leaves a card stuck. Two new MCP
  tools (`janosik_claim_card`, `janosik_release_card`) and a history entry for
  claims and releases.
- **Machine-readable task contract (TASK-157).** A `SET_CARD_TASK_SPEC`
  command sets a card's `acceptanceCriteria` and `definitionOfDone` as lists of
  short strings an agent reads directly instead of parsing prose. Each field is
  independent (omit to leave it unchanged, pass an empty list to clear it) and
  items are trimmed, de-blanked, clamped and capped. The MCP tool
  `janosik_set_card_task_spec` writes it, `janosik_get_card` renders it, and
  the card dialog shows it read-only.
- **Actor attribution (TASK-157).** Every command and activity row records
  whether a person (`"human"`, a browser session) or an agent (`"agent"`, a
  personal API token) caused it. The activity feed carries the type and the
  card history marks agent entries with an "Agent" badge.
- **API-token scopes and per-token rate limit (TASK-157).** A personal API
  token can be scoped to one board, made read-only (writes answer
  `403 pat_read_only`) and given its own requests-per-minute budget (over the
  budget answers `429`). The account panel exposes the three options.
- **Longer checklist items (TASK-157).** A checklist item's text limit rose
  from 200 to 500 characters, so an agent can park a sub-prompt or an exact
  command in an item.
- **Compare-and-set writes and idempotent creates (TASK-157).** Every
  command-log write tool takes an optional `expectedVersion` (the board `seq`
  from `janosik_get_board`): pass it and the write is refused with a version
  conflict if the board changed since, instead of silently overwriting another
  agent's edit. Create tools take a client id (`cardId`, `checklistId`, …) that
  doubles as the idempotency key, so a retried call returns the first entity
  rather than a duplicate.
- **Comment kinds (TASK-157).** A comment carries a structured `kind` (`note`
  by default, or `status` / `question` / `blocker` / `evidence` / `handoff`), so
  a thread is filterable by type instead of by a text prefix:
  `POST /cards/:id/comments` accepts `kind`, `GET /cards/:id/comments?kind=`
  filters, the MCP tools pass and filter it, and the card shows a kind badge
  with a picker in the composer.
- **Search across the whole card (TASK-157).** `GET /boards/:id/search?q=`
  matches a card's title, description, a checklist item or a comment; the MCP
  `janosik_search_cards` and the UI search also match checklist items. Comments
  (which are not in the board aggregate) are reached through the endpoint.
- **Read projection (TASK-157).** `janosik_get_board` and
  `janosik_search_cards` take `detail: "summary"` / `"full"`, so scanning a
  board whose cards carry 64k documents stays small.
- **Ready-to-work and a Definition-of-Done gate (TASK-157).**
  `janosik_list_ready_cards` returns the cards an agent can pick up (Backlog,
  unassigned, unclaimed, unblocked, by priority); `janosik_wait_for_work` blocks
  until one appears so idle agents need not poll. `janosik_move_card` checks
  moves into the last (Done) column for cards with a non-empty
  `definitionOfDone` field or a `Definition of Done` checklist. All items in
  that checklist must be checked, and an `evidence` comment must be present.

### Security

- Personal API keys can no longer manage credentials: listing, creating and
  revoking keys, changing the password and changing the email answer `403`
  with `code: "pat_forbidden"` and need a browser session. Changing the
  password revokes every API key. A key created through the API without an
  expiry now lasts 90 days; `null` still means never.
- Signing in with Google or Yandex into an existing unverified account first
  removes its password and revokes its sessions and API keys, closing a
  pre-account-takeover path. Unverified accounts see no invitations until
  they confirm their email.
- Inviting by email no longer reveals whether an account exists: every
  address answers `201` with a masked member, and only an accepted member is
  a `409`.
- Login backs off per account from the fifth failed password (30 seconds,
  doubling up to 15 minutes, `429` with `code: "login_backoff"`). Rate limits
  count per user or API key instead of per IP on authenticated routes, shared
  through Redis when `REDIS_URL` is set.
- Commands: an `at` more than five minutes off the server clock is replaced
  with server time, timestamps outside the Date range answer `400`, unknown
  action fields are dropped, and reusing a `commandId` with a different
  action answers `409`. `ifMatchVersions` keys are scoped to the target
  board. A board write that times out answers `503` with
  `code: "board_write_timeout"`.
- The command delta answers `X-Delta-Resync: 1` and SSE streams send a
  `resync` frame when a gap cannot be replayed; command frames carry
  `commandId`. Open streams re-check access on every keep-alive and close when
  access, the API key or the share is gone.
- JSON bodies are capped at 256 KB outside board import and commands. The CSP
  drops `'unsafe-inline'` for scripts in favour of hashes computed at
  startup. Snapshot share links show only comments and attachments that
  existed at capture time.
- Master panel: the IP allowlist is enforced on every request and refresh,
  and a list that excludes your own address cannot be saved. Deleting a user
  is owner-only.
- The container image drops root after fixing the uploads volume owner,
  refuses to start with `POSTGRES_PASSWORD=change-me`, and warns while
  registration is open. A migration adds time indexes to the command log.

## 0.1.0 - 2026-10-26

Initial project version: a Kanban board with an installable PWA interface with drag and
drop, calendar and table views, undo and redo, WIP limits, labels, checklists,
links, priorities, assignees, due dates, i18n (English and Russian), and a
NestJS and PostgreSQL backend.
