# @janosik/mcp

An [MCP](https://modelcontextprotocol.io) server for [Janosik](https://github.com/VitalyTolstik/janosik),
the self-hosted Kanban board. It lets an AI agent — Claude, Cursor, VS Code,
opencode, Codex or any other MCP client — read and drive a board with a
personal API key: find the work that is ready to pick up, create and move cards,
claim one with a self-expiring lease so competing claims are rejected, set its
machine-readable task contract, comment with a typed kind, tick checklists,
assign people and link cards. Writes can be pinned to the board version they
read when they use the command API (compare-and-set), so a concurrent edit is
refused. Member and share-link tools are opt-in; agent-session tools are in the
default set. The server exposes 84 tools across 16 groups.

Board-content edits go through the command log the UI uses and stream live
to board viewers. MCP edits do not enter the UI's local undo stack; use
unarchive tools or explicit compensating edits to correct them. Comments, attachments, board
creation/import/deletion, membership, shares and account changes use separate
API routes. Activity records identify the user and whether a command came
from a human session or an API key. A key can be scoped to one board, carry an
owner-editable scope preset (`observer`, `worker`, `reviewer`, `admin`), be made
read-only, and have its own per-minute rate limit. Its scope never raises the
board role.

> **Companion skill.** The tools are the "hands"; the
> [`janosik` skill](../skills/janosik/SKILL.md) is the "behaviour" — when to
> comment, how to fill a card, and how to return a card with evidence when a bug
> turns up. Install it alongside this server.

## Quick start

1. In Janosik, open **Account → API keys** and create a key (it starts with
   `jnk_`). Choose its board scope, scope preset (`Worker` for ordinary content
   writes, `Reviewer` to enter Done, `Admin` for board administration),
   read-only setting, trusted-CI flag, rate limit and expiry for this agent.
   Copy it now — it is shown once.
2. Point your MCP client at the server with these variables:

   | Variable           | Example                      | Meaning                                                                                                                                                |
   | ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `JANOSIK_URL`      | `https://boards.example.com` | Origin of your running instance (e.g. `http://localhost:3000` when you run from source).                                                               |
   | `JANOSIK_TOKEN`    | `jnk_…`                      | The personal API key.                                                                                                                                  |
   | `JANOSIK_APP_BASE` | `/app`                       | App sub-path, when the app is not at the site root (used to build board links). The self-host image serves the app under `/app/`, so set `/app` there. |

   All three can also be passed as `--url` / `--token` / `--app-base` flags.
   Prefer `env` for the token: a `--token` flag shows up in the local
   process list.

The MCP server does not create or install a key for you. It reads
`JANOSIK_TOKEN` when it starts and sends that key as a Bearer credential on
each API call. To rotate it, create a replacement in the app, update the MCP
client's environment, restart the MCP server, then revoke the old key in the
app. The token list, creation and revocation API routes require a browser user
session and return 403 to a personal API key.

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "janosik": {
      "command": "npx",
      "args": ["-y", "@janosik/mcp"],
      "env": {
        "JANOSIK_URL": "https://boards.example.com",
        "JANOSIK_TOKEN": "jnk_…"
      }
    }
  }
}
```

### Cursor / VS Code / opencode

The same `command` + `env` shape works everywhere MCP is configured. For a
local checkout, `command` can be `node` with `args: ["/path/to/mcp/dist/index.js"]`.

## Shared Streamable HTTP gateway

The stdio server is the right shape for one developer's desktop client. For a
swarm of agents on one host it is the wrong shape: every client starts its own
Node process (100+ MB each). The package also ships a **separate Streamable
HTTP gateway** (`janosik-mcp-http`) that serves many MCP sessions from one
process, with no database and no shared credential.

Each MCP client connects to the same URL and sends its own personal key:

```
POST https://mcp.example.com/mcp
Authorization: Bearer jnk_…
Content-Type: application/json
Accept: application/json, text/event-stream
```

Successful MCP POSTs return an SSE stream (`text/event-stream`), including
ordinary tool calls; the gateway sends `: keepalive` comments while a tool
such as `janosik_wait_for_work` is still running. Gateway-level errors
(authentication, admission, limits, shutdown) are ordinary JSON bodies.
Configure a reverse proxy with buffering off and a read timeout above the
longest tool call. GET opens the optional server-to-client SSE stream; DELETE
terminates the session. SSE responses use the MCP SDK's
`Cache-Control: no-cache, no-transform` plus `X-Accel-Buffering: no`; gateway
JSON errors and `/health`/`/ready` use `no-store`.

`JANOSIK_TOKEN` may be **absent**; the gateway never uses a shared key. If it
is **present and non-empty**, it is ignored and the gateway logs a warning
(without the value). On `initialize`, after local admission and the strict
sessionless body cap, the gateway validates the presented key with a cheap
authenticated API read (`/api/v1/auth/me` by default), so a fabricated bearer
string cannot consume the global session cap; invalid keys get `401`, API rate
limits get `429` with `Retry-After`, and an API outage gets `503`. Every new
session performs one validation; only a cached invalid fingerprint skips the
call. A retryable `429`/`503` adds at most `AUTH_RETRY_ATTEMPTS - 1` more calls
when its `Retry-After` is within `AUTH_RETRY_MAX_DELAY_MS` (default: 2 total
attempts). At most `AUTH_MAX_IN_FLIGHT` (default 64) distinct validations run
at once; excess keys get `503 auth_busy` + `Retry-After`. The key is then bound
to that session's SHA-256 fingerprint and
required (and checked in constant time) on every later request. A different
key on the same `Mcp-Session-Id` gets `403 token_mismatch`; a request with no
key at all gets `401`. Sessions are independent: one session's
`JanosikClient` and board observations never cross into another.

Admission is checked locally before `/api/v1/auth/me` and before reading the
request body: a global cap, a per-key cap (default `min(50, MAX_SESSIONS)`),
per-IP and per-token-fingerprint initialize buckets, and a bounded negative
cache of invalid fingerprints. Body reads have **two separate budgets**:
sessionless initialize reads are capped strictly at 256 KiB with their own
per-IP (default 4) and global (default 32; ~8 MiB) gates, while session-bound
tool bodies use a per-token gate (default 4) with a separate global backstop
(default 16; ~256 MiB). An initialize flood across many IPs therefore cannot
deny authenticated tool calls; each class only answers `503 body_busy` +
`Retry-After` within its own budget. The normal body cap still applies to
every POST. Both gates share one explicit read deadline (default 8 s): a
stalled body is reset and its slot released independently of Node's request
checker, so a slow large upload must fit that deadline (raise it and the
memory budget together if needed). `/health` reports
`bodyReads.session` and `bodyReads.initialize` active/max counters plus
`timeoutMs`. Concurrent initializes for one key share one validation call. A `429` from the
gateway for initialize is `initialize_rate_limited`; `503 session_limit` and
other 503s carry `Retry-After`. The default per-key limits are **10
initialize attempts/min and 50 live sessions**: a key that legitimately needs
the per-key session cap must raise
`JANOSIK_MCP_HTTP_INIT_RATE_LIMIT_PER_TOKEN` (or create them over several
minutes). The API's own IP throttle still applies to
first-time keys:
raise the API `THROTTLE_LIMIT` (and the gateway's
`JANOSIK_MCP_HTTP_INIT_RATE_LIMIT`) for a large
simultaneous first-time swarm, and put the gateway behind a trusted proxy so
`TRUST_PROXY`/`JANOSIK_MCP_HTTP_TRUST_PROXY` see real client addresses.

**Sessions are in-memory.** A gateway restart drops every session; clients
must initialize again. If you run more than one replica, use a session-affine
proxy or accept reconnects; there is no shared session store. A session with
no request is closed after `JANOSIK_MCP_HTTP_SESSION_IDLE_MS`, a request in
flight or an open SSE stream is never swept, and `MAX_SESSIONS` /
`MAX_SESSIONS_PER_TOKEN` bound the process.

```bash
# from a checkout: `dist/http.js` is the npm-style external-dependency build
npm run build -w mcp
JANOSIK_URL=http://localhost:3000 \
JANOSIK_MCP_HTTP_HOST=0.0.0.0 \
JANOSIK_MCP_HTTP_PORT=8080 \
node mcp/dist/http.js

# Docker image: one self-contained `dist-http/http.js` bundle.
# `host.docker.internal` works on Docker Desktop; on Linux use the host IP
# (or `--network host`) instead.
docker run --rm -p 127.0.0.1:8080:8080 --stop-timeout 20 \
  -e JANOSIK_URL=http://host.docker.internal:3000 janosik-mcp

# or the Docker Compose profile (separate container from the API)
docker compose --profile mcp up -d
# endpoint: http://127.0.0.1:8080/mcp
```

A remote MCP client configuration uses a URL and headers instead of a command
(the exact key names differ by client; this is the common shape):

```json
{
  "mcpServers": {
    "janosik": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer jnk_your_personal_key" }
    }
  }
}
```

The gateway exposes `GET /health` (liveness, no auth) and `GET /ready`
(readiness: the API's `/api/v1/health/ready` must answer). `/ready` does
**not** validate an MCP key; it only reports API reachability (cached). Both
endpoints return `Retry-After` on `503`. MCP requests use `POST`/`GET`/`DELETE`
on `JANOSIK_MCP_HTTP_PATH` (default `/mcp`). During SIGTERM drain, unknown
paths still answer `404` and disallowed origins `403`; other MCP requests get
`503 shutting_down` + `Retry-After` while active calls finish.

| Variable | Default | Meaning |
| --- | --- | --- |
| `JANOSIK_MCP_HTTP_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` in a container. |
| `JANOSIK_MCP_HTTP_PORT` | `8080` | Bind port. |
| `JANOSIK_MCP_HTTP_PATH` | `/mcp` | MCP endpoint path; `/health` and `/ready` are reserved. |
| `JANOSIK_MCP_HTTP_MAX_SESSIONS` | `500` | Global live-session cap; excess initializes get `503` + `Retry-After`. |
| `JANOSIK_MCP_HTTP_MAX_SESSIONS_PER_TOKEN` | `min(50, MAX_SESSIONS)` | Per-key session cap; set `0` to explicitly disable the second limit. |
| `JANOSIK_MCP_HTTP_INIT_RATE_LIMIT` | `600` | Initialize attempts per client IP per minute; `0` disables. |
| `JANOSIK_MCP_HTTP_INIT_RATE_LIMIT_PER_TOKEN` | `10` | Initialize attempts per token fingerprint per minute; `0` disables. |
| `JANOSIK_MCP_HTTP_NEGATIVE_CACHE_TTL_MS` | `60000` | Bounded cache of invalid fingerprints; `0` disables. |
| `JANOSIK_MCP_HTTP_NEGATIVE_CACHE_MAX_ENTRIES` | `1000` | Negative-cache entry bound. |
| `JANOSIK_MCP_HTTP_AUTH_RETRY_ATTEMPTS` | `2` | Total key-validation attempts, including the first. |
| `JANOSIK_MCP_HTTP_AUTH_RETRY_MAX_DELAY_MS` | `1000` | Do not retry in-request when the API asks for a longer `Retry-After`. |
| `JANOSIK_MCP_HTTP_AUTH_MAX_IN_FLIGHT` | `64` | Maximum distinct key validations in flight; excess initializes get `503 auth_busy`. |
| `JANOSIK_MCP_HTTP_SESSION_IDLE_MS` | `300000` | Close a session with no request for this long. |
| `JANOSIK_MCP_HTTP_SESSION_SWEEP_MS` | `30000` | Idle sweeper interval. |
| `JANOSIK_MCP_HTTP_ALLOWED_ORIGINS` | empty | Browser origins allowed to call the gateway; empty rejects every browser `Origin`. |
| `JANOSIK_MCP_HTTP_MAX_BODY_BYTES` | `16777216` | JSON-RPC request body cap for all POSTs; over it gets `413`. |
| `JANOSIK_MCP_HTTP_INIT_MAX_BODY_BYTES` | `min(262144, MAX_BODY_BYTES)` | Strict sessionless/initialize body cap, checked before buffering; over it gets `413`. |
| `JANOSIK_MCP_HTTP_MAX_CONCURRENT_BODY_READS` | `16` | Global backstop for session-bound body reads; at 16 MiB each this is ~256 MiB. |
| `JANOSIK_MCP_HTTP_MAX_CONCURRENT_BODY_READS_PER_TOKEN` | `4` | Per-token session-bound body reads; one token cannot starve the session gate. |
| `JANOSIK_MCP_HTTP_MAX_CONCURRENT_INIT_BODY_READS` | `32` | Separate sessionless/initialize global budget (~8 MiB at the 256 KiB cap). |
| `JANOSIK_MCP_HTTP_MAX_CONCURRENT_INIT_BODY_READS_PER_IP` | `4` | Per-IP sessionless body reads; one IP cannot starve the init gate. |
| `JANOSIK_MCP_HTTP_BODY_READ_TIMEOUT_MS` | `8000` | Destroy a stalled body read and release its slot independently of Node's checker. 8 s may be too short for a slow 16 MiB upload; raise it with the memory budget. |
| `JANOSIK_MCP_HTTP_READY_URL` | `${JANOSIK_URL}/api/v1/health/ready` | Upstream readiness probe; no token is sent. |
| `JANOSIK_MCP_HTTP_READY_CACHE_MS` | `5000` | Cache for the readiness probe (`0` = every request probes). |
| `JANOSIK_MCP_HTTP_READY_TIMEOUT_MS` | `3000` | Readiness probe timeout. |
| `JANOSIK_MCP_HTTP_AUTH_URL` | `${JANOSIK_URL}/api/v1/auth/me` | Key-validation call made once per initialize. |
| `JANOSIK_MCP_HTTP_AUTH_TIMEOUT_MS` | `3000` | Key-validation timeout. |
| `JANOSIK_MCP_HTTP_SSE_KEEPALIVE_MS` | `15000` | SSE keep-alive interval; `0` disables it. |
| `JANOSIK_MCP_HTTP_REQUEST_TIMEOUT_MS` | `60000` | Time allowed to receive a request; not a tool deadline. Long tool responses are kept alive by SSE. |
| `JANOSIK_MCP_HTTP_HEADERS_TIMEOUT_MS` | `60000` | Node headers timeout. |
| `JANOSIK_MCP_HTTP_TRUST_PROXY` | `0` | Trusted proxy hops from the right of `X-Forwarded-For` (`0`–`16`; legacy `true` = `1`). |
| `JANOSIK_MCP_HTTP_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`; logs are JSON and never contain keys. |
| `JANOSIK_MCP_HTTP_SHUTDOWN_GRACE_MS` | `10000` | Drain window on SIGTERM/SIGINT before force-closing sockets. |

**Memory budget.** Worst case is
`MAX_CONCURRENT_BODY_READS × MAX_BODY_BYTES` = 16 × 16 MiB = 256 MiB for
session bodies, plus `MAX_CONCURRENT_INIT_BODY_READS × INIT_MAX_BODY_BYTES` =
32 × 256 KiB = 8 MiB for initialize. Keep the container `mem_limit` above
`NODE_OPTIONS` (1 GiB in Compose) plus those budgets. The per-token/per-IP
caps and the 8 s deadline keep one client from consuming either global gate;
raise the deadline for slow large uploads.

`JANOSIK_MCP_TOOLSETS`, `JANOSIK_MCP_READONLY`, `JANOSIK_APP_BASE` and the
filesystem settings are shared with the stdio server. The gateway container
has no host filesystem mount by default, so attachment upload/download should
stay off unless you deliberately add a volume.

**Security checklist.** Put the gateway behind TLS (a reverse proxy or
private network) and never expose it unauthenticated. Keep the Compose
`JANOSIK_MCP_BIND_ADDRESS` on `127.0.0.1` unless a trusted proxy fronts it.
Set `JANOSIK_MCP_HTTP_ALLOWED_ORIGINS` only for a trusted
browser client. It does not log authorization headers or request bodies.
MCP SSE responses use the SDK's `no-cache, no-transform` (plus
`X-Accel-Buffering: no`); JSON errors and health/readiness use `no-store`.
The per-session idle expiry, caps, buckets and negative cache are resource
guards, not an authorization boundary: the Janosik API still enforces each
key's scopes, roles and rate limits. In Compose the published port is bound to
`127.0.0.1`; a host proxy forwards to `127.0.0.1:8080`, while clients use the
public `https://…/mcp` URL. Do not use the container name or internal port in
client configuration. Raise API `THROTTLE_LIMIT`, proxy body/time limits and
the gateway's `JANOSIK_MCP_HTTP_INIT_RATE_LIMIT` before a large first-time
swarm; 500 new keys
inside one minute exceed a `THROTTLE_LIMIT` of 300.

The `mcp` package test suite includes a mock-upstream smoke that creates 100
then 500 real HTTP sessions in one process, calls a tool at the cap, and
checks that 20 MiB of SSE tool results leaves no SDK stream mappings behind.
On the development host 500 sessions used about 630 MB RSS (one process, not
500 × 100 MB). The gateway container bundles the SDK and Zod into one file, so
its image is ~350 MB rather than a ~571 MB dependency tree. See
`mcp/src/http-server.test.ts`.

## Tools

Tools come in groups. The default set works the board, agent sessions,
approvals, plans and run inspection; the groups that change _who_ can see a
board or expose the account identity are opt-in:

| Variable / flag                          | Effect                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JANOSIK_MCP_TOOLSETS` / `--toolsets`    | Comma-separated groups. Default: `boards,columns,cards,labels,checklists,links,comments,activity,attachments,sessions,approvals,plans,runs`. Opt-in: `members`, `shares`, `account`. `all` enables everything; `default,members` extends the default. The removed `invitations` name is accepted as a no-op with a warning. |
| `JANOSIK_MCP_READONLY=1` / `--read-only` | Register only tools that never change anything — for an agent that watches and reports.                                                                                                                                                                                                                                     |

In read-only mode, `janosik_export_board`, `janosik_get_card`,
`janosik_get_run` and `janosik_get_approval` still return inline responses.
Their `outputPath` option is refused because it writes a local file.

Data tools take `response_format: "markdown"` (default) or `"json"`. A JSON
response that would exceed the size budget is refused with a hint (read one
column with `janosik_get_board`'s `columnId`, export to a file) rather than
truncated into JSON that does not parse.

For `janosik_get_card`, `janosik_get_run` and `janosik_get_approval`, pass
`outputPath` (for example, `details.json`) to save the complete JSON document
when it exceeds the 25,000-character tool response budget. The file contains
the same authorized data as the inline JSON response. The tool returns
`{ ok: true, outputPath }` with the resolved path. File output requires
`JANOSIK_MCP_ALLOW_FS=1` and write-enabled MCP mode. Relative paths resolve
against `JANOSIK_MCP_FS_ROOT` when set, otherwise against the MCP server's
working directory. Existing files are never overwritten.

Successful command-log mutations return `structuredContent` with `ok: true`,
`seq` and `runId` (`null` when no run was recorded). A batch returns the
highest sequence from its results and the batch run ID. Use `seq` as
`expectedVersion` for a subsequent write. The result may also carry
`resourceId` or `approvalId`. Failed calls keep
`isError: true` and carry `structuredContent` with `ok: false`, the API `code`,
`retryable`, `requestId` and conflict details. The MCP server retries the API
call automatically for a `429 rate_limited` (and the queued `503
rate_limited`) up to four attempts, adding jitter on top of `Retry-After`;
a pause is never shorter than the server asked for unless it is at least eight
seconds, where it uses 7.4 s plus up to 600 ms of jitter (each pause is thus
≤8 s), before returning the error; a command retry keeps its `commandId`.
Retry only `retryable: true`
failures that still come back (`rate_limited`, `request_timeout`,
`board_write_timeout`, `service_unavailable`, `idempotency_in_progress`);
retry `service_unavailable` only with the same `commandId` or REST
`Idempotency-Key`, because a `502`/`504` can follow an unkeyed write. Re-read
the board on `version_conflict`, and stop on `approval_required`.
The REST-backed writes (`create_board`, `duplicate_card`, `add_comment`,
`create_share`, `upload_attachment`) accept an optional `idempotencyKey` so a
tool-call retry returns the first result instead of creating a second one.

**Boards** — `janosik_list_boards`, `janosik_get_board`,
`janosik_create_board`, `janosik_rename_board`, `janosik_archive_board`,
`janosik_unarchive_board`, `janosik_delete_board`, `janosik_export_board`,
`janosik_import_board`, `janosik_get_workflow`

**Columns** — `janosik_create_column`, `janosik_rename_column`,
`janosik_move_column`, `janosik_duplicate_column`, `janosik_sort_column`,
`janosik_set_column_wip_limit`, `janosik_set_column_accent`, `janosik_clear_column`,
`janosik_delete_column`

**Cards** — `janosik_create_card`, `janosik_get_card`, `janosik_update_card`,
`janosik_move_card`, `janosik_duplicate_card`, `janosik_set_card_priority`,
`janosik_set_card_assignee`, `janosik_set_card_due_date`,
`janosik_set_card_cover`, `janosik_claim_card`, `janosik_release_card`,
`janosik_set_card_task_spec`,
`janosik_archive_card`, `janosik_unarchive_card`,
`janosik_delete_card`, `janosik_search_cards`, `janosik_list_ready_cards`,
`janosik_wait_for_work`

**Labels** — `janosik_list_labels`, `janosik_create_label`,
`janosik_rename_label`, `janosik_set_label_color`, `janosik_delete_label`,
`janosik_set_card_label`

**Checklists** — `janosik_add_checklist`, `janosik_rename_checklist`,
`janosik_add_checklist_item`, `janosik_set_checklist_item_done`,
`janosik_rename_checklist_item`, `janosik_delete_checklist_item`,
`janosik_delete_checklist`

**Links** — `janosik_add_card_link`, `janosik_remove_card_link`

**Comments** — `janosik_list_comments`, `janosik_add_comment`,
`janosik_delete_comment`

**Members** (opt-in: `members`) — `janosik_list_members`, `janosik_invite_member`,
`janosik_update_member`, `janosik_remove_member`

**Shares** (opt-in: `shares`) — `janosik_list_shares`, `janosik_create_share`,
`janosik_update_share`, `janosik_refresh_share`, `janosik_revoke_share`

**Activity** — `janosik_board_activity`, `janosik_card_activity`

**Attachments** — `janosik_list_attachments`, `janosik_upload_attachment`,
`janosik_download_attachment`, `janosik_delete_attachment`

**Agent sessions** — `janosik_start_session`, `janosik_heartbeat`,
`janosik_end_session`

**Approvals** — `janosik_request_approval`, `janosik_list_approvals`,
`janosik_get_approval`, `janosik_wait_for_decision`,
`janosik_cancel_approval`. There is deliberately no decide tool: approval is a
human, session-only action.

**Plans** — `janosik_plan_changes`, `janosik_apply_plan`. Preview a bulk or
multi-step edit as a dry run (canonical `planHash`, diff, warnings, conflicts),
then apply exactly those commands and that hash atomically. A destructive plan
needs a human approval and is then applied once; 100 commands / 50 card creates
is the per-plan limit.

**Runs** — `janosik_list_runs`, `janosik_get_run`,
`janosik_preview_run_revert`. A run groups a PAT batch, a single destructive
PAT command or a plan apply for audit and rollback. The preview is a dry run
with conflicts; applying a revert is a human board-ADMIN action in the browser,
so there is no MCP apply tool.

**Account** (opt-in: `account`) — `janosik_whoami` only. API keys and profile
writes are managed in the app only: the server refuses those routes to an API
key, so an agent can never mint itself a new one or change the owner's profile.
The invitation and profile tools were removed in TASK-166.

## Common flows

Tool arguments are ordinary JSON. The server returns human-readable text plus
`structuredContent`; names below omit the `janosik_` prefix.

```json
{ "tool": "whoami", "arguments": { "response_format": "json" } }
{ "tool": "list_boards", "arguments": {} }
{ "tool": "get_board", "arguments": { "boardId": "b1", "detail": "summary" } }
{ "tool": "create_card",
  "arguments": { "boardId": "b1", "columnId": "col1", "title": "Fix login" } }
```

`whoami` returns `{ user, token, session, server }`; `server.version` is the
live release and `server.apiVersion` is `"1"`. `create_card` returns
`{ ok: true, resourceId, seq, runId }`.

**Plan / apply.** Preview a bulk edit, then apply exactly the returned commands
and hash:

```json
{
  "tool": "plan_changes",
  "arguments": {
    "boardId": "b1",
    "commands": [
      {
        "commandId": "cg-001",
        "action": {
          "type": "ADD_CARD",
          "newCardId": "card-1",
          "columnId": "col-1",
          "title": "Bulk card"
        }
      },
      {
        "commandId": "cg-002",
        "action": {
          "type": "SET_CARD_PRIORITY",
          "cardId": "card-1",
          "priority": "high"
        }
      }
    ]
  }
}
```

`plan_changes` returns `planHash`, `plan`, `diff`, `warnings`, `conflicts` and
`canApply`, and writes nothing. `apply_plan` with the same `commands` and
`planHash` returns `{ seq, runId, planHash, results }`. Add `approvalId` when the
preview requires approval.

**Approval.**

```json
{ "tool": "request_approval",
  "arguments": { "boardId": "b1", "kind": "destructive",
    "plan": { "schemaVersion": 1, "boardId": "b1", "commands": [
      { "commandId": "cg-del-1", "action": {
          "type": "DELETE_CARD", "cardId": "card-1" } } ] } } }
{ "tool": "wait_for_decision",
  "arguments": { "boardId": "b1", "approvalId": "apr-1", "timeoutSeconds": 60 } }
{ "tool": "get_approval", "arguments": { "boardId": "b1", "approvalId": "apr-1" } }
{ "tool": "cancel_approval", "arguments": { "boardId": "b1", "approvalId": "apr-1" } }
```

`request_approval` returns a pending `approval` and applies nothing. A human
board ADMIN approves in the browser; `wait_for_decision` polls up to 60 seconds
per call and can be repeated until the approval expires.

**Runs.**

```json
{ "tool": "list_runs",
  "arguments": { "boardId": "b1", "kind": "plan", "limit": 20 } }
{ "tool": "get_run", "arguments": { "boardId": "b1", "runId": "run-1" } }
{ "tool": "preview_run_revert",
  "arguments": { "boardId": "b1", "runId": "run-1" } }
```

`preview_run_revert` returns `{ dryRun: true, run, conflicts, canRevert }` and
writes nothing. Applying a rollback is a human board-ADMIN action in the
browser; no MCP tool exposes it.

**Sessions.**

```json
{ "tool": "start_session",
  "arguments": { "boardId": "b1", "name": "nightly-fix", "model": "agent-x" } }
{ "tool": "heartbeat",
  "arguments": { "boardId": "b1", "sessionId": "sess-1", "status": "active" } }
{ "tool": "end_session",
  "arguments": { "boardId": "b1", "sessionId": "sess-1", "status": "completed" } }
```

The client attaches `X-Agent-Session` to later writes. Heartbeat and end remain
available during a pause so the agent can finish cleanly.

**Pause / resume** is human-only and deliberately has no MCP tool. A browser
session calls the REST route directly:

```http
POST /api/v1/boards/b1/agents/pause
Authorization: Bearer <browser access JWT>
Content-Type: application/json

{ "reason": "Stop the nightly agent" }
```

The same shape works for board, session, token and `/agents/pause-all`
pause/resume routes. A PAT receives `403 pat_forbidden`.

## Behaviour agents can rely on

- **No silent no-ops.** A write that changed nothing — an id that is not on
  the board, or a value that was already set — comes back as an error, so an
  agent never reads "done" for a write that did nothing.
- **Compare-and-set.** Tools that compute a command from a read (`move_card`,
  `move_column`, `duplicate_column`, `remove_card_link`) send it with `ifMatch`
  on the board version they read; if another writer got there first, they
  re-read and retry. Command-log mutation tools also take an optional
  `expectedVersion` (the board `seq` from `janosik_get_board`): pass it and the
  write is refused with a version conflict if the board changed since, instead
  of overwriting another agent's edit. `janosik_update_card` keeps
  `expectedDescription` for compare-and-set edits of shared text.
- **Retries are safe.** A command that fails on the network is retried with
  the same idempotency key, so a write that did commit is never applied twice.
  Command-log create tools take a client id (`cardId`, `checklistId`, …) that
  determines the key, so an identical retried create returns the first entity,
  not a duplicate. Every request has a timeout.
- **Work discovery.** `janosik_list_ready_cards` lists candidates in each
  active board's initial column (`workflow.initialColumnId`, or the first column
  when no workflow exists) that are unassigned, free of a live claim and not
  blocked, ordered by priority. The initial column is a convention, not a
  column named Backlog. Both it and `janosik_wait_for_work` read the compact
  server ready summary (`GET /boards/:id/ready`, or `GET /boards/ready` without
  `boardId`) instead of a board aggregate. A single-board wait is held by the
  server for 25–60 s per request and wakes only on readiness-relevant changes;
  `pollMs` is ignored for that hold. A cross-board wait re-reads the snapshot
  every 15–60 s across the full jittered range, with `pollMs` as the floor. A
  relevant wake that leaves no work keeps holding, and `timeoutMs: 0` still
  performs one initial snapshot (5 s HTTP budget); other snapshot calls are
  bounded by the remaining deadline. `janosik_list_ready_cards` keeps the
  normal GET network/429 retries. Transient network and capacity
  (`503 ready_poll_capacity` + `Retry-After`) failures retry only inside the
  caller's deadline. The tool keeps `timeoutMs`, `pollMs`, `boardId` and its
  `{ card: … }` / `{ card: null }` result. On a server without the endpoint
  (`404`) it falls back to a full board read, so upgrading the server is what
  removes the idle board load. A wait does not reserve or claim the card.
- **A Definition-of-Done check in MCP.** When `janosik_move_card` enters a done
  column (`workflow.doneColumnIds`, falling back to the board's last column when
  the list is empty or no workflow exists), it checks cards with a task contract for unticked
  `Definition of Done` checklist items and an `evidence` comment. This is a
  convention of this MCP tool; the app's command API does not enforce it for
  other clients. After a version conflict the tool re-reads the board and
  repeats the check before retrying the move. The evidence-comment read is
  separate from the move; this is not an atomic backend completion rule.
- **Workflow rules are enforced.** `janosik_get_workflow` reads the board's
  transitions, roles, conditions and initial/done columns; pass `cardId` for a
  per-card allowed/blocked check. A server-side `409` with
  `conflict: "workflow"` means the move is forbidden: the error names the
  allowed destinations and never suggests retrying the same one. Unarchive and
  restore follow the same rule: a card may return to its original column, while
  another target needs an allowed transition. Do not bypass the workflow by
  clearing a contract, changing rules or importing a board.
- **Typed comments.** `janosik_add_comment` takes a `kind` (`status`,
  `question`, `blocker`, `evidence`, `handoff`; omit for a plain note) and
  `janosik_list_comments` filters by it.
- **Atomic `create_card`.** The due date and assignee are checked before the
  command. Creation and optional fields run in one transaction; a failure
  rolls the whole batch back.
- **Archive for routine cleanup.** Use `janosik_archive_card` for a finished
  card and `janosik_archive_board` for a board you want out of the active
  workflow. Both have matching unarchive tools. Use `janosik_clear_column`
  to archive a column's cards in one step. Delete tools remove content from
  normal board access and should be used when removal is specifically wanted;
  `janosik_delete_column` also removes the cards it contains. Comments have
  no archive action, so avoid deleting them as a cleanup step.

## Filesystem tools

`janosik_upload_attachment` reads local files, and `janosik_download_attachment`
writes them. With `outputPath`, `janosik_export_board`, `janosik_get_card`,
`janosik_get_run` and `janosik_get_approval` also write local files. File access
is **off by default**. Enable it with
`JANOSIK_MCP_ALLOW_FS=1`, and confine them to a directory with
`JANOSIK_MCP_FS_ROOT=/path/to/sandbox` (relative paths then resolve against
it). Setting only `JANOSIK_MCP_FS_ROOT` does not enable filesystem access.
Symlinks that lead out of the root are refused, only regular files up to
the attachment size limit are read, and existing files are never overwritten.
New files are published atomically with mode `0600` where POSIX permissions
apply. File write failures return `filesystem_error`.
When a root is configured, secure path resolution requires Linux x64 or
arm64, a kernel with `openat2`, a mounted `/proc`, and `python3` on `PATH`.
Confined writes additionally require `O_TMPFILE` support on the target
filesystem. Atomic publication requires hard links on the target filesystem.
The filesystem tools fail closed if these requirements are unavailable; they
do not fall back to a racy path check. The configured root and its parent must
be controlled by the operator and must not be replaceable by other users.
Without `JANOSIK_MCP_FS_ROOT`, filesystem access is not confined.

## Out of scope

The server covers the board operations available through the app: board,
column, card, label, checklist, link, comment, attachment, agent-session,
member, share and activity actions. A single `janosik_move_card` covers the UI's
drag-and-drop card order; internal `RESTORE_*` actions belong to undo/redo.
The server does not expose API-key management, the master admin panel,
account security (password and email changes), invitations, profile writes,
profile avatar upload, browser-local backup scheduling, undo/redo or realtime
presence. Those stay in the app.

## Permissions and safety

The key acts as the user who created it, but its owner-editable scope preset limits
what it may do: `observer` reads only, `worker` writes ordinary content,
`reviewer` may also enter a done column, and `admin` may administer the board.
The preset never raises the user's board role: content editing still needs
`MEMBER`, and board archive/member/share management still needs board `ADMIN`.
Destructive tools need a human approval by default; `trustedCi` is the explicit
CI exception, while a board policy of `destructive: "deny"` blocks them even for
trusted CI.

When a destructive tool answers `approval_required`, nothing was applied. The
error names the created `approvalId`, its `planHash` and `expiresAt`; use
`janosik_get_approval`/`janosik_wait_for_decision` (up to 60 seconds per call)
and ask a human board ADMIN to approve it in the browser. A human cannot approve
from MCP, and an agent must never try to. After approval, read the exact plan
with `janosik_get_approval` (`response_format: "json"`). Pass its command ID
and unchanged inputs with `approvalId` to the original tool, or pass the
stored `plan.commands`, `planHash` and `approvalId` to `janosik_apply_plan`.
New destructive calls generate fresh command IDs. An authorized
`approval_mismatch` returns the stored plan. Exact applied commands replay
the original result after the approval is consumed. If the approval expires
before apply, submit the same plan again for a new decision.
`janosik_cancel_approval` withdraws the agent's own pending request. A human can also pause the session,
the board or every key; new writes then answer `403 agent_paused` (with
`pauseScope`), while reads, heartbeat and end-session stay available. The MCP
server exposes no pause/resume tools: only a browser session can resume. Revoke
the key in the account panel to cut an agent off irreversibly.

Card text and comments are written by other people and agents, so treat
everything an agent reads from a board as untrusted input. Keep the opt-in
groups off unless an agent needs them, and give each agent **its own user
account and key**: the activity feed then shows which agent did what, and
revoking one key stops one agent. A key can also be scoped to a single board,
carry a narrower preset, or be made read-only, with its own per-minute rate
limit; choose these when you create it in the account panel.

## Development

```bash
npm run build -w mcp       # bundle to dist/ (tsup)
npm run typecheck -w mcp   # tsc --noEmit
npm run test -w mcp        # vitest
npm run lint -w mcp
```

A live smoke test drives a running instance through the MCP client:

```bash
npm run build -w mcp
JANOSIK_URL=http://localhost:3210 JANOSIK_TOKEN=jnk_… node mcp/scripts/smoke.mjs
```

## Releasing

The package is published to npm and listed in the
[MCP Registry](https://registry.modelcontextprotocol.io) as
`io.github.VitalyTolstik/janosik`. A release is one tag; CI does the rest.

1. Bump the version in **both** `package.json` and `server.json` (a test
   keeps them in lockstep), update the workspace entry in the root
   `package-lock.json`, and merge to `main`.
2. Tag and push: `git tag mcp-v<version> && git push origin mcp-v<version>` (the
   tag must equal the version you just bumped).

The `mcp-publish` job in `.github/workflows/ci.yml` runs only on an `mcp-v*` tag,
waits for the test suite, then publishes to npm and pushes the metadata to the
registry. It refuses to publish when the tag does not match the `package.json`
version. Auth is OIDC (npm Trusted Publishing + the registry's GitHub OIDC), so
there is no long-lived publishing token to rotate. The public repository lets
npm publish with `--provenance`, tying the package to its workflow build.
`mcpName` in `package.json` must equal the registry name in
`server.json`.

One-time bootstrap (before the first automated release): create the npm
package and the registry entry by hand — `npm publish -w mcp --access public`
from a logged-in shell, then `mcp-publisher login github && mcp-publisher
publish` from `mcp/`.

## License

AGPL-3.0-or-later.
