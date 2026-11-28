---
title: MCP server
description: Let AI agents read and manage a board with the Janosik MCP server and its behavior skill, using a personal API key.
---

The `@janosik/mcp` server exposes a board to any MCP client (Claude, Cursor,
VS Code, opencode, Codex). An agent uses a personal API key to read boards,
create and move cards, update checklists, assign work and reserve tasks. It can
also add comments, link cards and manage public share links. It exposes **87
tools in 16 groups**: 13 groups are enabled by default and `members`, `shares`
and `account` are opt-in.

Board edits go through the command log and appear live on open boards. MCP
edits do **not** enter the browser's local undo stack; use unarchive or an
explicit compensating edit to correct them. Comments, attachments, membership
and share links use REST and are not command-log entries.

## Setup

Create a key in **Account → API keys** (it starts with `jnk_`), then add the
server to your MCP client. This example uses the `mcpServers` configuration
format; adapt it to your client’s MCP settings if needed:

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

`JANOSIK_URL` is your instance origin and `JANOSIK_TOKEN` is the key. Both can
also be passed as `--url` and `--token` flags (prefer `env` for the token: a
flag shows up in the local process list). The server needs the instance running
and reachable at `JANOSIK_URL` — for example `http://localhost:3000` when you run
from source. Add `JANOSIK_APP_BASE` (e.g. `/app`) when the app is not served at
the site root; it is used to build board links. The self-host image serves the
app under `/app/`, so set `JANOSIK_APP_BASE=/app` there.

`janosik_upload_attachment` reads local files, and `janosik_download_attachment`
writes them. With `outputPath`, `janosik_export_board`, `janosik_get_card`,
`janosik_get_run` and `janosik_get_approval` also write local files. Enable
filesystem access with `JANOSIK_MCP_ALLOW_FS=1`. Set
`JANOSIK_MCP_FS_ROOT=/path` to confine it to a directory and reject symlinks
that lead outside it. Existing files are never overwritten. File writes are
atomic, use mode `0600` on POSIX and require hard links on the target
filesystem. Write failures return `filesystem_error`. Confinement requires
Linux x64/arm64, `python3`, `/proc` and a kernel with `openat2`. Confined
writes also require `O_TMPFILE` support on the target filesystem.

### Shared HTTP gateway for many agents

One stdio process per agent costs roughly 100 MB of memory. For a swarm, run
the separate gateway container instead; it serves many MCP sessions from one
Node process:

```bash
docker compose --profile mcp up -d
# MCP endpoint: http://127.0.0.1:8080/mcp

# plain Docker: the stop timeout must exceed the 10 s drain window.
# `host.docker.internal` works on Docker Desktop; on Linux use the host IP.
docker run --rm -p 127.0.0.1:8080:8080 --stop-timeout 20 \
  -e JANOSIK_URL=http://host.docker.internal:3000 janosik-mcp
```

Compose sets `stop_grace_period: 20s`; on SIGTERM the gateway stops admitting,
lets an active tool call finish (up to 10 s), then closes sessions/streams.

Each client connects to `https://your-gateway/mcp` with **its own** key in
`Authorization: Bearer jnk_…`; the gateway never receives a shared
`JANOSIK_TOKEN` (absent is normal; present is ignored with a warning). Local
admission comes first: a global cap, a per-key cap (default
`min(50, MAX_SESSIONS)` sessions),
per-IP and per-token initialize buckets, and a short negative cache. Only then
does the gateway validate the key against `/api/v1/auth/me` (invalid keys
`401`, API rate limits `429`, outage `503`), sharing one call between
concurrent initializes and retrying a one-shot API `429`/`503` within a small
`Retry-After` bound. It binds the key to that session and rejects a different
key with `403`.

Successful MCP POSTs are SSE streams; gateway errors are JSON. A reverse proxy
needs buffering off and a read timeout above the longest tool call. SSE uses
`no-cache, no-transform`; errors and health use `no-store`. `GET /health` is
liveness and reports `bodyReads.session` / `bodyReads.initialize`; `GET /ready`
checks API reachability (not a key) and returns `503` + `Retry-After` when not
ready. Sessionless and tool bodies have separate per-IP/per-token budgets with
global backstops; a full gate answers `503 body_busy` + `Retry-After`, and
JSON-RPC batches are rejected. During drain, unknown paths still `404` and
disallowed origins `403`, while other MCP
requests get `503 shutting_down`.

**Sessions are in-memory.** Restarting the gateway drops every session;
clients reconnect and initialize again. Multiple replicas need a
session-affine proxy (or clients must accept reconnects) because there is no
shared session store. Limits come from `JANOSIK_MCP_HTTP_MAX_SESSIONS`
(default 500), `JANOSIK_MCP_HTTP_MAX_SESSIONS_PER_TOKEN` (default
`min(50, MAX_SESSIONS)`; `0` = unlimited),
`JANOSIK_MCP_HTTP_INIT_RATE_LIMIT` (default 600/IP/min) and the idle expiry
(default 5 minutes); an in-flight call or open stream is never swept. A key's
default 10 initialize attempts/min is below its 50-session cap; raise
`JANOSIK_MCP_HTTP_INIT_RATE_LIMIT_PER_TOKEN` if one key must reach its per-key
session cap immediately. The Compose service also sets a 2 GB memory limit and 2 CPUs. The API
still enforces the key's board scope, role, preset and rate limit.

For a large first-time swarm, 500 new keys in one minute exceed the API's
default `THROTTLE_LIMIT=300`: raise it, the gateway initialize limit, the
4/IP–32 global init body gates, the 64 validation in-flight cap and proxy
limits together, and set `JANOSIK_MCP_HTTP_TRUST_PROXY=1` behind a trusted
proxy. Before exposing the gateway check TLS, the `127.0.0.1` bind, the origin
allowlist, the absence of a shared token and the per-token cap.

## Tools

Tools come in groups. By default the server registers the groups that work
the board: boards, columns, cards, labels, checklists, card links, comments,
activity, attachments, agent sessions, approvals, plans and runs. The groups that
change who can see a board or act on your account (`members`, `shares`,
`account`) are opt-in:

| Setting | Effect |
| --- | --- |
| `JANOSIK_MCP_TOOLSETS` | Comma-separated groups, e.g. `default,members`, or `all`. |
| `JANOSIK_MCP_READONLY=1` | Only tools that never change anything. |

Account-only actions are not exposed as tools: invitations, profile writes and
key management are session-only, so the server removes those tools entirely.
The token's scope is enforced by the API: an `observer` cannot write, a
`worker` cannot enter a done column or administer the board, and a destructive
tool (`delete_card`, `clear_column`, `delete_board`, share/member changes)
answers `approval_required` unless the token is marked `Trusted CI`. A board
policy of `destructive: "deny"` returns `destructive_denied` for every agent.
Do not retry these errors with the same token; report the blocker or ask a
human.

`approval_required` is a queue, not a dead end. Call
`janosik_request_approval` with the exact plan (or use the `approvalId` the API
already returned), then `janosik_wait_for_decision` for up to 60 seconds per
call. `janosik_get_approval`/`janosik_list_approvals` show the status, and
`janosik_cancel_approval` withdraws the agent's own pending request. A human
board ADMIN decides in the browser. After approval, read
`janosik_get_approval` with `response_format: "json"`. A new destructive tool
invocation uses a fresh command ID. To apply a single approved command with
its original tool, pass the approved `approvalId` and the exact `commandId`
and inputs from the stored plan. The `approvalId` is sent as `X-Approval-Id`.
For a batch or a command with generated fields, pass the stored
`plan.commands`, `planHash` and `approvalId` to `janosik_apply_plan`.
An authorized `approval_mismatch` response includes the stored plan. After
success the approval is `consumed`, and an exact command replay returns the
original result. If the apply window ends, submit the exact plan again with
`janosik_request_approval` to obtain a new request ID.

For multi-step and bulk edits use the plan pair. `janosik_plan_changes` is a
dry run: it validates every command, replays the reducer in memory and returns
the canonical `planHash`, a before/after diff, warnings and conflicts; nothing
is written and no run is created. Pass the returned commands and hash unchanged
to `janosik_apply_plan`, which applies them atomically in one board
transaction. A changed hash is `approval_mismatch`; a destructive plan without
approval is `approval_required`, and after a human approves the exact hash you
repeat the same call with `approvalId`. The per-plan limit is 100 commands and
50 card creates (`min` with the board policy); split a larger job into several
plans — there is no cross-plan atomicity. An applied plan creates one
`kind: "plan"` run.

Every PAT batch, every single destructive PAT command and every PAT plan apply
creates one board-scoped **run**. `janosik_list_runs` and `janosik_get_run`
show what an agent changed, with the token, session, command range and
attribution. `janosik_preview_run_revert` is a dry run: it returns the
conflicts and whether the run can be rolled back, and writes nothing. Applying the rollback is a human board-ADMIN action in the
browser — no MCP tool can revert a run (ADR D17). If a preview reports
conflicts, do not try to force it; report the touched entities and let a human
decide.

A human can also pause an agent, a board or every token at once. New writes then
answer `403 agent_paused` with `pauseScope` (`session`, `board` or `token`) and
`retryable: false`. Reads and the session control plane stay available:
`janosik_heartbeat` and `janosik_end_session` still work so the agent can finish
cleanly. Do not retry a paused write and do not try to create a new key; stop,
report the pause scope and wait for the human to resume. The MCP server
deliberately exposes no pause/resume tools — those are browser-session only, so
an agent cannot clear the pause that stopped it. Revoking the key
(`DELETE /users/me/tokens/:id`) is the irreversible kill.

Data-reading tools accept `response_format: "markdown"` (default) or `"json"`. The
tool names all start with `janosik_` so they sit alongside other servers
without clashing.

For `janosik_get_card`, `janosik_get_run` and `janosik_get_approval`, pass
`outputPath` (for example, `details.json`) to save the complete JSON document
when it exceeds the 25,000-character tool response budget. The file contains
the same authorized data as the inline JSON response. The tool returns
`{ ok: true, outputPath }` with the resolved path. File output requires
`JANOSIK_MCP_ALLOW_FS=1` and write-enabled MCP mode. Relative paths resolve
against `JANOSIK_MCP_FS_ROOT` when set, otherwise against the MCP server's
working directory. Existing files are never overwritten.

A typical run:

1. `janosik_list_boards` to find a board.
2. `janosik_get_board` to read its columns, cards, labels and the board version
   (`seq`); pass `columnId` on a large board, or `detail: "summary"` to skip
   each card's description and checklists.
3. `janosik_list_ready_cards` to find work (unassigned, unclaimed and unblocked,
   most urgent first) — or `janosik_wait_for_work` to block until one appears
   instead of polling.
4. Focused tools to act, for example `janosik_create_card` then
   `janosik_move_card` and `janosik_add_comment`.

### Common flows

Tool arguments are ordinary JSON; your client displays the result as text plus
`structuredContent`. Names omit the `janosik_` prefix here for readability only.

```json
{ "tool": "whoami", "arguments": { "response_format": "json" } }
{ "tool": "list_boards", "arguments": {} }
{ "tool": "get_board", "arguments": { "boardId": "b1", "detail": "summary" } }
{ "tool": "create_card",
  "arguments": { "boardId": "b1", "columnId": "col1", "title": "Fix login" } }
```

`whoami` returns `{ user, token, session, server }`; `server` carries the live
release and `apiVersion: "1"`. `create_card` returns `{ ok: true, resourceId,
seq, runId }`; `resourceId` is the new card id.

**Plan / apply (bulk or multi-step).** Build the commands, preview them, then
apply exactly the returned commands and hash:

```json
{ "tool": "plan_changes",
  "arguments": {
    "boardId": "b1",
    "commands": [
      { "commandId": "cg-001", "action": {
          "type": "ADD_CARD", "newCardId": "card-1",
          "columnId": "col-1", "title": "Bulk card" } },
      { "commandId": "cg-002", "action": {
          "type": "SET_CARD_PRIORITY", "cardId": "card-1", "priority": "high" } }
    ]
  } }
```

The preview returns `planHash`, `plan`, `diff`, `warnings`, `conflicts` and
`canApply`. Pass the same `commands` and `planHash` to `apply_plan`; add
`approvalId` if the preview says approval is required. The apply returns
`{ seq, runId, planHash, results }`.

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

`request_approval` returns `{ approval: { id, status: "pending", planHash,
expiresAt } }` and applies nothing. `wait_for_decision` polls up to 60 seconds
per call; repeat it while the status is `pending` (the overall deadline is the
approval's `expiresAt`). Only a human board ADMIN can approve in the browser.

**Runs.**

```json
{ "tool": "list_runs",
  "arguments": { "boardId": "b1", "kind": "plan", "limit": 20 } }
{ "tool": "get_run", "arguments": { "boardId": "b1", "runId": "run-1" } }
{ "tool": "preview_run_revert",
  "arguments": { "boardId": "b1", "runId": "run-1" } }
```

The preview returns `{ dryRun: true, run, conflicts, canRevert }` and writes
nothing. Applying the rollback is a human board-ADMIN action in the browser;
there is no MCP tool for it.

**Session lifecycle.**

```json
{ "tool": "start_session",
  "arguments": { "boardId": "b1", "name": "nightly-fix", "model": "agent-x" } }
{ "tool": "heartbeat",
  "arguments": { "boardId": "b1", "sessionId": "sess-1", "status": "active" } }
{ "tool": "end_session",
  "arguments": { "boardId": "b1", "sessionId": "sess-1", "status": "completed" } }
```

The client attaches `X-Agent-Session` to later writes automatically. Heartbeat
and end stay available while paused, so an agent can finish cleanly.

**Pause / resume (human-only).** There are no MCP pause tools. A browser
session can call the API directly:

```http
POST /api/v1/boards/b1/agents/pause
Authorization: Bearer <browser access JWT>
Content-Type: application/json

{ "reason": "Stop the nightly agent" }
```

The same shape works for `/boards/b1/agents/resume`,
`/boards/b1/agent-sessions/sess-1/pause|resume`, `/users/me/tokens/tok-1/pause|resume`,
`/agents/pause-all` and `/agents/resume-all`. A PAT calling one gets
`403 pat_forbidden`.

A write that changes nothing (for example an id that is not on the board)
comes back as an error, so an agent never mistakes it for success. Tools that
compute a write from a read retry when another agent changed the board in
between. Command-log write tools accept `expectedVersion` (the board `seq` from
`janosik_get_board`): pass it and the write is refused if the board changed
since, instead of silently overwriting another agent's edit. Create tools take a
client id (`cardId`, `checklistId`, …) reused as the idempotency key, so a
retried call returns the first entity rather than a duplicate. The REST-backed
writes (`janosik_create_board`, `janosik_duplicate_card`,
`janosik_add_comment`, `janosik_create_share`, `janosik_upload_attachment`)
also accept `idempotencyKey`: reuse it only for the same request body.

Successful command-log mutations return `structuredContent` with `ok: true`,
`seq` and `runId` (`null` when no run was recorded). A batch returns the
highest sequence from its results and the batch run ID. Use `seq` as
`expectedVersion` for a subsequent write. The result may also carry
`resourceId` or `approvalId`. Errors stay `isError: true` and additionally carry
`structuredContent` with `ok: false`, the server's `code`, `retryable`,
`requestId` and any conflict details (`currentVersion`, `allowedToColumnIds`,
`approvalId`/`expiresAt`). Read the code, not the sentence:

- `retryable: false` (validation, scope, workflow, approval) — do not repeat the
  same call; fix the input or ask a human.
- `version_conflict` — re-read the board with `janosik_get_board` and rebuild the
  write; do not blind-retry the same `expectedVersion`.
- `approval_required` — stop and wait for a human; nothing was applied.
- `idempotency_conflict` — the key was reused with another body; send the new
  intent under a fresh key.
- `rate_limited` / queued `503 rate_limited` — the MCP server already retried
  these automatically up to four times with jitter; if one still comes back,
  wait `retryAfter` or a moment and retry the identical request.
- `request_timeout` / `board_write_timeout` / `service_unavailable` — retryable;
  resend the identical request with the same `commandId` and, for REST writes,
  its `Idempotency-Key`. A `502`/`504` can follow an unkeyed write, so do not
  repeat an unkeyed REST write blindly.

## The skill: teach the agent how to work

The **`janosik` skill** provides a workflow for using the tools and keeping a
card’s progress clear to other team members:

- **Read before writing** — list the boards, read the board, read the card's
  comments and activity before touching anything.
- **Claim and fill the card** — assign it to itself, move it to *In Progress*,
  and write a description and checklist that stand on their own.
- **Comment at every step** — a short note when it picks the card up, when a
  step is done, and when it hands the card over. The comment thread is the
  card's story.
- **Move it forward** — Backlog → In Progress → Review → Done, with a human gate
  at Review.
- **Return it on a bug** — if the card is wrong or breaks something, the agent
  moves it **back** (to Bugs, or In Progress) with a comment describing the
  defect and a checklist item for the fix, instead of marking it Done. That
  backward move plus the comment is the audit trail.

Copy `skills/janosik/` into your client’s skills directory:

| Client | Directory |
| --- | --- |
| Claude Code | `~/.claude/skills/janosik/` (or `.claude/skills/` in a project) |
| opencode | `~/.config/opencode/skills/janosik/` (or `.opencode/skills/`) |
| Codex and other clients that support `.agents/skills` | `~/.agents/skills/janosik/` or `.agents/skills/janosik/` in a project |
| Clients without skills support | Add the instructions from `SKILL.md` and the relevant reference files to the client’s supported instruction file |

See the [official Codex skill
documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
for installation details. The Janosik skill references tools by name and needs
no separate configuration. It ships in
the repository under `skills/janosik/` (behavior in `SKILL.md`, plus
`references/templates.md` and `references/recipes.md`).

### The agent-ready card

The skill uses a consistent card structure so another agent can continue the
work without additional explanation:

- **Description sections** — `## Why`, `## Scope`, `## Acceptance criteria`
  (checkboxes), `## Out of scope`, `## Verify` (the exact check that proves it).
- **A `Definition of Done` checklist** — the card is Done only when every item
  is ticked; an unticked one is explained in a comment, never dropped.
- **Typed comments** — each carries a structured `kind` (`status`, `question`,
  `blocker`, `evidence`, `handoff`; omit it for a plain note), so the thread is
  machine-readable and filterable — `janosik_list_comments` filters by `kind`.
- **Labels used by the skill** — `agent:blocked`, `agent:needs-human`, `agent:verified`,
  so a human can filter the swarm's state at a glance.

### Claiming a card and the task contract

Three tools let a swarm share one board without stepping on itself:

- `janosik_claim_card` takes a temporary work lease on a card (the `CLAIM_CARD`
  command, `claimedBy` + `leaseUntil`). The lease defaults to 15 minutes and is
  clamped to between 1 minute and 24 hours. The server refuses the claim while
  another member still holds a live lease, and the card becomes available again
  when the lease expires, even if the agent has stopped responding.
- `janosik_release_card` releases the card reservation before it expires, so another agent can
  pick the card up.
- `janosik_set_card_task_spec` writes the card's machine-readable task contract:
  `acceptanceCriteria` and `definitionOfDone`, as lists of short strings an
  agent reads directly instead of parsing prose. Each field is independent (omit
  it to leave it unchanged, pass an empty list to clear it), and each list holds
  up to 50 items of at most 500 characters each. `janosik_get_card` returns the
  contract, and a board ADMIN or MEMBER can edit or clear it in the card dialog
  (VIEWERs see it read-only).

### Ready to work, and the Definition-of-Done gate

- `janosik_list_ready_cards` returns the cards an agent can pick up now: in the
  board's **initial column** (the first column when the board has no workflow),
  unassigned, not under a live claim and not blocked by another card, most
  urgent first. Both it and `janosik_wait_for_work` use the server's compact
  ready summary (`GET /boards/:id/ready`, or `GET /boards/ready` when `boardId`
  is omitted), not a full board read. A single-board wait holds for 25–60 s per
  request and wakes only on readiness-relevant changes; `pollMs` is ignored for
  that hold. Without `boardId` it re-reads the cross-board snapshot every
  15–60 s (the full range, jittered; `pollMs` raises the floor). A relevant
  wake that leaves no work keeps holding instead of returning an empty
  snapshot. `timeoutMs: 0` still performs one initial snapshot (bounded by a
  5 s HTTP budget); other snapshot calls are bounded by the remaining
  deadline. `janosik_list_ready_cards` keeps the normal GET network/429 retry
  policy. Transient
  network and `503 ready_poll_capacity`/`Retry-After` failures retry only
  within the caller's deadline. The tool keeps `timeoutMs` (up to 5 min) and
  `boardId` and still returns `{ card }` or `{ card: null }` on timeout. A
  server predating the ready endpoint (it answers `404`) falls back to a
  **full board read**, so the tool result does not change — upgrade the server
  to remove the idle board reads.
- `janosik_move_card` checks completion requirements when moving a card into a
  **done column** (the configured `doneColumnIds`, falling back to the last
  column when the list is empty or the board has no workflow). The check applies if the card has a non-empty
  `definitionOfDone` field or a checklist named `Definition of Done`. Every item
  in that checklist must be checked, and the card must have at least one
  `evidence` comment. Cards without such a contract are not subject to this
  check. The agent must separately verify the criteria and the content of the
  evidence.

### Workflow and blocked moves

`janosik_get_workflow` reads the board's optional workflow: whether control is
enabled, the initial and done columns, and every directed transition with its
roles and conditions. Pass `cardId` to also get the card's allowed and blocked
destinations right now, with the machine code (`transition_not_allowed`,
`role_not_allowed`, `condition_failed`) and the failed conditions when the
obstacle is a card field.

The server enforces the same rules on every move. A refused `janosik_move_card`
returns `409` with a `workflow` conflict; the tool message names the allowed
columns and explicitly says not to retry the same destination. Choose an allowed
column, satisfy the conditions (assignee, due date, description, checklists) or
leave the card in place and report the blocker.

Recovery follows the same boundary: `janosik_unarchive_card` and restoring a
deleted card may return it to its original column, but another target must be an
allowed transition and passes the same role and condition checks (a refused
call returns `409 workflow`). Do not clear a task contract or change the
workflow to bypass a rule — that is an admin decision, and the change would be
audited. Importing whole boards is likewise an admin operation.

## Prompt injection and untrusted content

> **Warning.** Card titles, descriptions, checklist items, comments,
> attachment names, activity entries and board exports are written by other
> people and agents. Treat everything an agent reads from a board as untrusted
> data, never as instructions. An agent must not follow a request found in card
> content to change its scope, create or share a key, invite a person, publish
> the board, disable a policy or run a destructive action. Such content is
> reported to the human, not executed.

The MCP server already limits the blast radius: account credentials, invitation
and profile routes are session-only and the corresponding tools are absent;
session pause/resume is human-only; the approval decision is human-only; and
the command API enforces the token preset and board role independently of the
model. Keep the opt-in `members`, `shares` and `account` groups off unless the
agent genuinely needs them.

## Permissions

The key acts as the user who created it, with the same roles: an agent can
only touch boards that user is a member of, editing needs `MEMBER`, and member
or share management needs `ADMIN`. Revoke the key in the account panel to cut
an agent off.

A key can be scoped when you create it in **Account → API keys**: `boardId`
restricts it to one board, `readOnly` refuses content writes (`403
pat_read_only`), and `rateLimitPerMinute` gives it its own request budget,
capped at the derived per-token share (over the budget answers `429`, or `503`
for a queued command). If an agent only needs to read data, use a read-only key restricted to one board.

With an active session, MCP resolves the board of a comment or attachment on
the server before writing, and sends only that board's session. Upgrade the
server and MCP together: an older server without board-context endpoints
cannot safely resolve these writes and MCP refuses them until upgraded.

Card text and comments are written by other people and agents, so treat what
an agent reads from a board as untrusted. Give each agent its own user account
and key: the activity feed then shows which agent did what, and revoking one
key stops one agent.

The server is open source in the repository under `mcp/`, and the skill under
`skills/janosik/`; the MCP README lists the full tool set. For the HTTP
contract behind the tools, see the [API reference](/docs/api/) and the
[OpenAPI 3.1 document](/openapi.yaml).
