# ADR-166 / TASK-166: Launch readiness — agent-first with human control

- **Status:** Accepted / frozen (2026-11-09); amended 2026-11-13 (TASK-176.11, §18)
- **Task:** TASK-166.0 "Policy & ADR"
- **Normative program source:** `ROADMAP.md` §7.23 (goals, waves,
  dependencies) and this ADR (frozen decisions, schema, matrix, codes).
- **Non-normative local materials:** `audits/launch-gaps-agent-experience.md`
  and `audits/launch-gaps-human-control.md` are research notes that are not
  tracked in git; they are context, not a contract. If an audit or the code
  conflicts with the ADR/ROADMAP, the ADR controls; resolve the conflict
  through the 166.0 owner.

This document does not change product code, the Prisma schema, tests, or UI.
It fixes decisions, the exact data schema, the action matrix, error codes,
and run boundaries so streams 166.1–166.16 can start without rework.

---

## 1. Context and goal

Janosik already has a command log, deterministic reducer, `ifMatch`, atomic
batches of up to 100 commands, claim with lease, typed comments, scoped API
tokens, SSE, share links, and MCP. None of that needs to be rewritten.

What is missing for the "Kanban primarily for AI agents, with human control"
positioning:

- an agent is only `actorType: "agent"` plus a human email; two PATs on one
  account are indistinguishable in history, SSE, and Watch;
- there is no "approval request" entity: approval is a comment and an oral
  agreement;
- destructive agent actions are not closed on the server: a MEMBER agent can
  delete cards and columns;
- there is no pause/kill switch except irreversible token revocation;
- there is no run-level audit or rollback: undo is a local browser stack of
  50 steps;
- write errors are incomplete: no unified `code`/`retryable`/`requestId`; MCP
  mutations return text;
- the "10 boards" limit contradicts the unlimited promise and clips import;
- the backup status in the panel is misleading.

**TASK-166 goal:** make the human the owner of the "which agent does what,
what is allowed, what needs approval, how to stop it, and how to roll it
back" contour without breaking self-host, old boards, or existing MCP
scenarios.

**Boundaries:** self-host OSS only. Managed cloud, billing, DPA, multi-tenant,
remote MCP/OAuth, webhooks, object storage, and SIEM are outside TASK-166
(see §16).

---

## 2. Principles

1. **An agent is an identity, not a boolean.** The owner is `User`; the actor
   is `ApiToken` + `AgentSession`; every record carries `apiTokenId`,
   `agentSessionId` (when present), `runId` (when present), and an
   `agentName` snapshot.
2. **The server is the source of truth.** UI pre-checks only explain. Scopes,
   destructive gate, WIP, workflow, pause, approval, and plan hash are checked
   on the server inside the transaction/under the board lock.
3. **Deny by default for destructive actions.** A direct destructive agent
   action is forbidden; exceptions are `ApprovalRequest` or an explicit
   `trustedCi` scope. Legacy PAT is a separate, explicitly limited exception
   (see §13).
4. **One run → one audit and one rollback.** A batch/plan and a single
   destructive action receive a `runId`; a pre-image is stored for every run
   command; a human can inspect and revert the run.
5. **Contract first, UI later.** Backend primitives do not depend on any admin
   console. Agent control surfaces are user-facing: the global `/agents` page,
   the board-scoped Agent Control modal and Board Settings → Agents &
   automation. The master panel (`/admin`) remains a support, moderation and
   investigation console; it does not manage agent runs, approvals or policy
   (TASK-176.11, §18).
6. **Do not break self-host.** New fields are nullable or have safe defaults;
   old boards, exports, and PATs keep working. All new tables are additive;
   existing fields are not renamed.
7. **Human control is not delegated to an agent.** Pause, resume, scopes,
   board policy, and approval decision are session-only (`browser JWT`), not
   PAT.
8. **No silent no-ops.** Every error has a machine-readable `code`; a mutation
   returns `structuredContent`; an idempotent retry returns the same result.

---

## 3. Terms

| Term | Meaning in TASK-166 |
| --- | --- |
| **Agent** | Not a separate table. An agent is the owner's `ApiToken` acting through MCP/REST. The owner is always a human (`User`). |
| **Agent session** | `AgentSession` is the board-scoped work context of one token: start/heartbeat/end, status, current card, pause. A session is not an account and grants no rights beyond the token. |
| **Run** | `AgentRun` is a group of commands from one batch/plan/single destructive agent action on one board. The unit of audit and rollback. |
| **Approval** | `ApprovalRequest` is a request to the PAT owner/board ADMIN for an exact action plan with `planHash` and TTL. Approval authorizes application but does not apply the plan itself. Handoff remains a typed `handoff` comment; there is no separate Handoff entity in the MVP, and `kind: "done"` approval is the formal permission to enter Done. |
| **Pause** | A reversible stop: new agent writes receive `403 agent_paused`, in-flight requests finish, SSE closes. Levels: session, token, board. |
| **Kill** | Irreversible PAT revocation (`DELETE /users/me/tokens/:id`): all sessions become `cancelled`, claims are released, new requests get `401`. There is no separate "kill session" in the MVP. |
| **Destructive action** | An action that deletes/hides existing content, bulk-archives, revokes access, or changes board membership/visibility. The exact list is in §7. |
| **Legacy token** | An `ApiToken` that existed before the TASK-166 migration. It receives `scopePreset = "admin"` and `trustedCi = true` (unless `readOnly`) to keep working as before. |
| **Board policy** | `Board.agentPolicy` (JSONB) is the board's destructive/done/approval policy for agents. `NULL` means safe defaults. |
| **trustedCi** | An explicit boolean token scope (the task text calls it `trusted_ci`; DB/API use `trustedCi`): allows destructive/sensitive actions without approval. It grants no account rights and does not override board pause/`destructive: "deny"`. |
| **Pre-image** | A snapshot of entity state before a command (`CommandPreimage`), sufficient to build an inverse command. |
| **Plan hash** | `sha256` of the canonical JSON of the executable plan (`boardId` + `commands`/`operations`), 64 hex characters. |
| **Effective token scope** | `scopePreset` ∩ `readOnly` (Observer). This is a token property, not an authorization decision: the server also applies board role, workflow, and pause. The DTO field is named `effectiveTokenScope`. |

---

## 4. Frozen decisions

### 4.1. Decisions from §7.23.1

| # | Question | Decision | Rationale | Consequences and prohibitions |
| --- | --- | --- | --- | --- |
| D1 | Self-host or managed cloud first? | Self-host OSS is the only delivery form for TASK-166. Cloud is a separate program. | The product is already self-host, AGPL, Docker; cloud requirements (billing, DPA, tenant isolation) must not block agent control. | Do not add billing, DPA, status page, multi-tenant org, or mandatory remote MCP/OAuth to TASK-166. |
| D2 | Agent = user+PAT or a separate entity? | The owner is `User`; the actor is `AgentSession` + `ApiToken` (`apiTokenId`). We do not introduce a separate `Agent` table in the MVP. | No second account system is needed; a PAT already authenticates and carries scopes. `AgentSession` provides run identity without account migration. | Do not make an "agent user" with a separate email a required scenario. `AgentSession` cannot own a board, token, or invitation. |
| D3 | Default for destructive actions | **Deny by default means direct execution is forbidden:** a destructive agent request without approval receives `approval_required`; the standard path is a human approving the exact plan. `trustedCi` is the explicit exception for trusted CI. A hard block (`destructive: "deny"`) is an opt-in board policy for everyone, including `trustedCi`. | This is the main human-control launch blocker. Approval-by-default does not depend on the MEMBER/ADMIN role; hard deny is a separate, stricter mode. | Do not treat the board ADMIN role as permission for destructive actions without approval/`trustedCi`. Do not mix `deny` (hard block) and `approval` (standard path) in one default. `trustedCi` does not override `destructive: "deny"` or board pause. |
| D4 | What is a run? | One `AgentRun` = one board-scoped batch/plan/single destructive PAT command + one `agentSessionId?`. Cross-board runs are forbidden. | One batch is already one transaction and one lock; a run is the natural unit of audit/rollback. | Do not combine commands from different boards in one run. Do not make a run an unbounded time window. |
| D5 | Pause semantics | New writes → `403 agent_paused`; in-flight transactions finish; SSE closes on the next keep-alive; resume restores writes; board-level pause and "stop all" are reversible; kill = revoke. | A transaction must not be cut in the middle and leave a half-applied batch. Irreversible kill already exists as revoke. | Do not implement pause by revoking a token. Do not let an agent call pause/resume. Do not clear claims on pause. |
| D6 | Retention | One `OpsSettings.retentionDays`: default 30, presets 30/90/365, custom 1–3650. It covers Command, CommandPreimage, Activity, AgentRun, AgentSession, terminal ApprovalRequest, and soft-deleted rows. `AdminAuditLog` and `SecurityAuditLog` keep their own longer 365-day window (TASK-166.6). | One understandable window; 30 days is enough for beta, 365 for investigations. A separate SIEM/audit tier is outside TASK-166. | Do not delete `pending` approvals by retention. Do not promise "forever" audit. |
| D7 | Attachments | Local disk as today (`UPLOAD_DIR`), with no presigned URL or object storage. | Self-host does not need S3; TASK-166 is not about the storage backend. | Do not add S3/object storage/presigned upload to TASK-166. |
| D8 | Agent undo | An agent does not get browser undo. Compensation is ordinary non-destructive commands; run rollback is a session-only human API. Browser JWT keeps normal undo: `RESTORE_*` is allowed for the role that could perform the original command (ADMIN/MEMBER), regardless of token scope. | Browser undo is the human's local history; the MEMBER "delete → undo" scenario must not break. Run rollback is controlled, checked, and audited. | Do not give PAT access to `RESTORE_*` or to apply run revert. `RESTORE_BOARD` remains an aggregate-level/local snapshot; `/commands` does not accept it. |

### 4.2. Additional frozen decisions

| # | Decision | Rationale | Consequences and prohibitions |
| --- | --- | --- | --- |
| D9 | **PAT grandfathering.** Existing tokens receive `scopePreset = "admin"`, `trustedCi = true` (when `readOnly = false`). `readOnly = true` keeps the flag and effectively means Observer. New tokens are created with `scopePreset = "worker"` and `trustedCi = false`. | This is the only way to close destructive actions by default without breaking current MCP scenarios of old PATs. | Old PATs keep board behavior, but account routes (`profile`, `tokens`, `invitations`) are closed to them as a security fix. `trustedCi` cannot be enabled through a PAT. |
| D10 | **Scope presets:** `observer`, `worker`, `reviewer`, `admin`; separate boolean `trustedCi`. A preset does not raise the board role. | Simple, explainable model; `readOnly` remains for compatibility. | `admin` grants no account rights; `trustedCi` grants no member/share/board-admin rights; `observer` cannot write. |
| D11 | **Token scopes are immutable after creation.** Changing scope means creating a new token and revoking the old one. **Amended by TASK-166.15:** the owner may edit name/scope/limits from a browser session (see §5.3). | Immutability prevents self-escalation and makes audit unambiguous. Audit stays unambiguous with an explicit before/after row. | `PATCH /users/me/tokens/:id` remains session-only and is audited; a PAT can never edit a key, and the secret is never accepted or returned. Only pause/resume/revoke were allowed before TASK-166.15. |
| D12 | **Approval authorizes but does not apply.** Approve moves the request to `approved`; the agent applies the same plan with `X-Approval-Id`. | One apply path, one transaction, idempotent `commandId`; a human does not execute a stale plan if the agent has died. | Do not auto-apply inside the decision endpoint. Approval is one-time: after apply it is `consumed`. |
| D13 | **Human control plane is session-only.** Board policy, pause/resume, token pause, approval decision, run revert, self-service export/delete are `browser JWT` only. | An agent must not weaken limits, clear pause, or approve its own plan. | PAT receives `403 pat_forbidden` on these routes; MCP does not register the corresponding tools for an agent. |
| D14 | **Board policy** is `Board.agentPolicy` JSONB + `Board.agentPolicyVersion`, edited through `PATCH /boards/:id/agent-policy` with CAS. `NULL` means defaults. | Board configuration, not content; no need to add a `BoardAction` or touch the reducer. CAS protects against two admins. | An agent must not change policy. `destructive: "deny"` is a hard block that even `trustedCi` cannot bypass. |
| D15 | **A session is board-scoped and optional for ordinary writes.** It is passed in the `X-Agent-Session` header; batch/plan/approval/destructive runs use it when present. A legacy PAT can work without a session. | Compatibility with current REST/MCP clients; a session adds attribution and per-session pause but is not the only kill switch. | A session must not write to another board. Do not treat a missing session as a bypass of token/board pause. |
| D16 | **A run is created only for PAT:** batch, plan/apply, and a single destructive `BoardAction` command. Non-command REST actions and an ordinary single non-destructive command have `runId = null`. | Do not grow the log; human browser undo is unchanged. | Cross-board runs are forbidden. A human batch through the API does not create `AgentRun`; its undo remains a UI mechanism. |
| D17 | **Run revert is human-only** (board ADMIN, browser JWT). An agent may get a dry-run/preview but cannot apply revert. | Reverting destructive actions is dangerous; a human sees conflicts and confirms. | `POST .../revert` with a PAT is forbidden. MCP exposes only `janosik_preview_run_revert`. |

| D18 | **Errors are an additive contract.** Current `{conflict, currentVersion, workflow}` and `field` are preserved; add `code`, `retryable`, `requestId`; `currentVersion` on state conflicts. | Do not break current clients and docs; new agents get a machine-readable branch. | Do not rename `conflict` categories or `pat_read_only`/`pat_forbidden`/`board_write_timeout`. |
| D19 | **The 10-board limit is removed in server mode.** `MAX_BOARDS_PER_USER` (env) defaults to `0` = no limit; an operator may set a positive cap. Local/offline mode keeps 10 as a localStorage guard. | Pricing promises unlimited; 10 is a technical offline guard, not the product. | Do not clip import at 10 boards. An import above the cap is rejected atomically with `limit_exceeded`. |
| D20 | **Import/export:** `EXPORT_SCHEMA_VERSION = 3` (adds `Board.agentPolicy`); `MAX_IMPORT_BYTES = MAX_BOARD_EXPORT_BYTES = 25 MB`; command/plan body has a separate `MAX_COMMAND_BODY_BYTES = 10 MB`; an export above the limit is an explicit error, not truncation. | "Import ≥ export" without streaming or object storage; commands must not inherit the import limit. | No silent truncate. Old v1/v2 imports work; old clients reject v3. |
| D21 | **Backup status is honest.** Janosik does not create backups. The API returns `{mode: "external" or "unconfigured", automatic: false, lastBackupAt: null, verified: false}`; the UI does not show "Automatic backups"/"Save a copy now" in server mode. | `BACKUP_DIR` is only displayed today; do not sell a backup that does not exist. | Do not write "backup healthy". Runbook: `pg_dump` + uploads volume (166.16). |
| D22 | **Account routes are unavailable to PAT.** Session-only covers account **writes** (profile/avatar `PATCH`, token create/revoke/pause, invitation accept/decline, account delete) **and sensitive account reads**: `GET /users/me/tokens`, `GET /invitations`, `GET /users/me/export/:id`/`download`. PAT keeps only identity/avatar reads: `GET /auth/me`, `GET /users/:userId/avatar`, `janosik_whoami`. MCP tools `janosik_update_profile`, `janosik_list_invitations`, `janosik_accept_invitation`, `janosik_decline_invitation` are removed. | A board-scoped PAT could read other invitations, the key list, and exports, and could change the profile. This is a security fix, not compatibility. | Old PATs lose write calls and sensitive reads; identity/avatar reads remain. A board-scoped token cannot accept invitations. |
| D23 | **Claim attribution.** `Card.claimedBy` (user id) remains; add `claimedByTokenId` and `claimedBySessionId`. The server fills them from the principal; a client cannot forge them. | Two PATs on one account must be distinguishable; legacy UI keeps working. | Do not trust token/session ids from the `CLAIM_CARD` payload. Claim conflict compares session, then token, then legacy user id. |
| D24 | **SSE attribution and pause.** Command/Activity frames carry `apiTokenId`, `agentSessionId`, `runId`, `agentName`; add `approval` and `agent` events. PAT-SSE closes on pause. | Watch and humans must see who acts; pause must stop the stream. | Do not lose `actorType` in SSE. Human SSE does not close on pause. |
| D25 | **REST idempotency.** `Idempotency-Key` (8–128 `[A-Za-z0-9_-]`) for create board/import/share/upload; `add_comment` uses the existing body `commandId`; `duplicate_card` and other commands use `commandId`. A repeat with the same key and body returns the stored response; a different body gets `idempotency_conflict`. | Agent retries must not create duplicates. | The key lives for 24 hours. An `in_progress` repeat gets `idempotency_in_progress` with `retryable: true`. |

**TASK-166.17 clarification:** legacy `readOnly` PATs and observer presets can
start, heartbeat and end their own agent session and request a revert preview;
these narrow control routes do not authorize content writes. MCP resolves
card, comment and attachment board context before attaching a board session.
Share expiry is part of the approved and idempotent intent: `expiresInHours`
takes precedence over the absolute compatibility fallback. Lifecycle approval
claims are reopened only after a failure known to precede commit; ambiguous
outcomes remain consumed and must not be applied again.

---

## 5. Scope model

### 5.1. Presets

| Preset | Read | Ordinary content write | Destructive | Board administration | Account |
| --- | --- | --- | --- | --- | --- |
| `observer` | yes | no | no | no | no |
| `worker` | yes | yes | no (approval/`trustedCi` only) | no | no |
| `reviewer` | yes | yes | no (approval/`trustedCi` only) | no | no |
| `admin` | yes | yes | yes, but approval/`trustedCi` only | yes | no |

Presets are ordered: `observer` ⊂ `worker` ⊂ `reviewer` ⊂ `admin`; the matrix
below states the minimum preset, and a higher preset inherits the permission.

Additional rules:

- `reviewer` = `worker` + permission to move a card into a done column.
  `doneColumnIds = Board.workflow?.doneColumnIds ?? []`; without a workflow
  there are no done columns, and `reviewer` is effectively `worker`.
- `admin` does not get destructive actions directly: destructive actions go
  through approval unless `trustedCi` is enabled.
- `readOnly = true` always yields an effective `observer`, even when
  `scopePreset = "admin"` (this is how old read-only PATs migrate).
- `trustedCi` is an orthogonal boolean. It does not change the preset and
  grants no member/share/board-admin rights. `trustedCi` can be enabled only
  when creating a token from a browser session.
- The board role (`ADMIN`/`MEMBER`/`VIEWER`) is applied first. An `admin`
  token owned by a MEMBER cannot manage members; a `worker` token owned by an
  ADMIN cannot delete cards without approval.

### 5.2. Effective scope

Evaluation order for every request:

```
if token.revokedAt or token.expiresAt <= now: 401
if token.individualPausedAt or token.stopAllPausedAt: pause = "token"
if board.agentsPausedAt: pause = "board"          // board-scoped routes only
if session.pausedAt: pause = "session"            // only when a session is named
if readOnly: effectiveTokenScope = observer
else: effectiveTokenScope = scopePreset
if boardRole == VIEWER: write = false
if action requires ADMIN and boardRole != ADMIN: deny
if action requires scope > effectiveTokenScope: deny
```

`trustedCi` is checked only after scope and the destructive policy:

```
if destructive:
  if board.agentPolicy.destructive == "deny": deny
  if effective == observer: deny
  if trustedCi: allow
  else: approval required
```

The default board policy is `destructive: "approval"`: direct execution is
forbidden, and approval is the standard path. `destructive: "deny"` is a
deliberate hard block that even `trustedCi` cannot bypass.

Approval **does not raise scope**: a `worker` that needs `admin` for
member/share/board delete receives `scope_denied`, not `approval_required`.

A human browser JWT does not pass through the preset/destructive gate:
existing board roles and route rules apply. Approval and `trustedCi` apply
only to PATs (`actorType: "agent"`); a human is not required to approve their
own actions.

### 5.3. Token in the API

`UserTokenDto` and `CreateUserTokenRequest` are extended:

```ts
type ScopePreset = "observer" | "worker" | "reviewer" | "admin";

interface UserTokenDto {
  // existing fields are unchanged
  scopePreset: ScopePreset;
  trustedCi: boolean;
  individualPausedAt: number | null;
  individualPausedBy: string | null;
  individualPausedReason: string | null;
  stopAllPausedAt: number | null;
  stopAllPausedBy: string | null;
  paused: boolean; // individualPausedAt != null || stopAllPausedAt != null
  effectiveTokenScope: ScopePreset; // observer when readOnly; not authorization
}

interface CreateUserTokenRequest {
  // existing fields are unchanged
  scopePreset?: ScopePreset; // default "worker"
  trustedCi?: boolean; // default false; session JWT only
}
```

`readOnly` remains in the DTO for one release cycle as deprecated
compatibility; the new UI writes `scopePreset`. The server accepts both
fields; `readOnly` wins.

**TASK-166.15 amendment.** `PATCH /users/me/tokens/:id` lets the owner edit
`name`, `boardId`, `readOnly`, `rateLimitPerMinute`, `scopePreset` and
`trustedCi`; omitted fields keep their value, `null` clears the board scope or
the rate limit. The route is session-only (`pat_forbidden` for any PAT), the
owner is checked (`404` for another user's key), `trustedCi` is refused for an
Observer/read-only key, and every change writes a `token.updated`
`SecurityAuditLog` row with before/after values. The plaintext and hash never
appear in the response. This supersedes D11 for owner-session edits.

---

## 6. Data schema

### 6.1. General rules

- All new fields in existing tables are nullable or have a safe default; no
  existing field is renamed.
- New audit tables (`AgentSession`, `AgentRun`, `ApprovalRequest`,
  `CommandPreimage`, `SecurityAuditLog`, `IdempotencyRecord`) store ids as
  scalars, without FKs to `Board`/`User`/`Card`. Reason: a record must survive
  soft-delete and purge; a cascade must not erase audit before retention. This
  is the same approach as `BoardShareAuditLog`.
- `Command`/`Activity`/`Card`/`Board`/`ApiToken` receive only nullable fields
  or fields with defaults.
- `CommandPreimage` is 1:1 with `Command`, but without an FK; it is cleaned by
  the same sweep.
- All `DateTime` values are UTC; ids are `cuid()`/client ids, as in the
  current schema.

### 6.2. `ApiToken`

Add:

```prisma
model ApiToken {
  // ...existing fields unchanged...
  scopePreset String  @default("worker") // observer|worker|reviewer|admin
  trustedCi   Boolean @default(false)
  // Two independent pause sources: resume-all touches only stopAll*.
  individualPausedAt     DateTime?
  individualPausedBy     String?
  individualPausedReason String?
  stopAllPausedAt        DateTime?
  stopAllPausedBy        String?

  @@index([userId, individualPausedAt])
  @@index([userId, stopAllPausedAt])
}
```

`boardId`, `readOnly`, `rateLimitPerMinute`, `lastUsedAt`, `expiresAt`, and
`revokedAt` remain. `lastUsedAt` is still updated at most once every 60
seconds.

### 6.3. `Board`

```prisma
model Board {
  // ...existing fields unchanged...
  agentPolicy        Json?
  agentPolicyVersion Int       @default(1)
  agentsPausedAt     DateTime?
  agentsPausedBy     String?
  agentsPauseReason  String?
}
```

`agentPolicy = NULL` means defaults:

```json
{
  "schemaVersion": 1,
  "destructive": "approval",
  "requireApprovalFor": [
    "member.invite",
    "member.update",
    "member.remove",
    "share.create",
    "share.update",
    "share.revoke",
    "share.delete",
    "attachment.delete",
    "delete_board",
    "workflow.update"
  ],
  "approverRoles": ["ADMIN"],
  "maxCommandsPerRun": 100,
  "maxCardsPerRun": 50,
  "approvalTtlMinutes": 60
}
```

Policy validation rules:

- `schemaVersion` = 1;
- `destructive` ∈ `{ "approval", "deny" }`;
- `requireApprovalFor` is a subset of the fixed list:
  `move_to_done`, `delete_card`, `delete_column`, `delete_label`,
  `delete_checklist`, `delete_checklist_item`, `archive_column_cards`,
  `delete_board`, `member.invite`, `member.update`, `member.remove`,
  `share.create`, `share.update`, `share.revoke`, `share.delete`,
  `attachment.delete`, `workflow.update`;
- `approverRoles` in the MVP is strictly `["ADMIN"]`; other values get 400;
- `maxCommandsPerRun` 1–100, `maxCardsPerRun` 1–50, `approvalTtlMinutes`
  5–1440; policy may only **lower** the global limits; values above the hard
  limits are rejected, not silently clamped;
- `SET_BOARD_WORKFLOW` remains a separate `BoardAction` and is not a
  destructive classification; its approval is governed by the
  `workflow.update` entry in `requireApprovalFor` (enabled by default policy).

`PATCH /boards/:id/agent-policy` is session-only board ADMIN:
`{ "policy": { ... } | null, "version": 1 }`. `null` restores the defaults.
`agentPolicyVersion` increments on every PATCH; an old version gets
`409 version_conflict` with `details.currentVersion`. `GET
/boards/:id/agent-policy` returns `{ policy, effective, version, paused,
pausedAt, pausedBy, pauseReason }` for the same session-only board ADMIN and is
the dashboard's read path (TASK-166.15).

`agentsPausedAt` is operational state, **not** exported or imported. Pause
does not survive a board transfer.

Effective limits for batch/plan/approval:

```
maxCommands = min(COMMAND_BATCH_MAX=100, policy.maxCommandsPerRun)
maxCards    = min(50, policy.maxCardsPerRun)  // ADD_CARD/DUPLICATE_CARD/DUPLICATE_COLUMN
effectiveTtlMinutes =
  clamp(min(request.ttlMinutes ?? policy.approvalTtlMinutes,
            policy.approvalTtlMinutes), 5, policy.approvalTtlMinutes)
```

Exceeding `maxCommands`/`maxCards` returns `409 limit_exceeded` with `limit`
and `current`; a TTL below 5 minutes is raised to 5, and a TTL above policy
is cut to policy. A TTL request cannot bypass policy.

### 6.4. `Card`

```prisma
model Card {
  // ...existing fields unchanged...
  claimedByTokenId   String?
  claimedBySessionId String?

  @@index([claimedByTokenId])
  @@index([claimedBySessionId])
}
```

`claimedBy` (user id) remains for the old UI and old claims. The server writes
all three fields from the principal; the `CLAIM_CARD` payload cannot set
token/session. Conflict resolution compares `claimedBySessionId` first, then
`claimedByTokenId`, then legacy `claimedBy`; the lease remains the source of
truth for time.

Attachments also get token attribution for the "own upload" rule:

```prisma
model Attachment {
  // ...existing fields unchanged...
  uploadedByTokenId   String?
  uploadedBySessionId String?

  @@index([uploadedByTokenId])
  @@index([uploadedBySessionId])
}
```

`Comment.apiTokenId` is added in §6.9. Old rows in both tables have `NULL`:
the self rule falls back to matching `userId` for them.

### 6.5. `AgentSession`

```prisma
model AgentSession {
  id              String    @id @default(cuid())
  userId          String
  apiTokenId      String
  boardId         String
  name            String?   @db.VarChar(100)
  clientName      String?   @db.VarChar(100)
  model           String?   @db.VarChar(100)
  status          String    @default("active")
  // active|idle|waiting_approval|completed|failed|cancelled
  currentCardId   String?
  currentRunId    String?
  startedAt       DateTime  @default(now())
  lastHeartbeatAt DateTime  @default(now())
  endedAt         DateTime?
  endReason       String?
  pausedAt        DateTime?
  pausedBy        String?
  pausedReason    String?
  summary         String?   @db.Text

  @@index([apiTokenId, status])
  @@index([boardId, status, lastHeartbeatAt])
  @@index([boardId, startedAt])
  @@index([userId, startedAt])
  @@index([lastHeartbeatAt])
}
```

- `pausedAt` is the session's individual pause; token/board pause is computed
  as an overlay and is not written into the session.
- `lastHeartbeatAt` is updated by an explicit heartbeat and (at most once
  every 60 s) by a successful write with `X-Agent-Session`.
- The API marks a session `stale` when `lastHeartbeatAt` is older than 5
  minutes; this is a computed field, not a separate DB status.
- `currentCardId`/`currentRunId` are UI hints; they do not replace `Command`.

### 6.6. `AgentRun`

```prisma
model AgentRun {
  id             String    @id @default(cuid())
  boardId        String
  apiTokenId     String?
  agentSessionId String?
  actorId        String
  kind           String // batch|plan|single|revert
  status         String    @default("applied") // applied|reverted|failed
  clientRunId    String?
  planHash       String?
  approvalId     String?   @unique
  commandCount   Int       @default(0)
  firstSeq       BigInt?
  lastSeq        BigInt?
  revertsRunId   String?
  createdAt      DateTime  @default(now())
  appliedAt      DateTime  @default(now())
  revertedAt     DateTime?

  @@unique([boardId, clientRunId])
  @@index([boardId, createdAt])
  @@index([agentSessionId, createdAt])
  @@index([apiTokenId, createdAt])
}
```

- `id` is the canonical `runId`, generated by the server. `clientRunId` is an
  optional client idempotency key, unique within the board.
- `kind = "single"` is a single destructive PAT command.
- `status = "reverted"` is set on the original run after a successful revert;
  revert creates a new run with `kind = "revert"` and `revertsRunId`.
- `approvalId` is filled when an approved plan is applied; uniqueness
  guarantees one-time use.
- `firstSeq`/`lastSeq` are the `Command.seq` range; nullable for a failed run.

### 6.7. `ApprovalRequest`

```prisma
model ApprovalRequest {
  id               String    @id @default(cuid())
  boardId          String
  cardId           String?
  requestedBy      String    // PAT owner userId
  requestedByTokenId String
  agentSessionId   String?
  kind             String // destructive|done|custom
  actionType       String // BoardAction.type | "batch" | operation (e.g. "share.create")
  summary          String    @db.VarChar(500)
  risk             String    @default("medium") // low|medium|high
  plan             Json
  planHash         String
  status           String    @default("pending")
  // pending|approved|rejected|expired|cancelled|consumed
  expiresAt        DateTime
  decidedBy        String?
  decidedAt        DateTime?
  decisionComment  String?   @db.Text
  runId            String?   // AgentRun.id, filled on consume
  consumedAt       DateTime?
  createdAt        DateTime  @default(now())

  @@index([boardId, status, createdAt])
  @@index([requestedByTokenId, status])
  @@index([expiresAt, status])
  @@index([planHash])
}
```

`plan` is the exact executable plan:

```json
{
  "schemaVersion": 1,
  "boardId": "board-…",
  "commands": [
    {
      "commandId": "cmd-…",
      "action": { "type": "DELETE_CARD", "cardId": "card-…" },
      "ifMatch": 42,
      "ifMatchVersions": { "card:card-…": 7 }
    }
  ]
}
```

For lifecycle actions that are not `BoardAction`, the plan contains
`operations` instead of `commands` (exactly one operation in the MVP):

```json
{
  "schemaVersion": 1,
  "boardId": "board-…",
  "operations": [
    {
      "op": "share.create",
      "target": { "boardId": "board-…" },
      "body": { "mode": "live", "includeComments": false }
    }
  ]
}
```

Whitelist: `board.delete`, `member.invite`, `member.update`,
`member.remove`, `share.create`, `share.update`, `share.revoke`,
`share.delete`, `attachment.delete`. `commands` and `operations` are mutually
exclusive. Policy-key to lifecycle-operation mapping:

| Policy key | Operation | Endpoint |
| --- | --- | --- |
| `delete_board` | `board.delete` | `DELETE /boards/:id` |
| `attachment.delete` | `attachment.delete` | `DELETE /attachments/:id` (another user's upload) |
| `member.invite` / `member.update` / `member.remove` | same | `/boards/:id/members...` |
| `share.create` / `share.update` / `share.revoke` | same | `/boards/:id/shares...` |
| `share.delete` | `share.delete` | `DELETE /boards/:id/shares/:shareId/permanent` |

`delete_board` is the historical policy-key name in `BoardAction` style; on
the wire the operation is `board.delete`. `attachment.delete` and
`delete_board` are in the default `requireApprovalFor`; even if a key is
removed from policy, the destructive mode still requires approval because
`destructive: "approval"` is the base gate.

`planHash = sha256(utf8(canonicalJson({ schemaVersion, boardId, commands, operations })))`,
where `canonicalJson` recursively sorts object keys, preserves array order,
contains no spaces, and **omits absent** `commands`/`operations` (exactly one
of them is valid). `summary`/`risk`/`expiresAt` are not part of the hash. The
server computes `planHash` and returns it; a client hash is not accepted as
truth.

`action.at` is **excluded** from the plan and `planHash`, as in the existing
`actionFingerprint` (`commands.service`). `at` is server time, not part of the
intent; on apply the server sets/clamps `at` itself. The plan therefore does
not expire because of the 5-minute `COMMAND_AT_MAX_SKEW_MS`, and a retry with
the same `commandId` remains idempotent. `commandId` and the other action
fields are hashed unchanged.

### 6.8. `Command` and `CommandPreimage`

```prisma
model Command {
  // ...existing fields unchanged...
  apiTokenId     String?
  agentSessionId String?
  runId          String?
  agentName      String? // ApiToken.name snapshot at write time

  @@index([apiTokenId, createdAt])
  @@index([agentSessionId, createdAt])
  @@index([runId])
}

model CommandPreimage {
  commandId String   @id
  boardId   String
  runId     String?
  data      Json
  createdAt DateTime @default(now())

  @@index([boardId, runId])
  @@index([createdAt])
}
```

`CommandPreimage.data`:

```json
{
  "schemaVersion": 1,
  "boardVersion": 42,
  "entities": [
    {
      "touch": "card:card-…",
      "id": "card-…",
      "exists": true,
      "version": 7,
      "snapshot": { "...": "full entity state before the command" },
      "postVersion": 8,
      "postDeletedAt": null
    }
  ]
}
```

- For `ADD_*`/`DUPLICATE_*`, the created entity is recorded with
  `exists: false`; the inverse deletes the created id.
- For `DELETE_CARD`, `DELETE_COLUMN`, `ARCHIVE_COLUMN_CARDS`,
  `DELETE_LABEL`, `DELETE_CHECKLIST`, `DELETE_CHECKLIST_ITEM`, the snapshot
  includes nested entities (column + cards, label + assignments, checklist +
  items) sufficient for an exact restore.
- A preimage is written for **every** command in an `AgentRun`; a single
  non-destructive command outside a run gets no preimage.
- Preimage retention = `Command` retention; sweep deletes the preimage before
  or together with the command.

### 6.9. `Activity`

```prisma
model Activity {
  // ...existing fields unchanged...
  apiTokenId     String?
  agentSessionId String?
  runId          String?
  agentName      String?

  @@index([apiTokenId, createdAt])
  @@index([agentSessionId, createdAt])
  @@index([runId])
}
```

New `Activity.type` values:

- `approval_requested`, `approval_approved`, `approval_rejected`,
  `approval_cancelled`, `approval_expired`, `approval_consumed`;
- `agent_session_started`, `agent_session_ended`, `agent_session_paused`,
  `agent_session_resumed`;
- `agents_paused`, `agents_resumed`, `agent_policy_changed`;
- `run_reverted`.

Existing `member_*`, `comment_*`, `attachment_deleted` are unchanged.
`Activity` remains board-scoped; account-level events go to
`SecurityAuditLog`.

`GET /boards/:id/activity` and `GET /cards/:id/activity` gain filters
`actorType`, `apiTokenId`, `agentSessionId`, `runId`, `type`, `from`, `to`;
`GET /boards/:id/commands` gains `runId`/`apiTokenId` for audit. This is the
166.1/166.7 contract for Watch/Audit UI (166.13/166.15).

Comments live outside the command log, so attribution is stored on the row:

```prisma
model Comment {
  // ...existing fields unchanged...
  actorType      String  @default("human") // human|agent
  apiTokenId     String?
  agentSessionId String?
  agentName      String?

  @@index([apiTokenId, createdAt])
  @@index([agentSessionId, createdAt])
}
```

Old comments receive `actorType = "human"`; token/session remain `NULL`. This
lets `CommentDto` show the agent, not just the owner's email.

### 6.10. `SecurityAuditLog`

```prisma
model SecurityAuditLog {
  id             String   @id @default(cuid())
  userId         String
  actorId        String
  actorType      String   @default("human") // human|agent|admin
  apiTokenId     String?
  agentSessionId String?
  action         String
  targetType     String?
  targetId       String?
  details        Json?
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

Minimum events:

- `token.created`, `token.revoked`, `token.paused`, `token.resumed`;
- `agents.paused_all`, `agents.resumed_all`;
- `board.deleted`, `board.restored`;
- `account.exported`, `account.delete_scheduled`, `account.deleted`;
- `run.reverted`, `approval.decided` (also duplicated in board
  `Activity`).

`details` stores snapshots `{ name, boardTitle, scopePreset, trustedCi }`, but
never stores a plaintext token, token hash, or password.

`BoardShareAuditLog` gains nullable `apiTokenId`, `agentSessionId`, and
`agentName` (old rows are `NULL`) so share audit can distinguish two PATs on
one account.

### 6.11. `IdempotencyRecord`

```prisma
model IdempotencyRecord {
  id             String   @id @default(cuid())
  scope          String // create_board|import_boards|create_share|upload_attachment|<operation>
  actorKey       String   // "user:<id>" or "token:<id>"
  key            String
  requestHash    String
  status         String   @default("in_progress") // in_progress|completed
  responseStatus Int?
  responseBody   Json?
  resourceId     String?
  createdAt      DateTime @default(now())
  expiresAt      DateTime

  @@unique([scope, actorKey, key])
  @@index([expiresAt])
}
```

TTL is 24 hours. A repeat with the same `scope + actorKey + key` and the same
`requestHash` returns the stored status/body; a different body gets
`409 idempotency_conflict`; while the first record is `in_progress`, the
repeat gets `409 idempotency_in_progress` (`retryable: true`).
Failures known to have rolled back release the reservation; when the outcome
is uncertain, the reservation remains until its 24-hour expiry to avoid a
duplicate write. Check whether the operation took effect before using a new key.

### 6.12. DTOs, headers, and SSE

| Contract | Add |
| --- | --- |
| `CommandDeltaEntry`, `CommandSseEvent` | `apiTokenId?`, `agentSessionId?`, `runId?`, `agentName?` |
| `ActivityFeedEntry`, `ActivitySseEvent` | `apiTokenId?`, `agentSessionId?`, `runId?`, `agentName?`; `ActivitySseEvent.actorType` |
| `CommentDto` | `actorType`, `apiTokenId?`, `agentSessionId?`, `agentName?` |
| `AttachmentDto` | `uploadedByTokenId?`, `uploadedBySessionId?` (author attribution; blob DTO fields unchanged) |
| `UserTokenDto` | `scopePreset`, `trustedCi`, `individualPausedAt`, `individualPausedBy`, `individualPausedReason`, `stopAllPausedAt`, `stopAllPausedBy`, `paused`, `effectiveTokenScope` |
| `CreateUserTokenRequest` | `scopePreset?`, `trustedCi?` |
| `Board` | `agentPolicy?`, `agentPolicyVersion?`, `agentsPausedAt?`, `agentsPausedBy?`, `agentsPauseReason?` (pause is UI-only, not export) |
| `Card` | `claimedByTokenId?`, `claimedBySessionId?` |
| `CommandBatchRequest` | `clientRunId?` |
| `CommandBatchResponse` | `runId?` (`string`/`null`), see DTO below |
| `CommandResponse` | `runId?`, `approvalId?` (`string`/`null`) |
| `BoardSseEvent` | `ApprovalSseEvent`, `AgentSseEvent` |

Minimum response contracts:

```ts
type AgentSessionStatus =
  | "active"
  | "idle"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

interface AgentSessionDto {
  id: string;
  userId: string;
  apiTokenId: string;
  boardId: string;
  name: string | null;
  clientName: string | null;
  model: string | null;
  status: AgentSessionStatus;
  currentCardId: string | null;
  currentRunId: string | null;
  startedAt: number;
  lastHeartbeatAt: number;
  stale: boolean;
  paused: boolean;
  pausedAt: number | null;
  pausedBy: string | null;
  pausedReason: string | null;
  pauseScope: "board" | "token" | "session" | null;
  endedAt: number | null;
  endReason: string | null;
  summary: string | null;
}

type AgentRunStatus = "applied" | "reverted" | "failed";

interface AgentRunDto {
  id: string;
  boardId: string;
  apiTokenId: string | null;
  agentSessionId: string | null;
  actorId: string;
  kind: "batch" | "plan" | "single" | "revert";
  status: AgentRunStatus;
  clientRunId: string | null;
  planHash: string | null;
  approvalId: string | null;
  commandCount: number;
  firstSeq: number | null;
  lastSeq: number | null;
  revertsRunId: string | null;
  createdAt: number;
  appliedAt: number;
  revertedAt: number | null;
}

interface ApprovalRequestDto {
  id: string;
  boardId: string;
  cardId: string | null;
  requestedBy: string;
  requestedByTokenId: string;
  agentSessionId: string | null;
  kind: "destructive" | "done" | "custom";
  actionType: string;
  summary: string;
  risk: "low" | "medium" | "high";
  planHash: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "consumed";
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionComment: string | null;
  runId: string | null;
  consumedAt: number | null;
  createdAt: number;
  plan?: Record<string, unknown>; // ADMIN detail only
}

interface BoardAgentPolicyDto {
  schemaVersion: 1;
  destructive: "approval" | "deny";
  requireApprovalFor: string[];
  approverRoles: ["ADMIN"];
  maxCommandsPerRun: number;
  maxCardsPerRun: number;
  approvalTtlMinutes: number;
}

interface BoardPolicyResponse {
  policy: BoardAgentPolicyDto;
  version: number;
}

type RunSummaryDto = AgentRunDto; // GET /runs: no commands/preimages

interface RunDetailDto {
  run: AgentRunDto;
  commands: CommandDeltaEntry[];
  preimages: Record<string, unknown>; // board ADMIN only
}

interface RevertConflictDto {
  touch: string;
  expectedVersion: number;
  currentVersion: number;
  reason: string;
}

interface RevertPreviewDto {
  dryRun: true;
  run: RunSummaryDto;
  conflicts: RevertConflictDto[];
  canRevert: boolean;
  diff?: Record<string, unknown>; // board ADMIN only
}

interface CommandBatchResponse {
  runId?: string | null;
  results: CommandResponse[];
}

interface CommandResponse {
  seq: number;
  versions: EntityVersions;
  runId?: string | null;
  approvalId?: string | null;
}
```

New SSE events:

```ts
type ApprovalSseEvent = {
  type: "approval";
  approvalId: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "consumed";
  cardId?: string;
  at: number;
};

type AgentSseEvent = {
  type: "agent";
  op: "started" | "paused" | "resumed" | "ended";
  sessionId?: string;
  scope?: "board" | "token" | "session";
  at: number;
};
```

Headers:

| Header | Where | Meaning |
| --- | --- | --- |
| `X-Agent-Session` | PAT write requests | session id; ownership/board is checked |
| `X-Approval-Id` | commands/batch/plans/apply/lifecycle REST | approval id for the exact plan |
| `Idempotency-Key` | create board/import/share/upload | REST idempotency, 24 h |
| `X-Request-Id` | all responses | correlation id (already exists) |
| `X-RateLimit-*`, `Retry-After` | all responses/429 | 166.10 |
| `X-Board-Seq`, `X-Delta-Resync` | board read/delta | already exists |

SSE `?session=<sessionId>` is optional; it is used for session pause (§9.3).
`?presence=0` remains.

### 6.13. Migration and backfill

One migration, one schema owner: stream **166.1** (see §14.1). Order:

1. Add `ApiToken.scopePreset` as **nullable** (no default) so the `worker`
   default does not touch existing rows.
2. `UPDATE "ApiToken" SET "scopePreset" = 'admin' WHERE "scopePreset" IS NULL;`
3. Add `trustedCi Boolean NOT NULL DEFAULT false`;
   `UPDATE "ApiToken" SET "trustedCi" = true WHERE "readOnly" = false;`
4. Set `scopePreset` to `NOT NULL DEFAULT 'worker'`.
5. Add all token pause fields: `ApiToken.individualPausedAt`,
   `individualPausedBy`, `individualPausedReason`, `stopAllPausedAt`,
   `stopAllPausedBy` and indexes `[userId, individualPausedAt]`,
   `[userId, stopAllPausedAt]`.
6. Add nullable fields to `Board`, `Card`, `Command`, `Activity`:
   - `Board.agentPolicy`, `Board.agentPolicyVersion`,
     `Board.agentsPausedAt/By/Reason`;
   - `Card.claimedByTokenId/SessionId`;
   - `Command`/`Activity` attribution (`apiTokenId`, `agentSessionId`,
     `runId`, `agentName`).
7. Add `Comment.actorType` (`NOT NULL DEFAULT 'human'`),
   `Comment.apiTokenId`, `agentSessionId`, `agentName` and indexes
   `[apiTokenId, createdAt]`, `[agentSessionId, createdAt]`.
8. Add `Attachment.uploadedByTokenId`, `uploadedBySessionId` and indexes
   `[uploadedByTokenId]`, `[uploadedBySessionId]`.
9. Add attribution fields to `BoardShareAuditLog`.
10. Create new tables and indexes.
11. Do not rename or delete existing fields.
12. On large `Command`/`Activity` tables, create indexes in a separate
    operator step with `CREATE INDEX CONCURRENTLY` if the migration would
    otherwise hold the table; a single migration is acceptable for a normal
    self-host install.

Backfill:

- `Command`/`Activity`: new fields stay `NULL`; the UI treats `NULL` as
  "legacy/unknown"; `actorType` already exists.
- `Card`: `claimedByTokenId`/`claimedBySessionId` stay `NULL`; claim continues
  to work through legacy `claimedBy` until the lease expires.
- `ApiToken`: `individualPausedAt`/`stopAllPausedAt` = `NULL`; pause fields
  are not backfilled.
- `Board`: `agentPolicy = NULL`, `agentPolicyVersion = 1`,
  `agentsPausedAt = NULL`.
- `AgentSession`, `AgentRun`, `ApprovalRequest`, `CommandPreimage`,
  `SecurityAuditLog`, `IdempotencyRecord` are empty.
- `Board.version` is untouched; `agentPolicyVersion` is separate.

### 6.14. Cleanup and purge order

- `sweepCommands`: first `CommandPreimage` by `createdAt < cutoff`, then
  `Command`.
- `sweepRuns`: `AgentRun` older than cutoff with no commands; original
  `reverted` runs are deleted together with the revert run at the same
  cutoff.
- `sweepAgentSessions`: completed/expired sessions older than cutoff.
- `sweepApprovals`: `rejected|expired|cancelled|consumed` older than cutoff;
  `pending` and `approved` are **not** deleted by age, only by expiry.
- `sweepSecurityAudit`: `SecurityAuditLog` older than cutoff.
- `sweepIdempotency`: `expiresAt < now`.
- Board/user purge calls the same sweep functions; ordering:
  preimages → commands → runs → sessions → approvals → board rows.

---

## 7. Action matrix

Legend:

- **Preset** — minimum effective scope (board role is applied separately).
- **Destructive** — destructive gate required.
- **Approval** — what happens without `trustedCi` when board policy is not a
  hard block.
- **Legacy PAT** — behavior of an old token (`admin` + `trustedCi`, except
  `readOnly`).

### 7.1. `BoardAction` (REST `/commands`, `/commands/batch`, `/plans/apply`)

| Actions | Preset | Destructive | Approval | Legacy PAT |
| --- | --- | --- | --- | --- |
| `ADD_CARD`, `UPDATE_CARD`, `TOUCH_CARD`, `MOVE_CARD`, `ARCHIVE_CARD`, `UNARCHIVE_CARD`, `DUPLICATE_CARD`, `SET_CARD_DUE_DATE`, `SET_CARD_PRIORITY`, `SET_CARD_ASSIGN`, `SET_CARD_TASK_SPEC`, `SET_CARD_LABEL`, `SET_CARD_COVER`, `CLAIM_CARD`, `ADD_CARD_LINK`, `REMOVE_CARD_LINK` | `worker` | no | no | same as before |
| `MOVE_CARD` or `UNARCHIVE_CARD` into `doneColumnIds` | `reviewer` | no | only when policy contains `move_to_done` | same as before |
| `ADD_COLUMN`, `RENAME_COLUMN`, `MOVE_COLUMN`, `SORT_COLUMN`, `SET_COLUMN_CARD_ORDER`, `SET_COLUMN_WIP_LIMIT`, `SET_COLUMN_ACCENT`, `DUPLICATE_COLUMN`, `RENAME_BOARD`, `SET_BOARD_COLUMN_STYLE` | `worker` | no | no | same as before |
| `ADD_LABEL`, `RENAME_LABEL`, `SET_LABEL_COLOR`, `ADD_CHECKLIST`, `RENAME_CHECKLIST`, `ADD_CHECKLIST_ITEM`, `SET_CHECKLIST_ITEM_DONE`, `RENAME_CHECKLIST_ITEM` | `worker` | no | no | same as before |
| `DELETE_CARD` | `worker` | yes | `approval` | bypass approval |
| `DELETE_COLUMN` | `worker` | yes | `approval` | bypass approval |
| `ARCHIVE_COLUMN_CARDS` | `worker` | yes | `approval` | bypass approval |
| `DELETE_LABEL` | `worker` | yes | `approval` | bypass approval |
| `DELETE_CHECKLIST`, `DELETE_CHECKLIST_ITEM` | `worker` | yes | `approval` | bypass approval |
| `SET_BOARD_WORKFLOW` | `admin` | no (config) | `approval` per default policy (`workflow.update`); a human ADMIN may remove the key from policy | same as before |
| `ARCHIVE_BOARD`, `UNARCHIVE_BOARD` | `admin` | no (reversible) | no | same as before |
| `RESTORE_CARD`, `RESTORE_COLUMN`, `RESTORE_COLUMN_CARDS`, `RESTORE_LABEL`, `RESTORE_CHECKLIST`, `RESTORE_CHECKLIST_ITEM` | browser JWT with the role that could perform the original command (`ADMIN`/`MEMBER`); server-side run-revert | no | no | any PAT → `scope_denied` (undo is not delegated) |
| `RESTORE_BOARD` (aggregate-level/local snapshot) | not a `/commands` command | — | — | not accepted from JWT or PAT; browser uses refetch/local rollback |

Notes:

- `REMOVE_CARD_LINK` is a relationship edit, not destructive: the link can be
  added again; the MCP annotation changes from `DESTRUCTIVE` to `WRITE`.
- `ARCHIVE_CARD`/`UNARCHIVE_CARD` are not destructive: the card remains and
  is restored normally. `UNARCHIVE_CARD` into a done column obeys the same
  `reviewer`/`move_to_done` gate as `MOVE_CARD`; otherwise it bypasses review.
- `ADD_CARD`/`DUPLICATE_CARD` that create a card directly in a done column
  are also considered a done transition and require `reviewer` (+ approval
  when policy contains `move_to_done`).
- `RESTORE_*` is browser undo, not agent undo: a browser JWT with the
  `ADMIN`/`MEMBER` role may send an inverse command through `/commands` as
  before; VIEWER may not, and any PAT gets `scope_denied`. Server-side
  run-revert performs the inverse as a human ADMIN.
- `RESTORE_BOARD` exists in the reducer, but `commands.service` classifies it
  as aggregate-level and **does not accept** it through `/commands`; it is a
  local snapshot/refetch, not a server command. Browser undo of board-level
  actions uses their own inverse commands (`UNARCHIVE_BOARD`, etc.).
- Regression test: a MEMBER deletes a card/column/label/checklist → browser
  undo sends the matching `RESTORE_*` → 200; the same call with a PAT → 403
  `scope_denied`; VIEWER → 403.
- Every command in a batch/plan is checked against this table; if at least one
  is destructive, approval is required for the whole batch/plan, with no
  partial apply.

### 7.2. REST endpoints

New TASK-166 routes: `/agent-sessions`, `/agents/*`,
`/boards/:id/agents/*`, `/users/me/tokens/:id/pause|resume`, `/approvals`,
`/plans`, `/runs`, `/agent-policy`, `/users/me/export`,
`/users/me/delete/request-code`, `DELETE /users/me`. The remaining rows
describe existing controllers and their future checks; no new route is
considered shipped yet.

| Endpoint / group | Preset | Destructive | Approval | Legacy PAT |
| --- | --- | --- | --- | --- |
| `GET /boards`, `GET /boards/:id`, `GET /boards/:id/search`, `GET /boards/:id/export`, `GET /boards/:id/commands`, `GET /boards/:id/events`, `GET /boards/:id/activity`, `GET /cards/:id/activity`, `GET /cards/:id/comments`, `GET /cards/:id/attachments`, `GET /attachments/:id/content` | `observer` | no | no | same as before |
| `GET /boards/:id/members` | `observer` | no | no | same as before |
| `GET /auth/me`, `GET /users/:userId/avatar` | any authenticated PAT (identity/avatar read) | no | no | same as before, including `janosik_whoami` |
| `GET /boards/:id/invitations` | `admin` | no | no | same as before |
| `GET /boards/:id/shares` | `admin` | no | no | same as before |
| `POST /boards/:id/commands` | `worker` | per action | per action | same as before |
| `POST /boards/:id/commands/batch` | `worker` | per action | approval for the whole batch | same as before |
| `POST /boards/:id/plans`, `POST /boards/:id/plans/apply` | `worker` | per action | approval for the whole plan | same as before |
| `POST /boards` | `admin` + account-wide token | no | no | same as before; board-scoped → `scope_denied` |
| `POST /boards/import` (+ `?dryRun=1`) | `admin` + account-wide token | no | no | same as before |
| `DELETE /boards/:id` | `admin` | yes | `approval` | bypass approval |
| `POST /boards/:id/members` (invite) | `admin` | sensitive | `approval` | bypass approval |
| `PATCH /boards/:id/members/:userId` | `admin` | sensitive | `approval` | bypass approval |
| `DELETE /boards/:id/members/:userId` | `admin` | yes | `approval` | bypass approval |
| `POST /boards/:id/shares`, `PATCH /boards/:id/shares/:shareId` | `admin` | sensitive (exposure) | `approval` | bypass approval |
| `POST /boards/:id/shares/:shareId/refresh` | `admin` | no | no | same as before |
| `DELETE /boards/:id/shares/:shareId`, `DELETE .../permanent` | `admin` | yes | `approval` | bypass approval |
| `POST /cards/:id/comments` | `worker` | no | no | same as before |
| `DELETE /comments/:id` | `worker` (own comment only) | yes, but self-authored exempt | no for own; another user's → `scope_denied` | same as before; PAT still author-only |
| `POST /cards/:id/attachments`, `?inline=1` | `worker` | no | no | same as before |
| `DELETE /attachments/:id` | `worker` (own upload) / `admin` (another user's) | yes | no for own; another user's → `approval` | same as before |
| `POST /users/me/tokens`, `GET /users/me/tokens`, `PATCH /users/me/tokens/:id`, `DELETE /users/me/tokens/:id` | session-only | — | — | `pat_forbidden` (security fix); PATCH is owner-only and audited (TASK-166.15) |
| `POST /users/me/tokens/:id/pause`, `/resume` | session-only | — | — | `pat_forbidden` |
| `PATCH /users/me`, `PATCH /users/me/avatar` | session-only | — | — | `pat_forbidden` |
| `GET /invitations`, `POST /invitations/:id/accept`, `/decline` | session-only | — | — | `pat_forbidden` (security fix) |
| `POST /users/me/export`, `GET /users/me/export/:id`, `GET /users/me/export/:id/download` | session-only | — | — | `pat_forbidden` |
| `POST /users/me/delete/request-code` | session-only | — | OAuth proof; email code | `pat_forbidden` |
| `DELETE /users/me` | session-only | yes (account) | password or OAuth re-auth + `emailCode`; not approval | `pat_forbidden` |
| `POST /boards/:id/agent-sessions`, `.../:sessionId/heartbeat`, `.../:sessionId/end` | `observer`+ (control-plane) | no | no | legacy may not use it |
| `GET /boards/:id/agent-sessions`, `GET /boards/:id/agent-sessions/:id` | `observer` | no | no | same as before |
| `POST /boards/:id/agent-sessions/:id/pause`, `/resume` | session-only board ADMIN | no | — | `pat_forbidden` |
| `POST /boards/:id/agents/pause`, `/resume` | session-only board ADMIN | no | — | `pat_forbidden` |
| `POST /agents/pause-all`, `POST /agents/resume-all` | session-only owner | no | — | `pat_forbidden` |
| `POST /boards/:id/approvals` | planned action preset (`worker` for destructive, `reviewer` for done, `admin` for member/share/board) | control-plane | no | legacy trustedCi: approval not required, endpoint available |
| `GET /boards/:id/approvals`, `GET .../:approvalId` | `admin` or requester `apiTokenId` | no | no | same as before for requester token |
| `POST /boards/:id/approvals/:id/decision` | session-only board ADMIN | — | — | `pat_forbidden` |
| `POST /boards/:id/approvals/:id/cancel` | requester `apiTokenId` or session-only board ADMIN | no | — | same as before for requester token |
| `GET /boards/:id/runs` | `observer` — summary without pre-image | no | no | same as before |
| `GET /boards/:id/runs/:runId` | board ADMIN JWT — full detail + pre-image; observer — summary/attribution only | no | no | same as before for summary; PAT full detail → `scope_denied` |
| `POST /boards/:id/runs/:runId/revert` (`dryRun: true`) | observer — conflict summary without snapshot; board ADMIN — full diff/pre-image | no | no | same as before for summary |
| `POST /boards/:id/runs/:runId/revert` (`dryRun: false`) | session-only board ADMIN | yes (revert) | — | `pat_forbidden` |
| `PATCH /boards/:id/agent-policy` | session-only board ADMIN | no | — | `pat_forbidden` |
| `GET /share/:token`, `GET /share/:token/*` | public share token | — | — | PAT does not participate |
| `/admin/*` | master session | — | — | outside TASK-166 |

For rows with `approval`, the REST call is repeated with
`X-Approval-Id: <approvalId>`; without it the server creates an approval and
responds `409 approval_required`. This also applies to lifecycle operations
(`board.delete`, `member.*`, `share.*`, `attachment.delete`).

"Own" comment/attachment: for PAT it is a match on `apiTokenId`/
`uploadedByTokenId`; for browser JWT it is a match on `userId`; a legacy row
with `NULL` falls back to `userId`. Two PATs of one owner do not delete each
other's content.

### 7.3. MCP tools

Existing tools keep their names except for the removals listed. In the table,
names omit the `janosik_` prefix; the full tool id is `janosik_` + name. The
table covers **all** current MCP toolsets: boards (including
`janosik_rename_board` and `janosik_export_board`), columns, cards, labels,
checklists, links, comments, activity, attachments (including
`janosik_upload_attachment`), members, invitations (removed), shares, and
account (`whoami`).

| Group / tools | Preset | Destructive | Approval | Legacy PAT |
| --- | --- | --- | --- | --- |
| Reads: `list_boards`, `get_board`, `get_card`, `search_cards`, `list_ready_cards`, `wait_for_work`, `list_labels`, `list_comments`, `list_members`, `list_attachments`, `download_attachment`, `board_activity`, `card_activity`, `get_workflow`, `export_board`, `whoami` | `observer` | no | no | same as before; `export_board.outputPath` writes locally only when FS is enabled |
| `list_shares` | `admin` | no | no | same as before |
| Content: `create_card`, `update_card`, `move_card`, `archive_card`, `unarchive_card`, `duplicate_card`, `set_card_priority`, `set_card_assignee`, `set_card_due_date`, `set_card_cover`, `set_card_label`, `set_card_task_spec`, `claim_card`, `release_card`, `create_column`, `rename_column`, `move_column`, `sort_column`, `duplicate_column`, `set_column_wip_limit`, `set_column_accent`, `create_label`, `rename_label`, `set_label_color`, `add_checklist`, `rename_checklist`, `add_checklist_item`, `set_checklist_item_done`, `rename_checklist_item`, `add_card_link`, `remove_card_link`, `add_comment`, `rename_board`, `upload_attachment` | `worker` | no | no | same as before |
| `move_card` into done | `reviewer` | no | `move_to_done` policy | same as before |
| `delete_card`, `clear_column`, `delete_column`, `delete_label`, `delete_checklist`, `delete_checklist_item` | `worker` | yes | `approval` | bypass approval |
| `delete_board` | `admin` | yes | `approval` | bypass approval |
| `delete_comment` (own), `delete_attachment` (own upload) | `worker` | yes, self-authored exempt | no for own | same as before |
| `delete_attachment` (another user's) | `admin` | yes | `approval` | bypass approval |
| `create_share`, `update_share`, `revoke_share` | `admin` | sensitive/destructive | `approval` | bypass approval |
| `refresh_share` | `admin` | no | no | same as before |
| `archive_board`, `unarchive_board` | `admin` | no | no | same as before |
| `create_board`, `import_board` | `admin` + account-wide | no | no | same as before |
| `invite_member`, `update_member`, `remove_member` | `admin` | sensitive/destructive | `approval` | bypass approval |
| `update_profile`, `list_invitations`, `accept_invitation`, `decline_invitation` | — | — | — | **removed from MCP**: PAT has no account routes |
| New: `start_session`, `heartbeat`, `end_session` | `observer`+ | no | no | — |
| New: `request_approval`, `get_approval`, `wait_for_decision`, `cancel_approval` | planned action preset | control-plane | no | — |
| New: `plan_changes`, `apply_plan` | `worker` | per plan | per plan | — |
| New: `list_runs`, `get_run`, `preview_run_revert` | `observer` | no | no | — |

Required new tools:

- `janosik_start_session`, `janosik_heartbeat`, `janosik_end_session`;
- `janosik_request_approval`, `janosik_get_approval`,
  `janosik_wait_for_decision`, `janosik_cancel_approval`;
  `wait_for_decision` is a repeatable poll of up to 60 s per call; the overall
  deadline is the approval `expiresAt`;
- `janosik_plan_changes`, `janosik_apply_plan`;
- `janosik_list_runs`, `janosik_get_run`, `janosik_preview_run_revert`.

Mutating tools that need approval accept optional `approvalId` and pass it as
`X-Approval-Id`; tools with idempotency accept `idempotencyKey`/`commandId`.
This is part of the 166.4 write contract. For `delete_comment`/
`delete_attachment`, "own" is determined by `apiTokenId`
(`uploadedByTokenId`), not by user id; a legacy row without a token id falls
back to user id.

`janosik_whoami` returns:

```json
{
  "user": { "id": "…", "email": "…", "displayName": "…" },
  "token": {
    "id": "…",
    "name": "…",
    "scopePreset": "worker",
    "trustedCi": false,
    "effectiveTokenScope": "worker",
    "boardId": null,
    "readOnly": false,
    "rateLimitPerMinute": null,
    "individualPausedAt": null,
    "stopAllPausedAt": null,
    "paused": false
  },
  "session": null,
  "server": { "version": "…", "apiVersion": "1" }
}
```

New toolsets: `sessions`, `approvals`, `plans`, `runs` are part of the
default MCP set. `members` and `shares` remain opt-in; `invitations` is
removed; `account` contains only `whoami` (the profile tool is removed). The
exact tool count is not fixed in 166.0: 166.11 updates the pinned test after
all tools merge; until then the test pins the toolset list, not one number.

### 7.4. Batch, plan, import, share, undo/restore, attachments, comments

- **Batch.** All commands on one board, all-or-nothing; limit
  `min(100, policy.maxCommandsPerRun)`, card creation
  `min(50, policy.maxCardsPerRun)`. If any action is destructive, approval
  covers the whole batch; `approvalId` is passed in the `X-Approval-Id`
  header. The response contains `runId` and results in command order.
- **Plan/apply.** `POST /plans` is a dry-run: same validator, diff, warnings,
  conflicts, `planHash`; it writes nothing and creates no `run`.
  `POST /plans/apply` has the same atomic semantics as batch but requires
  `planHash`; a changed hash → `approval_mismatch`. 50 cards = up to 100
  commands (create + update), the upper bound for one plan. `/plans` works
  with `commands` only; lifecycle operations (`board.delete`, `member.*`,
  `share.*`, `attachment.delete`) go through `POST /approvals` + the original
  REST route, not `/plans`. A plan over 100 commands → `409 limit_exceeded`;
  the client splits work into several plans/runs, with no cross-chunk
  atomicity.
- **Import.** `POST /boards/import` is account-wide `admin`; `?dryRun=1`
  validates the file and returns board/card counts and conflicts without
  writing. Import is not a run. The board limit is `MAX_BOARDS_PER_USER`
  (0 = no limit); local mode is 10.
- **Share.** Creating/changing a share is `admin` + approval because it
  publishes the board. Refreshing a snapshot does not change access and needs
  no approval. Revoke/permanent delete is destructive + approval.
- **Undo/restore.** Browser undo is unchanged: an ADMIN/MEMBER JWT sends
  inverse commands (`RESTORE_*`) through `/commands`, as today. An agent does
  not call `RESTORE_*`; it makes compensating non-destructive commands or asks
  a human to revert the run. Any PAT → `scope_denied`; server-side run-revert
  performs the inverse as a human ADMIN. `RESTORE_BOARD` is an
  aggregate-level/local snapshot; `/commands` does not accept it.
- **Attachments.** Upload is `worker`; limits of 20/25 MB are unchanged.
  Delete: own upload is `worker` without approval; another user's is `admin` +
  approval. "Own" for PAT = matching `uploadedByTokenId`; for browser JWT =
  the same `userId`; a legacy row with `NULL` falls back to `userId`.
  Presigned/object storage is not introduced.
- **Comments.** Create is `worker`; `kind` is preserved. Delete is author-only
  (existing `comments.service` rule); "own" for PAT = matching
  `Comment.apiTokenId`, otherwise `scope_denied`; for browser JWT = the same
  `userId`; legacy `NULL` falls back to `userId`. Moderation of other users'
  comments is outside TASK-166.
- **Idempotency.** `create_board`, `import_board`, `create_share`, and
  `upload_attachment` accept `Idempotency-Key` (MCP: optional
  `idempotencyKey`); `add_comment` accepts `commandId`;
  `duplicate_card`/other commands use `commandId`.
- **Tokens/profile/invitations.** PAT has no access; browser JWT only. This
  applies to `trustedCi` and legacy PAT as well.
- **Board policy/pause.** Browser JWT board ADMIN only; an agent cannot
  weaken policy or clear pause.

---

## 8. Error taxonomy

### 8.1. Envelope

Every API error (new and changed in 166.4) returns:

```json
{
  "code": "scope_denied",
  "message": "English fallback, localizable by code",
  "retryable": false,
  "requestId": "…",
  "currentVersion": null,
  "details": {}
}
```

- `code` is a stable machine identifier in snake_case.
- `message` is an English fallback; UI/MCP localize by `code`.
- `retryable` is always present. `true` means the same request may be retried
  without changes after `Retry-After`/a short pause.
- `requestId` is the same id as `X-Request-Id`; it already exists in
  `request-context`.
- `currentVersion` is the current version of the checked resource. For
  commands it is `currentSeq(boardId) = max(Command.seq)` (0 without
  commands), **not** `Board.version`; for policy CAS it is
  `Board.agentPolicyVersion`; for `run_conflict` it is the run state.
  `details.versionOf` names the resource; otherwise `null`. `Board.version`
  remains the entity version for title/`ifMatchVersions` and is not mixed with
  `ifMatch`/seq.
- `details` is an optional object. Existing top-level `field`, `conflict`,
  `workflow`, and `retryAfter` are **preserved** for compatibility.

### 8.2. Codes

| `code` | HTTP | `retryable` | When | Extra |
| --- | --- | --- | --- | --- |
| `scope_denied` | 403 | false | preset/board role does not allow the action | `requiredScope`, `action` |
| `destructive_denied` | 403 | false | board policy `destructive: "deny"` | `reason: "board_policy"` |
| `agent_paused` | 403 | false | session/token/board pause | `pauseScope`, `pausedAt` |
| `agent_session_closed` | 403 | false | session completed/cancelled | `sessionId` |
| `agent_session_invalid` | 403 | false | session does not belong to the token/board | `sessionId` |
| `pat_required` | 403 | false | agent-session `start`/`heartbeat` called with a browser session instead of a PAT (end also accepts a board ADMIN JWT) | `endpoint` |
| `approval_required` | 409 | false | destructive action without approval | `approvalId`, `planHash`, `expiresAt` |
| `approval_expired` | 409 | false | approval expired before decision/apply | `approvalId`, `expiresAt` |
| `approval_mismatch` | 409 | false | planHash/plan mismatch | `approvalId`, expected/actual hash prefix |
| `approval_owner_mismatch` | 403 | false | approval belongs to another `apiTokenId`/session | `approvalId`, `requestedByTokenId` |
| `approval_not_pending` | 409 | false | decision on approved/rejected/cancelled/consumed | `approvalId`, `status` |
| `approval_rejected` | 409 | false | approval rejected | `approvalId`, `decidedAt` |
| `approval_cancelled` | 409 | false | approval cancelled | `approvalId` |
| `approval_consumed` | 409 | false | approval already applied (consumed) | `approvalId`, `runId` |
| `version_conflict` | 409 | false | `ifMatch`/`ifMatchVersions`/policy CAS | `conflict: "version"`, `currentVersion`, `field` |
| `id_conflict` | 409 | false | id belongs to another board | `conflict: "id"`, `currentVersion` |
| `workflow_conflict` | 409 | false | workflow forbade the transition | `conflict: "workflow"`, `workflow` (current format) |
| `run_conflict` | 409 | false | `clientRunId`/run already used by another plan; run already reverted; revert of revert | `runId`, `currentVersion` |
| `run_expired` | 409 | false | pre-images/run removed by retention | `runId`, `retentionDays` |
| `limit_exceeded` | 409 | false | WIP/collection/board/run limit | `conflict: "wip"` for WIP, `limit`, `current` |
| `idempotency_conflict` | 409 | false | same key, different body | `key` |
| `idempotency_in_progress` | 409 | true | first record is still running or its outcome is uncertain | `key`, `retryAfter` |
| `payload_too_large` | 413 | false | command/import/attachment body | `limit` |
| `rate_limited` | 429 | true | global/per-token/per-agent limit | `retryAfter`, `limit` |
| `board_write_timeout` | 503 | true | lock/transaction timeout | current code is preserved |
| `not_found` | 404 | false | entity/board/approval/run not found | `resource` |
| `validation_failed` | 400 | false | class-validator/shape | `field`, `message` |

`limit_exceeded` is a semantic limit (WIP, boards, run). An overlong
batch/DTO is `validation_failed` (400); an oversized body is
`payload_too_large` (413).

### 8.3. Compatibility with the current contract

- The `409` body with `conflict` ∈ `version`/`wip`/`id`/`workflow`,
  `currentVersion`, and optional `workflow` remains. Add `code`:
  `version_conflict` / `limit_exceeded` / `id_conflict` /
  `workflow_conflict`.
- `403 { code: "pat_read_only" }` remains for `readOnly`; preset denial is
  `scope_denied`. `pat_forbidden` remains for account routes.
- `503 { code: "board_write_timeout" }` remains.
- `login_backoff` and `retryAfter` on auth routes are unchanged.
- `workflow.code` (`transition_not_allowed`, `role_not_allowed`,
  `condition_failed`) is not renamed.
- `field` on 400 remains.
- `requestId` duplicates `X-Request-Id`; the header already exists.

### 8.4. Rate-limit headers

166.10 adds these to all authenticated responses:

- `X-RateLimit-Limit` — current bucket ceiling;
- `X-RateLimit-Remaining` — remaining budget;
- `X-RateLimit-Reset` — reset time as Unix seconds;
- `Retry-After` — seconds, required on `429 rate_limited`.

The bucket is keyed by principal: user, token, or IP for anonymous requests.
Both the per-token limit and the global limit apply.

**Implementation (166.10).** The global per-principal `@nestjs/throttler`
window is unchanged. On top of it, PAT traffic gets a per-session bucket
(`AGENT_SESSION_RATE_LIMIT`, default = live global limit, min 60) and a
per-board bucket (`BOARD_RATE_LIMIT`, default = 2× live global limit, min
600). Browser sessions do not get the new buckets. The token's explicit
`rateLimitPerMinute` remains the tightest token budget. `X-RateLimit-*` names
the tightest bucket that counted the request (with `X-RateLimit-Scope`), and
the same budget appears in the `429` envelope (`rate_limited`, `retryable`,
`retryAfter`, `limit`, `scope`, `requestId`). `X-RateLimit-Reset` is Unix
seconds; the IETF-style `RateLimit-Reset` is seconds until reset.

The request log is one JSON line per finished API response with
`requestId`, method/path/status/duration, `actorType`/`actorId`, `boardId`,
`apiTokenId`, `agentSessionId`, `runId` (when available), `approvalId` and the
classified operation. Query strings and public share tokens are redacted;
tokens, bodies, headers, comments and card content are never logged. The same
entry feeds the existing `GET /admin/traffic` `telemetry` block (no new admin
screen). Media, transcode and export job payloads carry the optional
`attribution` subset (ids only).

### 8.5. MCP

`describeError` and tool results must show:

- `code`, `retryable`, `requestId`;
- `approvalId`/`expiresAt` for `approval_required`;
- `currentVersion` for `version_conflict`;
- the next step: "wait for human", "re-read board", "request approval",
  "stop — paused", "do not retry same destination".

MCP mutation results (166.4) return `structuredContent`:

```json
{
  "ok": true,
  "resourceId": "card-…",
  "seq": 42,
  "runId": "run-…",
  "approvalId": null
}
```

The text `content` remains for humans, but an agent does not have to parse
it. MCP errors remain `isError: true` with `structuredContent` and a code.

---

## 9. Pause / kill

### 9.1. Levels

| Level | Field | Set by | Scope | Recovery |
| --- | --- | --- | --- | --- |
| Session | `AgentSession.pausedAt` | browser JWT board ADMIN | one session | resume |
| Token | `ApiToken.individualPausedAt` + `ApiToken.stopAllPausedAt` | browser JWT owner | all PAT writes + PAT SSE; GET reads allowed | resume |
| Board | `Board.agentsPausedAt` | browser JWT board ADMIN | all PATs on the board | resume |
| Kill | `ApiToken.revokedAt` | browser JWT owner | token forever | new token |

Two independent token pause sources:

- `individualPausedAt` is the pause of a specific token through
  `POST /users/me/tokens/:id/pause`; only its `/resume` clears it;
- `stopAllPausedAt` is the bulk pause through `POST /agents/pause-all`;
  `resume-all` clears only stop-all and leaves individual pause untouched.
  A token stays paused while at least one source is active.

### 9.2. What is blocked

- Any content write, command, batch/plan/apply, approval create, attachment
  upload/delete, comment create/delete, or claim.
- GET reads remain allowed. Opening a new PAT-SSE is forbidden during
  token/board pause. Session pause closes writes with that session and SSE if
  the stream was opened with `?session=<sessionId>`; without the session
  parameter the stream is token-level and session pause does not close it.
- Control-plane exceptions: `heartbeat`, `end_session`, and `GET` reads of
  the session itself. They let an agent finish cleanly.
- `pause` does not release a claim. `kill`/`end_session` release claims owned
  by that session/token.

### 9.3. In-flight and SSE

- A request that has passed checks and holds the board lock **finishes** and
  commits. Pause does not roll back in the middle.
- Pause is checked twice: in the guard/request start and inside the
  board-write transaction after the advisory lock. If pause committed before
  the second read, the write is cancelled; if after, the in-flight request
  finishes.
- SSE keep-alive is 25 s. On the next tick the server sends (best effort)
  `{ type: "agent", op: "paused", scope, at }` and closes the stream on
  token/board pause, or on session pause when the stream was opened with
  `?session=<sessionId>`. Without the session parameter, session pause blocks
  only writes with that `X-Agent-Session`. Human SSE is not closed.
- Reconnect during an active pause → `403 agent_paused`; after resume, a
  normal stream with `?since=`.
- Rejected writes are not queued and are not retried by the server.

### 9.4. API

- `POST /boards/:id/agent-sessions` — start; body `{name?, clientName?, model?}`;
  PAT; board-scoped; response `AgentSessionDto`.
- `POST /boards/:id/agent-sessions/:sessionId/heartbeat` — body
  `{status?, currentCardId?, summary?}`; only the same `apiTokenId` as the
  session; allowed during pause.
- `POST /boards/:id/agent-sessions/:sessionId/end` — body
  `{status?:"completed"|"failed"|"cancelled", summary?}`; the same
  `apiTokenId` or a board ADMIN human; releases the session's claims.
- `GET /boards/:id/agent-sessions?active=1` — list; `stale` is computed.
- `POST /boards/:id/agent-sessions/:sessionId/pause|resume` — session-only
  board ADMIN; body `{reason?}`. The ROADMAP shorthand
  `/agents/:id/pause|resume` means exactly `agent-sessions/:sessionId`; there
  is no separate account-level `/agents/:id` API.
- `POST /boards/:id/agents/pause|resume` — session-only board ADMIN;
  body `{reason?}`; writes `agentsPausedAt/By/Reason` and Activity.
- `POST /users/me/tokens/:id/pause|resume` — session-only owner; sets/clears
  `individualPausedAt`; `resume-all` does not touch it.
- `POST /agents/pause-all|resume-all` — session-only owner; sets/clears
  `stopAllPausedAt` on all non-revoked tokens without changing
  `individualPausedAt`.
- `DELETE /users/me/tokens/:id` — kill/revoke; sessions become `cancelled`,
  claims with `claimedByTokenId` are released, and SSE closes on the next
  tick. Legacy claims without a token id wait for lease expiry.

### 9.5. Kill vs end session

- `end_session` is a normal end of the run context; the token keeps working
  and a new session may start.
- `revoke` is the only real kill: the token is invalid and all its sessions
  are cancelled. A separate `POST /agents/:id/kill` is not introduced because
  it would duplicate revoke with unclear semantics.

---

## 10. Approval lifecycle

### 10.1. States

```
pending ──approve──> approved ──apply──> consumed
   │                    │
   ├──reject──> rejected│
   ├──cancel──> cancelled
   └──expiresAt──> expired  (from pending or approved)
```

- `pending` — waiting for a human.
- `approved` — the exact plan is authorized; not applied yet.
- `consumed` — the plan is applied; `runId` is filled.
- `rejected`/`cancelled`/`expired` — cannot be applied.
- Transitions are atomic through `updateMany where status=…`; a repeated
  approve on an already approved request is idempotent; a conflicting
  decision gets `approval_not_pending`; `approval_consumed` only after apply.

### 10.2. Creation

`POST /boards/:id/approvals` is PAT-only (an agent creates the request;
browser JWT does not create approvals). The preset must allow the planned
action after approval: `worker` for destructive, `reviewer` for done, `admin`
for member/share/board delete:

```json
{
  "kind": "destructive",
  "cardId": "card-…",
  "ttlMinutes": 60,
  "plan": {
    "schemaVersion": 1,
    "boardId": "board-…",
    "commands": [
      { "commandId": "cmd-…", "action": { "type": "DELETE_CARD", "cardId": "card-…" } }
    ]
  }
}
```

If a destructive command/batch or operation arrives **without** approval and
policy requires approval, the server does not apply it; it creates an
`ApprovalRequest` for the exact plan and returns `409 approval_required` with
`approvalId`, `planHash`, and `expiresAt`. This is the same request as an
explicit `POST /approvals`; there is no partial apply. `409` is chosen over
`202`: the request is not accepted for work and will not be applied without a
human decision.

Server:

1. Validate the plan: for `commands`, use the same validator as
   batch/plan (≤`min(100, policy.maxCommandsPerRun)`, cards ≤
   `min(50, policy.maxCardsPerRun)`, one board, all ids/preconditions); for
   `operations`, exactly one whitelisted operation, its target/body, and board
   scope. Exceeding the limits → `409 limit_exceeded`.
2. Compute `planHash` and `summary`/`risk`; `summary`/`risk`/`expiresAt` are
   not part of the hash.
3. Verify that the preset could perform the action after approval (it does
   not try to raise scope).
4. If `destructive: "deny"` → `403 destructive_denied`; no request is
   created.
5. If a `pending`/`approved` request from this token already exists with the
   same `planHash`, return it (idempotency) instead of creating a second one.
   `rejected`/`cancelled`/`expired` allow a new pending request; `consumed`
   with already applied commands is an idempotent replay, otherwise
   `approval_consumed`.
6. Create `ApprovalRequest` with `expiresAt = now + effectiveTtlMinutes`;
   effective TTL = `min(request.ttlMinutes ?? policy, policy.approvalTtlMinutes)`,
   floor 5 minutes. Write Activity `approval_requested` and notify board
   ADMIN.

`kind`:

- `destructive` — delete/bulk archive/member/share/board delete;
- `done` — transition to a done column when `move_to_done` policy applies;
- `custom` — other plans that need a human decision.

`summary`/`risk`:

- `risk: "high"` — delete board/column, member remove, share revoke;
- `medium` — delete card/label/checklist, bulk archive, member/share create;
- `low` — done/custom.

### 10.3. Decision

`POST /boards/:id/approvals/:approvalId/decision` is **session-only** board
ADMIN:

```json
{ "decision": "approve", "planHash": "…", "comment": "ok" }
```

- `planHash` is required and must match; otherwise `approval_mismatch`.
- For `pending`, `expiresAt > now` is required; expired → `approval_expired`.
  For `rejected`/`cancelled`/`consumed` → `approval_not_pending`.
- A repeated `approve` on an already `approved` request with the same
  `planHash` is an idempotent `200` with the current state, not an error and
  not a second approval. A different `decision` on `approved` →
  `approval_not_pending`.
- `approval_consumed` is returned only after a successful apply (consume),
  not on decision.
- `approve` → `approved`; `reject` → `rejected`. Apply is not performed.
- `decidedBy` is the user id; `decisionComment`.
- Activity `approval_approved`/`approval_rejected`; notify requester.
- Self-approval: PAT cannot call decision. The human token owner **may**
  approve their agent's request — this is the human control boundary; "cannot
  approve own request" applies to the agent, not the human owner. Browser does
  not create approvals, so there is no separate "human approves own
  browser-created request" scenario.

`POST /boards/:id/approvals/:id/cancel` — requester `apiTokenId` or
session-only board ADMIN; `pending` only; Activity `approval_cancelled`.
Applying a cancelled approval → `approval_cancelled`.

### 10.4. Apply and one-time use

- The agent repeats **the same** plan (same `commands`/`operations`, same
  `commandId`) with the `X-Approval-Id: <approvalId>` header.
- Approval ownership: `requestedByTokenId` must match the current `apiTokenId`;
  if `agentSessionId` is set, the current `X-Agent-Session` must match.
  Otherwise `403 approval_owner_mismatch` (another token, even from the same
  user, cannot consume it). Browser JWT does not consume an approval; a human
  does not need one. The same applies to lifecycle operations.
- For `commands`: `POST /commands/batch` or `POST /plans/apply`.
- For `operations`: the original REST route (`POST/DELETE ...`) with
  `X-Approval-Id`; the server compares the operation, target, and body with
  the plan.
- For `commands`, the server in one transaction:
  1. loads the approval `FOR UPDATE`;
  2. checks `status = approved`, `expiresAt > now`, `planHash`;
  3. checks that the plan matches byte-for-byte in canonical form;
  4. checks that the approval is not `consumed`;
  5. applies the plan as a batch under the board lock;
  6. creates `AgentRun` with `approvalId`, sets `status = consumed`,
     `runId`, `consumedAt`;
  7. writes Activity `approval_consumed` and `runId`.
- For `operations`, the server in the endpoint transaction checks approval the
  same way, performs exactly one operation, sets `status = consumed`,
  `consumedAt`, and writes Activity/SecurityAuditLog; no `AgentRun` is
  created, and `runId` stays `null`.
- Operation retry uses the same `Idempotency-Key`; `IdempotencyRecord` returns
  the stored response even after `consumed`. Without a key, a repeat after
  success gets `approval_consumed`.
- If the plan does not match — `approval_mismatch`; the approval stays
  `approved` until TTL, but a different plan cannot be applied.
- If approval expired between approve and apply — `approval_expired`; create
  a new request.
- On apply the server sets `action.at` itself (with normal skew clamp) for
  each command; the hash does not change because `at` is not part of the
  plan/hash.
- Idempotent retry: if all `commandId`s are already applied by this run,
  return the stored result even after `consumed`; no new records.
- An approval cannot be used for a plan that does not require approval by
  policy, or for another board/plan. `kind` must match the plan
  (`destructive`/`done`/`custom`); a mismatch is `approval_mismatch`.

### 10.5. Notifications and audit

- `approval_requested` → in-app bell + email to all board ADMINs (including
  the token owner), localized by `User.locale`.
- `approval_approved`/`rejected`/`cancelled`/`expired`/`consumed` → requester
  token owner + decision actor.
- Deduplication: one event per `(approvalId, recipientId, type)`.
- Activity stores `approvalId`, `planHash` (full), `risk`, and `decision`.
- Expiry is checked lazily on read/decision/apply and by the maintenance
  sweep; `pending`/`approved` with `expiresAt <= now` → `expired` plus a
  notification.
- Email/in-app delivery is 166.9; the approval API does not wait for SMTP.
  Attention events for 166.9: `approval.requested`, `approval.decided`,
  `agent.blocked`, `agent.needs_human`, `claim.expired`, `quota.exceeded`,
  `token.revoked`.

---

## 11. Run and rollback

### 11.1. Boundaries

- The server creates a run for:
  - `POST /boards/:id/commands/batch` from a PAT;
  - `POST /boards/:id/plans/apply` from a PAT;
  - a single destructive PAT command from `BoardAction` (for example,
    `DELETE_CARD`, `DELETE_COLUMN`, `ARCHIVE_COLUMN_CARDS`).
- An ordinary single non-destructive PAT command does not create a run.
- Non-command REST actions (`DELETE /boards/:id`, member/share/
  attachment/comment delete) do **not** create `AgentRun`: they have their own
  audit/restore semantics (§11.3).
- Human batch/plan/undo does **not** create `AgentRun`; its history is the
  existing UI undo. The exception is session-only run-revert, which creates a
  `kind: "revert"` run for audit.
- A run belongs to exactly one board: the endpoint is board-scoped;
  `AgentRun.boardId` is one value; a plan/batch cannot contain a command for
  another board.
- One run = one `agentSessionId` (may be `NULL` for legacy) + one
  `apiTokenId` (may be `NULL` only for a human system run-revert).
- Multiple runs per session are allowed; `AgentSession.currentRunId` is the
  latest.

### 11.2. Identifiers and idempotency

- `runId` is the server `AgentRun.id` (`cuid`) and is returned in the
  response.
- A client may send `clientRunId` (8–64 `[A-Za-z0-9_-]`); the server uses it
  only for idempotency within the board.
- A repeat with the same `clientRunId` and the same `commandId` set returns
  the existing run. The same `clientRunId` with another plan/session gets
  `409 run_conflict`.
- If `clientRunId` is not sent but all `commandId`s already exist with the
  same payload, the server returns their stored results and the original
  run's `runId`; it does not create a new run. A mix of existing commands and
  new commands on another run gets `409 run_conflict`.
- Batch/plan response: `{ runId, results: CommandResponse[] }`.
- `Command.runId` is filled for every command in the run;
  `AgentRun.firstSeq`/`lastSeq` are the range.

### 11.3. Pre-image

- A `CommandPreimage` is written for **every** command in a run:
  - creates (`ADD_*`, `DUPLICATE_*`) — `exists: false`;
  - updates/moves/sets — full before-snapshot of the affected entities;
  - deletes/bulk archive — full snapshot with nested entities.
- The preimage also stores the `version` before and `postVersion`/
  `postDeletedAt` after, so rollback can check whether someone changed the
  entity after the run.
- The preimage is not exposed in the ordinary activity feed. `GET /runs` for
  an observer is summary/attribution only; `GET /runs/:runId` with pre-image
  and full diff is board ADMIN (browser JWT) only. `dryRun` for an observer
  returns conflict summary without snapshots; full diff is ADMIN only.
- Non-command destructive REST actions have no preimage table:
  - `DELETE /boards/:id` — soft-delete + admin restore + `SecurityAuditLog`;
  - share revoke — `BoardShareAuditLog`; recreating the share issues a new
    token;
  - member remove — Activity details + a new invite;
  - comment/attachment delete — soft-delete + Activity details + admin
    restore (the attachment blob is kept until purge).
  These actions are outside run rollback; this is a deliberate MVP boundary.

### 11.4. Revert

`POST /boards/:id/runs/:runId/revert`:

```json
{ "dryRun": true }
```

- `dryRun: true` — a board member (observer) receives `RevertPreviewDto`:
  `{ dryRun, run: RunSummaryDto, conflicts, canRevert }` without
  commands/pre-image/snapshot. Board ADMIN receives the same
  `RevertPreviewDto` with `diff`; the full `RunDetailDto` (commands +
  preimages) is ADMIN only. It writes nothing.
- `dryRun: false` — session-only board ADMIN; the body additionally requires
  `commandId` (idempotency). PAT → `403 pat_forbidden`.
- Algorithm:
  1. load the run and commands in reverse order;
  2. for each `touch`, take the **last** state in the run (the last command
     that wrote the entity) and compare the current state with its
     `postVersion`/`postDeletedAt`; intermediate versions of the same run are
     not conflicts and are unwound in reverse order;
  3. if the entity was changed/restored/recreated — conflict
     `{ touch, expectedVersion, currentVersion, reason }`;
  4. build the inverse from the preimage (restore/update/delete);
  5. apply all inverses in one transaction under the board lock;
  6. create a new `AgentRun` (`kind: "revert"`, `revertsRunId = runId`,
     actor is human), record commands/preimages;
  7. original run → `status: "reverted"`, `revertedAt`;
  8. Activity `run_reverted`.
- Any conflict cancels the whole revert, `409 run_conflict` (or
  `version_conflict` when the cause is a version) with `details.conflicts`;
  partial revert is forbidden.
- Revert of revert is forbidden in the MVP (`409 run_conflict`); a second
  revert of an already reverted run gets `409 run_conflict`.
- If preimage/run were removed by retention — `409 run_expired`.
- Revert does not break ordinary UI undo: the commands it creates arrive via
  SSE as ordinary foreign commands; the human stack processes them by the
  current rules.

### 11.5. Retention and dry-run

- Run/preimage live as long as `Command` (retention).
- Dry-run is available while commands/preimages exist; after that —
  `run_expired`.
- Dry-run does not create an `IdempotencyRecord` and does not write commands;
  `lastUsedAt` is updated by normal authentication (at most once every 60 s).
- A revert-run is stored as an ordinary run; it can be inspected in audit but
  not reverted (see above).

---

## 12. Limits and data safety

### 12.1. "10 boards"

- `LIMITS.boardsCount = 10` remains only for local/offline mode as a
  localStorage guard.
- Server mode: `MAX_BOARDS_PER_USER` (env, default `0` = no limit). A
  positive value is an operator safety cap, not a pricing tier.
- `GET /auth/config` is extended with
  `limits: { boards: number | null, importBytes }`; the UI shows the limit
  only when one is set. A separate `GET /limits` is not introduced.
- `POST /boards` and `POST /boards/import` check the cap atomically; exceeding
  it → `409 limit_exceeded` (import creates no boards).
- The empty-state/switcher/reducer mismatch is removed: the server is the
  source of truth, and the reducer in server mode does not cut at 10.

### 12.2. Retention

- Default 30 days; presets 30/90/365; custom 1–3650.
- One `retentionDays` for Command, CommandPreimage, Activity, AgentRun,
  AgentSession, terminal ApprovalRequest, and soft-deleted rows.
- `pending`/`approved` approvals are not deleted by age, only by `expiresAt`
  (then swept).
- `AdminAuditLog` **and** `SecurityAuditLog` keep their own long window
  (`AUDIT_RETENTION_DAYS`, default 365). The 30/90/365 product setting does
  not erase the security trail; a `account.delete_scheduled` marker is kept
  even after the account is erased and its latest value is the only one that
  decides the seven-day window. A panel re-enable writes
  `account.delete_cancelled` instead of deleting audit rows; both lifecycle
  action names are excluded from `sweep-security-audit`, as is
  `board.cleanup_failed` (the durable orphan-board retry marker).
- Run revert after retention is impossible; this is documented honestly.

### 12.3. Import/export and body limits

- `EXPORT_SCHEMA_VERSION = 3`: adds optional `Board.agentPolicy`.
  `agentsPausedAt/By/Reason`, `agentPolicyVersion`, sessions, approvals, and
  runs are **not** exported. v3 is a deliberate client compatibility break:
  old clients reject the file instead of silently losing policy; release notes
  166.6 and 166.16 must repeat this.
- `parseExport` accepts v1/v2/v3; v1/v2 → `agentPolicy = null`.
- `validateImportedBoards` accepts `maxBoards`:
  - local/offline — 10;
  - server — `MAX_BOARDS_PER_USER` (0 = no limit).
- `MAX_IMPORT_BYTES = MAX_BOARD_EXPORT_BYTES = 25 MB` — import/export
  envelope only. This is **not** the command limit.
- `MAX_COMMAND_BODY_BYTES = 10 MB` — the body of one `/commands`,
  `/commands/batch`, `/plans`, or `/plans/apply` request; per-action
  `MAX_COMMAND_BYTES = 2 MB` remains. The body parser is route-specific:
  import — 25 MB, command/plan — 10 MB, everything else — the normal JSON
  limit. Exceeding it → `413 payload_too_large`; an export over 25 MB gets
  the same code with advice to use `pg_dump`, with no silent truncation.
- `POST /boards/import?dryRun=1` — preview: boards/cards/columns/labels and
  whether the operator cap accepts the envelope; writes nothing. Import is not
  a run.
- Import applies policy from v3 after validation; paused state is not
  transferred.
- A board export is serialized once and streamed; an import body is consumed
  as already parsed JSON (no stringify→parse round trip). A preflight
  `pg_column_size` estimate rejects an obviously oversized board before the
  aggregate is loaded; the exact 25 MB check still runs on the serialized
  string. Residual risk: the aggregate is still materialized in memory before
  the exact check (documented in the ADR/CHANGELOG).
- The account data bundle has its own `MAX_EXPORT_BUNDLE_BYTES = 50 MB`
  ceiling, is assembled sequentially and one build at a time per process, and
  replaces the previous ready artifact (at most one ready + one pending file
  per account), rejects a second pending export with
  `409 export_in_progress`, and excludes full envelopes of boards where the
  user is only a VIEWER. Attachments are not embedded. Boards rejected by the
  per-board preflight or failing to load are listed in `warnings`
  (`{boardId, reason}`), never silently dropped. Bundle builds are serialized
  per process (one at a time); multi-node deployments may build one bundle per
  node. Exceeding the combined 50 MB budget is always `413`, never a partial
  bundle.
- An inline bundle over 50 MB is `413`; a queued bundle over the limit settles
  as `failed` and is not retried by BullMQ (the async status is the contract,
  not a synchronous 413).
- Attachments are not part of export (as today); this is documented.

### 12.4. Backup

- Janosik **does not** create or verify backups.
- `GET /admin/retention` (and the UI) returns:

```json
{
  "retentionDays": 30,
  "purgeable": { "cards": 0, "comments": 0, "attachments": 0, "columns": 0 },
  "backups": {
    "mode": "external",
    "location": "/backups",
    "automatic": false,
    "lastBackupAt": null,
    "verified": false
  }
}
```

- `mode: "unconfigured"` when `BACKUP_DIR` is not set; `location: null`.
- UI server mode does not show "Automatic backups"/"Save a copy now"; local
  mode backup remains local.
- Runbook 166.16: `pg_dump` + uploads volume + restore drill; "external" does
  not mean "healthy".

### 12.5. Self-service export/delete

- `POST /users/me/export` is session-only and queues a `DataExport` job;
  response `202 {id, status}`. `GET /users/me/export/:id` gives status;
  `GET /users/me/export/:id/download` gives a TTL link (7 days). Only one
  export may be pending per account (`409 export_in_progress`), and the
  endpoint is throttled.
- Bundle: profile, token metadata (without hash/plaintext), memberships,
  authored comments/activity/commands, attachment metadata, and board
  envelopes for boards where the user is ADMIN or MEMBER. Boards seen only as
  a VIEWER are excluded; blob files are not embedded but stay available through
  the attachment routes. Assembly is sequential and bounded by
  `MAX_EXPORT_BUNDLE_BYTES = 50 MB`; an oversized bundle is `413`, never
  truncated.
- `GET /auth/me` exposes `hasPassword` and `deletionMethod`
  (`password`/`email_code`); the UI chooses the proof from those, never from
  the login method (an OAuth login into a password account still uses the
  password).
- `POST /users/me/delete/request-code` is session-only and applies only to an
  OAuth-only account (`passwordHash = null`): body `{oauthProof}`; it sends a
  6-digit `emailCode` to the account email, TTL 10 minutes, one-time. The code
  hash is namespaced with the user id and purpose.
- `oauthProof` is an access token issued by OAuth login
  (`/auth/oauth/:provider/callback`) no more than 10 minutes ago. The server
  checks the signature, `sub`, `iat`, and the `authMethod: "oauth"` claim; a
  normal password JWT and a PAT do not replace it. The client refreshes the
  session right before sending the proof.
- `DELETE /users/me` is session-only; body
  `{password?, oauthProof?, emailCode?, confirmEmail}`. For an account with
  `passwordHash != null`, the current password is required. For OAuth-only
  (`passwordHash = null`), `oauthProof` and `emailCode` from
  `POST /users/me/delete/request-code` are required; no password is needed.
  Immediately disable + revoke tokens + cancel sessions, then hard delete
  after the latest schedule's 7 days (maintenance), repeating admin delete
  semantics. Hard delete additionally removes `AgentSession`, the user's
  `ApprovalRequest` as requester, their `IdempotencyRecord`, the avatar blob,
  live shares they created, and boards left without any **accepted** member
  (pending invitations do not keep a board alive; an adminless board with
  remaining accepted members is left to the operator). A failed empty-board
  cleanup writes `board.cleanup_failed`; `sweep-orphan-boards` retries it and
  records `board.cleanup_recovered`. `SecurityAuditLog`
  keeps opaque ids without email. A panel re-enable writes
  `account.delete_cancelled` and schedule markers are never deleted.
  Response `{status: "scheduled", deleteAfter}`.
- `SecurityAuditLog`: `account.exported`, `account.delete_scheduled`,
  `account.delete_cancelled`, `account.deleted`; board delete —
  `board.deleted`.

### 12.6. Attachments and limits

- 20 attachments per card, 25 MB per file, MIME allowlist — unchanged.
- Object storage/presigned URL — phase 2, not TASK-166.
- Per-board storage quota and token count cap are outside TASK-166 (they do
  not block agent control); they are recorded as future work in 166.16.

---

## 13. Compatibility

### 13.1. Old PATs

- Migration: `scopePreset = "admin"`, `trustedCi = true` when
  `readOnly = false`; `readOnly = true` keeps the flag and effectively means
  Observer.
- An old PAT keeps board behavior: destructive without approval,
  member/share/board admin, batch, export/import (when account-wide).
- `trustedCi` does not override:
  - `Board.agentPolicy.destructive = "deny"`;
  - board/token pause;
  - account routes (profile/tokens/invitations) — now `pat_forbidden`;
  - boardId scope (a board-scoped token still cannot see other boards).
- Legacy read-only PAT: any write → `pat_read_only`, as before.
- Legacy PAT without a session: `agentSessionId = NULL`, `apiTokenId` is
  written; a run is created for batch/destructive.

### 13.2. Old boards and exports

- `Board.agentPolicy = NULL` → defaults; old boards do not change behavior.
- `agentsPausedAt = NULL`; old boards are not paused.
- `EXPORT_SCHEMA_VERSION = 3`; v1/v2 are imported, policy = null.
- The `Board` aggregate gains optional `agentPolicy`; old clients ignore it.
- New `Card`/`Command`/`Activity` fields are nullable; old rows are readable.
- `Board.version` is unchanged; `agentPolicyVersion` is separate.

### 13.3. Old clients and MCP

- An old MCP without sessions keeps working with a legacy PAT.
- A new MCP with a new `worker` token gets `approval_required` for destructive
  actions (or `scope_denied` for admin-only member/share/board delete); this
  is expected behavior, not a breakage.
- `janosik_update_profile`, `janosik_list_invitations`,
  `janosik_accept_invitation`, `janosik_decline_invitation` are removed:
  account **writes and sensitive account reads** are unavailable to PAT
  (`GET /users/me/tokens`, `GET /invitations`, export status/download).
  `janosik_whoami` and identity/avatar reads (`GET /auth/me`,
  `GET /users/:userId/avatar`) remain. README/skill/docs are updated in
  166.11 and 166.16.
- `create_share`, `invite_member`, `update_member`, `remove_member`,
  `delete_board`, and deleting another user's attachment require `admin` +
  approval; content deletion requires `worker` + approval. Legacy PAT bypasses
  approval.
- Tool count and `mcp/README` are updated in 166.11; until then this document
  does not pin the number.

### 13.4. Deliberate breaking changes

1. PAT can no longer change profile/avatar, manage tokens, or accept/decline
   invitations.
2. A new token defaults to `worker`, not "everything a MEMBER can do".
3. A new admin token does not get destructive actions without
   approval/`trustedCi`.
4. Board policy/pause/approval decision/run revert are unavailable to PAT.
5. `RESTORE_*` commands are unavailable to any PAT; browser undo for
   ADMIN/MEMBER is preserved, and agent recovery goes through compensation or
   human run-revert.
6. `janosik_remove_card_link` is no longer considered destructive; its
   annotation changes to WRITE.
7. `EXPORT_SCHEMA_VERSION = 3`: old clients cannot import the new file; v1/v2
   continue to import on the new server.

All of them are recorded in CHANGELOG and release notes 166.6/166.16; export
v3 needs a separate release note.

---

## 14. Stream and wave map

### 14.1. Waves and dependencies

Detailed file zones and DoD for every stream are in `ROADMAP.md` §7.23.3;
the ADR does not duplicate the 16 rows. Only waves and dependencies are
recorded here:

| Wave | Streams | Dependency / condition |
| --- | --- | --- |
| W0 | 166.0 | —; completed, W1 unblocked |
| W1 | 166.1–166.6 | after 166.0; 166.1 owns schema+migration; 166.3/166.5 depend on 166.1; the rest start in parallel |
| W2 | 166.7–166.12 | after W1; 166.7 — after 166.1+166.4; 166.8 — after 166.4+166.5; 166.9 — after 166.5 |
| W3 | 166.13–166.15 | after `feat/admin-redesign` and the corresponding backend streams |
| W4 | 166.16 | after W1–W3 |

Exact IDs, names, file zones, and DoD:
[`ROADMAP.md` §7.23.3](../ROADMAP.md) (local path `ROADMAP.md`); if there is a
conflict, ROADMAP wins for stream composition and this ADR wins for
contracts/schema/matrix.

### 14.2. File ownership and merge order

- **Prisma schema/migrations** — sole owner 166.1: it adds **all** TASK-166
  tables/fields in one migration (including `ApprovalRequest`, `AgentRun`,
  `CommandPreimage`, `SecurityAuditLog`, `IdempotencyRecord`). 166.3/166.5/
  166.7 do **not** edit `schema.prisma` and do not create their own
  migrations. If a change is needed, it is a follow-up from 166.1.
- **`shared/src/api.ts`**: 166.4 owns the error envelope/write contract;
  166.1 adds attribution, 166.2 token DTOs, 166.5 approval DTOs, 166.7 run
  DTOs. Rule: append-only sections, no file reformatting; 166.4 resolves
  conflicts.
- **`backend/src/commands/*`**: 166.1 (attribution), 166.4 (errors), 166.7
  (run/preimage) — 166.7 merges after 166.1+166.4.
- **Guards**: 166.2 — scopes; 166.3 — pause hook; 166.1 — session header.
  166.3 adds the check after 166.2; 166.2 does not implement pause.
- **MCP `mcp/src/tools/*`**: each stream adds its own file/section; 166.4
  changes `format/errors`; 166.11 updates README/OpenAPI/count.
- **UI streams 166.13–15** do not start before `feat/admin-redesign` merges;
  backend streams do not depend on it.
- If two streams still touch one file, the ROADMAP rule applies: separate
  them in time or use one worktree with an explicit owner.

### 14.3. W1 unblock order

1. 166.0 (this document) merges.
2. 166.1 lands schema+migration first; 166.2/166.3/166.5 may start
   implementation in parallel on their branches but rebase the schema part
   after 166.1. This is the only dependency 166.0 cannot remove without
   changing product code.
3. 166.4 starts immediately (the error contract does not depend on schema).
4. 166.6 starts immediately; it uses `SecurityAuditLog` from 166.1.
5. W2 starts after the corresponding W1 DoD; 166.7 after 166.1+166.4,
   166.8 after 166.4+166.5, 166.9 after 166.5.

---

## 15. General Definition of Done

- **Security:** no agent path (REST, MCP, batch, plan, import, share,
  comments, attachments, undo/restore) bypasses scopes, destructive gate,
  WIP, workflow, pause, or approval. Destructive actions are closed by default
  for new tokens.
- **Observability:** every run shows `apiTokenId`, `agentSessionId`, `runId`,
  the human actor, commands, errors, approval, and decision.
- **Rollback:** a run can be inspected and reverted with dry-run/conflict
  check; ordinary human undo is not broken.
- **Experience:** EN/RU docs, clear `403/409` with a machine code and human
  text, no silent no-ops; mutations return structuredContent.
- **Compatibility:** old PATs/boards/exports work per §13; new fields are
  nullable; self-host requires no cloud services.
- **Gates:** shared/ui/backend/mcp typecheck and unit; backend E2E; full admin
  browser E2E; new contract/E2E; lint/format; prettier for docs.
- **Required regressions:** MEMBER delete → browser undo (`RESTORE_*`) → 200;
  the same `RESTORE_*` with a PAT → 403; individual pause → pause-all →
  resume-all leaves the token paused; another `apiTokenId`'s approval → 403
  `approval_owner_mismatch`; repeated approve on an approved request is
  idempotent; observer run preview contains no pre-image; policy TTL/limits
  below global values; two PATs of one owner cannot delete each other's
  comment/attachment; OAuth-only `DELETE /users/me` without a password uses
  `oauthProof` + `emailCode`; export v3 is rejected by an old client while
  v1/v2 import on the new server; command body 10 MB is distinct from import
  25 MB.
- **166.0 DoD:** the document is merged, ROADMAP/CHANGELOG are updated, W1 is
  unblocked, and product code is unchanged.

---

## 16. Deliberately outside TASK-166

- Managed cloud, billing, DPA, status page, multi-tenant org/workspace.
- A separate `Agent`/service account entity with its own email and login.
- Remote MCP/OAuth as a required channel; webhooks; public event API.
- Object storage/S3/presigned URL; base64/URL upload for remote agents.
- Automatic backup, restore UI, storage quota, SIEM/NDJSON export.
- User 2FA, a user session list, security sign-in notifications.
- Full Jira-style workflow graph, post-functions, workflow templates, bulk
  force move; that is §7.22 phase 2.
- TASK-167 marketing redesign and its claims matrix.
- Mobile header/390 px, Sentry/pino, axe, TASK-168 tails.
- Machine translation, in-app support/status/changelog.
- Delegated human reviewer beyond board ADMIN: `approverRoles` in the MVP is
  `["ADMIN"]` only; assigning specific reviewer humans is future work.

---

## 17. Open questions

**None.** All questions that block W1 are closed in §4–§13. If a stream finds
a contradiction, it does not reopen the question; it sends a change to this
document through the 166.0 owner, and the current revision applies until that
change merges.

---

## 18. Admin panel boundary (TASK-176.11, added 2026-11-13)

This section records an existing boundary; it does not change the agent-control
semantics in §4–§13.

`/admin` is a support, moderation and investigation console. It is not a second
board client and not an agent control plane.

- **No cross-board agent section.** The panel does not list or manage agent
  runs, approvals or board policy, and it has no approve/reject, pause/resume,
  run-revert, destructive-mode or TTL controls. A master cannot decide an
  approval or change policy from `/admin`.
- **Human control stays in the user app:** `/agents` (Attention / Sessions /
  Runs), the board-scoped Agent Control modal (Inbox / Live / Runs) and Board
  Settings → Agents & automation (policy). Token-level pause, `Stop all` and
  revoke remain token-owner actions in Account → API keys.
- **Evidence is not control.** Board and audit views in `/admin` may show
  agent-authored rows with `apiTokenId`, `agentSessionId` and `runId`
  attribution. Revoking an API token in Access is account administration, not
  an approval, run or policy decision.
- **Future cross-board oversight is a separate task.** It must define a master
  API, an explicit permission model (a master account does not become a board
  ADMIN) and audit of every master access. It must not be delivered as a
  UI-only section on top of the board-scoped endpoints.

The user-facing boundary is documented in the admin guide, EN and RU:
`site/src/content/docs/docs/admin/index.md` and
`site/src/content/docs/ru/docs/admin/index.md`.
