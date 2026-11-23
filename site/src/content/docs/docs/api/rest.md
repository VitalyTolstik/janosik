---
title: REST endpoints
description: Boards, members, comments, attachments, sharing and realtime for the Janosik HTTP API.
---

Content mutations travel through the [Command API](/docs/api/commands/). This page
documents the other user-facing operations: boards and membership,
comments, attachments, public sharing and the realtime stream. See
[API reference](./) for the shared conventions (base path, auth, errors,
rate limits).

## Write headers and concurrency

A supported PAT write accepts `X-Agent-Session: <sessionId>` when the caller is a PAT that
started a session on the same board. It attributes the command/comment/
attachment and is verified on the server; a mismatch is
`403 agent_session_invalid`, a closed session `403 agent_session_closed`.

The version precondition is in the JSON body, not in the HTTP `If-Match`
header: `{ "ifMatch": 42 }` pins the board `seq` (`X-Board-Seq` from
`GET /boards/:id`), while `ifMatchVersions: { "card:<id>": 7 }` pins individual
entity versions. A stale value answers `409 version_conflict` with the current
value in `currentVersion`. `Board.version` is the entity version used by
`ifMatchVersions`, not the command sequence.

`Idempotency-Key` covers the REST writes listed below (8–128 characters from
`A-Z a-z 0-9 _ -`). Command-log writes use `commandId`, and `clientRunId` keys a
batch/plan run. A failed request releases its key; a replay returns the first
result; a different body with the same key is `409 idempotency_conflict`.
Successful command/batch/plan/revert responses may carry `X-Run-Id`.
`X-Request-Id` matches `requestId` in an error body. The agent rate-limit
headers are described in the [API reference](../#agent-buckets-and-headers).

Pagination is cursor-based: `?cursor=` is opaque and `nextCursor: null` means
the end. Comments and activity default to 50 and cap at 100; approvals and runs
cap at 100. Search uses `?q=`. There is no offset pagination.

## Boards and members

A board is created and deleted over REST; membership changes are REST by
design (they are not reducer actions). Content lives in the command log.

| Method   | Path                          | Auth / role | Request           | Response           |
| -------- | ----------------------------- | ----------- | ----------------- | ------------------ |
| `GET`    | `/boards`                     | user        | none              | `BoardSummary[]`   |
| `POST`   | `/boards`                     | user        | `CreateBoardDto`  | `BoardAggregate`   |
| `POST`   | `/boards/import`              | user        | `BoardEnvelope`   | `BoardAggregate[]` |
| `GET`    | `/boards/:id`                 | member      | none              | `BoardAggregate`   |
| `DELETE` | `/boards/:id`                 | `ADMIN`     | none              | `{ status: "ok" }` |
| `GET`    | `/boards/:id/members`         | member      | none              | `BoardMemberDto[]` |
| `GET` | `/boards/:id/invitations` | `ADMIN` | none | `BoardPendingInvitationDto[]` |
| `POST`   | `/boards/:id/members`         | `ADMIN`     | `InviteMemberDto` | `BoardMemberDto`   |
| `PATCH`  | `/boards/:id/members/:userId` | `ADMIN`     | `UpdateMemberDto` | `BoardMemberDto`   |
| `DELETE` | `/boards/:id/members/me`      | member      | none              | `{ status: "ok" }` |
| `DELETE` | `/boards/:id/members/:userId` | `ADMIN`     | none              | `{ status: "ok" }` |
| `GET`    | `/boards/ready`               | user        | query `limit`     | `BoardsReady`      |
| `GET`    | `/boards/search`              | user        | query `q`         | `{ matches: WorkspaceSearchMatch[]; total: number; truncated: boolean }` |
| `GET`    | `/boards/:id/ready`           | member      | query `limit`, `wait`, `since` | `BoardReady` (or `204`) |
| `GET`    | `/boards/:id/export`          | member      | none              | `BoardEnvelope`    |
| `GET`    | `/boards/:id/deleted`         | `ADMIN`/`MEMBER` | none         | `DeletedBoardItemsDto` |
| `POST`   | `/boards/:id/deleted/:type/:itemId/restore` | `ADMIN`/`MEMBER` | none | `{ status: "ok" }` |
| `GET`    | `/boards/:id/search`          | member      | query `q`, optional `includeMatches` | `{ cardIds: string[]; matches: BoardSearchMatch[]; matchesTotal: number; matchesTruncated: boolean }` |

`GET /boards` lists the boards where the caller is an accepted member, newest
first, each with a card and column counter and the caller's role. A pending
invitation does not count.

`POST /boards` creates a board with the caller as its first `ADMIN`. A blank
title answers `400`. `template: "starter"` adds three columns, a welcome card
and a checklist; `templateLocale` (`en`/`ru`) picks the copy and requires the
template.

A `503` from this route has one of two shapes. When the board was created but
the starter batch failed and the fresh board could not be removed, the answer is
`503 starter_cleanup_failed` with `retryable: false` and `details.boardId`: the
board exists, so open it with `GET /boards/{details.boardId}`. A failed first
aggregate read likewise answers a non-retryable `503` (`starter_read_failed` for
the starter template, `board_read_failed` for any create) with the same
`details.boardId`. For these, reusing the same `Idempotency-Key` answers `409
idempotency_in_progress`; do not retry the create with a new key, which would
make a second board. A board write that times out answers `503
board_write_timeout` (`retryable: true`, no `boardId`); nothing was saved, so
retry. When the starter batch fails but its fresh board is removed successfully,
the route rethrows the original error (a `500`, for example) and releases the
key, so a retry with the same key may create the board (`201`).

`POST /boards/import` accepts an export envelope, either as a parsed JSON
object or as a raw JSON string; the server validates the parsed object without a
stringify→parse round trip. It normalizes leniently and creates every board in
the envelope with the importer as `ADMIN`. An empty or invalid envelope answers
`400`. `?dryRun=1` returns `{boards, cards, columns, labels, withinLimit}` and
writes nothing. The envelope is:

```json
{ "app": "janosik", "schemaVersion": 3, "exportedAt": 0, "boards": [] }
```

Version 3 adds the optional per-board `agentPolicy`; version 2 added the
optional `workflow`; version 1/2 files still import (with no policy). The
importer mints fresh column and card ids and rewrites the workflow references;
a transition whose column is missing is dropped rather than failing the import.

`GET /boards/:id/export` streams one `BoardEnvelope` (`schemaVersion: 3`) and
refuses an export above `MAX_BOARD_EXPORT_BYTES` with `413`. `GET
/boards/:id/deleted` lists the board's soft-deleted cards, columns, comments and
card-face files inside the operator retention window, newest first; the body is
`{ retentionDays, limit, items, truncated }`, and each item is `{ type, id,
title, deletedAt, purgeAt, columnTitle?, cardId?, cardTitle?, authorName?,
sizeBytes? }`. `POST /boards/:id/deleted/:type/:itemId/restore` restores one of
them (`type` is `cards`, `columns`, `comments` or `attachments`). Cards and
columns return through the command log; comments and files restore in place and
emit Activity/SSE. Both routes require board `ADMIN` or `MEMBER` — a `VIEWER`
gets `403`. A card whose column is still deleted answers `409 column_deleted`;
an item older than the retention cutoff is hidden from the list and answers
`410 retention_expired`.

`GET /boards/:id` returns the board aggregate and sets an `X-Board-Seq`
response header carrying the command `seq` the aggregate reflects. A client
resumes the SSE stream from that value. An unknown or soft-deleted board
answers `404`. The aggregate carries `workflow` when the board has one.

### Ready work and long-polling

`GET /boards/:id/ready?limit=&wait=&since=` is a **summary**, not a board read:
the cards an agent can pick up now, never their descriptions, checklists, links,
labels or comments. Ready means the board's initial column
(`workflow.initialColumnId`, else the first column), unassigned, not
archived/deleted, not under a live claim (a null or lapsed lease is free) and not
the target of a live `blocks` link. The list is ordered by priority, most urgent
first, and capped at 100. Each card carries `id`, `title`, board and column
ids/titles, `priority`, `claimedBy`, `leaseUntil` and `version`. Descriptions are
never selected, so a large description is not detoasted. The response also
carries the board's command `seq`, mirrored in `X-Board-Seq`.

`wait` is a server-side hold in **milliseconds**, 0–60000 (default 0 = immediate
snapshot). It wakes only on a readiness-relevant action (card presence, move,
priority, assignee, claim, link or column/workflow change) or a resync frame —
every command touches `board:<id>`, so label, checklist, comment and board-rename
frames do not wake it. After a wake it re-reads and answers `200` when work
exists; if the change still leaves no ready card it **keeps holding** until the
deadline instead of returning an empty snapshot. Co-waiters that woke on the same
event share one snapshot read. A timed hold answers `204` with `X-Board-Seq` and
`Cache-Control: no-store` and no body.

`since` is the `seq` from the previous answer: when the board has advanced before
the hold starts, the snapshot answers immediately even if no card is ready. A
client disconnect aborts the hold and releases its subscription and admitted poll
slot. A board deleted during the hold answers `404`, not `204`. Per-instance
held-poll caps answer `503 ready_poll_capacity`; hold time is excluded from the
API latency p50/p95. Any accepted role may read the endpoint, including
`VIEWER`; an archived board answers `200` with `archived: true` and no cards.
Invalid `limit`, `wait` or `since` bounds answer `400`.

`GET /boards/ready?limit=` is the cross-board snapshot: every accessible board
as `{ id, title, archived, seq }`, plus at most `limit` ready cards (total, not
per board) from the active boards' initial columns. It is built with one
board/column read, one column-scoped card query and one grouped `seq` read — no
per-board fan-out and no full aggregates. A board-scoped PAT sees only its own
board. This route is a snapshot only; hold one board with
`/boards/:id/ready?wait=`.

`GET /boards/:id/members` returns only **active** accepted memberships by
default; an expired `VIEWER` is omitted so assignee pickers and filters never
offer a member the server will refuse. A board `ADMIN` may add
`?includeExpired=1` to include lapsed `VIEWER` rows for the member-management
dialog; other roles get `403` for that query. Pending invitations never appear
here.

`GET /boards/:id/search?q=` returns `{ cardIds, matches }` — the cards whose
title, description, a checklist item, a comment or a visible attachment file
name contains `q` (case-insensitive substring). `cardIds` is complete and stays
the compact MCP-facing projection; `matches` adds `matchIn`, a short snippet
for description/checklist/comment/attachment hits and the matched
`commentId`/`attachmentId` for deep links. The match list is deduped per
card/kind and capped at 200; `matchesTotal` and `matchesTruncated` report when
the explanation list is incomplete while `cardIds` stays complete.
`includeMatches=0` (or `false`) keeps `cardIds` complete while returning
`matches: []` and zeroed match totals, which is what the board filter uses.
It reaches text that is not part of the board aggregate; hidden inline and
`descriptionDetached` uploads are excluded because they cannot be revealed in
the card's attachment list. A query longer than 200 characters, or a repeated
`q` (`?q=a&q=b`), answers `400`.

`GET /boards/search?q=` is the palette's cross-board companion. It searches
comment text and visible attachment file names across every board where the
caller has an accepted, unexpired membership, dedupes per board/card/kind,
merges comments and files newest-first and returns at most 200 `matches` with
the board and card titles. `total` is the complete distinct match count and
`truncated` says whether the list was cut. It never searches
titles/descriptions/checklists (the client matches those locally). A
board-scoped PAT sees only its own board; a repeated `q` answers `400`.

`DELETE /boards/:id` soft-deletes the board and cascades the flag to its
children and revokes live shares. Memberships stay available for board
restoration until purge. Snapshot shares keep serving their captured content
after deletion and purge. Permanent purge also removes the board's agent
sessions and approvals.

`POST /boards/:id/members` invites a user by email. The address is trimmed
and lowercased. The answer never reveals whether an account exists for it: a
known address, an unknown one and a repeat invite of a still-pending invitee
all answer the same `201` with a masked `BoardMemberDto`. In it `userId` is
`""` and `displayName`, `avatarColor` and `avatarPath` are `null`; `email`,
`role` and `expiresAt` echo the request. For a known address the row is
created as a pending invitation and confers no access until accepted. For an
unknown address nothing is stored, so invite the person again once they have
an account. `expiresAt` is honored for `VIEWER` only. Only an address that is
already an accepted member answers `409`.

An invitee whose account has not confirmed its email does not see the
invitation, and cannot accept it, until the address is confirmed (see
[Invitations](../#invitations)).

`GET /boards/:id/invitations` lists pending invitations on the board.

`PATCH /boards/:id/members/:userId` changes the role and/or the `VIEWER`
expiry. The last `ADMIN` of a board cannot be demoted, and the last `ADMIN`
cannot be removed: both answer `409`.

`DELETE /boards/:id/members/me` leaves the board as the caller. Any accepted
`MEMBER` or `VIEWER` may call it; an `ADMIN` may leave only while another active
`ADMIN` remains (pending and expired rows do not count). The last `ADMIN`
answers `409 { code: "last_admin", action: "leave" }`. The route is session-only
(a PAT gets `403 pat_forbidden`) and idempotent: repeating it after a successful
leave, or after a lost response, answers `200`; only a missing/soft-deleted
board is `404`. Authored cards and comments stay on the board with their
original `actorId`; the feed and comment DTOs also carry the author's joined
`actorName`/`actorEmail` and `authorName`/`authorEmail`, so the leaver is still
named after the roster drops them. The departure is recorded as `member_left`
and a `membership: left` SSE frame closes the leaver's stream; an admin removal
keeps `membership: removed`. Afterwards the board is absent from `GET /boards`
and direct board URLs answer `403`.

### Access order

Board-scoped routes answer in this order: a missing or invalid token is `401`;
an unknown or soft-deleted board is `404`; no membership is `403`; an expired
`VIEWER` membership is `403` and the stale row is dropped; a role not allowed
by the route is `403`.

Board routes that accept a PAT still enforce membership, board roles and
token scope. The routes below require a browser access JWT. When a PAT
reaches the session check, the server returns `403 pat_forbidden`.

| Browser-only route | PAT access to related routes |
| --- | --- |
| `GET /agents/overview` | Board-scoped session, approval and run reads are available under their respective visibility rules. |
| `GET` / `PATCH /boards/:id/agent-policy` | Board reads are available to members within scope. |
| `POST /boards/:id/approvals/:approvalId/decision` | The requesting PAT can create, read and cancel its own request. |
| `POST /boards/:id/runs/:runId/revert` to apply a rollback | A PAT can call `/revert/preview` or use `{ "dryRun": true }`. |
| Board, agent-session, token and global pause/resume routes | A PAT can start, heartbeat and end its own agent sessions. |
| Personal API token management | `GET /auth/me` returns the caller's token identity. |

The [API reference](../#session-only-routes) lists the exact pause and account
routes. Account invitations use a browser session. Board invitations can be
listed or sent by a board ADMIN using a PAT with the `admin` preset.

## Comments

Comments are stored as Markdown strings and managed through REST. `CardAccessGuard` resolves the
owning board from the card or comment and enforces membership.

| Method   | Path                      | Auth / role        | Request            | Response           |
| -------- | ------------------------- | ------------------ | ------------------ | ------------------ |
| `POST`   | `/cards/:cardId/comments` | `ADMIN` / `MEMBER` | `CreateCommentDto` | `CommentDto`       |
| `GET`    | `/cards/:cardId/comments` | member             | query `cursor`, `limit`, `kind` | `CommentPage`      |
| `GET`    | `/comments/:commentId/revisions` | `ADMIN` / `MEMBER` / active `VIEWER` | query `cursor`, `limit` | `CommentRevisionPage` |
| `PATCH`  | `/comments/:commentId`    | `ADMIN` / `MEMBER` | `UpdateCommentDto` | `CommentDto`       |
| `DELETE` | `/comments/:commentId`    | `ADMIN` / `MEMBER` | none               | `{ status: "ok" }` |

`POST` takes no query parameters; the body is `CreateCommentDto`. A blank
text answers `400`, and an unknown `kind` answers `400`. When `commandId` is
supplied, a retry that reuses it returns the first comment instead of appending
a duplicate. A `commandId` already used on another card answers `409`.

Mentions are explicit Markdown links to the reserved
`https://janosik.invalid/mention/<userId>` address, for example
`[@Alice](https://janosik.invalid/mention/clx…)`. The server resolves every
link at write time, rejects an id outside the board's active roster with
`400 mention_not_member`, and returns the resolved ids in
`CommentDto.mentionedUserIds` (first-mention order, duplicates collapsed).
Mentions inside top-level or blockquote fenced code and inline code are
inert. Fenced code nested inside a list item is treated as ordinary text; the
composer only creates top-level code blocks. Escaped tokens and larger URLs
are inert too, and HTML comments are not rendered. Closing fences follow the
same 0–3-space indentation rule as their opener; a fence line indented four
spaces is content and outside the supported scope. Indented text is ordinary
text: an explicit `[@Alice](https://janosik.invalid/mention/clx…)` link there
is live and notifies, while a hand-typed `@Alice` never notifies.

`GET` accepts `?cursor=` (opaque), `?limit=` and `?kind=` (one comment kind).
The default limit is 50, the maximum is 100; a limit outside `1` to `100`
answers `400`, and an unknown `kind` answers `400`. Pages are newest-first and
`nextCursor` is `null` at the end.

`DELETE` removes a comment. Only the author may delete their own comment;
another author answers `403`.

`PATCH` edits the caller's own comment. The body is `{ "text": "...", "kind": "blocker" }`;
both fields are optional, but at least one must be present or the server
answers `400` (`text` must still be non-blank and at most 10 000 characters).
An omitted field keeps its stored value. Only the author may edit; another
author answers `403`, a deleted comment `404`. `authorId`, attribution and
`createdAt` stay as they were. A real text change stamps `editedAt` (Unix ms in
`CommentDto`) and appends a revision; a kind-only change does neither. Inline
media removed from the text is soft-deleted.
The edit writes a `comment_updated` activity row and SSE frame; changing a
comment to `blocker`/`handoff` does not repeat attention already raised by the
original comment.

`GET /comments/:commentId/revisions` returns the immutable text history,
newest first (`revisionNumber` descending). Board `ADMIN`, `MEMBER` and an
active `VIEWER` may read it with a JWT or a read-scoped PAT; a non-member or an
expired membership answers `403`, and a missing or deleted comment, card,
column or board answers `404`. `?limit=` defaults to 20 and caps at 100.
`?cursor=` is opaque and bound to the comment: a malformed or foreign cursor
answers `400` after the access check, and it keeps working after the row it
pointed at was trimmed. Every page, including an empty one, carries
`historyIncomplete` and `historyIncompleteReason` (`legacy_cutover`,
`revision_limit`, `gdpr_erase`, `writer_gap`, or `null` for a complete
history). If the saved text contradicts the writer's verified pair, the route
returns an empty page with `writer_gap` immediately, even before the
reconciliation sweep persists the reason. `CommentRevisionDto` exposes `id`,
`revisionNumber`, `createdAt`, `editorId`, `editorName`, `actorType`,
`agentName`, `cause`, `beforeText` and `afterText`; `editorName` is the current
public display name and is `null` when the editor or the name is unavailable.
Token and session identifiers are never returned. A master reads the same
projection at `GET /admin/comments/:commentId/revisions` with the admin JWT and
no board membership; both routes are read-only. The writer keeps the newest 50
revisions per comment: older rows and their Activity copies are removed and
the comment reports `revision_limit`. A mismatch with the writer's verified
pair reports `writer_gap`; the `sweep-comment-history` maintenance job adopts
the current text as a new verified point and strips unconfirmed Activity
snapshots. Observability exposes revision/Activity counts and text byte sizes,
trims, incomplete histories and over-budget comments, never the text itself.
Public share comment
projections and frozen snapshots never include revisions, revision IDs,
before/after text, counters, history flags/reasons or cutover/verified fields,
and a share token does not open the revisions routes.

Each write records an `Activity` row and publishes an `activity` SSE frame.

## Resource board context

Each route resolves the board of an accessible resource and returns
`{ boardId: string }`. The same membership and PAT scope rules apply as when
reading the resource.

| Method | Path |
| --- | --- |
| `GET` | `/cards/:cardId/board-context` |
| `GET` | `/comments/:commentId/board-context` |
| `GET` | `/attachments/:attachmentId/board-context` |

## Agent sessions and attribution

A personal API token may open a board-scoped agent session. The session is an
attribution context, not a second account: it grants no rights beyond the token
that owns it.

| Method | Path                                                    | Auth / role              | Request                    | Response            |
| ------ | ------------------------------------------------------- | ------------------------ | -------------------------- | ------------------- |
| `POST` | `/boards/:id/agent-sessions`                            | PAT, board member        | `CreateAgentSessionDto`    | `AgentSessionDto`   |
| `POST` | `/boards/:id/agent-sessions/:sessionId/heartbeat`       | the same PAT             | `AgentSessionHeartbeatDto` | `AgentSessionDto`   |
| `POST` | `/boards/:id/agent-sessions/:sessionId/end`             | the same PAT or `ADMIN`  | `EndAgentSessionDto`       | `AgentSessionDto`   |
| `GET`  | `/boards/:id/agent-sessions?active=1`                   | any member               | none                       | `AgentSessionDto[]` |
| `GET`  | `/boards/:id/agent-sessions/:sessionId`                 | any member               | none                       | `AgentSessionDto`   |

Start accepts optional `name`, `clientName` and `model` (100 characters each).
Heartbeat accepts `status` (`active`, `idle`, `waiting_approval`),
`currentCardId` and `summary`; end accepts `status` (`completed`, `failed`,
`cancelled`) and `summary`. Repeating `end` returns the stored terminal state.
A session whose last heartbeat is older than five minutes is reported as
`stale` (computed, not stored). Ending a session releases the claims it owns.

A PAT write may send `X-Agent-Session: <sessionId>`. The server verifies that
the session belongs to the same user, token and board and is not closed; a
mismatch answers `403 agent_session_invalid`, a closed session
`403 agent_session_closed`. Start and heartbeat are PAT-only: a browser JWT
gets `403 pat_required` (the `endpoint` detail names `start` or `heartbeat`).
`end` accepts the same PAT or a board ADMIN browser session. Clients that send
no header keep working: commands still carry `apiTokenId`, but
`agentSessionId` stays `null`. The server fills all attribution from the
authenticated principal; a request body cannot forge `apiTokenId`,
`agentSessionId`, `runId`, `agentName`, `claimedByTokenId` or
`claimedBySessionId`.

Command entries and command SSE frames expose the optional `apiTokenId`,
`agentSessionId`, `runId` and `agentName` fields. Activity entries expose the
same fields plus `actorType`; `CommentDto` carries `actorType`, `apiTokenId`,
`agentSessionId` and `agentName`, while `AttachmentDto` uses
`uploadedByTokenId`/`uploadedBySessionId`. `GET /boards/:id/activity` and
`GET /cards/:id/activity` accept `actorType`, `apiTokenId`, `agentSessionId`,
`runId`, `type`, `from` and `to`; the filters apply to both merged sources
(commands and activity rows). `GET /boards/:id/commands` accepts `since`,
`runId`, `apiTokenId` and `agentSessionId` only. Public share responses and
streams strip token/session ids and the token name. `GET /auth/me` for a PAT
adds a non-secret `token` identity object (`scopePreset`, `trustedCi`, pause
stamps, `effectiveTokenScope`) and a `server` block; a browser session gets
`token: null`.

## Agent overview

`GET /agents/overview` returns the browser control plane’s paginated
approvals, sessions or runs. Approval rows require board ADMIN access.
Sessions and runs are visible to accepted board members. Select the
`section` and optional `boardId`, filters, `limit` and `cursor`. The
[OpenAPI document](/openapi.yaml) describes the query and response fields.

## Pause and kill

Humans can stop agents without revoking a key. Pause is reversible; kill is
token revocation. All pause/resume routes are browser-session only: a PAT gets
`403 pat_forbidden`, so an agent cannot clear the pause that stopped it.

| Method | Path                                                | Auth                  | Request          | Response              |
| ------ | --------------------------------------------------- | --------------------- | ---------------- | --------------------- |
| `POST` | `/boards/:id/agent-sessions/:sessionId/pause`       | board `ADMIN` session | `AgentPauseDto`  | `AgentSessionDto`     |
| `POST` | `/boards/:id/agent-sessions/:sessionId/resume`      | board `ADMIN` session | `AgentPauseDto`  | `AgentSessionDto`     |
| `POST` | `/boards/:id/agents/pause`                          | board `ADMIN` session | `AgentPauseDto`  | `BoardAgentPauseDto`  |
| `POST` | `/boards/:id/agents/resume`                         | board `ADMIN` session | `AgentPauseDto`  | `BoardAgentPauseDto`  |
| `POST` | `/users/me/tokens/:id/pause`                        | owner session         | `AgentPauseDto`  | `UserTokenDto`        |
| `POST` | `/users/me/tokens/:id/resume`                       | owner session         | `AgentPauseDto`  | `UserTokenDto`        |
| `POST` | `/agents/pause-all`                                 | owner session         | `AgentPauseDto`  | `AgentStopAllPauseDto` |
| `POST` | `/agents/resume-all`                                | owner session         | `AgentPauseDto`  | `AgentStopAllPauseDto` |

`AgentPauseDto` is optional `{ reason?: string }` (500 characters). The reason
is stored on the session/board stamp; the token and stop-all reasons go to
`SecurityAuditLog`. `pauseScope` precedence is **token → board → session**:
a token paused by `individualPausedAt` or `stopAllPausedAt` wins over a board
pause, which wins over a session pause. `resume-all` clears only
`stopAllPausedAt` and does **not** clear an individual token pause; a token
stays paused while at least one source is active.

Every PAT write blocked by a pause answers `403` with a stable code:

```json
{
  "message": "Agent access is paused at the board level; resume it before writing",
  "code": "agent_paused",
  "retryable": false,
  "pauseScope": "board",
  "scope": "board",
  "pausedAt": 1762764000000
}
```

The block covers commands (single and batch), comments, attachment upload and
delete, claims, board member/share changes and other board writes. GET reads
stay allowed, and the control plane stays open: `heartbeat`, `end` and
`GET /boards/:id/agent-sessions/:id` work while paused so an agent can finish
cleanly. Pause is evaluated before the board role, token scope and destructive/
approval gates: a paused agent gets `agent_paused`, not `scope_denied`,
`pat_read_only` or `approval_required`. Pause does not release a claim. Ending a
session or revoking its token releases the session/token claims.

Pause is checked at the request boundary and again inside the board-write
transaction after the advisory lock. A request that passed the second check
finishes and commits; a pause that committed before it is refused. The same
second read rejects a token revoked or expired (or a disabled owner) and a
session that ended before the lock, so a queued write cannot outlive an
`end_session` or `DELETE /users/me/tokens/:id`. On the next
SSE keep-alive a PAT stream receives
`{ "type": "agent", "op": "paused", "scope": "...", "at": ... }` and closes.
Session pause closes only a stream opened with `?session=<sessionId>`; a
reconnect during an active pause gets `403 agent_paused`. Human SSE streams are
not closed. A token or stop-all pause also publishes a `scope: "token"` frame
to the boards where that token has a live session, so Board Live refreshes
without polling; human streams still stay open.

`DELETE /users/me/tokens/:id` is the irreversible kill. It revokes the key, marks
its open sessions `cancelled`, releases the claims held by `claimedByTokenId`
(legacy claims without a token id wait for their lease) and closes the token's
SSE on the next tick. New requests with the key get `401`.

## Token scopes and the destructive gate

Every PAT carries a scope preset. A new key defaults to `worker`. The owner
can update `scopePreset` on an existing key from Account → API keys or through
`PATCH /users/me/tokens/:id` in a browser session. The deprecated `readOnly`
compatibility flag always yields effective `observer`.

| Preset     | Read | Ordinary content write | Done transition (`reviewer`) | Destructive | Board administration |
| ---------- | ---- | ---------------------- | ---------------------------- | ----------- | -------------------- |
| `observer` | yes  | no                     | no                           | no          | no                   |
| `worker`   | yes  | yes                    | no                           | approval / `trustedCi` | no       |
| `reviewer` | yes  | yes                    | yes                          | approval / `trustedCi` | no       |
| `admin`    | yes  | yes                    | yes                          | approval / `trustedCi` | yes      |

A preset never raises the board role: an `admin` key owned by a MEMBER cannot
manage members, and a `worker` key owned by an ADMIN cannot delete a card
without approval. Destructive actions require a human approval unless the key
has `trustedCi`; `Board.agentPolicy.destructive = "deny"` is a hard block that
even `trustedCi` cannot bypass. Approval does not raise scope: a `worker` key
that needs `admin` gets `scope_denied`, not `approval_required`.

Board-scoped keys are limited to their board and cannot create or import
boards. Account routes (profile writes, key management, invitations, exports)
and their sensitive reads require a browser session.
Identity reads (`GET /auth/me`, avatar) remain available.

Error codes are additive and stable:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `scope_denied` | 403 | the preset/board role does not allow the action; preset denial carries `requiredScope`/`action`, board-role denial `requiredRoles`, and a board-scoped token on another board `reason: "board_scope"` |
| `destructive_denied` | 403 | the board policy is `destructive: "deny"`; `reason: "board_policy"` |
| `approval_required` | 409 | a destructive action has no approval; the request is created and nothing is applied; carries `approvalId`, `planHash`, `expiresAt` |
| `approval_expired` | 409 | the approval expired before decision/apply; carries `approvalId`, `expiresAt` |
| `approval_mismatch` | 409 | the plan/planHash or kind does not match; carries `approvalId` and the hash prefixes |
| `approval_target_mismatch` | 409 | an explicit `cardId` disagrees with the single card named by the plan; nothing is created |
| `approval_owner_mismatch` | 403 | the approval belongs to another token/agent session |
| `approval_not_pending` | 409 | a decision/cancel/apply hit a non-pending state; carries `status` |
| `approval_rejected` / `approval_cancelled` | 409 | the request was rejected/cancelled; applying it is refused |
| `approval_consumed` | 409 | the approval was already applied; carries `runId` when known |
| `pat_forbidden` | 403 | an account route is session-only |
| `agent_paused` | 403 | a session, token or board pause blocks the write; `pauseScope`/`pausedAt`, `retryable: false` |
| `pat_read_only` | 403 | legacy read-only key refused a write |

## Personal API tokens

Token management is account self-service and requires a browser session.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/users/me/tokens` | none | `UserTokenDto[]` |
| `POST` | `/users/me/tokens` | `CreateUserTokenDto` | `{ token, apiToken }` |
| `PATCH` | `/users/me/tokens/:id` | `UpdateUserTokenDto` | `UserTokenDto` |
| `DELETE` | `/users/me/tokens/:id` | none | `{ status: "ok" }` |
| `POST` | `/users/me/tokens/:id/pause` | `AgentPauseDto` | `UserTokenDto` |
| `POST` | `/users/me/tokens/:id/resume` | `AgentPauseDto` | `UserTokenDto` |

A new token defaults to `worker`. PATCH accepts `name`, `scopePreset`,
`boardId`, `readOnly`, `rateLimitPerMinute` and `trustedCi`. Omitted fields
keep their values, and `null` clears the board or rate limit. Validation
strips `expiresAt` and other unknown fields, so the stored expiry stays
unchanged. The plaintext key appears once in the create response. PATCH on a
revoked key returns `409 token_revoked`. Revocation cancels open sessions,
releases the token's claims and closes its SSE streams.

## Approvals

An approval authorizes one exact plan; it does not apply anything by itself.
The agent creates a request with its PAT, a human board ADMIN decides it in a
browser session, and the agent repeats the same plan with the returned id.

| Method | Path | Auth / role | Request | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/boards/:id/approvals` | PAT, board member | `CreateApprovalRequest` | `ApprovalRequestDto` |
| `GET` | `/boards/:id/approvals` | board ADMIN or requesting PAT | `status`, `kind`, `cardId`, `limit` | `ApprovalRequestDto[]` |
| `GET` | `/boards/:id/approvals/:approvalId` | board ADMIN or requesting PAT | none | `ApprovalRequestDto` |
| `POST` | `/boards/:id/approvals/:approvalId/decision` | session-only board ADMIN | `{ decision, planHash, comment? }` | `ApprovalRequestDto` |
| `POST` | `/boards/:id/approvals/:approvalId/cancel` | requesting PAT or board ADMIN | none | `ApprovalRequestDto` |

The body of `POST /boards/:id/approvals` is
`{ kind, cardId?, ttlMinutes?, plan }`, where `kind` is `destructive`, `done` or
`custom`, and `plan` is either `{ schemaVersion: 1, boardId, commands }` or
`{ schemaVersion: 1, boardId, operations }` (exactly one). `commands` use the
same validator and limits as `/commands/batch` (100 commands, 50 card creates by
default); `operations` contain exactly one whitelisted lifecycle operation
(`board.delete`, `member.*`, `share.*`, `attachment.delete`). `action.at` and
the action-level `boardId` are not part of the intent: the server strips them
before computing `planHash = sha256(canonicalJson({schemaVersion, boardId,
commands|operations}))`, so the same body always hashes identically. The server
returns the hash; a client-supplied hash is not accepted.

If a destructive command/batch or lifecycle REST call arrives without
`X-Approval-Id`, the server creates the same request for the exact plan and
answers `409 approval_required` with `approvalId`, `planHash` and `expiresAt`;
nothing is applied. The preset must already allow the action after approval: a
`worker` key cannot turn a board-delete plan into an approval (it gets
`scope_denied`), and `destructive: "deny"` is a hard `403 destructive_denied`
with no row created.

To apply, repeat the identical plan/commands with `X-Approval-Id: <id>` on
`POST /commands`, `/commands/batch` or the original lifecycle route.
`requestedByTokenId` must match the current PAT; if the request recorded an
agent session, `X-Agent-Session` must match too. A consumed approval is
one-time: the same applied commands are an idempotent replay, a different plan
gets `approval_mismatch` or `approval_consumed`. An authorized
`approval_mismatch` includes the stored `plan`. Batch/command application
creates an `AgentRun` with `approvalId`, stamps `runId` on every command and
writes `approval_consumed`; a lifecycle operation leaves `runId` null.
Requesting an identical consumed lifecycle plan in the same board, token and
agent session scope returns `409 approval_consumed`. The
decision endpoint is session-only, so a PAT gets `pat_forbidden` — the human
token owner approves their agent's request, the agent never approves itself.

TTL is `min(ttlMinutes ?? policy.approvalTtlMinutes, policy.approvalTtlMinutes)`
with a five-minute floor. Overdue pending requests transition to `expired`
on access or during the scheduled `sweep-approvals` job. A retained
`approved` row keeps the historical decision after its apply window ends,
and apply returns `409 approval_expired`. Submit the same plan again to
create a fresh pending request. Ending an agent session cancels its open
requests and approvals still within the apply window. Token revocation
cancels the corresponding requests as well. Decisions write activity and
`SecurityAuditLog` records and publish `approval` SSE frames.

The sweep also removes rejected, cancelled, expired, consumed and lapsed
approved requests after the configured retention window. For lapsed approved
requests the window starts at `expiresAt`. See
[retention settings](/docs/admin/settings/#soft-deleted-data-and-retention).

The browser Inbox uses
`GET /agents/overview?section=approvals&boardId=<id>`. Use
`status=pending` or `status=decided` for independent queues, and follow
`nextCursor` with the same filters. `total` counts matching rows before
pagination. `matchingCounts` applies search and scope filters across all
statuses, and `counts` supplies unfiltered scope totals. The Board Inbox
header count reflects TTL expiry on the next 30-second poll while visible.

Global Attention subscribes to approval SSE for the first four boards and
adds the board in scope or the board of the selected approval when needed.
Other boards update on the 30-second poll while visible. Password resets,
password changes and OAuth account takeovers cancel actionable approvals for
revoked tokens in the credential transaction. Those cancellations can also
reach the browser on the next poll.

Browser sessions do not pass through the preset/destructive gate; their board
role rules are unchanged (including ordinary undo). A PAT can never send
`RESTORE_*` commands (`scope_denied`) — an agent uses compensating edits or asks
a human to revert a run.

## Plans

A plan is a dry-run first and an atomic apply of exactly the previewed intent
afterwards. Both routes are board writes: `ADMIN`/`MEMBER` and a `worker` (or
higher) token preset. A plan may contain at most
`min(100, policy.maxCommandsPerRun)` commands and
`min(50, policy.maxCardsPerRun)` card creates (`ADD_CARD`, `DUPLICATE_CARD`,
`DUPLICATE_COLUMN`); a larger plan is `409 limit_exceeded` and the client
splits the work into several plans. There is deliberately no cross-plan
atomicity.

| Method | Path | Auth / role | Request | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/boards/:id/plans` | board `ADMIN`/`MEMBER`, `worker` preset | `{ commands, clientRunId? }` | `PlanPreviewDto` |
| `POST` | `/boards/:id/plans/apply` | same; optional `X-Approval-Id` | `{ commands, planHash, clientRunId? }` | `PlanApplyResponse` |

`commands` is the same array `/commands/batch` accepts and goes through the
same validator, WIP/workflow/version checks, scope preset and destructive
classification. `action.at` and the action-level `boardId` are transport
context, not intent: the server strips them and computes
`planHash = sha256(canonicalJson({ schemaVersion: 1, boardId, commands }))`
with recursively sorted keys, array order preserved and no spaces. The
preview returns the hash; a client hash is never trusted on its own.

`POST /boards/:id/plans` writes nothing: it does not create a command, an `AgentRun` or
an `ApprovalRequest`. It replays the reducer in memory and returns:

- `planHash` and the canonical `plan` (the commands without `at`/`boardId`);
- `diff` — net `create`/`update`/`delete` changes with the touched `card:`/
  `column:`/`label:`/`board:` entity, the full state for a create/delete and
  the changed fields for an update;
- `warnings` — `approval_required`, `destructive`, `reviewer_required`,
  `no_op`;
- `conflicts` — `version`, `wip`, `workflow`, `id`, `scope`,
  `destructive_denied` or `invalid`, with the command `index` and
  `currentVersion` where known;
- `requirement` (kind/scope/risk/summary), effective `limits` and `canApply`.

`POST /boards/:id/plans/apply` requires the exact preview `planHash`. A changed plan is
`409 approval_mismatch` with `expectedPlanHash`/`actualPlanHash` prefixes and
the `approvalId` when a header was sent. Apply then behaves exactly like
`/commands/batch`: one board lock, one transaction, all-or-nothing, results in
command order, idempotent by `commandId`, and `409 idempotency_conflict` for a
reused key with another body. A destructive plan without `X-Approval-Id`
creates the exact approval request and answers `409 approval_required`
without partial application; with an approved id it applies and consumes the
approval once. A retry of the same applied commands is an idempotent replay.

A PAT plan creates one `AgentRun` (`kind: "plan"`, the `planHash` and optional
`clientRunId`), stores a pre-image for every command and returns
`{ runId, results, planHash }` plus `X-Run-Id`; that run can be inspected with
`GET /runs` and reverted by a human board ADMIN. A browser plan creates no run
(its history is the ordinary UI undo). A plan never spans boards.

```json
{
  "commands": [
    {
      "commandId": "cmd-1",
      "action": {
        "type": "ADD_CARD",
        "newCardId": "card-1",
        "columnId": "col-1",
        "title": "Bulk card"
      }
    }
  ],
  "planHash": "8f14e45fceea167a5a36dedd4bea2543…"
}
```

## Runs and rollback

A run groups the commands of one PAT batch, one single destructive PAT command,
one plan apply or one human revert for audit and rollback. It belongs to one
board. A browser batch and ordinary non-destructive browser edits create no run
(their history is the UI undo stack).

| Method | Path | Auth / role | Request | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/boards/:id/runs` | member (`observer`+) | `status`, `kind`, `apiTokenId`, `agentSessionId`, `clientRunId`, `from`, `to`, `limit`, `cursor` | `RunSummaryDto[]` |
| `GET` | `/boards/:id/runs/:runId` | member; pre-images only board `ADMIN` browser session | none | `RunDetailDto` |
| `POST` | `/boards/:id/runs/:runId/revert/preview` | member, dry run | none | `RevertPreviewDto` |
| `POST` | `/boards/:id/runs/:runId/revert` | session-only board `ADMIN` when `dryRun` is false or omitted | `RevertRunDto` | `RunDetailDto` |
| `POST` | `/boards/:id/runs/:runId/revert` | member when `{ "dryRun": true }` | `RevertRunDto` | `RevertPreviewDto` |

`RunSummaryDto` carries `id`, `boardId`, `apiTokenId`, `agentSessionId`,
`actorId`, `kind` (`batch`, `plan`, `single`, `revert`), `status` (`applied`,
`reverted`; a failed transaction rolls back and creates no run), `clientRunId`, `planHash`, `approvalId`, `commandCount`,
`firstSeq`/`lastSeq`, `revertsRunId`, `createdAt`, `appliedAt` and
`revertedAt`. Detail adds the command timeline and `preimages`. A PAT sees the
summary and commands but **not** the before-state snapshots, even when its owner
is a board ADMIN.

```json
{
  "id": "run-01",
  "boardId": "board-1",
  "apiTokenId": "tok-1",
  "agentSessionId": "sess-1",
  "actorId": "user-1",
  "kind": "batch",
  "status": "applied",
  "clientRunId": "nightly-import-1",
  "planHash": null,
  "approvalId": null,
  "commandCount": 12,
  "firstSeq": 101,
  "lastSeq": 112,
  "revertsRunId": null,
  "createdAt": 1762764000000,
  "appliedAt": 1762764000000,
  "revertedAt": null
}
```

The preview returns `{ dryRun: true, run, conflicts, canRevert }`; `diff` is
present only for a board ADMIN browser session. A conflict names the `touch`,
the `expectedVersion` recorded when the run applied and the
`currentVersion` now. A real revert is all-or-nothing, re-checks conflicts under
the board lock, is allowed once per run (no revert of a revert) and creates a
new `kind: "revert"` run with `revertsRunId`; the original becomes `reverted`.
`409 run_conflict` means the run state forbids it and carries `runId` plus the
board `currentVersion`; `409 run_expired` means commands/pre-images were swept
by retention and carries `runId` plus `retentionDays`. A `commandId` is required
for a real revert so a network retry is idempotent; omitting it is a
`400 validation_failed` naming `commandId`. A read-only PAT may call the
generic `revert` route with `{ "dryRun": true }`; a real revert stays
PAT-forbidden (`403 pat_forbidden`).

## Board agent policy

The board policy is human-controlled. Both routes are session-only board
`ADMIN`. Authentication and board access checks run before the session check.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/boards/:id/agent-policy` | none | `BoardAgentPolicyStateDto` |
| `PATCH` | `/boards/:id/agent-policy` | `{ policy, version }` | `BoardAgentPolicyStateDto` |

`policy: null` means the stored value is absent and safe defaults apply; the
response always carries the effective policy, the `agentPolicyVersion` CAS token
and the current pause state. `PATCH` requires the current `version`; a stale
value is `409 version_conflict` with `details.currentVersion`. `policy: null`
restores the defaults. Limits are validated strictly:

```json
{
  "schemaVersion": 1,
  "destructive": "approval",
  "requireApprovalFor": [
    "member.invite",
    "member.remove",
    "share.create",
    "share.revoke",
    "attachment.delete",
    "delete_board"
  ],
  "approverRoles": ["ADMIN"],
  "maxCommandsPerRun": 100,
  "maxCardsPerRun": 50,
  "approvalTtlMinutes": 60
}
```

`destructive` is `approval` or `deny` (hard block, no approval row);
`maxCommandsPerRun` is 1–100, `maxCardsPerRun` 1–50 and
`approvalTtlMinutes` 5–1440. Every policy change writes an Activity row and a
`SecurityAuditLog` entry.

## Attachments

Files are uploaded over REST as `multipart/form-data` with a single `file`
part. `CardAccessGuard` resolves the owning board from the card or attachment.

| Method   | Path                                   | Auth / role        | Response           |
| -------- | -------------------------------------- | ------------------ | ------------------ |
| `POST`   | `/cards/:cardId/attachments`           | `ADMIN` / `MEMBER` | `AttachmentDto`    |
| `GET`    | `/cards/:cardId/attachments`           | member             | `AttachmentDto[]`  |
| `GET`    | `/attachments/:attachmentId/content`   | member             | blob bytes         |
| `GET`    | `/attachments/:attachmentId/thumbnail` | member             | image bytes        |
| `GET`    | `/attachments/:attachmentId/poster`    | member             | image bytes        |
| `DELETE` | `/attachments/:attachmentId`           | `ADMIN` / `MEMBER` | `{ status: "ok" }` |

`POST` accepts `?inline=1` (or `?inline=true`) to mark the blob as
body-embedded media: hidden from the list, no counter and no activity. The
`?description=1` option marks a file pasted into a description: it appears in
the list when referenced and is hidden when no live description or comment
references it. Hidden files remain accessible and count toward the limit, so
description undo/redo and existing snapshots can restore them. Use
`GET /cards/:cardId/attachments?detached=1` to list hidden files for cleanup.
The options
are mutually exclusive; `inline` takes precedence. The
file is at most `LIMITS.attachmentSize` (25 MB). The server enforces a MIME
allowlist and sniffs the magic bytes for image, video, audio and archive
types; a client that declares one of those types but uploads unrecognizable
bytes answers `400`. A card at `LIMITS.attachmentsPerCard` (20) live
attachments answers `400`.

`GET /attachments/:attachmentId/content` streams the blob with
`Content-Disposition: attachment`. The response is range-aware: a `Range`
header yields `206` with `Content-Range`, and an unsatisfiable range yields
`416`.

`GET .../thumbnail` serves the generated preview (`image/jpeg`) when ready,
otherwise the original blob for images. A video has no thumbnail, and a
non-image without a generated thumbnail answers `404`.

`GET .../poster` serves the first meaningful frame of a video (`image/jpeg`).
When none was generated it answers `404`.

## Managing public share links

A share is its own entity (token, mode, privacy flags, TTL, revoke). Owner
management is nested under the board and gated to `ADMIN`.

| Method   | Path                                  | Auth / role | Request          | Response          |
| -------- | ------------------------------------- | ----------- | ---------------- | ----------------- |
| `GET`    | `/boards/:id/shares`                  | `ADMIN`     | none             | `BoardShareDto[]` |
| `POST`   | `/boards/:id/shares`                  | `ADMIN`     | `CreateShareDto` | `BoardShareDto`   |
| `POST`   | `/boards/:id/shares/:shareId/refresh` | `ADMIN`     | none             | `BoardShareDto`   |
| `PATCH`  | `/boards/:id/shares/:shareId`         | `ADMIN`     | `UpdateShareDto` | `BoardShareDto`   |
| `DELETE` | `/boards/:id/shares/:shareId`         | `ADMIN`     | none             | `BoardShareDto`   |
| `DELETE` | `/boards/:id/shares/:shareId/permanent` | `ADMIN` | none | `204`, empty |

A share's `mode` is `snapshot` or `live`. A snapshot freezes the board at
creation and survives the board being deleted; a board admin can refresh it.
A live share reads the board as it is now and follows it over SSE.

`POST` generates a random token (16 bytes, base64url). `includeComments` defaults
to `true` for a live share and `false` for a snapshot; `includeAttachments`
defaults to `false`. Supply a future `expiresAt` or a relative `expiresInHours`.
When both are supplied, the relative duration takes precedence. A supplied
non-null `expiresAt` is always validated as ISO-8601. Owner responses include
`effectiveIncludeComments` and `effectiveIncludeAttachments` alongside the
configured flags. For a snapshot, the effective flags show which content
categories are available publicly.

`POST .../refresh` re-freezes a snapshot share; a live share answers `400`
before any approval is created. It is a `share.update` lifecycle action: a PAT
on a board whose policy requires approval gets `409 approval_required` with
`approvalId`/`planHash`, and the retry must carry `X-Approval-Id`. An applied
refresh is written to the board-share audit log. The approval is one-shot; a
replay answers `409 approval_consumed`. Snapshot creation and refresh reject
more than 500 captured files or 100 MiB with `413 snapshot_attachment_limit`.
They return `413 snapshot_comment_limit` for captures exceeding 1,000 comments
or 10 MiB of UTF-8 comment JSON.
A rejected refresh keeps the previous capture.

When public sharing is disabled (`ALLOW_PUBLIC_SHARES=false` or the
`public_shares` flag), creation and refresh answer `404` before approvals or
idempotency records are touched.

`PATCH` writes a `BoardShareAuditLog` row with action `updated`; `POST
.../refresh` writes `refreshed`, and revoking writes `revoked`. A master's
hard-delete of a revoked share is also recorded in the master audit log as
`share.revoked`.

`DELETE` revokes a share: its token stops resolving at once. Revoking is
idempotent. `DELETE .../permanent` removes a previously revoked share. A PAT
needs the `admin` preset and follows the `share.delete` approval policy.

A `:shareId` that does not belong to the board answers `403`; an unknown one
answers `404`.

## Public share endpoints

The public API is read-only and does not require a user JWT. `ShareAccessGuard`
checks the link token, expiry, revocation and the `ALLOW_PUBLIC_SHARES` setting.
The server returns the same `404` response for an unknown, revoked, expired or
disabled link. The read
responses carry `X-Robots-Tag: noindex, nofollow`.

The public API has a per-token rate limit: 240 requests per minute per token
(`SHARE_RATE_LIMIT`), and 60 per minute for the OG preview
(`SHARE_OG_RATE_LIMIT`). Exceeding it answers `429`.

| Method | Path                                              | Response          |
| ------ | ------------------------------------------------- | ----------------- |
| `GET`  | `/share/:token`                                   | `PublicBoardDto`  |
| `GET`  | `/share/:token/events`                            | SSE stream        |
| `GET`  | `/share/:token/og.png`                            | `image/png`       |
| `GET`  | `/share/:token/cards/:cardId/comments`            | `CommentPage`     |
| `GET`  | `/share/:token/cards/:cardId/attachments`         | `AttachmentDto[]` |
| `GET`  | `/share/:token/attachments/:attachmentId/content` | blob bytes        |
| `POST` | `/share/:token`                                   | `405`             |
| `POST` | `/share/:token/{*rest}`                           | `405`             |

`GET /share/:token` returns the whole public payload: the board (the live
aggregate or the frozen snapshot), a sanitized member roster with no emails,
and the share's privacy flags. It counts one view. A live share whose board
is gone answers `410`. A snapshot's board and roster remain available after
source deletion. Live aggregate reads can return `503` when the process
has reached its concurrent rebuild limit.

`GET /share/:token/events` is live mode only; a snapshot answers `404`. It
streams `command` frames and, when `includeComments` is set, `activity`
frames. Presence and membership frames are dropped, so a public viewer does not
receive member-presence events. The `?since=` delta catch-up mirrors the member
stream,
including the `resync` frame. A live board that is gone answers `410`. An open
stream re-checks the share on every keep-alive tick and closes once the share
is revoked or expired, public sharing is switched off, or the board is gone.

`GET /share/:token/og.png` returns a deterministic board preview PNG.

`GET .../comments` and `GET .../attachments` answer `404` when the share does
not expose comments or attachments respectively. A card that is not on the
shared board answers `404`.

A snapshot serves the captured versions of its opted-in comments, attachment
metadata and attachment files. Later edits, additions, removals, board
archival and board deletion (including permanent purge) leave those versions
available. A file or card absent at capture answers `404`. Turning an
inclusion flag off hides that category immediately. Enabling a category that
was absent at capture requires a refresh before it is public. Legacy
board-only snapshots can still show eligible source comments and files
created by the snapshot's capture time while the board and source rows are
available. Soft-deleting the source board disables this fallback. Refreshing
a legacy snapshot while the source is accessible saves independent copies.

`POST /share/:token` and any nested `POST` answer `405` with
`"Shared boards are read-only"`. The public API states its read-only rule
rather than relying on the absence of a route.

## Realtime

| Method | Path                   | Auth / role | Request                 | Response     |
| ------ | ---------------------- | ----------- | ----------------------- | ------------ |
| `GET`  | `/boards/:id/events`   | member      | query `since`, `client` | SSE stream   |
| `POST` | `/boards/:id/presence` | member      | `PresencePingDto`       | `204`, empty |

`GET /boards/:id/events` is the server-sent event stream. Auth is the Bearer
token (an access token or a personal API token); any role, `VIEWER` included,
may connect. The stream delivers the board's command log exactly once and in
order, or tells the client to resync; it never leaves a silent hole:

- **Catch-up.** The connection replays the command-log delta from `?since=`
  (the client's last applied `seq`). Live frames that arrive meanwhile are
  buffered, then drained deduplicated by `seq`.
- **Resync.** When the gap cannot be replayed faithfully (more than 5000
  commands, or `since` was trimmed from the log), the stream sends
  `{ "type": "resync" }` instead of a partial history, then continues from the
  board's current head. The client must re-read the board with
  `GET /boards/:id`.
- **Gaps.** If a live frame shows that an earlier one was lost or reordered
  on the way (for example between nodes), the stream re-reads the missing
  commands from the log rather than deliver out of order.

A keep-alive comment `ping` is sent every 25 seconds. On the same tick the
server re-checks the caller and closes the stream when access is gone: the
membership was removed or no longer accepted, a `VIEWER`'s access expired,
the account was disabled, the board was deleted, or the stream was opened
with a personal API token that has since been revoked or has expired.

`?client=` is an optional tab-scoped id matching `^[A-Za-z0-9_-]{8,64}$`.
When omitted or malformed, the server generates one.

The stream carries six event types:

| `type`       | Payload                                                        | Notes                                          |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| `command`    | `seq`, `action`, `actorId`, `actorType?`, `commandId`, `touches`, `apiTokenId?`, `agentSessionId?`, `runId?`, `agentName?` | a committed command                            |
| `presence`   | `users[]`                                                      | who is connected; no `seq`                     |
| `membership` | `boardId`, `userId`, `change`                                  | `change` is `accepted`, `updated`, `removed` (admin) or `left` (voluntary) |
| `activity`   | `id`, `boardId`, `cardId?`, `actorId`, `actorType?`, `at`, `kind`, `detail?`, `apiTokenId?`, `agentSessionId?`, `runId?`, `agentName?` | non-reducer activity, e.g. a new comment |
| `agent`      | `op` (`started`, `paused`, `resumed`, `heartbeat`, `ended`), `sessionId?`, `scope?`, `at` | agent-session control-plane transition; `heartbeat` is a throttled session liveness refresh |
| `resync`     | none                                                           | the gap cannot be replayed; refetch the board  |

`commandId` is the idempotency key sent with the command. A client uses it to
recognise its own echo even when commands come from multiple tabs or agents
using the same account.

`actorType` is `"human"` for a browser session and `"agent"` for a personal API
token; it is omitted on frames written before the field existed, so treat a
missing value as `"human"`. The card history marks agent entries with an
"Agent" badge.

When the caller is removed by an admin or leaves voluntarily, the server sends
the `membership` frame as the last one and closes the stream.

`POST /boards/:id/presence` is the heartbeat. The SSE stream has no back
channel, so a tab proves liveness with this ping every 25 seconds; a session
that stops pinging is swept after 60 seconds. The body carries the `clientId`
the stream was opened with. A ping only refreshes a session the caller owns.
The response is `204` with an empty body.

## DTO catalog

Field presence and nullability are specified separately:

- `required`: the key must be present.
- `optional`: the key may be omitted.
- `nullable`: the key accepts an explicit JSON `null`.

### CreateBoardDto

| Field   | Type   | Required | Constraints                       |
| ------- | ------ | -------- | --------------------------------- |
| `title` | string | required | non-empty, at most 100 characters |

```json
{ "title": "Roadmap" }
```

### InviteMemberDto

| Field       | Type           | Required           | Constraints                                                  |
| ----------- | -------------- | ------------------ | ------------------------------------------------------------ |
| `email`     | string         | required           | valid email; trimmed and lowercased                          |
| `role`      | string         | required           | one of `ADMIN`, `MEMBER`, `VIEWER`                           |
| `expiresAt` | string or null | optional, nullable | ISO-8601; honored for `VIEWER` only; omitted means unbounded |

```json
{
  "email": "dev@example.com",
  "role": "VIEWER",
  "expiresAt": "2026-12-31T00:00:00.000Z"
}
```

### UpdateMemberDto

| Field       | Type           | Required           | Constraints                                                                |
| ----------- | -------------- | ------------------ | -------------------------------------------------------------------------- |
| `role`      | string         | optional           | one of `ADMIN`, `MEMBER`, `VIEWER`                                         |
| `expiresAt` | string or null | optional, nullable | ISO-8601; `null` clears a `VIEWER` expiry; omitted keeps the current value |

```json
{ "role": "MEMBER" }
```

### CreateCommentDto

| Field       | Type   | Required | Constraints                                                |
| ----------- | ------ | -------- | ---------------------------------------------------------- |
| `text`      | string | required | non-empty, at most 10000 characters; may contain explicit mention links |
| `kind`      | string | optional | one of `note`, `status`, `question`, `blocker`, `evidence`, `handoff` (default `note`) |
| `commandId` | string | optional | at most 64 characters, `^[A-Za-z0-9_-]+$`; idempotency key |

```json
{ "text": "Looks good", "kind": "evidence", "commandId": "c-1" }
```

### CommentRevisionDto

| Field            | Type           | Required | Constraints                                                   |
| ---------------- | -------------- | -------- | ------------------------------------------------------------- |
| `id`             | string         | required | revision id                                                   |
| `revisionNumber` | integer        | required | at least 1, monotonic per comment                             |
| `createdAt`      | integer        | required | Unix ms                                                       |
| `editorId`       | string or null | required | nullable                                                      |
| `editorName`     | string or null | required | current public display name; `null` if absent                 |
| `actorType`      | string         | required | `human`, `agent` or `admin`                                   |
| `agentName`      | string or null | required | nullable                                                      |
| `cause`          | string         | required | `author_edit`, `attachment_deleted` or `system`               |
| `beforeText`     | string         | required | snapshot before the edit                                      |
| `afterText`      | string         | required | snapshot after the edit                                       |

`CommentRevisionPage` is `{ items, nextCursor, historyIncomplete,
historyIncompleteReason }`; the last two fields describe the live comment on
every page.

### CreateShareDto

| Field                | Type           | Required           | Constraints                                              |
| -------------------- | -------------- | ------------------ | -------------------------------------------------------- |
| `mode`               | string         | required           | `snapshot` or `live`                                     |
| `title`              | string         | optional           | at most 100 characters                                   |
| `includeComments`    | boolean        | optional           | default `true` for `live`, `false` for `snapshot`        |
| `includeAttachments` | boolean        | optional           | default `false`                                          |
| `expiresAt`          | string or null | optional, nullable | ISO-8601 if non-null. Must be in the future when `expiresInHours` is absent |
| `expiresInHours` | integer | optional | 1–87,600 hours from creation. Takes precedence over `expiresAt` |

With both fields omitted, or an explicit `expiresAt: null` on its own, the link has no expiry.

```json
{ "mode": "live", "includeAttachments": true }
```

### UpdateShareDto

| Field                | Type           | Required           | Constraints                                          |
| -------------------- | -------------- | ------------------ | ---------------------------------------------------- |
| `title`              | string or null | optional, nullable | at most 100 characters                               |
| `includeComments`    | boolean        | optional           | omitted keeps the current value                      |
| `includeAttachments` | boolean        | optional           | omitted keeps the current value                      |
| `expiresAt`          | string or null | optional, nullable | ISO-8601; `null` clears the expiry; omitted keeps it |

```json
{ "includeComments": false }
```

### PlanRequest / PlanApplyRequest

| Field         | Type   | Required | Constraints                                                     |
| ------------- | ------ | -------- | --------------------------------------------------------------- |
| `commands`    | array  | required | 1–1000 items; the per-board cap is `min(100, policy.maxCommandsPerRun)` and answers `409 limit_exceeded` |
| `clientRunId` | string | optional | `^[A-Za-z0-9_-]{8,64}$`; the `AgentRun` idempotency key on apply |
| `planHash`    | string | required on apply | 64 hex characters from the preview                 |

Each command is `{ commandId, action, ifMatch?, ifMatchVersions? }`. `action`
is the reducer payload including `type`; `at` and `boardId` may be omitted.

### PresencePingDto

| Field      | Type   | Required | Constraints             |
| ---------- | ------ | -------- | ----------------------- |
| `clientId` | string | required | `^[A-Za-z0-9_-]{8,64}$` |

```json
{ "clientId": "tab-1234abcd" }
```

### Response types

The response bodies are the shared wire types. Key fields:

- `BoardSummary`: `id`, `title`, `archivedAt?`, `counters` (`{ cards, columns }`), `role`.
- `BoardAggregate`: the frontend `Board` (`id`, `title`, `columns[]`, `cards`
  map, `labels[]`, `createdAt`, `updatedAt`, `archivedAt?`).
- `BoardMemberDto`: `userId`, `displayName`, `email`, `role`, `expiresAt`,
  `avatarColor`, `avatarPath`. The invite response is masked (`userId: ""`,
  profile fields `null`).
- `CommentDto`: `id`, `cardId`, `authorId`, `text`, `createdAt`. `CommentPage`: `{ items, nextCursor }`.
- `AttachmentDto`: `id`, `cardId`, `fileName`, `mimeType`, `sizeBytes`,
  `uploadedById`, `createdAt`, `transcodeStatus`, `hasThumbnail`, `hasPoster`.
- `BoardShareDto`: `id`, `token`, `boardId`, `boardTitle`, `mode`, `title`,
  `includeComments`, `includeAttachments`, `expiresAt`, `revokedAt`, `views`,
  `lastViewedAt`, `createdAt`, `createdBy`.
- `PublicBoardDto`: `mode`, `title`, `takenAt`, `board`, `seq`, `members[]`,
  `includeComments`, `includeAttachments`. Members are `{ id, displayName,
  avatarColor, avatarPath }` with no emails.
- `BoardEnvelope`: `{ app, schemaVersion, exportedAt, boards[] }`.
- `DeletedBoardItemsDto`: `{ retentionDays, limit, items[], truncated }`.
  `items[]` is `{ type, id, title, deletedAt, purgeAt, columnTitle?, cardId?,
  cardTitle?, authorName?, sizeBytes? }`; `type` is `cards`, `columns`,
  `comments` or `attachments`.
- `PlanPreviewDto`: `{ dryRun: true, schemaVersion: 1, boardId, planHash,
  plan, commandCount, cardCreates, limits, requirement, diff, warnings,
  conflicts, canApply }`; `plan` is an `ApprovalPlan` with a `commands` array.
- `PlanApplyResponse`: `{ runId, planHash, results }` where `results` is one
  `CommandResponse` per command, in order.
- `AgentSessionDto`: `id`, `userId`, `apiTokenId`, `boardId`, `name`,
  `clientName`, `model`, `status`, `currentCardId`, `currentRunId`, `startedAt`,
  `lastHeartbeatAt`, `stale`, `paused`, pause stamps, `endedAt`, `endReason`,
  `summary`.
- `ApprovalRequestDto`: `id`, `boardId`, `cardId`, `requestedBy`,
  `requestedByTokenId`, `agentSessionId`, `kind`, `actionType`, `summary`,
  `risk`, `planHash`, `status`, `expiresAt`, `decidedBy`, `decidedAt`,
  `decisionComment`, `runId`, `consumedAt`, `createdAt`; detail adds `plan`.
- `RunSummaryDto` / `RunDetailDto`: the run fields listed above plus
  `commands[]` and, for a board ADMIN browser session, `preimages`.
- `BoardAgentPolicyStateDto`: `{ policy, effective, version, paused, pausedAt,
  pausedBy, pauseReason }`; `policy` is `null` when defaults are stored.
- `UserTokenDto`: `id`, `name`, `createdAt`, `lastUsedAt`, `expiresAt`,
  `revokedAt`, `boardId`, `readOnly`, `rateLimitPerMinute`, `scopePreset`,
  `trustedCi`, individual/stop-all pause stamps, `paused`,
  `effectiveTokenScope`.

## Errors

Every error below uses the shared [`code`/`message`/`retryable`/`requestId`
envelope](../#error-envelope). The status is still the HTTP status; `code`
names the cause.

| Status | When                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | validation failed, a blank required text, an invalid limit or expiry, an invalid or empty envelope, a rejected file                                       |
| `401`  | missing or invalid token                                                                                                                                  |
| `403`  | not a member; a role the route does not allow; an expired `VIEWER`; a share that does not belong to the board; a non-author deleting a comment            |
| `403`  | `code: "pat_forbidden"`: a personal API token on a session-only route                                                                                     |
| `404`  | unknown or soft-deleted board, card, comment, attachment or share; a disabled, revoked or expired public share; a thumbnail or poster that does not exist |
| `405`  | a write against the public share API                                                                                                                  |
| `408`  | `code: "request_timeout"`: the command was aborted before it could be applied; nothing was applied; `X-RateLimit-Queued-Ms` reports the queue wait |
| `409`  | inviting an accepted member; demoting or removing the last `ADMIN`; an expired invitation; a `commandId` reused on another card                           |
| `410`  | a live share whose board no longer exists                                                                                                                 |
| `413`  | a command payload over `MAX_COMMAND_BYTES`; an import over 25 MB; a command/plan body over 10 MB; any other JSON body over 256 KB (`code: "payload_too_large"`) |
| `416`  | an unsatisfiable `Range` on a blob                                                                                                                        |
| `429`  | a rate limit was exceeded; `code: "login_backoff"` during a login backoff                                                                                 |
| `503`  | `code: "rate_limited"` when a command had insufficient board tokens or a full per-board queue; retry after `Retry-After` with the same `commandId`                             |
| `503`  | maintenance mode; a failed health check; `code: "board_write_timeout"` when a board write timed out (safe to retry)                                       |
| `503`  | `POST /boards` after the board was created: `code: "starter_cleanup_failed"`, `"starter_read_failed"` or `"board_read_failed"` with `retryable: false` and `details.boardId`; open that board instead of creating another |
