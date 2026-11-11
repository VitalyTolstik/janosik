---
title: Board workflow
description: Admin-configurable transitions between columns, role and card-field conditions, and what a blocked move looks like.
---

The workflow is an optional rule layer over the board's columns. A card's
column is its status; the workflow decides which column it may move to next.
It is off by default: a board without a workflow allows every move, exactly as
before the feature existed.

Only a board **ADMIN** can edit the workflow. A platform `OWNER` or `OPERATOR`
can open the same editor from the master panel, acting for the board owner;
that change goes through the command log and `AdminAuditLog`.

## Open the editor

A board admin clicks the gear in the header (`Board settings`). The dialog
opens on the `By column` view with the busiest source column selected in the
rail. Everyone can read the rules read-only from a card's right-click menu
under `Workflow rules`, or from the header's `Data & backups` menu — the latter
works on a board with no cards too.

## Turn control on

The `Control enabled` switch in the dialog header enables enforcement. While
it is off the rules are kept for later but every move is allowed.

An enabled workflow needs at least two columns and at least one active
transition. The editor refuses to save otherwise, and the API rejects the same
shape, so an enabled board can never be frozen by an all-disabled rule list.

## Rules by column

The board's columns form a horizontal rail. Each item shows the column's
accent, its card count and how many rules point at it. Selecting a column lists
one row per other column, in board order:

- **Forward / back** — whether the destination is later or earlier than the
  source.
- **Roles** — `ADMIN`, `MEMBER`, or both. Viewers never move cards. An empty
  role list is not allowed.
- **Conditions** — all selected conditions must hold:
  - an assignee is set;
  - a due date is set;
  - the description is not blank;
  - every checklist item is done (a card without checklists passes).
- **Allowed / not allowed** — a missing rule offers `Allow`; a disabled rule
  stays in the list (dashed) but does not let cards through.

Selecting a row opens the inspector on the right (or below on a tablet):

- **Reverse transition** — creates a mirror edge with the same roles and
  conditions. Without it, undoing that move is refused.
- **Transition is active** — temporarily disables one edge without deleting it.
- **Check a card** — evaluates the selected rule against one real card and
  shows the reason when the move is blocked.

Drag-to-reorder and keyboard sorting inside the same column are always
allowed: the diagonal is not a transition.

`Use template` and `Reset rules…` live in the compact `…` menu in the dialog
header. The template fills a chain of adjacent forward and reverse edges; edit
it afterwards. A column with no incoming or outgoing edges is marked as outside
the process in the editor.

## The full matrix

The `Matrix` tab shows the complete source × destination grid for auditing
coverage. Click a cell to allow or open a transition; a check means allowed, a
dash means disabled, a dot means no rule, and an amber marker means the rule
has conditions. The inspector stays available beside the matrix on desktop.

## Global transitions

A global transition (`From any column → column`) applies only when there is no
specific edge for the pair. A specific edge always wins, so a role-restricted
global "escalation" rule cannot bypass a stricter pair. Global transitions live
in one compact strip under the column list.

## Start and done semantics

The start and done controls live in one compact row under the global strip:

- **Start column** is the semantic start. The MCP server uses it for
  `janosik_list_ready_cards` and `janosik_wait_for_work`, and as the default
  restore column, instead of assuming the first column.
- **Done columns** are the semantic finish. MCP's Definition-of-Done gate
  checks these rather than the last column; several done columns are allowed.
  An empty list falls back to the last column for compatibility.

Neither setting restricts card creation in this version.

## Keyboard and mobile

- In the rail, `Tab` enters once; `←`/`→`, `Home` and `End` move between
  columns.
- In the rule list, `↑`/`↓` move between rows, `Space` toggles an existing rule,
  and `Enter` opens it in the inspector.
- In the matrix, the whole grid is one `Tab` stop; arrows move a focused cell,
  `Home`/`End` jump inside a row, and `Space`/`Enter` activate it.
- On a phone the dialog is full-screen, the rail scrolls horizontally with snap,
  and the inspector becomes an accordion under the list. The footer respects
  the safe area; saving, errors and the dirty state stay announced through
  `aria-live`.

`Esc` or the close button closes a clean dialog immediately. With unsaved
changes it asks for confirmation, and focus returns to the gear afterwards.
`prefers-reduced-motion` disables the rail and inspector transitions.

## What a blocked move looks like

A forbidden target stays visible but disabled: a dragged column is dimmed with
a lock and the reason; the card menu, card dialog and table column picker list
the target as disabled with the reason. Dropping anyway shows a toast with the
reason and the destinations that are still available, and the card stays in
its column.

The shared reducer and the API enforce the same rule. The API answers
`409 { "conflict": "workflow", ... }` with a machine code and the allowed
targets; an optimistic card is rolled back. `WIP` limits are checked after the
workflow, so a forbidden transition is never reported as "column full".

Archiving and deleting are not an escape hatch: restoring an archived card or
undoing a delete is a column change too. The card may return to the column it
came from; any other target must be an allowed transition, with the same role
and condition checks. The archive dialog disables forbidden targets with the
reason, and a direct API call gets the same `409 workflow` answer.

## Undo, columns and legacy boards

- Saving the workflow is one undoable command; Ctrl/Cmd+Z restores the
  previous rules. If another admin changes the rules while your editor is
  open, the editor warns you; reload the current rules before saving.
- A stored config that cannot be read (corrupt data or a newer schema) fails
  closed: every cross-column move is refused until an admin repairs it.
- Deleting a column does not rewrite the workflow: its rules become dormant
  and wake up if undo restores the column with the same id.
- A new column is not connected automatically; add its edges in the editor.
- Board export/import carries the workflow and remaps column ids; a transition
  whose column disappeared is dropped. Version 1 files (without a workflow)
  still import; a new export is version 2 and needs a client that understands
  it.
- Public share links show the rules read-only and never accept a move.
