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
`JANOSIK_PERF_PG_URL` and `JANOSIK_PERF_REDIS_URL`, caps mock board/card sizes
(`MOCK_LIMITS`) and agent/human/SSE/concurrency/duration overrides
(`SMOKE_CAPS` in `lib/config.mjs`) so `--mock --agents 1000 --duration 1h`
cannot become a heavy run by accident. Each smoke scenario starts from a fresh
mock board, so S2 cannot drain the S3 run. The standalone
`mock-server-main.mjs` applies the same `MOCK_LIMITS`. The mock accepts
`MOCK_COMMAND_STATUS`, `MOCK_COMMENT_STATUS` and `MOCK_SSE_STATUS` for
failure-injection tests.

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
acceptable; a real agent baseline should pass 100 PATs instead. The API URL
itself must be credential-free (or supplied through a PAT, not basic auth):
Node fetch rejects URL userinfo.

Required token/board profile:

- The PAT must be a **board ADMIN or MEMBER** (`VIEWER` can read but cannot
  write commands or comments) with a preset that allows command writes.
  Preflight validates **every** token's `/auth/me` identity (must be a PAT,
  not read-only, not paused, scope `worker`/`reviewer`/`admin`) before load.
- The board must exist, be accessible and **not archived**. Explicit `--board`
  ids are preflighted on the first token and then matched against every token's
  `GET /boards` membership/role. Any failure exits `2` with the token index,
  board index and id. Without `--board`, the first `--boards <n>` accessible,
  non-archived boards of token 1 are selected, and every other token must also
  be an ADMIN/MEMBER of each.
- Basic-auth URLs are not supported: Node `fetch`/undici **rejects** URLs that
  contain userinfo, so a credential-bearing `JANOSIK_PERF_BASE_URL`/
  `--base-url-file` value will fail preflight even though it is accepted (and
  redacted) for safety. Use a PAT `Authorization` header. PostgreSQL/Redis
  URLs may carry credentials because the harness uses those values for
  `PGPASSWORD`/`REDISCLI_AUTH` rather than Node fetch.
- Seed enough non-Done cards. S2/S3/S4 move one card per completed cycle; a
  small board drains in seconds. The harness now reports that as `partial` (or
  `failed` when zero cycles completed) instead of a green run. Either seed
  `agents × cycles × 2` cards, or pass `--recycle` (below).
- For S2/S3/S4 the default is one token/identity per agent. With
  `--driver mcp` the requirement is the **actual MCP worker count**
  (`--mcp-processes`, or agents when unset; smoke caps at 2), not the
  `--agents` label. S3 always uses the HTTP driver. Use `--shared-identity`
  only when the run intentionally models several agents behind one identity.

Token precedence is `--token-file` > `JANOSIK_PERF_TOKEN` > `PERF_TOKEN`; the
pool is deduplicated and only `tokenCount` reaches the report. `--token` is
rejected because argv is visible through `/proc/<pid>/cmdline`. The same rule
applies to URLs: a credential-bearing `--base-url`, `--pg-url` or `--redis-url`
is rejected; use `JANOSIK_PERF_BASE_URL`/`JANOSIK_PERF_PG_URL`/
`JANOSIK_PERF_REDIS_URL` or the matching `--*-file` option instead.

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
action mix. `--mix 100/0/0` is a valid read-only profile and is not failed just
because it completes no write cycles.

### S4 burst semantics

`--duration` is the work window **after** the ramp. With `--burst` (the
default) all workers synchronise at the end of the ramp at an absolute start
time and start together; `--no-burst` staggers them across the ramp. The
report contains the observed work window (`plannedWorkStartedAt` vs the min
first-request `actualWorkStartedAt`), so a ramp overrun or an early abort is
visible.

### S5 hold semantics

The hold starts when the ramp **actually completes**, not at the planned
boundary. Each open has a 10 s header timeout and the whole scenario has a
bounded ramp+hold deadline. The report shows opened/closed/failed/early
closes/read errors, live streams at hold start/end, and the observed ramp and
hold durations. No live stream is `failed`; one opened stream with thousands of
failures is at least `partial`. S3 checks its own SSE hold the same way. If the
overall timer fires, the scenario is `timedOut`: it is `partial` when at least
one live hold started, and `failed` when the deadline expired before any hold;
the Markdown reason names the truncation.

### Board recycling

```bash
export JANOSIK_PERF_RECYCLE_TOKEN="jnk_admin_…"   # board ADMIN; or --recycle-token-file
npm run perf:agents -- --scenario S2 --board "$BOARD" --agents 100 --duration 5m \
  --recycle
```

`--recycle` moves Done cards back to the first column when an agent finds no
work. It needs a **dedicated board ADMIN PAT** (`JANOSIK_PERF_RECYCLE_TOKEN`
or `--recycle-token-file`); its requests are measured in a separate
`recycle` block and are excluded from agent action counts. There is no
implicit fallback to an agent token in real mode. Recycling is limited to the
selected boards, each with its own recycler. A release answered with 400/409
is a tolerated no-holder case: the card is still moved back and is not counted
as an orphan. Other release failures stop that board's recycler and are
surfaced as orphans in the scenario status/report.

## Commands

All S2/S3/S4 examples assume a token pool matching the agent count; add
`--shared-identity` (and accept the identity-sharing caveat) if you only have
one PAT.

```bash
# A/C/D — one board, 100 agents
npm run perf:agents -- --scenario S2 --board "$BOARD" --agents 100 --duration 5m --api-pid "$API_PID"

# A — 500 agents / 20 boards
npm run perf:agents -- --scenario S2 --boards 20 --agents 500 --cadence 10s --duration 10m --api-pid "$API_PID"

# S3 — agents + humans + SSE
npm run perf:agents -- --scenario S3 --board "$BOARD" \
  --agents 500 --humans 50 --sse 100 --mix 60/30/10 --watch-cadence 3s --api-pid "$API_PID"

# S4 — thundering herd; 30 s ramp then a 30 s work window
npm run perf:agents -- --scenario S4 --board "$BOARD" \
  --agents 1000 --ramp 30s --duration 30s --api-pid "$API_PID"

# E — SSE ramp, no agents (hold starts after the real ramp).
# One PAT opening 5,000 streams hits the default per-user cap. Set these on
# the API host (the API process environment), not on the harness command:
#   SSE_MAX_PER_USER=0 SSE_MAX_CONNECTIONS=5000 node backend/dist/main.js
npm run perf:agents -- --scenario S5 --sse 5000 --ramp 5m --hold 10m --api-pid "$API_PID"

# F — read burst
npm run perf:agents -- --scenario S6 --board "$BOARD" --concurrency 500 --api-pid "$API_PID"

# S1 — idle swarm
npm run perf:agents -- --scenario S1 --board "$BOARD" --agents 500 --cadence 30s --duration 10m --api-pid "$API_PID"

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

- `ok` — successful 2xx work was measured; expected 409/429 are data.
- `partial` — successful work happened, but the board exhausted/stranded a
  claim, a claim release was orphaned, an S5 stream failed, the network
  degraded, a scenario/SSE deadline truncated a run that had a live hold, or
  unexpected 4xx/server 5xx crossed the documented thresholds
  (`server5xxRate > 1%` or ≥5; `unexpected4xxRate > 0.1%` or ≥5), or the S4
  work window was under half the request.
- `failed` — zero successful 2xx responses, zero requests, zero required work
  cycles (except a timed-out S3 run with a live SSE hold, which is `partial`),
  no SSE stream, or fatal auth/preflight.
- `interrupted` — SIGINT/SIGTERM.

`Err %` / `Unexp %` excludes expected `409`, `429` and claim-lease `400`
conflicts; the report shows their separate counts and rates. Exit codes: `0`
ok/partial, `1` failed or
zero-work, `2` config/preflight (including 401/403 and a board that is
missing/archived), `130` interrupted. `--require-ok` turns `partial` into exit
`1`; it is recorded in `config.requireOk` in the report, and `perf:smoke` and
`perf:mcp-smoke` use it. The first Ctrl-C cancels in-flight HTTP
and psql, writes a partial report (including a minimal preflight report if the
load has not started) and exits `130`; a second Ctrl-C exits `130` immediately
without waiting.

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
RSS/event-loop lag is always sampled and labelled `generator`, never `api`;
probe-file read errors and S5 opened/failed counts are surfaced in Markdown.
The preload JSONL `ts` uses the **API host clock**; window filtering assumes
reasonably synchronized clocks. On separate hosts use NTP or prefer
`--api-pid` sampling if the clocks cannot be trusted.

### CPU profile (Top-10 self time)

**Live inspector (recommended while the API keeps running):**

```bash
node --inspect=127.0.0.1:9229 backend/dist/main.js
# read the websocketDebuggerUrl from:
curl -s http://127.0.0.1:9229/json/list
npm run perf:agents -- --scenario S2 … \
  --api-inspect ws://127.0.0.1:9229/<uuid> \
  --cpu-profile /tmp/api.cpuprofile
```

The harness starts `Profiler.start` before the scenarios and stops/writes the
profile afterwards. A failed inspector start still runs the load and writes a
report marked `failed`; a missing, stale or failed live profile does the same
and names the reason. The inspector socket is closed on every failure path.

**Two-step static profile:** `node --cpu-prof` writes only when the API exits,
so run the load with a normal report first, stop the API, then attach the
profile without re-running the load:

```bash
node --cpu-prof --cpu-prof-dir /tmp/janosik-cpu backend/dist/main.js
npm run perf:agents -- --scenario S2 … --output /tmp/run/S2.json
# stop the API; this writes /tmp/janosik-cpu/*.cpuprofile
npm run perf:agents -- --report-only /tmp/run/S2.json \
  --cpu-profile /tmp/janosik-cpu
```

`--report-only` re-renders the existing JSON/Markdown in place (or at
`--output`) and performs no API calls. A missing/unreadable profile exits `1`.

A directory is scanned for `.cpuprofile` files; files within 60 s of the
newest mtime are treated as one run, **all their nodes are aggregated**, and
only then is the Top-10 self-time table taken. This is a profile of the API
process, run for one representative scenario, not a per-request trace.
Freshness is enforced only for the live inspector flow: a static profile is
legitimately written when the API exits, so it is not compared with the
harness start time.

### PostgreSQL

```bash
export PGPASSWORD=…          # or use ~/.pgpass; never put it in --pg-url
npm run perf:agents -- --scenario S2 … \
  --pg-url postgresql://perf@db.perf.internal:5432/janosik \
  --pg-activity --pg-activity-interval 2s
```

`--pg-url` must be credential-free. Put a password-bearing DSN in
`JANOSIK_PERF_PG_URL` or a `--pg-url-file`; argv credentials are rejected
before the load starts.

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
`pg_stat_statements` snapshot (up to 1,000 queryids) before and after every
scenario, computes deltas by `queryid` scoped to `current_database()` — new
after-only queryids included — and reports **Top-20 by calls and Top-20 by
total_exec_time**, total calls, total exec time and `queries/command` (query
statements per successful agent action). Internal `pg_stat_*` sampler queries
are excluded.
`--pg-activity` samples `pg_stat_activity` states and wait events (peak per
state) for the current database; it warns and skips if `--pg-url` is missing.
If `psql` or the extension is missing, the report says so instead of failing
the run.

The URL's userinfo and secret query parameters (any key containing
`password`, `passwd`, `pwd`, `secret`, `token`, `key` or `auth`, e.g.
`sslpassword`, `client_secret`, `x-api-key`) are stripped from argv and every
report. Standard `password`/`passwd`/`pwd` query values move to `PGPASSWORD`
(along with userinfo); `sslpassword` has no portable env equivalent, so it is
stripped/ignored rather than passed through. `psql` child-process errors are
sanitized and never include the command line or DSN.

### Redis

```bash
npm run perf:agents -- --scenario S2 … \
  --redis-url redis://redis.perf.internal:6379/0 \
  --redis-cli redis-cli
```

Use `JANOSIK_PERF_REDIS_URL` or `--redis-url-file` when the URL contains a
password or a secret query parameter; the credential-bearing CLI form is
rejected.

Takes start/end `INFO` samples and reports memory (used/peak/max), connected
and blocked clients, instantaneous ops/s, rejected connections, keyspace
hits/misses and hit rate. The percent-encoded URL password is decoded into
`REDISCLI_AUTH`; userinfo and secret query parameters are stripped/redacted.

### MCP stdio driver

`--driver mcp` spawns N real `janosik-mcp` stdio processes over
`mcp/src/index.ts` (via the repo's `tsx`), pointed at the API origin with
`JANOSIK_URL`/`JANOSIK_TOKEN`. Each process runs
`janosik_list_ready_cards → janosik_claim_card → janosik_add_comment →
janosik_move_card`; every tool call is counted as a request with an inferred
status (`2xx`, 409/429/5xx, network `0`, abort `-1`) and per-tool latency, so
`requests/agent/min`, error rates and cycles are populated like the HTTP path.
Child sampled RSS peak and `/proc` lifetime VmHWM peak come from
`/proc/<pid>/status`. The same scenarios,
statuses and report are used. S1 uses `janosik_wait_for_work`; work cycles use
`evidence` comments so DoD-contract boards can move. **S3, S5 and S6 are
rejected with `--driver
mcp`** (the mixed loop and SSE/read probes are HTTP-only; use `--driver http`).
S1/S2/S4 use MCP workers for the agents. For idle S1 the wait tool already
consumes the cadence; the harness does not add a second full sleep when the
wait times out. Smoke mode caps the process count at 2; a large MCP swarm is a
dedicated-host capacity experiment. The connect/handshake timeout is 15 s and
is also cancelled by the scenario signal; a failed or hung handshake closes
the transport and kills the child. Normal `worker.close()` is bounded too (2 s)
and falls back to SIGTERM/SIGKILL. MCP writes use `evidence` comments; seed a
board whose DoD checklist accepts evidence, or use `--driver http` for a board
with a different comment contract.

## Secrets and redaction

- PATs are never written to stdout, JSON or Markdown; only `tokenCount`.
- Credential-bearing `--base-url`, `--pg-url`, `--redis-url` and
  `--api-inspect` values are rejected before load, including username-only
  userinfo without a password. Use `JANOSIK_PERF_BASE_URL`,
  `JANOSIK_PERF_PG_URL`, `JANOSIK_PERF_REDIS_URL` or `--base-url-file`,
  `--pg-url-file`, `--redis-url-file`. Credential-free CLI URLs are still
  accepted.
- Any URL that reaches logs or reports is stripped of userinfo and of query
  keys containing `password`, `passwd`, `pwd`, `secret`, `token`, `key` or
  `auth` (including `sslpassword`, `client_secret`, `x-api-key`).
- PostgreSQL/Redis child processes receive passwords via environment variables
  (`PGPASSWORD`, `REDISCLI_AUTH`), never argv; query secrets are removed from
  the psql connection string. Node `fetch`/undici rejects URLs with userinfo;
  use PAT headers.
- Child-process stderr and fetch errors are sanitized (`safeChildError`,
  `sanitizeText`); `execFile`'s argv-bearing `error.message` is not reported.
- Leak tests assert that stdout, JSON and Markdown contain neither tokens nor
  URL/query secrets such as `sslpassword` or `client_secret`.

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
  lib/preflight.mjs      token identity + every-token board membership preflight
  *.test.mjs             node --test coverage + real-mode/MCP mock smoke
```

## Reading the numbers

- p50/p95/p99 are per HTTP request across the scenario's **measurement
  window**; the operation table breaks them down.
- `409` is a measured CAS conflict and `429` the board/global rate limit; the
  report shows their counts and separate rates. `Unexp %` excludes both and
  counts unexpected 4xx, 5xx and network failures. `400 lease`/`400 other`
  separate expected claim-lease contention from unexpected validation errors.
  A successful claim/comment/move is counted immediately, so a later 429
  cannot erase it.
- Unexpected 4xx/5xx degrade a measured run to `partial` above the documented
  thresholds (`server5xxRate > 1%` or ≥5; `unexpected4xxRate > 0.1%` or ≥5).
  Zero successful 2xx is `failed`.
- `actions/s` counts successful writes (claim + comment + move = 3 per S2/S4
  cycle), not cycles. `cycles` counts completed write sequences. `no work`
  counts cycles that found no unleased card. An orphaned release is partial.
  A lost claim response (timeout/reset) triggers a release attempt through a
  separate short-timeout cleanup client before the next cycle. A non-2xx
  release is an orphan; a cleanup with no response (`0`) is `cleanupFailed`
  and degrades the run to `partial` because the lease may still be live. A
  cleanup actually cancelled by the harness deadline (`-1`) is counted
  separately as `cleanupAborted` and is not a false orphan.
- `requests/agent/min` uses the measured window, independent of worker drain,
  and for MCP uses the actual spawned process count (`--mcp-processes`), not
  the requested `--agents` label. The report also records the resolved board
  ids and the median/min/max of **all observed per-agent action intervals**
  (not a median of per-agent averages). This is an intra-cycle action
  interval: an S2/S4 cycle records claim, comment and move close together, so
  do not read it as the configured cycle start-to-start cadence. S1 also
  reports the per-agent idle poll interval, so idle cadence is visible even
  without write actions. `actualWorkStartedAt` is reported for S4 only; other
  scenarios report the planned/measured window.
- For S5, `sse.maxConcurrent` is the peak open streams; opened/failed and the
  observed ramp/hold durations are reported separately.
- `/proc` `VmHWM` (the `--api-pid` `API peak RSS*`) is the process **lifetime**
  peak; `--api-probe` peak is the scenario window. The report labels both.
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
