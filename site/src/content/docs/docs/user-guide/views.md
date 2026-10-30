---
title: Calendar, table and watch views
description: Four ways to work the same cards — a calendar by due date, a sortable table, and a bare watch view for observing a swarm.
---

The view switcher above the board offers four projections of the same cards.
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
busy team — without the wall of cards. It mounts no cards and no drag & drop:
just a large status and a live feed of what is happening.

<video controls muted loop playsinline poster="/media/feature-watch.jpg">
  <source src="/media/feature-watch.mp4" type="video/mp4" />
</video>

![The watch view: a large status, the columns and online roster on the left, and a live activity feed with from → to diffs.](/screens/watch.png)

- **Status** (top): total cards, the number of columns, and how many people (or
  agents) are online right now.
- **Columns** (left): each column's card count, with its WIP limit when set.
- **Online** (left): who is connected at this moment.
- **Live activity** (right): a newest-first feed of every change — created and
  moved cards, edits with `from → to` diffs, labels, priorities, due dates,
  assignees, checklists and comments. New events arrive on their own; the page
  never reloads.
- **Paging**: the feed pages with `‹ 1 2 3 ›`, and `Per page` sets 20, 50 or
  100 rows. The first page stays live; browsing older pages pauses the stream.

The watch view is deliberately plain — no animations, no hover effects, no
colour beyond the diff markers — so it can stay open on a screen as a status
board.

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
