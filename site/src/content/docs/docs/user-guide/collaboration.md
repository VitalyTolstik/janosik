---
title: Collaboration, sharing and search
description: Board members and roles, realtime updates, public read-only links, search, filters and shortcuts.
---

Members, realtime updates and public share links all come from the server, so
they are present in the shipped app. (In the no-backend local mode there is one
person and one browser, and those controls are hidden.)

## Board members and roles

The members button in the header opens the member list. Everyone on a board
can open it; only an admin can change it.

![The members dialog: the roster with role pickers and an invite form.](/screens/members.png)

Each board has three roles:

- `Admin` — manages members and share links, and can archive or delete the
  board.
- `Member` — can edit the board freely.
- `Viewer` — can only view the board.

A board can never lose its last active admin: the last admin cannot be
demoted, removed or leave. Pending and expired admin rows do not count as a
replacement.

### Invite by email

An admin uses the `Invite by email` form: type an address, pick a `Role` and
submit with `Invite`. The invitation is pending until the invitee accepts it.
The confirmation reads `If <email> has a Janosik account, they'll see the
invitation` whatever the address: the app never reveals who has an account.
An address without an account receives nothing, so invite the person again
once they have signed up.
For a `Viewer`, the admin can also set an `Access until` date, after which the
access expires.

### Manage members

An admin can change a member's role at any time, set or clear a viewer's
expiry, and remove a member (behind a confirmation). A viewer's row shows
`no expiry`, `until <date>` or `access expired`. An expired viewer stays on
this list so an admin can remove the row or invite the person again; the
lapsed row never grants access.

### Leave a board

Your own row in the members dialog has `Leave board`, behind a confirmation.
On narrow screens, or without opening the dialog, the same action is available
from the board switcher: open it and use the leave icon on the board's row.
Leaving removes your membership, so the board disappears from the switcher and
a direct board URL is denied. Cards and comments you wrote stay on the board
and keep your name in history and comment attribution. An admin can leave only
while another active admin remains; otherwise the app explains that another
admin is needed and refreshes the roster.

## Invitations

The bell in the header lists your pending board invitations. Each row shows
the board, who invited you, the role and a viewer's expiry. Use `Accept` to
join the board — it then appears in your switcher — or `Decline` to refuse.
Invitations appear only once you have confirmed your email address. If they
fail to load, use **Retry loading invitations** in the bell.

## Attention inbox

Open the bell in the header to see attention notifications and pending board
invitations. The badge counts unread attention notifications and pending
invitations. You can browse older notifications and mark one or all as read.

To stop immediate emails for these events, open **Account → Profile** and turn
off **Attention emails**. You can still read events in the bell. Scheduled
digests and due reminders use the separate digest preference.

## Realtime updates and presence

While a board is open, changes made by other members appear without a reload,
and the list of online members in the header shows who is on the board now.

<video controls muted loop playsinline poster="/media/feature-realtime.jpg">
  <source src="/media/feature-realtime.mp4" type="video/mp4" />
</video>

When someone else changes a card, it is briefly outlined in the author’s color.
Your own changes are not highlighted. If
the connection drops, the app reconnects and catches up from the last event it
saw. If it missed too much to catch up event by event, it reloads the board
instead. When your access to the board ends (you are removed, a viewer's
access expires), the live connection closes. The stream also re-checks the
credential that opened it: an expired access token, a password/email change,
sign-out, a revoked/expired API key or an API key narrowed to another board
closes it on the next keep-alive.

In server mode, edits are applied at once and sent to the server. If the
server refuses a change, the app rolls it back and shows a message. If the
network is down, the change is not saved and the app says so.

## Public read-only share links

An admin can open the share dialog to create read-only links anyone can open
without an account.

![The share dialog: pick a mode, options and an expiry, then create the link.](/screens/share.png)

Choose a mode:

- `Live` follows the board as it changes.
- `Snapshot` saves the board and member list as they are when the link is
  created. Select comments and attachments to save their current versions
  with the snapshot. Captured content stays available after changes,
  archival or permanent deletion of the board, until the link is revoked
  or expires. A board admin can refresh the snapshot to publish current
  content. Comments are off by default for snapshots. Each snapshot can capture
  up to 500 attachments totaling 100 MiB and up to 1,000 comments totaling
  10 MiB of serialized comment data. A legacy board-only snapshot can display
  pre-capture comments and files while the source board and rows are available.
  Refresh it while the source is accessible to preserve independent copies.

Each link can show existing comments and attachments, and can be given an
expiry: `Never`, 1 hour, 24 hours, one week or about a month. Optionally give
the link a label for your own list.

Each board can have up to 5 active live links and 10 active snapshots. Expired
and revoked links do not count toward these limits. Similar links can still be
created when separate access or snapshots are needed.

Creating, changing, refreshing, revoking or permanently deleting a link from a
board records an audit event in the server database. The record keeps the
actor, time and link settings without storing the access token, and survives
removal of the link. Events before this audit was introduced cannot be
reconstructed.

`Create link` copies the new link to your clipboard. The active-links list
lets you `Copy link`, copy an `Embed code` (an `<iframe>` snippet), `Refresh`
a snapshot, or `Revoke` a link. A revoked or expired link stops working, and
a visitor already watching a live link is disconnected. Refreshing a snapshot
replaces public content, so it follows the board's `share.update` policy: a
PAT on a board that requires approval gets `409 approval_required` and must
retry with `X-Approval-Id`; the applied refresh is audited.
Select Live or Snapshot to see links of that type.

`Edit` changes a link's label, comments and attachments visibility, and
expiry. Its mode and `/s/<token>` stay fixed. Changing what a live link shows
asks for confirmation before saving, and the update is audited like the other
link changes.

When copying an embed code, choose System, Light or Dark. System follows the
visitor's device preference; Light and Dark keep a fixed appearance. The
embedded board does not automatically follow a theme chosen on the host site.

![A live share link opened without an account: the board read-only, marked Live · read-only.](/screens/public-share.png)

A visitor to a live link sees `Live · read-only`; a snapshot shows
`Shared · read-only`. The link address ends in `/s/<token>`.

## Global search

`Global search`, or Ctrl+K (Cmd+K on a Mac), searches titles, descriptions and
labels across every board.

![Global search results, grouped into cards and boards.](/screens/search.png)

Results are grouped into `Cards` and `Boards`, and a card result shows a
`Board › Column` breadcrumb, its label chips and a description snippet when
the match was in the text. Archived items carry an `Archived` badge. Use the
arrow keys to move and Enter to open; opening a card takes you to its board
with the card's dialog open.

Each group shows up to 20 matches. When a group has more, its heading shows
`20 of N` and the footer offers `Show all results`; the list then scrolls
inside the palette. Capping happens per group, so a board hit is never hidden
under a long list of card hits.

`Show all results` expands at most 200 matches per group and keeps both the
keyboard selection and the scroll position. If more than 200 remain, the
heading keeps showing `shown of N`. While other boards are still loading, the
heading says `20 of N loaded`, so a partial total is not mistaken for the whole
workspace.

## The board filter bar

The filter bar sits above the board. Its search box matches a card's title,
description and labels; press `/` anywhere on the board to focus it. Press
Escape once to clear the query and again to leave the box.

![The faceted filters: due date, labels, priority, assignee, links and created.](/screens/filters.png)

The `Filters` button opens the faceted filters:

- `Due date`: `Any due date`, `Overdue`, `Due soon (≤24 h)` or `No due date`.
- `Labels`: pick any labels, choose whether cards must match `All` or `Any`,
  and include cards with `No label`.
- `Priority`: pick one or more levels.
- `Assignee`: pick members, or `Unassigned`.
- `Links`: `Blocked` cards, or cards with links (`Has links`).
- `Created`: `Any time`, `Today`, `Last 7 days`, `Last 30 days` or a specific
  `On date…`.

Active filters appear as removable chips, and the bar shows a result count and
a `Reset filters` button. While any filter is active, dragging is disabled.

## Keyboard shortcuts

Press `?` anywhere outside a text field, or click the keyboard icon in the
header, to open the cheat sheet. It shows the shortcuts available in
the current view. Letter shortcuts follow the typed letter on Latin layouts
and the physical key position on Russian layouts. Use the key that types
`?` on your layout to open the cheat sheet. Undo and redo pause while a
dialog or menu is open.

![The keyboard shortcut cheat sheet.](/screens/shortcuts.png)

| Action | Keys |
| --- | --- |
| Search across boards | Ctrl+K or Cmd+K |
| Focus the board filter (Board, Calendar and Table) | / |
| Undo | Ctrl+Z or Cmd+Z |
| Redo | Ctrl+Shift+Z, Ctrl+Y or the Cmd equivalents |
| New card (Board view, with edit access) | N |
| New column (Board view, with edit access) | C |
| Next card (Board view) | J |
| Previous card (Board view) | K |
| Open selected card (Board view) | E or Enter |
| This cheat sheet | ? |
| Close overlay / cancel | Esc |

Ctrl+click, Cmd+click or a middle click on a card opens it in a new tab.
