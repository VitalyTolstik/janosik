---
title: REST endpoints
description: Boards, members, comments, attachments, sharing and realtime for the Janosik HTTP API.
---

Content mutations travel through the [Command API](/docs/api/commands/). This page
documents everything else on the user-facing surface: boards and membership,
comments, attachments, public sharing and the realtime stream. See
[API reference](./) for the shared conventions (base path, auth, errors,
rate limits).

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

`GET /boards` lists the boards where the caller is an accepted member, newest
first, each with a card and column counter and the caller's role. A pending
invitation does not count.

`POST /boards` creates a board with the caller as its first `ADMIN`. A blank
title answers `400`.

`POST /boards/import` accepts an export envelope, either as a parsed JSON
object or as a raw JSON string. It normalizes leniently and creates every
board in the envelope with the importer as `ADMIN`. An empty or invalid
envelope answers `400`. The envelope is:

```json
{ "app": "janosik", "schemaVersion": 1, "exportedAt": 0, "boards": [] }
```

`GET /boards/:id` returns the board aggregate and sets an `X-Board-Seq`
response header carrying the command `seq` the aggregate reflects. A client
resumes the SSE stream from that value. An unknown or soft-deleted board
answers `404`.

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

Comments are plain text and ordinary REST. `CardAccessGuard` resolves the
owning board from the card or comment and enforces membership.

| Method   | Path                      | Auth / role        | Request            | Response           |
| -------- | ------------------------- | ------------------ | ------------------ | ------------------ |
| `POST`   | `/cards/:cardId/comments` | `ADMIN` / `MEMBER` | `CreateCommentDto` | `CommentDto`       |
| `GET`    | `/cards/:cardId/comments` | member             | none               | `CommentPage`      |
| `DELETE` | `/comments/:commentId`    | `ADMIN` / `MEMBER` | none               | `{ status: "ok" }` |

`POST` takes no query parameters; the body is `CreateCommentDto`. A blank
text answers `400`. When `commandId` is supplied, a retry that reuses it returns
the first comment instead of appending a duplicate. A `commandId` already
used on another card answers `409`.

`GET` accepts `?cursor=` (opaque) and `?limit=`. The default limit is 50, the
maximum is 100; a limit outside `1` to `100` answers `400`. Pages are
newest-first and `nextCursor` is `null` at the end.

`DELETE` removes a comment. Only the author may delete their own comment;
another author answers `403`.

Each write records an `Activity` row and publishes an `activity` SSE frame.

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

## Sharing (owner endpoints)

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
creation and survives the board being deleted; only the owner can refresh it.
A live share reads the board as it is now and follows it over SSE.

`POST` mints a random token (16 bytes, base64url). `includeComments` defaults
to `true` for a live share and `false` for a snapshot; `includeAttachments`
defaults to `false`. An `expiresAt` in the past answers `400`.

`POST .../refresh` re-freezes a snapshot share. A live share answers `400`.

`DELETE` revokes a share: its token stops resolving at once. Revoking is
idempotent.

A `:shareId` that does not belong to the board answers `403`; an unknown one
answers `404`.

## Public share endpoints

The public contour is read-only and outside the user JWT. Every route is
behind `ShareAccessGuard`, which resolves `:token` to a live, non-revoked,
non-expired share, and the `ALLOW_PUBLIC_SHARES` master switch. A missing,
revoked, expired or disabled share all answer the same `404`. The read
responses carry `X-Robots-Tag: noindex, nofollow`.

The contour has a per-token rate limit: 240 requests per minute per token
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
frames. Presence and membership frames are dropped, so a public viewer sees
no identities. The `?since=` delta catch-up mirrors the member stream,
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
`"Shared boards are read-only"`. The public contour states its read-only rule
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
When omitted or malformed, the server mints one.

The stream carries five event types:

| `type`       | Payload                                                        | Notes                                          |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| `command`    | `seq`, `action`, `actorId`, `actorType?`, `commandId`, `touches` | a committed command                            |
| `presence`   | `users[]`                                                      | who is connected; no `seq`                     |
| `membership` | `boardId`, `userId`, `change`                                  | `change` is `accepted`, `updated` or `removed` |
| `activity`   | `id`, `boardId`, `cardId?`, `actorId`, `actorType?`, `at`, `kind`, `detail?` | non-reducer activity, e.g. a new comment |
| `resync`     | none                                                           | the gap cannot be replayed; refetch the board  |

`commandId` is the idempotency key the command was sent with, so a client
recognises its own echo by key even when one account runs several writers.

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

Required tri-state used below:

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
| `commandId` | string | optional | at most 64 characters, `^[A-Za-z0-9_-]+$`; idempotency key |

```json
{ "text": "Looks good", "commandId": "c-1" }
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
- `BoardAggregate`: the frontend `Board` (`id`, `title`, `columns[]`, `cards` map, `labels[]`, `createdAt`, `updatedAt`, `archivedAt?`).
- `BoardMemberDto`: `userId`, `displayName`, `email`, `role`, `expiresAt`, `avatarColor`, `avatarPath`. The invite response is masked (`userId: ""`, profile fields `null`).
- `CommentDto`: `id`, `cardId`, `authorId`, `text`, `createdAt`. `CommentPage`: `{ items, nextCursor }`.
- `AttachmentDto`: `id`, `cardId`, `fileName`, `mimeType`, `sizeBytes`, `uploadedById`, `createdAt`, `transcodeStatus`, `hasThumbnail`, `hasPoster`.
- `BoardShareDto`: `id`, `token`, `boardId`, `boardTitle`, `mode`, `title`, `includeComments`, `includeAttachments`, `expiresAt`, `revokedAt`, `views`, `lastViewedAt`, `createdAt`, `createdBy`.
- `PublicBoardDto`: `mode`, `title`, `takenAt`, `board`, `seq`, `members[]`, `includeComments`, `includeAttachments`. Members are `{ id, displayName, avatarColor, avatarPath }` with no emails.
- `BoardEnvelope`: `{ app, schemaVersion, exportedAt, boards[] }`.

## Errors

| Status | When                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | validation failed, a blank required text, an invalid limit or expiry, an invalid or empty envelope, a rejected file                                       |
| `401`  | missing or invalid token                                                                                                                                  |
| `403`  | not a member; a role the route does not allow; an expired `VIEWER`; a share that does not belong to the board; a non-author deleting a comment            |
| `403`  | `code: "pat_forbidden"`: a personal API token on a session-only route                                                                                     |
| `404`  | unknown or soft-deleted board, card, comment, attachment or share; a disabled, revoked or expired public share; a thumbnail or poster that does not exist |
| `405`  | a write against the public share contour                                                                                                                  |
| `409`  | inviting an accepted member; demoting or removing the last `ADMIN`; an expired invitation; a `commandId` reused on another card                           |
| `410`  | a live share whose board no longer exists                                                                                                                 |
| `413`  | a command payload over `MAX_COMMAND_BYTES`; a JSON body over 256 KB (5 MB on import and commands)                                                         |
| `416`  | an unsatisfiable `Range` on a blob                                                                                                                        |
| `429`  | a rate limit was exceeded; `code: "login_backoff"` during a login backoff                                                                                 |
| `503`  | maintenance mode; a failed health check; `code: "board_write_timeout"` when a board write timed out (safe to retry)                                       |
