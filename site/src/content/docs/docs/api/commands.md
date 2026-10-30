---
title: Command API
description: The command-log transport that carries every board content mutation.
---

Board content (columns, cards, labels, checklists, links, covers, moves)
does not travel as ordinary REST. The client posts a `CommandRequest` to the
board's command endpoint, and the server replays the very same `BoardAction`
through the shared `boardReducer`. Membership, board create/import/delete and
files are the exceptions, and they live in [REST endpoints](/docs/api/rest/).

Every command is attributed (TASK-157): a browser session records
`actorType: "human"`, a personal API token (`jnk_…`) records `"agent"`. The
type rides on the command delta, the SSE frames and the activity feed
(`GET /boards/:id/activity`) so the history can tell an agent's edits from a
teammate's, and the card history marks agent entries with an "Agent" badge.

## Apply a command

```
POST /api/v1/boards/:id/commands
```

Auth: user auth (JWT or PAT). Role: `ADMIN` or `MEMBER`. A `VIEWER` answers
`403`. An unknown or soft-deleted board answers `404`.

Request body (`CreateCommandDto`):

| Field             | Type    | Required | Constraints                                                                |
| ----------------- | ------- | -------- | -------------------------------------------------------------------------- |
| `commandId`       | string  | required | non-empty, at most 64 characters; the idempotency key                      |
| `action`          | object  | required | a `BoardAction`, validated strictly by the shared validator                |
| `ifMatch`         | integer | optional | expected board `seq`; must be `>= 0`                                       |
| `ifMatchVersions` | object  | optional | per-entity preconditions; keys and integer values validated in the service |

Response `200` (`CommandResponse`):

```json
{ "seq": 42, "versions": { "card:abc": 7, "column:xyz": 3 } }
```

`seq` is the board's monotonic sequence number. `versions` holds the version
counter of every entity the command actually wrote.

### Validation and the command clock

The shared validator rebuilds the action from a per-type allow-list instead
of passing the input through. A field the action type does not define is
dropped before the reducer, the command log or the SSE stream see it. Ids are
at most 128 characters, and `__proto__` is refused as an id. The inverse-only
fields (`boardUpdatedAt`, `cardUpdatedAt`, `cardActivity`) are kept only on a
command marked `inverse: true`, and `cardUpdatedAt` and `cardActivity` only on
the action types whose inverse carries them. Elsewhere they are dropped; when
kept, they are validated like any other field.

Every timestamp in the payload (`at`, `dueDate`, the `createdAt`-style fields
of a `RESTORE_*` snapshot) must lie within the JavaScript Date range
(±8.64e15 ms). A value outside it answers `400` with the offending path in
`field`, for example `"field": "action.at"`.

`at` is the command clock: the reducer stamps it into `createdAt`,
`updatedAt`, `archivedAt` and the rest. The server trusts it within five
minutes of its own clock. An `at` further off is replaced with the server time
before the command is applied, so a client cannot backdate or postdate what it
writes.

### Idempotency

`commandId` is the primary key of the `Command` row. A retry that reuses the
same `commandId` with the same action returns the stored `result` without
applying the action a second time and without consuming a second `seq`. The
comparison ignores `at`, so a retry sent later with a fresh clock still
matches.

Reusing a `commandId` with a different action answers `409`:

```json
{
  "message": "commandId already used with a different payload",
  "field": "commandId"
}
```

Answering with the first command's result would tell the client that its new
action had been applied. A `commandId` already used on a different board also
answers `409` with `"field": "commandId"`.

### Optimistic concurrency

Two optional preconditions guard against clobbering:

- `ifMatch` is the board `seq` the client last saw. When it differs from the
  current `seq`, the server answers `409 { "conflict": "version", "currentVersion": n }`.
- `ifMatchVersions` is a map keyed by a touch label (`board:<id>`,
  `column:<id>`, `card:<id>`, `label:<id>`, `checklist:<id>`,
  `checklistItem:<id>`) with the entity `version` the client last saw. Every
  listed key must still hold that version. A stale or missing entity answers
  `409 { "conflict": "version", "currentVersion": n }`. An unknown key, or a
  non-integer value, answers `400 { "field": "ifMatchVersions" }`, and so does
  a `board:` key naming any board but the target. Omitted keys are not
  checked, so positional changes stay last-write-wins.

`ifMatchVersions` keys are resolved on the target board only. An entity id
that lives on another board reads as missing and answers `409`, so the
precondition cannot be used to probe the versions of boards the caller is not
a member of.

`ifMatchVersions` is what makes undo of a text edit safe: if another writer
changed the entity since, the server refuses and the client refuses the undo
instead of overwriting the foreign text.

### Conflicts

A refused command answers `409` with a `ConflictError` body
`{ "conflict": "<category>", "currentVersion": n }`. The categories are:

| `conflict` | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `version`  | an `ifMatch` or `ifMatchVersions` precondition is stale              |
| `wip`      | the command would break a collection or WIP limit                    |
| `id`       | the command names an entity id that already belongs to another board |

The `wip` check mirrors the reducer's collection guards: `LIMITS` on columns,
cards per column, labels per board, labels per card, links per card, checklists
per card and items per checklist, plus the column WIP limit. The `RESTORE_*`
family is exempt (it re-adds data that already existed). A client-supplied
`inverse: true` flag buys no exemption.

The `id` check exists because entity ids are global primary keys while
commands are board-scoped: an id that already lives on another board would be
silently rewritten by the upserts.

### Other errors

| Status | Cause                                                                          |
| ------ | ------------------------------------------------------------------------------ |
| `400`  | `action` fails the shared validator; body carries `field` and `message`        |
| `400`  | unsupported action type; body carries `field: "action.type"`                   |
| `400`  | a timestamp outside the Date range; `field` names its path                     |
| `400`  | `ifMatchVersions` key or value is invalid                                      |
| `403`  | caller is a `VIEWER`; or a non-`ADMIN` sends `ARCHIVE_BOARD`/`UNARCHIVE_BOARD` |
| `404`  | board not found                                                                |
| `409`  | a conflict (see above), or `commandId` used on another board                   |
| `409`  | `commandId` reused with a different action; `field: "commandId"`               |
| `413`  | the serialized `action` exceeds `MAX_COMMAND_BYTES` (2 MB)                     |
| `503`  | `code: "board_write_timeout"`: the board write timed out under load            |

A `503` with `board_write_timeout` means the transaction holding the board's
write lock timed out and was rolled back, so nothing was applied. Retry with
the same `commandId`: the idempotency key makes the retry safe.

Commands that reference unknown entities no-op exactly like the reducer and
are still recorded. A replay returns the stored no-op result.

## Read the command log

```
GET /api/v1/boards/:id/commands?since=<seq>
```

Auth: user auth. Role: any member, `VIEWER` included. Returns
`CommandDeltaEntry[]`, oldest first: the commands with `seq` greater than
`since`. `since` is a non-negative integer or absent (absent means `0`); any
other value answers `400`. The response is capped at 5000 entries.

This is the delta catch-up a client runs after an SSE gap. The server never
answers with a partial history. When the gap cannot be replayed faithfully,
because more than 5000 commands follow `since` or `since` is no longer in this
board's log (the retention sweep trimmed it), the response is an empty array
with the header `X-Delta-Resync: 1`. The client must then re-read the board
with `GET /boards/:id` and resume from its `X-Board-Seq` header.

The live stream is documented in [REST endpoints](/docs/api/rest/); it sends a
`resync` frame in the same situation.

## DTOs

### CreateCommandDto

The request body above. `commandId` and `action` are required; `ifMatch` and
`ifMatchVersions` are optional.

### CommandRequest

The shared wire shape the DTO mirrors:

| Field             | Type                     | Required | Meaning                                       |
| ----------------- | ------------------------ | -------- | --------------------------------------------- |
| `commandId`       | string                   | required | client idempotency key                        |
| `action`          | `BoardAction`            | required | the reducer action to apply                   |
| `ifMatch`         | number                   | optional | expected board version                        |
| `ifMatchVersions` | `Record<string, number>` | optional | per-entity preconditions keyed by touch label |

### CommandResponse

| Field      | Type                     | Meaning                                                  |
| ---------- | ------------------------ | -------------------------------------------------------- |
| `seq`      | number                   | monotonic board sequence, the ordering and board version |
| `versions` | `Record<string, number>` | version counters of the entities the command touched     |

### CommandDeltaEntry

One entry of the delta feed:

| Field       | Type          | Meaning                                                                     |
| ----------- | ------------- | --------------------------------------------------------------------------- |
| `seq`       | number        | the command's board sequence                                                |
| `action`    | `BoardAction` | the committed action, exactly as applied                                    |
| `actorId`   | string        | who issued the command                                                      |
| `actorType` | `"human" \| "agent"` | whether a person or an agent issued it; omitted on legacy frames     |
| `commandId` | string        | the idempotency key the command was sent with                               |
| `touches`   | string[]      | the entities the command wrote, as touch labels; empty when nothing changed |

`commandId` lets a client recognise its own echo by key rather than by
`actorId`: one account may run several writers at once (tabs, agents on the
same API key).

### ConflictError

| Field            | Type                         | Meaning                   |
| ---------------- | ---------------------------- | ------------------------- |
| `conflict`       | `"version" \| "wip" \| "id"` | the conflict category     |
| `currentVersion` | number                       | the board's current `seq` |

## Command envelope

Every board-scoped action carries these fields on top of its own:

| Field            | Type                  | Required | Meaning                                                                            |
| ---------------- | --------------------- | -------- | ---------------------------------------------------------------------------------- |
| `boardId`        | string                | optional | target board; omitted means the first board. The endpoint injects the route board. |
| `at`             | number                | required | command clock in ms; replaced by server time when more than 5 minutes off          |
| `actorId`        | string or null        | optional | dropped by the validator; the command is attributed to the authenticated user      |
| `commandId`      | string                | optional | carried by the client; the endpoint's top-level `commandId` is the idempotency key |
| `activityIds`    | string[]              | optional | ids for the activity events this command appends, in append order                  |
| `boardUpdatedAt` | number                | optional | inverse-only override of `board.updatedAt`; dropped unless `inverse: true`         |
| `cardUpdatedAt`  | number                | optional | inverse-only override of the touched card's `updatedAt`; dropped unless inverse    |
| `inverse`        | boolean               | optional | marks an undo command; the server does not trust it for guard exemptions           |
| `cardActivity`   | `CardActivityEvent[]` | optional | inverse-only: the card feed as it was before the undone command                    |

## Action catalog

The command endpoint accepts every board-scoped action below. The four
aggregate-level actions are listed at the end and are rejected.

### Columns

| Action                  | Fields                                                                    | Meaning                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADD_COLUMN`            | `newColumnId` string, `title` string                                      | Creates a column. Title clamped to `LIMITS.columnTitle` (100). Ignored at `LIMITS.columnsPerBoard` (12) or on a duplicate id.                 |
| `RENAME_COLUMN`         | `columnId` string, `title` string                                         | Renames a column. Blank or unchanged title is a no-op.                                                                                        |
| `DELETE_COLUMN`         | `columnId` string                                                         | Removes the column and every card in it.                                                                                                      |
| `DUPLICATE_COLUMN`      | `columnId`, `newColumnId`, `newCardIds` string[], `title` string optional | Copies a column immediately to its right. A source card with no id at its position in `newCardIds` is not copied. Keeps the source WIP limit. |
| `MOVE_COLUMN`           | `columnId`, `fromIndex` number, `toIndex` number                          | Reorders columns with array-move semantics.                                                                                                   |
| `SORT_COLUMN`           | `columnId`, `sortBy` `"createdAt" \| "dueDate" \| "title"`                | Sorts the column's cards by the criterion. Dragging restores manual order.                                                                    |
| `SET_COLUMN_CARD_ORDER` | `columnId`, `cardIds` string[]                                            | Sets the column's card order outright. `cardIds` must be a permutation of the current ids, or the command is ignored.                         |
| `SET_COLUMN_WIP_LIMIT`  | `columnId`, `wipLimit` number optional                                    | Sets the column WIP limit; omitted or `undefined` removes it.                                                                                 |
| `ARCHIVE_COLUMN_CARDS`  | `columnId`                                                                | Archives every card of the column in one step.                                                                                                |

### Cards

| Action              | Fields                                                                                    | Meaning                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADD_CARD`          | `newCardId`, `columnId`, `title`, `labelIds` string[] optional, `atIndex` number optional | Creates a card. `atIndex` is clamped to `[0, count]`; omitted appends. Only labels that exist on the board attach.                         |
| `UPDATE_CARD`       | `cardId`, `title` optional, `description` optional, `quiet` boolean optional              | Partial patch; set only changed fields. `quiet` keeps `updatedAt` quiet for per-keystroke live edits. Empty description removes the field. The description is capped at `LIMITS.description` (64000). |
| `TOUCH_CARD`        | `cardId`                                                                                  | Commits the `updatedAt` timestamp after a burst of quiet edits.                                                                            |
| `DELETE_CARD`       | `cardId`                                                                                  | Removes the card.                                                                                                                          |
| `ARCHIVE_CARD`      | `cardId`, `archivedAt` number optional                                                    | Archives the card; `archivedAt` defaults to `at`.                                                                                          |
| `UNARCHIVE_CARD`    | `cardId`, `columnId` optional, `index` optional                                           | Restores an archived card; `columnId` defaults to the first column, omitted `index` appends. Respects the WIP limit.                       |
| `MOVE_CARD`         | `cardId`, `fromColumnId`, `fromIndex`, `toColumnId`, `toIndex`                            | Moves a card between columns or within one.                                                                                                |
| `DUPLICATE_CARD`    | `cardId`, `newCardId`, `title` optional                                                   | Copies a card right below the original, with fresh ids and timestamps. The copy starts unlinked.                                           |
| `SET_CARD_DUE_DATE` | `cardId`, `dueDate` number optional                                                       | Sets the due date (Unix ms); `undefined` removes the field.                                                                                |
| `SET_CARD_PRIORITY` | `cardId`, `priority` `"blocker" \| "highest" \| "high" \| "medium" \| "low" \| "lowest"`  | Sets the priority. `"medium"` is the default and drops the field.                                                                          |
| `SET_CARD_ASSIGN`   | `cardId`, `assigneeId` string or null                                                     | Sets the assignee; `null` or a blank id clears it. The server requires an active board member.                                             |
| `CLAIM_CARD`        | `cardId`, `claimedBy` string or null, `leaseUntil` number or null                         | Takes a temporary work lease on the card (`claimedBy: null` releases it; a lapsed lease is free again). While another member holds a live lease the command answers `400` with `field: "action.claimedBy"` — the swarm's "do not steal" rule. `leaseUntil` may not run more than `CLAIM_LEASE_MAX_MS` (24 h) past `at`. |
| `SET_CARD_TASK_SPEC`| `cardId`, `acceptanceCriteria` string[] optional, `definitionOfDone` string[] optional    | Sets the machine-readable task contract. Omit a field to leave it unchanged; an empty list clears it. Items are trimmed, de-blanked, capped at `LIMITS.taskSpecItems` (50) × `LIMITS.taskSpecItem` (500). |
| `SET_CARD_LABEL`    | `cardId`, `labelId`, `on` boolean, `index` optional                                       | Attaches (`on: true`) or detaches a label. Absolute, not a toggle. Adding is capped at `LIMITS.labelsPerCard` (20).                        |
| `SET_CARD_COVER`    | `cardId`, `cover` optional                                                                | Sets the cover; `undefined` removes it. A cover is `{ "type": "color", "value": ... }` or `{ "type": "gradient", "value": ... }`.          |

### Labels

| Action            | Fields                                        | Meaning                                                                     |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| `ADD_LABEL`       | `label` (full `Label`: `{ id, name, color }`) | Adds a label. Ignored on a duplicate id or at `LIMITS.labelsPerBoard` (50). |
| `RENAME_LABEL`    | `labelId`, `name`                             | Renames a label. Blank falls back to the current name.                      |
| `SET_LABEL_COLOR` | `labelId`, `color` (`LabelColor`)             | Sets the label color. Same color is a no-op.                                |
| `DELETE_LABEL`    | `labelId`                                     | Removes the label and detaches it from every card.                          |

### Checklists

| Action                    | Fields                                            | Meaning                                                                            |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ADD_CHECKLIST`           | `cardId`, `newChecklistId`, `title`               | Adds a checklist. Ignored at `LIMITS.checklistsPerCard` (20) or on a duplicate id. |
| `RENAME_CHECKLIST`        | `cardId`, `checklistId`, `title`                  | Renames a checklist.                                                               |
| `DELETE_CHECKLIST`        | `cardId`, `checklistId`                           | Removes a checklist.                                                               |
| `ADD_CHECKLIST_ITEM`      | `cardId`, `checklistId`, `newItemId`, `text`      | Adds an item. Ignored at `LIMITS.itemsPerChecklist` (100) or on a duplicate id. `text` is capped at `LIMITS.checklistItem` (500). |
| `SET_CHECKLIST_ITEM_DONE` | `cardId`, `checklistId`, `itemId`, `done` boolean | Checks or unchecks an item. Absolute, not a toggle.                                |
| `RENAME_CHECKLIST_ITEM`   | `cardId`, `checklistId`, `itemId`, `text`         | Renames an item.                                                                   |
| `DELETE_CHECKLIST_ITEM`   | `cardId`, `checklistId`, `itemId`                 | Removes an item.                                                                   |

### Links

| Action             | Fields                                                                                    | Meaning                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADD_CARD_LINK`    | `cardId`, `linkId`, `targetCardId`, `linkType` `"blocks" \| "relates_to" \| "duplicates"` | Adds a link row on the source card. Guards: known cards, no self-link, one link per unordered pair, `LIMITS.linksPerCard` (50), and no `blocks` cycle. |
| `REMOVE_CARD_LINK` | `cardId`, `linkId`, `targetCardId`, `linkType`                                            | Removes one link row. `targetCardId` and `linkType` are redundant with the stored row so the inverse is computable from the command alone.             |

### Restore and inverse

These put back data that was deleted. They are the only actions exempt from
the collection and WIP guards. The reducer also marks them with `inverse`
and the inverse-only timestamp overrides.

| Action                   | Fields                                                     | Meaning                                                                               |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `RESTORE_CARD`           | `card` (`Card`), `columnId` optional, `index` optional     | Puts a deleted card back with its content and position.                               |
| `RESTORE_COLUMN`         | `column` (`Column`), `index`, `cards` (`Card[]`)           | Puts a deleted column back with its cards, at its old position.                       |
| `RESTORE_LABEL`          | `label` (`Label`), `index`, `assignments` optional         | Puts a deleted label back, with its card assignments.                                 |
| `RESTORE_CHECKLIST`      | `cardId`, `checklist` (`Checklist`), `index`               | Puts a deleted checklist back on its card.                                            |
| `RESTORE_CHECKLIST_ITEM` | `cardId`, `checklistId`, `item` (`ChecklistItem`), `index` | Puts a deleted checklist item back.                                                   |
| `RESTORE_COLUMN_CARDS`   | `columnId`, `cardIds` string[], `cards` (`Card[]`)         | Writes `cards` back and sets the column order. The inverse of `ARCHIVE_COLUMN_CARDS`. |

### Board-level

| Action            | Fields          | Meaning                                                                                          |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `RENAME_BOARD`    | `title`         | Renames the board. Title clamped to `LIMITS.boardTitle` (100). Allowed for `ADMIN` and `MEMBER`. |
| `ARCHIVE_BOARD`   | `boardId`, `at` | Archives the board. `ADMIN` only; a non-`ADMIN` answers `403`.                                   |
| `UNARCHIVE_BOARD` | `boardId`, `at` | Brings an archived board back. `ADMIN` only; a non-`ADMIN` answers `403`.                        |

### Aggregate-level (rejected by the command endpoint)

These four actions are board create, import and delete. They are handled by
REST (`POST /boards`, `POST /boards/import`, `DELETE /boards/:id`) and are
rejected by the command endpoint with `400`:

| Action          | Fields                                |
| --------------- | ------------------------------------- |
| `RESTORE_BOARD` | `board` (`Board`), `boardId` optional |
| `IMPORT_BOARDS` | `boards` (`BoardState`)               |
| `ADD_BOARD`     | `board` (`Board`)                     |
| `REMOVE_BOARD`  | `boardId`                             |

## Touch labels

`touches` and the SSE frame use these labels to name the entities a command
wrote: `card:<id>`, `column:<id>`, `label:<id>`, `checklist:<id>`,
`checklistItem:<id>`, `board:<id>`. An empty array means the command changed
nothing. A client uses `touches` to mark its undo history foreign without
diffing the whole board.

## Master-contour variant

The master-account API exposes `POST /admin/boards/:id/commands` with the same
action shape. Its body is `AdminBoardCommandRequest`: `{ commandId? string,
action BoardAction }`. It is part of the separate master-account contour and
is out of scope for this page.
