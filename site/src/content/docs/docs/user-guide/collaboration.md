---
title: Collaboration, sharing and search
description: Board members and roles, realtime updates, public read-only links, search, filters and shortcuts.
---

Members, realtime updates and public share links all need server mode. In
local mode there is one person and one browser, so those controls are hidden.

<video controls muted loop playsinline poster="/media/feature-realtime.jpg">
  <source src="/media/feature-realtime.mp4" type="video/mp4" />
</video>

## Board members and roles

The members button in the header opens the member list. It is available to
everyone on a board; only an admin can change it.

Each board has three roles:

- `Admin`: manages members and share links, and can archive or delete the
  board.
- `Member`: can edit the board freely.
- `Viewer`: can only view the board.

A board can never lose its last admin: the last admin cannot be demoted or
removed.

### Inviting by email

An admin uses the `Invite by email` form: type an address, pick a `Role` and
submit with `Invite`. The invitation is pending until the invitee accepts it.
For a `Viewer`, the admin can also set an `Access until` date, after which the
access expires.

### Managing members

An admin can change a member's role at any time, set or clear a viewer's
expiry, and remove a member (behind a confirmation). A viewer's row shows
`no expiry`, `until <date>` or `access expired`.

## Invitations

The bell in the header lists your pending board invitations. Each row shows
the board, who invited you, the role, and a viewer's expiry. Use `Accept` to
join the board, which then appears in your switcher, or `Decline` to refuse.

## Realtime updates and presence

While a board is open, changes made by other members appear without a reload.
The presence stack in the header shows who is on the board now, with a live
dot while the roster is fresh.

When someone else changes a card, that card briefly wears a ring in the
author's color, so you can see what moved. Your own changes stay quiet.

If the connection drops, the app reconnects and catches up from the last
event it saw. Each open tab sends a heartbeat about every 20 seconds; a tab
that stops sending drops out of the roster after roughly a minute.

In server mode, edits are applied at once and sent to the server. If the
server refuses a change, the app rolls it back and shows a message. If the
network is down, the change is not saved and the app says so.

## Public read-only share links

An admin can open the share dialog to create read-only links anyone can open
without an account. Choose a mode:

- `Live` follows the board as it changes.
- `Snapshot` is a frozen copy captured now, which only you can refresh. A
  snapshot survives the board's deletion.

<video controls muted loop playsinline poster="/media/feature-sharing.jpg">
  <source src="/media/feature-sharing.mp4" type="video/mp4" />
</video>

Each link can include `Comments` and `Attachments`, and can be given an
expiry: `Never`, 1 hour, 24 hours, 168 hours (one week) or 720 hours (about a
month). Optionally give the link a label for your own list.

`Create link` copies the new link to your clipboard. The active links list
lets you `Copy link`, copy an `Embed code` (an `<iframe>` snippet), `Refresh`
a snapshot, or `Revoke` a link. A revoked or expired link stops working.

A visitor to a live link sees `Live · read-only`; a snapshot shows
`Shared · read-only`. The link address ends in `/s/<token>`.

## Global search

`Global search`, or Ctrl+K (Cmd+K on a Mac), searches titles, descriptions
and labels across every board. Results are grouped into `Cards` and `Boards`,
and a card result shows a `Board › Column` breadcrumb, its label chips and a
description snippet when the match was in the text. Archived items carry an
`Archived` badge.

Use the arrow keys to move and Enter to open. Opening a card takes you to its
board with the card's dialog open. Up to 20 results are shown.

## The board filter bar

The filter bar sits above the board. Its search box matches a card's title,
description and labels; press `/` anywhere on the board to focus it. Press
Escape once to clear the query and again to leave the box.

The `Filters` button opens the faceted filters:

- `Due date`: `Any due date`, `Overdue`, `Due soon (≤24 h)` or `No due
  date`.
- `Labels`: pick any labels, choose whether cards must match `All` or `Any`,
  and include cards with `No label`.
- `Priority`: pick one or more levels.
- `Assignee`: pick members, or `Unassigned`.
- `Links`: `Blocked` cards, or cards that `Has links`.
- `Created`: `Any time`, `Today`, `Last 7 days`, `Last 30 days` or a specific
  `On date…`.

Active filters appear as removable chips, and the bar shows a result count
and a `Reset filters` button. While any filter is active, dragging is
disabled and the bar says so.

The search box accepts up to 200 characters.

## Keyboard shortcuts

Press `?` anywhere outside a text field, or click the keyboard icon in the
header, to open the cheat sheet.

| Action | Keys |
| --- | --- |
| Search | Ctrl+K or Cmd+K |
| Undo | Ctrl+Z or Cmd+Z |
| Redo | Ctrl+Shift+Z, Ctrl+Y or the Cmd equivalents |
| New card | N |
| New column | C |
| Next card | J |
| Previous card | K |
| Open selected card | E or Enter |
| This cheat sheet | ? |
| Close overlay / cancel | Esc |

Ctrl+click, Cmd+click or a middle click on a card opens it in a new tab.
