# Ultra-light Janosik for hundreds of concurrent agents

**Status:** research input for [TASK-200](TASK-200-agent-scale-performance.md) (2026-11-22). This document records *what was found*, not an approved commitment; the task spec owns scope and ordering.

**Question:** how do we make Janosik comfortably serve hundreds of concurrent AI agents, and where — if anywhere — did we get the architecture wrong?

**Scope and honesty note.** This is a read-only investigation of the checkout at `/home/vital/dev/janosik-final`. The tree reports HEAD `30d1fb13` (2026-11-21); the investigation was reviewed against `main` `33b83b18` afterwards and the architectural conclusions did not change. All file:line references are against the investigated tree and may drift by a few lines. No product code, database, Docker stack, browser, or full test suite was run. Numbers are either quoted from the existing benchmark documents, measured with light shell commands, or derived from measured unit costs. Estimates are labelled **estimate**; nothing here pretends to be a 500-agent benchmark, because that benchmark does not exist yet (see §7 and §11).

---

## Executive summary

1. **The database is not the bottleneck, and neither is NestJS, Express, React, or the absence of worker threads.** Janosik's measured raw HTTP ceiling is ~5,600 req/s; a board aggregate read is ~430 req/s and a one-board command stream is ~42–48 commands/s. The gap is the application's per-request work, not the framework.
2. **The dominant agent-path cost is full-board read-modify-write.** `loadBoardAggregate` loads every card, description, checklist and link; a PAT command may call it **three times** before it commits (`backend/src/commands/commands.service.ts:404-410`, `:568-573`, `:694`). At 200 cards one command takes ~24 ms; at 5,000 cards a single board read is 3.37 MB and ~128 ms.
3. **The single worst agent-specific design choice is client-side polling for work.** `janosik_wait_for_work` re-reads the **entire board** (or every board the caller can access) every 5 s by default (`mcp/src/tools/cards.ts:1205-1265`, `:1313-1324`). 500 idle agents = ~100 full-board reads/s. That is the first thing that melts, before any command is applied.
4. **The second worst is board-wide optimistic concurrency in MCP.** `commandOnFreshBoard` reads the whole board and sends `ifMatch = board seq` (`mcp/src/client.ts:434-465`). Two agents editing unrelated cards conflict. Under a busy board this becomes a retry storm, and each retry re-downloads the board. The UI already uses per-entity `ifMatchVersions`; MCP mostly does not.
5. **The board rate-limit bucket is now a safety ceiling, not the per-agent budget.** TASK-200.3 raised `BOARD_RATE_LIMIT` to `max(12000, THROTTLE_LIMIT × 2)` weighted units/min with continuous refill, added a per-token share (`AGENT_TOKEN_RATE_LIMIT`) and a per-session weighted budget, and made MCP retry `429`/queued `503` with `Retry-After` and bounded jitter. The remaining swarm cost is idle polling and full-board reads (200.2/200.7/200.9), not the old 600/min ceiling.
6. **Per-connection and per-request bookkeeping is heavier than it looks.** A PAT request does a DB lookup for the token (`backend/src/auth/api-token.service.ts:100-129`), then two membership queries (`backend/src/common/membership.guard.ts:120-130`), then per-command session lookups. Every SSE stream re-validates flags, membership, token pause and log head on a 25 s tick (`backend/src/commands/events.controller.ts:219-249`, `:268-304`); at the 5,000-connection cap that is roughly **800–1,200 DB queries/s of pure keep-alive**.
7. **Memory is dominated by copies, not by the database.** Ten concurrent opens of a 5,000-card board took the API from 173 MB to 809 MB; at 10,000 cards, 1,479 MB (`docs/PERF-CAPACITY.md:31-37`). That is ~64–131 MB of transient memory **per concurrent full-board open**. 500 simultaneous reads of a 1,000-card board are ~6.5 GB by the same linear fit. A shared, pre-serialized read is the fix, not a bigger heap.
8. **MCP stdio is a client-side scaling trap, not a server-side one.** Each agent spawns one Node process at 108–113 MB measured (`docs/PERF-BASELINE.md:259-260`); 500 agents co-located = 25–55 GB. The MCP process has **no DB pool** (deps are only the MCP SDK and Zod, `mcp/package.json:49-52`) — it is an HTTP proxy. A shared Streamable-HTTP MCP gateway removes the process explosion without touching the control plane.
9. **The architecture is not fundamentally wrong for hundreds of *slow* agents.** 500 agents acting once per 20–30 s need 17–25 commands/s, inside the measured 42–48/s one-board ceiling and far inside the ~290/s multi-board ceiling. What breaks is idle polling, board-wide CAS retries, redundant aggregate loads, under-sized board budgets, and unbounded concurrent reads — all fixable without Go, Fastify, React, or worker threads.
10. **Do the cheap structural fixes first.** A server-side ready/work endpoint, per-entity preconditions in MCP, removal of duplicate aggregate loads, TTL caches for PAT/membership/flags, and a singleflight/gzip/ETag read cache would plausibly remove 80–90% of the agent-path load for a few engineer-weeks. A read model and aggregate-revision cache are the medium-term 5–10× levers. A language/framework rewrite is not on the critical path.

---

## 1. Where resources actually go

### 1.1 Runtime process inventory

| Component | Process model | Footprint | Evidence / note |
|---|---|---|---|
| API | **one** Node process, NestJS 11 + Express adapter, no cluster workers | 123 MB RSS idle for a running dev API process (not necessarily this checkout); 173 MB cold measured for this codebase; 809 MB / 1,479 MB at 10 concurrent 5k / 10k board opens; heap capped at 1,024 MB in Docker | `backend/src/main.ts:16-28`; `Dockerfile:60`; `docker-compose.yml:43`; `docs/PERF-CAPACITY.md:31-37`; `ps` on 2026-11-22 |
| Postgres | one container | 44 MB database for ~27k commands / 5k cards / ~27k comments in the load fixture; `max_connections=100`, Prisma pool 10; `shared_buffers=256 MB`, `work_mem=8 MB` defaults | `docker-compose.yml:119-126`; `backend/src/config/env.ts:142-149`; `~/.janosik-dev/load/LOAD-REPORT.md` §5 |
| Redis | one container, optional | ~5 MB in the dev box; used for global throttler storage, BullMQ queues and realtime pub/sub; **not used as a cache** | `backend/src/app.module.ts:50-71`, `:99-109`; `backend/src/realtime/realtime.service.ts:69-105` |
| UI dev server | Vite, dev only | ~108 MB RSS | measured `ps`, 2026-11-22; production UI is 4.2 MB of static files |
| Site dev server | Astro dev, dev only | ~400 MB RSS | measured `ps`, 2026-11-22; production site is static files served by the API |
| MCP server | **one Node process per agent**, stdio JSON-RPC | 51 MB idle for a running MCP process; **108–113 MB measured during calls** | `mcp/src/index.ts:6,33-34`; `docs/PERF-BASELINE.md:259-260`; `ps` |
| Docker daemon | WSL | ~261 MB | measured `ps`; not part of production capacity |
| Test/Chrome | dev only | Vitest worker 415 MB in another worktree; Chromium adds 1–2 GB during browser e2e | measured `ps`; this is the WSL 8 GB pressure, not the product |

**Key distinction:** the API is one process, so it uses one JS event-loop thread for routing, reducer work, `JSON.stringify`, and SSE fan-out. Prisma's engine and libuv threadpool use additional threads, but the JavaScript hot path is single-threaded. Horizontal scaling means multiple API replicas behind a load balancer, not `cluster` inside one container (there is no cluster code).

### 1.2 Per-request and per-connection costs

| Path | DB work (static code-path count) | Board payload / memory | Measured throughput / latency |
|---|---|---|---|
| `GET /health` | none (readiness cached 2 s) | tiny | ~5,600 req/s raw HTTP ceiling (`docs/PERF-BASELINE.md:36`) |
| `GET /boards/:id` | board + columns + labels + cards(+labels, checklists.items) + links, inside a `REPEATABLE READ` transaction; ~5–6 queries | **3.37 MB @ 5,000 cards; 6.75 MB @ 10,000**; ~675 B/card; ~0.67 MB @ 1,000; ~135 KB @ 200 | 128/131 ms p50/p95 @ 5k; 263/275 ms @ 10k; ~430 req/s CPU-bound at 200–2,400 cards (`docs/PERF-CAPACITY.md:26-29`; `docs/PERF-BASELINE.md:37`) |
| `POST /boards/:id/commands` (PAT) | **~30–40 round-trips**: 4 guard/auth queries; 1 board + 1 aggregate + 1 command pre-read before the lock; inside the transaction 1 board + 1 command + **2 more aggregates** + 7 sequential id checks + seq aggregate + assignee/claim checks + command insert + writes + version reads + command update; 1–2 session updates after commit | no response body of note, but **three full aggregate loads** and two full-board `stableStringify` walks | ~24.4 ms per transaction @ 200 cards → ~42 cmd/s per board; 48 cmd/s measured; 290 cmd/s across 100 boards (`docs/PERF-ONE-BOARD.md:57-73`, `:86`; `docs/PERF-BASELINE.md:39-40`) |
| `GET /boards/:id/events` (SSE) | connect: membership + presence + delta; **every 25 s**: feature flag + membership + token active + token pause + board pause + `max(seq)` | one HTTP connection; ~0.10–0.17 MB RSS/conn after the presence fix; 3,000 conns = 703 MB | post-fix 3,000 conns alive at 703 MB; the old pre-fix run OOM'd at 3,000 and 4,000 opened 0 (`docs/PERF-BASELINE.md:63-72`; `LOAD-REPORT.md` §2). Fan-out p50 30–57 ms, p95 up to 88 ms at 2,000. |
| `GET /boards/:id/activity` | 2 queries + merge, cursor, max 100 rows (default 50) | ~tens of KB | ~250 req/s read-mix ceiling; Watch view polls every 3 s per open tab (`ui/src/components/board/WatchView.tsx:27,310-323`) |
| Notifications | 2 queries, 50 rows, session-only | tens of KB | every 30 s per visible human tab (`ui/src/components/NotificationsBell.tsx:88-111`) |
| MCP tool call | +1 MCP process hop; same API calls | full board read + tool rendering | 5 API requests per create→priority→move→comment iteration; +0 API requests vs direct client after TASK-154; MCP CPU 11 ms/call, RSS 108 MB (`docs/PERF-BASELINE.md:252-260`) |

**Per-request auth detail.** A PAT is not a JWT, so `JwtAuthGuard` first lets Passport reject it, then does `apiToken.findUnique({ where: { tokenHash }, include: { user: true } })` on every request (`backend/src/auth/jwt-auth.guard.ts:79-158`; `backend/src/auth/api-token.service.ts:100-129`). `include: user` loads the full user row, including the password hash. `lastUsedAt` is updated at most once per 60 s per token (`api-token.service.ts:50,120-129`). Then `MembershipGuard` does a board lookup and a membership lookup (`membership.guard.ts:120-130`). There is no TTL cache on any of these.

**Per-command amplification detail.** The PAT path is the expensive one:

- Before the board lock: `board.findFirst`, `loadBoardAggregate`, `command.findMany` for idempotency (`commands.service.ts:402-427`).
- Inside the transaction: `board.findFirst`, `command.findMany` again, a second `loadBoardAggregate` for plan limits (`:518-580`), then a third `loadBoardAggregate` as the running aggregate (`:694`).
- `assertIdsBelongToBoard` runs **seven sequential `findFirst` queries** — column, card, label, checklist, checklist item, card link, activity (`:1429-1485`).
- `applyPrepared` runs the reducer, then **two full-board `stableStringify` calls** (`:1206-1212`), using a replacer that allocates a key-sorted object for every node (`:2471-2482`). At 200 cards this is 0.5 ms (2% of the transaction); it grows linearly with card count.
- The command row is inserted and then updated in the same transaction (`:1227-1275`), so the payload/result/touches are written twice; `details` can additionally store a 64 KB description `from` and `to` (`backend/src/commands/command-details.ts:87-98`; `shared/src/types/kanban.ts:327`).

This is not classic N+1, but it is query amplification: ~30–40 statements per agent command. At 42 commands/s that is roughly 1,300–1,700 statements/s on one board; the statements are indexed and sub-millisecond, which is why Postgres CPU stays low while API CPU is pinned.

### 1.3 Payload and storage growth

- **Board payload is linear in cards:** 3.37 MB / 5,000 = 674 B/card; 6.75 MB / 10,000 = 675 B/card. Descriptions are included in every card (`backend/src/boards/board-aggregate.ts:251`), and descriptions may be 64 KB (`shared/src/types/kanban.ts:327`). A board of 1,000 realistic cards is ~0.67 MB; 200 cards ~135 KB.
- **Transient memory is ~19× the wire payload:** (809 − 173) MB / 10 opens / 5,000 cards ≈ 12.7 KB/card; (1,479 − 173) / 10 / 10,000 ≈ 13.1 KB/card. Ten concurrent 5k opens cost ~64 MB each; ten 10k opens ~131 MB each. This is the figure that makes 500 concurrent board reads dangerous.
- **Command log row size:** the load fixture held 27k commands in ~15 MB, ≈555 B/command (`LOAD-REPORT.md` §5). That is with small descriptions. `UPDATE_CARD` with a 64 KB description stores the payload (~64 KB) plus `details.changes.from` and `.to` (up to 64 KB each), so a single edit can be ~192 KB. `Command` has **nine indexes** (`backend/prisma/schema.prisma:391-429`), so each insert/update multiplies write amplification.
- **Retention is 30 days** (`backend/src/ops/maintenance.service.ts:750-788`), chunked, but the table is not partitioned. At 50 commands/s (500 agents at one action/10 s) that is 4.32M rows/day; at the measured 555 B/row, ~2.4 GB/day of table alone, before indexes and TOAST. 30 days is 70+ GB table and plausibly 150–200 GB with indexes. At 25 commands/s the table is ~1.2 GB/day. **These are extrapolations, not measurements.**
- **Activity is not written per command**; it is written for comments, membership changes, session lifecycle and approvals (`backend/src/activity/activity.service.ts` and call sites). It has a 30-day retention sweep too. Command preimages for agent runs duplicate the before-state per command (`CommandPreimage`, `schema.prisma:431-440`), adding more bytes for batched runs.

### 1.4 What the existing benchmarks already prove

| Document | What it proves | What it does not prove |
|---|---|---|
| `docs/PERF-BASELINE.md` | 5,600 req/s raw HTTP; 430 req/s board aggregate; 48 cmd/s one board; 290 cmd/s across 100 boards; 257 comments/s; 3,000 SSE conns in 703 MB after the presence fix; MCP path is 5 requests/iteration and 108 MB RSS | No 500-agent test; no board-rate-limit test; no board-wide CAS retry test; generators share the host |
| `docs/PERF-ONE-BOARD.md` | One-board throughput is flat at ~42–48 cmd/s from 25 to 100 writers; latency grows linearly; advisory lock is only 3%; `aggLoad` 33% + `preChecks` 29%; batch ×5 gives 2.3–2.5× | Does not exercise `ifMatch`/retries (explicit caveat at `:143-146`); no 100+ agent MCP swarm; 200-card board |
| `docs/PERF-CAPACITY.md` | 5k board = 3.37 MB / 128 ms; 10k = 6.75 MB / 263 ms; 10 concurrent opens = 809 MB / 1,479 MB RSS; 5 writers at 10k = 3.4 cmd/s, p95 13.9 s | Single board; no agent transport; no rate limits |
| `docs/PERF-25K-INVESTIGATION.md` | Full architectural analysis: full aggregate per command is bottleneck #1, reducer + full-board diff #2, position rewrite #3; recommends read model, aggregate-revision cache, compression/ETag, no-op detection | Planning/estimate beyond 10k; not a 500-agent benchmark; no MCP swarm |
| `~/.janosik-dev/load/LOAD-REPORT.md` (outside repo) | Mixed load: p95 4–10 s at 200–400 VUs on one board; combined run collapses mixed RPS 258→53 and SSE fan-out p95 to 20 s; DB 44 MB with Command 15 MB; queries sub-ms | Same-host generators; pre-presence-fix SSE OOM at 3,000; no MCP concurrency |
| `.github/workflows/ci.yml` | Correctness, security, build, browser e2e, UI bundle budget | **No load/perf gate at all**; CI runs on 4-core GitHub runners and never simulates agents |

**Bottom line from the evidence:** Janosik has good unit-cost measurements and a strong correctness story, but **no measurement of the actual agent workload** (concurrent MCP sessions, wait-for-work polling, board-wide CAS retries, 500 agents on one or many boards). The rest of this report extrapolates from the unit costs and identifies what must be measured first.

---

## 2. What breaks first at 100 / 500 / 1,000 agents

### 2.1 The three agent transport paths

| Path | What it is | Scales? | Where it hurts |
|---|---|---|---|
| **MCP stdio** | one Node process per agent; JSON-RPC over stdin/stdout; HTTP `fetch` to the API | **No, per host.** 108 MB × N processes; 500 = 25–55 GB. No shared cache, no multiplexing | Process count/memory on the agent host; each process does its own full-board reads. **No DB pool per process**, so it does not multiply Postgres connections. |
| **HTTP PAT API** | stateless `Authorization: Bearer jnk_…`; same command/read endpoints | **Yes, horizontally.** Add API replicas; pool 10 each; Redis for shared throttling/fanout | Per-request auth/membership queries; full-board payloads; board serialization; board rate-limit bucket; in-process agent buckets are per-node |
| **SSE** | server push per board; resume from `?since=`; presence optional | **Per instance, to ~2–3k connections** with current memory; multi-node via Redis pub/sub | 0.10–0.17 MB/conn; 4–6 DB queries per 25 s tick; per-subscriber `JSON.stringify`; post-commit synchronous fan-out |

**The MCP path and the HTTP path are not different server loads.** MCP is a thin client that makes the same HTTP calls. Its server-side cost is the API cost; its client-side cost is the extra process and the full-board read it performs before every write. The SSE path is mostly a human/oversight path, not an agent path — unless the deployment gives every agent a stream.

### 2.2 Ranking by agent count

These are capacity estimates from measured unit costs, not a 500-agent benchmark. They assume a typical agent loop of `wait_for_work`/`list_ready_cards` → read board → claim → comment → move, with one action every 10–60 s when work exists. The top rows are what fails **first**, in order.

#### 100 agents, one board

| Rank | Bottleneck | Why / number | Evidence |
|---:|---|---|---|
| 1 | **Idle `wait_for_work` polling** | 100 agents / 5 s = 20 full-board reads/s. At 200 cards that is ~2.7 MB/s wire and ~50 MB/s transient allocation; at 1,000 cards ~13 MB/s and ~260 MB/s allocation. | `mcp/src/tools/cards.ts:1205-1265`; payload/memory fits from §1.3 |
| 2 | **Board rate-limit bucket** | The historical 600/min shared budget is gone: TASK-200.3 uses `max(12000, 2 × THROTTLE_LIMIT)` weighted units/min with continuous refill, per-token/session shares and MCP `429` retry. 100 agents acting every 20 s fit; idle polling is the next fix. | `backend/src/config/rate-limit.ts`; `backend/src/common/board-rate-limit.ts`; `mcp/src/errors.ts` |
| 3 | **Board-wide CAS conflicts** | Active writers read the whole board and send `ifMatch = seq`; at 42 cmd/s the average inter-commit gap is ~24 ms, so a 30 ms read→write gap has ~70% chance of another commit; each conflict re-reads the board. | `mcp/src/client.ts:434-465`; `docs/PERF-ONE-BOARD.md:43-55` |
| 4 | **One-board serialization** | At 100 agents × 1 action/10 s = 10 cmd/s, fine; at 1 action/2 s = 50 cmd/s, at the 42–48/s ceiling and latency grows linearly. | `docs/PERF-ONE-BOARD.md:45-53,86` |
| 5 | Memory from concurrent reads | 100 concurrent 200-card reads ≈ 0.25 GB; at 1,000 cards ≈ 1.3 GB. Survivable on 8 GB, risky on 2 GB. | `docs/PERF-CAPACITY.md:31-37` fitted |
| 6 | SSE keep-alive | Only if all 100 hold streams: 100 / 25 s × 4–6 queries = 16–24 queries/s. Minor. | `backend/src/commands/events.controller.ts:219-249` |

**Verdict at 100 / one board:** the swarm is not limited by command throughput; the remaining limit is the **idle polling loop**, not the old 600/min board bucket (TASK-200.3 raised it to the high safety ceiling). Fix polling (200.2) and 100 agents at a 10–20 s cadence fit comfortably.

#### 500 agents

| Rank | Bottleneck | Why / number | Evidence |
|---:|---|---|---|
| 1 | **`wait_for_work` / ready-work polling** | 500 / 5 s = 100 full-board reads/s = 6,000 req/min, **10× the board budget**. At 1,000 cards ~67 MB/s wire and ~1.3 GB/s transient allocation. | `mcp/src/tools/cards.ts:1205-1265` |
| 2 | **Concurrent full-board read memory** | 500 × 2.5 MB (200 cards) ≈ 1.25 GB; 500 × 13 MB (1,000 cards) ≈ 6.5 GB; 500 × 64 MB (5,000 cards) ≈ 32 GB. The API has no admission control or singleflight for these. | `docs/PERF-CAPACITY.md:31-37`; `backend/src/boards/boards.service.ts:473-494` |
| 3 | **Board-wide CAS retry storm** | With 500 agents on one board, conflicts are near-certain; each retry is another full-board GET and another command attempt. The server serializes the write but the client's read version is stale by design. | `mcp/src/client.ts:434-465`; `docs/PERF-ONE-BOARD.md:143-146` |
| 4 | **Board budget + serialization** | 500 agents at 1 action/20 s = 25 cmd/s, inside 42–48/s; 3,000 req/min now fits the TASK-200.3 12,000/min ceiling. At 1 action/10 s = 50 cmd/s, at/over the lock ceiling. | `backend/src/config/rate-limit.ts`; `docs/PERF-ONE-BOARD.md:86` |
| 5 | **MCP process memory on the agent host** | 500 × 108 MB = 54 GB; 500 × 51 MB idle = 25.5 GB. Co-locating agents with the server is impossible. | `docs/PERF-BASELINE.md:259-260`; `mcp/src/index.ts:33-34` |
| 6 | **Command log growth** | 25–50 cmd/s → 1.2–2.4 GB/day of table at 555 B/row, before indexes/TOAST; 30-day retention → tens to hundreds of GB. | `LOAD-REPORT.md` §5; `maintenance.service.ts:750-788` |
| 7 | SSE keep-alive if every agent holds a stream | 500 / 25 × 4–6 = 80–120 queries/s; okay in isolation, but bursts compete with the 10-connection pool. | `events.controller.ts:219-249` |

**Verdict at 500:** **do not run 500 agents on one board through the current `wait_for_work` loop.** With a server-side ready endpoint, per-entity CAS, a raised board budget and jittered polling, 500 agents at 1 action/20 s on one board is close to feasible (25 cmd/s vs 42–48/s), but the safe production shape is **500 agents across 10–50 boards**. The MCP process count must be solved by an HTTP gateway regardless.

#### 1,000 agents

| Rank | Bottleneck | Why / number | Evidence |
|---:|---|---|---|
| 1 | **MCP process count** | 1,000 × 50–110 MB = 50–110 GB on the agent host. This is the hard wall unless agents use a shared HTTP MCP gateway or direct HTTP. | `docs/PERF-BASELINE.md:259-260` |
| 2 | **Idle full-board polling** | 1,000 / 5 s = 200 full-board reads/s, approaching the measured ~430 req/s aggregate ceiling **before any writes**. With `boardId` omitted, each poll also calls `listBoards` and every board. | `mcp/src/tools/cards.ts:1205-1265,1313-1324`; `docs/PERF-BASELINE.md:37` |
| 3 | **API CPU / read ceiling** | ~430 aggregate reads/s per 16-vCPU process; 200 idle polls/s plus active reads/writes leaves little headroom. Multi-replica + Redis is required. | `docs/PERF-BASELINE.md:37`; `docs/PERF-ONE-BOARD.md:86` |
| 4 | **Concurrent read memory** | 1,000 concurrent 1,000-card reads ≈ 13 GB transient at 13 MB/read. Without singleflight/admission control this OOMs long before CPU. | fitted from `docs/PERF-CAPACITY.md:31-37` |
| 5 | **Global command CPU** | ~290 cmd/s across 100 boards measured; 1,000 agents at 1 action/15 s = 67 cmd/s, fine **if spread**. At 1 action/5 s = 200 cmd/s, near the global ceiling. | `docs/PERF-BASELINE.md:40` |
| 6 | **Postgres connections / replicas** | 10 per API process; 4 replicas = 40, under 100. PgBouncer optional, not urgent. | `backend/src/config/env.ts:145-149`; `docker-compose.yml:126` |
| 7 | **Command log / vacuum** | 67 cmd/s → 3.2 GB/day table; 30 days ~100 GB table, 200+ GB with indexes. Partitioning or shorter agent retention becomes necessary. | derived from `LOAD-REPORT.md` §5 |
| 8 | **SSE** | 3,000 conns ~703 MB post-fix; 5,000 would be ~850 MB plus base, at/over the 1 GB heap. Keep SSE for humans, not every agent. | `docs/PERF-BASELINE.md:63-72`; `Dockerfile:60` |

**Verdict at 1,000:** feasible only with (a) agents on separate hosts or an HTTP MCP gateway, (b) a server-side work/ready endpoint, (c) multiple API replicas, (d) a read model + read cache, (e) a raised/reshaped board budget. It is not a "buy a bigger server" problem; it is an amplification problem.

### 2.3 Production capacity vs the 8 GB WSL dev box

Measured on the dev WSL on 2026-11-22: `free -m` shows **7,941 MB total, 2,266 MB used, 5,675 MB available**; a running dev API process is 123 MB, the Astro dev server 400 MB, Vite 108 MB, a Vitest run in another worktree 415 MB, Docker daemon 261 MB, and an MCP process 51 MB. A browser e2e run adds Chromium and can push the box into swap/restart. **That is a dev-environment memory story, not a product one.** The production API cold RSS for this codebase is 173 MB and one Node process; the measured capacity numbers come from a 16-vCPU / 23 GiB host, not from this 8 GB WSL.

Do not conclude from WSL restarts that the product is heavy. Do conclude that running the full dev stack + Docker Desktop + browser tests + several worktrees on 8 GB is over-subscribed, and that production sizing must be measured on the target host (4–8 vCPU, 8–16 GB is a reasonable starting point for hundreds of slow agents; 2 GB only for a small board and a handful of SSE viewers).

---

## 3. Worker threads: where they help, where they are cargo cult

There are **no `worker_threads`, Piscina, or `new Worker` uses in the backend, MCP, UI or shared code** (grep over `backend/src`, `mcp/src`, `ui/src`, `shared/src`). The question is therefore "should we add them?", not "are we using them badly".

| Work | Bound by | Measured / derived cost | Would a worker help? |
|---|---|---|---|
| `stableStringify` before/after diff | CPU, O(cards) | 0.5 ms at 200 cards, 2% of the 24 ms transaction; ~2× per command; at 5k cards ~12.5 ms per stringify, at 10k ~25 ms | **No.** It runs inside the Prisma transaction; you cannot move the transaction to a worker. Structured-cloning a 3–17 MB board costs more than the diff. Fix with identity-based change detection / an aggregate revision. |
| `boardReducer` over the whole board | CPU, O(cards) | Allocates a new cards map/record per command; part of the 24 ms transaction | **No.** Same transaction-affinity problem. Fix with targeted loads or an aggregate cache. |
| `JSON.stringify` of a board response | CPU, O(payload) | 3.37 MB at 5k; ~15–30 ms per response estimate; at 430 req/s this is already a large share of the CPU ceiling | **Maybe, narrowly.** A worker could stringify a snapshot and return a string; but a shared serialized cache/ETag removes the duplicate work entirely. Do the cache first. |
| gzip/brotli (not currently enabled) | CPU, but Node `zlib` is async on the libuv threadpool | 70–80% byte reduction expected | **No worker needed.** `zlib` already offloads to the libuv pool; add compression or terminate at nginx/Caddy. |
| Argon2 password hash/verify | CPU, native | Login/registration only; agents use PATs | **No.** `argon2` is a native async binding on the libuv pool (`backend/src/auth/auth.service.ts:211,368,569`). |
| SHA-256 PAT hashing | CPU, tiny | One hash per PAT request; microseconds | **No.** |
| ffmpeg thumbnail/transcode | External process | `ffmpeg-static` child process (`backend/src/attachments/media.service.ts:272`) | **No.** Already a separate process. Uploads stream to disk; 20 × 24 MB uploads added only ~10 MB RSS (`docs/PERF-BASELINE.md:218-234`). |
| Account export/import | CPU/JSON, but rare | BullMQ queue when Redis is configured; inline only under 1,000 authored rows (`backend/src/admin/exports.service.ts:30-47`) | **No, not on the agent path.** If exports grow, use a BullMQ worker **process**, not a thread. |
| Search | DB | Postgres `contains` queries; not a hot agent path | **No.** Use indexes/FTS if it ever matters. |

**Cost of adding a worker pool:** each Node worker has its own V8 isolate and baseline memory, typically ~10–30 MB before your data; a Piscina pool of N workers on a 2–4 vCPU host leaves little CPU for the API; every task boundary adds structured-clone/serialization; and debugging, graceful shutdown, and Prisma access all get harder. On this workload the measured CPU is dominated by O(board) reducer/stringify work that is *inside* a database transaction, so workers would add overhead without removing the real cost.

**Verdict:** **no worker threads now.** The correct fixes are algorithmic: incremental change detection, an aggregate-revision cache, targeted loads, and a read model. Revisit a worker only for large-board JSON serialization/compression *after* those, and only if profiling shows it is still >20% of CPU.

---

## 4. Framework and language choices

### 4.1 NestJS vs Fastify

**What we know:**

- The API is NestJS 11 on `@nestjs/platform-express` (`backend/package.json:37-41`; `backend/src/main.ts:16`), with Express middleware for helmet, cookie-parser, three body parsers, static assets, multer uploads, and Nest's `@Sse` transport (`backend/src/common/app-setup.ts:36-119`; `backend/src/common/serve-frontends.ts:58-95`; `backend/src/commands/events.controller.ts:68-79`).
- Raw HTTP ceiling is ~5,600 req/s on 16 vCPU (`docs/PERF-BASELINE.md:36`). A board aggregate is ~430 req/s and a one-board command stream ~42–48/s. The framework ceiling is ~13× the business endpoint, so Express/Nest routing is **not** the constraint for agent work.
- The command transaction is ~24 ms at 200 cards; Nest middleware/DI/validation is a small fraction. Swapping the adapter cannot remove the three aggregate loads, the reducer, the stringify, or the DB round-trips.
- Fastify would require reworking multer (attachments), `@Sse` behavior, static serving, cookie parsing, helmet integration, and the body-limit routing. That is a non-trivial regression surface for a single-digit-percent gain on the hot path.
- The global `ValidationPipe` (`app-setup.ts:119`) and class-validator DTOs stay regardless of adapter; Fastify does not remove validation cost.

**Verdict:** **do not swap the adapter as a scaling move.** If profiling later shows >20% of CPU in Express middleware for a specific hot endpoint, extract that endpoint or use Fastify for a new service; do not rewrite the control plane. A reverse proxy (nginx/Caddy) for static files, gzip and SSE buffering is a cheaper win.

### 4.2 Go rewrite

**What would genuinely gain:**

- Raw HTTP throughput: realistically **2–4×** Node for trivial routes.
- SSE memory per connection: Node measured 0.10–0.17 MB/conn; Go goroutines + buffers are typically tens of KB, so **5–10× lower** per connection.
- SSE fan-out CPU and JSON serialization: **2–3×** at best, and only if the Go service also avoids per-subscriber stringification.
- Static binary deployment and predictable memory: real operational benefits.

**What would not gain:**

- The command path is DB-bound and algorithm-bound. A Go port that still loads the whole board three times, runs the same reducer and writes the same command rows will be **~1.2–2× faster at best**, not 10×. Postgres, the 30–40 statements, the 7 id checks, and the command log remain.
- The business logic is large: ~55k lines of backend TypeScript (including tests) across auth, approvals, plans, runs, agent sessions, admin, share, attachments, queues, idempotency, undo/preimages, and security invariants. A rewrite is **6–12 engineer-months** with a high regression risk on exactly the correctness properties that make the product trustworthy.
- The UI is unaffected. React stays React.
- Prisma's schema/query layer would need a Go ORM/SQL layer; migrations and the generated client are not portable for free.

**Realistic multiplier:** if the bottleneck were raw SSE/HTTP, 2–4×; for the actual agent command/read path with the same design, **1.2–2×**. The redesign that gives 5–10× (read model, cache, per-entity concurrency) is available in Node and is far cheaper.

**Verdict:** **no full Go rewrite.** A **hybrid** is defensible only after measurements: keep NestJS as the control plane (auth, commands, approvals, admin, DB), and extract a **dedicated SSE gateway** (Go or uWebSockets.js) that subscribes to Redis pub/sub and owns long-lived connections. That gateway would need a cheap auth/introspection path and a pre-serialized frame format. Even then, the first fix is to stop giving every agent an SSE stream and to cache keep-alive validation; the gateway is a second-order optimization.

### 4.3 React

**React is not on the server path at all.** The UI is a static SPA built to `ui/dist` (4.2 MB total; critical-path budget 300 KB gzip, enforced in CI at `ui/package.json:8-22` and `.github/workflows/ci.yml:132-133`). The API serves those bytes (`backend/src/common/serve-frontends.ts:58-95`; `Dockerfile:87-88`). Five hundred agents do not download or execute React; only human/oversight tabs do.

**Where React actually costs:**

- Client memory and main-thread time for large boards. Before virtualization: 2,400 cards = 67,676 DOM nodes, 1.1 GB JS heap, 4.8 s first render; after virtualization: 108 cards in DOM, 90 MB heap, ~0.7 s first render, 176 ms max long task (`docs/PERF-BASELINE.md:53-60`, `:164-179`). Virtualization is already implemented with `@tanstack/react-virtual` (`ui/src/components/board/TableView.tsx:1,340`; `CalendarView.tsx:1,163`).
- SSE-driven re-renders: the board store applies each command through the shared reducer. The measured 240 live `UPDATE_CARD` commands produced **0 long tasks** on the main thread (`docs/PERF-BASELINE.md:206-210`). The Watch view is deliberately tiny: ~405 DOM nodes, no cards, a 50-row feed polled every 3 s (`WatchView.tsx:27,254-323`; `docs/PERF-BASELINE.md:212-216`).
- Many human tabs: each tab holds a board in memory (~90 MB heap at 2,400 cards) and polls activity every 3 s. 100 watchers = ~33 req/s; 500 watchers = ~167 req/s, a meaningful share of the ~250 req/s read-mix ceiling. That is a human-oversight cost, not an agent cost; increase the poll interval or move Watch to SSE activity frames if it matters.

**Verdict:** **no React rewrite.** The UI is already virtualized and measured. Optimize the Watch polling and avoid unnecessary memoization churn only if human watcher counts grow; do not touch React for agent scale.

### 4.4 Other alternatives

| Option | Where it could help | Why it is not the answer now |
|---|---|---|
| **uWebSockets.js** | Dedicated SSE/WebSocket gateway: lower per-connection memory and higher fan-out | Not a Nest adapter drop-in; would be a separate gateway. Only worth it after SSE fan-out/keep-alive is measured as the bottleneck. |
| **Bun / Deno** | Faster startup/raw HTTP possibly | Nest + Prisma + native argon2/ffmpeg + multer/SSE compatibility risk; no measured evidence for this workload. Not a production bet. |
| **SQLite / libSQL** | Single-node simplicity, no network DB | Postgres is not the bottleneck (sub-ms queries, 44 MB fixture). SQLite's single-writer model is worse for concurrent agents; loses advisory locks, `SKIP LOCKED`, JSONB/GIN, multi-node. No. |
| **Redis Streams instead of pub/sub** | Durable fan-out/replay with consumer groups | The Postgres command log is already the durable replay source; Redis pub/sub is fire-and-forget by design and streams catch up from the log. Redis Streams adds trim/memory complexity for little gain. |
| **NATS** | Lightweight pub/sub, good fan-out | Another broker to operate; Redis is already present for throttling/queues. No evidence it is needed. |
| **Read replicas** | Read scale-out | The DB is not saturated; API CPU/aggregate assembly is. Replication lag would complicate `seq`/SSE correctness. Defer. |
| **PgBouncer** | Connection multiplexing with many API replicas | 10 connections/replica × 4 replicas = 40 < 100. Optional at >8 replicas, not urgent. |
| **nginx/Caddy in front** | gzip/brotli, static offload, SSE buffering off, connection limits, TLS | **Yes, recommended for production.** The compose stack currently publishes the API directly with no proxy. |

---

## 5. Architecture review

### 5.1 What is right

- **The command log is a sound correctness core.** Client-supplied `commandId` gives idempotent retries; `seq` gives a total order per board; `?since=` and the SSE sequencer replay exactly once or force a resync (`backend/src/commands/command-stream.ts:9-31`); preimages/inverses support undo and run revert. This is the hard part, and it is well designed.
- **Per-board serialization is the right default for correctness.** The in-process queue + `pg_advisory_xact_lock` prevents deadlocks and makes the reducer deterministic (`backend/src/common/board-write.service.ts:90-104,141-157,171`). The measured advisory-lock wait is only 3%; the cost is inside the transaction, not the lock (`docs/PERF-ONE-BOARD.md:63-86`).
- **Batch commands are a real win.** One transaction for up to 100 commands amortizes the aggregate load, lock and id-check; measured 2.3–2.5× (`docs/PERF-ONE-BOARD.md:116-139`). The MCP `create_card` already uses a batch.
- **SSE replay/resume is well built.** Contiguity via `prevSeq`, log re-read on gaps, resync when the baseline is trimmed, presence deltas rather than full rosters (`command-stream.ts:84-160`; `realtime/presence.service.ts:75-81`). The Watch view does **not** recompute diffs per client; the server freezes `details` at apply time and the client applies the command action (`command-details.ts:4-15`).
- **Operational guardrails exist:** readiness cache, body-size caps, upload streaming, SSE admission caps, per-token/session/board budgets, token/session pause, audit. The issue is sizing and placement, not absence.
- **The DB schema/indexes are good for the measured workload:** board command delta 0.09 ms, activity 0.05 ms, comments 0.28 ms, all-card board read 0.76 ms at 2,400 cards (`LOAD-REPORT.md` §5). Postgres is not the problem.

### 5.2 What limits scale

1. **Full-board read-modify-write is the core architectural cost.** Every command loads every card/description/checklist/link, runs the reducer over the whole board, and serializes the board twice to detect change. At 200 cards that is 24 ms; at 5,000 it is dominated by `aggLoad` and diff. This is the #1 bottleneck in `docs/PERF-25K-INVESTIGATION.md:298-351` and it is the same bottleneck for agents.
2. **The PAT path loads the aggregate three times.** Pre-lock classification, in-transaction plan limits, and the running aggregate. Two of these are redundant for the common non-destructive worker command. This is a pure code-path waste, not a fundamental design choice.
3. **MCP uses board-wide CAS.** `ifMatch = seq` is correct for a single editor, wrong for a swarm: unrelated edits conflict. The UI already uses per-entity `ifMatchVersions`; MCP sends it only in the plan tool. This is the single biggest agent-specific correctness/performance mismatch.
4. **MCP polls for work on the client.** `wait_for_work` is a loop of full-board GETs in the MCP process. There is no server-side ready queue, no long-poll, no summary endpoint, no `ETag`. Idle agents are the most expensive state.
5. **The board rate-limit bucket is no longer sized for a handful of agents.** TASK-200.3 raised the shared ceiling to 12,000+ weighted units/min, added per-token/session shares, and MCP retries `429`/`503` with `Retry-After`. The remaining limit is idle polling and full-board reads.
6. **Hot-path auth and membership are uncached.** PAT lookup + board lookup + membership lookup on every agent request; feature flags explicitly uncached (`backend/src/ops/feature-flags.service.ts:12-18,38`); SSE keep-alive repeats all of it. At human scale this is fine; at 500 agents it is 1,000+ needless queries/s.
7. **No singleflight or serialized board cache.** 500 identical concurrent reads each build and serialize their own full board. The measured 64–131 MB per concurrent open means this is an OOM vector, not just CPU.
8. **SSE fan-out is synchronous and per-subscriber.** `RealtimeService.publish` runs after commit and iterates every subscriber; Nest's `@Sse` JSON-stringifies the same event separately for each connection (`node_modules/@nestjs/core/router/sse-stream.js:12-16`). A description update also publishes an extra `activity` frame (`commands.service.ts:828-840`). At 500 subscribers and a 64 KB description that is ~32 MB of string allocation per command.
9. **SSE keep-alive has no overlap guard or jitter.** Each connection's 25 s timer runs `flags.isEnabled` + membership + token active + token/board pause + `latestSeq`; at 5,000 connections that is ~800–1,200 queries/s, and a slow DB can pile up 5,000 concurrent tick query sets against a 10-connection pool (`events.controller.ts:219-249,268-304`).
10. **No hot-path caching, no pagination on the hottest payload, no read model.** Activity/comments/agents have cursors and limits; the board aggregate does not. Share/admin have short caches; the board command/read path does not.
11. **No backpressure or admission control.** The per-board queue is a promise chain with no length limit (`board-write.service.ts:141-157`); the transaction timeout is 5 s to acquire / 15 s total (`:35-36`); board reads have no concurrency semaphore. A burst holds connections, request bodies and aggregate copies until timeout.
12. **Command log growth and write amplification.** Nine indexes, JSON payload/result/details, preimages, 30-day retention, no partitioning. At 500 agents this is the storage/vacuum problem even if CPU is fixed.
13. **Single process, no replicas, static files served by the API.** The compose stack runs one app container and no proxy (`docker-compose.yml:17-107`). One Node event loop serves API, SSE, uploads, and static UI/site. Horizontal replicas + Redis fan-out exist in code but are not the default deployment.
14. **MCP stdio process-per-agent.** Not a server flaw, but the default MCP transport makes co-located swarms impossible at 500+.

### 5.3 MCP server design

- **Lifecycle:** `mcp/src/index.ts` creates one `McpServer`, connects a `StdioServerTransport`, and exits on SIGINT/SIGTERM (`:32-46`). One process per client session is the MCP stdio contract.
- **DB:** none. `mcp/package.json` depends only on `@modelcontextprotocol/sdk` and `zod`; the Janosik client is `fetch` (`client.ts:191-244`). So 500 MCP processes do **not** create 500 Prisma pools; they create 500 HTTP clients and 500 processes' worth of V8 memory.
- **Read-before-write:** `commandOnFreshBoard` reads the whole board, builds the action, and sends `ifMatch = seq` (`client.ts:434-465`). Most write tools use it (7 call sites in `mcp/src/tools`). The move tool already reuses its read for the DoD gate, so it costs one GET, not two (`tools/cards.ts:466-475`).
- **Work discovery:** `janosik_wait_for_work` loops `getBoard` every `pollMs` (default 5,000) for up to `timeoutMs` (default 30,000, max 300,000) (`tools/cards.ts:1205-1265`). Without `boardId`, `loadBoards` calls `listBoards` and fetches every board in batches of 4 (`:1313-1324`). This is the dominant idle load.
- **Gateway:** a shared **Streamable HTTP MCP gateway** is feasible and cheap. The tools are stateless wrappers over HTTP; the token can be taken from the request's `Authorization` header, a `JanosikClient` created per request/session, and the MCP SDK's HTTP transport used with a session map. One process (or a small replica set) would replace 500 stdio processes, with no DB pool and no change to the command API. It should be a **separate service/container**, not embedded in the API process, so a gateway crash/CPU spike cannot take down board writes.

### 5.4 Command log + SSE: can it serve many subscribers?

**For human watchers, yes — with caveats.** The design is push-based, resumable, and replayable; Watch does not diff per client; presence is delta-based to avoid the O(N²) roster blow-up. At 100–500 human viewers it is fine if keep-alive validation is cached and frames are pre-serialized.

**For 500–5,000 agents, no — and they should not need it.** The costs are per connection (0.10–0.17 MB), per tick (4–6 DB queries), and per frame per subscriber (`JSON.stringify`). A 5,000-connection instance is at ~1 GB RSS before board traffic, at the 1 GB heap cap. The right agent transport is request/response or long-poll on a **summary/ready** endpoint, not a full-board SSE stream. If agents must watch, open a stream with `?presence=0`, subscribe to a **summary** channel (card id/column/version only), and never send full descriptions on the stream.

**Does `Watch` recompute diffs per client?** No. The server stores `details` at apply time (`command-details.ts:4-15`), and the client reducer applies the action. The per-client cost is applying one command, not diffing the board. That part is right.

---

## 6. Recommendations

Ranked by impact on agent scale / (effort + risk). "S" ≤ 1 engineer-week, "M" 2–3 weeks, "L" 4–6 weeks, "XL" > 6 weeks.

### 6.1 Quick wins (do first)

| # | Change | Expected gain | Effort | Risk / how to measure |
|---:|---|---|---|---|
| 1 | **Server-side work discovery.** Add `GET /boards/:id/ready?limit=` returning only ready card summaries (id, title, column, priority, claim state), backed by an indexed SQL query on the first column. Rewrite `janosik_wait_for_work` to long-poll that endpoint (25–60 s) or call it at a much lower cadence. Never fetch full boards to find work. | Removes ~90%+ of idle-agent board reads; 500 agents go from ~100 full-board GET/s to ~8–20 summary requests/s. | S–M | Low. Measure requests/agent/minute, bytes/request, p95 latency, 429 rate. |
| 2 | **Retune the agent budgets and make MCP honor 429.** Raise `BOARD_RATE_LIMIT` for swarm deployments (or replace the single shared bucket with per-token/session budgets plus a high board safety ceiling). Add `Retry-After` backoff/retry to MCP for 429, or make the server queue instead of rejecting. | Removes the artificial 5 actions/s per-board cap and the 429 storm at 100+ agents. | S | Low–medium. Measure 429 rate and fairness across agents; ensure one abusive token cannot starve the board. |
| 3 | **Remove duplicate aggregate loads on the PAT command path.** Load the board once inside the transaction and reuse it for plan limits + running state; skip the pre-lock aggregate when the policy/plan classification does not need it. | ~30–50% fewer DB statements and less CPU per agent command; probably a 1.3–2× command throughput gain at 200 cards. | S–M | Low. Count queries/command via `pg_stat_statements`; compare p95 and actions/s. |
| 4 | **TTL-cache PAT auth, board membership and feature flags.** 10–30 s TTL, keyed by token hash / (user, board) / flag key; invalidate on revoke, membership change, pause and flag update via the existing realtime bus. At minimum, narrow the PAT `include: user` to the fields actually needed. | Removes 3–5 DB queries per agent request and 4–6 per SSE tick; cuts 1,000+ queries/s at 500 agents. | S–M | Medium (revocation/role-change lag). Bound the TTL, bypass cache for writes/pause/resume, and test revocation within the TTL. |
| 5 | **Add gzip/ETag and a singleflight board read.** Compress board responses (or terminate at nginx/Caddy), key ETag by board seq + route + role/projection, and coalesce identical concurrent reads into one build. | 70–80% fewer bytes; 10–100× less transient memory for synchronized reads; 500 identical reads become one build. | S–M | Medium (staleness). Key by seq; never serve a cached board for a write's CAS without accepting conflicts. Pair with #6. |
| 6 | **Stop using board-wide CAS in MCP.** Use per-entity `ifMatchVersions` for the entities the command touches (the server already supports it, `commands.service.ts:2170-2203`), or add targeted card intent endpoints that let the server resolve positions. Reserve `ifMatch = seq` for a deliberate "read the whole board" mode. | Removes the retry storm on unrelated edits; fewer full-board re-reads and 409s; higher effective actions/s. | M | Medium. Add entity versions to the board read (header or summary) or track them from command responses; test concurrent move/update on different cards. |
| 7 | **Agent SSE hygiene.** Default agent streams to `?presence=0`; cache keep-alive validations; jitter the 25 s timer; add an overlap guard; consider 60 s for PAT streams. | Cuts SSE keep-alive DB load 2–5×; avoids 5,000 concurrent tick queries against a 10-connection pool. | S–M | Low. Measure queries/s per 1,000 streams and event-loop lag. |
| 8 | **MCP HTTP gateway.** Add a Streamable-HTTP transport (token pass-through) as a separate service; keep stdio for desktop clients. | 500 × 50–110 MB → one/few processes of a few hundred MB; no co-location OOM. | M | Low–medium. Verify per-session token isolation and that no token leaks across sessions. |

> **TASK-200.3 update (implemented).** Recommendation 2 is in `main`:
> `BOARD_RATE_LIMIT` is now a high, continuously refilling safety ceiling
> (default `max(12000, 2 × THROTTLE_LIMIT)`), with per-token
> (`AGENT_TOKEN_RATE_LIMIT`) and per-session budgets providing fairness.
> Commands over the board ceiling wait briefly and then answer `503
> rate_limited` + `Retry-After`; the MCP client retries `429`/queued `503` with
> `Retry-After`, jitter and a four-attempt bound, keeping the same
> `commandId`/`Idempotency-Key`. Remaining capacity work in this document
> (ready endpoint, per-entity CAS, aggregate loads) is unchanged.

### 6.2 Medium-term (the real 5–10× levers)

| # | Change | Expected gain | Effort | Risk |
|---:|---|---|---|---|
| 9 | **Read model v1:** board summary + per-column cursor windows + card detail. `GET /boards/:id` returns a summary (columns + counts + first window), not every card/description. MCP uses `ready`/summary + targeted card detail. | Initial view < 2 MB / < 300 ms; 10 concurrent opens < 1.5 GB; 5–10× less read memory/bytes; agent reads become bounded. This is the structural fix recommended in `docs/PERF-25K-INVESTIGATION.md:615-634`. | L | High (client/store/undo/DnD/deep links); capability-gate the old full aggregate for old clients/admin/export. |
| 10 | **Per-board aggregate cache keyed by `aggregateRevision`.** Add a board revision bumped by every board-scoped writer (commands, comments, attachments, session end, admin restore); keep the loaded aggregate in an LRU; use it inside the command transaction. | Removes the full DB load per command; 5–10× command throughput at larger boards; the plan in `docs/PERF-25K-INVESTIGATION.md:640-689`. | L | High (coherency across replicas, comments/attachments/session writes, memory). Revision must not be `seq` only. |
| 11 | **Targeted card intent endpoints for agents.** `POST /boards/:id/cards/:cardId/claim`, `/move` (destination column, optional position), `PATCH /boards/:id/cards/:cardId` for fields, plus a comment endpoint. Server loads only the card/column/workflow, builds the command, and applies it. | Removes the full-board read before every agent action; no client CAS; fewer bytes and less CPU. | M–L | Medium (duplicate command semantics; must keep idempotency/undo). |
| 12 | **Command-log partitioning / detail separation.** Partition by board or month; move `payload`/`result`/`details` to a side table or compress them; shorten agent retention if audit allows; cap stored description diffs. | Keeps 30-day retention from becoming hundreds of GB; lowers vacuum/index bloat. | M–L | Medium (migrations, replay/resync, admin queries). |
| 13 | **Horizontal API replicas + nginx/Caddy.** 2–4 API containers behind a proxy; Redis for shared throttler/fanout; static files and gzip at the proxy; `ulimits.nofile` and memory/CPU limits in compose. | Uses multiple cores; isolates SSE/static from API; HA; removes the single-process ceiling. | S–M (ops) | Low–medium (sticky SSE not required because of `?since=`; shared rate-limit semantics). |
| 14 | **Pre-serialized SSE frames.** Build the SSE `data:` string once per event and write the same Buffer to all subscribers, bypassing per-connection `JSON.stringify`; drop slow subscribers or bound their buffers. | 2–10× lower fan-out CPU at high subscriber counts; less GC. | M | Medium (custom SSE writer; ordering/backpressure tests). |

### 6.3 Large / only if measurements justify

| # | Change | When | Why not now |
|---:|---|---|---|
| 15 | **Per-card/column concurrency instead of one board lock** | Only if a single board must exceed ~50 commands/s or agents must edit unrelated cards with zero queueing | Deep redesign of ordering, idempotency, undo, workflow/WIP checks; the current lock is correct and cheap (3% of tx). |
| 16 | **Go/uWebSockets SSE gateway** | If, after #7/#14/#13, SSE still dominates CPU or memory | Solves only the SSE edge; the agent path is HTTP/DB. A gateway is cheaper than a full rewrite. |
| 17 | **Full Go backend rewrite** | Essentially never for this workload | 1.2–2× on the agent path if ported identically; 6–12 engineer-months; high regression risk. |
| 18 | **Fastify adapter swap** | Only if profiling shows >20% in Express middleware on a hot endpoint | Framework is <10% of the command path; multer/SSE/static rework; little gain. |
| 19 | **Worker threads/Piscina** | Only for large-board JSON serialization after read model/cache, if still >20% CPU | The hot CPU is inside a DB transaction; clone/serialization overhead; memory per worker. |

### 6.4 Options matrix (summary)

| Option | Gain on agent scale | Effort | Risk | Verdict |
|---|---|---|---|---|
| Server-side ready/work endpoint + MCP rewrite | Very high (idle load −90%) | S–M | Low | **Do first** |
| Retune board budget + MCP 429 backoff | High (removes artificial cap/429s) | S | Low–medium | **Do first** |
| Remove duplicate aggregate loads | High (1.3–2× command) | S–M | Low | **Do first** |
| TTL cache PAT/membership/flags | High (queries −30–50%) | S–M | Medium | **Do first** |
| gzip/ETag/singleflight board read | High (bytes −70%, memory −80–90%) | S–M | Medium | **Do first** |
| Per-entity CAS in MCP | Very high (kills retry storm) | M | Medium | **Do early** |
| MCP HTTP gateway | Very high for co-located swarms | M | Low–medium | **Do early** |
| Read model summary/pages/detail | Very high (structural) | L | High | **Medium-term** |
| aggregateRevision cache | Very high (5–10× command) | L | High | **Medium-term** |
| Targeted card intent endpoints | High | M–L | Medium | **Medium-term** |
| Command-log partitioning | Medium (storage/vacuum) | M–L | Medium | **Medium-term** |
| Horizontal replicas + nginx | High (CPU/HA/static) | S–M | Low–medium | **Production prerequisite** |
| Pre-serialized SSE frames | Medium | M | Medium | If SSE hot |
| Per-card concurrency | Very high single-board | XL | Very high | Only if needed |
| Go SSE gateway | Medium (SSE only) | L | Medium | Only if measured |
| Full Go rewrite | Low–medium (1.2–2×) | XL | Very high | **No** |
| Fastify adapter | Low (<10%) | M | Medium | **No** |
| Worker threads | Low | M | Medium | **No** |

---

## 7. Load-test harness and SLOs

### 7.1 What to simulate

Build a harness with two drivers:

- **HTTP/k6 driver** for raw API capacity: `GET /boards/:id`, `POST /commands`, `POST /comments`, `GET /activity`, `GET /boards/:id/ready`, `GET /events` (SSE), `GET /health`.
- **MCP driver** for the real agent path: a Node script that spawns N real `janosik-mcp` stdio processes (or N HTTP gateway sessions) and runs the tool sequence. The existing `mcp-vs-api.mjs` only does R=20 sequential; it is not a concurrency test (`docs/PERF-BASELINE.md:236-297`).

Scenarios:

| Scenario | Topology | Behavior | What it proves |
|---|---|---|---|
| **S1 idle swarm** | 100/500/1,000 agents; 1 board or 20 boards | `wait_for_work` / ready endpoint only, 5–60 s cadence | Idle polling cost, board budget, 429 rate |
| **S2 claim→comment→move** | 100/500 agents; 1/10/50 boards | Claim a ready card, add a comment, move to Done; 1 action/10–30 s | Real agent throughput, CAS conflicts, queue latency |
| **S3 mixed** | 500 agents + 50 human readers + 100 SSE | 60% reads, 30% writes, 10% comments; Watch open | CPU/memory contention, SSE fan-out |
| **S4 burst** | 1,000 agents start in 30 s | All call ready/claim at once | Thundering herd, singleflight, pool exhaustion |
| **S5 SSE ramp** | 0→5,000 streams | Open, hold 10 min, heartbeat | RSS/conn, keep-alive DB QPS, OOM point |
| **S6 read amplification** | 500 concurrent `GET /boards/:id` | 200/1,000/5,000-card boards | Transient memory per open, singleflight benefit |

Run the generator on a **separate host** from the API; do not repeat the "generators share the 16 vCPU" caveat in a capacity decision (`docs/PERF-BASELINE.md:26-30`).

### 7.2 Instrumentation

- **API:** `process.memoryUsage()` (RSS/heap/external), `monitorEventLoopDelay` histogram, `/proc/<pid>/status` VmRSS, CPU %, GC pauses (`--trace-gc`), `--cpu-prof`/`--heap-prof` for a single representative run.
- **Postgres:** enable `pg_stat_statements` (`shared_preload_libraries='pg_stat_statements'`, `track=all`), reset before each run, report top 20 by `total_exec_time` and `calls`; `pg_stat_activity` max connections/waits; `pg_stat_database` bloat/vacuum; `EXPLAIN (ANALYZE, BUFFERS)` for the board aggregate and command path.
- **Redis:** `INFO commandstats`, ops/s, memory, blocked clients; BullMQ queue depths.
- **MCP:** process count, RSS per process, tool latency, API requests per tool call, retry/409/429 counts.
- **Client:** for human UI, Playwright metrics only in a separate lane (long tasks, heap, DOM nodes), never in the agent load lane.
- **Logs:** request IDs already exist (`backend/src/common/request-context.ts`); add a per-request query count in dev or use `pg_stat_statements` deltas.

### 7.3 Target SLOs (provisional, to be confirmed by S1–S6)

| Profile | Load | SLO |
|---|---|---|
| **A. 500 agents / 20 boards** | 1 action/10 s each = 50 cmd/s; 100 req/s | p95 command < 500 ms; p95 MCP tool < 1.5 s; error rate < 1%; 429 < 0.1%; API RSS < 2 GB; PG CPU < 60%; no pool wait > 100 ms |
| **B. 1,000 agents / 50 boards** | 1 action/15 s = 67 cmd/s; 133 req/s | p95 command < 1 s; p95 MCP < 2 s; error < 1%; API RSS < 3 GB; PG CPU < 70% |
| **C. 100 agents / 1 board** | 1 action/20 s = 5 cmd/s | p95 command < 1 s; 409 retries < 5%; 429 < 0.1% |
| **D. 500 agents / 1 board** | 1 action/60 s = 8.3 cmd/s | p95 command < 2 s; no 429; no OOM; board queue wait < 500 ms |
| **E. SSE** | 3,000 concurrent streams, 10 min | RSS < 800 MB; keep-alive DB QPS < 100; fan-out p95 < 500 ms; no disconnect storm |
| **F. Read burst** | 500 concurrent 1,000-card reads | RSS < 2 GB with singleflight; p95 < 500 ms; no 5xx |

These are deliberately conservative. The single-board 500-agent profile assumes a slow cadence and the structural fixes; do not promise 500 agents on one board at 1 action/s.

### 7.4 CI gates

- Keep the existing UI `size-limit` gate (`.github/workflows/ci.yml:132-133`).
- Add a **nightly** perf job on a dedicated runner: S2 with 100 agents/1 board and 500 agents/20 boards, fail on >20% regression in p95 or actions/s versus a stored baseline.
- Add a PR smoke: 50 agents/1 board for 2 minutes, fail on 5xx/429 > 1% or p95 > 2× baseline.
- Do not run the full 500-agent suite on every PR; GitHub-hosted runners are noisy and would create false regressions.

---

## 8. Myths vs facts

| Myth | Fact for this workload |
|---|---|
| **"A Go rewrite will make it 10× faster."** | The agent path is DB + full-board reducer + JSON, not raw HTTP. Ported identically, Go is ~1.2–2×; SSE-only gains are 2–4×. A 6–12-month rewrite is not the lever. |
| **"Fastify instead of NestJS will fix throughput."** | Raw Node HTTP is ~5,600 req/s; the board endpoint is ~430 req/s and commands ~42–48/s/board. The framework is <10% of the hot path. Multer/SSE/static rework is a real cost for little gain. |
| **"React is too heavy for hundreds of agents."** | React runs only in human browsers. The critical path is 300 KB gzip; the server serves 4.2 MB of static files. The board is already virtualized (108 cards in DOM, 90 MB heap at 2,400 cards). |
| **"Worker threads will unlock concurrency."** | The hot CPU is `stableStringify`/reducer inside a Prisma transaction. Workers cannot share the transaction, and cloning a 3–17 MB board costs more than the work. Fix the algorithm/cache. |
| **"One MCP process per agent is fine."** | 108 MB × 500 = 54 GB. The MCP process has no DB pool, so it is "just" a client process — but co-locating 500 is impossible. Use an HTTP gateway. |
| **"Postgres is the bottleneck; we need read replicas."** | Queries are sub-millisecond (0.05–0.76 ms), the fixture DB is 44 MB, and Postgres CPU is ~22% while the API is ~74% on one board. The bottleneck is Node's aggregate assembly. |
| **"SSE is the agent transport and it must scale to 5,000 agents."** | Agents use HTTP/MCP; SSE is for human/oversight. 5,000 streams is ~1 GB RSS and 800–1,200 keep-alive queries/s. Give agents a summary/ready endpoint, not a full-board stream. |
| **"We have no rate limits."** | There are global, token, session and board limits. TASK-200.3 resized the board bucket to a high safety ceiling, added weighted per-token/session shares and MCP `429` retry; the remaining polling cost is a separate 200.2 fix. |
| **"Batching solves the write bottleneck."** | Batch ×5 measured 2.3–2.5×, not 5×; it does not remove the per-command reducer, two stringifications, id checks or command insert/update. |
| **"Raise the heap to 8 GB and it will be fine."** | That masks the OOM and increases GC pauses. The measured 64–131 MB per concurrent board open means 10–100 concurrent opens can exhaust any heap. Cap/singleflight/cache first. |
| **"The 8 GB WSL restarts prove the product is heavy."** | A running dev API is 123 MB; this codebase's measured cold API is 173 MB. The WSL box is carrying Docker, Astro dev (400 MB), Vite (108 MB), Vitest (415 MB) and Chromium. That is dev tooling, not production. |

---

## 9. Evidence table

| # | Claim | Evidence |
|---:|---|---|
| 1 | API is one Node process on NestJS + Express, no cluster | `backend/src/main.ts:16-28`; `backend/package.json:37-41` |
| 2 | MCP is stdio, one process per client | `mcp/src/index.ts:6,32-46` |
| 3 | MCP has no DB pool; only SDK + Zod | `mcp/package.json:49-52`; `mcp/src/client.ts:191-244` |
| 4 | MCP measured 108–113 MB RSS, 11 ms CPU/call | `docs/PERF-BASELINE.md:259-260` |
| 5 | MCP reads the full board before a command and sends board-wide `ifMatch` | `mcp/src/client.ts:434-465`; `mcp/src/tools/cards.ts:469-475` |
| 6 | `wait_for_work` polls full boards every 5 s (default) for up to 30 s | `mcp/src/tools/cards.ts:1205-1265`; `loadBoards` at `:1313-1324` |
| 7 | Board rate limit is a high safety ceiling with weighted per-token/session shares (TASK-200.3) | `backend/src/config/rate-limit.ts`; `backend/src/config/env.ts` |
| 8 | Before TASK-200.3 MCP did not retry 429; it now retries 429/queued 503 with `Retry-After` + jitter | `mcp/src/errors.ts`; `mcp/src/client.ts` |
| 9 | One-board command throughput is ~42–48/s; 290/s across 100 boards | `docs/PERF-ONE-BOARD.md:45-53,86`; `docs/PERF-BASELINE.md:39-40` |
| 10 | PAT command path can load the full aggregate three times | `backend/src/commands/commands.service.ts:404-410,568-573,694` |
| 11 | Two full-board `stableStringify` calls per command; 0.5 ms at 200 cards | `commands.service.ts:1206-1212,2471-2482`; `docs/PERF-ONE-BOARD.md:67` |
| 12 | Seven sequential `findFirst` id checks per command | `commands.service.ts:1429-1485` |
| 13 | Command row insert + update in one transaction; 9 indexes; JSON payload/result/details | `commands.service.ts:1227-1275`; `backend/prisma/schema.prisma:391-429` |
| 14 | Description diff can store 64 KB from + 64 KB to | `backend/src/commands/command-details.ts:87-98`; `shared/src/types/kanban.ts:327` |
| 15 | PAT auth is an uncached DB lookup with full user include; lastUsedAt write every 60 s | `backend/src/auth/api-token.service.ts:100-129` |
| 16 | Membership guard does board + membership lookups per request | `backend/src/common/membership.guard.ts:120-130` |
| 17 | Feature flags are explicitly uncached | `backend/src/ops/feature-flags.service.ts:12-18,38` |
| 18 | SSE keep-alive is 25 s and revalidates flags/membership/token/pause/log head | `backend/src/realtime/sse-timing.ts:9-11`; `commands/events.controller.ts:219-249,268-304`; `commands/stream-access.service.ts:34-105,114-161` |
| 19 | Nest SSE JSON-stringifies per subscriber | `node_modules/@nestjs/core/router/sse-stream.js:12-16`; `commands/events.controller.ts:128-131` |
| 20 | SSE fan-out is synchronous after commit; a description update sends an extra activity frame | `backend/src/commands/commands.service.ts:828-840` |
| 21 | Board payload 3.37 MB / 5k cards, 6.75 MB / 10k; 10 concurrent opens 809 MB / 1,479 MB | `docs/PERF-CAPACITY.md:26-37` |
| 22 | Board read holds a REPEATABLE READ transaction / pool connection | `backend/src/boards/boards.service.ts:473-494` |
| 23 | Prisma pool 10, Postgres max_connections 100, shared_buffers 256 MB, work_mem 8 MB | `backend/src/config/env.ts:142-149`; `docker-compose.yml:119-126` |
| 24 | Node heap capped at 1,024 MB; no container memory/CPU limits | `Dockerfile:60`; `docker-compose.yml:43`; compose app service has no `mem_limit`/`cpus` |
| 25 | Command retention is 30 days, chunked, not partitioned | `backend/src/ops/maintenance.service.ts:750-788` |
| 26 | Load fixture: 27k commands / 5k cards / DB 44 MB; Command ~15 MB | `~/.janosik-dev/load/LOAD-REPORT.md` §5 |
| 27 | Raw HTTP 5,600 req/s; board 430; comments 257; admin 650; live share 95 | `docs/PERF-BASELINE.md:36-46` |
| 28 | SSE 3,000 conns 703 MB post-fix; ~0.10–0.17 MB/conn | `docs/PERF-BASELINE.md:63-72` |
| 29 | UI dist 4.2 MB; critical path budget 300 KB gzip | `du -sh ui/dist`; `ui/package.json:8-22`; CI gate `.github/workflows/ci.yml:132-133` |
| 30 | Board is virtualized; 2,400 cards 108 DOM nodes / 90 MB heap / ~0.7 s | `ui/src/components/board/TableView.tsx:1,340`; `docs/PERF-BASELINE.md:164-179` |
| 31 | UI is static, served by the API; no SSR | `backend/src/common/serve-frontends.ts:58-95`; `Dockerfile:87-88` |
| 32 | No worker_threads/Piscina in the repo | grep over `backend/src`, `mcp/src`, `ui/src`, `shared/src` |
| 33 | Argon2 only on login/registration; ffmpeg is a child process; uploads stream to disk | `backend/src/auth/auth.service.ts:211,368,569`; `backend/src/attachments/media.service.ts:272`; `docs/PERF-BASELINE.md:218-234` |
| 34 | Exports are BullMQ-queued or inline only under 1,000 rows | `backend/src/admin/exports.service.ts:30-47` |
| 35 | No Prometheus metrics, no event-loop metrics, no perf CI gate | grep over `backend/src` and `package.json`; `.github/workflows/ci.yml:24-133` |
| 36 | Agent buckets are in-process/per-node; effective limits multiply with replicas | `backend/src/common/rate-limit.ts:13-16`; `backend/src/common/agent-rate-limit.interceptor.ts:27-100` |
| 37 | WSL dev box: 7,941 MB total / 2,266 used; API 123 MB, Astro 400 MB, Vite 108 MB, Vitest 415 MB, Docker 261 MB | `free -m` and `ps` on 2026-11-22 |
| 38 | `Watch` polls the activity feed every 3 s; notifications poll every 30 s | `ui/src/components/board/WatchView.tsx:27,310-323`; `ui/src/components/NotificationsBell.tsx:88-111` |

---

## 10. 30 / 60 / 90-day plan

### Days 0–30: measure and remove the agent-specific amplifiers

**Work:**

1. Build the S1/S2 harness (100/500 agents; 1/10/20 boards) and a `pg_stat_statements` profile. Record baseline p50/p95/p99, actions/s, 409/429/5xx, API RSS, event-loop lag, PG QPS/CPU.
2. Ship the server-side ready/work endpoint and rewrite `janosik_wait_for_work` to long-poll it.
3. Retune `BOARD_RATE_LIMIT` for swarms; add MCP 429/`Retry-After` handling or server-side queueing. **Done in TASK-200.3.**
4. Remove duplicate aggregate loads on the PAT command path; narrow the PAT user select.
5. Add TTL caches for PAT/membership/flags with invalidation; add `?presence=0` for agent SSE.
6. Add gzip/ETag + singleflight for board reads; add a read-concurrency semaphore.
7. Prototype the MCP HTTP gateway with token pass-through.

**Checkpoint (must be green before day 31):**

- 500 agents / 20 boards / 1 action/10 s: p95 command < 1 s, p95 MCP < 2 s, error < 1%, 429 < 0.1%.
- Idle agents: full-board reads per agent/minute reduced by **≥90%** versus today.
- Commands per agent action: DB statements reduced by **≥30%**.
- No OOM at 500 concurrent 1,000-card reads with singleflight; API RSS < 2 GB.

### Days 31–60: make reads and concurrency structural

**Work:**

1. Ship read model v1: board summary + per-column cursor windows + card detail. Keep a capability-gated full aggregate for old clients/admin/export.
2. Add per-entity preconditions in MCP (or targeted card intent endpoints) and remove board-wide CAS from the common path.
3. Add `aggregateRevision` plumbing and a per-board aggregate cache (behind a flag), with invalidation tests for comments/attachments/session-end/admin restores.
4. Ship the MCP HTTP gateway to production for co-located swarms.
5. Add 2–4 API replicas behind nginx/Caddy; move static/gzip/SSE buffering to the proxy; set `ulimits.nofile`, memory/CPU limits, and a documented `DB_CONNECTION_LIMIT` per replica.
6. Cache/pre-serialize SSE frames; guard/jitter keep-alive; measure 3,000 conns.

**Checkpoint:**

- 1,000 agents / 50 boards / 1 action/15 s: p95 command < 1.5 s, p95 MCP < 2.5 s, error < 1%, API RSS < 3 GB.
- 10 concurrent 1,000-card opens: API RSS < 1.5 GB; initial view < 2 MB / < 300 ms.
- Command throughput at 200 cards: **≥2×** baseline after duplicate-load removal + cache; target 5× by day 90.
- 3,000 SSE conns: RSS < 800 MB, keep-alive DB QPS < 100.

### Days 61–90: harden, partition, certify

**Work:**

1. Finish aggregate-revision cache and targeted write loads; add append fast path/gap positions if MOVE/ADD still miss budgets.
2. Partition or split the command log; cap stored description diffs; shorten agent retention if audit allows; add vacuum/bloat dashboards.
3. Add the nightly perf job and PR smoke gate; document SLOs and capacity per host size.
4. Certify: 500 agents / 20 boards, 1,000 agents / 50 boards, 100 agents / 1 board, 500 agents / 1 board at slow cadence, 3,000 SSE.
5. Decide on SSE gateway/Go only if measurements still show it as the top cost.

**Checkpoint (capacity certificate):**

- 500 agents / 20 boards: p95 command < 500 ms; p95 MCP < 1.5 s; 0 unexplained 429; API RSS < 2 GB.
- 1,000 agents / 50 boards: p95 command < 1 s; API RSS < 3 GB; no OOM; error < 1%.
- 100 agents / 1 board: p95 command < 1 s; 409 retries < 5%.
- 500 agents / 1 board at 1 action/60 s: p95 command < 2 s; no 429; queue wait < 500 ms.
- 3,000 SSE: RSS < 800 MB; fan-out p95 < 500 ms; no disconnect storm.
- Production 4 vCPU / 8 GB host: 500 agents / 20 boards meets the SLO with ≥30% headroom; 2 vCPU / 4 GB is documented as a smaller tier.

---

## 11. Open questions / what needs a real benchmark

1. **What is the real agent cadence?** One action per 10 s, 30 s, or 5 min? The entire capacity answer changes by 10×. Measure the actual think time of the agent harness.
2. **How many agents share one board?** 500 on one board is a different product from 500 across 50 boards. The current design is safe for the latter, marginal for the former.
3. **Do agents need SSE/presence at all?** If yes, why? A request/response MCP loop does not. If only for oversight, keep SSE human-only.
4. **Are agents co-located with the server?** If yes, the 108 MB × N MCP process cost dominates everything; an HTTP gateway is mandatory.
5. **What is the production host size and topology?** 2 vCPU / 4 GB, 4 vCPU / 8 GB, or 16 vCPU / 32 GB? Is Postgres managed/external? Is there a proxy?
6. **Can MCP tool contracts change?** Dropping board-wide `ifMatch`, adding a ready endpoint, and adding targeted card intent endpoints are the highest-leverage changes; they require agent-facing API changes.
7. **What staleness is acceptable for a board read?** A 100–500 ms cached summary is fine for a work list; a cached full board for a command CAS is not.
8. **What is the audit/retention requirement for agent commands?** 30 days at 500 agents may be hundreds of GB; 7 days or a separate cold archive may be acceptable.
9. **Do we need multi-node presence?** Commands fan out via Redis; presence is local-only (`realtime.service.ts:146-157`). If hundreds of humans watch across replicas, presence will diverge.
10. **What is the 409/retry budget?** A swarm that retries 3× on every conflict triples its read load. Need a measured conflict rate and a policy (per-entity CAS, server-resolved intents, or queueing).
11. **Is the board budget a product requirement or an arbitrary default?** TASK-200.3 treated it as a safety ceiling (`max(12000, 2 × THROTTLE_LIMIT)`) and relies on weighted per-token/session budgets + server concurrency limits.
12. **What does `pg_stat_statements` say on a real 500-agent run?** We have static query counts, not measured totals. This is the first thing the harness must capture.

---

## Appendix A — What I would do this week

1. Add `GET /boards/:id/ready` (summary only) and a 30–60 s long-poll; rewrite `janosik_wait_for_work` to use it. This is the single biggest reduction in idle load and the lowest-risk change.
2. Raise the board budget for swarm deployments and make MCP honor `Retry-After`. Without this, 100 agents already hit 429 while idle.
3. Delete the two redundant aggregate loads from the PAT command path. This is a contained code change with a measurable query-count win.
4. Put a 10–30 s TTL cache in front of PAT auth, membership and feature flags, with explicit invalidation. Narrow the PAT `include: user`.
5. Add a singleflight + gzip + ETag around `GET /boards/:id` and a read-concurrency semaphore. This prevents the 500-concurrent-read OOM without waiting for the read model.
6. Build the MCP HTTP gateway prototype. It is independent of the API changes and solves the process-memory wall.
7. Start the 500-agent harness now. Every number above is an extrapolation until it runs.

**Do not** start with Go, Fastify, React, worker threads, or a bigger heap. Those are not where the measured cost is.

---

## Appendix B — Method and limitations

- Read-only inspection of `backend/src`, `mcp/src`, `ui/src`, `shared/src`, `backend/prisma/schema.prisma`, `docker-compose.yml`, `Dockerfile`, `.github/workflows/ci.yml`, `docs/PERF-*.md`, and the external `~/.janosik-dev/load/` artifacts.
- Light shell measurements only: `free -m`, `ps`, `du -sh`, `git log`, `grep`, file reads. No product code, database, Docker stack, browser, or test suite was run.
- The 100/500/1,000 rankings are **capacity estimates** built from measured unit costs (payload/card, transient memory/open, commands/s, queries/connection/tick). They are not a substitute for the S1–S6 harness.
- The checkout is HEAD `30d1fb13`, not `33b83b18`; some line numbers may drift by a few lines on a different commit. The architectural conclusions are stable across the recent history because the command, aggregate, SSE and MCP code paths have not changed shape.
- External load artifacts (`~/.janosik-dev/load/`) are not in git; they are cited by section because they are the only source of the 27k-command/44 MB fixture and the combined-run numbers.
