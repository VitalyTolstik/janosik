---
title: Calendar, table and watch views
description: Four ways to work with the same cards — a calendar by due date, a sortable table, and a simplified watch view for monitoring a board.
---

The view switcher above the board offers four ways to view the same cards.
Your last choice is remembered across sessions. The board view is covered in
[Boards, columns and cards](/docs/user-guide/boards/); this page covers the
other three.

## Calendar

The calendar places cards by their due date. Use the scale toggle to switch
between `Month` and `Week`, and the arrows to move through time. Cards with no
due date sit in the `Unscheduled` panel on the left.

![The calendar view: a month grid with cards on their due dates and an Unscheduled panel.](/screens/calendar.png)

- **Schedule a card**: drag it from the `Unscheduled` panel onto a day.
- **Reschedule a card**: drag its chip between days; the time of day is kept.
- **A day's panel**: click a day to open it — a small composer that creates a
  card due that day, plus the full list of that day's cards.
- **Quick menu**: right-click a card chip for the same quick menu as on the
  board (see [Card details and the quick menu](/docs/user-guide/cards/)).

## Table

The table lists every card in a flat, sortable sheet. Click a column header to
sort ascending, then descending, then back to board order.

![The table view: every card in one sortable sheet with inline editors.](/screens/table.png)

Inside the table you can:

- **rename** a card title by double-clicking the cell;
- **change the column** and **set the due date** inline;
- **edit labels** from the cell;
- **add a card** with the `+ Add a card` button;
- choose which columns to show with the `Columns` menu — priority, assignee,
  checklists, description, dates and activity;
- **right-click a row** for the quick menu.

## Watch

The watch view is for **observing** a board — a swarm of agents at work, or a
busy team — without the wall of cards. It hides cards and editing controls,
showing a summary and a live activity feed.

<video controls muted loop playsinline poster="/media/feature-watch.jpg">
  <source src="/media/feature-watch.mp4" type="video/mp4" />
</video>

![The watch view: a large status, the columns and online roster on the left, and a live activity feed with from → to diffs.](/screens/watch.png)

- **Status** (top): total cards, the number of columns, and how many people (or
  agents) are online right now.
- **Columns** (left): each column's card count, with its WIP limit when set.
- **Online** (left): who is connected at this moment.
- **Live activity** (right): a newest-first feed of board activity — created and
  moved cards, edits with `from → to` diffs, labels, priorities, due dates,
  assignees, checklists and comments. New events arrive on their own; the page
  never reloads.
- Long values are shortened initially; `Show full values` reveals the saved
  values. Older entries may lack snapshots and cannot recover missing details.
- **Paging**: the feed pages with `‹ 1 2 3 ›`, and `Per page` sets 20, 50 or
  100 rows. The first page stays live; browsing older pages pauses the stream.

The watch view is deliberately plain — no animations, no hover effects, no
color beyond the diff markers — so it can stay open on a screen as a status
board.

Watch is a collaboration feed, not a complete security audit. Board members
with access to the board can see its command and activity history, including
membership changes, comments and attachment events. Undo and redo appear as
the resulting commands. The feed omits bookkeeping touches and old card edits
without a recorded diff. Online presence is current state, not a history.
Public link audits and administrative audit logs are separate and are not shown
in Watch. New administrative actions that use board commands are labelled
Administrator; older entries may show the board owner. Consult the
administrative audit for the actual actor.
Link views, automatic expiry and background file processing are not a complete
event history in Watch. When a board is deleted its feed is unavailable.
Archiving also closes the board view; its retained activity becomes visible
again when the board is restored, subject to the retention period.
Inline files in card descriptions follow the description edit and are not
separate upload or removal events in Watch. Board creation and final deletion
are not events that can be relied on in a surviving Watch feed.
Command and activity records are cleaned up after the configured retention
period (30 days by default); administrators can change that setting.

| Event | Source | Watch |
| --- | --- | --- |
| Board, column, card, label and checklist commands | Command log | Visible to board members, except bookkeeping touches and edits without a snapshot |
| Membership, comments and attachment uploads/deletions | Board activity | Visible to board members |
| Public link creation, revocation and removal | Share audit | Separate from Watch |
| Administrative actions | Administrative audit; some also use board commands | Only resulting board commands appear in Watch |
| Presence, link views, automatic expiry and file processing | Current state or service-specific records | No complete event history in Watch |

The share audit records link creation, revocation and deletion. Updating link
settings, refreshing a snapshot and automatic expiry are not recorded as share
audit events; it is not a complete log of the link lifecycle.

## Card density

In the board view, the display menu next to the view switcher has a
`Simplify design` checkbox. It switches every card to a compact one-line tile —
title, label dots, a blocked marker, checklist progress, priority and the
assignee — while the rest stays one click away in the card dialog. The choice
is remembered per browser. It is handy when a board is mostly being watched,
and it keeps more cards on screen with far fewer elements.

![Compact cards: one-line tiles that keep the essentials.](/screens/card-density.png)

## Next

- [Card details and the quick menu](/docs/user-guide/cards/)
- [Collaboration, sharing and search](/docs/user-guide/collaboration/)
