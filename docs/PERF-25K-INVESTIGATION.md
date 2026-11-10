# Scaling one Janosik board to 25,000 cards

**Status:** investigation / design note, not an implementation.
**Date:** 2026-11-10.
**Scope:** one board, server mode, one API node, 5-12 columns, human and agent
readers/writers. Multi-node is explicitly out of scope (TASK-175).

This document uses the measurements already taken on 2026-11-10
(`~/.janosik-dev/load/capacity-2026-11-10/`) and code inspection. No new load
test was run for it; every number derived from those measurements is marked
**estimate**.

---

## Executive summary

- **The database is not the scaling problem.** 25,000 cards are roughly 18 MB
  of card rows and a few small indexes. A keyset page or a per-column count is
  a millisecond-scale query. The cost is that Janosik loads the **whole board
  aggregate** for every command and every reader, serializes it, and keeps it
  in every client.
- **At 10,000 cards the architecture is already at its limit.** Measured:
  `GET /boards/:id` 263/275 ms p50/p95 and 6.75 MB; `UPDATE_CARD` 299 ms;
  `MOVE_CARD` 288/364 ms; `ADD_CARD` 340 ms; five concurrent writers reach only
  3.4 commands/s with a 13.9 s p95; ten concurrent opens take the API from
  173 MB to 1,479 MB RSS; the board first renders in 906 ms and the table in
  812 ms.
- **A linear extrapolation to 25,000 cards fails every read, write and memory
  target.** Estimate: ~17.7 MB payload, ~0.64 s GET, ~0.7-0.8 s per command,
  ~1.4 commands/s for five writers with a 30 s p95, ~3.3 GB RSS for ten opens,
  ~1.7 s board first render and ~1.8 s table. These are planning estimates, not
  measurements.
- **Two independent changes are required.** A read model fixes payload,
  latency, memory and UI cost. A write path fixes command latency and
  throughput. Either one alone leaves half the problem in place: paginating
  only the UI still reloads 17.7 MB per command, and caching only the command
  path still sends 17.7 MB to every reader.
- **Recommended target shape:** 12 columns x ~2,100 cards (25,200 total) as
  the expected product shape, with 5 columns x 5,000 as the **mandatory stress
  shape**. The plan optimizes the per-column bound for 5,000 cards, because a
  single fat column is the worst case for position rewrites and command
  latency; 12 x 2,100 then follows.
- **Recommended plan:** ship low-risk transport/CPU fixes first (compression,
  ETag, removing the double full-board `stableStringify`), then the read model
  v1 (summary + per-column cursor windows + card detail), then the write-path
  v1 (per-board aggregate cache validated by `seq`, plus targeted pre-checks
  and an append fast path), then raise the cap behind gates.
- **First two implementation tasks:** (1) read model v1, (2) write-path v1.
  They are independent and can run in parallel; the read model should start
  first because it caps memory and payload and is the safer rollback.
- **Do not** just raise `LIMITS.cardsPerColumn`, paginate only the UI while
  the command path still loads the whole board, or keep a per-command
  `stableStringify` of the full board.

---

## 1. Problem statement and target

### 1.1 Today's limit

The shared product limits are still `LIMITS.columnsPerBoard = 12` and
`LIMITS.cardsPerColumn = 200`
(`shared/src/types/kanban.ts:361-365`), so the current maximum is 2,400 cards
per board. The 10,000-card measurements required lifting the per-column cap
only in a disposable backend; the product cannot create such a board today.

The requirement is one board of ~25,000 cards. That is 10.4x the current
maximum and 2.5x the largest measured tier. The target is not "the database
stores 25,000 rows" -- Postgres already can. The target is that humans and
agents can **open, read, filter, edit and move** cards on that board without
the API, the client or the command log falling over.

### 1.2 Realistic shapes

| Shape       | Cards/column |  Total | What it represents                                                                 |
| ----------- | -----------: | -----: | ---------------------------------------------------------------------------------- |
| 5 x 5,000   |        5,000 | 25,000 | The measured harness shape. A fat Backlog/Done column; worst case per-column work. |
| 12 x ~2,100 |        2,100 | 25,200 | The expected shape for a real delivery board that uses all 12 allowed columns.     |
| 1 x 25,000  |       25,000 | 25,000 | Pathological. Not a supported shape; one column would dominate every rewrite.      |
| 25 x 1,000  |        1,000 | 25,000 | Not supported by the current 12-column product limit.                              |

**Decision:** support up to 25,000 active cards on one board across at most 12
columns. Optimize the design for **5 columns x 5,000** as the stress case and
validate **12 columns x ~2,100** as the expected case. Do not support a single
25,000-card column; use a per-column hard cap (proposal: soft 5,000, hard
10,000) plus the board-level hard cap of 25,000.

A per-column cap is not a substitute for a board cap: a real board can put
most of its cards in one Done column, so the design must bound the work for a
5,000-card column even when the total is 25,000.

### 1.3 Target SLOs for 25,000 cards

These are product SLOs, not benchmark wishes. They apply to the 5 x 5,000
stress shape unless stated otherwise.

| Dimension                 | Target at 25k                                                                 | Reasoning                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Initial board view        | server p95 < 300 ms; < 2 MB transferred; <= 1,000 card summaries              | One screen shows 5-12 columns x 50 cards, not 25k. 2 MB is a practical mobile/agent budget.                 |
| Full-board page           | any single page <= 200 cards; p95 < 300 ms; keyset cursor                     | Keep every response bounded; never materialize all 25k for one view.                                        |
| Single command            | p50 < 150 ms; p95 < 500 ms (UPDATE/MOVE/ADD)                                  | 150 ms is the interactive threshold; 500 ms still feels responsive under load.                              |
| 10 concurrent agents      | >= 10 commands/s aggregate; p95 < 1 s                                         | The measured 5-writer p95 of 13.9 s at 10k is the failure mode to remove.                                   |
| 10 concurrent board opens | API RSS < 1.5 GB; p95 < 1 s per open                                          | A 2 GB VPS must survive a small swarm; today 10 opens at 10k already take 1.48 GB.                          |
| UI board                  | first render < 1.5 s; no long task > 200 ms; DOM < 3,000 nodes; heap < 200 MB | Virtualization already keeps DOM small; the remaining cost is payload parse, store shape and projections.   |
| UI table                  | first render < 1 s; scroll long task < 100 ms                                 | Table currently flattens and optionally sorts all cards; 25k must not run that on the main thread per edit. |
| UI filter/search          | keystroke-to-result < 100 ms; no main-thread block > 50 ms                    | Current filter scans every card and lowercases descriptions on every keystroke.                             |
| SSE                       | 10 agents x 10 commands/s applied without long task > 50 ms                   | SSE deltas are already cheap at 10k; keep them cheap when frames carry large descriptions.                  |
| Correctness               | zero reducer divergence; idempotent replay; undo/export round-trip            | Performance changes must not weaken the command log, undo, `ifMatch`, plans or idempotency.                 |

The initial-view SLO deliberately excludes the full board. A user who scrolls
to the end or opens the table may fetch more pages; those pages have their own
bounded latency. "Open the board and see the first screen" is the SLO that must
hold at 25k.

### 1.4 Non-goals

- Multi-node, Redis fan-out, sharding and a global command ceiling (TASK-175).
- 25,000 cards in local/offline mode or `localStorage`.
- Changing reducer semantics, the command-log format or the export schema.
- Comments, attachments or activity inside the board aggregate.
- A separate search engine (Elasticsearch/Meilisearch); Postgres is enough for
  the expected search volume.
- Real-time collaborative editing (CRDT/OT) or per-card SSE subscriptions.

---

## 2. Evidence

### 2.1 Provenance

The measurements come from `~/.janosik-dev/load/capacity-2026-11-10/REPORT.md`
and its `results/` JSON. Stand: WSL2 Ubuntu 24.04, AMD Ryzen 7 7700
(8 cores/16 threads), 23 GiB RAM; PostgreSQL 16.15 in Docker with default
settings; one compiled Node API process with `DB_CONNECTION_LIMIT=10`; Vite dev
server plus headless Chrome at 1600x900. The board had 5 columns, every card had
a title and a ~500-character description, and no labels, checklists, links,
comments or attachments. Load generators ran on the same host, so absolute
numbers are conservative. The per-column cap was lifted only in the disposable
backend. No new tests were run for this document.

The 10k measurement is the control: it is the largest tier with HTTP, memory
and UI numbers, and it is 2.5x below the target.

### 2.2 Measured HTTP, memory and UI

|  Cards | Payload | GET p50/p95 | 10 concurrent GET   | UPDATE p50/p95 | MOVE p50/p95 | ADD p50/p95 | 5 writers            | 10-open RSS | UI board | UI table |
| -----: | ------: | ----------: | ------------------- | -------------: | -----------: | ----------: | -------------------- | ----------: | -------: | -------: |
|    500 | 0.33 MB |    23/25 ms | 144 rps, p95 678 ms |       35/40 ms |     32/42 ms |    42/44 ms | 31.2 cmd/s, p95 1.5s |      325 MB |   403 ms |        - |
|  1,000 | 0.67 MB |    33/35 ms | 84 rps, p95 1.2 s   |       48/51 ms |     43/55 ms |    58/59 ms | 23.0 cmd/s, p95 2.0s |      325 MB |   414 ms |        - |
|  2,500 | 1.67 MB |    65/69 ms | 33 rps, p95 3.0 s   |       80/84 ms |    78/105 ms |   99/101 ms | 13.0 cmd/s, p95 3.6s |      582 MB |   476 ms |        - |
|  5,000 | 3.37 MB |  128/131 ms | 20.7 rps, p95 4.8 s |     147/161 ms |   140/156 ms |  181/183 ms | 7.2 cmd/s, p95 6.5s  |      809 MB |   627 ms |   489 ms |
| 10,000 | 6.75 MB |  263/275 ms | 19.7 rps, p95 5.0 s |     299/313 ms |   288/364 ms |  340/343 ms | 3.4 cmd/s, p95 13.9s |    1,479 MB |   906 ms |   812 ms |

Additional 10k figures: 20 sequential reads grow RSS to ~677 MB; board first
render mounts 50 cards / ~2,013 DOM nodes / 95 MB heap with a 184 ms max long
task; idle heap after load is 131 MB; table first render is 29 rows / 893 nodes
/ 124 MB heap, with a 75 ms long task when scrolling to the last row. Live
updates at 10k: 20 `UPDATE_CARD` commands ~150 ms apart took 6.2 s total
(~311 ms per command), all 200, and the UI applied the SSE deltas with 0 long
tasks.

Sources: `results/perf-http-results.json`, `results/perf-cold-memory.json`,
`results/perf-concurrency-memory.json`, `results/perf-ui-results.json`,
`results/perf-table-results.json`, `results/perf-fixtures.json`.

### 2.3 Extrapolation to 25,000

The table below fits a straight line through the 500-10,000 points and
evaluates it at 25,000. This is an **estimate**. The 25k point is 2.5x beyond
the largest measurement, and queueing/GC effects are not linear, so treat the
p95 and memory numbers as ranges, not promises.

| Metric                       |  10k measured |         25k estimate | Basis / assumption                                                                 |
| ---------------------------- | ------------: | -------------------: | ---------------------------------------------------------------------------------- |
| Payload (uncompressed JSON)  |       6.75 MB |          **17.7 MB** | 707.5 bytes/card, linear; same 500-char descriptions, no labels/checklists.        |
| `GET` p50 / p95              |    263/275 ms |      **~640/670 ms** | Linear fit: ~5.9 ms + 25.3 us/card. At 25k CPU and JSON serialize may add more.    |
| `UPDATE_CARD` p50 / p95      |    299/313 ms |      **~710/745 ms** | Linear fit: ~16 ms + 27.8 us/card.                                                 |
| `MOVE_CARD` p50 / p95        |    288/364 ms |      **~690/850 ms** | Linear fit: ~14 ms + 27.0 us/card; p95 slope steeper (33.4 us/card).               |
| `ADD_CARD` p50 / p95         |    340/343 ms |      **~810/815 ms** | Linear fit: ~24 ms + 31.5 us/card.                                                 |
| 5-writer throughput          |     3.4 cmd/s |       **~1.4 cmd/s** | Linear fit of seconds/command (0.0123 + 27.6 us/card); writes serialize per board. |
| 5-writer p95 latency         |        13.9 s |         **~30-35 s** | Fit over the 50-command burst; queueing is the least linear number here.           |
| 10 concurrent opens, API RSS |      1,479 MB |          **~3.3 GB** | Linear fit: 220 MB + 125 MB per 1k cards; includes per-request aggregate copies.   |
| UI board first render        |        906 ms |           **~1.7 s** | Linear fit: 360 ms + 54 us/card; parse/store/render, not DOM (virtualized).        |
| UI table first render        |        812 ms |           **~1.8 s** | Linear fit from 5k/10k: 166 ms + 65 us/card; flatten + sort + render.              |
| UI heap (board / table)      |   95 / 124 MB |      **~150-200 MB** | Linear-ish from 5k/10k; object overhead per card is the driver.                    |
| DOM nodes                    |        ~2,013 |           **~2,000** | Virtualization; effectively flat.                                                  |
| Filter keystroke             |  not measured |         **~0.1-1 s** | O(cards x text length), description lowercasing; estimate only.                    |
| Export, compact / pretty     | 6.75 / ~10 MB | **17.7 / ~25-28 MB** | Compact 707 B/card; pretty `JSON.stringify(..., null, 2)` adds 1.4-1.6x.           |

Assumptions: same 5-column shape, same 500-character descriptions, same
hardware, one API process, no compression, no other traffic. The linear fit is
a planning tool; the benchmark matrix in section 6 is the only way to turn
these into commitments.

### 2.4 What the numbers say

- **Reads scale almost perfectly linearly with cards** (23 ms at 500 to 263 ms
  at 10k). That is the signature of "load and serialize all rows", not of an
  index problem.
- **Writes scale worse than reads** (35 ms to 299 ms) because each command also
  runs the reducer and the before/after diff over the whole board. At 25k the
  command is ~0.7-0.8 s, and five writers collapse to ~1.4 commands/s.
- **Concurrent opens multiply memory**, not just latency: ten 10k opens take
  1.48 GB because each request materializes the aggregate and the serialized
  JSON. At 25k that is ~3.3 GB before the cache or the client is considered.
- **The UI's virtualization is not the problem.** DOM stays at ~2,000 nodes
  and 50 mounted cards from 500 to 10k. The cost is downloading, parsing and
  retaining the full board, and then running full-board projections (table
  flatten/sort, calendar scan, filter scan) on the main thread.
- **The write path is the hard blocker.** Even a perfect read model leaves
  `UPDATE_CARD` at ~0.7 s and five writers at ~1.4 commands/s.
- **Transport is currently uncompressed.** The measured `content-encoding` is
  empty. Gzip/brotli would cut the 25k payload to an estimated 3.5-4.5 MB
  (4-6x, and the seeded corpus is repetitive, so real prose may compress less),
  but it would still miss the < 2 MB initial-view budget and would not reduce
  server CPU or client memory. Compression is necessary, not sufficient.

### 2.5 Export estimate

`serializeExport` writes the whole board with `JSON.stringify(payload, null,
2)` (`shared/src/utils/board-serialization.ts:39-50`). The compact 25k board is
~17.7 MB; pretty-printing typically adds 40-60%, so the inline export is
~25-28 MB. The cap is 25 MB (`MAX_IMPORT_BYTES` / `MAX_BOARD_EXPORT_BYTES`,
`shared/src/types/kanban.ts:380-383`), and the preflight uses
`pg_column_size` plus an exact string check
(`backend/src/boards/boards.service.ts:708-755`). A 25k board with normal
descriptions will therefore often answer `413`, and a board with checklists,
labels or long descriptions will always exceed it. This is **estimate** based
on JSON size ratios; it must be measured with a real 25k fixture.

---

## 3. Bottleneck analysis

### 3.1 At a glance

| #   | Bottleneck                            | Where                                                                            | What scales with it                           | First fix                                         |
| --- | ------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| 1   | Full aggregate load per command       | `backend/src/commands/commands.service.ts:372`                                   | cards + checklists + links                    | per-board cache / targeted load (section 4.2)     |
| 2   | Reducer + full-board diff per command | `commands.service.ts:578-584`                                                    | cards, twice (`stableStringify` before/after) | identity-based no-op detection (P0.1)             |
| 3   | Position rewrite of whole columns     | `command-writers.ts:185-205`, `:782`, `:1443-1451`                               | column size, on ADD/MOVE/ARCHIVE/SORT         | append fast path, then gap positions (P0/P1)      |
| 4   | Full aggregate transport              | `backend/src/boards/boards.service.ts:249-276`, no compression                   | cards x readers                               | read model + gzip/brotli + ETag (P0)              |
| 5   | Client holds the whole board          | `ui/src/store/BoardContext.tsx:1000-1064`, `:936-990`                            | cards x open boards                           | summary store + lazy details (P0)                 |
| 6   | Table/calendar/filter projections     | `TableView.tsx:306-333`, `CalendarView.tsx:347-390`, `filter.ts:379-412`         | cards, on every edit/keystroke                | server/worker projection, pagination (P0/P1)      |
| 7   | SSE frames carry full action          | `commands.service.ts:430-447`, `realtime.ts`                                     | description size x subscribers                | frame cap / detail-stale signal (P0)              |
| 8   | MCP reads the whole board per call    | `mcp/src/tools/boards.ts:121`, `mcp/src/tools/cards.ts:271`, `client.ts:342-390` | cards x tool calls                            | use new read endpoints (P0)                       |
| 9   | Export/import inline 25 MB            | `boards.service.ts:708-788`, `board-serialization.ts`                            | cards + descriptions                          | streaming/async export (P0.4)                     |
| 10  | DB query shape                        | `board-aggregate.ts:64-100`                                                      | cards, but small at 25k                       | projections/partial indexes (P1, not the blocker) |

### 3.2 Command path: one full board load per command

`CommandsService.applyBatch` is the single path for both
`POST /boards/:id/commands` and `/commands/batch`
(`backend/src/commands/commands.service.ts:264-452`). Inside the per-board
write lock it:

1. loads the board row and resolves `commandId` replays (`:321-355`);
2. runs `assertIdsBelongToBoard` (`:370`, seven `findFirst` queries);
3. calls `loadBoardAggregate(tx, boardId)` (`:372`);
4. for every command, checks assignee/claim/management/version/workflow
   (`:544-575`), runs `boardReducer` over the full board (`:578-582`), and
   computes `changed` with **two full-board `stableStringify` calls**
   (`:584`, implementation at `:1365-1372`);
5. writes the command row (`:599-617`), applies the command-specific writes
   (`:621-632`), collects versions, and updates the row (`:636-643`).

The batch amortizes the lock, the aggregate load and the cross-board id check
across up to 100 commands, but **not** the reducer, the two stringifications,
the per-command pre-checks or the per-command `Command` insert/update. This is
why the measured batch gain at 200 cards was 2.3-2.5x, not 5x
(`docs/PERF-ONE-BOARD.md`). At 25k, a batch of five still pays five reducer
passes and five full-board diffs; it cannot reach 10 commands/s on its own.

`loadBoardAggregate` (`backend/src/boards/board-aggregate.ts:55-103`) issues
one board lookup plus four parallel queries: columns, labels, cards
(with `labels` and nested `checklists.items`), and card links. It returns every
card on the board, including descriptions and checklists, then
`toBoardAggregate` builds a `Record<string, Card>` and, for each column,
filters the full card array (`:165-172`) -- an O(columns x cards) pass that is
minor at 25k but easy to make single-pass.

The reducer itself is efficient per card, but it is called with the whole
board and `withActivity: false`. A command that changes one description still
allocates a new `cards` record (`shared/src/store/board-reducer.ts` update
paths), and the server then serializes the whole before/after board twice to
decide whether anything changed. At 10k that is two ~7 MB string walks per
command; at 25k, two ~18 MB walks. This is pure CPU under the board lock.

### 3.3 Position writes: dense positions mean O(column) per insert/move

`writeCardPositions` rewrites every active card in a column with a batched
`UPDATE ... FROM (VALUES ...)` (`backend/src/commands/command-writers.ts:185-205`,
chunks of 1,000 at `:212`). It is called by:

- `ADD_CARD` for the destination column (`:769-783`);
- `MOVE_CARD` for both source and destination (`:1431-1455`);
- `ARCHIVE_CARD` / `UNARCHIVE_CARD` (`:1390-1425`);
- `DUPLICATE_CARD` (`:1310-1330`), `RESTORE_CARD` (`:895`), and
  `SORT_COLUMN` / `SET_COLUMN_CARD_ORDER` (`:725-738`).

Because positions are dense integers 0..N-1, inserting at the top shifts every
following card. At 5,000 cards that is five statements touching 5,000 rows per
add/move; at a 25,000-card column it would be 25 statements. The write is
inside the board transaction and the board lock, so it directly reduces command
throughput. Even an append rewrites the whole column, although appending only
needs the new row.

The column order is part of the API contract (`column.cardIds` is the order the
UI renders and DnD uses), so any fix must preserve exact order. Options are an
append fast path (P0), gap/fractional positions with occasional rebalancing
(P1), or a separate order table (larger change, not recommended now).

### 3.4 Aggregate transport: every reader pays for the whole board

`GET /boards/:id` calls `getAggregateWithSeq`
(`backend/src/boards/boards.service.ts:249-276`), which loads the full
aggregate and the max command `seq` in one `REPEATABLE READ` transaction. There
is no pagination, projection or conditional response. The controller sets
`X-Board-Seq` (`backend/src/boards/boards.controller.ts:92-103`), and the JSON
is sent as-is.

There is **no compression middleware** in the backend: `backend/package.json`
has no `compression` dependency, and `backend/src/common/app-setup.ts` only
sets helmet, cookies and body parsers. The measured responses report
`content-encoding: ""`. At 25k every reader downloads ~17.7 MB; ten concurrent
opens transfer ~177 MB and each request allocates its own JSON string. The
server also runs `stableStringify` on the command path, but the read path's
JSON serialization is a separate CPU cost per request.

There is no `ETag` / `If-None-Match`. A focus refetch, a manual refresh, a
rollback refetch or an SSE resync always pulls the full aggregate again
(`ui/src/store/BoardContext.tsx:1152-1200`). On a 25k board, a resync is a
17.7 MB event.

### 3.5 Client memory and store shape

The client store is a `BoardState` array of full `Board` objects
(`ui/src/store/BoardContext.tsx`). Hydration loads the first board, then every
other board in the background (`:1000-1064`), each via
`api.getBoardSnapshot(id)` (`:936-990`). A user with several large boards pays
for all of them, even if only one is on screen.

Every command replaces `board.cards` with a new record. `useCardList` memoizes
per-column card arrays using the column object as the cache key
(`ui/src/hooks/use-card-list.ts:16-41`), which keeps the board view from
re-rendering every column on an unrelated edit. But every consumer of
`useBoard()` still receives a new `board` object, and projections that depend
on `board` recompute:

- `BoardSection` recomputes `filterCardIds` on every board change while a
  filter is active (`ui/src/components/BoardSection.tsx:97-108`);
- `TableView` rebuilds `rows` for all columns and re-sorts them on every board
  change (`ui/src/components/board/TableView.tsx:306-333`);
- `CalendarView` rebuilds `entriesByDay` and the unscheduled list
  (`ui/src/components/board/CalendarView.tsx:347-390`).

At 10k the board heap is 95 MB and the table heap 124 MB. At 25k, a full
`Board` with 25k cards and descriptions is an estimated 150-200 MB before any
detail caches; ten server-side opens are ~3.3 GB. The client memory problem is
the same aggregate shape as the server problem, not a React leak.

### 3.6 UI projections

- **Board view.** Virtualization already works: 50 mounted cards and ~2,000
  DOM nodes at both 5k and 10k (`use-card-window.ts`). The first-render cost is
  dominated by downloading/parsing the 6.75 MB payload and building the store,
  not by DOM. At 25k, expect ~1.7 s. `ColumnView` also joins the full id list
  into a string on each render (`ColumnView.tsx:199-205`); at 5,000 ids this is
  small, but it is another O(column) pass per render.
- **Table view.** `rows` is a `flatMap` over every column and every card; if a
  sort is active, `sortedRows` sorts all 25k rows. The virtualizer only limits
  the DOM, not the data work. At 10k it is 812 ms; at 25k ~1.8 s, failing the
  < 1 s target. A server page or a worker sort is required.
- **Calendar view.** `entriesByDay` scans every card with a due date, creates
  `DayEntry` objects, and sorts each day's list by due date; `unscheduled`
  scans every card without a date. At 25k this is a full-board projection on
  the main thread. A date-range query (`dueFrom`/`dueTo`) and a paginated
  unscheduled list are the natural fixes.
- **Filter.** `filterCardIds` iterates every card and, for a query, lowercases
  the title, description and checklist items and scans them
  (`ui/src/utils/filter.ts:295-412`). The filter runs on every keystroke and on
  every board change while active. At 25k with 64 KB descriptions this can
  block the main thread for hundreds of milliseconds. Move it to a worker or
  the server above a threshold, and debounce.

### 3.7 Database query shape

25k is not a database size problem:

- `Card` rows are ~18 MB at 707 bytes/card; indexes on
  `[columnId, position]`, `[assigneeId]`, `[claimedByTokenId]` etc. are small.
- A per-column page is an index scan over ~2,100 rows (or ~5,000 in the stress
  shape), then a heap fetch for the projected columns. Single-digit to low
  tens of milliseconds on this hardware.
- The measured 263 ms GET at 10k is dominated by Prisma hydration of nested
  `labels`/`checklists.items`, building the JS aggregate, JSON serialization
  and network, not by the `Card` scan. The 25k DB query will still be fast;
  the JS object graph and payload will not.

Still, the current query shape leaves performance on the table:

- `loadBoardAggregate` always includes `checklists.items` for every card, even
  when the caller only needs a board list or a command that touches one card.
- The card filter is `where: { column: { boardId }, deletedAt: null }` with
  `orderBy: { position: "asc" }` (`board-aggregate.ts:73-89`). The existing
  `[columnId, position]` index is usable, but it also covers deleted and
  archived rows. A partial index
  `Card(columnId, position) WHERE deletedAt IS NULL AND archivedAt IS NULL`
  would make the hot path smaller.
- Keyset pagination needs a stable tie-breaker. Add `id` to the ordering and
  index, e.g. `(columnId, position, id)`, and use
  `(position, id) > ($cursorPosition, $cursorId)`.
- `searchCards` uses `contains`/`mode: "insensitive"` on title, description,
  checklist item and comment (`boards.service.ts:192-225`), which becomes
  `ILIKE '%q%'`. At 25k this is a sequential scan, and `description` is TOASTed.
  It is acceptable for an occasional search, not for per-keystroke filtering.
  If server-side search becomes a product feature, add `pg_trgm` GIN indexes
  and a snippet/ranking contract.

**EXPLAIN expectation** for a 25k per-column page: `Index Scan` or
`Bitmap Heap Scan` on the partial `(columnId, position, id)` index, ~100-200
rows for a 100-card page, < 5 ms execution; a board-wide count is an index-only
scan over 25k entries, < 10 ms. If the plan shows a sequential scan of `Card`
or a nested loop over `ChecklistItem`, the projection is wrong, not the
database.

### 3.8 Import, export and backup

`serializeExport` pretty-prints the whole `BoardState`
(`shared/src/utils/board-serialization.ts:39-50`). `exportBoardSerialized`
first estimates size with `pg_column_size` over cards, columns, labels, links,
card labels, checklists and items (`boards.service.ts:708-744`), then loads the
full aggregate, serializes it, and checks the exact byte length
(`:746-755`). At 25k this is two copies of the board in memory plus the string.

`importBoards` parses the whole envelope, runs `parseExport`/`normalizeBoards`,
and inserts in one 120 s transaction with chunked `createMany`
(`boards.service.ts:760-815`, `board-import.ts:226-265`). 25k rows fit, but the
parsed object, normalized state and insert buffers can be several hundred MB.
The 25 MB import cap is a hard wall for a 25k board with 500-char descriptions
once the pretty export exceeds it.

**Backups:** the API export is a share/transfer format, not a database backup
at 25k. Use `pg_dump` / physical backups for full-instance disaster recovery,
and document that the inline export is for boards that fit the byte cap.

### 3.9 SSE

SSE is not the main bottleneck today. At 10k, 20 `UPDATE_CARD` commands took
6.2 s total (~311 ms each), and the browser applied the deltas with 0 long
tasks. The command path, not the stream, was the cost.

Two things become relevant at 25k:

- **Frame size.** A `CommandSseEvent` carries the whole action
  (`commands.service.ts:414-424` publishes it after commit). An
  `UPDATE_CARD` with a 64 KB description broadcasts 64 KB to every subscriber.
  Ten readers = 640 KB per edit; 100 readers = 6.4 MB per edit. The action is
  also stored in `Command.payload` as JSONB.
- **Resync.** A `resync` frame or a gap currently tells the client to re-read
  the full board aggregate (`ui/src/store/realtime.ts` and
  `docs/api/commands.md`). At 25k that is a 17.7 MB refetch per affected client.

The fix is not to replace SSE. Keep the delta stream, cap or summarize large
description fields, let the open card fetch full detail on demand, and make
resync fetch the summary + current window instead of the full aggregate.

### 3.10 MCP read surface

The MCP server is a multiplier of the read-path problem:

- `janosik_get_board` calls `client.getBoardWithSeq(boardId)` (full aggregate),
  then `sliceBoard` filters to a column and `detail=summary` strips fields
  (`mcp/src/tools/boards.ts:121-141`). `columnId` and `detail` reduce the
  **response**, not the download or the DB work.
- `janosik_get_card` calls `client.getBoard(boardId)` and picks one card
  (`mcp/src/tools/cards.ts:271-285`). Reading one card downloads the board.
- `commandOnFreshBoard` reads the board before every write unless a prefetched
  snapshot is passed (`mcp/src/client.ts:342-390`). `update_card` with
  `expectedDescription`, move with the DoD gate, column moves and link
  operations use it. Ten agents doing read-modify-write can easily issue
  hundreds of full-board reads.
- `search_cards` loads the board (or every board) and filters client-side
  (`mcp/src/tools/cards.ts:900-1008`, `:1168-1185`).

The 74-tool surface is not the problem, and adding dozens of tools would make
it worse. The 25,000-character response cap (`mcp/src/constants.ts:13`)
truncates large markdown and refuses oversize JSON; the only honest fix is a
bounded read model, not a larger cap. Add two or three read primitives
(`get_card_by_id`, `list_cards` with cursor, `get_board_summary`) and extend
existing tools with `cursor`/`detail`, then make the MCP client use
`GET /cards/:id` and `GET /boards/:id/cards` instead of the full aggregate. `commandOnFreshBoard`
should accept a card context (card + column + version + neighbors) rather than
requiring the whole board.

---

## 4. Options and trade-offs

Effort: **S** <= 1 engineer-week, **M** 2-4 weeks, **L** 5-8 weeks, **XL** > 8
weeks. Impact is relative to the 25k target, not to a single request.

### 4.1 Read model

| Option                                                        | Effort | Expected impact                                                              | Risk / cost                                                                                   | Verdict                          |
| ------------------------------------------------------------- | :----: | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------- |
| Keep the full aggregate (status quo)                          |   -    | Fails 25k: 17.7 MB, ~640 ms, ~3.3 GB for 10 opens                            | Simple and compatible; cannot scale                                                           | Keep only below a threshold      |
| Board skeleton + per-column card windows + card detail        |  L/XL  | Initial view < 300 ms and < 2 MB; memory ~10x lower; UI first render < 1.5 s | Two code paths; client store rewrite; deep links/DnD/undo need tests                          | **Recommended**                  |
| Paginate only in the UI (server still returns full aggregate) |   S    | Almost none: the 17.7 MB download and server load remain                     | False sense of progress; command path still broken                                            | **Do not**                       |
| Cursor pagination for cards only                              |   M    | Bounds response and DB work; fixes large table/search reads                  | Does not fix initial board load or command path unless the board uses it                      | Necessary part of the read model |
| Server-side filter/search                                     |   M    | Removes O(25k) client scans; enables cursor + snippet                        | Semantics must match `filter.ts` (title/description/labels/checklist/comments); needs indexes | P1, not first                    |
| ETag / `If-None-Match`                                        |   S    | Avoids repeat payloads on focus/resync; 304 is nearly free                   | Must key on board `seq` + projection; a wrong seq serves stale data                           | **P0 quick win**                 |
| gzip / brotli                                                 |   S    | 70-80% fewer bytes; 17.7 MB -> ~3.5-4.5 MB at 25k                            | CPU per response; still misses < 2 MB; tune threshold and compression level                   | **P0 quick win**                 |
| Summary vs detail projection                                  |   M    | Descriptions/checklists out of the hot path; summary page is small           | UI/MCP must fetch detail; summary field list must be stable                                   | **P0**                           |
| Keep full aggregate below a threshold (e.g. 2,000 cards)      |   S    | Backward compatibility, offline/local, small boards stay simple              | Two paths to test; threshold drift                                                            | **Recommended**                  |

**Recommendation:** implement the skeleton + window + detail model, with a
full-aggregate fallback under a threshold. Compression and ETag are cheap
wins that should land first and remain useful afterward.

### 4.2 Write path

| Option                                                                    | Effort | Expected impact at 25k                      | Risk / correctness                                                                                          | Verdict            |
| ------------------------------------------------------------------------- | :----: | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| (a) Per-board in-memory aggregate cache with `seq` invalidation           |   L    | Removes the full DB load per command; 5-10x | Coherency with non-command writers, multi-process, restart/warm-up, memory LRU, undo/pre-images             | **Recommended P0** |
| (b) Command-specific targeted loads (only affected columns/cards + index) |   L    | 3-6x, no cache coherency                    | Requires a `BoardSlice`/index and per-action reducer paths; validation IDs must still be checked board-wide | Fallback/next step |
| (c) Batch amortization (already exists)                                   |  S-M   | 2.3-2.5x at 200 cards; less at 25k          | Does not remove per-command reducer/stringify; batch of 100 can hold the lock longer                        | Keep and extend    |
| (d) Move validation to SQL/constraints                                    |   L    | Removes JS checks; small per-command win    | Schema/migration risk; WIP and workflow rules are product logic, not simple constraints                     | Later (P2)         |

#### (a) Per-board aggregate cache

Keep the loaded `BoardAggregate` for an active board in the API process, keyed
by `boardId`, with the `seq` it reflects. On a command:

1. inside the board transaction, read the current `seq` (or a new
   `Board.commandSeq` counter);
2. if the cache entry's `seq` matches, use it; otherwise load the aggregate
   once and replace the entry;
3. apply commands in memory, as today;
4. after commit, store the resulting aggregate with the new `seq`;
5. on rollback or error, leave the previous entry untouched.

Because `BoardWriteService` already serializes all writers for one board
(`backend/src/common/board-write.service.ts:115-179`), there is at most one
in-flight mutation per board per process. The `seq` comparison is the
correctness backstop for anything that writes outside the cache (another API
process, admin restore, import, manual SQL).

**Coherency.** Every board-content writer must either go through the command
path (cache is updated) or call `invalidate(boardId)`. Audit at least:
`BoardsService.deleteBoard`, `importBoards`, admin restore/backup paths, demo
seeding, and any direct `tx.card`/`tx.column` writes. Comments and attachments
do not change the aggregate except `attachmentCount` (which is written by
commands); verify that assumption.

**Multi-process / multi-node.** The `seq` check makes the cache _correct_ even
with multiple API instances: a stale cache entry is detected and reloaded.
It is not _efficient_ -- every write on another node invalidates the local
entry and causes a full reload. That is acceptable for the single-node target;
TASK-175 (multi-node/Redis fan-out) is explicitly out of scope.

**Undo / pre-images.** Undo is a new command with an inverse payload; it does
not read a database pre-image. `touches` and the stored command payload/result
are still written from `before`/`after`; the cache must not skip them. The
`CommandPreimage` model exists in the schema but the current service does not
write it; if that changes, the cache must not bypass it. Add tests that undo
after a cached command restores the exact prior state.

**Plan hashes / approval gate.** A plan is validated against a board snapshot.
The plan hash must include `boardId`, `seq` and the entity versions used for
validation. Apply must re-check `ifMatch`/`planHash` inside the lock before
using the cache. A cache hit must never make a stale plan look valid.

**Idempotency.** Resolve existing `commandId`s first. If the whole request is a
replay, return stored results without applying, publishing or mutating the
cache. Today the code still loads the aggregate before discovering replays
(`commands.service.ts:372`); move the early return before that load.

**Restart / warm-up.** A cold process has an empty cache; the first command per
board pays one aggregate load. That is acceptable. Optionally prewarm the
active board on the first summary read, but only if the snapshot's `seq`
matches; never seed the cache from a stale read.

**Memory budget / LRU.** A 25k aggregate with descriptions is estimated at
50-100 MB of JS objects (17.7 MB JSON plus object overhead). Cache at most
2-4 boards or 256 MB, whichever comes first; evict least-recently-used; expose
hit rate, evictions and cache RSS in `/health/memory` or metrics. A cache that
grows without a budget is a new outage mode.

**Correctness tests.** Cache hit, cache miss, replay, rollback, direct
non-command write, restart, two API processes writing the same board, undo,
plan apply with stale `seq`, and a random command fuzzer comparing
cache-applied state with a fresh `loadBoardAggregate` after every command.

#### (b) Targeted loads

Instead of the full board, load a small `BoardIndex` (columns, labels,
workflow, `commandSeq`) plus only the entities a command can touch:

- `UPDATE_CARD` / field commands: one card + its labels/checklists/links.
- `MOVE_CARD`: source and destination column **id/position lists only**, plus
  the moved card. Do not select descriptions for 5,000 cards.
- `ADD_CARD`: destination column ids/positions; insert at the requested index.
- `DELETE_CARD` / archive: the card and its lists; the column id list to
  compute the new order.
- Board-level commands (`SORT_COLUMN`, workflow, column CRUD): the relevant
  columns, not every card.

This avoids cache coherency entirely but requires a command-scoped reducer or
a `BoardSlice` abstraction. It is a larger refactor than the cache and should
be the fallback for cache misses, not the first delivery. A useful hybrid:
cache the full aggregate for hot boards; on a miss, load the full aggregate
once (simplicity), and only later optimize misses with targeted loads.

#### (c) Batch amortization

The existing batch (`COMMAND_BATCH_MAX = 100`,
`shared/src/api.ts`) is the right transport for agent multi-step edits and
should be used by MCP tools beyond `create_card`. But it amortizes only the
lock, aggregate load and cross-board id check. At 25k, five commands in one
batch still run five reducers and five full-board diffs. Batch is necessary
for round-trip reduction, not sufficient for throughput.

#### (d) SQL constraints

WIP limits, collection limits and workflow transitions are product rules, not
simple `CHECK` constraints. Moving them to SQL would duplicate reducer
semantics and make undo harder. Keep them in the reducer; only use SQL for
uniqueness, foreign keys and id ownership, which already exist. Revisit after
the cache/targeted load has removed the JavaScript cost.

### 4.3 Database options

| Option                                                                                      | Effort | Impact                            | Risk / note                                                         |
| ------------------------------------------------------------------------------------------- | :----: | --------------------------------- | ------------------------------------------------------------------- |
| Partial index `Card(columnId, position, id) WHERE deletedAt IS NULL AND archivedAt IS NULL` |   S    | Smaller hot index, keyset pages   | Migration; build concurrently on a live instance                    |
| Covering summary index with `INCLUDE (title, priority, dueDate, assigneeId, updatedAt)`     |   M    | Possible index-only summary pages | Wider index, more write amplification; measure before committing    |
| Always project columns (no `description`/checklists in list queries)                        |   S    | Less TOAST/IO, less JSON          | Must split detail query; easy                                       |
| Keyset pagination `(position, id)`                                                          |   S    | Stable, bounded pages             | Cursor semantics under concurrent moves; document snapshot behavior |
| `pg_trgm` GIN for title/description search                                                  |   M    | Makes `ILIKE '%q%'` usable        | Index size/write cost; only if server-side search ships             |
| Denormalized `Board.commandSeq` / counters                                                  |  S-M   | Avoids `max(seq)` per command     | Extra write per command; must stay transactionally consistent       |
| Read replicas                                                                               |   L    | Read scale-out                    | Replication lag conflicts with `seq`/SSE; not needed at 25k         |

**Recommendation:** add the partial keyset index and keep descriptions and
checklists out of list queries. Measure whether a covering index helps; do not
add it speculatively. 25k is a payload/CPU problem, not a DB problem.

### 4.4 Client options

| Option                                                          | Effort | Impact                                                                 | Risk / note                                                                 |
| --------------------------------------------------------------- | :----: | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Split store: meta + `CardSummary` map + detail LRU + window map |   L    | Initial board 250-1,000 summaries instead of 25k full cards; heap ~10x | Biggest client change; deep links, DnD, undo, offline adapter need coverage |
| Selector-driven subscriptions (`useCard`, `useColumnWindow`)    |   M    | Stops full-board re-renders on every command                           | React context refactor; keep the existing `useBoard()` for small boards     |
| Server-side filter/sort for large boards                        |   M    | Removes O(25k) main-thread scans                                       | Semantics parity with `filter.ts`; debounce and URL state                   |
| Filter/sort in a Web Worker                                     |   M    | Keeps main thread free if server round-trip is undesirable             | Worker bundle, transfer of summaries, duplicated filter logic               |
| Table pagination / server sort                                  |   M    | Table < 1 s at 25k                                                     | Sort semantics across columns; cursor by sort key + id                      |
| Calendar date-range query + paginated unscheduled list          |   M    | No full-board scan for a month                                         | New endpoint/params; timezone/day-key semantics                             |
| SSE coalescing per animation frame                              |   S    | Avoids 10 agents x 10 events/s causing 100 renders/s                   | Event ordering must be preserved; apply in seq order                        |
| Memory ceilings and detail eviction                             |   S    | Heap < 200 MB; no unbounded detail cache                               | Need metrics and a cap per board                                            |
| Offline/local mode stays on the full aggregate                  |   S    | No change for small/local boards                                       | 25k is server-only; document it                                             |

**Recommendation:** split the store, keep the full `Board` adapter for small
boards and local mode, and move table/calendar/filter work off the main thread
above a threshold. Do not attempt to keep 25k full `Card` objects in memory
"because virtualization handles the DOM"; virtualization does not reduce the
store or the projections.

### 4.5 Transport and API

| Option                                                   | Effort | Impact                                                                 | Risk / note                                                             |
| -------------------------------------------------------- | :----: | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Add gzip/brotli middleware                               |   S    | 70-80% fewer bytes on every JSON response                              | CPU cost; set threshold ~1 KB; `Vary: Accept-Encoding`                  |
| ETag on summary/skeleton/window                          |   S    | 304 on focus/resync when nothing changed                               | Key on `seq` + projection + user role; weak ETag                        |
| `GET /boards/:id/summary`                                |  S-M   | Board meta, column counts, labels, `seq`, limits in one small response | New contract; keep `GET /boards/:id` for compatibility                  |
| `GET /boards/:id/cards?columnId=&cursor=&limit=&detail=` |   M    | Bounded pages, keyset cursor, summary projection                       | Cursor stability under moves; max limit; validation                     |
| `GET /cards/:id`                                         |   S    | One card + column/board/version without the board                      | Deep links and MCP need it; auth by board membership                    |
| `GET /boards/:id` full aggregate below threshold         |   S    | Backward compatibility and local/offline mode                          | Above threshold, require `detail=summary` or new endpoints; clear error |
| Streaming JSON/NDJSON for large responses                |   M    | Bounds memory for export and large pages                               | More complex client parsing; not needed for a 200-card page             |
| MCP `get_board` default summary above threshold          |   S    | Stops 17.7 MB tool responses                                           | Tool output changes; document `detail=full` and cursor                  |
| MCP `get_card_by_id`, `list_cards`, `get_board_summary`  |  S-M   | Removes full-board reads for single-card and ready-work loops          | Tool surface grows by 2-3; keep 74-tool compatibility                   |

**Endpoint sketch**

`GET /api/v1/boards/:id/summary`

```json
{
  "board": {
    "id": "brd_...",
    "title": "Platform",
    "seq": 4210,
    "updatedAt": 1762750000000,
    "columns": [
      { "id": "col_...", "title": "Backlog", "count": 5000, "wipLimit": null }
    ],
    "labels": [{ "id": "lbl_...", "name": "bug", "color": "red" }],
    "limits": { "cards": 25000, "cardsPerColumn": 10000, "columns": 12 }
  }
}
```

`GET /api/v1/boards/:id/cards?columnId=col_...&limit=100&detail=summary`

```json
{
  "items": [
    {
      "id": "card_...",
      "title": "Fix the retry loop",
      "priority": "high",
      "assigneeId": "usr_...",
      "labelIds": ["lbl_..."],
      "dueDate": 1762800000000,
      "updatedAt": 1762750000000,
      "version": 7
    }
  ],
  "nextCursor": "eyJwb3NpdGlvbiI6MTAwLCJpZCI6ImNhcmRfLi4uIn0",
  "hasMore": true,
  "seq": 4210
}
```

`GET /api/v1/cards/:id`

```json
{
  "card": {
    "id": "card_...",
    "title": "...",
    "description": "...",
    "checklists": []
  },
  "boardId": "brd_...",
  "columnId": "col_...",
  "seq": 4210,
  "version": 8
}
```

**Cursor contract:** opaque base64 of `{ position, id }` (or
`{ columnPosition, position, id }` for a board-wide table). Ordering is
`(position, id)`, not offset. A page is a snapshot at `seq`; if the board
changes while the user pages, SSE deltas update the summaries and a page may
show a card that moved. Document that pages are not transactionally isolated;
the client reconciles by `id` and `seq`. Cap `limit` at 200 (default 50-100).

**Backward compatibility:** keep `GET /boards/:id` returning the full
aggregate for boards at or below a threshold (proposal: 2,000 cards or 2 MB
serialized). Above the threshold, return `409 board_too_large` with
`summaryUrl` and `cardsUrl` (or require `?detail=summary`) so old clients fail
loudly instead of downloading 17.7 MB. The new UI and MCP use the new
endpoints. Do not remove the aggregate: small boards, local/offline mode,
export and existing tests depend on it.

### 4.6 Ops and limits

| Option                                                             | Effort | Impact                                                 | Risk / note                                                             |
| ------------------------------------------------------------------ | :----: | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Raise `cardsPerColumn`/board cap only                              |   S    | None; makes the outage reachable                       | **Do not** until read/write gates pass                                  |
| Soft/hard caps: board 25k hard, 20k soft; column 10k hard, 5k soft |  S-M   | Prevents pathological shapes; honest errors            | Shared `LIMITS` is client-visible; server-driven limits need a contract |
| Per-board byte quota (cards + descriptions + checklists)           |   M    | Bounds payload/export/memory independent of card count | Product decision; UI must show the quota                                |
| Asynchronous streaming export (NDJSON/zip) + import job            |  M-L   | 25k export/import without 25 MB/2x memory              | New job/status/download contract; cleanup/expiry                        |
| Keep inline export <= 25 MB, raise cap only with streaming         |   S    | Avoids silent truncation; clear 413                    | The cap remains a product limit for inline path                         |
| Backups via `pg_dump`, documented RPO/RTO                          |   S    | Real disaster recovery at 25k                          | Operational, not code; document in self-hosting                         |
| API memory sizing and alerts (1.5 GB warning, 2 GB limit)          |   S    | Prevents OOM at 10 opens + cache                       | Container limit must match; monitor RSS/heap                            |
| Multi-node/Redis fan-out                                           |   XL   | Out of scope (TASK-175)                                | Do not pretend a single-node cache solves it                            |

**Recommendation:** make 25k a **server-mode** capability with a board-level
hard cap and a per-column hard cap. Keep the inline 25 MB export as a
convenience; add a streaming/async path for larger boards. Do not raise the
cap until the read and write gates have passed on both target shapes.

---

## 5. Recommended architecture

### 5.1 Principles

1. **Separate the read projection from the write aggregate.** Readers should
   never need every card to render a board. Writers should never need every
   card to change one.
2. **The database and command log remain the source of truth.** The cache is an
   optimization, validated by `seq`; it is never authoritative.
3. **Summaries by default, details on demand.** Descriptions, checklists,
   links and activity are detail, not list data.
4. **Keyset, not offset.** Pages must be stable and bounded at 25k.
5. **Compatibility by threshold.** Small boards keep the full aggregate and
   the existing API; large boards use the new read model.
6. **Measure both shapes.** 5 x 5,000 is the stress case; 12 x 2,100 is the
   expected case. Passing one is not passing the other.

### 5.2 Read path

**Contracts**

- `GET /boards/:id/summary` -- board meta, column titles/counts/WIP, labels,
  `seq`, limits, role. Small and cacheable.
- `GET /boards/:id/cards?columnId=&cursor=&limit=&detail=summary|full&q=&sort=`
  -- a bounded page. `detail=summary` is the default for `limit` lists;
  `full` includes descriptions/checklists/links and is capped lower.
- `GET /cards/:id` -- one card + boardId/columnId/version/seq.
- `GET /boards/:id` -- unchanged full aggregate below a threshold; above it,
  require `detail=summary` or respond with a clear `board_too_large` pointing
  at the new endpoints.

**Server behavior**

1. Resolve membership and role as today (`MembershipGuard`).
2. For summary: one board + columns + label query, plus per-column counts
   (`GROUP BY columnId` or denormalized counters), plus `max(seq)`.
3. For cards: keyset query on `(columnId, position, id)` with
   `deletedAt IS NULL AND archivedAt IS NULL`; select only summary columns; do
   not join checklists. For `detail=full`, fetch one card's detail separately.
4. Set `ETag: W/"board:<id>:<seq>:<projection>"` and honor
   `If-None-Match`; `Cache-Control: private, max-age=0, must-revalidate`.
5. Compress JSON above ~1 KB (gzip/brotli), `Vary: Accept-Encoding`.
6. Return `seq` on every page so the client can order SSE deltas and detect a
   resync.

**Client behavior**

1. On open: fetch summary + one page (50) for each visible column. Board view
   mounts 5-12 columns x ~50 cards, not 25k.
2. On scroll: fetch the next page for that column; keep an ordered id array and
   a summary map. DnD uses the loaded window; moving beyond the loaded window
   fetches the target page first.
3. On card open: fetch `GET /cards/:id`; cache the detail with an LRU keyed by
   card id + version. Close/evict after N cards.
4. On SSE: apply the action to the summary map and to loaded windows; if the
   action changes a card whose detail is open, patch it or mark it stale. If
   the event seq is ahead of the page seq and the gap is not replayable, fetch
   the summary + current window, not the full board.
5. On filter/sort: below 2,000 loaded cards, use the existing client filter;
   above, debounce and call the server endpoint (or a worker). The URL keeps
   the same `f.*` params.

**Fallback:** if the board is small (<= 2,000 cards) or the client is in
local/offline mode, keep the existing full `Board` path. This preserves tests,
undo, export and deep links while the new path matures.

### 5.3 Write path

**P0.1 quick wins (days, independent of the cache)**

1. Replace the two full-board `stableStringify` calls with a cheap change
   signal. The reducer already returns the same state on a no-op
   (`committed` in `shared/src/store/board-reducer.ts`), so `after !== board`
   is a valid first check, provided tests assert that every no-op action
   returns the same object. If a handler allocates unnecessarily, fix the
   handler or use a per-action `changed` flag; never serialize the whole board.
2. Return early when every command in a batch is an idempotent replay, before
   `loadBoardAggregate`.
3. Add compression and ETag (section 5.2).
4. Cap SSE action frames: send full `description` only up to a threshold
   (e.g. 2 KB); above it send `descriptionLength` + `detailStale` and let the
   open card fetch detail. Keep the stored command payload complete.
5. Make MCP `create_card`/multi-field edits use the existing batch everywhere,
   and stop re-reading the full board when a prefetched snapshot or card
   context is available.

**P0.3 board cache**

Add `BoardAggregateCache` in the API process:

```
interface CachedBoard {
  board: BoardAggregate;
  seq: number;
  lastUsed: number;
  bytesEstimate: number;
}
```

- `get(boardId, seq)`: return the entry only if `entry.seq === seq`.
- `set(boardId, board, seq)`: replace after a successful commit.
- `invalidate(boardId)`: drop after any non-command write or admin action.
- LRU: max 2-4 boards or 256 MB; evict least-recently-used; expose metrics.

Inside `applyBatch`, after the replay check and before `loadBoardAggregate`:

1. read the current board `seq` once for the batch (or use a denormalized
   `Board.commandSeq`);
2. use the cache if it matches; otherwise load the aggregate and seed the
   cache;
3. apply the commands as today;
4. after commit, `set` the final `running` board with the last `seq`;
5. on error/rollback, leave the old entry alone.

This preserves the reducer, command log, `touches`, undo, `ifMatch` and SSE
semantics. The only behavior change is where the initial aggregate came from.
Add a write-through invariant test: after every command, the cached aggregate
must deep-equal a fresh `loadBoardAggregate` (excluding timestamps that the
cache does not own).

**P0.3 targeted pre-checks**

Even with a cache, the per-command pre-checks are worth batching:

- `currentSeq` once per batch, not once per command; the batch knows its own
  increments.
- `assertIdsBelongToBoard` only for the entity types the batch references, and
  in one query per type (already grouped by type; skip unused types).
- Prefetch assignee membership and claim rows for the batch in one query each.
- Keep `assertWorkflowReferences` on the cached columns.
- Skip `assertNoWipConflict` work when the action does not change a column.

**P1 position strategy**

P0: add an append fast path. If `ADD_CARD` inserts at the end of the column,
write only the new card row; do not rewrite the column. For `MOVE_CARD`, if the
destination index is the end and the source is the end, the same applies; in
general, a move still needs a renumber of the source/destination suffix.

P1: switch to gap positions. Store `position` with gaps (e.g. 1024), compute a
midpoint for inserts, and rebalance a column only when the gap is exhausted
(or on `SORT_COLUMN`). Keep `(position, id)` ordering and migrate existing
rows once. This turns most adds/moves into O(1) row writes plus an occasional
O(column) rebalance, and makes 5,000-card columns cheap.

**Correctness checklist for the write path**

| Concern            | Requirement                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Cache coherency    | `seq` check on every command; invalidate on non-command writers; test a second API process writing the board.          |
| Undo / pre-images  | `touches` and payload/result still written; pre-images if wired; undo of a cached command deep-equals the prior state. |
| Plan hash/approval | Plan bound to `boardId + seq + entity versions`; apply re-checks under the lock.                                       |
| Idempotency        | All-replay batch returns stored results, publishes nothing, does not touch the cache.                                  |
| Restart / warm-up  | Cold cache loads once; no stale seed from a read.                                                                      |
| Memory / LRU       | Hard byte budget; eviction metrics; cache cannot grow with the number of boards ever touched.                          |
| Multi-process      | Correct via `seq` mismatch; efficient multi-node is TASK-175, not this work.                                           |
| Observability      | Hit rate, miss reason, load time, cache bytes, evictions per board.                                                    |

### 5.4 Client architecture

- **Store shape:** `BoardMeta` (columns, labels, limits, seq),
  `summaries: Map<cardId, CardSummary>`, `windows: Map<columnId, { ids, nextCursor, hasMore }>`,
  `details: LRU<cardId, CardDetail>`. Keep a `Board` adapter for small/local
  mode so existing components and tests do not all change at once.
- **Selectors:** `useBoardMeta()`, `useCardSummary(id)`,
  `useColumnWindow(columnId)`, `useCardDetail(id)`. A command that changes one
  card should not re-render every column.
- **Board view:** initial 50 cards per column, fetch on scroll. The DnD
  `SortableContext` can keep the loaded window's ids; a drop outside the window
  fetches the target page before committing. Preserve the exact order
  semantics.
- **Table:** for large boards, fetch a server-sorted page (cursor by sort key +
  id) or sort the loaded summaries in a worker. Do not `flatMap` 25k rows on
  the main thread on every board change.
- **Calendar:** fetch by visible date range (`dueFrom`/`dueTo`) and paginate
  the unscheduled panel. Do not scan all cards to build the month.
- **Filter:** client-side under 2,000 loaded cards for instant feedback;
  server-side or worker above that. Debounce 150-250 ms, keep the URL contract,
  and reuse the same match semantics (title, description, labels, checklist
  items; comments only for global search).
- **SSE:** apply in `seq` order; coalesce per animation frame; update summary
  and loaded windows; if a detail is open and the event touches it, patch or
  mark stale; on `resync`, fetch summary + current window.
- **Memory ceilings:** summaries ~10-20 MB at 25k, details max ~50 cards,
  heap target < 200 MB. Do not persist a 25k board to `localStorage`.
- **Offline/local:** keep the full aggregate and the existing caps. 25k is a
  server-mode feature.

### 5.5 Limits and operations

- **Caps:** board hard 25,000 active cards; soft warning at 20,000. Column hard
  10,000; soft warning at 5,000. Make them server-driven/configurable, not
  just `LIMITS.cardsPerColumn` in the shared bundle. Return a machine-readable
  `409 limit_exceeded` with `scope`, `limit`, `current`.
- **Quotas:** consider a per-board byte quota (cards + descriptions +
  checklists) so a board of 25k 64 KB descriptions cannot exhaust memory or
  export. This is a product decision; measure first.
- **Export/import:** keep inline export <= 25 MB with a clear 413; add an
  async streaming export (NDJSON or zip) and a chunked/streaming import for
  larger boards. Do not raise the cap without streaming: current code holds the
  aggregate and the serialized string at once.
- **Backups:** document `pg_dump` as the full-instance backup; API export is a
  transfer/share format.
- **Memory sizing:** API container 2 GB for 10 opens + one cached 25k board;
  warn at 1.5 GB. Test with the cache warm and cold.
- **Rollout:** feature-flag the read model per board; keep the full aggregate
  fallback; enable 25k for internal boards first; then raise the cap.
- **Multi-node:** out of scope. The cache's `seq` check keeps correctness, but
  cross-node invalidation and fan-out are TASK-175 work.

### 5.6 Phased plan

| Phase    | Work                                                                                                                                                                         | Effort (rough)  | Depends on | Expected gain                                                                                            | Exit gate                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **P0.1** | gzip/brotli + ETag; cheap no-op detection instead of double `stableStringify`; all-replay early return; SSE frame cap; MCP batch/prefetch                                    | S (3-5 days)    | -          | Wire bytes -70-80%; command CPU -20-40%; no behavior change                                              | 10k p95 not worse; compression/ETag tests; reducer no-op tests |
| **P0.2** | Read model v1: `/summary`, `/cards`, `/cards/:id`; summary projection; cursor; client summary store + windows; MCP reads use new endpoints; full aggregate fallback below 2k | L (4-6 weeks)   | P0.1       | Initial view 17.7 MB/~640 ms -> < 2 MB/< 300 ms; 10 opens 3.3 GB -> < 1.5 GB; board first render < 1.5 s | G1 read gates; deep links/DnD/undo tests                       |
| **P0.3** | Write path v1: per-board aggregate cache + `seq` validation + invalidation; batched pre-checks; append fast path; cache metrics/LRU                                          | L (4-6 weeks)   | P0.1       | Command 0.7-0.8 s -> p50 < 150 ms; 5 writers 1.4 -> >= 10 cmd/s (with batches)                           | G2 write gates; cache coherency/undo/plan/idempotency tests    |
| **P0.4** | Limits/export/ops: 25k board cap, column caps, byte quota, async streaming export/import, memory alerts, feature flag                                                        | M (1-2 weeks)   | P0.2, P0.3 | Safe enablement; no 413 surprise; bounded memory/export                                                  | G5 ops gates; 25k export/import or explicit async path         |
| **P0.5** | Enable 25k: run full matrix on both shapes, document, roll out to internal boards, then raise cap                                                                            | S (1 week)      | P0.4       | Production capability                                                                                    | All gates pass on 25k; no P0 regressions                       |
| **P1.1** | Server-side filter/search + table/calendar pagination/sort; worker fallback; filter parity tests                                                                             | M/L (3-4 weeks) | P0.2       | Table < 1 s; filter < 100 ms; no main-thread block > 50 ms                                               | G3 full UI gates                                               |
| **P1.2** | Gap/fractional positions; one-insert command row; prefetch versions; log/JSON micro-opts                                                                                     | M (2-3 weeks)   | P0.3       | O(1) adds/moves; command p95 headroom; less lock time                                                    | G2 with 5k columns; ordering/undo/import tests                 |
| **P1.3** | Cache prewarm, summary response cache by `seq`, observability (histograms, cache hit, payload bytes, RUM long tasks)                                                         | S/M (1-2 weeks) | P0.2, P0.3 | Stable p95; faster first command after restart; operational visibility                                   | Hit rate > 80% on active boards; no memory growth              |
| **P1.4** | MCP bulk/plan/apply and `my_work` integration; board-wide comments/blockers; align with TASK-173.2/173.5                                                                     | M (3-4 weeks)   | P0.2, P0.3 | Agent loops drop from 5+ full-board calls to 1-2 bounded calls                                           | MCP path request count and latency gates                       |
| **P2**   | Multi-node/Redis fan-out, sharding, global command ceiling, read replicas, FTS engine                                                                                        | XL              | P1         | Beyond one node (TASK-175); not needed for 25k single board                                              | Separate TASK-175 plan                                         |

**What ships first to unlock 25k:** P0.1 (days) + P0.2 and P0.3 in parallel
(6-8 calendar weeks with two streams). P0.2 without P0.3 gives readable 25k
boards but writes still ~0.7 s; P0.3 without P0.2 gives fast commands but every
reader still pulls 17.7 MB and ten opens still ~3.3 GB. Neither alone is
"25k support".

**What can wait:** server-side search/filter (P1.1) if the initial view and
command path are fixed; gap positions (P1.2) if the append fast path covers the
common case; multi-node (P2) entirely.

### 5.7 Do not do

- **Do not just raise the cap.** `LIMITS.cardsPerColumn = 25000` (or a board
  cap alone) makes the current failure modes reachable in production.
- **Do not paginate only the UI.** If `GET /boards/:id` still returns the full
  aggregate and every command still calls `loadBoardAggregate`, the server and
  memory costs are unchanged.
- **Do not keep a per-command `stableStringify` of the full board.** It is two
  full serializations per command and grows linearly with cards.
- **Do not compress and call it done.** Compression helps bytes, not server
  CPU, client memory or command throughput.
- **Do not add a cache without `seq` validation and invalidation.** A stale
  aggregate silently corrupts commands and undo.
- **Do not make the board view fetch `GET /cards/:id` per visible card in a
  loop.** Fetch pages; details are for opened cards.
- **Do not use offset pagination** (`?page=250`) on 25k; positions shift under
  moves and the query degrades.
- **Do not return descriptions in list summaries.** They are the largest field
  and the least needed for a board or table row.
- **Do not build multi-node/Redis fan-out now.** It is TASK-175 and it does
  not fix a single-board 25k read/write path.
- **Do not force 25k into local/offline mode.** `localStorage` cannot hold it.

---

## 6. Validation plan

### 6.1 Harness and provenance

The existing harness is under
`~/.janosik-dev/load/capacity-2026-11-10/scripts/`:

| Script                                                | What it does                                                            | Extension for 25k                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `perf-seed.mjs`                                       | Seeds 5-column boards at 100-2,000 cards/column via `COPY`.             | Add `TIERS=3000,5000`, `COLUMNS` env (5 vs 12), and a `SHAPE` label.            |
| `perf-bench.mjs`                                      | Reads, 10 concurrent reads, UPDATE/MOVE/ADD, 5 concurrent writers, RSS. | Add 1/5/10 readers and writers, batch sizes 1/5/100, read-model endpoints, p99. |
| `perf-cold-memory.mjs`                                | Restarts the API and measures cold RSS + 10 concurrent opens + writes.  | Run cold and warm cache; 25k; report cache bytes separately.                    |
| `perf-concurrency-memory.mjs`                         | 10 simultaneous opens at 1k-5k.                                         | Add 10k/15k/25k; both shapes; 10/25 readers.                                    |
| `perf-ui.mjs`                                         | Board first render, DOM, heap, long tasks, card dialog.                 | Add 15k/25k; filter and table/calendar switches; record SSR/parse time.         |
| `perf-table.mjs`                                      | Table first render and scroll to last row.                              | Add 15k/25k; sort by title/priority; measure sort time separately.              |
| `perf-live-10k.mjs`                                   | 20 live UPDATE commands with the board open.                            | 25k; 10 writers; large descriptions; SSE frame bytes.                           |
| `perf-sse-ui-probe.mjs`                               | UI live-update probe.                                                   | Add long-description frames and resync.                                         |
| `perf-setup.sh`, `perf-start-api.sh`, `patch-cap.cjs` | Disposable backend, cap lift.                                           | Keep disposable; patch to 30k/column and 12 columns only there.                 |

**Do not run these now.** The machine is busy with other streams. The plan
below is for the implementation phase.

### 6.2 Benchmark matrix

Every cell is a separate run with a fresh board or a documented reset. Record
the exact fixture (`cards`, `columns`, `cards/column`, description length,
labels/checklists/links, archived %) in the result JSON.

| Dimension     | Values                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Board size    | 10,000 (control), 15,000, 25,000                                                                                                 |
| Shape         | 5 x 2,000/3,000/5,000; 12 x ~833/1,250/~2,100                                                                                    |
| Content       | Baseline (500-char descriptions, no relations); realistic (10% 64 KB descriptions, labels/checklists/links on 20%, 10% archived) |
| Readers       | 1, 5, 10 concurrent; sequential and concurrent; cold/warm cache                                                                  |
| Writers       | 1, 5, 10 concurrent; batch 1, 5, 100; UPDATE/MOVE/ADD mix                                                                        |
| UI            | Board, table, calendar, filter; 1600x900 and 390x844 if feasible                                                                 |
| Memory        | Cold API, 10 concurrent opens, cache warm, 20 sequential reads                                                                   |
| Export/import | 25k inline; 25k streaming/async; round-trip deep equality                                                                        |
| Correctness   | Random command fuzz vs fresh aggregate; replay; undo; resync; cache invalidation                                                 |

### 6.3 Metrics to capture

**Server**

- p50/p95/p99 latency, RPS, errors (4xx/5xx), timeouts, `Retry-After`.
- Response bytes and `content-encoding`; compressed and uncompressed size.
- CPU ms per request/command; RSS, heapUsed, external, arrayBuffers.
- Cache hit/miss/eviction, cache bytes, load time on miss.
- Lock wait, transaction time, query count, DB time per request.
- Per-command phase timings (reuse the PERF-ONE-BOARD probes: queue, lock,
  pre-checks, aggregate load, reducer/diff, writes, commit).
- SSE subscribers, frame bytes, resync count.

**Database**

- `EXPLAIN (ANALYZE, BUFFERS)` for a 100-card page, a column count, a board
  count, and search.
- Rows read, shared hits/reads, index-only vs heap fetches.
- Table/index sizes for 25k (Card, CardLabel, Checklist, ChecklistItem,
  CardLink, Command).

**UI**

- First render, time to first card, time to interactive.
- DOM nodes, mounted cards/rows, JS heap before/after idle.
- Long tasks: count, p50, max, sum; specifically any > 200 ms.
- Scroll frame time; table sort time; filter keystroke latency; calendar range
  switch.
- SSE apply time and re-render count per command.

**Correctness**

- Cached aggregate vs fresh `loadBoardAggregate` after every command (deep
  equality, ignoring fields the cache does not own).
- Reducer equality: client state after SSE replay == server aggregate.
- Idempotent replay: same `commandId` returns same result, no extra seq/event.
- Undo/redo after cached commands; plan apply with stale `seq`/`planHash`.
- Export/import round-trip deep equality (including order, labels, checklists,
  links, archived cards).
- Resync: summary + window after a gap equals a fresh read.

### 6.4 Pass/fail gates

| Gate               | Scenario                                                             | Pass                                                                                                                         |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **G1 read**        | 25k initial board, both shapes, 10 concurrent opens                  | p95 < 300 ms; < 2 MB wire; 10 opens < 1.5 GB RSS; no 5xx                                                                     |
| **G2 write**       | 25k, 5 x 5,000 and 12 x 2,100, UPDATE/MOVE/ADD, 1/5/10 writers       | single p50 < 150 ms, p95 < 500 ms; 10 writers >= 10 cmd/s, p95 < 1 s; no 5xx; conflict rate < 1% on non-conflicting workload |
| **G3 UI**          | 25k board/table/calendar/filter                                      | board < 1.5 s; table < 1 s; filter < 100 ms; no long task > 200 ms; heap < 200 MB; DOM < 3,000                               |
| **G4 correctness** | fuzz, replay, undo, plan, export/import, cache invalidation, restart | zero divergence; all invariants pass                                                                                         |
| **G5 ops**         | export/import 25k, backup/restore, memory limits                     | inline 413 is clear; streaming path completes; backup/restore documented and tested; no OOM at 2 GB                          |
| **G6 regression**  | 10k baseline, same fixture and host                                  | no p95 regression > 10%; bytes not worse; no new long tasks                                                                  |

Run G1-G4 on both shapes. A pass on 12 x 2,100 does not excuse a failure on
5 x 5,000; the stress shape is the one that breaks position writes and command
latency.

### 6.5 How to extend the harness (when the machine is free)

1. **Seed:** add `COLUMNS=5|12` and `TIERS=2000,3000,5000`; compute total as
   `columns x perColumn`. For 12 x 2,100, use 2,100/column (25,200). Keep the
   `COPY` path; 25k command round-trips would measure the seeder, not the API.
2. **Cap:** patch only the disposable backend to `cardsPerColumn = 30000` and
   `columnsPerBoard = 12` via `patch-cap.cjs`; never change the product build.
3. **HTTP:** add a `--mode=aggregate|readmodel` switch; for readmodel call
   `/summary`, `/cards?columnId=...&limit=100`, `/cards/:id`, and the table
   cursor. Keep the aggregate run as the control.
4. **Writers:** parameterize `clients` and `commands`; add batch size; capture
   p99 and server CPU per command. Use distinct cards per writer to avoid
   artificial `ifMatch` conflicts; run a second variant with `ifMatch` to
   measure retry amplification.
5. **UI:** add 15k/25k to `perf-ui.mjs` and `perf-table.mjs`; add a filter
   scenario (type a query, measure keystroke-to-result) and a calendar range
   switch. Capture `PerformanceObserver` long tasks.
6. **Memory:** run cold, warm-cache, 10 opens, and 20 sequential reads; report
   API RSS and `heapUsed` separately (V8 may not return RSS).
7. **Correctness:** add a fuzz script that applies N random commands through
   the API, then compares the client/aggregate with a fresh `GET`; include
   cache invalidation by writing through a second API process or direct SQL.

### 6.6 Rollout and rollback

- Feature flag `READ_MODEL_V1` per board; `WRITE_CACHE` per process/board.
- New client uses the read model only for boards above the threshold; small
  boards keep the aggregate.
- If a gate fails, disable the flag and return to the full aggregate; the
  command log and schema are unchanged, so rollback is a config/feature-flag
  change, not a data migration.
- Cache can be disabled independently; a cold miss falls back to the current
  load path.
- Keep the old aggregate endpoint and tests until the new path has run on
  internal 25k boards for at least one release.

---

## 7. Risks, open questions and non-goals

### 7.1 Risks

| Risk                                                    | Likelihood | Impact | Mitigation                                                                                           |
| ------------------------------------------------------- | :--------: | :----: | ---------------------------------------------------------------------------------------------------- |
| Read-model migration breaks deep links/DnD/undo         |   Medium   |  High  | Feature flag; full-aggregate fallback; parity tests; phased client rollout.                          |
| Cache serves stale board after a non-command write      |   Medium   |  High  | `seq` check on every command; `invalidate()` from every writer; fuzz/direct-SQL tests.               |
| Cache memory blows the API                              |   Medium   |  High  | 256 MB LRU, max 2-4 boards, metrics, alert at 1.5 GB; disable cache if over budget.                  |
| Position change breaks order/import/undo                |   Medium   |  High  | Start with append fast path; gap positions behind tests; migrate and verify `cardIds` deep equality. |
| Server-side filter semantics diverge from client filter |   Medium   | Medium | Reuse shared match rules or test a parity matrix; keep client filter under 2k.                       |
| Cursor pages are unstable under concurrent moves        |    High    | Medium | `(position, id)` keyset, `seq` on page, client reconcile by id; document non-isolation.              |
| 64 KB descriptions blow SSE/export/memory               |   Medium   |  High  | Frame cap + detail fetch; per-board byte quota; streaming export; measure realistic content.         |
| Postgres `ILIKE '%q%'` search too slow at 25k           |   Medium   | Medium | `pg_trgm` GIN; debounce; cap query; snippet projection; do not search on every keystroke.            |
| Benchmark noise misleads decisions                      |    High    | Medium | Same host/mode, generators separate if possible, multiple runs, report p50/p95/p99 and CPU.          |
| Scope creep into multi-node/Redis                       |   Medium   |  High  | Explicit non-goal; TASK-175; single-node cache correctness is enough for 25k.                        |

### 7.2 Open questions

1. **Product shape:** is 25k a real single board, or a tenant/workspace total?
   The answer changes whether the client must support 25k in one store.
2. **Content distribution:** what fraction of cards have 64 KB descriptions,
   checklists, links and attachments? The 500-char fixture is optimistic for
   payload and export; 64 KB descriptions change the quota/streaming design.
3. **Columns:** are 12 columns common, or are most boards 5? We optimize for
   5 x 5,000 and validate 12 x 2,100, but product guidance should say which is
   supported/promoted.
4. **Agent read patterns:** do agents need `get_board` on the whole board, or
   can they work from `my_work`/search/card detail? This decides how much of
   MCP must change in P0.
5. **Export:** is API export a product feature at 25k, or is `pg_dump`
   acceptable for backups? If product, streaming/async is required before the
   cap.
6. **Search:** substring/ILIKE semantics or full-text ranking? The current
   filter and MCP search are substring; changing that is a product decision.
7. **Offline:** confirm 25k is server-only and local mode stays at the current
   cap.
8. **Retention/undo:** how long is the command log kept at 25k, and does undo
   need to span the full board? Retention affects storage and resync windows.
9. **Multi-node timeline:** if TASK-175 is near, should the cache be designed
   with Redis invalidation from day one, or kept single-node and replaced?
10. **Memory budget:** what is the deployment target (2 GB VPS, 4 GB, cloud)?
    The SLO of < 1.5 GB for 10 opens assumes a 2 GB container plus headroom.

### 7.3 Non-goals

- Multi-node, Redis fan-out, sharding, global command ceiling (TASK-175).
- 25k in local/offline/`localStorage`.
- Changing reducer semantics or the command-log wire format.
- A separate search engine or a full-text ranking model.
- Comments/attachments/activity in the board aggregate.
- Per-card SSE subscriptions or CRDT collaboration.
- Rewriting the API to GraphQL or replacing Prisma.
- Raising the board cap before the read and write gates pass.

---

## 8. Decision

**Recommended first two implementation tasks:**

1. **Read model v1** -- `GET /boards/:id/summary`,
   `GET /boards/:id/cards` with keyset cursor + summary projection,
   `GET /cards/:id`; compression and ETag; client summary store + per-column
   windows + detail LRU; MCP reads use the new endpoints; full aggregate
   fallback below the threshold.
   **Why first:** it fixes payload, read latency, server RSS and client heap in
   one coherent change; it is independently rollbackable; and it gives an
   immediate 25k read path even before the write path is ready.
2. **Write path v1** -- per-board aggregate cache validated by `seq`, with
   invalidation and LRU; replace the double full-board `stableStringify` with a
   cheap no-op signal; batch pre-checks; append fast path for `ADD_CARD`.
   **Why second (and parallel):** the command path is the hard blocker for ten
   agents (3.4 -> 1.4 commands/s extrapolated), and the cache is the smallest
   change that removes the dominant `loadBoardAggregate` cost without rewriting
   the reducer. The `seq` check preserves correctness across restarts and
   multiple processes; multi-node efficiency is TASK-175.

Ship P0.1 (compression, ETag, cheap diff, replay early-return) in the same
window -- it is days of work and de-risks both tasks. Do **not** raise the
product cap until G1-G5 pass on both 5 x 5,000 and 12 x 2,100. The realistic
first milestone is "25k is readable and writable on an internal board"; the
public cap follows after the benchmark gates, not before.

---

## Appendix A: code map

| Concern                          | File / lines                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Board aggregate load             | `backend/src/boards/board-aggregate.ts:55-103`                                |
| Per-column filtering in JS       | `backend/src/boards/board-aggregate.ts:165-172`                               |
| Full aggregate read + seq        | `backend/src/boards/boards.service.ts:249-276`                                |
| Board controller / `X-Board-Seq` | `backend/src/boards/boards.controller.ts:92-103`                              |
| Command batch + aggregate load   | `backend/src/commands/commands.service.ts:264-452`, load at `:372`            |
| Reducer + full-board diff        | `backend/src/commands/commands.service.ts:578-584`, `:1365-1372`              |
| Command writes / touches         | `backend/src/commands/commands.service.ts:599-643`                            |
| Position rewrites                | `backend/src/commands/command-writers.ts:185-205`, `:782`, `:1431-1455`       |
| Per-board serialization          | `backend/src/common/board-write.service.ts:115-179`                           |
| Limits / import-export caps      | `shared/src/types/kanban.ts:306-404`                                          |
| Export serializer                | `shared/src/utils/board-serialization.ts:39-50`                               |
| Export/import service            | `backend/src/boards/boards.service.ts:708-815`                                |
| Search (ILIKE)                   | `backend/src/boards/boards.service.ts:192-225`                                |
| Client store/hydration           | `ui/src/store/BoardContext.tsx:936-1064`                                      |
| Realtime/SSE bridge              | `ui/src/store/realtime.ts`                                                    |
| Virtualized card window          | `ui/src/hooks/use-card-window.ts`                                             |
| Column rendering                 | `ui/src/components/board/ColumnView.tsx:199-205`                              |
| Table projections                | `ui/src/components/board/TableView.tsx:306-349`                               |
| Calendar projections             | `ui/src/components/board/CalendarView.tsx:347-390`                            |
| Board filter                     | `ui/src/components/BoardSection.tsx:97-108`, `ui/src/utils/filter.ts:295-412` |
| MCP get board                    | `mcp/src/tools/boards.ts:77-141`                                              |
| MCP get card                     | `mcp/src/tools/cards.ts:257-285`                                              |
| MCP read-before-write            | `mcp/src/client.ts:342-390`                                                   |
| Command docs                     | `site/src/content/docs/docs/api/commands.md`                                  |

## Appendix B: measurement sources

- `~/.janosik-dev/load/capacity-2026-11-10/REPORT.md`
- `results/perf-http-results.json`
- `results/perf-cold-memory.json`
- `results/perf-concurrency-memory.json`
- `results/perf-fixtures.json`
- `results/perf-ui-results.json`
- `results/perf-table-results.json`
- `results/perf-live-10k.json`
- `results/perf-bench.log`, `results/perf-ui-all.log`

Related documents: `docs/PERF-BASELINE.md`, `docs/PERF-ONE-BOARD.md`,
`ROADMAP.md` sections 7.23-7.25 (TASK-166, TASK-173.2/173.5, TASK-175), and
`audits/launch-gaps-agent-experience.md` (P1-7 read model, P2-16 limits).
