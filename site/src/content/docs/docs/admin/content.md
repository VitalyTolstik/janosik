---
title: Boards, cards and content
description: Boards and the board content editor, cards and card detail, and the columns, labels, checklists, links, comments, attachments, sessions, tokens and shares browsers.
---

:::note
Boards, cards, columns, labels, checklists and card links are tabs of the
**Boards** hub (`/app/admin/boards?tab=…`). Comments and attachments live in
**Moderation**, and sessions, tokens and public shares live in **Access &
security** and **Communications**. Every old URL redirects. See
[Admin redesign](../redesign/).
:::

The content section provides tools for daily moderation. It exposes boards,
cards and every board-scoped model the panel can list, plus the session, token
and public share browsers that sit under security.

## Boards

`/app/admin/boards` lists every board. The subtitle is `{total} boards`.

| Column | Value |
| --- | --- |
| Board | title |
| Owner | owner email, linked to the user detail page |
| Created | creation time |
| Updated | last update time |
| Status | `Active`, `Archived` or `Deleted` |

The page has a search box, status tabs (all, active, archived, deleted),
pagination, a `Create board` button and bulk selection.

The `Filters` button offers `Admin member`. The filter matches the exact user
id of any accepted `ADMIN`; it is not the Owner column. Two accepted ADMINs
both match, while a `MEMBER`, a `VIEWER` and a pending invitation do not.

### Create a board

The `Create board` dialog takes a title and an owner email. The owner becomes
the board `ADMIN`. If no user matches the owner email, the server returns `404`.

### Row actions

| Action | Effect | Notes |
| --- | --- | --- |
| Edit content | opens the board content editor | opens the editor page |
| Archive | sets `archivedAt` | confirmed; the board becomes read-only for members |
| Restore | clears `archivedAt` | shown when archived |
| Delete | soft-deletes the board | destructive, confirmed; purged after the retention window |

### Bulk actions

With rows selected, a bar appears with `N selected (M on this page)`, `Delete
selected`, `Restore selected` and `Clear`. The selection survives pagination:
rows picked on page 1 stay selected when page 2 is opened, and the action
applies to every saved id — the counter, the confirmation and the request all
use the same set. Changing search, status, period or page size clears the
selection, because those controls change the rows underneath it. One bulk
request is limited to 500 ids; the panel refuses a larger selection with a
message instead of truncating it. Bulk deletion requires confirmation and does
not support ordinary undo. If the server refuses some ids, exactly those rows
stay selected for a retry. Soft-deleted records can be restored until they are
permanently purged. Deleting a column soft-deletes its active cards but they
keep their stored `columnId` on the deleted column; restoring the column brings
those cards back. Archived cards are different: `DELETE_COLUMN` repoints them
to the board's internal soft-deleted `orphan:<boardId>` column so the original
column can purge. Those archived orphan cards remain visible and
field-editable on `/app/admin/cards/:id`, but moving them is rejected because
archived cards cannot be moved.

### Workflow

The board detail page has a `Workflow` panel with the current state (enabled or
disabled, number of transitions) and an `Open workflow editor` button. The
editor is the same one board admins use; here it runs at
`/app/admin/boards/:id/workflow` and saves through `POST
/api/v1/admin/boards/:id/commands` as the board owner. The command log, versions and
live board updates stay intact, and the master's action appears in
`AdminAuditLog` as a `board.command` entry.

Changes made here are subject to the same validation as the board editor:
shape, existing column references, at least two columns and at least one
active transition when control is enabled. The page shows the
“acting for the owner” banner and does not bypass workflow rules itself.

## Board detail

`/app/admin/boards/:id` shows the board meta, live counters, members, columns and
labels.

- The header carries the title, the owner email, an `Edit content` button and
  an actions menu with archive, restore and delete.
- The meta row shows Owner, Created, Updated and Version.
- Nine counters are shown: Members, Columns, Cards, Labels, Links, Comments,
  Files, Commands and Events. Cards, Comments, Files, Commands and Events are
  links to the matching list filtered by this board's exact `boardId`; the
  member, column, label and link numbers stay plain counts.

### Members

| Column | Value |
| --- | --- |
| Member | user email, linked, with a `Disabled` badge when the user is blocked |
| Role | the member role |
| Accepted | acceptance time, or a `Pending` badge |
| Expires | expiry, or a dash |
| Invited by | inviter email, linked to the profile, or a dash |
| Actions | the member menu |

`Add member` opens a dialog with a user email and a role select (`MEMBER`,
`ADMIN`, `VIEWER`). A master-added membership is effective immediately, so it
is accepted at once and has no inviter.

The member menu offers:

| Action | Effect |
| --- | --- |
| Change role | the two roles that differ from the current one, each a menu entry |
| Make owner | transfers board ownership to that member |
| Remove member | deletes the membership |

Transferring ownership requires the target to be an accepted member. Every
other `ADMIN` is demoted to `MEMBER` and the target becomes `ADMIN`.

### Columns and labels

The columns table shows Column, Position, WIP limit, Cards and Status. The
labels panel shows each label as a color chip. A column title or card count
opens the cards list filtered by that exact `columnId`; a label chip opens it
filtered by `labelId`. Both links keep the board detail as their return path.

## Board content editor

`/app/admin/boards/:id/content` edits columns and cards without leaving the panel.

- The left panel lists columns with a card count. Each column has rename and
  delete controls; a composer at the bottom adds a column.
- The right panel lists the cards of the selected column. Each card has rename,
  move and archive controls; a composer at the bottom adds a card. The move
  dialog appends the card to another column and omits the current column from
  the destination list. The card title links to `/app/admin/cards/:id`, and the
  card detail's back control returns to this editor.
- A manual refresh button is in the header.
- The page polls the board aggregate every 2 seconds while it is visible and
  focused, so you can monitor a running demo on this page.

Each edit is submitted as a board command through
`POST /api/v1/admin/boards/:id/commands` on behalf of the board owner, the board's
first accepted `ADMIN`. The server re-validates each action with the shared
strict validator, so a rejected action (for example, due to a WIP or size limit)
shows a notification and leaves the board unchanged. The move dialog re-checks
its snapshot before sending: if the card left the source column, or the target
column disappeared, it shows a reload message. A fresh server move with a stale
source (including a non-archived card parked in a deleted/orphan column) is
rejected as `409 conflict: "version"`; a missing, deleted or foreign target
column is `404` — both before any command or audit row. An exact retry of
a stored `commandId` still returns its stored result. The editor sends
`ADD_COLUMN`, `ADD_CARD`, `RENAME_COLUMN`, `UPDATE_CARD`, `MOVE_CARD`,
`ARCHIVE_CARD` and `DELETE_COLUMN`, each stamped with the command clock. The
command log, versions and the board UI stay consistent.

Moves and description edits show the explicit banner `You are acting as the
board owner; this change appears as the owner in the board history.` The board
history and command log keep the owner as the actor; the audit trail records
the master who issued the command (`masterId`, `masterEmail`) and the shared
`commandId`.

A column delete is a soft delete: active cards disappear for members and keep
their `columnId` until the column is restored or purged. Archived cards are
repointed to the internal soft-deleted `orphan:<boardId>` column. They remain
visible and field-editable on `/app/admin/cards/:id`; a move is rejected with the
archived-card `409`. The confirm dialog states the soft-delete behavior.

## Cards

`/app/admin/cards` lists every card on the platform. The subtitle is `Cards
across every board: {total}`.

| Column | Value |
| --- | --- |
| Card | title, linked to the card detail page, truncated with the full text on hover |
| Board | board title, linked |
| Column | column title |
| Comments | count of visible comments |
| Priority | a priority badge, or a dash |
| Assignee | assignee email, linked, or a dash |
| Due date | deadline, or a dash |
| Updated | last update time |
| Status | `Active`, `Archived` or `Deleted` |

The page has a search box, status tabs, period tabs, pagination and bulk
selection.

The `Filters` button and its chips narrow the list by:

| Facet | Values | Notes |
| --- | --- | --- |
| Board | one exact board id | |
| Column | one exact column id | |
| Label | one or more label ids, plus **Any label** / **All labels** | All requires every selected label |
| Assignee | one or more user ids, plus `Unassigned` | `Unassigned` is OR-ed with the selected assignees |
| Priority | `Blocker`, `Highest`, `High`, `Medium`, `Low`, `Lowest` | `Medium` includes cards without a priority |
| Due date | `Overdue`, `Due in 24 hours`, `No due date` | the same boundaries as the board filter |
| Card attachments | `Has card attachments`, `No card attachments` | card-face files only; inline files and `descriptionDetached` files are excluded |

The period tabs apply to `createdAt` (any time, 24 hours, 7 days, 30 days).
An exact card id remains available as an advanced deep link
(`?cardId=<id>`) for support and search hand-offs.

Row actions: `Archive` (confirmed), `Restore` (when archived) and `Delete`
(destructive, confirmed).

## Card detail

`/app/admin/cards/:id` shows the card and its related records. The header carries the title, the
subtitle `board · column`, and an actions menu with archive, restore and
delete. A status badge, a priority badge and a due-date chip are shown.

### Meta

| Field | Value |
| --- | --- |
| Board | board title, linked |
| Column | column title |
| Created | creation time |
| Updated | last update time |
| Version | the card version |
| Created by | derived from the first add-card command, or a dash |
| Assignee | assignee, linked, or a dash |
| Last changed by | the last actor, linked to the profile, or a dash/deleted-user id |

A card has no separate creator field, so `Created by` is derived from the first
`ADD_CARD` or `DUPLICATE_CARD` command whose payload names the card. It is a
dash for cards imported before the command log.

### Properties

Non-deleted cards show a compact `Properties` panel: title, assignee, due date,
priority, cover and labels. Each saved change is its own command —
`UPDATE_CARD`, `SET_CARD_ASSIGN`, `SET_CARD_DUE_DATE`, `SET_CARD_PRIORITY`,
`SET_CARD_COVER`, or one `SET_CARD_LABEL` per toggled label — sent with a fresh
`commandId` under the same owner-attribution banner. Unchanged values are not
sent. Archived cards keep the panel because their fields remain editable;
deleted cards hide it.

Clearing the assignee sends `assigneeId: null`; clearing the due date or cover
omits the field. Priority `medium` is the default and is stored as an absent
value. The assignee list contains accepted, unexpired members; disabled users
are hidden from new choices for UX (a current disabled assignee stays visible
as the current value), although the backend would still accept an active
membership. Labels are the board's live labels only, and a card is capped at
20.

### Checklists and links

Non-deleted cards also show a `Checklists and links` panel beside the
properties editor. It uses the same owner-attribution banner and sends one
fresh command per change:

| Change | Command |
| --- | --- |
| Add, rename or delete a checklist | `ADD_CHECKLIST`, `RENAME_CHECKLIST`, `DELETE_CHECKLIST` |
| Add, toggle, rename or delete an item | `ADD_CHECKLIST_ITEM`, `SET_CHECKLIST_ITEM_DONE`, `RENAME_CHECKLIST_ITEM`, `DELETE_CHECKLIST_ITEM` |
| Add or remove a card link | `ADD_CARD_LINK`, `REMOVE_CARD_LINK` |

Checklists are capped at 20 per card and 100 items per checklist; the server
also refuses a fresh add at either cap with `409 conflict: "wip"` before any
command or audit row is written. Deleted checklists and items are filtered out
of the editor. Deleting a checklist asks for confirmation. Links show both
directions with the stored type and a readable phrase: outgoing `blocks` reads
as “blocks”, incoming as “is blocked by” (the same reverse phrasing is offered
when adding: relates to, blocks, is blocked by, duplicates, is duplicated by).
The counters separate the viewed card's live outgoing rows (which own its
50-link cap) from live incoming rows; a live incoming row whose holder card is
deleted remains readable as dangling but is not counted. With a reverse option
the form shows the
selected target holder's own outgoing count and cap. Incoming rows are removed
through their holder card, not through the viewed card. The target combobox is
loaded lazily from the board content when the link editor opens and excludes
the current card, archived cards and already-linked pairs; a `blocks` edge that
would create a cycle is refused. Checklist/item commands do not refetch the
board or close the link editor. Both link commands refetch the aggregate;
`ADD_CARD_LINK` closes the editor after success, while `REMOVE_CARD_LINK`
leaves it open. Dangling or soft-deleted link
rows stay readable, and a live dangling row can still be removed to free the
cap.

Deleted cards hide the editor. Archived cards keep checklist and link editing;
only moving an archived card is blocked. Every accepted change appears as a
`board.command` audit row with `commandId`, `masterId` and `masterEmail`, while
the board history still names the owner. A rejected fresh write creates no
command or audit row.

### Sections

- Description, when present, shown as preformatted text. The card Actions menu
  opens `Edit description`, which sends an `UPDATE_CARD` command through the
  same owner-attribution banner and command log as the content editor.
- Labels, as color chips.
- Checklists, each with a title, a `done/total` progress count, its live items
  and inline add/rename/toggle/delete controls.
- Links, both directions: outgoing links with an up-right arrow and incoming
  links with a down-left arrow, each with the stored `blocks`, `relates_to` or
  `duplicates` type, a readable relation phrase, a `Deleted` badge when the
  row is soft-deleted, and a `Card deleted` badge for a dangling target.
- Attachments table: File (thumbnail, name, download), Size, Uploaded by,
  Created, Status, Actions.
- Comments table: Comment, Author (linked), Created, Status, Actions.
- Timeline, a merged feed of activity rows and commands, each with a type
  badge, the actor email linked to the profile, the details as JSON and the
  time. A command issued from the panel also shows an `Audit` link to its exact
  audit row; normal user commands have no link.

Comments, attachments and the timeline are windows, not full lists. Each
block footer reads `50 of N` and offers `Load more` while `N` is larger. The
comment total is the exact live comment count (`Card.commentIds`); the
attachment total counts the live attachment rows shown in the block, including
files embedded in the description (the card-face `attachmentCount` badge counts
non-inline files only); the timeline total is the exact sum of activity rows
and commands that touch the card. Comments and attachments show live rows by default;
`Show deleted (N)` adds soft-deleted rows. When a search result points at a specific comment or
attachment, the link uses `?comment=<id>` or `?attachment=<id>`; the card
detail centres that block on the row, highlights it and offers
`Show from the start`. A deleted anchor still opens the row because the
anchored block includes deleted rows. A block window stops at 5,000 rows; for
deeper history use the searchable Commands and Activity lists with the card id.

The Actions menu on a live comment or attachment deletes that single row
(confirmed; the audit log records it). The block then reloads with deleted
rows included, so the affected row stays visible with its `Deleted` badge
instead of disappearing.

## Columns

`/app/admin/columns` lists every kanban column. The subtitle is `Every kanban
column on the platform`.

| Column | Value |
| --- | --- |
| Column | title |
| Board | board title, linked |
| Position | sort position |
| WIP limit | work-in-progress limit, or a dash |
| Cards | live card count |
| Updated | last update time |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection. The
`Filters` button offers Board; an exact column, card or label id from an old
link still narrows the list and resolves to a readable chip.

## Labels

`/app/admin/labels` lists the board label palette. The subtitle is `Board label
palette`.

| Column | Value |
| --- | --- |
| Label | the label as a color chip |
| Board | board title, linked |
| Position | sort position |
| Cards | cards carrying the label |
| Version | the label version |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection. The
`Filters` button offers Board; an exact column, card or label id from an old
link still narrows the list and resolves to a readable chip.

## Checklists

`/app/admin/checklists` lists checklists across all cards. The subtitle is
`Checklists across all cards`.

| Column | Value |
| --- | --- |
| Checklist | title |
| Card | card title, linked |
| Board | board title, linked |
| Done | `doneCount/itemCount` |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection. The
`Filters` button offers Board and Card, so a check can start from the board or
from one exact card.

## Card links

`/app/admin/cardLinks` lists the directional links between cards. The subtitle is
`Directional blocks / relates to / duplicates`.

| Column | Value |
| --- | --- |
| From card | the source card title, linked |
| Type | `blocks`, `relates_to` or `duplicates` |
| To card | the target card title, linked |
| Board | board title, linked |
| Created | creation time |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection. The
`Filters` button offers Board, Card and Link type (`Blocks`, `Relates to`,
`Duplicates`). The Card facet matches either side of the link.

## Comments

`/app/admin/comments` moderates comments across every board. The subtitle is
`{total} comments across every board`.

| Column | Value |
| --- | --- |
| Comment | the comment text, truncated, with its kind badge |
| Card | card title, linked |
| Author | author email, linked |
| Created | creation time |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, period tabs, pagination and bulk
selection. The `Filters` button offers:

| Facet | Values |
| --- | --- |
| Board | one exact board id |
| Card | one exact card id |
| Author | one exact user id |
| Comment kind | `Note`, `Status`, `Question`, `Blocker`, `Evidence`, `Handoff` |

The period tabs apply to `createdAt`. **All** includes live and soft-deleted
rows; **Active** and **Deleted** use the comment's own `deletedAt`. A live
comment on an archived or deleted board or card still appears in Active.
Column and label ids from old links remain supported and are shown as chips,
but they are not offered in the picker because board and card already narrow
the list.

The row action `Delete` soft-deletes the comment, so it becomes invisible for
members.

## Attachments

`/app/admin/attachments` lists files uploaded to cards. The subtitle is `Files
uploaded to cards`.

| Column | Value |
| --- | --- |
| File | a thumbnail, the file name and a download control |
| Card | card title, linked |
| Board | board title, linked |
| Size | the file size |
| Type | the MIME type |
| Encode | the video transcode state: `none`, `pending`, `done` or `failed` |
| Uploaded by | uploader email, linked |
| Created | creation time |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, period tabs, pagination and bulk
selection. The `Filters` button offers:

| Facet | Values | Notes |
| --- | --- | --- |
| Board | one exact board id | |
| Card | one exact card id | |
| Uploader | one exact user id | |
| File type | `Images`, `Videos`, `PDF`, `Documents`, `Other` | derived case-insensitively from the stored MIME type |
| Video processing | `Pending`, `Failed`, `Done`, `No transcoding` | `No transcoding` covers non-video files and videos uploaded with transcoding disabled |

The period tabs apply to `createdAt`. Images and videos match their MIME
prefix, PDF matches `application/pdf`, and Documents covers `text/*`, RTF and
legacy/Open XML Office formats. Other covers the remaining types, including
JSON, audio and archives. The tab keeps inline rows visible with an `Inline`
badge and detached description files with a `Detached` badge; there is no
inline filter in this version. The card `Has card attachments` filter counts
card-face files only, so an inline-only card can appear here while its
`No card attachments` chip is active.

Row actions:

- `Delete file` (when the row is live): soft-deletes the attachment. The
  confirm dialog explains that the file is hidden from the card and can be
  restored. The row then shows `Restore`, and the retention purge later
  reclaims the blob.
- `Restore` (when the row is deleted): clears `deletedAt`, so the file streams
  again.

## Sessions

`/app/admin/sessions` lists active refresh sessions across all users. The subtitle
is `{total} active sessions`. Only sessions that are not revoked and not
expired are listed.

| Column | Value |
| --- | --- |
| User | user email, linked |
| Started | creation time |
| Expires | expiry time |
| IP | the session IP, or a dash |
| Client | the user agent, or a dash |
| Session | the session id, as a copyable chip |

The page has a search box, period tabs and pagination. The row action
`Revoke session` revokes that one session; other sessions stay alive.

## API tokens

`/app/admin/tokens` lists personal API tokens across all users. The subtitle is
`{total} personal tokens`.

| Column | Value |
| --- | --- |
| Token | the token name |
| User | user email, linked |
| Created | creation time |
| Last used | last use time, or a dash |
| Expires | expiry, or a dash when non-expiring |
| Status | `Active` or `Revoked` |

The page has a search box, period tabs and pagination. The row action `Revoke`
is shown only for an active token. Revoking stops every integration using that
token immediately.

## Public shares

`/app/admin/shares` lists read-only board links created for any board. The
subtitle is `Read-only board links minted against any board — inspect and
revoke.`

| Column | Value |
| --- | --- |
| Board | board title, linked, with the `/s/<token>` path below; a `board gone` badge when the board is deleted or archived |
| Mode | `Live` or `Snapshot` |
| Flags | `comments` and `attachments` when included, otherwise a dash |
| Views | the view count |
| Created | creation time |
| Actions | copy, open and revoke |

The search box matches the board, the token or the board id. Per row:

- `Copy` copies the full share URL.
- `Open` opens the share in a new tab.
- `Revoke` revokes an active link; a revoked link shows a `revoked` badge.

A live share of a deleted board no longer opens, and deleting a board revokes
its live links automatically. A snapshot is a frozen copy and keeps opening
after the board is gone.

## Where to go next

The dashboard and logs are on [monitoring and logs](/docs/admin/monitoring/). The email,
security, operations and communications pages are on
[email, security and operations](/docs/admin/settings/).
