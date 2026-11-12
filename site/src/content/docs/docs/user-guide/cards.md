---
title: Card details and the quick menu
description: Every field of a card, the right-click quick menu, archive and delete, and the activity feed.
---

A card holds everything about one piece of work. Open it by clicking its face
on the board, by using `Open card` in the quick menu, or by following a card
link that ends in `?card=<id>`.

## The quick menu

**Right-click a card** (on the board, a calendar chip or a table row) to open
a quick menu with the card's editors and a few actions — without opening the
full dialog.

![The card quick menu, opened by right-clicking a card.](/screens/card-quick-menu.png)

- **Open card** — opens the card dialog.
- **Labels** — toggle the board's labels, or create a new one, inline.
- **Due date** — a calendar and time picker.
- **Priority** — pick one of six levels.
- **Assignee** — search the board's members.
- **Link card** — pick a relation and a target card.
- **Cover** — a color or gradient strip.
- **Checklists** — tick items and add new ones.
- **Add comment** — write a comment and send it.
- **Copy card link** and **Open in new tab**.
- **Duplicate card** and **Archive**.

A viewer sees only the read-only actions: `Open card`, `Copy card link` and
`Open in new tab`.

## The card dialog

The dialog opens as a near full-height panel. The title and selected labels are
at the top; hover or focus the title to copy a link to the card. The content
scrolls, with properties alongside it on wider screens and directly below the
header on smaller screens. Use the actions menu next to the close button for card actions.

### Title

The `Title` field saves as you type. It grows with its content and scrolls
after a few lines.

### Description

`Description` is a rich-text editor for Markdown. The toolbar offers undo and
redo, a block-type menu (paragraph, headings, quote), bold and italic,
strikethrough, inline code, bulleted, numbered and check lists, and links.
Tables and images have no toolbar buttons, but tables and images in Markdown are
preserved when you edit and save the description.

Edits are committed when you leave the editor, so the history shows one change
per editing session.

Pasting a file uploads it as an attachment and embeds it at the cursor: an
image renders inline and any other file becomes a download link. Uploads need
the server; in the no-backend (local) mode pasting a file reports that it needs
the server.

### Labels

Use `Labels` under the title to open the label picker. Click a chip to toggle it, or use
`New label` to create one with a name and a color. Each chip has a menu to
rename, change its color or delete it (deleting removes the label from every card).

### Priority

The `Priority` row offers six levels: `Blocker`, `Highest`, `High`, `Medium`,
`Low` and `Lowest`. The default is `Medium`. The priority shows on the card
face.

### Due date

The `Due date` row opens a calendar and a time field. Picking a day or
changing the time applies at once, and `Remove due date` clears it. The card
face shows the deadline, colored red when it is overdue and yellow when it is
due within a day.

### Assignee

The `Assignee` row searches the board's members. Pick a person to assign the
card, or `Unassigned` to clear it. The assignee's avatar shows on the card
face and in the table.

A card can also be _claimed_: it is reserved for one agent while that agent
works on it, so another agent cannot claim it at the same time. A claim is not
an assignment and expires automatically. The `History` tab shows who claimed
or released the card.

### Task spec

When an agent sets a machine-readable task contract over the API or MCP, the
dialog shows a read-only `Task spec` section with the card's `Acceptance
criteria` and `Definition of done` as short lists. It is there for a human to
review what the agent was told to do; the section is hidden while the card has
no contract.

### Linked cards

Choose `Link card` in the linked cards section to connect cards. Pick a relation
from `blocks`, `is blocked by`, `relates to`, `duplicates` or `is duplicated
by`, then search for a card and press Enter. The editor closes after you add a
link, press `Cancel`, or click outside it; existing links stay listed. A link
row opens the linked card; a remove button appears on hover. A `blocks` link
that would create a circular dependency is refused.

### Cover

The `Cover` row sets a decorative strip on the card face. Choose a color
(`Red`, `Orange`, `Yellow`, `Green`, `Teal`, `Cyan`, `Blue`, `Indigo`,
`Brand`, `Fuchsia`, `Pink`, `Slate`) or a gradient (`Sunset`, `Ocean`,
`Forest`, `Candy`, `Grape`, `Steel`). `Remove cover` clears it.

### Checklists

The `Checklists` section holds subtask lists. Use `Add checklist` to create
one, then add items with the `Add an item…` field. Click an item's box to
check it, double-click its text to rename it, and use the item's cross to
remove it. Each checklist has a menu to rename or delete it and a progress bar
with a `done of total tasks` count.

### Attachments

The `Attachments` section lists the card's files. Use `Add file` to upload
one, `Download` to save it, and the trash button to delete it (only the
uploader or a board admin can delete). Images show a thumbnail; other files
show a type icon, their size and their date. Files pasted into a description
also appear here after the description is saved. Removing one from the
description hides it from this list if it is no longer referenced by another
description or comment. Undo restores it; redo hides it again. Files added
directly stay until explicitly deleted. Older uploads are not automatically
classified as description uploads.

For undo and saved snapshots, hidden files remain stored and count toward the
20-file limit. Expand `Removed from descriptions` to permanently delete them
and free space; undo and snapshots can no longer restore a deleted file.
Deleting a file explicitly can make it unavailable wherever it is referenced.

When video processing is enabled, uploaded videos are converted in the
background to H.264/AAC MP4. An MP4 original is kept if the result is no
smaller; other video formats are converted for compatibility even if the
result is larger. If conversion fails, the original stays available. Other
files are not compressed. An MP4 container can contain codecs that a given
browser cannot play, including when the original is kept. `Encoding…` appears
while a video is processed.

### Move to column

The `Column` row shows the card's current column. Open it and choose
`Move to column` to move the card to another column. A full destination column
is disabled in the list.

## Duplicate, archive and delete

Open the actions menu next to the close button to `Duplicate card`, `Archive`
the card, or delete it.

- **Duplicate** copies the card's content into the same column, immediately
  below the original. It is disabled when the column has reached its card limit.
- **Archive** takes a card off the board but keeps it: archived cards stay in
  search and in the card archive, and the dialog shows `Send back to board`, which restores the card to a
  column you pick.
- **Delete** asks for confirmation and removes the card permanently. From the
  archive, the same action reads `Delete forever`.

The card archive is opened from the data menu (see
[Account, keys and preferences](/docs/user-guide/account/)).

## The activity feed

![The card's activity feed with the Comments and History tabs.](/screens/card-activity.png)

The `Activity` section is the last part of the dialog. It has two tabs,
`Comments` and `History`, each showing a count when it has entries.

### Comments

Comments are written in the same Markdown editor as the description, with
`Save` and `Cancel`. Press Ctrl+Enter (or Cmd+Enter) to save. Comments are
listed newest first, with `Show older comments` to page back. You can delete
your own comments after confirmation, and edit them with the pencil next to
the delete icon: `Save` or Ctrl/Cmd+Enter applies the change, `Escape`
cancels. An edited comment keeps its place in the thread and shows an
`edited` marker; only the author can edit or delete a comment. Comments need
server mode.

### History

History lists everything that happened to the card, newest first, with the
author and a from-to diff for each change — title, description, column,
labels, priority, due date, assignee, claim and release, task spec, links,
cover, checklists, comments, archive and restore. Entries an agent made carry
an `Agent` badge. Use `Show older` to page back.

## Next

- [Collaboration, sharing and search](/docs/user-guide/collaboration/)
