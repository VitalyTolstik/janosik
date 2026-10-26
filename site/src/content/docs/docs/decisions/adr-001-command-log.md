---
title: "ADR-001: The command log is the only write path"
description: Every board content mutation travels through one command endpoint and the shared reducer.
---

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-27 |
| Deciders | Janosik maintainers |

## Context

Janosik keeps a board in a pure `boardReducer` that returns a new `Board` for
every action. The same reducer ships in `shared/`, so the browser and the
server can run it. The client runs it for instant feedback, keeps undo history
as inverse actions, and works offline in local mode.

A board can have several writers: members share a board and see each other's
edits through an SSE stream. Those writers can also be disconnected and retry.
The server must reach the same board state the client computed, or a card moves
differently in the UI and in the database.

The write path also has to support undo. The client computes an inverse action
at dispatch time, while the state before the command is still known, and the
server has to accept that inverse as an ordinary command.

## Decision

Every board content mutation is a `BoardAction` appended through
`POST /boards/:id/commands`. The server re-validates the action with the shared
strict validator, replays the same `boardReducer`, and mirrors the result into
the normalized tables through per-action writers. It returns the command's
monotonic `seq` and the `version` of every entity it wrote.

`commandId` is the primary key of the command row, so a retry with the same
`commandId` returns the stored result without applying the action again.
`ifMatch` (board `seq`) and `ifMatchVersions` (per-entity versions) are optional
preconditions: a stale value is refused with `409 { conflict, currentVersion }`.
Undo is an inverse action; the server does not know it is an undo. Board
create, import and delete stay on REST because they act on the board list, not
on board content.

## Consequences

### Positive

- The client and the server run the same reducer, so a board cannot diverge
  between the UI and the database.
- A retry is idempotent: the same `commandId` never creates a second entity or
  consumes a second `seq`.
- Undo reuses the command path, so it needs no separate endpoint or storage.
- The realtime stream carries the same action, and a foreign edit is applied by
  the same reducer that produced it.
- Version preconditions make undo of a text edit refuse instead of overwriting
  another writer's text.

### Negative

- Every new board operation needs a command type, a validator case and a server
  writer, so one feature touches three places.
- The command endpoint is the only content write path, so a defect there
  affects every edit.
- There is no merge of concurrent edits. Conflicts resolve last-write-wins per
  entity, and an undo of a text field can be refused.
- The command log grows with every edit and needs a retention sweep.

### Neutral

- Reads do not go through the log: the board aggregate, members and activity
  feeds are ordinary REST.
- Card positions are integers in the normalized tables, not a document.
- Aggregate-level operations (board create, import, delete) stay on REST.

## Alternatives considered

- **Direct REST per entity.** Strongest argument for: it is familiar, supports
  per-field patches, and needs no reducer on the server. Rejected because it
  duplicates board logic on the server and gives up the single-reducer
  guarantee.
- **CRDT (for example Yjs or Automerge).** Strongest argument for: it merges
  concurrent edits with no conflict and no central ordering. Rejected because
  kanban edits are discrete and last-write-wins per entity is enough, and a
  CRDT would not reuse the existing reducer.
- **Event sourcing with server-assigned ids.** Strongest argument for: the
  server owns identity and ordering. Rejected because client-generated ids are
  needed for offline-first optimistic UI and idempotent retries, and undo of a
  create must reuse the same id.

## References

- `shared/src/store/board-reducer.ts`
- `backend/src/commands/commands.service.ts`
- [Command API](../api/commands/)
- README, architecture section
- ROADMAP, architecture assessment
