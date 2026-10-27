---
title: User guide
description: What Janosik is, the two run modes, and a tour of the screen.
---

Janosik is a Kanban board: ordered columns of cards you drag around to plan
work. This guide walks through every screen and control, from creating a board
to sharing a read-only link.

![The board view: four columns of cards with labels, due dates, priorities and assignee avatars.](/screens/board.png)

## Two ways to run the app

- **Local mode** — no server and no sign-in. Every board lives in your browser
  and the app works fully offline. You move data between browsers with
  `Export JSON` and `Import JSON`.
- **Server mode** — boards live in a database behind an account. It adds
  members and roles, realtime updates, comments, file attachments, public
  share links and personal API keys.

The build decides the mode; there is no switch inside the app. Everything
below describes server mode and notes where local mode differs.

## The screen at a glance

### The header

The left side is about the board:

- the logo;
- the **board title** — click it to rename the board;
- the **board switcher** (the chevron) — your boards, a new board, and
  archived boards;
- the **bell** — your board invitations;
- the **members** button — who is on the board and their roles;
- the **share** button — public read-only links (admins only).

The right side holds the tools:

- **Global search** — find cards and boards everywhere (Ctrl/Cmd+K);
- the **keyboard icon** — the shortcut cheat sheet;
- **undo / redo**;
- the **data menu** — export, import, backups and the card archive;
- your **account** — profile, security, API keys and preferences.

### Above the columns

- The **search box** filters the cards on the current board; the `Filters`
  button opens faceted filters (due date, labels, priority, assignee, links,
  created).
- The **view switcher** picks how the board is drawn: `Board`, `Calendar` or
  `Table`.
- The **column appearance** menu (board view only) sets column transparency
  and blur.

## Where to go next

- [Boards, columns and cards](boards/) — the board surface: creating and
  managing boards and columns, adding and moving cards.
- [Calendar and table views](views/) — the two alternative projections of the
  same cards.
- [Card details and the quick menu](cards/) — everything inside a card and
  the right-click quick menu.
- [Collaboration, sharing and search](collaboration/) — members, realtime
  updates, public links, search, filters and shortcuts.
- [Account, keys and preferences](account/) — your profile, API keys,
  preferences, offline use and backups.
