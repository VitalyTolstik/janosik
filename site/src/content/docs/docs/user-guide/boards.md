---
title: Boards, columns and cards
description: Create and manage boards, columns and cards, and switch between the board, calendar and table views.
---

A board is a set of ordered columns, and each column holds an ordered list of
cards. The board title lives in the header; the board switcher next to it
manages every board you can reach.

<video controls muted loop playsinline poster="/media/feature-board.jpg">
  <source src="/media/feature-board.mp4" type="video/mp4" />
</video>

## Boards

### Creating a board

Open the board switcher and use the `New board` row.
Type a name and press Enter to create it, or type a name into the search box
first: the footer then reads `Create "<name>"` and creates that board.
A new board starts empty and you are taken to it.

The empty state shows `No board yet.` with the hint `Create your first board
to get started.`. When every board is archived it shows `All boards are
archived.` instead.

### Switching boards

The switcher groups boards into `My boards` and `Shared with me` when both
exist. Each row shows a colored avatar, the board name and its card count.
Use the arrow keys to move and Enter to open, or click a row.
Boards shared with you carry a role icon: member (can edit) or viewer (view
only).

### Renaming a board

Click the board title in the header, type the new name and press Enter.
Press Escape to cancel. A viewer sees a plain heading and cannot rename.

### Archiving and restoring a board

In the switcher, hover a board you administer and click the archive icon.
The row asks `Archive?`; confirm with the check mark.
Archived boards drop into an `Archived` section at the bottom of the
switcher, where an admin can restore them or delete them for good.

### Deleting a board

Deletion is offered only for archived boards. In the `Archived` section,
click the trash icon and confirm `Delete?`. Deleting removes the board and
its cards permanently.

## Columns

### Adding a column

At the end of the column strip, click `Add column`, type a title and press
Enter. Escape cancels. The shortcut `C` opens the same control.

### Renaming a column

Double-click the column title, or open the column menu and choose `Rename`.
Type the new title and confirm.

### Reordering columns

Drag a column by its header (the grip handle) and drop it in a new position.
A read-only board cannot be reordered.

### Duplicating a column

Open the column menu and choose `Duplicate column`. The copy is placed next
to the original with all of its cards. Duplication is disabled when the board
already holds the maximum number of columns.

### Sorting a column

Open the column menu, choose `Sort cards`, then pick `By creation date`,
`By due date` or `By title`. Sorting is a one-shot action: dragging a card
afterwards returns the column to manual order.

### Archiving all cards in a column

Open the column menu and choose `Archive all cards`. The confirmation reads
`Archive all cards?` and explains that every card moves to the archive, where
you can restore it later.

### Deleting a column

Open the column menu and choose `Delete column`. The confirmation names the
column and the number of cards it will remove. Deleting a column deletes its
cards permanently.

### WIP limits

A WIP limit caps how many cards a column accepts. Open the column menu and
choose `WIP limit`, then enter a number from 1 to 99. Leave the field empty,
or use `Remove limit`, to clear it.

The column header shows `count/limit`. The counter turns yellow at the limit
and red past it. Further adds and moves into a full column are blocked, and
the app shows a message such as `"<column>" is at its WIP limit (<limit>)`.
A column can hold more than its limit after the limit is lowered or an edit
is undone; it simply refuses new cards until it is back under the limit.

### Column appearance

In the board view, open the column appearance menu next to the view switcher.
`Transparency` makes columns translucent over the board background, and
`Blur` frosts what shows through. Both apply live and are remembered.

## Cards on the board

### The composer

At the foot of each column, click `Add a card` to open the composer.
Type a title and press Enter to add the card; Shift+Enter inserts a new line.
The composer stays open so you can add several cards in a row, and the board
labels are offered as chips you can attach before adding.

Hovering between two cards reveals an insert zone, so a card can be added at
that exact position.

### The card face

Every card is the same fixed-size tile, so cards line up in a column.
The face shows the title and its labels on the first line, the due-date badge
on the second, and a row of badges below: a description marker, linked-card
counts, checklist progress, the priority and the assignee's avatar.
Click a card to open its details.

### Drag and drop

Drag a card by holding it: the mouse starts a drag after a short move, a
touch screen after a short press, and the keyboard can move the card too.
Drop a card between two cards in the same column to reorder, or into another
column to move it. A drop into a full column is refused and the card returns
to its place.

While a filter is active, dragging is disabled and the board says so.

### The keyboard cursor

Press `J` and `K` to move a highlight down and up through the visible cards.
Press `E` or Enter to open the highlighted card. Press `N` to add a card to
the highlighted column, or `C` to add a column. Press Escape to clear the
cursor.

## The three views

The view switcher offers three projections of the same cards. Your last
choice is remembered across sessions.

### Board

The board view is the Kanban strip of columns you drag cards across. This is
the only view with column reordering, the composer footers and the column
appearance menu.

### Calendar

The calendar view places cards by their due date. Use the scale toggle to
switch between `Month` and `Week`, and the arrows to move through time.
Cards with no due date sit in the `Unscheduled` side panel.

Drag a card from the panel onto a day to schedule it, or drag a chip between
days to reschedule it (the time of day is kept). Click a day to open its
panel: a small composer that creates a card due that day, plus the full list
of that day's cards.

### Table

The table view lists every card in a flat, sortable table. Click a column
header to sort ascending, then descending, then back to board order.

Inside the table you can rename a card title, change its column, set its due
date and edit its labels inline. The `+ card` button adds a card, and the
`Columns` menu shows or hides optional columns such as priority, assignee,
checklists, description, dates and activity.

## Limits

| Item | Limit |
| --- | --- |
| Boards per workspace | 10 |
| Board title | 100 characters |
| Columns per board | 12 |
| Column title | 100 characters |
| Cards per column | 200 |
| Card title | 300 characters |
| WIP limit per column | 1 to 99 |
| Labels per board | 50 |

The card-level limits are listed on [Card details](cards/).
