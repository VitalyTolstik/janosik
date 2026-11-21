---
title: Monitoring and logs
description: The dashboard, the activity feed, the command log and the audit trail, with every column and action.
---

:::note
The dashboard is the **Overview** hub (`/app/admin`). The activity feed, command
log and audit trail are tabs of **Audit & activity** (`/app/admin/audit?tab=…`).
The old `/app/admin/activity` and `/app/admin/commands` URLs redirect. See
[Admin redesign](../redesign/) for the full map.
:::

The monitoring section answers two questions: what is happening on the
platform right now, and what have masters and users done. Four pages cover it:
the dashboard, the activity feed, the command log and the audit trail.

## Dashboard

The dashboard is the panel home at `/app/admin`. It sends two requests:
`GET /api/v1/admin/metrics` and a small `GET /api/v1/admin/audit?limit=8`. The page has three
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

`/app/admin/activity` lists membership changes and comment events across boards.
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

`/app/admin/commands` lists every board action across every board, newest first.
The subtitle is `Every board action, newest first`. Rows are ordered by
creation time and then by sequence number.

| Column | Value |
| --- | --- |
| Action | the command `type` |
| Actor | actor email, linked to the user detail page |
| Board | board title, linked to the board detail page |
| Seq | the command sequence number |
| Payload | the command payload as JSON |
| Audit | an `Audit` link when a master issued the command, otherwise a dash |
| When | creation time |

The page has a search box, period tabs and pagination. It has no row actions.
The `Audit` link opens `/app/admin/audit?tab=audit&commandId=<command id>`, which filters
the audit trail to the exact row recorded for that command. Only commands
issued through the master panel are correlated; normal user commands and
historical rows keep a dash.
The legacy path `/app/admin/log` redirects to `/app/admin/audit?tab=commands`.

## Audit trail

`/app/admin/audit` lists what masters did in the panel. The subtitle is
`{total} admin actions`.

| Column | Value |
| --- | --- |
| Action | the audit action name |
| Master | master email; linked to the masters page for an OWNER, plain copyable text for an OPERATOR, or copied when the master is gone |
| Target | the target type and id; user/board/card targets link to their detail page, other targets keep a copyable id, or a dash |
| Details | the audit payload as JSON |
| When | creation time |

The page has a search box, period tabs and pagination. It has no row actions.
`?commandId=<command id>` filters the trail to the audit row recorded for one
master-issued board command; the command log and the card timeline link to
this exact view. `board.command` details carry `commandId`, `masterId` and
`masterEmail` alongside the owner-facing `actorEmail`, so the real master is
never hidden behind the owner attribution. The filter is the command id, not
the audit row id, and it also requires `action=board.command`. Card field edits
from `/app/admin/cards/:id` use the same `board.command` row: `UPDATE_CARD`,
`SET_CARD_ASSIGN`, `SET_CARD_DUE_DATE`, `SET_CARD_PRIORITY`, `SET_CARD_COVER`
and `SET_CARD_LABEL` each carry their own `commandId` and master attribution.
Checklist and link edits are correlated the same way: `ADD_CHECKLIST`,
`RENAME_CHECKLIST`, `DELETE_CHECKLIST`, `ADD_CHECKLIST_ITEM`,
`SET_CHECKLIST_ITEM_DONE`, `RENAME_CHECKLIST_ITEM`, `DELETE_CHECKLIST_ITEM`,
`ADD_CARD_LINK` and `REMOVE_CARD_LINK` each produce one `board.command` row for
an accepted fresh write. A rejected fresh write (missing/deleted row, foreign
id, self/duplicate/cycle link or cap) creates neither a command nor an audit
row, while a replay of a stored `commandId` returns its result without a
second audit row.

### Audit actions

Every action the audit log can carry:

| Group | Actions |
| --- | --- |
| Master auth | `admin.login`, `admin.login_failed`, `admin.login_locked`, `admin.logout`, `admin.sessions_revoked` |
| Master management | `admin.create`, `admin.disable`, `admin.enable`, `admin.unlock`, `admin.update`, `admin.password_changed`, `admin.password_reset`, `admin.owner_granted` |
| Users | `user.create`, `user.update`, `user.email_changed`, `user.disable`, `user.enable`, `user.sessions_revoked`, `user.tokens_revoked`, `user.verified`, `user.unverified`, `user.verification_resent`, `user.password_reset`, `user.delete`, `user.impersonated`, `user.promoted`, `user.demoted` |
| Boards | `board.create`, `board.archive`, `board.unarchive`, `board.delete`, `board.command`, `board.member_added`, `board.member_removed`, `board.member_role_changed`, `board.owner_transferred` |
| Cards and content | `card.archive`, `card.unarchive`, `card.delete`, `attachment.delete`, `entity.restored`, `entity.bulk_deleted`, `entity.bulk_restored`, `entity.bulk_archived`, `entity.bulk_unarchived`, `comment.delete` |
| Sessions and tokens | `session.revoke`, `token.revoke` |
| Email | `email.settings_changed`, `email.test_sent`, `email.sent`, `email.template_changed`, `email.template_reset` |
| Configuration | `oauth.settings_changed`, `throttle.settings_changed`, `flag.changed`, `ops.settings_changed` |
| Communications | `announcement.created`, `announcement.updated`, `announcement.deleted`, `comms.digest_sent`, `comms.reminder_sent` |
| Data | `data.exported`, `data.export_queued`, `data.export_downloaded`, `retention.changed` |
| Security | `security.totp_enabled`, `security.totp_replaced`, `security.totp_disabled`, `security.ip_allowlist_changed` |
| Demo and shares | `demo.started`, `demo.stopped`, `share.created`, `share.refreshed`, `share.revoked` |
| Operations | `maintenance.run`, `queue.ticket_issued` |

`BoardShareAuditLog` is a separate per-share trail, not this master audit log.
It uses bare action names: `created`, `updated`, `refreshed`, `revoked` and
`deleted` — a PATCH writes `updated`, without the `share.` prefix.
`share.revoked` in the master log is only the admin hard-delete of an already
revoked share.

## Shared list behavior

Every listing in the panel uses one table implementation, so behavior is
identical everywhere. Each page has a search box, pagination and the filters
its entity supports.

- Status tabs appear only for entities with a status filter (for example
  active, archived, deleted).
- Period tabs appear on users, cards, comments, attachments and the
  time-based feeds (activity, commands, sessions, tokens, audit): any time,
  24 hours, 7 days, 30 days.
- Pagination shows the total, the page size and the current page. The page
  size default is 50, the minimum is 1 and the maximum is 100.
- The entity list state lives in the URL (`search`, `status`, `period`,
  `limit`, `offset` and the exact id filters). Reloading, sharing the link or using browser
  back/forward restores the same filtered page; hub keys such as `tab` are
  preserved. Typing in the search box replaces the current history entry,
  while filters and pagination add one, so Back returns to the previous view
  rather than one keystroke. The URL carries filters only — never a token,
  password or one-time code.
- A row click carries `returnTo` with the exact filtered list URL, and the
  detail page's back control returns there. Only internal master-panel paths are
  accepted, so a crafted query cannot redirect off the panel.
- A loading spinner, an error state with retry, and an empty state are shown
  per page.
- If an action fails, a notification shows `Access denied` on `403`, `No connection to the
  server` when the request never left, and `The action failed` otherwise.

### Filters

Lists that have facets beyond status and period expose a `Filters` button next
to the header controls. The number on the button counts active advanced facets,
not values; status and period stay in the header and are not counted.

- On a desktop the button opens a popover anchored to it. Below 640 px it opens
  a bottom sheet capped at 70dvh with 44 px controls and bottom safe-area
  padding. Closing the surface returns focus to the button.
- Facets are grouped into **Scope** (board, column, card, command), **People**
  (assignee, author, uploader, actor, admin member) and **Properties** (label,
  priority, due date, attachments, comment kind, link type, audit action,
  target type). The groups and facets differ per list; only supported facets
  are shown.
- Every picker searches as you type (250 ms debounce, at most 20 results) and
  discards a stale response. If the typed value looks like an id, `Use id …`
  accepts it even when the row is deleted or not returned by search.
- Single-value pickers apply on selection and close. Multi-value pickers keep
  a draft: `Apply` commits the whole facet once, `Clear` empties the draft and
  `Cancel`/`Escape` discards it. Selected values stay pinned at the top and the
  picker shows `Selected: N`. A facet accepts up to 20 values.
- Choice facets apply immediately when selected: email verification, due date,
  card attachments, file type and video processing. Choosing `Any` removes the
  parameter and its chip.
- The labels picker shows **Any label** / **All labels** once two or more
  labels are selected. `All` adds a `Label match: All` chip; removing labels
  until fewer than two remain resets the mode to Any.
- The URL is the saved view. Adding, removing or applying a filter pushes one
  history entry; typing in the search box still replaces the current entry.
  Reload, back/forward, a shared link and `returnTo` reproduce the same list,
  page and chips.
- A filter change resets the page to 1 and clears the bulk selection. Changing
  the page keeps the selection.
- `Clear search and filters` resets search, status, period and every advanced
  filter in one history entry. The page size is kept.
- Counts are exact server totals (`N total`, `Page X of Y`), never the number
  of loaded rows. There are no filter-option counts.

#### Filter chips

- A chip shows a human label and the object's own short id (eight characters).
  Dependent chips also show their parent board and column short ids; the full
  title and ids are in the tooltip and in the remove button's accessible name.
- Archived, deleted and disabled objects keep their name with `(archived)`,
  `(deleted)` or `(disabled)`.
- An id that no longer exists becomes `Unknown board`, `Unknown column` and so
  on. The filter stays active and the list shows its normal consistent empty
  state; the chip is not silently removed.
- If an object exists but belongs to a different board or column than the
  active board/column, the panel shows a conflict banner naming the value and
  a `Remove conflict` action. The filters are kept and the list keeps the exact
  AND, which can legitimately be empty. Commands is exempt because its card and
  column facets match historical `touches`.
- If a lookup fails, the chips and rows stay in place and an inline `Retry`
  appears above the table. The page never presents an unfiltered list as if the
  filter had matched.
- A hand-edited parameter that the list does not support is dropped while the
  URL is parsed. A direct API call with that parameter returns
  `400 unsupported_filter`; the panel then replaces the list with an explicit
  unsupported-filter state and a `Remove filter` action.

#### Board changes and hub tabs

Changing or clearing **Board** removes Column, Label, Label match and Card in
the same URL update and announces how many filters were cleared. Commands is
the exception: it keeps Card and Column when Board changes or clears, because
those facets match the historical command `touches`, not the card's current
parent.

Switching hub tabs keeps `boardId` (and only `boardId`) where the target
supports it. Search, status, period, column, label, label match, card and
checklist state are dropped, and `returnTo` is preserved. This keeps "I am
inspecting board X" across content and moderation while preventing a stale
search from hiding rows on another surface.

#### Keyboard and touch

- `Tab` reaches the Filters button; `Enter` or `Space` opens it; `Escape` closes
  it and returns focus to the button.
- Pickers are comboboxes/listboxes: arrows, `Home`/`End`, `Enter`/`Space` and
  type-to-search. A radio group is one tab stop with arrow-key selection.
- In the mobile sheet every control is at least 44 px, the footer actions stay
  visible while the facet list scrolls, and the sheet respects the bottom safe
  area.
- Chips wrap. At 390 px a long title is ellipsized while the ids stay visible,
  and the page never scrolls horizontally.
- Nothing requires hover: every chip remove control is a real focusable button
  with a minimum 24×24 px hit target (32 px in the desktop panel, 44 px on a
  phone).

#### What is intentionally not filterable

- There are no board-style saved views, no localStorage restore, no
  filter-option counts and no CSV export.
- Sessions and API tokens keep their period tabs only. The sessions list is
  live-only, so a status filter would imply revoked or expired rows that the
  list does not show. Public shares keep search only until their pagination is
  truthful.
- Masters is a small owner-only roster and has no filters.
- Detail pages (user, card, board members, dashboard) are already narrowed by
  their parent and do not repeat list filters.
- Checklist items have no top-level tab; they are read on the card detail.
- Security settings show a bounded recent-alert panel, not a searchable
  security log.

### Addressable filters

Board counters and board-detail columns/labels link to the exact rows instead
of a name search:

| From | Link | Meaning |
| --- | --- | --- |
| Board counter Cards / Comments / Files / Commands / Events | `?boardId=<id>` on the matching hub tab | rows of that board only |
| Column title or card count | `/app/admin/boards?tab=cards&columnId=<id>` | cards in that column |
| Label chip or card count | `/app/admin/boards?tab=cards&labelId=<id>` | cards carrying that label |
| Search label result | `/app/admin/boards?tab=cards&labelId=<id>` | cards carrying that label |
| Card title in the content editor | `/app/admin/cards/<id>` | the card detail |
| Command row `Audit` link | `/app/admin/audit?tab=audit&commandId=<command id>` | the exact audit row for that master-issued command |

`boardId`, `columnId`, `labelId`, `cardId` and `commandId` are validated ids,
not text: a malformed value is rejected with `400`, and same-name boards or
labels cannot collide. The filters combine with `status` and the period window; a request
that names a column from another board returns no rows rather than widening
the result. Filtered links show removable chips above the table.

Deleted and archived rows follow the list's own status tabs (board-scoped
content and moderation lists have them; the log feeds do not). With no explicit
status filter a board-scoped list still includes soft-deleted comments/files
and archived or deleted cards, marked with their badge; `status=active`
excludes them and `status=deleted` selects them. The Comments and Files
counters link with `status=active`, matching their live-row definition. The
Cards counter includes archived cards but excludes deleted ones, so its linked
list can show archived rows in addition to the count; the Cards counter and
the Cards counter and the Commands/Events counters stay unfiltered by status.
The status tabs (where the list has them) and filter chips narrow these lists.

### Activity, command log and audit filters

The three monitoring feeds use the same filter surface:

| List | Offered facets |
| --- | --- |
| Activity | Board, Card, Actor, Event type |
| Command log | Board, Card, Column, Actor, Command type, Command ID |
| Audit trail | Master, Action, Target type, Target ID, Command ID |

- **Activity** types come from the distinct values stored in the feed, so
  membership, comment, approval and agent events are all reachable without a
  hard-coded list. The actor facet matches the membership or comment actor.
- **Command log** types are exact command codes such as `ADD_CARD`,
  `MOVE_CARD` or `UPDATE_CARD`. Card and Column match historical `touches`, so
  changing or clearing Board keeps them. A card's current board or column does
  not restrict the commands that appear in its history.
- **Audit trail** offers only actors visible in audit rows: a master id or the
  attempted email on a failed sign-in. `adminId` is not a roster search and an
  OPERATOR sees plain text, not a link to the owner-only Masters page. For a
  failed sign-in without a master id, clear the Master chip, search the
  attempted email and optionally narrow Action to `admin.login_failed`.
- The Audit Action and Target type pickers list the values the server returns;
  free-typed codes are still accepted by the API as exact values. Target ID is
  an exact id; with one target type selected its chip links to the user, board
  or card detail when a returned audit row confirms that the object exists.

The dashboard is described here; the user, board and content listings are on
their own pages: see [users and masters](/docs/admin/people/) and
[boards, cards and content](/docs/admin/content/).
