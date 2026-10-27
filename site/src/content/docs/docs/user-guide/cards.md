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
- **Cover** — a colour or gradient strip.
- **Checklists** — tick items and add new ones.
- **Add comment** — write a comment and send it.
- **Copy card link** and **Open in new tab**.
- **Duplicate card** and **Archive**.

A viewer sees only the read-only actions: `Open card`, `Copy card link` and
`Open in new tab`.

## The card dialog

![The card dialog: title, description editor, labels, priority, due date, assignee and linked cards.](/screens/card-dialog.png)

The dialog opens as a near full-height panel. Its header reads `Card details`,
and a copy-link button appears when you hover it. The body scrolls while the
action footer stays reachable.

### Title

The `Title` field saves as you type. It grows with its content and scrolls
after a few lines.

### Description

`Description` is a rich-text editor for Markdown. The toolbar offers undo and
redo, a block-type menu (paragraph, headings, quote), bold and italic,
strikethrough, inline code, bulleted, numbered and check lists, and links.
Tables and images have no toolbar buttons, but Markdown that contains them
still round-trips.

Edits are committed when you leave the editor, so the history shows one change
per editing session.

Pasting a file uploads it as an attachment and embeds it at the cursor: an
image renders inline and any other file becomes a download link. This needs
server mode; in local mode pasting a file reports that it requires server
mode.

### Labels

The `Label` row is a multi-select picker. Click a chip to toggle it, or use
`New label` to create one with a name and a colour. Each chip has a menu to
rename, recolour or delete it (deleting removes the label from every card).

### Priority

The `Priority` row offers six levels: `Blocker`, `Highest`, `High`, `Medium`,
`Low` and `Lowest`. The default is `Medium`. The priority shows on the card
face.

### Due date

The `Due date` row opens a calendar and a time field. Picking a day or
changing the time applies at once, and `Remove due date` clears it. The card
face shows the deadline, coloured red when it is overdue and yellow when it is
due within a day.

### Assignee

The `Assignee` row searches the board's members. Pick a person to assign the
card, or `Unassigned` to clear it. The assignee's avatar shows on the card
face and in the table.

### Linked cards

The `Linked cards` section connects cards with a relation. Pick a relation
from `blocks`, `is blocked by`, `relates to`, `duplicates` or `is duplicated
by`, then search for a card and press Enter. A link row opens the linked card;
a remove button appears on hover. A `blocks` link that would create a circular
dependency is refused.

### Cover

The `Cover` row sets a decorative strip on the card face. Choose a colour
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
show a type icon, their size and their date. A large image or video may show
`Encoding…` while the server prepares a smaller copy.

### Move to column

The `Column` row shows the card's current column. Open it and choose
`Move to column` to move the card to another column. A full destination column
is disabled in the list.

## Duplicate, archive and delete

At the foot of the dialog you can `Duplicate card`, `Archive` the card, or
delete it.

- **Duplicate** copies the card's content and lands in the same column, right
  below the original. It is disabled when the column cannot take another card.
- **Archive** takes a card off the board but keeps it: archived cards stay in
  search and in the card archive, and the dialog footer flips to `Send back to
  board`, which restores the card to a column you pick.
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
`Save` and `Cancel`. Press Ctrl+Enter (or Cmd+Enter) to save. Comments list
newest first, with `Show older comments` to page back. You can delete your own
comments, behind a confirmation. Comments need server mode.

### History

History lists everything that happened to the card, newest first, with the
author and a from-to diff for each change — title, description, column,
labels, priority, due date, assignee, links, cover, checklists, comments,
archive and restore. Use `Show older` to page back.

## Next

- [Collaboration, sharing and search](/docs/user-guide/collaboration/)
