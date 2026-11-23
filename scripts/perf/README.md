# Agent-scale perf harness (TASK-200.1)

Reproducible S1–S6 driver for
[`docs/PERF-AGENT-SCALE.md`](../../docs/PERF-AGENT-SCALE.md) §7 and
[`docs/TASK-200-agent-scale-performance.md`](../../docs/TASK-200-agent-scale-performance.md)
§200.1. It drives the **real HTTP agent path** with PATs:

`GET /boards/:id` → `CLAIM_CARD` → `POST /cards/:id/comments` → `MOVE_CARD`,
plus idle polling, human readers, SSE and read bursts.

It is a measurement harness, not a capacity certificate. Run the generator on
a host separate from the API; otherwise the generator competes for the same
CPU and memory that you are trying to measure.

## Quick start (no Docker)

```bash
npm run perf:smoke      # mock API, 2 agents, S1/S2/S3/S6, ~15 s
npm run perf:test       # node --test for config/metrics/report/agent/probes/pg
npm run perf:lint       # ESLint for scripts/perf + root config
```

`perf:smoke` starts an in-process mock API on an ephemeral port and writes a
JSON + Markdown report under the OS temp directory (`janosik-perf/`). Mock
numbers only prove the harness works; they are not a product baseline.

## One-command baseline

```bash
export JANOSIK_PERF_TOKEN="jnk_…"       # repeat/comma-separate for a PAT pool
npm run perf:agents -- \
  --scenario S2 \
  --base-url http://api.perf.internal:3000/api/v1 \
  --board <board-id> \
  --agents 100 --cadence 10s --duration 2m \
  --label baseline-100-agents
```

The report records the commit (`HEAD` + branch + dirty flag), effective
config, p50/p95/p99, actions/s, cycles, 409/429/5xx, requests/agent/min,
bytes/response, API RSS/heap/event-loop lag and optional top
`pg_stat_statements` queries.

Default output: `scripts/perf/results/agent-scale-<UTC>.json` and `.md`.
Choose a path with `--output path/to/run.json` (Markdown is written beside it).

### Scenario profiles

| Id | Profile | Default load |
| --- | --- | --- |
| `S1` | Idle swarm | 100 agents, 1 full-board read / 30 s |
| `S2` | Claim → comment → move | 100 agents, 1 cycle / 10 s |
| `S3` | Mixed humans + SSE | 500 agents + 50 readers + 100 streams |
| `S4` | Burst start | 1,000 agents started over 30 s |
| `S5` | SSE ramp | 0→3,000 streams over 5 min, hold 10 min |
| `S6` | Read burst | 500 concurrent board reads |
| `all` | S1–S6 | dedicated host only |
| `smoke` | S1/S2/S3/S6 small | 2 agents, in-process mock |

`--scenario` is required for a real run; a bare `perf:agents` prints usage.
Defaults come from the docs. Override per run with `--agents`, `--humans`,
`--sse`, `--cadence`, `--duration`, `--ramp`, `--hold`, `--concurrency`,
`--repeats`, `--jitter`, `--lease-ms`.

### Baseline command set for a dedicated run

Run each profile separately so a failure cannot poison the next baseline:

```bash
# A/C/D — one board, 100 agents
npm run perf:agents -- --scenario S2 --board "$BOARD" --agents 100 --duration 5m \
  --output scripts/perf/results/baseline-S2-100.json

# A — 500 agents / 20 boards (select the first 20 accessible boards)
npm run perf:agents -- --scenario S2 --boards 20 --agents 500 --cadence 10s \
  --duration 10m --output scripts/perf/results/baseline-S2-500x20.json

# E — SSE ramp, no agents
npm run perf:agents -- --scenario S5 --sse 3000 --ramp 5m --hold 10m \
  --api-pid "$API_PID" --output scripts/perf/results/baseline-S5-3000.json

# F — read burst
npm run perf:agents -- --scenario S6 --boards 1 --concurrency 500 \
  --api-pid "$API_PID" --output scripts/perf/results/baseline-S6-1000cards.json

# idle swarm before/after 200.2
npm run perf:agents -- --scenario S1 --board "$BOARD" --agents 500 --cadence 30s \
  --duration 10m --output scripts/perf/results/baseline-S1-500.json
```

For a 1,000-card S6 board, seed the board first; the harness does not mutate
board contents except through the agent cycle. Use a **dedicated, migrated**
dev database.

## PAT and board selection

- `--token` (repeatable/comma-separated) or `JANOSIK_PERF_TOKEN` / `PERF_TOKEN`.
- Without `--board`, the harness lists `GET /boards` and takes the first
  `--boards <n>` (default 1). With `--board`, no list request is made.
- Agents are distributed round-robin over the token pool and boards. Each
  token is resolved with `GET /auth/me` to get its user id for `CLAIM_CARD`.
- Tokens are never written to the report; only `tokenCount`.

## API instrumentation

Optional and independent of the load driver:

```bash
# RSS + heap + event-loop lag, sampled inside the API process
PERF_API_PROBE_FILE=/tmp/janosik-api-probe.jsonl \
PERF_API_PROBE_INTERVAL_MS=1000 \
node --import ./scripts/perf/api-preload.mjs backend/dist/main.js

npm run perf:agents -- --scenario S2 … \
  --api-probe /tmp/janosik-api-probe.jsonl

# or, read-only RSS from /proc on the same Linux host
npm run perf:agents -- --scenario S2 … --api-pid 12345
```

`api-preload.mjs` is a no-op unless `PERF_API_PROBE_FILE` is set; it adds no
endpoint and changes no product code. Without either option the report shows
`api.source = "none"`. Generator RSS/event-loop lag is always sampled and is
labelled `generator`, never `api`.

### PostgreSQL top queries

```bash
npm run perf:agents -- --scenario S2 … \
  --pg-url postgresql://janosik:…@db.perf.internal:5432/janosik
```

This shells out to `psql` (no npm dependency) and reads the top 20 statements
by `total_exec_time` from `pg_stat_statements`. Enable it beforehand
(`shared_preload_libraries='pg_stat_statements'`) and reset it before a
baseline with `SELECT pg_stat_statements_reset();`. If `psql` or the extension
is missing, the report says so instead of failing the run.

## What is intentionally not run here

- No 100/500/1,000-agent run is executed by this PR; the WSL/UI slot is busy.
- No Docker, Playwright, browser or UI metrics (human UI belongs in a separate
  lane, per §7.2).
- No MCP stdio process swarm: TASK-200.1 specifies an HTTP/PAT agent loop;
  real MCP stdio/HTTP sessions belong to 200.8 and the MCP release check.
- S1 currently measures the full-board read. `--idle-endpoint ready` is wired
  for the 200.2 endpoint; on a 404 it falls back to the full board (and the
  fallback read is counted).
- Mock runs are correctness smoke only.

## Files

```
scripts/perf/
  agent-scale.mjs        CLI: config → health/auth/boards → scenarios → report
  api-preload.mjs        optional in-process API probe (RSS/heap/loop lag)
  lib/config.mjs         pure CLI/env parsing, scenario defaults, redaction
  lib/agent.mjs          claim→comment→move loop + pure board helpers
  lib/http.mjs           PAT client, SSE reader, measured requests
  lib/scenarios.mjs      S1–S6 orchestration
  lib/metrics.mjs        percentiles, status/error counters, rates
  lib/probes.mjs         /proc + preload JSONL + generator sampler
  lib/report.mjs         JSON and Markdown rendering
  lib/mock-server.mjs    deterministic mock API for smoke mode
  lib/pg.mjs             optional pg_stat_statements via psql
  lib/git.mjs            commit/branch/dirty + environment metadata
  *.test.mjs             node --test coverage for the pure helpers
```

## Interpreting results

- p50/p95/p99 are per HTTP request across the whole scenario; the operation
  table breaks them down (board read, claim, comment, move, SSE open).
- `409` is the real CAS conflict rate; a cycle retries once after rereading
  the board. `429` is the board/global rate limit.
- `actions/s` counts successful writes (claim + comment + move = 3 per cycle),
  not cycles. `cycles` counts completed claim→comment→move sequences.
- `requests/agent/min` uses wall-clock time, so ramp and cleanup are included.
- For S5, `sse.maxConcurrent` is the peak open streams; failures (e.g. the
  server's admission ceiling returning 503) are counted, not hidden.
