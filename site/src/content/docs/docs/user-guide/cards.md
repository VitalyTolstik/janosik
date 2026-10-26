---
title: Card details
description: Every field of a card, the right-click menu, archive and delete, and the activity feed.
---

A card holds everything about one piece of work. Open it by clicking its
face on the board, by using `Open card` in the right-click menu, or by
following a card link that ends in `?card=<id>`.

<video controls muted loop playsinline poster="/media/feature-cards.jpg">
  <source src="/media/feature-cards.mp4" type="video/mp4" />
</video>

## The card dialog

The dialog opens as a near full-height panel. Its header reads `Card details`
and a copy-link button appears when you hover it. The body scrolls while the
action footer stays reachable.

### Title

The `Title` field saves as you type. It grows with its content and scrolls
after a few lines. The limit is 300 characters.

### Description

`Description` is a rich text editor for Markdown. The toolbar offers undo and
redo, a block type menu (paragraph, headings, quote), bold and italic,
strikethrough, inline code, bulleted, numbered and check lists, and links.
Tables and images have no toolbar buttons, but Markdown that contains them
still round-trips.

Edits are committed when you leave the editor, not on every keystroke, so the
history shows one change per editing session. The limit is 10000 characters.

Pasting a file uploads it as an attachment and embeds it at the cursor: an
image renders inline and any other file becomes a download link. This needs
server mode; in local mode pasting a file reports that it requires server
mode.

### Labels

The `Label` row is a multi-select picker. Click a chip to toggle it, or use
`New label` to create one with a name and a color. Each chip has a menu to
rename it, recolor it or delete it (deleting removes the label from every
card). A card can carry up to 20 labels, and a board can define up to 50.

The palette offers red, orange, yellow, brown, green, teal, cyan, blue,
indigo, brand, fuchsia, pink, slate and plain.

### Priority

The `Priority` row offers six levels: `Blocker`, `Highest`, `High`, `Medium`,
`Low` and `Lowest`. The default is `Medium`, and picking it again stores no
value. The priority shows on the card face.

### Due date

The `Due date` row opens a calendar and a time field. Picking a day or
changing the time applies at once. `Remove due date` clears it. The card
face shows the deadline, colored red when it is overdue and yellow when it is
due within a day.

### Assignee

The `Assignee` row searches the board's members. Pick a person to assign the
card, or `Unassigned` to clear it. The assignee's avatar shows on the card
face and in the table view.

### Linked cards

The `Linked cards` section connects cards with a relation. Pick a relation
from `blocks`, `is blocked by`, `relates to`, `duplicates` or `is duplicated
by`, then search for a card and press Enter. A link row opens the linked
card; a remove button appears on hover.

A card can hold up to 50 links. A `blocks` link that would create a circular
dependency is refused. A link whose target was deleted is kept and shown as a
deleted card, and it still counts toward the limit.

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

A card can hold up to 20 checklists, each with up to 100 items. A checklist
title is up to 100 characters and an item is up to 200.

### Attachments

The `Attachments` section lists the card's files. Use `Add file` to upload
one, `Download` to save it, and the trash button to delete it (only the
uploader or a board admin can delete). Images show a thumbnail; other files
show a type icon, their size and their date. A large image or video may show
`Encoding…` while the server prepares a smaller copy.

A card can hold up to 20 attachments, and one file may be up to 25 MB. The
server rejects a file type it does not allow with `This file type is not
allowed`.

### Move to column

The `Column` row shows the card's current column. Open it and choose
`Move to column` to move the card to another column. A full destination
column is disabled in the list.

## The right-click menu

Right-clicking a card face, a calendar chip or a table row opens a quick
menu. It carries the card's editors and a few actions:

- `Open card`, then `Labels`, `Due date`, `Priority`, `Assignee`, `Link
  card`, `Cover`, `Checklists` and `Add comment`.
- `Copy card link` and `Open in new tab`.
- `Duplicate card` and `Archive`.

A viewer sees only the read-only actions: `Open card`, `Copy card link` and
`Open in new tab`.

## Duplicating, archiving and deleting

At the foot of the dialog you can `Duplicate card`, `Archive` the card, or
delete it.

A duplicate copies the card's content and lands in the same column, right
below the original. It is disabled when the column cannot take another card.

Archiving takes a card off the board but keeps it: archived cards stay in
search and in the card archive, and the dialog footer flips to `Send back to
board`, which restores the card to a column you pick. Delete asks for
confirmation and removes the card permanently. From the archive, the same
action reads `Delete forever`.

The card archive is opened from the data menu. It lists the active board's
archived cards, lets you search them, restore any card to a column, or delete
one forever.

## The activity feed

The `Activity` section is the last part of the dialog. It has two tabs:
`Comments` and `History`. Each tab shows a count when it has entries.

### Comments

Comments are written in the same Markdown editor as the description, with
`Save` and `Cancel`. Press Ctrl+Enter (or Cmd+Enter) to save. Comments list
newest first, with `Show older comments` to page back. You can delete your
own comments, behind a confirmation. Comments need server mode.

### History

History lists everything that happened to the card, newest first, with the
author and a from-to diff for each change. It records title, description,
column, labels, priority, due date, assignee, links, cover, checklists,
comments, archive and restore events. Use `Show older` to page back.

## Limits

| Field | Limit |
| --- | --- |
| Description | 10000 characters |
| Labels per card | 20 |
| Label name | 50 characters |
| Links per card | 50 |
| Checklists per card | 20 |
| Checklist title | 100 characters |
| Items per checklist | 100 |
| Checklist item | 200 characters |
| Attachments per card | 20 |
| Attachment size | 25 MB |
| Comment | 10000 characters |
| Stored activity events per card | 50 |
