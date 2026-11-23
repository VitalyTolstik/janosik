# TASK-200.8 — MCP Streamable HTTP gateway

Status: implemented on `feat/TASK-200.8-mcp-http` (base `84575476`).

## Why

The stdio MCP server is correct for a desktop client but expensive per agent:
one Node process per client, measured at 108–113 MB during calls
(`docs/PERF-BASELINE.md`). 500 co-located agents would need tens of GB of
process memory before doing any board work. MCP is a thin HTTP proxy (no DB
pool), so the process boundary is the cost, not the server load.

## Shape

```
agent A --Authorization: jnk_A-->\
agent B --Authorization: jnk_B--->  janosik-mcp-http (one process)
agent C --Authorization: jnk_C--> /    ├─ session A: McpServer + JanosikClient(jnk_A)
                                       ├─ session B: McpServer + JanosikClient(jnk_B)
                                       └─ session C: McpServer + JanosikClient(jnk_C)
                                                    |
                                                    v
                                             Janosik API /api/v1
```

- Separate binary/container (npm entry `dist/http.js`; the image bundles one
  self-contained `dist-http/http.js`), never embedded in the API.
- MCP Streamable HTTP transport from `@modelcontextprotocol/sdk`
  (`StreamableHTTPServerTransport`), one transport and one `McpServer` per
  session. POST responses use **SSE** (the transport default); JSON response
  mode is deliberately not enabled because SDK 1.32 leaves its pending
  `_streamMapping` entry behind for JSON responses. SSE also provides
  keepalives for long `wait_for_work` calls.
- stdio remains `dist/index.js`; the existing desktop configuration is
  unchanged.
- No database and no shared token; only bounded in-memory sessions and
  admission state (LRU rate buckets, a bounded negative cache, and a
  validation single-flight capped at `AUTH_MAX_IN_FLIGHT`).

## Transport contract

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `JANOSIK_MCP_HTTP_PATH` (default `/mcp`) | `POST` | `Authorization: Bearer jnk_…` | initialize, notifications, tool calls |
| same | `GET` | bearer; `Mcp-Session-Id` | optional server-to-client SSE stream |
| same | `DELETE` | bearer; `Mcp-Session-Id` | terminate a session |
| `/health` | `GET` | none | liveness, version, session counts |
| `/ready` | `GET` | none | readiness; probes the API's `/api/v1/health/ready` (cached; no key validation) |

Initialize response carries `Mcp-Session-Id`; every later request must present
it and the same bearer key. Successful MCP POSTs are SSE; gateway admission and
transport errors are JSON. Reverse proxies need buffering off and a read
timeout above the longest tool call. SSE responses carry the SDK's
`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`; JSON
errors and `/health`/`/ready` use `no-store`.
Error contract (all `503`s carry `Retry-After`):

- `401 unauthorized` — no/malformed `Authorization`, a cached invalid key, or
  the API rejects the key during validation; includes
  `WWW-Authenticate: Bearer realm="janosik-mcp"`.
- `429 initialize_rate_limited` — the per-IP or per-fingerprint initialize
  bucket is empty; includes `Retry-After`.
- `429 rate_limited` — the API rate-limited the initialize-time key check;
  includes `Retry-After`.
- `503 auth_unavailable` — the key-validation call failed or timed out;
  includes `Retry-After`.
- `503 auth_busy` — too many distinct validations are in flight; includes
  `Retry-After`.
- `503 session_limit` — global/per-key cap; includes `Retry-After`.
- `503 shutting_down` — SIGTERM drain window; includes `Retry-After`.
- `403 token_mismatch` — a valid key that is not the key bound to the
  session.
- `403 origin_not_allowed` — browser `Origin` not in the allowlist (default:
  all browser origins denied). An allowed origin also gets CORS preflight and
  response headers, so a browser MCP host is usable when deliberately enabled.
- `404 session_not_found` — unknown or expired `Mcp-Session-Id`.
- `413 payload_too_large` — body over `JANOSIK_MCP_HTTP_MAX_BODY_BYTES`.

## Token validation and isolation

On `initialize`, the gateway checks local admission before any API call **and
before reading the body**: global capacity, the per-token session cap (default
`min(50, MAX_SESSIONS)`), a per-IP initialize bucket (default 600/min), a
per-token-fingerprint bucket (default 10/min), and a bounded negative cache of
invalid fingerprints. The sessionless body is capped strictly (default 256 KiB)
before buffering; all POSTs still use the normal body cap. Every new session
that passes the buckets and is not in the negative cache performs one
authenticated API read (`/api/v1/auth/me` by default); only a cached invalid
fingerprint skips it. Concurrent initializes for one fingerprint share one
validation call; a `429`/`503` from the API is retried a bounded number of
times, honoring a small `Retry-After` (a longer API delay is returned to the
caller instead of sleeping in-request), so a new session costs one call and a
throttled one up to `AUTH_RETRY_ATTEMPTS` calls. At most
`AUTH_MAX_IN_FLIGHT` distinct validations run at once; excess keys get
`503 auth_busy` + `Retry-After`. Only a successful check proceeds; `401` means
the key is invalid, `429` carries `Retry-After`, and `503` means validation
itself is unavailable.

The default per-key limits are 10 initialize attempts/min and 50 live
sessions. A key that legitimately needs 50 sessions must raise
`JANOSIK_MCP_HTTP_INIT_RATE_LIMIT_PER_TOKEN` (or spread creation over several
minutes); the session cap alone does not grant 50 immediate initializes.

The token is then hashed: `SHA-256(token)` is stored as the session
fingerprint. The raw key lives in that session's `JanosikClient` and is never
put in module state, logs, health output, or a second session. Every later
request re-hashes the presented key and compares with `timingSafeEqual`. A
different key on session A is rejected before the request reaches the MCP
transport, so it cannot read A's board or consume A's upstream credentials.

`JANOSIK_TOKEN` may be absent: that is the normal gateway configuration. If it
is present and non-empty, it is ignored and a warning without the value is
logged; a stray `--token` flag is ignored the same way. The API's `/auth/me`
is IP-throttled: raise `THROTTLE_LIMIT` and the gateway's
`JANOSIK_MCP_HTTP_INIT_RATE_LIMIT` before a large first-time swarm.
`JANOSIK_MCP_HTTP_TRUST_PROXY` is a **trusted-hop count** from the right of
`X-Forwarded-For` (`0`–`16`; legacy `true` = `1`), not a boolean that trusts
the attacker-controlled left edge. Use it behind a trusted proxy that appends
the address it saw.

## Lifecycle and limits

- One `McpServer` + `JanosikClient` per session, created on initialize.
- `JANOSIK_MCP_HTTP_MAX_SESSIONS` (default 500) caps live+initializing
  sessions; `MAX_SESSIONS_PER_TOKEN` defaults to `min(50, MAX_SESSIONS)` and
  bounds one noisy key (`0` explicitly disables it).
- Sessions idle for `SESSION_IDLE_MS` (default 5 min) are closed by a sweeper.
  A session with an in-flight request, an open SSE stream, or an `open()` still
  connecting is never swept. Timer env values are bounded to Node's maximum.
- Explicit `DELETE` closes immediately; transport/network close also detaches.
- Graceful shutdown: release idle sessions, keep the listener open while
  in-flight tool calls finish up to `SHUTDOWN_GRACE_MS` (new requests get
  `503 shutting_down` + `Retry-After`), then close the remaining sessions/SSE
  streams, stop accepting and force-close sockets after a short grace. A
  second signal exits 1.
- Structured JSON logs include request id, session id, method, path, status,
  duration and client IP — never headers, bodies, keys, or token hashes.

## Tests

`mcp/src/http-*.test.ts`, `mcp/src/index.test.ts` (all use a mock API; no
Docker or heavy load):

- initialize + initialized + `tools/list` over real HTTP SSE, including the
  official `StreamableHTTPClientTransport`; per-token default clamping when
  `MAX_SESSIONS < 50`;
- per-session `Authorization` pass-through and A/B isolation: A's board vs
  B's board, B-on-A and A-on-B rejected with 403, mismatched DELETE rejected,
  A still usable afterwards;
- key validation: fabricated key (401), negative-cache hit (no second API
  call), API rate limit (429), API outage (503), bounded retry after a one-shot
  API 429, valid key, and no key in any log line;
- initialize flood stops at the per-IP bucket before the API; per-token
  bucket; concurrent validation single-flight; per-token HTTP cap
  (503 + Retry-After) and a second key still admitted;
- malformed and oversized sessionless bodies consume the IP bucket; the
  oversized `Content-Length` is rejected before buffering; a spoofed leftmost
  XFF entry cannot bypass the bucket when trusted hops are configured;
- global limit (503), explicit DELETE, replacement session;
- active slow tool call is drained before close; a request during drain gets
  `503 shutting_down` + `Retry-After`; open GET SSE closes during drain; idle
  expiry -> 404 + session count 0; pending `open()` is not swept;
- GET SSE keepalive, no sweep while the stream is open, DELETE closes it,
  disconnect is eventually swept;
- 20 × 1 MiB tool results over SSE with empty `_streamMapping`,
  `_requestToStreamMapping` and `_requestResponseMap`, plus a bounded heap;
- single-flight `/ready` (two concurrent probes, one upstream call);
- disallowed origin and oversized body;
- 100 then 500 real HTTP sessions in one process (mock upstream), a tool call
  at the 500 cap, and heap + RSS bounds;
- spawn the stdio entry over `StdioClientTransport` and list tools (regression).

Local evidence (WSL, Node 24, `vitest run`): 500 sessions in one process used
about **+340 MB heap / 630 MB RSS** (including the Vitest worker and mock
upstream), versus the ~54 GB extrapolated for 500 stdio processes. The test
asserts a 750 MB heap and 1.5 GB RSS bound to catch a regression, not to be a
benchmark. The gateway image is a bundled single file, so the runtime image is
~350 MB (almost all of it the Node base image) instead of the previous ~571 MB
dependency tree; CI checks it stays under 400 MB.

## Operational notes and gaps

- The gateway is a stateful process: sessions live in memory. Restarting it
  drops sessions; clients re-initialize. Use multiple replicas only behind a
  session-affine proxy, or accept reconnects.
- `GET /ready` follows the API readiness endpoint, not a caller's key; it is
  an orchestration signal and returns `503` + `Retry-After` when the API is
  not reachable. `GET /health` is liveness only.
- It is not an auth boundary of its own: it forwards keys to the API, which
  still enforces scope/role/preset/rate limits. TLS and network isolation are
  required.
- The filesystem attachment tools are off in the container by default (no
  volume); enabling them needs a deliberate volume mount.
- The 500-session smoke is a session-creation/memory test, not a throughput
  load test; board-command load remains covered by TASK-200.1/200.7 work.
