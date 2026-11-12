---
title: API reference
description: Conventions, authentication and endpoint groups for the Janosik HTTP API.
---

The Janosik backend is a NestJS service. This page describes the conventions
shared by all routes, then lists the top-level endpoint groups. Changes to board
content use the [Command API](./commands/); other operations, including comments
and attachments, use REST, documented in [REST endpoints](./rest/).

The machine-readable contract is available as an
[OpenAPI 3.1 document](/openapi.yaml). It covers the complete agent-control
surface, the command/batch/plan write path, comments, attachments, membership,
shares and activity. Credential acquisition, public share routes, the master
`/admin` API, notifications and SSE are documented on this site instead.

## Base path and transport

Every route is served under the global prefix `/api/v1`. A route named
`POST /auth/login` in this reference is reached at
`POST /api/v1/auth/login`.

Requests and responses use JSON. Request bodies are limited to 256 KB by
default. Board import (`POST /boards/import`) accepts up to
`MAX_IMPORT_BYTES` (25 MB), while board commands
(`POST /boards/:id/commands`, `/commands/batch`, `/plans`, `/plans/apply`) and
administrative command routes accept up to `MAX_COMMAND_BODY_BYTES` (10 MB).
This allows large import envelopes and `RESTORE_*` snapshots to reach
validation without giving commands the import budget. Individual actions are
also limited to `MAX_COMMAND_BYTES` (2 MB) by the command service. A board
export above 25 MB (`MAX_BOARD_EXPORT_BYTES`) returns the same `413` with a
`pg_dump` hint instead of being truncated. If a body exceeds its limit, the
server returns `413` with `code: "payload_too_large"`.

File uploads use `multipart/form-data` with a single `file` part.

## Authentication

User-facing routes accept either credential in the `Authorization` header:

```
Authorization: Bearer <access-token>
Authorization: Bearer jnk_<43 base64url chars>
```

The first is a short-lived JWT access token from the auth endpoints. The
second is a personal API token (PAT): a value whose `jnk_` prefix tells the
guard to authenticate it against the `ApiToken` table instead of the JWT
strategy. Both open board-scoped routes identically.

An agent may attach `X-Agent-Session: <sessionId>` to a write. The server
verifies that the session belongs to the same user, token and board and is not
closed, then records `agentSessionId` on the command, comment or attachment.
A mismatch is `403 agent_session_invalid`; a closed session is
`403 agent_session_closed`. Sessions are created with
`POST /boards/:id/agent-sessions` (see [REST endpoints](./rest/#agent-sessions-and-attribution)).

### Token scopes

Every PAT has one immutable capability preset. A new key is `worker`; existing
keys were migrated to `admin` with `trustedCi: true` unless they were read-only.
A preset never raises the user's board role.

| Preset | Ordinary content write | Done transition | Destructive | Board administration |
| --- | --- | --- | --- | --- |
| `observer` | no | no | no | no |
| `worker` | yes | no | approval / `trustedCi` | no |
| `reviewer` | yes | yes | approval / `trustedCi` | no |
| `admin` | yes | yes | approval / `trustedCi` | yes |

`readOnly: true` is the deprecated compatibility flag and always yields
effective `observer`. A board-scoped key cannot read or write another board,
create/import boards, or manage the account. A destructive action without
approval answers `409 approval_required` and applies nothing; the board policy
`destructive: "deny"` is a hard `403 destructive_denied` that even `trustedCi`
cannot bypass. See [Token scopes and the destructive gate](./rest/#token-scopes-and-the-destructive-gate).

Observers, including legacy read-only keys, may start, heartbeat and end their
own agent sessions and request a run-revert preview. These control operations
do not grant permission to change board content or apply a revert.

Share creation accepts either an absolute `expiresAt` or `expiresInHours`.
When both are supplied, the relative duration takes precedence. Both expiry
intent and the other share options are part of the idempotency and approval
fingerprints; changing them requires a new key or approval.

### Session-only routes

A personal API token acts as its owner for board work, but it cannot manage
the account's credentials or the human control plane. These routes refuse a PAT
with `403`:

- `GET /users/me/tokens`, `POST /users/me/tokens`, `PATCH /users/me/tokens/:id`, `DELETE /users/me/tokens/:id`
- `POST /users/me/tokens/:id/pause`, `POST /users/me/tokens/:id/resume`
- `POST /agents/pause-all`, `POST /agents/resume-all`
- `POST /boards/:id/agents/pause`, `POST /boards/:id/agents/resume`
- `POST /boards/:id/agent-sessions/:id/pause`, `POST /boards/:id/agent-sessions/:id/resume`
- `POST /boards/:id/approvals/:id/decision` (a human board ADMIN approves; an agent never approves itself)
- `POST /boards/:id/runs/:runId/revert` (a real rollback; `dryRun`/preview is readable)
- `GET`/`PATCH /boards/:id/agent-policy`
- `PATCH /users/me`, `PATCH /users/me/avatar`
- `POST /auth/password`
- `POST /auth/email/change/request`, `POST /auth/email/change/confirm`
- `GET /invitations`, `POST /invitations/:id/accept`, `POST /invitations/:id/decline`
- `POST /users/me/export`, `GET /users/me/export/latest`, `GET /users/me/export/:id`, `GET /users/me/export/:id/download`
- `POST /users/me/delete/request-code`, `DELETE /users/me`
- `GET /users/me/notifications`, `GET`/`PATCH /users/me/notification-settings`

```json
{
  "message": "Personal API tokens cannot manage account credentials — sign in with a browser session",
  "code": "pat_forbidden"
}
```

Call them with an access token from a browser sign-in. Board, member, share,
invitation, comment, attachment and command routes keep accepting a PAT. A
leaked key therefore cannot mint more keys, change the password or move the
account to another mailbox.

The refresh token never appears in a response body. It rides an httpOnly
cookie named `refresh_token`, scoped to path `/api/v1/auth` with
`SameSite=Strict`. Only `POST /auth/refresh` and the other `/auth` routes that
need the caller's session read it.

The administrative authentication system uses a separate cookie (`admin_refresh_token`,
path `/api/v1/admin/auth`), a separate JWT audience (`janosik-admin`) and a
separate `typ` claim. A user token never authenticates an admin route, and an
admin token never authenticates a user route.

## Error envelope

Every REST error uses one machine-readable body (TASK-166.4):

```json
{
  "code": "version_conflict",
  "message": "The board changed since you read it",
  "retryable": false,
  "requestId": "3d0f2c7e-…",
  "currentVersion": 42,
  "conflict": "version",
  "statusCode": 409
}
```

- `code` is a stable snake_case identifier; branch on it, not on `message`.
- `message` is an English fallback. The UI and MCP localize by `code`.
- `retryable` is always present. `true` means the same request may be retried
  unchanged after `retryAfter` (seconds) or a short pause — a busy board, a
  rate limit, an idempotent request still running. Validation and permission
  errors are never retryable.
- `requestId` is the same value as the `X-Request-Id` response header; include
  it in a bug report.
- `currentVersion` is always present as a number or `null`. On a command
  conflict it is the board sequence (`max(Command.seq)`), not `Board.version`.
- `field` points at a rejected input, `details` carries extra context, and
  `limit`/`current` describe a semantic limit. `conflict` (`version`, `wip`,
  `id`, `workflow`) and `workflow` remain for compatibility.

`ValidationPipe` runs with `whitelist: true` and `transform: true`. An unknown
body field is stripped; a failed class-validator constraint is
`400 validation_failed`, with the individual messages in
`details.messages`.

The legacy Nest `error` field is intentionally not returned; `code` replaces
it. `statusCode` is kept as a compatibility mirror.

| HTTP | `code` | Meaning |
| --- | --- | --- |
| `400` | `validation_failed` | body shape/field validation; `field` when known |
| `401` | `unauthorized` | missing, expired or invalid credentials |
| `403` | `forbidden` | not a member or no board role |
| `403` | `scope_denied` | the token preset does not allow the action |
| `403` | `pat_read_only` | a legacy read-only key refused a write |
| `403` | `destructive_denied` | board policy blocks destructive actions |
| `403` | `agent_paused` | agents are paused for the board/session/token |
| `403` | `agent_session_closed` | the `X-Agent-Session` session was already ended |
| `403` | `agent_session_invalid` | the session is not owned by this token/user/board |
| `403` | `pat_required` | an agent-session start/heartbeat was called from a browser session |
| `403` | `pat_forbidden` | a personal API token called a [session-only route](#session-only-routes) |
| `403` | `approval_owner_mismatch` | the approval belongs to another token or session |
| `404` | `not_found` | unknown or soft-deleted resource |
| `409` | `version_conflict` | `ifMatch`/`ifMatchVersions`/policy CAS is stale; see `currentVersion` |
| `409` | `workflow_conflict` | workflow forbids the transition; see `workflow` |
| `409` | `id_conflict` | the id belongs to another board |
| `409` | `limit_exceeded` | WIP, collection, board, plan or run limit |
| `409` | `approval_required` | a destructive action needs a human approval; `approvalId`/`expiresAt` |
| `409` | `approval_expired` / `approval_mismatch` | the approval expired or the plan/hash differs |
| `409` | `approval_not_pending` / `approval_rejected` / `approval_cancelled` / `approval_consumed` | the request cannot be applied in that state |
| `409` | `run_conflict` / `run_expired` | the run is already reverted/being reverted, or its pre-images were swept |
| `409` | `idempotency_conflict` | the same `Idempotency-Key` was used with another body |
| `409` | `idempotency_in_progress` | the first request is running or its outcome is uncertain |
| `413` | `payload_too_large` | body/file over the route limit; see `limit` |
| `416` | `range_not_satisfiable` | an unsatisfiable `Range` on an attachment |
| `429` | `rate_limited` | wait `retryAfter` seconds, then retry |
| `429` | `login_backoff` | too many failed sign-ins; wait `retryAfter` seconds |
| `503` | `board_write_timeout` | the board write lock timed out; safe to retry |
| `503` | `service_unavailable` | maintenance or a transient outage; retry later |

An unexpected server failure is `500 internal_error` with a generic message and
no stack trace. The full, versioned code catalog is in the
[OpenAPI document](/openapi.yaml) (`ApiErrorCode`) and
`docs/TASK-166-launch-agent-control.md` §8.2. `code` is additive: a client must
tolerate an unknown code and fall back to the HTTP status.

Approval, pause and run errors describe the next action: stop and ask a human,
re-read the board, or do not retry the same request. They are intentionally
`retryable: false`; only `rate_limited`, `board_write_timeout` and
`idempotency_in_progress` are safe to retry unchanged.

## Versioning and concurrency

The API contract version is `"1"` (`info.version` in the OpenAPI document,
`server.apiVersion` in `GET /auth/me`). The server release is reported
separately as `server.version`; it changes without changing the contract.
Response fields are additive: a client must ignore unknown keys and unknown
error codes. Breaking changes would ship as a new `/api/v2` prefix.

Board writes use the command sequence for concurrency control. `GET
/boards/:id` returns `X-Board-Seq`; pass that number as `CommandRequest.ifMatch`
and optional per-entity versions as `ifMatchVersions`. A stale value answers
`409 version_conflict` with the current `seq` in `currentVersion`. This is a
body-level precondition: the API does **not** read the HTTP `If-Match` header,
and `Board.version` (entity version for `ifMatchVersions`) is not mixed with
`ifMatch`/`seq`. Board policy uses its own `agentPolicyVersion` CAS token.

## Idempotency

The REST write operations `POST /boards`, `POST /boards/import`,
`POST /cards/:id/comments`, `POST /boards/:id/shares`,
`POST /cards/:id/attachments` and a `DUPLICATE_CARD` command accept an
`Idempotency-Key` header (8–128 characters from `A-Z a-z 0-9 _ -`). The
first successful response is stored for 24 hours:

```http
POST /api/v1/boards
Idempotency-Key: create-roadmap-2026-11-10
Content-Type: application/json

{ "title": "Roadmap" }
```

A retry with the same key and the same body returns the stored status/body and
does not create a second board. A different body with that key is
`409 idempotency_conflict`; a concurrent retry while the first request is still
running is `409 idempotency_in_progress` (`retryable: true`). Command-log writes
use `CommandRequest.commandId` for the same purpose; a duplicate `commandId`
with another payload is also `409 idempotency_conflict`. A failure known to
have rolled back releases its key. If the outcome is uncertain, the reservation
remains for up to 24 hours and retries return `idempotency_in_progress`; check
whether the operation took effect before using a new key.

## Rate limits

Two limiters run globally:

- A fixed window of `THROTTLE_LIMIT` requests per minute (default 300) per
  principal. An owner can change it at runtime from the master panel.
  `/health` is exempt.
- An optional per-authenticated-user budget, set from the master panel. The
  `/admin`, `/auth` and `/health` route groups are exempt from it.

The principal a request counts against is the user for a valid access token
(every tab and device of one account share a budget), the key for a personal
API token that has recently authenticated (each key has its own budget), and
the client IP for everything else: anonymous calls, unknown keys, expired
tokens. When `REDIS_URL` is set the counters live in Redis, so every node
shares them; without it each process counts on its own.

Individual auth routes add tighter `@Throttle` windows on top, counted the
same way: per IP on the anonymous routes, per user on the signed-in ones.

| Route                                | Limit                  |
| ------------------------------------ | ---------------------- |
| `POST /auth/register`                | 5 per minute per IP    |
| `POST /auth/login`                   | 5 per minute per IP    |
| `POST /auth/password`                | 5 per minute per user  |
| `POST /auth/email/change/request`    | 3 per hour per user    |
| `POST /auth/email/change/confirm`    | 5 per minute per user  |
| `POST /auth/verify-email`            | 10 per minute per user |
| `POST /auth/verify-email/resend`     | 3 per hour per user    |
| `GET /auth/oauth/:provider/start`    | 20 per minute per IP   |
| `GET /auth/oauth/:provider/callback` | 20 per minute per IP   |

The public share API has its own per-token budget (see
[REST endpoints](./rest/)). A rejection answers `429`.

### Agent buckets and headers

Personal API tokens get two additional buckets on top of the global principal
window. Browser sessions keep exactly the legacy per-user/IP behaviour.

- **Per-agent-session** — `AGENT_SESSION_RATE_LIMIT` requests per minute
  (default: the live global limit, at least 60) per `agentSessionId`. It
  applies when the request carries `X-Agent-Session`, a session id in the path
  or `?session=` on an SSE stream.
- **Per-board** — `BOARD_RATE_LIMIT` requests per minute (default: twice the
  live global limit, at least 600) per board, shared by every PAT working on
  that board.
- A token's own `rateLimitPerMinute` remains the tightest per-token budget.

A response carries the budget that counted the request:
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix
seconds), `X-RateLimit-Scope` (`token`, `session` or `board`), the
IETF-style `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` (`Reset`
is seconds until reset) and, on `429`, `Retry-After`. When several buckets
exist, the headers name the tightest one, so a client that respects them will
not be rejected by the global window first.

A rejection uses the shared error envelope:

```json
{
  "code": "rate_limited",
  "retryable": true,
  "retryAfter": 42,
  "limit": 60,
  "scope": "session",
  "requestId": "…"
}
```

Structured request logs carry `requestId`, method/path/status/duration,
`actorType`/`actorId`, `boardId`, `apiTokenId`, `agentSessionId`, `runId`
(when available), `approvalId` and the classified operation
(`approval_created`, `approval_decided`, `agent_paused`, `agent_resumed`,
`run_applied`, `run_reverted`). Query strings and public share tokens are
stripped before logging; bodies, headers, comments, card content, token values
and secrets are never logged. The same fields feed the existing
`GET /admin/traffic` snapshot under `telemetry` (requests by actor, writes,
errors, rate-limit hits by scope, operation counters and a bounded
latency histogram) — there is no separate admin screen.

Background jobs keep the same attribution: the `media`, `transcode` and
`exports` payloads carry an optional `attribution` object with `actorType`,
`actorId`, `boardId`, `apiTokenId`, `agentSessionId` and `runId` when the work
came from a request. The object contains opaque ids only — never an email,
file name, comment or card text.

### Login backoff

On top of the IP window, `POST /auth/login` backs off per account. Failures
are counted per normalized email whether or not an account exists, so the lock
reveals nothing about the address. The fifth failure locks the address for 30
seconds, and every further failure doubles the lock, up to 15 minutes. While
the lock holds, every login for that address answers `429`, even one with the
right password:

```json
{
  "message": "Too many failed sign-in attempts — try again in 30 s",
  "code": "login_backoff",
  "retryAfter": 30
}
```

A successful login clears the counter, and it also resets an hour after the
last failure. With `REDIS_URL` set the counter is shared across nodes.

## Maintenance mode

When an owner enables maintenance, the `MaintenanceGuard` answers every
public and user request with `503` and the configured message. The `/admin`,
`/auth` and `/health` paths stay reachable, so an owner can still log in
and switch maintenance off.

## Endpoint groups

| Group                 | Base path                                                  | Documented in                            |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| Auth                  | `/auth`                                                    | this page                                |
| OAuth login           | `/auth/oauth`                                              | this page                                |
| Users and account     | `/users`                                                   | this page                                |
| Boards and members    | `/boards`                                                  | [REST endpoints](./rest/)                |
| Invitations           | `/invitations`                                             | this page                                |
| Commands              | `/boards/:id/commands`                                     | [Command API](./commands/)               |
| Realtime events (SSE) | `/boards/:id/events`                                       | [REST endpoints](./rest/)                |
| Presence              | `/boards/:id/presence`                                     | [REST endpoints](./rest/)                |
| Comments              | `/cards/:cardId/comments`, `/comments/:commentId`          | [REST endpoints](./rest/)                |
| Attachments           | `/cards/:cardId/attachments`, `/attachments/:attachmentId` | [REST endpoints](./rest/)                |
| Board shares (owner)  | `/boards/:id/shares`                                       | [REST endpoints](./rest/)                |
| Public shares         | `/share/:token`                                            | [REST endpoints](./rest/)                |
| Agent sessions        | `/boards/:id/agent-sessions`                               | [REST endpoints](./rest/#agent-sessions-and-attribution) |
| Pause and stop-all    | `/boards/:id/agents/*`, `/agents/*`, `/users/me/tokens/:id/*` | [REST endpoints](./rest/#pause-and-kill) |
| Approvals             | `/boards/:id/approvals`                                    | [REST endpoints](./rest/#approvals)      |
| Plans                 | `/boards/:id/plans`, `/plans/apply`                        | [REST endpoints](./rest/#plans) and [Command API](./commands/) |
| Runs and rollback     | `/boards/:id/runs`                                         | [REST endpoints](./rest/#runs-and-rollback) |
| Board agent policy    | `/boards/:id/agent-policy`                                 | [REST endpoints](./rest/#board-agent-policy) |
| Activity feeds        | `/boards/:id/activity`, `/cards/:cardId/activity`          | this page and [REST endpoints](./rest/)  |
| Personal API tokens   | `/users/me/tokens`                                         | [REST endpoints](./rest/#personal-api-tokens) |
| Health                | `/health`                                                  | this page                                |
| Announcements         | `/announcements`                                           | this page                                |
| Master auth           | `/admin/auth`                                              | administrative authentication system, not covered here |
| Master API            | `/admin`                                                   | administrative authentication system, not covered here |

The administrative authentication system (`/admin`, `/admin/auth`) is a separate
API with its own JWT audience and cookie. It is listed here for completeness but
is
out of scope for this reference.

## Auth endpoints

| Method | Path                         | Auth           | Returns                                  |
| ------ | ---------------------------- | -------------- | ---------------------------------------- |
| `POST` | `/auth/register`             | none           | `AuthResponseDto`                        |
| `POST` | `/auth/login`                | none           | `AuthResponseDto`                        |
| `POST` | `/auth/refresh`              | refresh cookie | `AuthResponseDto`                        |
| `POST` | `/auth/logout`               | refresh cookie | `{ status: "ok" }`                       |
| `GET`  | `/auth/config`               | none           | `AuthConfigResponse`                     |
| `GET`  | `/auth/me`                   | user           | `AuthUserDto`                            |
| `POST` | `/auth/password`             | session        | `{ status: "ok" }`                       |
| `POST` | `/auth/email/change/request` | session        | `{ expiresAt: number, queued: boolean }` |
| `POST` | `/auth/email/change/confirm` | session        | `AuthResponseDto`                        |
| `POST` | `/auth/verify-email`         | user           | `{ user: AuthUserDto }`                  |
| `POST` | `/auth/verify-email/resend`  | user           | `{ expiresAt: number, queued: boolean }` |

`user` accepts an access token or a personal API token; `session` accepts
only an access token from a browser sign-in (see
[Session-only routes](#session-only-routes)).

`register`, `login`, `refresh` and `email/change/confirm` set the refresh
cookie and return `{ accessToken, user }`. `register` also sends a 6-digit
confirmation code to the address.

### Register

`POST /auth/register` body:

| Field         | Type   | Required | Constraints                         |
| ------------- | ------ | -------- | ----------------------------------- |
| `email`       | string | required | valid email; trimmed and lowercased |
| `password`    | string | required | 8 to 100 characters                 |
| `displayName` | string | optional | at most 50 characters               |

Returns `AuthResponseDto` and sets the refresh cookie. A duplicate address
answers `409`.

### Login

`POST /auth/login` body:

| Field      | Type   | Required | Constraints                         |
| ---------- | ------ | -------- | ----------------------------------- |
| `email`    | string | required | valid email; trimmed and lowercased |
| `password` | string | required | at most 100 characters              |

No minimum length is enforced on login: a short password answers `401` like
any other wrong credential. Returns `AuthResponseDto`. Repeated failures for
one address trigger the [login backoff](#login-backoff).

### Refresh and logout

`POST /auth/refresh` reads the `refresh_token` cookie and returns a fresh
`AuthResponseDto`. `POST /auth/logout` revokes the session and clears the
cookie, returning `{ status: "ok" }`.

### Config

`GET /auth/config` is unauthenticated and returns the two public booleans the
sign-in screen reads before a session exists:

```json
{ "allowRegistration": true, "allowPublicShares": true }
```

### Me

`GET /auth/me` returns the authenticated user's `AuthUserDto` plus
`impersonatedBy`: the master's id when the access token is a support
(impersonation) session, otherwise `null`, including for API tokens. With a
personal API token the response also carries `token` (`ApiTokenIdentityDto`,
never a secret or hash); a browser session gets `token: null`. TASK-166 also
reserves `session` for the active agent session (currently `null`).

### Password change

`POST /auth/password` body:

| Field             | Type   | Required | Constraints            |
| ----------------- | ------ | -------- | ---------------------- |
| `currentPassword` | string | required | at most 100 characters |
| `newPassword`     | string | required | 8 to 100 characters    |

Session-only: a personal API token answers `403` with `code: "pat_forbidden"`.
Returns `{ status: "ok" }`. The refresh cookie identifies the caller's session,
which stays signed in; every other session is revoked, and so is every
personal API token of the account.

### Email change

Both email-change routes are session-only. `POST /auth/email/change/request`
requires the current password and confirmation of the new address. Body:

| Field             | Type   | Required | Constraints                         |
| ----------------- | ------ | -------- | ----------------------------------- |
| `newEmail`        | string | required | valid email; trimmed and lowercased |
| `currentPassword` | string | required | at least 1 character                |

Returns `{ expiresAt, queued }` and sends a 6-digit code to the new address.

`POST /auth/email/change/confirm` body:

| Field  | Type   | Required | Constraints      |
| ------ | ------ | -------- | ---------------- |
| `code` | string | required | exactly 6 digits |

On success the address is swapped, every refresh session (including the
caller's old cookie) is revoked, and a fresh `AuthResponseDto` with a new
refresh cookie is returned.

### Email verification

`POST /auth/verify-email` body:

| Field  | Type   | Required | Constraints      |
| ------ | ------ | -------- | ---------------- |
| `code` | string | required | exactly 6 digits |

Returns `{ user }` with `emailVerifiedAt` set. `POST /auth/verify-email/resend`
sends a fresh code and returns `{ expiresAt, queued }`.

### Two-factor authentication

User accounts have no second factor. A 6-digit code (email confirmation, email
change) is an out-of-band confirmation, not a login factor. Two-factor
authentication exists only on the master-account login: the admin login body
accepts an optional `totpCode`. See the administrative authentication system.

## OAuth login

| Method | Path                             | Auth | Returns                             |
| ------ | -------------------------------- | ---- | ----------------------------------- |
| `GET`  | `/auth/oauth/providers`          | none | `{ providers: OAuthProviderDto[] }` |
| `GET`  | `/auth/oauth/:provider/start`    | none | `302` to the provider               |
| `GET`  | `/auth/oauth/:provider/callback` | none | `302` to the UI                     |

Both redirect endpoints are full page navigations, not XHR. `providers` lists
only enabled providers; each entry is `{ id, label }` with `id` one of
`google` or `yandex`.

`start` generates a state value and sets an httpOnly `SameSite=Lax` state cookie scoped to
`/api/v1/auth/oauth`, and redirects to the provider. `callback` validates the
state, sets the refresh cookie, and redirects to the UI root. Any failure
redirects to `?authError=oauth_failed` on the UI root.

The provider's email is trimmed, lowercased and matched case-insensitively
against existing accounts. A new address creates an OAuth-only account with no
password. An existing account is linked, and its address becomes verified. If
that account had never confirmed its email, the server removes its existing
credentials before linking the provider: its password is removed, every refresh
session and personal API token
is revoked, and pending verification and email-change codes are deleted. This
closes the pre-account-takeover path where someone registers a victim's address
with a password before the victim ever signs in. The account is then
OAuth-only: `POST /auth/password` sets a first password without checking
`currentPassword`.

## Users and account

Every route is behind user auth (JWT or PAT), except the three token routes,
which are [session-only](#session-only-routes): an API key can neither list
nor create nor revoke keys.

A personal API token can be scoped when created: `boardId` limits
it to one board, `readOnly: true` refuses content writes (`403 pat_read_only`),
and `rateLimitPerMinute` gives it its own request budget (over the budget
answers `429`).

| Method   | Path                    | Returns                   |
| -------- | ----------------------- | ------------------------- |
| `PATCH`  | `/users/me`             | `AuthUserDto`             |
| `PATCH`  | `/users/me/avatar`      | `AuthUserDto`             |
| `GET`    | `/users/:userId/avatar` | image bytes               |
| `GET`    | `/users/me/tokens`      | `UserTokenDto[]`          |
| `POST`   | `/users/me/tokens`      | `CreateUserTokenResponse` |
| `PATCH`  | `/users/me/tokens/:id`  | `UserTokenDto`            |
| `DELETE` | `/users/me/tokens/:id`  | `{ status: "ok" }`        |

`PATCH /users/me` body:

| Field         | Type           | Required | Constraints                                              |
| ------------- | -------------- | -------- | -------------------------------------------------------- |
| `displayName` | string or null | optional | at most 50 characters; `null` clears it                  |
| `avatarColor` | string or null | optional | one of `USER_AVATAR_COLORS`; `null` restores the default |
| `notifyDigest` | boolean       | optional | `false` opts out of scheduled digests and due reminders   |
| `notifyAttention` | boolean    | optional | `false` opts out of immediate attention e-mails; the in-app inbox is unaffected |

Only provided keys are written.

`PATCH /users/me/avatar` is `multipart/form-data` with a single `file` part.
The image is at most 2 MB (`LIMITS.avatarSize`). Returns the updated user.

`GET /users/:userId/avatar` streams the avatar image to any authenticated
user. Blob names are unique per upload, so the response is cacheable
aggressively. If the user has no avatar, the server returns `404`.

`POST /users/me/tokens` body:

| Field                | Type           | Required | Constraints                                                                    |
| -------------------- | -------------- | -------- | ------------------------------------------------------------------------------ |
| `name`               | string         | required | at most 50 characters                                                          |
| `expiresAt`          | string or null | optional | ISO-8601; must be in the future; omitted means 90 days; `null` means no expiry |
| `boardId`            | string or null | optional | scope to one board the owner is a member of; `null`/omitted means every board  |
| `readOnly`           | boolean        | optional | when true content writes answer `403 pat_read_only`; observer control operations remain available |
| `rateLimitPerMinute` | integer or null | optional | 1 to 100000; `null`/omitted means no per-token limit                          |
| `scopePreset`        | string         | optional | `observer`, `worker`, `reviewer` or `admin`; omitted means `worker`; the API enforces it and an invalid value is refused |
| `trustedCi`          | boolean        | optional | enables destructive actions without approval, unless the board policy is `destructive: "deny"`; omitted means `false` |

Returns `{ token, apiToken }`. The plaintext `token` appears exactly once;
only `apiToken` metadata is returned afterwards. `GET /users/me/tokens` lists
metadata (never the plaintext). `PATCH /users/me/tokens/:id` edits `name`,
`boardId`, `readOnly`, `rateLimitPerMinute`, `scopePreset` or `trustedCi`;
omitted fields keep their value, `null` clears the board/rate scope, an
Observer or read-only key cannot enable `trustedCi`, and every change is
audited with before/after values. It is owner-only and session-only; the
secret is never accepted or returned. `DELETE /users/me/tokens/:id` revokes
one and returns `{ status: "ok" }`. Changing the password revokes every token
of the account. The token DTO also carries `scopePreset`, `trustedCi`,
`individualPausedAt`/`stopAllPausedAt` (and their `*By` fields), computed
`paused`, and `effectiveTokenScope` (`observer` when `readOnly` is true).
`GET /auth/me` with a PAT adds the same non-secret identity as `token`.

## Attention notifications

Approvals, agent blocker/handoff comments, expired card claims and the operator
board cap produce a deduplicated in-app attention event. The same event is also
e-mailed to its human audience — active board ADMINs for approvals and blocked
agents, the requester/decision actor for a decision or expiry, the claimant and
ADMINs for an expired claim, and the account itself for a quota warning —
unless that account set `notifyAttention: false`. API tokens are never
recipients, and events for boards the caller no longer belongs to are hidden.

| Method | Path | Returns |
| ------ | ---- | ------- |
| `GET` | `/users/me/notifications?boardId=&unreadOnly=&cursor=&limit=` | `AttentionNotificationPage` |
| `POST` | `/users/me/notifications/:id/read` | `AttentionNotificationDto` |
| `POST` | `/users/me/notifications/read-all` | `{ updated }`; body `{ boardId? }` |
| `GET` | `/users/me/notification-settings` | `NotificationSettingsDto` |
| `PATCH` | `/users/me/notification-settings` | `NotificationSettingsDto`; body `{ notifyDigest?, notifyAttention? }` |

Every route is session-only; a personal API token answers `403 pat_forbidden`.
The list is newest-first with an opaque `at:id` cursor and an `unreadCount`.
`boardId` requires live membership. Event types are `approval.requested`,
`approval.decided`, `approval.cancelled`, `approval.consumed`,
`approval.expired`, `agent.blocked`, `agent.needs_human`, `claim.expired`,
`quota.exceeded` and `token.revoked` (owner only). The scheduled digest also
includes undigested attention categories once per recipient; immediate
attention e-mail does not block the approval or comment request that produced
it.

## Invitations

A board invitation is a pending membership row (`acceptedAt: null`). It grants
no access until accepted. Every route is behind user auth and is session-only:
a personal API token answers `403 pat_forbidden` (TASK-166), so an agent cannot
list or accept its owner's invitations.

| Method | Path                       | Returns                |
| ------ | -------------------------- | ---------------------- |
| `GET`  | `/invitations`             | `BoardInvitationDto[]` |
| `POST` | `/invitations/:id/accept`  | empty body, `200`      |
| `POST` | `/invitations/:id/decline` | empty body, `200`      |

`GET /invitations` lists the caller's pending, non-expired invitations,
newest first. `accept` stamps `acceptedAt`, so the board then appears in
`GET /boards`. `decline` deletes the row. An expired invitation cannot be
accepted: the row is dropped and the call answers `409`. An unknown or
someone else's invitation answers `404`.

Invitations are addressed to a mailbox, so they wait for the account to prove
it owns one. Until the email is confirmed, `GET /invitations` returns an empty
list and `accept` answers `403`; after confirmation the pending invitations
appear as usual.

## Activity feeds

Readable by every member, VIEWER included.

| Method | Path                      | Returns            |
| ------ | ------------------------- | ------------------ |
| `GET`  | `/boards/:id/activity`    | `ActivityFeedPage` |
| `GET`  | `/cards/:cardId/activity` | `ActivityFeedPage` |

Both accept `?cursor=` (opaque) and `?limit=`. The default limit is 50, the
maximum is 100; a limit outside `1` to `100` answers `400`. Entries are
newest-first; `nextCursor` is `null` at the end. The board feed merges the
command log with `Activity` rows; the card feed is scoped to one card.

## Health

`GET /health` is the liveness probe. It performs no database or Redis I/O
and returns `200` with `{ "status": "ok" }` when the process responds.

`GET /health/ready` is the readiness probe. It checks the database and, when
configured, Redis. The result is cached for a few seconds. Both probes are
exempt from the global rate limit.

```json
{ "status": "ok", "db": "up", "redis": "up" }
```

When `REDIS_URL` is unset, `redis` is `disabled`. If the database or a configured
Redis is unavailable, readiness returns `503` with `status: "error"` and the
dependency states (`up` or `down`).

## Announcements

| Method | Path                    | Auth | Returns             |
| ------ | ----------------------- | ---- | ------------------- |
| `GET`  | `/announcements/active` | user | `AnnouncementDto[]` |

Returns the in-app announcements addressed to the signed-in user. A
signed-out visitor gets nothing.
