---
title: Boards, columns and cards
description: Create and manage boards and columns, add and move cards, and work the board view.
---

A board is an ordered strip of columns, and each column holds an ordered list
of cards. The board title lives in the header, next to the board switcher.

![The board view.](/screens/board.png)

## Boards

### Create a board

Open the board switcher and use the `New board` row. Type a name and press
Enter. You can also type a name into the switcher's search box first — its
footer then reads `Create "<name>"` and creates that board. A new board starts
empty and you are taken straight to it.

![The board switcher: your boards with card counts, and a New board row.](/screens/board-switcher.png)

### Switch between boards

The switcher groups boards into `My boards` and `Shared with me` when both
exist. Each row shows a coloured avatar, the board name and its card count.
Use the arrow keys and Enter, or just click a row. A board shared with you
carries a role icon: member (can edit) or viewer (view only).

### Rename a board

Click the board title in the header, type the new name and press Enter.
Escape cancels. A viewer sees a plain heading and cannot rename.

### Archive, restore and delete a board

In the switcher, hover a board you administer and click the archive icon. The
row asks `Archive?`; confirm with the check mark. Archived boards drop into an
`Archived` section at the bottom, where an admin can restore them or delete
them for good. Deleting is offered only for archived boards and removes the
board and its cards permanently.

## Columns

### Add a column

At the end of the column strip, click `Add column`, type a title and press
Enter. Escape cancels. The shortcut `C` opens the same control.

### Rename, reorder and duplicate

- **Rename**: double-click the column title, or use `Rename` in the column
  menu.
- **Reorder**: drag a column by its header grip and drop it in a new position.
- **Duplicate**: `Duplicate column` in the column menu places a copy next to
  the original, with all of its cards.

### The column menu

Open the menu with the `⋮` button in the column header. It holds `Rename`,
`Duplicate column`, `Sort cards` (`By creation date`, `By due date`,
`By title`), `WIP limit`, `Archive all cards` and `Delete column`.

![The column menu.](/screens/column-menu.png)

- **Sort cards** is a one-shot action: dragging a card afterwards returns the
  column to manual order.
- **Archive all cards** moves every card in the column to the archive, where
  you can restore it later.
- **Delete column** removes the column and its cards permanently, after a
  confirmation that names the column and the number of cards.

### WIP limits

A WIP limit caps how many cards a column accepts. Open `WIP limit` in the
column menu and enter a number. Leave it empty, or use `Remove limit`, to
clear it. The column header then shows `count/limit`, and the counter turns
yellow at the limit and red past it. Adds and moves into a full column are
blocked with a short message.

### Column appearance

In the board view, open the column appearance menu next to the view switcher.
`Transparency` makes columns translucent over the board background, and `Blur`
frosts what shows through. Both apply live and are remembered.

## Cards on the board

### Add a card

At the foot of each column, click `Add a card` to open the composer. Type a
title and press Enter to add the card; Shift+Enter inserts a new line. The
composer stays open so you can add several cards in a row, and the board's
labels are offered as chips you can attach before adding. Hovering between two
cards reveals an insert zone, so a card can be added at that exact position.

### The card face

Every card is the same fixed-size tile, so cards line up in a column. The face
shows the title and its labels on the first line, the due-date badge on the
second, and a row of badges below: a description marker, linked-card counts,
checklist progress, the priority and the assignee's avatar. Click a card to
open its details — or right-click it for the quick menu (see
[Card details and the quick menu](/docs/user-guide/cards/)).

### Drag and drop

Drag a card by holding it: the mouse starts a drag after a short move, a touch
screen after a short press, and the keyboard can move a card too. Drop a card
between two cards in the same column to reorder, or into another column to
move it. A drop into a full column is refused and the card returns to its
place. While a filter is active, dragging is disabled and the board says so.

### The keyboard cursor

Press `J` and `K` to move a highlight down and up through the visible cards,
`E` or Enter to open the highlighted card, `N` to add a card to the
highlighted column and `C` to add a column. Escape clears the cursor.

## Next

- [Calendar and table views](/docs/user-guide/views/)
- [Card details and the quick menu](/docs/user-guide/cards/)
