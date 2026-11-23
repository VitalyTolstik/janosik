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
- No database, no cache, no shared token.

## Transport contract

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `JANOSIK_MCP_HTTP_PATH` (default `/mcp`) | `POST` | `Authorization: Bearer jnk_…` | initialize, notifications, tool calls |
| same | `GET` | bearer; `Mcp-Session-Id` | optional server-to-client SSE stream |
| same | `DELETE` | bearer; `Mcp-Session-Id` | terminate a session |
| `/health` | `GET` | none | liveness, version, session counts |
| `/ready` | `GET` | none | readiness; probes the API's `/api/v1/health/ready` (cached) |

Initialize response carries `Mcp-Session-Id`; every later request must present
it and the same bearer key. Every POST response is an SSE stream; reverse
proxies need buffering off and a read timeout above the longest tool call.
Error contract:

- `401 unauthorized` — no/malformed `Authorization`, or the API rejects the
  key during the validation call; includes
  `WWW-Authenticate: Bearer realm="janosik-mcp"`.
- `429 rate_limited` — the API rate-limited the initialize-time key check;
  includes `Retry-After`.
- `503 auth_unavailable` — the key-validation call failed or timed out.
- `403 token_mismatch` — a valid key that is not the key bound to the
  session.
- `403 origin_not_allowed` — browser `Origin` not in the allowlist (default:
  all browser origins denied). An allowed origin also gets CORS preflight and
  response headers, so a browser MCP host is usable when deliberately enabled.
- `404 session_not_found` — unknown or expired `Mcp-Session-Id`.
- `413 payload_too_large` — body over `JANOSIK_MCP_HTTP_MAX_BODY_BYTES`.
- `503 session_limit` — global/per-key cap; includes `Retry-After`.
- `503 shutting_down` — SIGTERM drain window.

## Token validation and isolation

On `initialize`, the gateway first makes one cheap authenticated read against
the API (`/api/v1/auth/me` by default) so a fabricated bearer cannot create a
session or exhaust the global cap. Only a successful check proceeds; `401`
means the key is invalid, `429` carries the API's `Retry-After`, and `503`
means validation itself is unavailable. The token is then hashed:
`SHA-256(token)` is stored as the session fingerprint. The raw key lives in
that session's
`JanosikClient` and is never put in module state, logs, health output, or a
second session. Every later request re-hashes the presented key and compares
with `timingSafeEqual`. A different key on session A is rejected before the
request reaches the MCP transport, so it cannot read A's board or consume A's
upstream credentials. A missing `JANOSIK_TOKEN` in the gateway environment is
ignored with a warning; a stray `--token` flag is ignored the same way.

## Lifecycle and limits

- One `McpServer` + `JanosikClient` per session, created on initialize.
- `JANOSIK_MCP_HTTP_MAX_SESSIONS` (default 500) caps live+initializing
  sessions; `MAX_SESSIONS_PER_TOKEN` optionally caps one noisy key.
- Sessions idle for `SESSION_IDLE_MS` (default 5 min) are closed by a sweeper.
  A session with an in-flight request, an open SSE stream, or an `open()` still
  connecting is never swept. Timer env values are bounded to Node's maximum.
- Explicit `DELETE` closes immediately; transport/network close also detaches.
- Graceful shutdown: stop accepting, release idle sessions, let in-flight
  tool calls finish up to `SHUTDOWN_GRACE_MS`, close the remaining
  sessions/SSE streams, then force-close sockets. A second signal exits 1.
- Structured JSON logs include request id, session id, method, path, status,
  duration and client IP — never headers, bodies, keys, or token hashes.

## Tests

`mcp/src/http-*.test.ts`, `mcp/src/index.test.ts` (all use a mock API; no
Docker or heavy load):

- initialize + initialized + `tools/list` over real HTTP SSE, including the
  official `StreamableHTTPClientTransport`;`
- per-session `Authorization` pass-through and A/B isolation: A's board vs
  B's board, B-on-A and A-on-B rejected with 403, mismatched DELETE rejected,
  A still usable afterwards;
- key validation: fabricated key (401), API rate limit (429), API outage
  (503), valid key, and no key in any log line;
- global limit (503), explicit DELETE, replacement session, shutdown drain;
- idle expiry -> 404 + session count 0; pending `open()` is not swept;
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
about **+300 MB heap / 600 MB RSS** (including the Vitest worker and mock
upstream), versus the ~54 GB extrapolated for 500 stdio processes. The test
asserts a 750 MB heap and 1.5 GB RSS bound to catch a regression, not to be a
benchmark. The gateway image is a bundled single file, so the runtime image is
~350 MB (almost all of it the Node base image) instead of the previous ~571 MB
dependency tree; CI checks it stays under 400 MB.

## Operational notes and gaps

- The gateway is a stateful process: sessions live in memory. Restarting it
  drops sessions; clients re-initialize. Use multiple replicas only behind a
  session-affine proxy, or accept reconnects.
- It is not an auth boundary of its own: it forwards keys to the API, which
  still enforces scope/role/preset/rate limits. TLS and network isolation are
  required.
- The filesystem attachment tools are off in the container by default (no
  volume); enabling them needs a deliberate volume mount.
- The 500-session smoke is a session-creation/memory test, not a throughput
  load test; board-command load remains covered by TASK-200.1/200.7 work.
