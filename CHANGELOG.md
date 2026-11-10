# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- TASK-166.4 reliable write contract: every REST error now uses one
  machine-readable envelope — stable `code`, human `message`, `retryable`,
  `requestId` (same as `X-Request-Id`), `currentVersion`, optional `field`,
  `details`, `limit`, `conflict`, `allowedToColumnIds` and the approval seam —
  while preserving the existing HTTP statuses and legacy `conflict`/
  `workflow`/`field`/`retryAfter` fields. Unexpected exceptions become
  `500 internal_error` without a stack trace or secrets. The ADR's REST writes
  (`POST /boards`, import, `add_comment`, `create_share`, attachment upload and
  a `DUPLICATE_CARD` command) honour `Idempotency-Key` for 24 h: the same key
  and body replay the stored response, another body is
  `409 idempotency_conflict`, and a concurrent retry is
  `409 idempotency_in_progress` with `retryable: true`. MCP mutations expose
  `structuredContent` (`ok`, `resourceId`, `seq`, `runId`, `approvalId`), MCP
  errors carry the same code/retryable/requestId envelope plus next-step
  guidance, and the REST writes accept an optional `idempotencyKey` (8–128
  `[A-Za-z0-9_-]`). Rate-limit responses keep the limiter's real
  `Retry-After` and mirror it into `retryAfter`. The UI
  error type reads the new fields; docs EN/RU and CHANGELOG cover the envelope
  and idempotency.
- TASK-31 mobile UX: the calendar and table now have a real touch layer.
  A long press lifts a calendar chip (month, week and the unscheduled panel)
  and a table row; dropping reschedules the chip with its time-of-day kept,
  and dropping a row on another row moves the card into that row's column
  under the same workflow/WIP checks as the desktop menus. A slow tap stays a
  tap; once the finger starts moving, holding near an edge auto-scrolls the
  container under it (the grid, the table, or a virtualized table) so days and
  rows outside the first viewport stay reachable, and calendar day-panel rows
  and table rows have an explicit "Card actions" button (the long-press now
  belongs to the drag; month chips open the day panel for it, mouse right-click
  is unchanged). Taps, scrolling, double-tap column rename and touch card
  creation keep working.
  At 390 px the board header becomes a two-row bar, the filter bar and every
  board dialog fit the viewport, the calendar opens with its unscheduled rail
  collapsed, and the table shows its working columns instead of clipping them.
  Tooltips are suppressed after touch input so a tap focuses the next control
  rather than a bubble over it.
- TASK-166.0 launch policy/ADR: frozen agent identity and session
  attribution, scope presets with explicit legacy-token grandfathering,
  approval/plan-hash lifecycle, run boundaries and rollback, pause/kill
  semantics, the REST/MCP action matrix, and the additive error envelope
  (`docs/TASK-166-launch-agent-control.md`). Docs-only: no product behaviour
  changes; W1 (166.1–166.6) is unblocked.
- TASK-166.1 agent identity and sessions: every command, activity row,
  comment, attachment and claim written through a personal API token now
  carries `apiTokenId`, the optional `agentSessionId`, `runId` and the token
  name snapshot, so two PATs of one account are distinguishable in the
  database, history API, Watch/activity feed and SSE. Adds board-scoped agent
  sessions (`POST /boards/:id/agent-sessions`, heartbeat, end, list/detail)
  with the optional `X-Agent-Session` header, `GET /auth/me` token identity,
  TASK-166 token DTO fields (`scopePreset`, `trustedCi`, pause stamps,
  `effectiveTokenScope`), MCP `start_session`/`heartbeat`/`end_session`
  tools, and the complete TASK-166 Prisma schema/migration (sessions, runs,
  approvals, pre-images, security audit and idempotency tables; board/token
  pause fields) as the single schema owner for streams 166.1–166.16. Legacy
  tokens are grandfathered to `scopePreset = "admin"` + `trustedCi = true`
  (read-only tokens keep effective observer), and clients without the header
  keep working.
- TASK-166.2 token scopes and destructive gate: every PAT now has an immutable
  preset (`observer`, `worker`, `reviewer`, `admin`) with a separate
  `trustedCi` flag. New keys default to `worker`; legacy keys stay
  `admin` + `trustedCi` unless read-only. The preset never raises the board
  role: observers cannot write, done-column transitions need `reviewer`, and
  board administration needs `admin`. Board-scoped keys stay on their board
  and cannot create/import boards. Account routes and sensitive account reads
  (profile writes, key management, invitations) are session-only and answer
  `403 pat_forbidden`; the profile and invitation MCP tools are removed.
  Destructive commands and lifecycle actions (board delete, member/share
  changes, another user's attachment, `workflow.update`) return
  `409 approval_required` without approval; `trustedCi` is the explicit
  exception, while `Board.agentPolicy.destructive = "deny"` returns
  `403 destructive_denied` even for trusted CI. Any PAT sending `RESTORE_*`
  gets `scope_denied`; browser undo is unchanged. The account API-key panel
  exposes the preset and trusted-CI choice and shows the effective scope; the
  MCP README/skill document the smaller 74-tool set and the new scope gate, and
  an old `JANOSIK_MCP_TOOLSETS=…,invitations,…` value is accepted as a no-op
  with a warning. The
  full approval lifecycle remains 166.5; this stream returns the documented
  error and leaves the seam clean. Docs EN/RU and the MCP error guidance cover
  the new scopes and codes.
- TASK-166.3 pause / kill switch: a human can pause one agent session
  (`POST /boards/:id/agent-sessions/:sessionId/pause|resume`), a whole board
  (`POST /boards/:id/agents/pause|resume`), one token
  (`POST /users/me/tokens/:id/pause|resume`) or every live token
  (`POST /agents/pause-all|resume-all`). All routes are browser-session only:
  a PAT gets `pat_forbidden`. Paused PAT writes answer `403 agent_paused` with
  `pauseScope` (token → board → session precedence) and `retryable: false`;
  GET reads, heartbeat, end-session and session reads stay open. Pause is
  checked at the request boundary and again under the board lock, so a request
  that passed the second check commits while a later one is refused. Pause
  does not release claims. PAT SSE announces the pause on the next keep-alive
  and closes (session pause only with `?session=`); reconnect gets
  `agent_paused`, human streams stay open. Pause is evaluated before role,
  scope and destructive/approval gates; the in-transaction recheck also rejects
  a token revoked/expired (or a disabled owner) and a session that ended before
  the board lock. Revoking a token now cancels its sessions, releases claims
  held by `claimedByTokenId` under the board lock and closes its SSE on the next
  tick; password change/reset and OAuth takeover use the same shared revocation
  helper. Board pause state is exposed in the aggregate but never exported or
  published through a public share; token/board/session pause writes are audited
  (SecurityAuditLog for token and stop-all, Activity for board and session).
  Docs EN/RU and the MCP guidance describe the pause scope; no pause/resume MCP
  tools are exposed.
- TASK-166.6 limits and data safety: server mode no longer has a 10-board
  product limit (`MAX_BOARDS_PER_USER` defaults to `0` = unlimited; a positive
  value is an operator cap checked atomically on create/import with
  `409 limit_exceeded`, while local/offline mode keeps its localStorage
  10-board guard). Board import and export share a 25 MB envelope
  (`MAX_IMPORT_BYTES`/`MAX_BOARD_EXPORT_BYTES`), command/plan bodies have a
  separate 10 MB cap (`MAX_COMMAND_BODY_BYTES`), and an oversized export is an
  explicit `413 payload_too_large`, never a truncation. Export schema version
  is now **3** (adds optional `Board.agentPolicy`); v1/v2 files still import
  with no policy, old clients reject v3. Board export is serialized once and
  streamed; a `pg_column_size` preflight rejects an obviously oversized board
  before loading the aggregate; import consumes the parsed body without a
  stringify→parse round trip. A fresh export replaces the previous ready
  artifact only after the new build succeeds; queued oversized bundles settle
  as `failed` without retrying, and a `pg_column_size` preflight rejects
  obviously oversized boards before loading the aggregate. Empty-board cleanup
  after account deletion is retried by `sweep-orphan-boards`. Residual risk:
  the board aggregate is still assembled in memory before the exact 25 MB size
  check (documented in the ADR). Board deletion and token
  create/revoke now write `SecurityAuditLog` with token/session attribution.
  The admin retention endpoint reports an honest backup status
  (`{mode, automatic: false, lastBackupAt: null, verified: false}`) and the
  UI no longer advertises automatic server backups; retention keeps the
  30/90/365 presets (default 30), while `AdminAuditLog` and `SecurityAuditLog`
  keep the longer 365-day window. Self-service
  `POST/GET /users/me/export` builds a sequential, 50 MB-bounded JSON bundle
  (one pending export per account, no full VIEWER-board envelopes), and
  `DELETE /users/me` disables the account immediately, revokes sessions and
  tokens, and schedules permanent erasure after seven days from the latest
  request; password accounts prove the password, OAuth-only accounts use a
  fresh OAuth token plus a one-time email code (`/auth/me` exposes
  `hasPassword`/`deletionMethod`). `POST /boards/import?dryRun=1` previews
  counts without writing. Both export and delete flows are browser-JWT only.
- TASK-166.5 approval and handoff API: a PAT can request a human decision on
  one exact command/lifecycle plan (`POST /boards/:id/approvals`), with a
  server-computed canonical `planHash`, policy-clamped TTL (5-minute floor),
  summary/risk and idempotency by token + hash. Destructive commands, batches
  and lifecycle REST calls without `X-Approval-Id` now create that request and
  answer `409 approval_required` with `approvalId`, `planHash` and `expiresAt`
  instead of the previous stateless refusal; nothing is applied. A
  session-only board ADMIN decides (`approve`/`reject`, repeated approve is
  idempotent) or cancels; expiry is transitioned lazily. Applying the same
  plan with `X-Approval-Id` consumes it once in the same board transaction as
  the commands, creates an `AgentRun` and stamps `runId`; the same applied
  commands stay an idempotent replay, while mismatch/ownership/session/reuse
  failures return the documented `approval_*` codes. Adds approval
  `Activity`/SSE/audit rows, `ApprovalRequestDto`/`ApprovalSseEvent` in shared,
  and MCP tools `request_approval`, `list_approvals`, `get_approval`,
  `wait_for_decision`, `cancel_approval` (decision stays session-only).
  Docs EN/RU cover the API, MCP workflow and error codes.
- TASK-166.7 run grouping and rollback foundation: a PAT batch now creates one
  board-scoped `AgentRun` (`kind: "batch"`), a single destructive PAT command
  creates `kind: "single"`, and the internal plan/apply seam is ready for
  TASK-166.8. Browser batches and ordinary non-destructive single commands stay
  outside the run log (D16). `clientRunId` is a board-scoped idempotency key;
  every command carries `runId` plus the existing token/session/name
  attribution. Every run command stores a `CommandPreimage` with the affected
  entities' before-state, before/after versions, and the compensating action;
  destructive deletes include nested cards/checklists/labels. Adds
  `GET /boards/:id/runs` (filters + cursor paging),
  `GET /boards/:id/runs/:runId` (pre-images only for a board ADMIN browser
  session), `POST …/revert/preview` (dry-run conflicts, ADMIN diff) and
  `POST …/revert` (browser-JWT board ADMIN only; PAT gets `pat_forbidden`).
  Revert is conflict-checked, all-or-nothing and one-time; it creates a
  `kind: "revert"` run with `revertsRunId`, marks the original
  `reverted`/`revertedAt`, writes Activity + `run.reverted` SSE + audit, and
  leaves the ordinary browser undo path untouched. Shared adds
  `AgentRunDto`/`RunSummaryDto`/`RunDetailDto`/`RevertConflictDto`/
  `RevertPreviewDto`, run fields on command DTOs and `RunSseEvent`. MCP exposes
  only `janosik_list_runs`, `janosik_get_run` and
  `janosik_preview_run_revert` — no apply tool (D17); the tool count is now 82.
- TASK-166.7 hardening: run revert revalidates the version/deletedAt conflict
  set again inside the board advisory-lock transaction, after the pre-flight
  check and before any inverse command, closing the TOCTOU window. Retention
  now follows ADR §6.14: `sweep-commands` deletes stale `CommandPreimage` rows
  before their commands, the new `sweep-runs` job removes only empty runs
  older than the window (a `reverted` original goes together with its
  `kind:"revert"` child), and board/account purge paths delete preimages →
  commands → runs in that order. Command, batch and real-revert responses also
  expose `X-Run-Id` (only when a run exists) so the structured request log can
  attribute an operation to its run.
- Admin console redesign: the 26 flat master-panel links are grouped into
  eight hubs (Overview, Users, Boards, Moderation, Audit & activity,
  Communications, Access & security, Settings). Every capability survives as a
  tab, old URLs redirect with their query string, and the sidebar becomes a
  232 px console / 64 px tablet rail / 280 px phone sheet. The panel adds
  breadcrumbs, a persisted Comfortable/Compact density toggle, a command
  palette with navigation/actions/recent pages, keyboard-reachable table rows,
  25/50/100 page sizes, labelled mobile table cards and explicit empty, error
  and 403 states. Owner/OPERATOR visibility and every existing `data-testid`
  contract are preserved; the server remains the authorization source.
- Centered master sign-in, aligned with the regular user sign-in screen: the
  same brand mark, typography, card and “Back to site” position, with
  show/hide password, Caps Lock warning, progressive TOTP with a 30-second
  indicator, and explicit invalid/locked/disabled/IP/offline errors. The old
  brand rail, SSO note, rate-limit note and admin-CLI hint are gone.
- Admin design-token layer (`ui/src/admin/admin.css`): dense row/control
  heights, sidebar widths, mobile table cards, reduced-motion support and the
  centered login layout.
- Concentric-square auth background (pure SVG/CSS, no raster assets): the
  sign-in, registration, password-recovery and master-login screens share the
  same slowly breathing pattern, with a reduced-motion fallback.
- “Concentric” board background: a new option in Account → Preferences and the
  board-background picker, using the same nested-square SVG pattern and a slow
  breathing animation.
- Admin documentation EN/RU for the new IA, redirects, responsive behaviour,
  density, command palette, shortcuts and the compatibility contract
  (`site/src/content/docs/*/docs/admin/redesign.md`).
- Admin-configurable card workflow: a board ADMIN can allow only specific
  column transitions (a matrix), restrict them to ADMIN/MEMBER, require an
  assignee, a due date, a description or completed checklists, add global
  transitions, and mark initial/done columns. Forbidden targets stay visible but
  disabled in drag & drop, the card menu, the card dialog and the table; a
  blocked move answers `409 conflict: "workflow"` with a machine code and the
  allowed targets, and the optimistic card rolls back. The master panel can edit
  the same workflow on behalf of the owner with an audit entry. Unarchive and
  delete-undo enforce the same transition from the card's original column, an
  enabled config without an active transition is rejected, and an unreadable
  stored config fails closed. Saving from board settings waits for the server
  acknowledgement and an open editor warns about a foreign change. Export/import
  remaps the rules, MCP gets `janosik_get_workflow`, and boards without a
  workflow keep the old unrestricted behaviour.
- Bilingual announcements: one logical announcement with EN/RU translations,
  a strict `require_all` publishing policy (default), an explicit
  `allow_fallback` mode with a localized "available only in …" notice, a
  per-language admin editor with banner/email preview, and localized email
  resolved from the recipient's new account-wide `User.locale`. Legacy
  announcements keep working with their original text and an unknown language.
  Admin edits use a per-announcement `version` (stale PATCH → 409), the editor
  sends dirty locales only, and email fan-out runs in the background after an
  atomic queue claim so an admin request never waits for SMTP.
- A shared skeleton UI system: one `Skeleton`/`SkeletonRegion` primitive on
  brand tokens (dark and light), with a 180 ms reveal delay, `aria-busy` and
  reduced-motion support. Content skeletons now cover the first board paint,
  lazy calendar/table/watch views, card comments/history/attachments and
  description, admin entity tables, dashboard, details and settings, public
  boards and cards, notifications, sharing, members, API keys and admin search.
- Column accents: give any column a card-cover color or gradient and choose
  one of nine board-wide shapes (top rail, left rail, wash, title, glow,
  glass, header band, dot, signature). The accent is a normal undoable
  command, survives reloads and imports, and appears in other participants'
  boards live.

### Changed

- The per-column card cap is now 1000 active cards (was 200), decided after
  the 2026-11-10 load test: a 5×1000 board renders in ~0.63 s with 50 cards in
  the DOM and 76 MB of JS heap, and the API reads its 3.37 MB payload in
  ~128 ms. A 10k-card board on five columns needs 2000/column and is heavier on
  writes and memory, so it was not chosen; archived cards do not count. See
  [`docs/PERF-CAPACITY.md`](docs/PERF-CAPACITY.md).
- The admin omnibox is now a command palette: `Ctrl/Cmd+K` still opens it and
  entity result test ids are unchanged, but it also offers the eight hubs,
  theme/density actions, recent pages and shortcut help. `?` opens a shortcut
  sheet; `g` followed by `d/u/b/m/a/c/s/,` jumps to a hub.
- Admin table selection now announces "Select all rows on this page" instead
  of a delete label, and a failed owner-only request renders a dedicated
  "Owner rights required" state rather than a generic list error.
- The board content editor's back link returns to the board detail instead of
  the dashboard, the page has normal padding, and its refresh control is
  labelled Refresh rather than Retry.
- Top-of-page notifications now share one frosted "quiet glass" stack under
  the header: announcements, impersonation, data-safety and update prompts no
  longer cover the board or each other, and toasts follow the same visual
  language in their bottom-right corner.

### Fixed

- Admin tables keep the last successful page while a search or pagination
  request is in flight instead of clearing the header and rows.
- Card comments/history/attachments and the watch feed no longer show a false
  empty state before the first page arrives; the board switcher shows pending
  rows during background hydration.
- Saving an announcement now closes the editor before the list refresh, so the
  confirmation toast is not hidden behind the modal's `aria-hidden` subtree.
- The column accent palette closes on the first outside click after a color or
  gradient is picked; it used to swallow that click and close only on the next
  one.
- Comment kinds use a themed picker instead of the browser-native `<select>`
  popup, so the option list follows the dialog in dark and light mode. The
  same `kind` field is already accepted by the REST API and MCP tools for
  API-key clients; a personal-token E2E test now locks that in.
- The announcement editor uses themed select menus and the app calendar/time
  picker for scheduling, so the option sheet and date popup follow the dark
  theme and the UI language. The preview now mirrors the selected level tone
  and the fallback policy.
- The board workflow editor uses the same themed select menus for global
  targets, the initial column and the card preview, and the board-settings
  gear is the animated settings icon already used by the app.
- The tablet sidebar (640–959 px) now keeps all eight hubs as a real icon
  rail: the links stay visible with tooltips and an accessible name. The
  previous rule hid the whole link, leaving an empty 64 px column.
- Narrow desktop windows down to 640 px keep the icon rail instead of
  switching to the phone sheet; the 280 px sheet and labelled table cards now
  start at the same 639 px breakpoint.
- The server now stamps the route board id on every command action it stores
  and broadcasts, so SSE and delta events reach the open board in the UI even
  when a REST caller omits `boardId` from the action.
- The PWA "new version" banner now reloads the tab only after the fresh
  service worker takes control. The old flow called `window.location.reload()`
  immediately after `SKIP_WAITING`; activating the new worker terminates the
  old one and could abort that navigation, leaving the tab on the old build
  with the banner still up. A bounded fallback covers an already-active
  worker, which emits no `controllerchange`.

## [0.2.0] - 2026-11-08

### Added

- Secure password recovery through a single-use e-mail code; a reset revokes
  other sessions and all API keys.
- Public share links can expose comments and attachments, freeze them in a
  snapshot, and embed the board with a system, light or dark theme. Revoked
  links can be deleted while the audit trail is retained.
- Admin security events and per-master IP allowlist management.

### Changed

- Redesigned the card details dialog: inline title and labels, an actions
  menu, a two-column content/properties layout, a collapsed link editor,
  wrapped long titles and more compact comments and checklists.
- Expanded the Chrome end-to-end suite across authentication, boards, cards,
  views, filters, search, history, two-account collaboration and the account
  and API-key flows.

### Fixed

- Deleting the open card no longer shows a false `Card not found` toast or
  leaves a stale `?card=` parameter.
- The card link editor keeps focus and the first click, closes on Escape and
  stays open while a relation type is chosen.
- Undo no longer overwrites another member's board rename, and a live role
  change refreshes the caller's permissions without a reload.
- Description attachments are removed with the description text and remain
  reversible through undo.
- The account panel now shows an uploaded avatar in its identity band, resets
  the email-change dialog after closing, and describes a password change as
  revoking API keys, which the server already did. Confirming an email change
  also revokes the old caller refresh token.

## [0.1.1] - 2026-11-04

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

[Unreleased]: https://github.com/VitalyTolstik/janosik/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/VitalyTolstik/janosik/releases/tag/v0.2.0
[0.1.1]: https://github.com/VitalyTolstik/janosik/releases/tag/v0.1.1
[0.1.0]: https://github.com/VitalyTolstik/janosik/releases/tag/v0.1.0
