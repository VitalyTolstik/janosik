# Card-capacity load test — 2026-11-10

This note records the load test behind raising `LIMITS.cardsPerColumn` from
200 to **1000 active cards per column**. The cap was lifted at runtime in a
disposable backend; the repository was not changed during the measurement.

## Stand

- WSL2 Ubuntu 24.04.5, AMD Ryzen 7 7700 (8C/16T), 23 GiB RAM.
- PostgreSQL 16.15-alpine.
- API: one Node 26 process.
- UI: Vite dev server.
- Browser: Chrome for Testing 156, headless, 1600×900.
- Load generators ran on the same host, so absolute numbers are
  conservative.

## Data

- Five columns: Backlog, In Progress, Blocker, Review, Done.
- 5,000 cards (1,000 per column) or 10,000 cards (2,000 per column).
- Every card had a title and a ~500-character description.
- No labels, checklists or links.

## API

| Cards | Payload | GET p50/p95 | UPDATE p50/p95 | MOVE p50/p95 | ADD p50/p95 | 5 concurrent writers |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5,000 | 3.37 MB | 128 / 131 ms | 147 / 161 ms | 140 / 156 ms | 181 / 183 ms | 7.2 cmd/s, p95 6.5 s |
| 10,000 | 6.75 MB | 263 / 275 ms | 299 / 313 ms | 288 / 364 ms | 340 / 343 ms | 3.4 cmd/s, p95 13.9 s |

## Memory

| Scenario | RSS |
| --- | ---: |
| Cold API | 173 MB |
| 10 concurrent opens of the 5,000-card board | 809 MB |
| 10 concurrent opens of the 10,000-card board | 1,479 MB |

## UI

Board view:

| Cards | First render | Cards in DOM | JS heap | Scroll long task |
| ---: | ---: | ---: | ---: | ---: |
| 5,000 | 627 ms | 50 | 76 MB | 0 ms |
| 10,000 | 906 ms | 50 | 95 MB | — |

Table view:

| Cards | First render | Rows in DOM | JS heap |
| ---: | ---: | ---: | ---: |
| 5,000 | 489 ms | 29 | 109 MB |
| 10,000 | 812 ms | 29 | 124 MB |

Live updates: 20 `UPDATE_CARD` commands on the 10,000-card board took
~311 ms each, and the UI applied every SSE delta with 0 long tasks.

## Conclusion

- **1000 cards per column is the comfortable cap for a five-column board.**
  The 5,000-card board renders in ~0.63 s, keeps 50 cards in the DOM and
  76 MB of JS heap, and the API reads it in ~128 ms.
- A 10,000-card board on five columns needs **2000 cards per column** and is
  heavier on writes and memory: update latency roughly doubles, writer
  throughput halves, and both API RSS and JS heap grow substantially.
- Therefore the cap is **1000**, not 2000. Archived cards do not count
  toward it.
- Operational caveat: at exactly 1000 cards in a column, moves into that
  column are refused with `409 wip` (the same hard-cap check as the
  reducer). Keep headroom in workflow columns or archive the Done column
  before bulk-loading it.
