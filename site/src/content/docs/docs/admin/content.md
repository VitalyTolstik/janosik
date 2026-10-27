---
title: Boards, cards and content
description: Boards and the board content editor, cards and card detail, and the columns, labels, checklists, links, comments, attachments, sessions, tokens and shares browsers.
---

The content section is the day-to-day moderation surface. It exposes boards,
cards and every board-scoped model the panel can list, plus the session, token
and public share browsers that sit under security.

## Boards

`/admin/boards` lists every board. The subtitle is `{total} boards`.

| Column | Value |
| --- | --- |
| Board | title |
| Owner | owner email, linked to the user detail page |
| Created | creation time |
| Updated | last update time |
| Status | `Active`, `Archived` or `Deleted` |

The page has a search box, status tabs (all, active, archived, deleted),
pagination, a `Create board` button and bulk selection.

### Create a board

The `Create board` dialog takes a title and an owner email. The owner becomes
the board `ADMIN`. An owner email with no matching user answers `404`.

### Row actions

| Action | Effect | Notes |
| --- | --- | --- |
| Edit content | opens the board content editor | no toast, pure navigation |
| Archive | sets `archivedAt` | confirmed; the board becomes read-only for members |
| Restore | clears `archivedAt` | shown when archived |
| Delete | soft-deletes the board | destructive, confirmed; purged after the retention window |

### Bulk actions

With rows selected, a bar appears with `Delete selected`, `Restore selected`
and `Clear`. A bulk delete is confirmed and cannot be undone for the selected
rows.

## Board detail

`/admin/boards/:id` shows the board meta, live counters, members, columns and
labels.

- The header carries the title, the owner email, an `Edit content` button and
  an actions menu with archive, restore and delete.
- The meta row shows Owner, Created, Updated and Version.
- Nine counters are shown: Members, Columns, Cards, Labels, Links, Comments,
  Files, Commands and Events.

### Members

| Column | Value |
| --- | --- |
| Member | user email, linked, with a `Disabled` badge when the user is blocked |
| Role | the member role |
| Accepted | acceptance time, or a `Pending` badge |
| Expires | expiry, or a dash |
| Invited by | inviter email, or a dash |
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
labels panel shows each label as a colour chip.

## Board content editor

`/admin/boards/:id/content` edits columns and cards without leaving the panel.

- The left panel lists columns with a card count. Each column has rename and
  delete controls; a composer at the bottom adds a column.
- The right panel lists the cards of the selected column. Each card has rename
  and archive controls; a composer at the bottom adds a card.
- A manual refresh button is in the header.
- The page polls the board aggregate every 2 seconds while it is visible and
  focused, so a running demo is watched in place.

Every mutation is a real board action sent through
`POST /admin/boards/:id/commands` on behalf of the board owner, the board's
first accepted `ADMIN`. The server re-validates each action with the shared
strict validator, so a refusal (a WIP limit, a size limit) surfaces as a toast
and changes nothing. The editor sends `ADD_COLUMN`, `ADD_CARD`, `RENAME_COLUMN`,
`UPDATE_CARD`, `ARCHIVE_CARD` and `DELETE_COLUMN`, each stamped with the
command clock. The command log, versions and the board UI stay consistent.

A column delete is a soft delete: the column and its cards disappear for
members. The confirm dialog states this.

## Cards

`/admin/cards` lists every card on the platform. The subtitle is `{total} cards
across every board`.

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

The page has a search box, status tabs, pagination and bulk selection.

Row actions: `Archive` (confirmed), `Restore` (when archived) and `Delete`
(destructive, confirmed).

## Card detail

`/admin/cards/:id` shows the full card graph. The header carries the title, the
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
| Last changed by | the label of the last actor, or a dash |

A card has no creator column, so `Created by` is derived from the first
`ADD_CARD` or `DUPLICATE_CARD` command whose payload names the card. It is a
dash for cards imported before the command log.

### Sections

- Description, when present, shown as preformatted text.
- Labels, as colour chips.
- Checklists, each with a title, a `done/total` count and its live items.
- Links, both directions: outgoing links with an up-right arrow and incoming
  links with a down-left arrow, each with a type badge and a `Deleted` badge
  when applicable. Types are `blocks`, `relates_to` and `duplicates`.
- Attachments table: File (thumbnail, name, download), Size, Uploaded by,
  Created.
- Comments table: Comment, Author, Created, Status.
- Timeline, a merged feed of activity rows and commands, each with a type
  badge, the actor email, the details as JSON and the time.

## Columns

`/admin/columns` lists every kanban column. The subtitle is `Every kanban
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

The page has a search box, status tabs, pagination and bulk selection.

## Labels

`/admin/labels` lists the board label palette. The subtitle is `Board label
palette`.

| Column | Value |
| --- | --- |
| Label | the label as a colour chip |
| Board | board title, linked |
| Position | sort position |
| Cards | cards carrying the label |
| Version | the label version |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection.

## Checklists

`/admin/checklists` lists checklists across all cards. The subtitle is
`Checklists across all cards`.

| Column | Value |
| --- | --- |
| Checklist | title |
| Card | card title, linked |
| Board | board title, linked |
| Done | `doneCount/itemCount` |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection.

## Card links

`/admin/cardLinks` lists the directional links between cards. The subtitle is
`Directional blocks / relates to / duplicates`.

| Column | Value |
| --- | --- |
| From card | the source card title, linked |
| Type | `blocks`, `relates_to` or `duplicates` |
| To card | the target card title, linked |
| Board | board title, linked |
| Created | creation time |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection.

## Comments

`/admin/comments` moderates comments across every board. The subtitle is
`{total} comments across every board`.

| Column | Value |
| --- | --- |
| Comment | the comment text, truncated |
| Card | card title, linked |
| Author | author email, linked |
| Created | creation time |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection. The row
action `Delete` soft-deletes the comment, so it becomes invisible for members.

## Attachments

`/admin/attachments` lists files uploaded to cards. The subtitle is `Files
uploaded to cards`.

| Column | Value |
| --- | --- |
| File | a thumbnail, the file name and a download control |
| Card | card title, linked |
| Size | the file size |
| Type | the MIME type |
| Encode | the video transcode state: `none`, `pending`, `done` or `failed` |
| Uploaded by | uploader email, linked |
| Created | creation time |
| Status | `Active` or `Deleted` |

The page has a search box, status tabs, pagination and bulk selection.

Row actions:

- `Delete file` (when the row is live): soft-deletes the attachment. The
  confirm dialog warns that the file is removed from storage. The row then
  shows `Restore`, and the retention purge later reclaims the blob.
- `Restore` (when the row is deleted): clears `deletedAt`, so the file streams
  again.

## Sessions

`/admin/sessions` lists active refresh sessions across all users. The subtitle
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

`/admin/tokens` lists personal API tokens across all users. The subtitle is
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

`/admin/shares` is the browser for read-only board links minted against any
board. The subtitle is `Read-only board links minted against any board,
inspect and revoke.`

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
