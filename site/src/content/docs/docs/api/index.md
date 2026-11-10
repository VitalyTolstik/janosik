---
title: API reference
description: Conventions, authentication and endpoint groups for the Janosik HTTP API.
---

The Janosik backend is a NestJS service. This page describes the conventions
shared by all routes, then lists the top-level endpoint groups. Changes to board
content use the [Command API](./commands/); other operations, including comments
and attachments, use REST, documented in [REST endpoints](./rest/).

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

### Session-only routes

A personal API token acts as its owner for board work, but it cannot manage
the account's credentials. These routes refuse a PAT with `403`:

- `GET /users/me/tokens`, `POST /users/me/tokens`, `DELETE /users/me/tokens/:id`
- `POST /auth/password`
- `POST /auth/email/change/request`, `POST /auth/email/change/confirm`

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

Errors use the NestJS default body:

```json
{
  "statusCode": 400,
  "message": "title must not be blank",
  "error": "Bad Request"
}
```

`ValidationPipe` runs with `whitelist: true` and `transform: true`. An unknown
body field is stripped. A failed class-validator constraint answers `400` with
`message` as an array of strings, one per failed constraint.

Some shapes deviate from the default and are documented where they occur:

- The command endpoint answers `409` with `{ "conflict": "...", "currentVersion": n }`
  (see [Command API](./commands/)).
- Some endpoints answer `400` or `409` with an added `field` string, e.g.
  `{ "message": "...", "field": "text" }`, so a client can point at the input.
- Some errors carry a machine-readable `code` next to `message`:

| Status | `code`                | Meaning                                                                                     |
| ------ | --------------------- | ------------------------------------------------------------------------------------------- |
| `403`  | `pat_forbidden`       | a personal API token called a [session-only route](#session-only-routes)                    |
| `429`  | `login_backoff`       | the address is in [login backoff](#login-backoff); `retryAfter` is the wait in seconds      |
| `503`  | `board_write_timeout` | the board's write lock timed out under load; safe to retry (a command with its `commandId`) |

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
| Activity feeds        | `/boards/:id/activity`, `/cards/:cardId/activity`          | this page                                |
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
it to one board, `readOnly: true` refuses every write (`403 pat_read_only`),
and `rateLimitPerMinute` gives it its own request budget (over the budget
answers `429`).

| Method   | Path                    | Returns                   |
| -------- | ----------------------- | ------------------------- |
| `PATCH`  | `/users/me`             | `AuthUserDto`             |
| `PATCH`  | `/users/me/avatar`      | `AuthUserDto`             |
| `GET`    | `/users/:userId/avatar` | image bytes               |
| `GET`    | `/users/me/tokens`      | `UserTokenDto[]`          |
| `POST`   | `/users/me/tokens`      | `CreateUserTokenResponse` |
| `DELETE` | `/users/me/tokens/:id`  | `{ status: "ok" }`        |

`PATCH /users/me` body:

| Field         | Type           | Required | Constraints                                              |
| ------------- | -------------- | -------- | -------------------------------------------------------- |
| `displayName` | string or null | optional | at most 50 characters; `null` clears it                  |
| `avatarColor` | string or null | optional | one of `USER_AVATAR_COLORS`; `null` restores the default |
| `notifyDigest` | boolean       | optional | `false` opts out of scheduled digests and due reminders   |

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
| `readOnly`           | boolean        | optional | when true every write answers `403 pat_read_only`; omitted means read/write    |
| `rateLimitPerMinute` | integer or null | optional | 1 to 100000; `null`/omitted means no per-token limit                          |
| `scopePreset`        | string         | optional | `observer`, `worker`, `reviewer` or `admin`; omitted means `worker`; the API enforces it and an invalid value is refused |
| `trustedCi`          | boolean        | optional | enables destructive actions without approval, unless the board policy is `destructive: "deny"`; omitted means `false` |

Returns `{ token, apiToken }`. The plaintext `token` appears exactly once;
only `apiToken` metadata is returned afterwards. `GET /users/me/tokens` lists
metadata (never the plaintext). `DELETE /users/me/tokens/:id` revokes one and
returns `{ status: "ok" }`. Changing the password revokes every token of the
account. The token DTO also carries `scopePreset`, `trustedCi`,
`individualPausedAt`/`stopAllPausedAt` (and their `*By` fields), computed
`paused`, and `effectiveTokenScope` (`observer` when `readOnly` is true).
`GET /auth/me` with a PAT adds the same non-secret identity as `token`.

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
