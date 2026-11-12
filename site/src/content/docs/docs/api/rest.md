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

Every write accepts `X-Agent-Session: <sessionId>` when the caller is a PAT that
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
| `POST`   | `/boards/:id/members`         | `ADMIN`     | `InviteMemberDto` | `BoardMemberDto`   |
| `PATCH`  | `/boards/:id/members/:userId` | `ADMIN`     | `UpdateMemberDto` | `BoardMemberDto`   |
| `DELETE` | `/boards/:id/members/:userId` | `ADMIN`     | none              | `{ status: "ok" }` |
| `GET`    | `/boards/:id/export`          | member      | none              | `BoardEnvelope`    |
| `GET`    | `/boards/:id/search`          | member      | query `q`         | `{ cardIds: string[] }` |

`GET /boards` lists the boards where the caller is an accepted member, newest
first, each with a card and column counter and the caller's role. A pending
invitation does not count.

`POST /boards` creates a board with the caller as its first `ADMIN`. A blank
title answers `400`.

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

`GET /boards/:id` returns the board aggregate and sets an `X-Board-Seq`
response header carrying the command `seq` the aggregate reflects. A client
resumes the SSE stream from that value. An unknown or soft-deleted board
answers `404`. The aggregate carries `workflow` when the board has one.

`GET /boards/:id/search?q=` returns `{ cardIds }` — the cards whose title,
description, a checklist item or a comment contains `q` (case-insensitive
substring). It reaches comment text, which is not part of the board aggregate.
A query longer than 200 characters answers `400`.

`DELETE /boards/:id` soft-deletes the board and cascades the flag to its
children. Memberships are hard-deleted; live shares are revoked; snapshot
shares survive.

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

`PATCH /boards/:id/members/:userId` changes the role and/or the `VIEWER`
expiry. The last `ADMIN` of a board cannot be demoted, and the last `ADMIN`
cannot be removed: both answer `409`.

### Access order

Board-scoped routes answer in this order: a missing or invalid token is `401`;
an unknown or soft-deleted board is `404`; no membership is `403`; an expired
`VIEWER` membership is `403` and the stale row is dropped; a role not allowed
by the route is `403`.

Every route on this page accepts a personal API token as well as an access
token. Only the account-credential routes are session-only (see
[API reference](../#session-only-routes)).

## Comments

Comments are stored as Markdown strings and managed through REST. `CardAccessGuard` resolves the
owning board from the card or comment and enforces membership.

| Method   | Path                      | Auth / role        | Request            | Response           |
| -------- | ------------------------- | ------------------ | ------------------ | ------------------ |
| `POST`   | `/cards/:cardId/comments` | `ADMIN` / `MEMBER` | `CreateCommentDto` | `CommentDto`       |
| `GET`    | `/cards/:cardId/comments` | member             | query `cursor`, `limit`, `kind` | `CommentPage`      |
| `PATCH`  | `/comments/:commentId`    | `ADMIN` / `MEMBER` | `UpdateCommentDto` | `CommentDto`       |
| `DELETE` | `/comments/:commentId`    | `ADMIN` / `MEMBER` | none               | `{ status: "ok" }` |

`POST` takes no query parameters; the body is `CreateCommentDto`. A blank
text answers `400`, and an unknown `kind` answers `400`. When `commandId` is
supplied, a retry that reuses it returns the first comment instead of appending
a duplicate. A `commandId` already used on another card answers `409`.

`GET` accepts `?cursor=` (opaque), `?limit=` and `?kind=` (one comment kind).
The default limit is 50, the maximum is 100; a limit outside `1` to `100`
answers `400`, and an unknown `kind` answers `400`. Pages are newest-first and
`nextCursor` is `null` at the end.

`DELETE` removes a comment. Only the author may delete their own comment;
another author answers `403`.

`PATCH` edits the caller's own comment. The body is `{ "text": "..." }`
(non-blank, at most 10 000 characters). Only the author may edit; another
author answers `403`, a deleted comment `404`. `kind`, `authorId`,
attribution and `createdAt` stay as they were, `editedAt` is stamped (Unix ms
in `CommentDto`), and inline media removed from the text is soft-deleted.
The edit writes a `comment_updated` activity row and SSE frame.

Each write records an `Activity` row and publishes an `activity` SSE frame.

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
not closed.

`DELETE /users/me/tokens/:id` is the irreversible kill. It revokes the key, marks
its open sessions `cancelled`, releases the claims held by `claimedByTokenId`
(legacy claims without a token id wait for their lease) and closes the token's
SSE on the next tick. New requests with the key get `401`.

## Token scopes and the destructive gate

Every PAT carries one immutable preset. A new key is `worker`; existing keys
were grandfathered to `admin` + `trustedCi` (read-only keys keep effective
`observer`). The preset is chosen when the key is created and cannot be
changed: create a new key and revoke the old one. `readOnly` remains as a
deprecated compatibility flag and always wins, yielding `observer`.

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
and their sensitive reads are session-only: a PAT gets `403 pat_forbidden`.
Identity reads (`GET /auth/me`, avatar) remain available.

Error codes are additive and stable:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `scope_denied` | 403 | the preset/board role does not allow the action; preset denial carries `requiredScope`/`action`, board-role denial `requiredRoles`, and a board-scoped token on another board `reason: "board_scope"` |
| `destructive_denied` | 403 | the board policy is `destructive: "deny"`; `reason: "board_policy"` |
| `approval_required` | 409 | a destructive action has no approval; the request is created and nothing is applied; carries `approvalId`, `planHash`, `expiresAt` |
| `approval_expired` | 409 | the approval expired before decision/apply; carries `approvalId`, `expiresAt` |
| `approval_mismatch` | 409 | the plan/planHash or kind does not match; carries `approvalId` and the hash prefixes |
| `approval_owner_mismatch` | 403 | the approval belongs to another token/agent session |
| `approval_not_pending` | 409 | a decision/cancel/apply hit a non-pending state; carries `status` |
| `approval_rejected` / `approval_cancelled` | 409 | the request was rejected/cancelled; applying it is refused |
| `approval_consumed` | 409 | the approval was already applied; carries `runId` when known |
| `pat_forbidden` | 403 | an account route is session-only |
| `agent_paused` | 403 | a session, token or board pause blocks the write; `pauseScope`/`pausedAt`, `retryable: false` |
| `pat_read_only` | 403 | legacy read-only key refused a write |

## Personal API tokens

Token management is account self-service and browser-session only: a PAT gets
`403 pat_forbidden` on every route here.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/users/me/tokens` | none | `UserTokenDto[]` |
| `POST` | `/users/me/tokens` | `CreateUserTokenDto` | `{ token, apiToken }` |
| `PATCH` | `/users/me/tokens/:id` | `UpdateUserTokenDto` | `UserTokenDto` |
| `DELETE` | `/users/me/tokens/:id` | none | `{ status: "ok" }` |
| `POST` | `/users/me/tokens/:id/pause` | `AgentPauseDto` | `UserTokenDto` |
| `POST` | `/users/me/tokens/:id/resume` | `AgentPauseDto` | `UserTokenDto` |

A new token is `worker` by default. `scopePreset` (`observer`, `worker`,
`reviewer`, `admin`), `boardId`, `readOnly`, `rateLimitPerMinute`, `expiresAt`
and `trustedCi` are chosen at creation; `PATCH` edits every field except the
secret, and an omitted field keeps its value. The plaintext appears exactly
once in the create response. Revocation is the irreversible kill: it cancels
open sessions, releases token claims and closes the token SSE.

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
gets `approval_mismatch` or `approval_consumed`. Batch/command application
creates an `AgentRun` with `approvalId`, stamps `runId` on every command and
writes `approval_consumed`; a lifecycle operation leaves `runId` null. The
decision endpoint is session-only, so a PAT gets `pat_forbidden` — the human
token owner approves their agent's request, the agent never approves itself.

TTL is `min(ttlMinutes ?? policy.approvalTtlMinutes, policy.approvalTtlMinutes)`
with a five-minute floor. Expired rows are transitioned lazily on read,
decision and apply, and a maintenance sweep may finish the rest. Every step
writes an `Activity` row (`approval_requested`, `approval_approved`,
`approval_rejected`, `approval_cancelled`, `approval_expired`,
`approval_consumed`) and publishes an `approval` SSE frame; decision audit also
lands in `SecurityAuditLog` (`approval.decided`).

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

`POST /plans` writes nothing: it does not create a command, an `AgentRun` or
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

`POST /plans/apply` requires the exact preview `planHash`. A changed plan is
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
| `POST` | `/boards/:id/runs/:runId/revert` | session-only board `ADMIN` when `dryRun` is false | `RevertRunDto` | `RunDetailDto` |
| `POST` | `/boards/:id/runs/:runId/revert` | member when `{ "dryRun": true }` | `RevertRunDto` | `RevertPreviewDto` |

`RunSummaryDto` carries `id`, `boardId`, `apiTokenId`, `agentSessionId`,
`actorId`, `kind` (`batch`, `plan`, `single`, `revert`), `status` (`applied`,
`reverted`, `failed`), `clientRunId`, `planHash`, `approvalId`, `commandCount`,
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
`409 run_conflict` means the run state forbids it, `409 run_expired` that
pre-images were swept by retention. A `commandId` is required for a real revert
so a network retry is idempotent.

## Board agent policy

The board policy is human-controlled. Both routes are session-only board
`ADMIN`; a PAT gets `403 pat_forbidden`.

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

A share's `mode` is `snapshot` or `live`. A snapshot freezes the board at
creation and survives the board being deleted; a board admin can refresh it.
A live share reads the board as it is now and follows it over SSE.

`POST` generates a random token (16 bytes, base64url). `includeComments` defaults
to `true` for a live share and `false` for a snapshot; `includeAttachments`
defaults to `false`. An `expiresAt` in the past answers `400`.

`POST .../refresh` re-freezes a snapshot share. A live share answers `400`.

`DELETE` revokes a share: its token stops resolving at once. Revoking is
idempotent.

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
is gone answers `410`; a snapshot never depends on the board.

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

A snapshot share freezes the conversation too: its comments, attachment list
and attachment content include only what was created up to the moment the
snapshot was captured (or last refreshed). A later attachment answers `404`.

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
| `membership` | `boardId`, `userId`, `change`                                  | `change` is `accepted`, `updated` or `removed` |
| `activity`   | `id`, `boardId`, `cardId?`, `actorId`, `actorType?`, `at`, `kind`, `detail?`, `apiTokenId?`, `agentSessionId?`, `runId?`, `agentName?` | non-reducer activity, e.g. a new comment |
| `agent`      | `op` (`started`, `paused`, `resumed`, `ended`), `sessionId?`, `scope?`, `at` | agent-session control-plane transition |
| `resync`     | none                                                           | the gap cannot be replayed; refetch the board  |

`commandId` is the idempotency key sent with the command. A client uses it to
recognise its own echo even when commands come from multiple tabs or agents
using the same account.

`actorType` is `"human"` for a browser session and `"agent"` for a personal API
token; it is omitted on frames written before the field existed, so treat a
missing value as `"human"`. The card history marks agent entries with an
"Agent" badge.

When the removed user is the caller, the server sends the `membership` frame
as the last one and closes the stream.

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
| `text`      | string | required | non-empty, at most 10000 characters                        |
| `kind`      | string | optional | one of `note`, `status`, `question`, `blocker`, `evidence`, `handoff` (default `note`) |
| `commandId` | string | optional | at most 64 characters, `^[A-Za-z0-9_-]+$`; idempotency key |

```json
{ "text": "Looks good", "kind": "evidence", "commandId": "c-1" }
```

### CreateShareDto

| Field                | Type           | Required           | Constraints                                              |
| -------------------- | -------------- | ------------------ | -------------------------------------------------------- |
| `mode`               | string         | required           | `snapshot` or `live`                                     |
| `title`              | string         | optional           | at most 100 characters                                   |
| `includeComments`    | boolean        | optional           | default `true` for `live`, `false` for `snapshot`        |
| `includeAttachments` | boolean        | optional           | default `false`                                          |
| `expiresAt`          | string or null | optional, nullable | ISO-8601, must be in the future; omitted means no expiry |

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
| `409`  | inviting an accepted member; demoting or removing the last `ADMIN`; an expired invitation; a `commandId` reused on another card                           |
| `410`  | a live share whose board no longer exists                                                                                                                 |
| `413`  | a command payload over `MAX_COMMAND_BYTES`; an import over 25 MB; a command/plan body over 10 MB; any other JSON body over 256 KB (`code: "payload_too_large"`) |
| `416`  | an unsatisfiable `Range` on a blob                                                                                                                        |
| `429`  | a rate limit was exceeded; `code: "login_backoff"` during a login backoff                                                                                 |
| `503`  | maintenance mode; a failed health check; `code: "board_write_timeout"` when a board write timed out (safe to retry)                                       |
