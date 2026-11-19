---
title: Admin redesign
description: The eight-hub admin console, the branded sign-in screen, responsive behaviour, density, command palette, and the compatibility contract for old links and test ids.
---

The master panel was reorganised around eight hubs. Every capability that
used to be a top-level sidebar link is still available as a tab inside a hub,
and every old URL redirects with its query string intact. The backend, the
OWNER/OPERATOR model and the audit trail are unchanged.

## Direction

The console uses a dense data-console language: 12 px tables, 36 px rows
(30 px in compact density), 32 px controls (28 px compact), a 232 px sidebar
and a 44 px top bar. The sign-in screen is the deliberate exception: a
split-screen brand rail and a 372 px form, where trust and legibility matter
more than density.

## Information architecture

| Hub | URL | Tabs / sections |
| --- | --- | --- |
| Overview | `/app/admin` | Dashboard |
| Users | `/app/admin/users` | User list, user detail |
| Boards | `/app/admin/boards` | Boards, Cards, Columns, Labels, Checklists, Card links |
| Moderation | `/app/admin/moderation` | Comments, Attachments |
| Audit & activity | `/app/admin/audit` | Audit trail, Command log, Activity |
| Communications | `/app/admin/communications` | Announcements composer, announcement history, Public shares |
| Access & security | `/app/admin/access` | Sessions, API tokens, Masters (owner only) |
| Settings | `/app/admin/settings` | General (Operations), Email, OAuth, Security, Traffic, Observability, Demo |

These eight hubs are the whole panel. There is deliberately no Agents hub:
`/app/admin` does not manage agent runs, approvals or policy. Those surfaces are
the global `/app/agents` page, the board-scoped Agent Control and Board Settings →
Agents & automation; see [Admin panel](/docs/admin/#agent-control-is-not-part-of-the-admin-panel).

Detail routes keep their own pages:

- `/app/admin/users/:userId`
- `/app/admin/boards/:boardId` and `/app/admin/boards/:boardId/content`
- `/app/admin/boards/:boardId/workflow`
- `/app/admin/cards/:cardId`

Breadcrumbs link to the hub and tab. Leaving a workflow editor with unsaved
changes prompts you to discard them or stay on the page.

## Legacy links and redirects

Old bookmarks keep working. The redirect preserves unrelated query
parameters and adds the hub tab.

| Old URL | New URL |
| --- | --- |
| `/app/admin/activity` | `/app/admin/audit?tab=activity` |
| `/app/admin/commands`, `/app/admin/log` | `/app/admin/audit?tab=commands` |
| `/app/admin/cards` | `/app/admin/boards?tab=cards` |
| `/app/admin/columns` | `/app/admin/boards?tab=columns` |
| `/app/admin/labels` | `/app/admin/boards?tab=labels` |
| `/app/admin/checklists` | `/app/admin/boards?tab=checklists` |
| `/app/admin/cardLinks` | `/app/admin/boards?tab=links` |
| `/app/admin/comments` | `/app/admin/moderation?tab=comments` |
| `/app/admin/attachments` | `/app/admin/moderation?tab=attachments` |
| `/app/admin/sessions` | `/app/admin/access?tab=sessions` |
| `/app/admin/tokens` | `/app/admin/access?tab=tokens` |
| `/app/admin/masters` | `/app/admin/access?tab=masters` |
| `/app/admin/comms` | `/app/admin/communications?tab=announcements` |
| `/app/admin/announcements` | `/app/admin/communications?tab=history` |
| `/app/admin/shares` | `/app/admin/communications?tab=shares` |
| `/app/admin/ops` | `/app/admin/settings?tab=general` |
| `/app/admin/email` | `/app/admin/settings?tab=email` |
| `/app/admin/oauth` | `/app/admin/settings?tab=oauth` |
| `/app/admin/security` | `/app/admin/settings?tab=security` |
| `/app/admin/traffic` | `/app/admin/settings?tab=traffic` |
| `/app/admin/observability` | `/app/admin/settings?tab=observability` |
| `/app/admin/demo` | `/app/admin/settings?tab=demo` |

## Sign-in

The sign-in screen is a split layout:

- A dark brand rail with the wordmark, the restricted-operations message, the
  build version and an honest security note.
- A form pane with a 372 px form, visible labels, show/hide password, a Caps
  Lock hint, `aria-invalid`/`aria-describedby`, and an explicit error summary.
- Two-factor is progressive: the code field appears only after the server
  answers `totp_required`, with a 30-second rotation indicator and a link back
  to the password step.
- The form submits with empty fields and reports local validation instead of
  disabling the button, so password managers and paste work normally.
- There is no SSO button. The backend has no master OIDC provider, so the
  screen states that SSO is not configured rather than offering a control
  that cannot work.

The existing error taxonomy is unchanged: invalid credentials, locked,
disabled, IP not allowed and offline each have their own message. The form
never reveals whether an email exists.

## Responsive shell

| Width | Sidebar | Behaviour |
| --- | --- | --- |
| 960 px and wider | 232 px with labels | Full navigation; the stored `Ctrl/Cmd+B` preference applies |
| 640–959 px | 64 px icon rail | Labels are hidden; every hub stays reachable by its icon and tooltip |
| 639 px and narrower | 280 px sheet behind a scrim | The top-bar menu opens the sheet; choosing a destination closes it. Tables become labelled cards and the content uses the full width |

Choosing a tab from **All 26 destinations** closes both the dialog and
the mobile navigation, including when the tab belongs to the current hub.
The dialog uses the selected interface language.

At 390 px the sidebar no longer steals 208 px from the content. Each table row
becomes a card and every cell keeps its column name via `data-label`.

## Density

The top bar has a density toggle (`admin-density-toggle`). It switches between
**Comfortable** (36 px rows) and **Compact** (30 px rows), persists in
`localStorage` under `janosik.admin.density`, and never applies to the sign-in
screen or to phone touch targets.

## Command palette

`Ctrl/Cmd+K` opens the command palette. Letter shortcuts follow the typed
letter on Latin layouts and the physical key position on Russian layouts.
The palette contains the following.

- **Navigate**: the eight hubs.
- **Actions**: open settings, toggle density, toggle theme, shortcut help,
  back to the boards app.
- **Recent** shows the last five panel routes with their section names and icons.
- **Entities**: users, boards, cards, comments, files and labels from
  `GET /api/v1/admin/search?q=`, preserving the existing result test ids.

The input uses `role="combobox"`, `aria-activedescendant` and a
`role="listbox"` result list. `↑`/`↓` move the active row, `Enter` opens it,
`Esc` closes the palette. If the search request fails, the palette shows a
retry action instead of "Nothing found".

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Open the command palette |
| `Ctrl/Cmd+B` | Collapse or expand the sidebar |
| `g` then `d` | Overview |
| `g` then `u` | Users |
| `g` then `b` | Boards |
| `g` then `m` | Moderation |
| `g` then `a` | Audit & activity |
| `g` then `c` | Communications |
| `g` then `s` | Access & security |
| `g` then `,` | Settings |
| `?` | Shortcut sheet |
| `Enter` | Open the highlighted row or result |
| `Esc` | Close a dialog, drawer or the palette |

The shortcut sheet is also available from the top bar.

## Tables and states

- Rows are keyboard reachable: `Tab` focuses a row, `Enter`/`Space` opens it.
- Pagination offers 25, 50 and 100 rows per page (`admin-page-size`).
- Select-all announces "Select all rows on this page", not a delete label.
- Loading keeps the previous rows while a refresh is in flight; the skeleton
  only covers the first answer.
- Empty states distinguish "no data" from "no matches" and offer a filter
  reset.
- Errors carry a support reference and a retry action.
- A 403 on an owner-only screen becomes an explicit "Owner rights required"
  state instead of the generic list error.

## Roles

The server remains the source of truth. The UI mirrors it:

- An operator never sees the Masters tab and a direct URL lands on the
  forbidden state after the server's `403`.
- Owner-only Settings sections are visible read-only, with a single banner and
  the existing per-page explanation; the save controls remain absent.
- User-detail owner actions (reset password, promote, impersonate, export,
  delete) stay hidden from an operator.
- Bulk moderation and archive actions keep working for both roles exactly as
  before.

## Compatibility contract

Preserved test ids include `admin-sidebar`, `admin-sidebar-toggle`,
`admin-global-search`, `admin-theme-toggle`, `admin-logout`,
`admin-login-form/email/password/submit/error/totp`, `admin-entity-panel`,
`admin-table-scroll`, the `admin-*-skeleton` family, row and action ids,
pagination ids, user-detail tab/counter ids, board/card detail ids, master
password ids, share ids and every settings id.

New hooks are additive: `admin-hub-tabs`, `admin-hub-tab-*`,
`admin-command-*`, `admin-density-toggle`, `admin-page-size`,
`admin-error-state`, `admin-error-reference`, `admin-error-retry`,
`admin-empty-state`, `admin-forbidden-state`, `admin-breadcrumbs`.

The master login keeps its separate JWT audience, refresh cookie and API
client. Nothing in the redesign shares a session with the user app.

## Deferred work

The following report recommendations are intentionally not in this iteration
and keep the old behaviour working:

- server-side sort, saved views and a column chooser;
- inline editing;
- an audit/comment detail drawer (JSON still expands inline);
- a three-pane board-content inspector;
- email-template and share bulk actions;
- master recovery codes (the backend has no recovery-code endpoint);
- OIDC for masters.
