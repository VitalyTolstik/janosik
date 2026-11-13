---
title: Boards, columns and cards
description: Create and manage boards and columns, add and move cards, and use the board view.
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
exist. Each row shows a colored avatar, the board name and its card count.
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
clear it. When a limit is set, the column header shows `count/limit`, and the counter turns
yellow at the limit and red past it. Adds and moves into a full column are
blocked with a short message.

### Column appearance

In the board view, open the three-line **Board appearance** menu next to the
view switcher. It also contains card density and column style settings.
`Transparency` makes columns translucent over the board background, and `Blur`
frosts what shows through. Both apply live and are remembered.

### Column accents

Use the brush button in a column header to give that column a color or one of
the six gradient presets from the card-cover palette, or choose `No accent`
to clear it. The accent is board content: it survives reloads, is visible to
every participant, and can be undone.

The board-wide shape is chosen from **Column style** in that menu:
top rail, left rail, wash, title, glow, glass, header band, dot or signature.
The shape applies to every accent on the board and is stored on the board, so
all participants see the same style. The accent is decoration only — WIP
colors, drag state, focus rings and text keep their own meaning.

### Board workflow

A board admin can restrict moves between columns. Open the gear in the header
(`Board settings`): the columns form a rail, and selecting one lists its rules
with the inspector beside them. The `Matrix` tab keeps the full coverage grid.
Each transition has roles and optional card-field conditions. A forbidden
target is shown disabled with the reason in the drag overlay, card menu, card
dialog and table; a rejected drop leaves the card in place. Keyboard and mobile
behaviour are covered in [Board workflow](/docs/user-guide/workflow/).

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

To drag a card with a mouse, hold it and move the pointer. On a touch screen,
press and hold the card first. You can also move cards with the keyboard. Drop a
card
between two cards in the same column to reorder, or into another column to
move it. A drop into a full column is refused and the card returns to its
place. While a filter is active, dragging is disabled and the board says so.

### The keyboard cursor

Press `J` and `K` to move a highlight down and up through the visible cards,
`E` or Enter to open the highlighted card, `N` to add a card to the
highlighted column and `C` to add a column. Escape clears the cursor.

## Agent control and policy

A board ADMIN sees one **Agent control** button in the header (the bot icon
with a pending-count badge). A MEMBER or VIEWER sees the same dialog through
the read-only **Agent runs** entry. The modal is board-scoped and has three
tabs:

- **Inbox** — the approval queue for this board. Each request shows its human
  summary, risk, board/card context, requesting token and session, exact
  commands or operations, plan hash, TTL and decision record. `Approve`
  requires confirming the exact plan hash; approval authorizes only that plan,
  and the agent still has to repeat the same call with the approval id.
  `Reject` requires a reason in the UI. Expired and consumed requests cannot be
  decided. The whole inbox is ADMIN-only; an API key cannot decide its own
  request.
- **Live** — `Pause agents` stops every API key writing to the board.
  In-flight requests finish; new writes are refused with `403 agent_paused` and
  are not queued or retried. Reads, heartbeat and end-session stay available,
  and a pause never releases claims. The tab lists live sessions and lets an
  ADMIN pause, resume or end one session with a reason; ending releases claims.
  A session paused by a board or token pause shows that scope instead, and you
  clear it at that scope. There is no Stop token or Stop all here: the only
  token path is **Manage tokens** → Account → API keys.
- **Runs** — agent batches, plans and single destructive calls, newest first.
  Filter by status, kind, token, session or time. Select a run to see its
  timeline, command list with attribution, sequence range, plan/approval hash
  and, for a signed-in board ADMIN, stored preimages and diff. `Revert run`
  first checks conflicts; a later change to an affected entity refuses the
  whole revert and lists the conflicts. Applying a revert is board-ADMIN
  browser-session only, asks for confirmation and records a separate audit run.
  A lapsed retention window reports `run_expired`; a reverted run cannot be
  reverted again.

Policy is configured in **Board Settings → Agents & automation** (the gear is
ADMIN-only). The section holds destructive mode (`Require approval` or `Hard
deny`), the approval triggers, maximum commands/cards per run, approval TTL and
the fixed ADMIN approver role. Non-destructive triggers are editable;
destructive ones are disabled and marked “covered by destructive mode”. Saving
is a compare-and-swap: if another admin changed the policy first, **Reload**
keeps your draft and only fields you actually changed are merged; a same-field
conflict asks for an explicit choice. `Reset to defaults` restores approval
mode, 100 commands, 50 cards and a 60-minute TTL and is disabled when the
policy is already default.

The global `/agents` page covers the same approvals, sessions and runs across
boards, with Attention, search, board scope and URL/deep links. See
[Agents](/docs/user-guide/agents/) for the full contract and permissions.

Token-level pause, `Stop all` and kill (revoke) are in [Account → API
keys](/docs/user-guide/account/#pausing-and-stopping-agents).

## Next

- [Board workflow](/docs/user-guide/workflow/)
- [Calendar, table and watch views](/docs/user-guide/views/)
- [Card details and the quick menu](/docs/user-guide/cards/)
