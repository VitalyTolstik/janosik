---
title: Monitoring and logs
description: The dashboard, the activity feed, the command log and the audit trail, with every column and action.
---

The monitoring section answers two questions: what is happening on the
platform right now, and what have masters and users done. Four pages cover it:
the dashboard, the activity feed, the command log and the audit trail.

## Dashboard

The dashboard is the panel home at `/admin`. It loads two requests:
`GET /admin/metrics` and a small `GET /admin/audit?limit=8`. The page has three
parts.

### Stat cards

| Card | Value | Hint |
| --- | --- | --- |
| Users | total users | `+N in 7 days` |
| Blocked | users with `disabledAt` set | none |
| Active boards | boards not deleted and not archived | `N archived` |
| Active cards | cards not deleted and not archived | `N archived` |
| Commands, 24h | commands in the last 24 hours | `N in 7 days` |
| Active sessions | live refresh sessions | none |
| Comments | comments not deleted | none |
| Master accounts | total masters | none |

### Runtime panel

The runtime panel shows four values from `AdminMetricsDto.runtime`:

| Label | Value |
| --- | --- |
| Version | backend package version |
| Uptime | process uptime, formatted as `Nh Nm` or `Nm Ns` |
| Database | round-trip of a `SELECT 1`, in milliseconds |
| Environment | `NODE_ENV` |

### Charts and recent audit

Two charts cover the last 14 days, oldest first: registrations per day and
commands per day. Below them is `Recent admin actions`, the latest eight audit
rows (action, master email, time), with a link to the full audit trail.

## Activity feed

`/admin/activity` lists membership changes and comment events across boards.
The subtitle is `Membership changes and comment events`.

| Column | Value |
| --- | --- |
| Event | the activity `type` |
| Actor | actor email, linked to the user detail page |
| Board | board title, linked to the board detail page |
| Card | card title, linked to the card detail page, or a dash |
| Details | the event payload as JSON |
| When | creation time |

The page has a search box, period tabs (any time, 24 hours, 7 days, 30 days)
and pagination. It has no row actions.

## Command log

`/admin/commands` lists every board action across every board, newest first.
The subtitle is `Every board action, newest first`. Rows are ordered by
creation time and then by sequence number.

| Column | Value |
| --- | --- |
| Action | the command `type` |
| Actor | actor email, linked to the user detail page |
| Board | board title, linked to the board detail page |
| Seq | the command sequence number |
| Payload | the command payload as JSON |
| When | creation time |

The page has a search box, period tabs and pagination. It has no row actions.
The legacy path `/admin/log` redirects to `/admin/commands`.

## Audit trail

`/admin/audit` lists what masters did in the panel. The subtitle is
`{total} admin actions`.

| Column | Value |
| --- | --- |
| Action | the audit action name |
| Master | master email, linked to the masters page, or copied when the master is gone |
| Target | the target type and id, or a dash |
| Details | the audit payload as JSON |
| When | creation time |

The page has a search box, period tabs and pagination. It has no row actions.

### Audit actions

Every action the audit log can carry:

| Group | Actions |
| --- | --- |
| Master auth | `admin.login`, `admin.login_failed`, `admin.login_locked`, `admin.logout`, `admin.sessions_revoked` |
| Master management | `admin.create`, `admin.disable`, `admin.enable`, `admin.unlock`, `admin.update`, `admin.password_changed`, `admin.password_reset`, `admin.owner_granted` |
| Users | `user.create`, `user.update`, `user.email_changed`, `user.disable`, `user.enable`, `user.sessions_revoked`, `user.tokens_revoked`, `user.verified`, `user.unverified`, `user.verification_resent`, `user.password_reset`, `user.delete`, `user.impersonated`, `user.promoted`, `user.demoted` |
| Boards | `board.create`, `board.archive`, `board.unarchive`, `board.delete`, `board.command`, `board.member_added`, `board.member_removed`, `board.member_role_changed`, `board.owner_transferred` |
| Cards and content | `card.archive`, `card.unarchive`, `card.delete`, `attachment.delete`, `entity.restored`, `entity.bulk_deleted`, `comment.delete` |
| Sessions and tokens | `session.revoke`, `token.revoke` |
| Email | `email.settings_changed`, `email.test_sent`, `email.sent`, `email.template_changed`, `email.template_reset` |
| Configuration | `oauth.settings_changed`, `throttle.settings_changed`, `flag.changed`, `ops.settings_changed` |
| Communications | `announcement.created`, `announcement.updated`, `announcement.deleted`, `comms.digest_sent`, `comms.reminder_sent` |
| Data | `data.exported`, `data.export_queued`, `data.export_downloaded`, `retention.changed` |
| Security | `security.totp_enabled`, `security.totp_disabled`, `security.ip_allowlist_changed` |
| Demo and shares | `demo.started`, `demo.stopped`, `share.created`, `share.refreshed`, `share.revoked` |
| Operations | `maintenance.run`, `queue.ticket_issued` |

## Shared list behaviour

Every listing in the panel uses one table implementation, so behaviour is
identical everywhere. Each page has a search box, pagination and the filters
its entity supports.

- Status tabs appear only for entities with a status filter (for example
  active, archived, deleted).
- Period tabs appear only for time-based feeds (activity, commands, sessions,
  tokens, audit): any time, 24 hours, 7 days, 30 days.
- Pagination shows the total, the page size and the current page. The page
  size default is 50, the minimum is 1 and the maximum is 100.
- A loading spinner, an error state with retry, and an empty state are shown
  per page.
- A failed action toasts `Access denied` on `403`, `No connection to the
  server` when the request never left, and `The action failed` otherwise.

The dashboard is described here; the user, board and content listings are on
their own pages: see [users and masters](./people/) and
[boards, cards and content](./content/).
