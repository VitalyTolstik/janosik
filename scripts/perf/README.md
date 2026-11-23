# Agent-scale perf harness (TASK-200.1)

Reproducible S1–S6 driver for
[`docs/PERF-AGENT-SCALE.md`](../../docs/PERF-AGENT-SCALE.md) §7 and
[`docs/TASK-200-agent-scale-performance.md`](../../docs/TASK-200-agent-scale-performance.md)
§200.1. It drives the **real HTTP agent path** with PATs:

`GET /boards/:id` → `CLAIM_CARD` → `POST /cards/:id/comments` → `MOVE_CARD`,

plus idle polling, human readers, SSE, read bursts, and an optional real MCP
stdio driver (`ready → claim → comment → move`).

It is a measurement harness, not a capacity certificate. Run the generator on
a **host separate from the API**. On this 8 GB WSL dev box the UI, site and
Docker compete for the same CPU and memory, so a same-host run only proves the
harness works — it is not a product baseline.

## Quick start (no Docker)

```bash
npm run perf:smoke       # mock API, 2 agents, S1/S2/S3/S6, ~10 s
npm run perf:mcp-smoke   # 1 real MCP stdio process against the mock, ~3 s
npm run perf:test        # node --test helpers + validator/MCP/real-mode integration
npm run perf:lint        # ESLint for scripts/perf + root config
```

`perf:smoke` starts an in-process mock API. The out-of-process real-mode test
runs `mock-server-main.mjs` on a separate port and spawns the CLI exactly as a
real baseline would. Mock numbers only prove the harness works; they are never
a product baseline. In smoke mode the harness ignores `JANOSIK_PERF_BOARDS`,
`JANOSIK_PERF_PG_URL` and `JANOSIK_PERF_REDIS_URL`, uses one mock board, and
caps agent/human/SSE/concurrency/duration overrides (`SMOKE_CAPS` in
`lib/config.mjs`) so `--mock --agents 1000 --duration 1h` cannot become a
heavy run by accident.

## Real baseline

```bash
export JANOSIK_PERF_TOKEN="jnk_…"       # one per agent; repeat/comma-separate a pool
npm run perf:agents -- \
  --scenario S2 \
  --base-url http://api.perf.internal:3000/api/v1 \
  --board <board-id> \
  --agents 100 --cadence 10s --duration 2m \
  --shared-identity \
  --label baseline-100-agents
```

`--shared-identity` is only for a transport/harness run where one identity is
acceptable; a real agent baseline should pass 100 PATs instead.

Required token/board profile:

- The PAT must be a **board ADMIN or MEMBER** (`VIEWER` can read but cannot
  write commands or comments) with a preset that allows command writes.
- The board must exist, be accessible and **not archived**. Explicit `--board`
  ids are preflighted with `GET /boards/:id`; a 401/403 stops the suite before
  any load. Without `--board`, the first `--boards <n>` accessible,
  non-archived boards are used.
- Seed enough non-Done cards. S2/S3/S4 move one card per completed cycle; a
  small board drains in seconds. The harness now reports that as `partial` (or
  `failed` when zero cycles completed) instead of a green run. Either seed
  `agents × cycles × 2` cards, or pass `--recycle` (below).
- For S2/S3/S4 the default is one token/identity per agent. Use
  `--shared-identity` only when the run intentionally models several agents
  behind one identity.

Token precedence is `--token` > `JANOSIK_PERF_TOKEN` > `PERF_TOKEN`; the pool
is deduplicated and only `tokenCount` reaches the report.

Default output: `scripts/perf/results/<YYYY-MM-DD>-<sha>/<mode>-<scenarios>-<driver>-<HHMMSS>.json`
and `.md` beside it. New result directories are gitignored. Use `--output` to
override; Markdown is written beside the JSON.

## Scenario profiles

| Id | Profile | Default load |
| --- | --- | --- |
| `S1` | Idle swarm | 100 agents, one full-board read / 30 s |
| `S2` | Claim → comment → move | 100 agents, one cycle / 10 s |
| `S3` | Mixed humans + SSE | 500 agents + 50 readers + 100 streams |
| `S4` | Burst start | 1,000 agents; 30 s ramp, then a **30 s work window** |
| `S5` | SSE ramp | 0 → **5,000** streams over 5 min, hold 10 min |
| `S6` | Read burst | 500 concurrent board reads |
| `all` | S1–S6 | dedicated host only |
| `smoke` | S1/S2/S3/S6 small | requires `--mock` |

`--scenario` is required. A bare `perf:agents` and `--scenario smoke` without
`--mock` exit 2 with an error instead of printing usage and exiting 0. A mock
run (`--mock`) defaults to the smoke profile.

### S3 mix and Watch cadence

S3 implements the documented agent-action mix — **60% reads / 30% writes /
10% comments** — with `--mix r/w/c` to override (percentages or fractions).
The report shows the **actual** counts and shares. Humans read the board on a
**3 s Watch cadence** (`--watch-cadence`), and every third beat also reads
activity. A write beat is claim + move (two action writes); a comment beat is
one comment; a read beat is one board read. Because every write/comment beat
also needs a board read, the HTTP request table is read-heavier than the
action mix.

### S4 burst semantics

`--duration` is the work window **after** the ramp. With `--burst` (the
default) all workers synchronise at the end of the 30 s ramp and start
together; without it they are staggered across the ramp. The report contains
the observed work window, so a ramp overrun or an early abort is visible.

### S5 hold semantics

The hold starts when the ramp **actually completes**, not at the planned
boundary. The report shows the observed ramp and hold durations. A run with no
live stream is `failed`, not a successful empty ramp.

### Board recycling

```bash
npm run perf:agents -- --scenario S2 --board "$BOARD" --agents 100 --duration 5m \
  --recycle --recycle-token "$JANOSIK_PERF_RECYCLE_TOKEN"
```

`--recycle` moves Done cards back to the first column when an agent finds no
work. It needs a **dedicated board ADMIN PAT** (`--recycle-token` or
`JANOSIK_PERF_RECYCLE_TOKEN`); its requests are measured in a separate
`recycle` block and are excluded from agent action counts. There is no
implicit fallback to an agent token in real mode. Recycling is limited to the
first board.

## Commands

All S2/S3/S4 examples assume a token pool matching the agent count; add
`--shared-identity` (and accept the identity-sharing caveat) if you only have
one PAT.

```bash
# A/C/D — one board, 100 agents
npm run perf:agents -- --scenario S2 --board "$BOARD" --agents 100 --duration 5m

# A — 500 agents / 20 boards
npm run perf:agents -- --scenario S2 --boards 20 --agents 500 --cadence 10s --duration 10m

# S3 — agents + humans + SSE
npm run perf:agents -- --scenario S3 --board "$BOARD" \
  --agents 500 --humans 50 --sse 100 --mix 60/30/10 --watch-cadence 3s

# S4 — thundering herd; 30 s ramp then a 30 s work window
npm run perf:agents -- --scenario S4 --board "$BOARD" \
  --agents 1000 --ramp 30s --duration 30s

# E — SSE ramp, no agents (hold starts after the real ramp)
npm run perf:agents -- --scenario S5 --sse 5000 --ramp 5m --hold 10m --api-pid "$API_PID"

# F — read burst
npm run perf:agents -- --scenario S6 --boards 1 --concurrency 500 --api-pid "$API_PID"

# S1 — idle swarm
npm run perf:agents -- --scenario S1 --board "$BOARD" --agents 500 --cadence 30s --duration 10m

# MCP stdio, small smoke / dedicated host for a larger run
npm run perf:agents -- --scenario S2 --driver mcp --agents 2 --mock --duration 2s
npm run perf:agents -- --scenario S2 --driver mcp --agents 20 --board "$BOARD" --duration 2m
```

For a 1,000-card S6 board, seed the board first; the harness does not mutate
board contents except through the agent cycle (and explicit `--recycle`). Use
a **dedicated, migrated** dev database. Reset before a baseline with your
normal seed/reset procedure; the harness itself never truncates a board.

## Status and exit codes

Every scenario is `ok`, `partial`, `failed` or `interrupted` in JSON and
Markdown; the report has an overall status and counts.

- `ok` — every configured worker measured work.
- `partial` — work happened, but the board exhausted/stranded a claim, a
  network error occurred, or the S4 work window was under half the request.
- `failed` — zero requests, zero work cycles, no SSE stream, or fatal
  auth/preflight.
- `interrupted` — SIGINT/SIGTERM.

Exit codes: `0` ok/partial, `1` failed or zero-work, `2` config/preflight
(including 401/403 and a board that is missing/archived), `130` interrupted.
`429` and `5xx` are **data**: they are reported and rate-labelled but do not
turn an otherwise measured run into a failure. The first Ctrl-C cancels
in-flight HTTP and psql, then writes a partial report; a second Ctrl-C exits
130 immediately.

## API instrumentation

```bash
# RSS + heap + event-loop lag, sampled inside the API process
PERF_API_PROBE_FILE=/tmp/janosik-api-probe.jsonl \
PERF_API_PROBE_INTERVAL_MS=1000 \
node --import ./scripts/perf/api-preload.mjs backend/dist/main.js

npm run perf:agents -- --scenario S2 … --api-probe /tmp/janosik-api-probe.jsonl

# or read-only RSS from /proc on the same Linux host
npm run perf:agents -- --scenario S2 … --api-pid 12345
```

`api-preload.mjs` is a no-op unless `PERF_API_PROBE_FILE` is set; it adds no
endpoint and changes no product code. A partial JSONL tail is retained until
the next poll, and the warm-up sample no longer injects a fake zero lag.
Without either option the report shows `api.source = "none"`. Generator
RSS/event-loop lag is always sampled and labelled `generator`, never `api`.

### CPU profile (Top-10 self time)

```bash
node --cpu-prof --cpu-prof-dir /tmp/janosik-cpu backend/dist/main.js
npm run perf:agents -- --scenario S2 … --cpu-profile /tmp/janosik-cpu
```

A directory is scanned for `.cpuprofile` files; the report aggregates the
newest set by function and prints a Top-10 self-time table. This is a profile
of the API process, run for one representative scenario, not a per-request
trace.

### PostgreSQL

```bash
export PGPASSWORD=…          # or use ~/.pgpass; never put it in --pg-url
npm run perf:agents -- --scenario S2 … \
  --pg-url postgresql://perf@db.perf.internal:5432/janosik \
  --pg-activity --pg-activity-interval 2s
```

Setup on the database host:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';  -- restart
ALTER SYSTEM SET pg_stat_statements.track = 'all';                  -- restart
-- the reporting role needs to read statements from other roles:
GRANT pg_read_all_stats TO perf;
SELECT pg_stat_statements_reset();                                  -- before a baseline
```

The harness shells out to `psql` (no npm dependency). It takes a
`pg_stat_statements` snapshot before and after every scenario, computes deltas
by `queryid` scoped to `current_database()`, and reports **Top-20 by calls and
Top-20 by total_exec_time**. Internal `pg_stat_*` sampler queries are excluded.
`--pg-activity` samples `pg_stat_activity` states and wait events (peak per
state) for the current database. If `psql` or the extension is missing, the
report says so instead of failing the run.

The URL's userinfo is stripped from argv and from every report. The password
travels via `PGPASSWORD` (or `.pgpass`); `psql` child-process errors are
sanitized and never include the command line or DSN.

### Redis

```bash
npm run perf:agents -- --scenario S2 … \
  --redis-url redis://redis.perf.internal:6379/0 \
  --redis-cli redis-cli
```

Takes start/end `INFO` samples and reports memory (used/peak/max), connected
and blocked clients, instantaneous ops/s, rejected connections, keyspace
hits/misses and hit rate. The password goes through `REDISCLI_AUTH`; the URL is
redacted in reports.

### MCP stdio driver

`--driver mcp` spawns N real `janosik-mcp` stdio processes over
`mcp/src/index.ts` (via the repo's `tsx`), pointed at the API origin with
`JANOSIK_URL`/`JANOSIK_TOKEN`. Each process runs
`janosik_list_ready_cards → janosik_claim_card → janosik_add_comment →
janosik_move_card`; the harness counts `tools/call` requests, per-tool latency,
cycles/actions and child RSS/peak RSS from `/proc/<pid>/status`. The same
scenarios, statuses and report are used. S1/S2/S3/S4 use MCP workers for the
agents (S3 keeps HTTP humans/SSE); S5/S6 remain HTTP-only because they measure
connections and raw board reads. Smoke mode caps the process count at
2; a large MCP swarm is a dedicated-host capacity experiment.

## Secrets and redaction

- PATs are never written to stdout, JSON or Markdown; only `tokenCount`.
- `--base-url`, `--pg-url` and `--redis-url` are stripped of userinfo before
  they reach logs or reports; sensitive query parameters are redacted.
- PostgreSQL/Redis child processes receive passwords via environment variables
  (`PGPASSWORD`, `REDISCLI_AUTH`), never argv.
- Child-process stderr and fetch errors are sanitized (`safeChildError`,
  `sanitizeText`); `execFile`'s argv-bearing `error.message` is not reported.
- Leak tests assert that stdout, JSON and Markdown contain neither a token nor
  a URL password.

## Files

```
scripts/perf/
  agent-scale.mjs        CLI: config → preflight → scenarios → report
  mock-server-main.mjs   standalone mock for the out-of-process real-mode test
  api-preload.mjs        optional in-process API probe (RSS/heap/loop lag)
  validator-check.ts     runs harness actions through the shared validator
  lib/config.mjs         pure CLI/env parsing, defaults, validation, redaction
  lib/agent.mjs          claim→comment→move, S3 mix, recycle, board helpers
  lib/http.mjs           PAT client, signal/timeout composition, measured requests
  lib/scenarios.mjs      S1–S6 orchestration and real deadlines
  lib/metrics.mjs        percentiles, status/error/mix counters, rates
  lib/probes.mjs         /proc + preload JSONL + generator sampler
  lib/cpuprofile.mjs     .cpuprofile → Top-10 self-time table
  lib/pg.mjs             pg_stat_statements deltas + pg_stat_activity sampler
  lib/redis.mjs          Redis INFO sampling + deltas
  lib/mcp.mjs            real MCP stdio processes and tool-call metrics
  lib/report.mjs         JSON and Markdown rendering (escaped/redacted)
  lib/mock-server.mjs    command-contract-accurate mock API
  lib/redact.mjs         URL/secret sanitizers
  lib/status.mjs         ok/partial/failed/interrupted rules
  *.test.mjs             node --test coverage + real-mode/MCP mock smoke
```

## Reading the numbers

- p50/p95/p99 are per HTTP request across the scenario's **measurement
  window**; the operation table breaks them down.
- `409` is a measured CAS conflict; `429` is the board/global rate limit;
  `5xx` and network errors have separate columns and rates. A successful
  claim/comment/move is counted immediately, so a later 429 cannot erase it.
- `actions/s` counts successful writes (claim + comment + move = 3 per S2/S4
  cycle), not cycles. `cycles` counts completed write sequences. `no work`
  counts cycles that found no unleased card.
- `requests/agent/min` uses the measured window, independent of worker drain.
- For S5, `sse.maxConcurrent` is the peak open streams, and the observed ramp
  and hold durations are reported separately.
- WSL/dev-box caveat: never compare a same-host mock/dev run to a dedicated
  host baseline; run the generator on its own machine and keep the UI/Docker
  stack off it.

## What is intentionally not run here

- No real 100/500/1,000-agent baseline is executed by the test suite. PR tests
  use the in-process or out-of-process mock and a 1–2 process MCP smoke only.
- No Docker, Playwright, browser, or UI metrics. Human UI work belongs in a
  separate lane (docs/PERF-AGENT-SCALE.md §7.2).
- No heavy MCP swarm in CI. `--driver mcp` can spawn N processes, but the
  nightly gate and `perf:mcp-smoke` cap smoke runs at two.
- S1 measures the full-board read by default. `--idle-endpoint ready` is wired
  for the 200.2 endpoint; on a 404 it falls back to the full board (and the
  fallback read is counted).

## Nightly CI

[`.github/workflows/perf-nightly.yml`](../../.github/workflows/perf-nightly.yml)
runs `perf:lint`, `perf:test`, `perf:smoke` and `perf:mcp-smoke` on a manual
dispatch or nightly schedule. It uses the mock only, never secrets, and
uploads the ignored result directory as an artifact.
