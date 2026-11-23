# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- TASK-200.13 pre-serialized SSE frames and bounded slow subscribers. The
  member event stream no longer goes through Nest's `@Sse` writer: each
  published event is serialized once into one complete `id:`/`data:` frame
  (`SseFrameStore`, identity-keyed `WeakMap`) and the same `Buffer` is written
  to every subscriber. Live command wire objects are memoized by the bus event,
  so N listeners share one `JSON.stringify`; catch-up, `?since=`, event order,
  `resync`, presence and keep-alive frames keep their existing contract. A
  subscriber whose socket stops draining queues shared buffers against a soft
  `SSE_MAX_BUFFER_BYTES` (128 KiB) bound; the frame already accepted by the
  socket is not counted, so the real worst case is the bound plus that frame
  (and `0` means “no queue”). A synchronous batch burst may exceed the soft
  bound for `SSE_BURST_GRACE_MS` (5 s) up to a 16 MiB referenced-byte hard
  guard while `drain` is pending, so a legitimate 10–100 × 64 KiB batch
  (~6.4 MiB) survives and drains; frames are shared Buffers, so the queue
  holds references, not per-subscriber copies. A real slow reader is
  disconnected by the grace, the hard guard or `SSE_SLOW_CLOSE_MS` (60 s) and
  resumes from its last applied `?since=`. `RealtimeService.slowSubscriberDrops` is exposed
  in `/admin/observability` (`jobs.realtime.slowDrops`) and its warning is
  aggregated to one line per minute. The 200 response is committed only after
  synchronous stream setup, so a `client_id_taken` race still answers `409`
  rather than an empty 200 SSE stream. SSE `id:` values are process frame ids,
  not per-connection cursors (`?since=` is the resume point). The 200.5
  keep-alive jitter/overlap guard is unchanged. `SSE_MAX_BUFFER_BYTES` and
  `SSE_SLOW_CLOSE_MS` are forwarded by `docker-compose.yml`. Focused unit/e2e
  coverage includes one build across 64 subscribers, byte-identical fan-out,
  a batch burst inside the grace, the emergency/grace bounds, reconnect
  catch-up and keep-alive timing. The 3 000-connection CPU/p95 targets were
  **not** measured in this task, and the public share stream still uses Nest
  `@Sse` (separate projection surface, documented in the runbooks).

- TASK-200.2 server-side ready/work discovery. `GET /boards/:id/ready` returns a
  bounded summary of the cards ready to pick up on one board — the initial/work
  column, unassigned, without a live claim and not blocked — with
  `id/title`, board and column ids/titles, `priority`, claim state/lease,
  card `version` and `descriptionChars` (the stored `Card.descriptionLength`
  kept in sync by a database trigger; Unicode code points, one per emoji).
  The migration adds the column with a constant default (metadata-only on
  PostgreSQL 11+) and performs one backfill scan of `Card`, then the trigger
  maintains it. The description text is never selected,
  so large text is not detoasted, and the endpoint never loads a board
  aggregate. `?wait=` holds the request
  for 0–60 s and wakes only on readiness-relevant actions (card presence,
  move, priority, assignee, claim, link, column/workflow change) or a resync,
  not on every `board:` touch. A relevant wake that leaves no work keeps
  holding; co-waiters share one post-wake snapshot, and a held answer or timed
  `204` carries `X-Ready-Held: 1` plus `X-Board-Seq`/`Cache-Control: no-store`
  where applicable. `?since=` is the
  previous board `seq` and answers immediately when the board changed before
  the hold. A client disconnect aborts the hold and releases its subscription
  and admitted poll slot; held polls are capped per user/board (`503
  ready_poll_capacity` with `Retry-After`), and only a held `200`/`204` is
  excluded from API latency.
  A board deleted during the hold answers `404`. `GET /boards/ready?limit=`
  returns the same cards across every accessible board (archived boards are
  listed empty; a board-scoped PAT sees its board) using constant-size SQL
  with no per-board fan-out and is not misparsed as board id `ready`.
  VIEWERs may read both. MCP `janosik_list_ready_cards` and
  `janosik_wait_for_work` use the endpoints; a single-board wait long-polls
  25–60 s with jitter independently of `pollMs`, a cross-board wait uses the
  full 15–60 s jittered range, `timeoutMs: 0` still snapshots once, and
  transient network/capacity failures retry only inside the deadline. An older
  server that answers
  `404` keeps the legacy full-board fallback, so the tool contract
  (`timeoutMs`, `pollMs`, `boardId`, `{ card }`/`{ card: null }`) is unchanged.
  Shared types, OpenAPI, EN/RU API and MCP docs, the MCP README, the TASK-200
  status note and focused unit/e2e coverage are included. The 500-agent p95
  target was **not** measured; no heavy load was run for this task.

- TASK-200.5 bounded hot-path caches and quiet agent SSE. PAT resolution
  (`AUTH_CACHE_TTL_MS`, default 15 s, keyed by sha256), board membership
  (`MEMBERSHIP_CACHE_TTL_MS`, default 30 s) and feature-flag rows
  (`FEATURE_FLAG_CACHE_MS`, default 30 s) are served from one process-wide,
  LRU-bounded cache (5000 PAT / 10000 membership / 64 flag entries). All
  writes and SSE connects bypass the PAT/membership cache, `expiresAt` is
  re-checked on every read, and a PAT that would expire inside the window is
  not cached, so a resolution cannot outlive the token. Revoke, token
  edit/pause/resume/pause-all,
  role or membership changes, board pause/resume/delete, owner transfer and flag
  updates invalidate synchronously on the writer (account deletion only after
  its transaction commits) and are propagated best-effort to other
  replicas through a versioned `janosik:cache-invalidate` control channel on the
  existing realtime bus (Redis required for prompt cross-replica invalidation;
  otherwise the 10–30 s TTL is the bound). Membership events double as
  invalidation, so boards, invitations, admin membership edits and profile
  updates need no cache plumbing. Cold cache loads are single-flighted per key
  and guarded by an epoch, so 500 simultaneous misses issue one query and a
  revoke that races the query cannot write the older answer back. Agent (PAT)
  SSE streams default to
  `presence=0` (browsers keep presence; `?presence=1` opts an agent back
  in), PAT keep-alive is 60 s while human streams stay at 25 s, both carry
  jitter, a slow tick is skipped (and aggregated into one log line per minute)
  instead of stacking, one scheduler
  owns each stream and module shutdown stops every timer. The SSE keep-alive
  reuses a 30 s membership/board snapshot while token active/pause, JWT
  credential stamp/disable state, expiry/family and log-head checks stay fresh.
  `.env.example`, EN/RU REST and self-hosting docs, TASK-200 evidence,
  unit/e2e coverage and the CHANGELOG are updated.

- TASK-200.3 swarm-sized agent budgets and rate-limit recovery. The per-board
  bucket is now a safety ceiling (`BOARD_RATE_LIMIT`, default
  `max(12000, 2 × THROTTLE_LIMIT)`) with continuous refill, backed by a
  per-token agent bucket (`AGENT_TOKEN_RATE_LIMIT`, default
  `max(600, ceil(THROTTLE_LIMIT / 4))` for keys without their own explicit
  limit; an explicit key limit is capped at that derived share) and a raised
  per-session floor (600 weighted units), so one abusive key or runaway
  session cannot starve a board. A batch is charged by `commands.length` on the
  board, token **and session** budgets. A non-batch shape or unknown action
  type costs one unit; a known type with missing required fields still costs
  its command count and is rejected before any work is applied.
  Pinned budgets are 0 (auto) or at least 100, so a valid 100-command batch can
  fit. **Upgrade note:** existing `AGENT_SESSION_RATE_LIMIT`,
  `AGENT_TOKEN_RATE_LIMIT` or `BOARD_RATE_LIMIT` values from 1 to 99 now fail
  startup; use 0 (auto) or at least 100. A per-key `rateLimitPerMinute` of
  1–99 remains valid but cannot submit a 100-command batch, since a batch
  spends its command count against the token budget. Command writes over the
  board ceiling wait in a per-board FIFO (64 queued requests/batches / 32 MiB of serialized
  parsed JSON, approximate for object overhead / bounded promise chain, max
  30 000 ms) and then answer `503 rate_limited` with
  `Retry-After` and `X-RateLimit-Queued-Ms` (`0` when the queue cap rejects
  immediately) instead of an instant `429`; reads keep the immediate `429`.
  The MCP client retries `429` and the queued `503` up to four attempts,
  honouring `Retry-After` (never earlier than requested below 8 s; at or above
  8 s it uses 7.4 s + up to 600 ms jitter) with bounded backoff and reusing the
  same `Idempotency-Key`/`commandId`; an exhausted retry still returns the
  actionable error instead of hanging. Docs EN/RU, OpenAPI, self-hosting env
  reference, MCP README, `.env.example` and focused unit/e2e coverage are
  updated.

- TASK-177.20.3a/3b assignment notifications and due-mail links. A committed
  `SET_CARD_ASSIGN` now produces a deduplicated `card.assigned` attention row
  for the new assignee, but only when the board/card are live and not archived,
  the recipient is an active non-disabled member, and the assignee is not the
  actor. Assignments are coalesced per recipient per command batch; the last
  assignment per card wins, a trailing unassign or a no-op notifies nobody, and
  replays never fan out again. The dedup key is
  `card.assigned:<minSeq>-<maxSeq>:<recipientId>` (one row per recipient). A
  single card opens its dialog; a batch opens the board filtered with
  `f.assignee=<assigneeId>`. The EN/RU `attention_card_assigned` letter
  respects `notifyAttention` while the inbox row is always written; scheduled
  digests, governed by `notifyDigest`, label the category as assignment
  updates. The bounded inbox/letter body names the actor and a few card titles
  plus “and N more”. Due reminder letters now link each listed card absolutely
  through `PUBLIC_ORIGIN` and `UI_BASE` (escaped, capped with “and N more”,
  with plain URLs in the text alternative) while keeping `ReminderSent`
  dedupe, opt-out and UTC labels; no in-app due rows were added. API EN/RU
  docs, user guide, admin template docs, OpenAPI enum and CHANGELOG are
  updated.

- TASK-177.19 bulk card actions (U-08). Board and table views gain a
  selection mode with checkboxes, Shift ranges across columns, `X` on the
  keyboard cursor and `Ctrl/⌘+A` for all visible cards, capped at 100. The
  bottom bar moves, labels, assigns, archives and deletes selected cards with
  a count, progress, cancellation and a scrollable per-card error summary.
  Archive and delete confirm first. Table ranges and select-all follow the
  visible sort order; each run is capped at 100 cards. Every card still travels
  through the normal command path, so workflow, definition-of-done conditions,
  WIP limits, column caps and the per-card label cap are enforced and undo
  stays one step per card. A running batch and its result stay visible after
  switching to Calendar or Watch until dismissed, and cancelling keeps failed
  and never-processed cards selected. The toast stack is lifted above the
  visible result bar, so Dismiss and the failure list stay reachable. VIEWERs
  and archived boards keep the read-only surface. EN/RU copy, the user guide,
  component tests and focused e2e coverage are included.

- TASK-177.12 comment mentions (U-01). Typing `@` at a word boundary opens an
  accessible board-member picker (arrow/Home/End/Tab/Enter/Escape, portalled
  and flipped so the dialog never clips it); selecting a member inserts an
  explicit `[@Name](https://janosik.invalid/mention/<userId>)` markdown link.
  The backend validates every id against the active roster and rejects
  non-members. Mentions are inert in top-level/blockquote fenced code and
  inline code, as are escaped tokens and larger URLs; HTML comments are not
  rendered. List-contained fences and indented text are ordinary text, so
  explicit mention links there stay live while a hand-typed `@Name` never
  notifies. The closing fence follows the same 0–3-space indentation rule as
  the opening fence. Each
  mentioned member gets one deduplicated `comment.mention` attention row with
  actor, card, board, excerpt and a card/comment deep link; the author is
  skipped, `notifyAttention` still controls e-mail, and the immediate letter
  deliberately omits the comment text. Removing a mention on edit withdraws
  its row and queued mail; comment/board/admin/account cleanup targets the new
  exact `AttentionNotification.commentId`, and GDPR erase covers rows owned by
  other recipients. EN/RU copy, API/OpenAPI docs, user guide, touch targets,
  axe coverage and focused parser/backend/UI tests are included.

- TASK-177.9 detached attachment restore (G-13). Files under `Removed from
  descriptions` now offer `Restore to description`, `Download` and `Copy
  attachment reference`. Restore appends the existing attachment-link markdown
  at the end of the description and saves through `UPDATE_CARD`, so the server
  reconciles `descriptionDetached`, the file returns to the normal list and its
  image or file renders after a reload; the UI waits for the save before moving
  the row, keeps an in-progress description draft, re-reads the latest
  same-card description after the bin re-check, aborts if the card changes
  during the request and refuses an unresolved conflict or the description size
  limit with clear copy. The reference is an authenticated in-app URL meant to
  be pasted into a description or comment, not a public share link.
  Download/copy work for every board member, including VIEWERs, and restoring
  at the 20-file cap is allowed because the hidden file already counts. A file
  deleted in another tab is re-checked against the detached bin and cannot be
  restored. The bin shows type/size/date, keeps a readable two-line filename
  with 44 px mobile actions and moves focus only when the acted-on row loses it.
  EN/RU copy and the cards user guide are updated.

- TASK-185.5/185.6 comment history in the admin panel and closeout. Every
  admin comment row (card detail, user detail and the comments entity table)
  now carries `revisionCount` and `historyIncomplete`; a live row opens the
  read-only revision dialog, while a deleted row or parent returns `null` in
  both fields and hides the link. The acceptance pass added the
  `sweep-comment-history` maintenance job: it finds an old writer even when no
  PATCH follows, persists `writer_gap`, adopts the current text as the new
  verified point, strips Activity snapshots that no revision backs and lets
  the next edit continue under a fresh number. It also verified both GDPR
  export paths (sync and background) exclude revision snapshots and another
  author's edits, exposed revision count/bytes, related Activity bytes,
  derived revisions beyond the 50-revision window, incomplete histories and
  over-budget comments in the observability snapshot
  (counts only, never text), and covered delete/restore feeds, the 50-revision
  window on both APIs, public-share SSE allowlists, command catch-up/resync,
  the 390 px card History view, the live SSE refresh and EN/RU dialog
  coverage.

- TASK-185.4 card comment history. An edited comment’s `edited` marker is now
  a keyboard-accessible button that opens its read-only revision list:
  localized revision number and time, the current editor name (or “Editor
  unavailable”), the change cause, an escaped character-level before/after
  diff, and a full-text snapshot toggle for the revision. The list uses the
  TASK-185.3 cursor API at 20 revisions per page with loading, retry, empty
  and end states. A banner follows `historyIncompleteReason`: the cutover copy
  names the pinned release that introduced edit history, the other reasons
  stay neutral. Open
  history marks itself stale on a new edit, closes and clears on deletion,
  rechecks access on focus/reconnect, and returns focus to the trigger. EN/RU
  copy and the 390/768 px layouts are covered; the admin history dialog remains
  in 185.5.

- TASK-177.4 human-owned agent state (G-03). A board ADMIN or MEMBER can now
  add, edit and clear a card's `Acceptance criteria` / `Definition of done` in
  the card dialog; VIEWERs keep the read-only view. The command goes through
  `BoardContext` as `SET_CARD_TASK_SPEC`, so every change lands in Activity with
  the human's attribution, and the MCP DoD gate reads the saved contract on the
  next move. Cards with a lease show `Claimed by … until …`; the claim owner
  and board ADMINs can release it with confirmation, which writes Activity and
  frees the card without ending the agent session. Escape keeps an open
  task-spec draft and the card dialog open, long unbroken values wrap, and
  claim releases stay out of the undo stack so undo can never re-claim the
  card for the wrong identity. EN/RU copy, 44 px touch
  targets, keyboard focus/Escape handling, component tests and backend/MCP
  coverage are included.

- TASK-177.7 truthful deletes, per-board export and Recently deleted.
  `Export this board` downloads one board through `GET /boards/:id/export`,
  stays disabled without an open board and explains the 25 MB `413` while the
  all-boards file keeps its separate copy. Delete prompts for cards, archived
  cards, columns, comments, attachments and archived boards no longer imply an
  immediate permanent removal: they say an administrator can restore the item
  during the retention period. A new `Recently deleted` view lists soft-deleted
  cards, columns, comments and card files for board ADMIN/MEMBER and restores
  them through the command log (cards/columns) or in place (comments/files)
  inside the same retention window; restore writes `comment_restored` /
  `attachment_restored` Activity and SSE. Admin restore is unchanged and true
  purge remains a maintenance job. EN/RU UI copy, the boards/cards/account
  user-guide pages, REST/OpenAPI docs, client/component tests and board-scoped
  API tests are included.

- TASK-185.1 comment history foundation. Every real text edit now writes one
  immutable `CommentRevision` under the board-write lock, together with one
  `comment_updated` Activity carrying the before/after text; `editedAt` and the
  verified pair move with the same timestamp and only a text change moves them.
  Existing comments are fenced at one migration timestamp, keep their last
  `editedAt` as a verified point and are marked `legacy_cutover`; no history is
  reconstructed. The writer keeps the newest 50 revisions, reconciles an old
  writer before a no-op PATCH and rejects it with `409 comment_history_gap`
  after persisting `writer_gap`. Attachment deletion scrubs comments through
  the same writer with `attachment_deleted` attribution and aborts on a gap.
  Hard purge, demo cleanup and GDPR erase explicitly remove revisions and their
  Activity snapshots before comments/users; exports still exclude them. The
  read API and UI remain in later 185.x subtasks. See
  [the foundation notes](docs/TASK-185.1-comment-history-foundation.md).

- TASK-185.1 hardening. An attachment-delete gap now releases its claimed
  destructive approval instead of burning it; a plain repeated attachment
  delete is an idempotent no-op, while an approved retry whose row vanished
  releases the claim and still answers `404`. Under one global erase key, GDPR
  erase collects the board union and takes the sorted board-lock set, re-reads
  the verified chain, and replays on a late board before merging `gdpr_erase`
  atomically. Every purge pass re-checks the soft-deleted flag in its delete
  predicate,
  attachments remove only blobs of rows that actually went, and the board
  subtree is purged one board at a time in its board-locked transaction so a
  restore wins. Activity `commentId`/`revisionId` lookups have expression
  indexes. The 409 names operator reconciliation until the automated sweep
  lands in 185.2/185.6.

- TASK-177.11 comment kind edit and filter. An author can now retype a
  comment's structured kind (note, status, question, blocker, evidence,
  handoff) in the same inline editor as the text; the change writes
  `comment_updated` history (TASK-185.1 later made `editedAt` text-only), and
  blocker/handoff attention already sent for that comment is not duplicated.
  The comments thread also gains
  `All`/kind filter chips backed by the server's `?kind=` query, with EN/RU
  copy, accessible pressed state, 44 px touch targets and cursor paging kept
  inside the selected kind. The PATCH body and the API docs accept `text`
  and/or `kind`, and an empty body is still a `400`.

- TASK-177.8 small UX batch: pending invitations can be re-roled and given a
  viewer expiry from the members dialog, with past deadlines refused and
  expired invitations flagged; share revocation asks for confirmation and
  names the link and mode; the board switcher labels its active-card count;
  comment and card-link actions stay visible at 44 px on touch; and the
  all-boards export toast names the workspace and its board count. EN/RU copy,
  component tests and mobile browser coverage are included.

- TASK-177.16 first-run and board metadata. A new account now names its first
  board instead of silently receiving `New board`, and can choose an empty
  board or an example with `To do` / `In progress` / `Done`, a welcome card and
  a checklist (EN/RU, recorded as commands). The header title has a visible
  pencil button for renaming, while clicking the title still works. The user
  guide and the `POST /boards` contract document the template.

- TASK-177.6 attention inbox deep links and notification preference path.
  Every attention row now opens its real target: a blocked, hand-off or expired
  claim row follows the card deep link, an approval opens the board approvals
  tab for a board admin (focused on the request when its id is known) while
  other recipients land on the board, a board limit opens the board, an
  account-level limit opens the account panel, and a revoked token opens
  **Account → API keys**. Links are real anchors, so keyboard, middle
  click and Cmd/Ctrl-click work, and the bell closes on activation. Rows with
  no safe target stay plain text; opening a row never marks it read. The profile
  **Attention emails** switch now loads from the session, saves through
  `PATCH /users/me/notification-settings`, and reverts with an error toast when
  the server refuses it. EN/RU copy, component tests and an attention-inbox
  Playwright case cover the flow; the backend opt-out e-mail suppression was
  already covered by the existing attention E2E.

- TASK-177.13 search in comments and attachment file names. Board search
  (`GET /boards/:id/search`) now also matches visible attachment names and
  returns a `matches` list (`title`, `description`, `checklist`, `comment`,
  `attachment`, with short snippets and comment/attachment ids) while keeping
  `cardIds` complete for MCP callers. The match list is deduped per card/kind
  and capped at 200; `includeMatches=0` returns ids only, which is what the
  board filter requests. The global palette asks one bounded
  `GET /boards/search` for comment/file hits across active memberships
  instead of searching every board. Hits are grouped per card before the cap,
  merged newest-first across comments and files, and expose `total`/
  `truncated` so the palette never implies a complete list when it is not.
  Hidden inline and `descriptionDetached` uploads are excluded. The palette
  merges hits with the local title/description/label/checklist matches, keeps
  the `20 of N`/Show all caps per group and labels each row `Card`, `Board`,
  `Comment` or `Attachment`.
  A comment/file hit opens the card and carries `?comment=`/`?attachment=`;
  the dialog scrolls to and highlights the row, and an unknown id falls back
  to the card alone. The board filter debounces the same server search and
  keeps comment/attachment-only matches visible under the other facets; local
  and offline filtering is unchanged. EN/RU copy, board-search e2e coverage
  and palette/filter unit tests are included.

- TASK-182.1 admin label help and keyed label toast. The Labels heading now has
  an accessible `About labels` popover explaining that labels save immediately,
  click attaches/detaches them, and every change reaches the board history. A
  label success toast is keyed per card, so rapid toggles replace it instead of
  stacking; a failed command clears the old success, and a late response for
  card A cannot toast, write an error, refresh or reset busy state on card B.
  EN/RU copy, component tests and a browser check cover the flow.

- TASK-181.7 admin filter docs, rollout evidence and 25k qualification. The
  admin guide (EN/RU) now documents the Filters surface, every offered facet,
  deep-link examples, chip resolution, conflict and unknown states, board/tab
  rules, keyboard and mobile behaviour, and the surfaces that are intentionally
  not filterable. Attachment MIME filters now use an indexed `mimeFamily`
  column kept in step by a database trigger; measured indexes cover the 25k
  card, comment, attachment, card-link, label and people facets. The Cards list
  subtitle now reads `Cards across every board: N` instead of `N cards` (which
  produced `1 cards`). See
  [the acceptance record](docs/TASK-181.7-acceptance.md).

- TASK-177.1 share link editing: every non-revoked share row now has `Edit`,
  which reuses the create form to change the label, comments/attachments
  visibility and expiry while the mode and `/s/<token>` stay immutable.
  Changes go through the existing `PATCH /boards/:id/shares/:shareId`; the
  row and list refresh on success and a failed update keeps the form and its
  values open with an inline error. Changing privacy flags on a live link asks
  for confirmation first (the server audit already records `share.update`),
  and choosing `Never` clears the expiry with `expiresAt: null`. EN/RU copy, `ShareDialog` unit tests and a Playwright
  share-edit case cover the flow.

- TASK-177.2 self-leave: `DELETE /boards/:id/members/me` lets an accepted
  `MEMBER` or `VIEWER` leave a board from the Members dialog (`Leave board`,
  with an inline confirmation). An `ADMIN` may leave only while another
  accepted `ADMIN` remains; the last admin gets
  `409 { code: "last_admin", action: "leave" }` and the button explains why it
  is disabled. The route is session-only. The membership row is removed, the
  feed records `member_left`, and a `membership: left` SSE frame closes the
  leaver's stream. The board disappears from the switcher, direct board URLs
  answer `403`, and authored cards/comments keep their original attribution.
  Admin remove-other behaviour (`DELETE /boards/:id/members/:userId`) is
  unchanged. EN/RU copy and the API docs/openapi cover the route.
  Review follow-up: self-leave is idempotent (a repeated DELETE or lost
  response answers `200`), the last-admin guard ignores pending and expired
  admins, and voluntary departures publish `membership: left` so another tab
  says “You left the board” instead of “access revoked”. Activity entries and
  comments now carry the author’s joined display name/email, so a leaver
  remains named after the roster drops them. The members dialog is keyed by
  board and shows its title, Leave is available from the board switcher at
  mobile widths, focus moves into/out of the confirmation, a refused leave
  refreshes the roster, and a last-admin `409` maps to the admin message.

- TASK-177.5 truthful admin shares list: `/admin/shares` now pages over the
  server's `total/offset/limit` with the shared 25/50/100 pager and shows the
  visible window as `N of M`. The label comes from the same response as the
  rows, so it stays on the last completed page while the next request is
  pending and never pairs a new offset with the previous rows; an
  out-of-range page after rows shrink is clamped to the last real page. Each
  row has an `Expires` column with an `Expired` badge
  (suppressed for revoked links, which keep their own badge) and an accessible
  no-expiry dash. Search resets paging, a zero-result search uses the filtered
  empty state, and the list uses the shared responsive admin table/card layout
  (including the scrollable panel). The shares query orders by
  `createdAt desc, id desc` so paging is stable across ties. Component tests
  cover 101-row paging, a held page request, page-size reset, out-of-range
  clamping and revoked/expired precedence.

- TASK-183.1 adds a reproducible TASK-176 demo fixture and guarded reset,
  read-only verification and master-account commands. The reset uses a
  private backend to verify database identity before schema recreation and
  supports a transactional fallback that retains global settings. It validates
  the target, reset authorization and reset secrets from the pre-Prisma shell
  environment, so `backend/.env`, `.env.<NODE_ENV>` and `.env.local` cannot
  select a demo target or authorize a reset.
  See [the demo fixture guide](docs/DEMO-FIXTURES.md).

- TASK-176.9 B2 admin card checklists and links: `/admin/cards/:id` now shows a
  lazy `Checklists and links` panel beside the field editor on non-deleted
  cards. It is admin-native (no `BoardContext`), uses the same owner-attribution
  banner, and sends one fresh `commandId` per change: `ADD_CHECKLIST`,
  `RENAME_CHECKLIST`, `DELETE_CHECKLIST`, `ADD_CHECKLIST_ITEM`,
  `SET_CHECKLIST_ITEM_DONE`, `RENAME_CHECKLIST_ITEM`, `DELETE_CHECKLIST_ITEM`,
  `ADD_CARD_LINK` and `REMOVE_CARD_LINK`. Checklists are capped at 20 per card,
  items at 100 per checklist; unchanged values send no command, deleted
  checklists/items are filtered out, and checklist deletion asks for
  confirmation. Links show both directions with the stored type plus a readable
  phrase (`blocks` / `is blocked by`, `duplicates` / `is duplicated by`), and
  incoming removal targets the holder card. The target combobox loads
  `GET /admin/boards/:id/content`, excludes self, archived and already-linked
  pairs, enforces the holder's 50-link cap and blocks `blocks` cycles; reverse
  phrasing is available when adding. Checklist/item commands neither refetch
  board content nor clear the link draft; link commands refetch it, and
  `ADD_CARD_LINK` closes the editor after success while `REMOVE_CARD_LINK`
  leaves the draft open. Dangling/soft-deleted link rows stay readable and live
  dangling rows remain removable. Deleted cards hide the
  editor; archived cards keep editing. The backend fresh-command guard now
  covers all nine actions: live/same-board source card and checklist/item with
  exact ownership (`404`), new ids free or a soft-deleted row owned by the same
  card/checklist, live/same-board link target (`404`), self-link (`400`),
  existing pair/cycle/cap (`409`), and a live holder-owned row for removal.
  Fresh checklist/item adds at 20/100 now return `409 conflict: "wip"` before a
  command or audit row exists. Rejected fresh writes create no command or audit
  row; exact replays stay idempotent. The relation counters separate live
  outgoing rows (the holder cap) from live incoming rows; a live incoming row
  whose holder is deleted stays readable as dangling but is not counted. A
  reverse link option shows the target holder's own cap. The lazy relations chunk is part of the
  size gate: the second lazy panel split the shared admin `ui` chunk out of
  `AdminApp`, and the panel also loads the existing board `links` chunk, so the
  entry now measures `AdminApp` + both lazy panels + those shared chunks.
  **final 112.39 kB gzip against an explicit 113 kB budget**, leaving 0.61 kB
  headroom (the DTO flag and follow-ups added about 0.59 kB; B1’s historical
  baseline was 101.62 kB against 102 kB and measured only the shell + field
  panel). EN/RU admin content docs
  describe the editor and counters; the monitoring note records the audit
  correlation.

- TASK-176.9 B1 admin card fields: `/admin/cards/:id` now has a compact
  `Properties` panel for the card title, assignee, due date, priority, cover
  and labels. Each change is one fresh owner-attributed board command
  (`UPDATE_CARD`, `SET_CARD_ASSIGN`, `SET_CARD_DUE_DATE`, `SET_CARD_PRIORITY`,
  `SET_CARD_COVER`, or one `SET_CARD_LABEL` per toggled label) with its own
  `commandId`; unchanged values send nothing. Clearing an assignee sends
  `assigneeId: null`, clearing a due date or cover omits the field, and
  `medium` priority stays the default/absent value. Assignee options are
  accepted, unexpired members (disabled users hidden from new choices for UX);
  labels are the board's live labels with the 20-per-card cap. Deleted cards hide the panel,
  archived cards keep editing their fields. The admin command path rejects
  missing/deleted/wrong-board cards with `404`, deleted or foreign labels with
  `404`, and keeps the label cap at `409`; `MOVE_CARD` alone rejects archived
  cards with `409`, and exact replays stay idempotent. Checklists and links are
  intentionally left for B2. EN/RU admin content and monitoring docs describe
  the panel and the audit correlation. The field panel is lazy-loaded into its
  own chunk. The size gate now measures the combined admin card page (shell +
  field panel): **101.62 kB gzip against an explicit 102 kB budget** (the old
  shell-only gate was 100 kB); that leaves 0.38 kB headroom and makes the lazy
  chunk part of the real budget.

- TASK-176.8 + TASK-176.10 admin editing pilot and command ↔ audit
  correlation: `/admin/cards/:id` can edit the card description through an
  `UPDATE_CARD` command, and the board content editor can move a card to
  another column through `MOVE_CARD`. Both dialogs show the explicit
  owner-attribution banner; the command log and board history still name the
  board owner, while `AdminAuditLog.details` now carries `commandId`,
  `masterId` and `masterEmail` for the real master. `GET /admin/commands` rows
  and card-timeline commands expose `auditId` when correlated (historical and
  normal user commands stay `null`), adding an `Audit` link in the command log
  and card timeline only. The link filters by the **command id** (not the audit row
  id), and `GET /admin/audit` plus `GET /admin/commands` accept the same
  exact validated `commandId`; the audit query is pinned to `board.command`.
  `/admin/audit?tab=audit&commandId=<command id>` is a shareable deep link.
  The admin `UPDATE_CARD` / `MOVE_CARD` path rejects soft-deleted/missing cards
  with `404` and archived-card moves with `409`; a fresh move with a stale
  source column is `409 conflict: "version"` (`move_stale`), and a
  missing/deleted/foreign target column is `404`, both before any command or
  audit row. Archived cards repointed to the internal soft-deleted orphan
  column by `DELETE_COLUMN` keep their field editing. A replay of an existing
  `commandId` never fabricates a second master audit row. No feature flag is
  added:
  product sign-off is recorded in TASK-176.8/176.10. EN/RU admin docs record
  the new controls and links.

- TASK-179 large-screen layout: at `min-width: 1600px` the board-scoped Agent
  Control modal grows to a 1400×860 canvas at 1920 (rail 220, list 360,
  detail 818), and the global `/agents` content cap and detail rail grow from
  980/352 to 1200/400 (49 px gutters at 1920; the cap binds at ~1822). At
  exactly 1600 the fixed rails leave 978 px of content. The 1440/1024/390
  pixel-parity geometry is unchanged, and `?board=all` approval/run deep links
  now resolve the selected row's concrete board instead of calling
  `/boards/all/...`.

- TASK-176.11 admin agent boundary (docs-only): the English and Russian admin
  guides and ADR-166 now state explicitly that `/admin` is a support,
  moderation and investigation console and does not manage agent runs,
  approvals or board policy; the panel deliberately has no cross-board agent
  section. The docs point to the real surfaces — the global `/agents`
  (Attention / Sessions / Runs), the board-scoped Agent Control (Inbox / Live /
  Runs) and Board Settings → Agents & automation for policy — and note that
  future cross-board oversight needs a separate task with a master API,
  permission model and audit. No code, UI or API changes.

- TASK-179 agent surfaces redesign: the global `/agents` control room now has
  Attention / Sessions / Runs with board scope, search, freshness and
  per-board partial-error retention; the board header has one Bot entry that
  opens a board-scoped Agent Control modal with Inbox / Live / Runs (no Policy
  tab), and policy lives in Board Settings → Agents & automation with
  destructive mode, approval triggers, limits, TTL, dirty/discard and
  field-level CAS reload. Pending counts are scope-correct (`99+`) and
  MEMBER/VIEWER never request approvals; Live and Runs are read-only for them.
  URL state keeps `?token/?status/?time/?q` and adds
  `?section/?session/?agent/?approval/?run` (`approval`/`run` require
  `?board=`), while `/agents/:tokenId` remains a canonical token → sessions
  deep link. Testids for the board modal, `/agents`, runs and the Board
  Settings rail are documented in
  [`docs/TASK-179-url-testid-migration.md`](docs/TASK-179-url-testid-migration.md);
  EN/RU docs cover the new surfaces, permissions and deep links. Unit, browser
  and mobile coverage was extended without weakening existing expectations.

- TASK-179 final pixel-parity reads expose additive display names on
  board-level sessions and runs (`tokenName`, `sessionName`, `actorName`), a
  read-only `commandSummary` hint for the runs list, and a frozen `detail` on
  command deltas so a member run view can name a deleted card without
  pre-images. Existing clients that ignore unknown fields are unaffected; no
  MCP tool or write contract changes.

- TASK-176.5 + TASK-176.6 admin URL state and addressable filters: every
  admin entity list keeps `search/status/period/limit/offset` in the URL and
  restores it on load and browser back/forward, preserving the hub `tab`. Row
  clicks carry the exact filtered list as `returnTo`; user, board and card
  detail back controls return there, and only internal `/admin` paths are
  accepted. Global search still lands on the exact comment/attachment anchor
  and now labels the found card and opens a label result as the cards that
  carry that label.
  `GET /admin/entities/*` accepts validated `boardId`, `columnId`, `labelId`
  and `cardId` filters applied server-side with the existing status/period
  semantics; board counters link to their exact board list, column and label
  rows link to their exact cards, and card titles in the content editor link to
  `/admin/cards/:id`. Filters are removable chips above the table. Backend e2e
  covers same-name boards, cross-board isolation, deleted/archived rows,
  pagination and malformed ids; UI tests cover URL restore, back/forward,
  return paths and exact search targets. EN/RU admin docs and the changelog
  record the URL and deleted/archived behavior.

- TASK-176.4 + TASK-176.7 admin navigation and per-row moderation: card
  detail links comment authors, timeline actors and the last actor to
  `/admin/users/:id` (a deleted last actor degrades to a copyable id, never a
  broken link), and exposes `lastActorId` in `AdminCardDetailDto`; board and
  user detail link the inviter and expose `invitedById` in
  `AdminUserMembershipDto`. Audit rows link `user`/`board`/`card` targets to
  their detail pages, keep unknown targets as copyable ids, and show an
  OPERATOR the master email as text instead of an owner-only masters link.
  User profile comments, sessions and tokens and card comments/attachments
  gained per-row delete/revoke actions with the existing confirmations and
  audited endpoints; the refresh keeps the affected row visible with its
  `Deleted`/`Revoked` state. EN/RU admin docs cover the links and actions;
  backend e2e and UI tests cover success, 403, already inactive rows and
  inviter/last-actor link fallbacks.
- TASK-176.3 honest admin detail counters: user and card detail tabs are now
  server-side windows with exact totals (`25 of N` / `50 of N`, `Load more`)
  instead of samples presented as complete lists. `cardsCreated` counts the
  retained `ADD_CARD` / `DUPLICATE_CARD` command log exactly; comment,
  attachment, session and token tabs default to live/active rows and expose
  deleted/revoked rows through explicit `Show deleted` / `Show inactive` /
  `Show revoked` controls labelled with the hidden-row count. Card comments,
  attachments and the merged timeline no longer slice silently, and
  `?comment=<id>` / `?attachment=<id>` centres and highlights the row a global
  search result points at. EN/RU admin docs state the real limits and counter
  definitions; backend e2e and UI tests cover >100 cards, >25 comments,
  >25 sessions, >50 attachments and deleted rows.
- TASK-176.2 author-only comment editing: the card thread now has an inline
  `Edit` action on the caller's own comments (authors only — other members,
  viewers and masters cannot edit someone else's text). `PATCH
  /comments/:commentId` validates the same text limits as create, keeps
  `kind`, attribution and `createdAt`, stamps `editedAt`, reconciles inline
  media and records a `comment_updated` activity row and SSE frame. The UI
  edits in place with Save/Cancel, Ctrl/Cmd+Enter and Escape, shows a
  localized `edited` marker with a timestamp tooltip, and updates a second
  tab without a reload; the admin card detail shows the marker but offers no
  edit control. The migration adds nullable `Comment.editedAt`. EN/RU user
  guide, REST/OpenAPI docs and tests (backend e2e, UI unit, browser) updated.
- Board settings workflow redesign («Рельс доски»): the dialog is now one
  surface with a dialog header, a horizontal column rail (accent, card count,
  rule count), a per-column rule list with Allow/switch states, a 316 px
  context inspector (roles, conditions, reverse edge, live card check), one
  compact global-transition strip and one start/done row. The full matrix stays
  as a secondary tab, with roving-tabindex keyboard navigation and conditional
  cell markers. Template and reset moved into the header's `…` menu. The
  master-panel editor reuses the same body embedded, while the dialog keeps the
  dirty-close confirmation, inline save errors, foreign-change reload and
  full-screen mobile layout with a snap rail and inspector accordion. Unit,
  browser and mobile coverage plus EN/RU user-guide docs updated.
- TASK-166.16 launch documentation: English and Russian administrator and
  agent-developer scenarios, launch checklist and unreleased upgrade notes.
  The operations runbook now covers a consistent PostgreSQL and uploads
  backup, an isolated restore drill and rollback with the matching image,
  Compose and backup pair. The drill remains an operator action, not an
  automatically verified backup.
- TASK-166.11 agent DX contract: a public OpenAPI 3.1 document at
  `site/public/openapi.yaml` covers the complete agent-control surface
  (sessions, pause/resume, approvals, plans, runs, policy, token/account) and
  the core board/command write path, with the stable error envelope/codes,
  idempotency and `X-Approval-Id`/`X-Agent-Session`/version semantics. It is
  validated on every run (`npm run openapi:check`): OpenAPI 3.1 schema,
  unique operation ids/paths, declared path parameters and resolvable refs.
  MCP descriptions/annotations are audited by `mcp/src/catalog.test.ts`
  (title, description, parameter text, README catalog drift); all 84 tools
  remain, `apply_plan` now advertises its destructive potential. EN/RU API and
  MCP docs gained auth/scopes/versioning, runs/rollback, policy, real examples
  and a prompt-injection warning.
- TASK-166.12 contract/security suite: new backend
  `agent-control-security` and `agent-control-approval-security` suites pin the
  remaining actor/board-scope boundaries (read-only transports, cross-board
  and deleted/archived boards, pause precedence, untrusted card content,
  stable error envelopes), approval exactness/expiry, canonical `planHash`
  tampering, preview-conflict enforcement with all-or-nothing apply, and
  parallel `ifMatch`/approval races. A dedicated `security-contract` CI lane
  uses database `janosik_test_16612` and browser ports 4420/4920; a small
  Playwright `e2e/tests/security` lane covers VIEWER rollback denial and
  `run.reverted` refresh. Board policy audit now records the previous policy
  and version (`before`) next to `after`.
- TASK-166.8 plan preview and atomic apply: `POST /boards/:id/plans` is a
  pure dry-run over the same command validator, scope/destructive
  classification and WIP/workflow/version guards as `/commands/batch`. It
  replays the reducer in memory and returns the canonical
  `planHash = sha256(canonicalJson({schemaVersion, boardId, commands}))`
  (`action.at` and the action-level `boardId` are excluded), a net before/after
  diff, warnings (`approval_required`, `destructive`, `reviewer_required`,
  `no_op`) and conflicts (`version`, `wip`, `workflow`, `id`, `scope`,
  `destructive_denied`, `invalid`), and writes no command, `AgentRun` or
  approval. `POST /boards/:id/plans/apply` requires that hash; a mismatch is
  `409 approval_mismatch` with the expected/actual prefixes, and the apply is
  otherwise the batch transaction: all-or-nothing, one board lock, per-plan
  caps `min(100, policy.maxCommandsPerRun)` commands and
  `min(50, policy.maxCardsPerRun)` card creates (`409 limit_exceeded` beyond
  them, no cross-plan atomicity). A destructive plan without `X-Approval-Id`
  creates the exact approval request and applies nothing; an approved id is
  consumed once, and repeating the same applied commands is an idempotent
  replay. A PAT plan creates one `AgentRun` (`kind: "plan"`, `planHash`,
  optional `clientRunId`) with a pre-image per command and returns
  `{ runId, results, planHash }` plus `X-Run-Id`; a browser plan creates no
  run and keeps ordinary UI undo. New MCP tools `janosik_plan_changes` and
  `janosik_apply_plan` (tool count 84) expose the same pair, and shared DTOs
  are additive. e2e/unit/MCP tests cover dry-run no-writes, diff/warnings,
  hash mismatch, limit boundaries (100/101, 50/51), approval and one-time
  consumption, replay, plan-run rollback, PAT/browser/VIEWER behavior; docs
  EN/RU updated.
- TASK-166.15 audit/rollback and scopes/limits UI: the board ADMIN **Agent
  control** dialog gains **Runs & rollback** and **Policy & limits** tabs. Run
  history filters by status, kind, token, session and time, pages with a
  cursor, and opens a detail. A MEMBER/VIEWER gets a read-only **Agent runs**
  entry that opens the same tab and can run the dry-run conflict preview;
  applying a revert stays board ADMIN. The detail shows the command
  timeline/attribution,
  `firstSeq`/`lastSeq`, plan/approval hash, pre-images and diff (browser-JWT
  board ADMIN only) and the conflict list. Any board member can request the
  dry-run preview; applying a revert is a session-only board ADMIN action with
  a confirmation and a generated `commandId`, surfaces `run_conflict`,
  `run_expired` and `pat_forbidden`, is all-or-nothing, and refreshes the list
  and open detail on `run.reverted` SSE. The policy dashboard shows and edits
  `Board.agentPolicy` (destructive `approval`/`deny`, the fixed
  `requireApprovalFor` list, `["ADMIN"]` approvers, `maxCommandsPerRun` 1–100,
  `maxCardsPerRun` 1–50, `approvalTtlMinutes` 5–1440) with CAS on
  `agentPolicyVersion`, reset to defaults via `policy: null`, Activity and
  SecurityAudit rows, and the current board pause state. New
  `GET/PATCH /boards/:id/agent-policy` are session-only board ADMIN; API keys
  receive `403 pat_forbidden`. Account → API keys now edits an existing
  token's name, scope preset, trusted CI, board scope, read-only flag and
  rate limit through the session-only `PATCH /users/me/tokens/:id`
  (validated, audited, ownership-checked, never returns the secret) while the
  row keeps a compact effective-scope/board/rate/pause summary; a PAT cannot
  edit a key. The runs list also accepts optional `from`/`to` bounds. EN/RU
  i18n and user-guide docs; unit, backend e2e and browser tests cover the
  timeline/revert/conflict flow, policy defaults/validation/CAS/reset and the
  token edit/permission paths.
- TASK-166.9 attention and notification backend: approvals, agent blockers /
  handoffs, expired claims and refused quota now produce one deduplicated
  in-app `AttentionNotification` per recipient and, unless the account opted
  out with the new `notifyAttention` preference, one EN/RU e-mail through the
  existing mail queue. The same contract covers the full approval lifecycle
  (`approval.requested`, `approval.decided`, `approval.cancelled`,
  `approval.consumed`, `approval.expired`) and personal API-key revocation
  (`token.revoked`, owner only). Approval requests go to active board ADMINs;
  decisions, cancellations and consumptions go to the requester and decision
  actor; an expiry goes to the requester and known decision actor; a lapsed
  claim goes to ADMINs and the claimant; the board cap warns the account
  itself. API tokens are never recipients, removed/expired members and
  disabled accounts are dropped, and the inbox is session-only
  (`GET /users/me/notifications`, read/read-all,
  `GET/PATCH /users/me/notification-settings`). Immediate attention is
  fire-and-forget, so SMTP never blocks a decision or comment. The scheduled
  digest (v2) now includes undigested attention categories once per recipient
  and marks them digested, while the existing board activity and due-reminder
  behaviour is unchanged. A new maintenance `sweep-claims` releases lapsed
  card leases and raises one claim-expiry event; `sweep-attention` applies the
  normal retention window to the inbox.
- TASK-166.10 observability and per-token rate limits: personal API tokens now
  have scoped agent budgets on top of the unchanged global per-principal
  window — the token's own `rateLimitPerMinute`, a per-agent-session bucket
  (`AGENT_SESSION_RATE_LIMIT`, default = live global limit, min 60) and a
  per-board bucket (`BOARD_RATE_LIMIT`, default = 2× live global limit, min
  600). Browser sessions keep their legacy per-user/IP limits. Every applied
  bucket returns `X-RateLimit-Limit`/`-Remaining`/`-Reset`/`-Scope`, the
  IETF-style `RateLimit-*` headers and `Retry-After` on `429`; the rejection is
  the shared envelope with `code: rate_limited`, `retryable: true`,
  `retryAfter`, `limit`, `scope` and `requestId`. One structured request-log
  line per finished API response carries `requestId`,
  method/path/status/duration, `actorType`/`actorId`, `boardId`,
  `apiTokenId`, `agentSessionId`, `runId`/`approvalId` when available and the
  classified operation; query strings and public share tokens are redacted,
  and bodies, headers, token values, comments and card content are never
  logged. The same fields feed `GET /admin/traffic` under `telemetry`
  (requests by actor, writes, errors, rate-limit hits by scope,
  approval/pause/run counters and a bounded latency histogram) with no new
  admin screen. `media`, `transcode` and `exports` job payloads carry an
  optional ids-only `attribution` object, and enqueue events are visible to
  ops. Adds unit/e2e coverage for per-token/session/board isolation, headers,
  the 429 envelope, log redaction and queue attribution; docs EN/RU, ADR
  §8.4 and ROADMAP are updated.
- TASK-166.14 approvals and pause/kill UI: a board ADMIN gets an **Agent
  control** dialog in the header. **Approvals** lists pending and historical
  requests with summary, risk, board/card context, requesting token and agent
  session, the exact command/operation plan, plan hash, TTL/expiry and
  decision/audit fields; approve/reject sends the required `planHash` plus an
  optional comment and is available only in a browser session. `approved`,
  `consumed`, `expired`, `cancelled` and `rejected` stay visible with their
  audit context. **Pause & sessions** pauses/resumes the whole board or one
  active session with a reason, explains the in-flight boundary (running
  requests finish; new writes get `403 agent_paused` and are not retried;
  reads/heartbeat/end stay available; claims are not released), and lists
  active sessions with their effective pause scope. The account API-key panel
  gains per-token pause/resume, account-wide `Stop all`/`Resume all` (which
  leaves individual pauses intact), and keeps `Revoke` as the irreversible
  kill switch. Approval changes and agent control-plane transitions arrive
  through SSE: the pending badge, queue, detail and session list update live
  without a page reload; the board stream now forwards the documented
  `approval` frame (it previously dropped it), and board/session
  pause/resume publish the documented `agent` SSE frame. Full EN/RU strings,
  loading/empty/error/permission states and a responsive two-pane dialog are
  included; docs EN/RU cover the human control flow.
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
- TASK-166.2 token scopes and destructive gate: every PAT now has a capability
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
- TASK-166.13 agents console: a new `/agents` page lists every agent session
  the caller can see across their boards, grouped by personal API token, with
  board/token/status/time filters, live heartbeat/stale state, current card and
  run. The agent detail page shows all of that token's sessions; a board ADMIN
  can pause/resume with a reason or end a session with a final status and
  summary, while MEMBER/VIEWER keep a read-only view. New `agent` SSE frames
  refresh the affected board without a reload, with a slow poll fallback.
  Watch now separates two PATs of one account, groups agents by token/session
  and shows their token/session/run ids; card History and agent comments carry
  the same attribution next to the unchanged human name. EN/RU copy and the
  user-guide section cover the console.

### Changed

- Snapshot shares now store independent copies of opted-in comments and
  attachments. Published copies and the saved roster can remain publicly
  accessible after erasure of the source account. The previous capture stays
  available until refresh, link revocation or expiry. See the
  [security policy](site/src/content/docs/docs/security.md).

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

- TASK-177.17 makes comment deletion explicit: the confirmation names the
  author in its title, shows a short excerpt of the exact comment, and keeps
  the honest “cannot be undone” copy. Comments are soft-deleted server-side,
  but the public API has no restore route (only the master-admin entity
  restore reaches the row), so the UI deliberately offers no undo toast rather
  than recreating the comment under a new id. The delete trigger and the
  dialog actions meet the 44 px touch target on small screens and touch-only
  devices. TASK-177.8 makes the trigger visible on touch-only devices. The
  excerpt collapses whitespace and truncates on grapheme boundaries (code points when `Intl.Segmenter` is
  unavailable), so surrogate pairs and ZWJ emoji are never split; the author
  line falls back from display name to email to author id; a non-404 DELETE
  failure restores the comment at its loaded position instead of collapsing
  pagination, while a 404 keeps it removed and repairs the count; a repeated
  confirmation sends exactly one request, and different comments can be
  deleted while an earlier request is in flight. EN/RU copy and tests cover
  the excerpt/author, cancel, the no-undo decision and the touch targets.
- TASK-177.15 card accessibility: checklist item toggles are named from the
  item text and progress bars expose `aria-label`/`aria-valuetext`; closing the
  card dialog returns keyboard focus to the card (or the board landmark when
  the card is gone) while the focus trap stays; the public share card panel
  returns focus the same way. The board title is the page `h1` and columns are
  `h2`, the card dialog and Board Settings no longer add a second `main`, and
  insert zones are always list items. The Block type placeholder, column/link
  and table empty states, due-date and WIP chips, completed-checklist badges,
  active board/activity/filter/calendar toggles and label chips clear WCAG AA
  in both themes (new `--chip-*`/`--tab-text` tokens, checked by a contrast-pair
  test and source guards against raw tints). Axe-core runs with `color-contrast`
  enabled and relevant `incomplete` results gated on the board, card dialog,
  filter popover, calendar (month/week), table and watch view at 1440 in light
  and dark, on the board and card dialog at 1024/390 in light, plus Board
  Settings at 1440 light, using a fixture with overdue/soon/later due dates, an
  over-limit WIP column, a completed checklist and a high priority.
  The hidden attachment input, filter popover, table cells and calendar month
  trigger are named; header controls whose accessible name diverged from their
  visible text now keep the visible label in the name (Filters, Global search,
  Account).
- TASK-177.10 groups global search results before applying the 20-hit cap:
  `Cards` and `Boards` are capped separately, so a board hit stays visible
  under a long card list. The group heading shows `20 of N` (or
  `20 of N loaded` while other boards hydrate) and announces the count to
  screen readers. `Show all results` is bound to the query it was clicked for
  and expands to at most 200 matches per group without re-running the search,
  while keeping the selected hit and scroll position. Archived cards left in
  a legacy column are reported once. EN/RU copy and the user guide cover the
  new behaviour.

- TASK-177.3 keeps per-card comment drafts when you reopen a card and clears
  them when the session ends. Activity counts show `50+` when more rows remain
  and the total is unknown, or `N of M` when the total is known. A 65-comment
  regression test covers the transition to an exact count after pagination.

- TASK-183.2: attaching or detaching a card label updates the card's timestamp.
  Undo restores the previous timestamp, and focus refetch can detect the
  change from the timestamp alone.

- TASK-183.3: deleting a label stamps every card it leaves (`updatedAt`,
  `version`, `lastActorId`), and restoring it puts each card's exact previous
  timestamp back. Old undo records without per-card timestamps still apply
  using the restore clock; label rename/color deliberately leave cards
  untouched. The label comparison in the UI diff remains as a compatibility
  check for older snapshots.

- TASK-182 phase 2: if the due-date picker fails in admin card Properties, the
  popover immediately offers Retry and a native date-and-time input while the
  other fields stay editable. A successful Retry moves keyboard focus into the
  restored picker. The native input uses the existing Save and Remove controls.

- TASK-179 agents live-review feedback: the Attention badge counts pending
  decisions only (stale sessions no longer inflate it), and a paused session
  stays in the Attention live preview with a `Paused` pill even when its
  heartbeat aged out; paused sessions are not "needs a nudge" cards. Session
  detail drops the non-mockup folder icons, token-settings control and raw run
  link, and its token/run metadata is plain text. Run detail uses relative
  `Today, …` timeline wording and the mockup icons, reports a missing command
  log honestly (`0 of N stored`) instead of claiming N applied with zero rows,
  and only calls rollback unavailable when the stored commands/pre-images are
  actually absent. The run footer copy and rollback card match the mockup.

- Admin bulk actions now apply to every selected row across pages: the counter,
  confirmation and request use the same saved ids, filter changes clear the
  selection, and a selection above the backend cap of 500 is blocked with a
  clear message. Partial failures keep exactly the refused ids selected
  (TASK-176.1).
- Hardened agent writes against concurrent token revocation, permission and
  policy changes, and pause; retained idempotency reservations for uncertain
  outcomes and preserved agent-session results when some boards fail to load.
- Combined board appearance, card density, transparency and blur controls
  into one three-line menu.
- TASK-166.17 hardens agent sessions and lifecycle operations: MCP resolves
  comment and attachment board context before attributing writes; card-create
  caps count actual column copies and are rechecked under the board lock;
  lifecycle approvals are released only on a proven rollback; session start
  serializes with token revocation and pause. Regression coverage includes a
  live MCP client and deterministic PostgreSQL race tests.
- Agent session rate limiting no longer charges an owner's session for a
  foreign token's heartbeat or end request. Read-only tokens can use session
  lifecycle controls and preview run reverts without gaining write access.
- Share creation idempotency and approval intent include the expiry. MCP
  sends a stable relative duration plus an absolute fallback for older servers.
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

### Fixed

- TASK-179 final pixel-parity pass: Runs filter popovers no longer truncate
  long token/session labels; the Sessions head keeps its actions on one row at
  1440/1024; the group-by control, danger status tones, resume copy, Attention
  no-selection/member states, Inbox filtered-empty recovery, approval-detail
  rhythm, command chips, mobile Inbox/approve-dialog geometry and Live row
  density now match the tracked mockup. Reverted ADMIN runs keep the pre-image
  disclosure, deleted-card commands show the human card title, token-less
  audit runs keep the “No token” subject, and the conflict chip is text-only.
  The five-agent final review and its evidence are recorded in
  [`design/task-179-visual-acceptance/pixel-parity/README.md`](design/task-179-visual-acceptance/pixel-parity/README.md).

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
