---
title: User guide
description: What Janosik is, how the two run modes differ, and a tour of the interface.
---

Janosik is a Kanban app for planning work on columns of cards.
It runs in one of two modes: local mode, where everything stays in your
browser, or server mode, where boards live in a database behind an account.

## Two ways to run the app

The build decides the mode. When the UI is configured to talk to an API it
runs in server mode; without a backend it runs in local mode.

### Local mode

In local mode there is no backend and no sign-in.
Every board and card is stored in the browser under `localStorage`, so the
app works fully offline.
You move data between browsers with `Export JSON` and `Import JSON`, and the
app keeps automatic backups on its own.

Local mode has no accounts, members, sharing, comments, attachments or
presence. Those controls are hidden.

### Server mode

In server mode the app shows a sign-in screen and boards live in a database.
An account can own boards and be invited to other people's boards.
Server mode adds members and roles, realtime updates, comments, file
attachments, public share links and personal API keys.

If the server cannot be reached at boot, the shell shows `Loading boards…`
and then a retry instead of an empty board list.

## A tour of the interface

### The header

The left side of the header holds the board itself.

- The brand mark is the app logo.
- The board title is editable: click it, type a new name, then press Enter or
  click away.
- The board switcher (the chevron) lists your boards, creates a new one and
  manages archived boards.
- The bell lists board invitations (server mode).
- The members button opens the member list (server mode).
- The share button opens public read-only links (server mode, admins only).
- The presence stack shows who is on the board right now (server mode).

The right side of the header holds the tools.

- Global search finds cards and boards across every board.
- The keyboard icon opens the shortcut cheat sheet.
- Undo and redo step through your changes.
- The data menu exports, imports and backs up boards, and opens the card
  archive.
- The account button opens your profile, security, API keys and preferences
  (server mode).

### Below the header

The filter bar searches and filters the cards shown on the board.
The view switcher picks how the board is drawn: `Board`, `Calendar` or
`Table`. The column appearance menu sits next to it in the board view.

A data-safety banner appears above the header when local storage is full or
unreadable. Announcements appear just under the header.

## Where to go next

- [Boards, columns and cards](boards/) covers the board surface and its
  three views.
- [Card details](cards/) covers everything inside a card.
- [Collaboration, sharing and search](collaboration/) covers members,
  realtime updates, public links, search and shortcuts.
- [Account, keys and preferences](account/) covers your profile, API keys,
  preferences, offline use and backups.
