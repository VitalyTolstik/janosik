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

- Separate binary/container (`dist/http.js`), never embedded in the API.
- MCP Streamable HTTP transport from `@modelcontextprotocol/sdk`
  (`StreamableHTTPServerTransport`), one transport and one `McpServer` per
  session, JSON responses enabled for non-streaming calls.
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
it and the same bearer key. Error contract:

- `401 unauthorized` — missing/malformed `Authorization`; includes
  `WWW-Authenticate: Bearer realm="janosik-mcp"`.
- `403 token_mismatch` — a valid-looking key that is not the key bound to the
  session.
- `403 origin_not_allowed` — browser `Origin` not in the allowlist (default:
  all browser origins denied). An allowed origin also gets CORS preflight and
  response headers, so a browser MCP host is usable when deliberately enabled.
- `404 session_not_found` — unknown or expired `Mcp-Session-Id`.
- `413 payload_too_large` — body over `JANOSIK_MCP_HTTP_MAX_BODY_BYTES`.
- `503 session_limit` — global/per-key cap; includes `Retry-After`.
- `503 shutting_down` — SIGTERM drain window.

## Token isolation

On `initialize`, the gateway computes `SHA-256(token)` and stores only that
fingerprint in the session. The raw key lives in that session's
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
  A session with an in-flight request or open SSE stream is never swept.
- Explicit `DELETE` closes immediately; transport/network close also detaches.
- Graceful shutdown: stop accepting, close every session/SSE stream, wait
  `SHUTDOWN_GRACE_MS`, then force-close sockets. A second signal exits 1.
- Structured JSON logs include request id, session id, method, path, status,
  duration and client IP — never headers, bodies, keys, or token hashes.

## Tests

`mcp/src/http-*.test.ts`, `mcp/src/index.test.ts` (all use a mock API; no
Docker or heavy load):

- initialize + initialized + `tools/list` over real HTTP;
- per-session `Authorization` pass-through and A/B isolation: A's board vs
  B's board, B-on-A and A-on-B rejected with 403, mismatched DELETE rejected,
  A still usable afterwards;
- missing/malformed auth (401), no key in any log line;
- global limit (503), explicit DELETE, replacement session, shutdown drain;
- idle expiry -> 404 + session count 0;
- disallowed origin and oversized body;
- health/readiness, including upstream readiness 503;
- 100 then 500 real HTTP sessions in one process (mock upstream); heap and RSS
  printed as evidence and bounded by the test;
- spawn the stdio entry over `StdioClientTransport` and list tools (regression).

Local evidence (WSL, Node 24, `vitest run`): 500 sessions in one process used
about **+340 MB heap / 570 MB RSS** (including the Vitest worker and mock
upstream), versus the ~54 GB extrapolated for 500 stdio processes. The test
asserts a generous 750 MB heap bound to catch a regression, not to be a
benchmark.

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
