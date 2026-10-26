---
title: API reference
description: Conventions, authentication and endpoint groups for the Janosik HTTP API.
---

The Janosik backend is a NestJS service. This page fixes the conventions every
route shares, then lists the top-level endpoint groups. Content mutations
travel through the [Command API](./commands/); the rest of the surface is
plain REST, documented in [REST endpoints](./rest/).

## Base path and transport

Every route is served under the global prefix `/api/v1`. A route named
`POST /auth/login` in this reference is reached at
`POST /api/v1/auth/login`.

Requests and responses are JSON. The JSON body parser accepts payloads up to
`MAX_IMPORT_BYTES` (5 MB, `shared/src/types/kanban.ts`), so a large import
envelope or a `RESTORE_*` command reaches validation instead of dying in the
parser. One command payload is additionally capped at `MAX_COMMAND_BYTES`
(2 MB) inside the command service.

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

The refresh token never appears in a response body. It rides an httpOnly
cookie named `refresh_token`, scoped to path `/api/v1/auth` with
`SameSite=Strict`. Only `POST /auth/refresh` and the other `/auth` routes that
need the caller's session read it.

The master-account contour uses a separate cookie (`admin_refresh_token`,
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

Two shapes deviate from the default and are documented where they occur:

- The command endpoint answers `409` with `{ "conflict": "...", "currentVersion": n }`
  (see [Command API](./commands/)).
- Some endpoints answer `400` with an added `field` string, e.g.
  `{ "message": "...", "field": "text" }`, so a client can point at the input.

## Rate limits

Two limiters run globally:

- A per-client (IP) fixed window, `THROTTLE_LIMIT` requests per minute
  (default 300). An operator can change it at runtime from the master panel.
  `/health` is exempt.
- An optional per-authenticated-user budget, set from the master panel. The
  `/admin`, `/auth` and `/health` contours are exempt from it.

Individual auth routes add tighter `@Throttle` windows on top:

| Route                                | Limit                |
| ------------------------------------ | -------------------- |
| `POST /auth/register`                | 5 per minute per IP  |
| `POST /auth/login`                   | 5 per minute per IP  |
| `POST /auth/password`                | 5 per minute per IP  |
| `POST /auth/email/change/request`    | 3 per hour per IP    |
| `POST /auth/email/change/confirm`    | 5 per minute per IP  |
| `POST /auth/verify-email`            | 10 per minute per IP |
| `POST /auth/verify-email/resend`     | 3 per hour per IP    |
| `GET /auth/oauth/:provider/start`    | 20 per minute per IP |
| `GET /auth/oauth/:provider/callback` | 20 per minute per IP |

The public share contour has its own per-token budget (see
[REST endpoints](./rest/)). A rejection answers `429`.

## Maintenance mode

When an operator enables maintenance, the `MaintenanceGuard` answers every
public and user request with `503` and the operator's message. The `/admin`,
`/auth` and `/health` paths stay reachable, so an operator can still log in
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
| Master auth           | `/admin/auth`                                              | master-account contour, not covered here |
| Master API            | `/admin`                                                   | master-account contour, not covered here |

The master-account contour (`/admin`, `/admin/auth`) is a separate surface
behind its own audience and cookie. It is listed here for completeness but is
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
| `POST` | `/auth/password`             | user           | `{ status: "ok" }`                       |
| `POST` | `/auth/email/change/request` | user           | `{ expiresAt: number, queued: boolean }` |
| `POST` | `/auth/email/change/confirm` | user           | `AuthResponseDto`                        |
| `POST` | `/auth/verify-email`         | user           | `{ user: AuthUserDto }`                  |
| `POST` | `/auth/verify-email/resend`  | user           | `{ expiresAt: number, queued: boolean }` |

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
any other wrong credential. Returns `AuthResponseDto`.

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

`GET /auth/me` returns the authenticated user's `AuthUserDto`.

### Password change

`POST /auth/password` body:

| Field             | Type   | Required | Constraints            |
| ----------------- | ------ | -------- | ---------------------- |
| `currentPassword` | string | required | at most 100 characters |
| `newPassword`     | string | required | 8 to 100 characters    |

Returns `{ status: "ok" }`. The refresh cookie identifies which session is
changed; every other session is revoked.

### Email change

`POST /auth/email/change/request` starts a double opt-in. Body:

| Field             | Type   | Required | Constraints                         |
| ----------------- | ------ | -------- | ----------------------------------- |
| `newEmail`        | string | required | valid email; trimmed and lowercased |
| `currentPassword` | string | required | at least 1 character                |

Returns `{ expiresAt, queued }` and sends a 6-digit code to the new address.

`POST /auth/email/change/confirm` body:

| Field  | Type   | Required | Constraints      |
| ------ | ------ | -------- | ---------------- |
| `code` | string | required | exactly 6 digits |

On success the address is swapped, every other session is revoked, and a
fresh `AuthResponseDto` is returned with the refresh cookie.

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
accepts an optional `totpCode`. See the master-account contour.

## OAuth login

| Method | Path                             | Auth | Returns                             |
| ------ | -------------------------------- | ---- | ----------------------------------- |
| `GET`  | `/auth/oauth/providers`          | none | `{ providers: OAuthProviderDto[] }` |
| `GET`  | `/auth/oauth/:provider/start`    | none | `302` to the provider               |
| `GET`  | `/auth/oauth/:provider/callback` | none | `302` to the UI                     |

Both redirect endpoints are full page navigations, not XHR. `providers` lists
only enabled providers; each entry is `{ id, label }` with `id` one of
`google` or `yandex`.

`start` mints state, sets an httpOnly `SameSite=Lax` state cookie scoped to
`/api/v1/auth/oauth`, and redirects to the provider. `callback` validates the
state, sets the refresh cookie, and redirects to the UI root. Any failure
redirects to `?authError=oauth_failed` on the UI root.

## Users and account

Every route is behind user auth (JWT or PAT).

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

Only provided keys are written.

`PATCH /users/me/avatar` is `multipart/form-data` with a single `file` part.
The image is at most 2 MB (`LIMITS.avatarSize`). Returns the updated user.

`GET /users/:userId/avatar` streams the avatar image to any authenticated
user. Blob names are unique per upload, so the response is cacheable
aggressively. A user without an avatar answers `404`.

`POST /users/me/tokens` body:

| Field       | Type           | Required | Constraints                                                        |
| ----------- | -------------- | -------- | ------------------------------------------------------------------ |
| `name`      | string         | required | at most 50 characters                                              |
| `expiresAt` | string or null | optional | ISO-8601; must be in the future; omitted or `null` means no expiry |

Returns `{ token, apiToken }`. The plaintext `token` appears exactly once;
only `apiToken` metadata is returned afterwards. `GET /users/me/tokens` lists
metadata (never the plaintext). `DELETE /users/me/tokens/:id` revokes one and
returns `{ status: "ok" }`.

## Invitations

A board invitation is a pending membership row (`acceptedAt: null`). It grants
no access until accepted. Every route is behind user auth.

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

`GET /health` is the liveness and readiness probe. It is exempt from the
global rate limit. It returns `200` with a `HealthReport`:

```json
{ "status": "ok", "db": "up", "redis": "up" }
```

`redis` is `disabled` when no Redis URL is configured. The DB is mandatory: a
failed DB ping answers `503` with `{ "status": "error", "db": "down", "redis": ... }`.
A configured but unreachable Redis also answers `503` with
`{ "status": "error", "db": "up", "redis": "down" }`.

## Announcements

| Method | Path                    | Auth | Returns             |
| ------ | ----------------------- | ---- | ------------------- |
| `GET`  | `/announcements/active` | user | `AnnouncementDto[]` |

Returns the in-app announcements addressed to the signed-in user. A
signed-out visitor gets nothing.
