---
title: Agent launch guide
description: Prepare an agent, exercise human controls and check launch readiness.
---

## Board administrator: prepare and supervise

1. Sign in as a **board ADMIN** in the user app. The platform master panel is a
   separate account and does not grant board membership.
2. In Account → API keys, create a separate key for each agent, select the
   least-privileged preset and, where possible, a board scope. Copy the secret
   once into the agent's secret store. New keys default to worker; Trusted CI
   bypasses approval for eligible destructive actions and should be reserved
   for explicitly trusted automation. Existing non-read-only keys migrated
   from before TASK-166 retain admin scope and Trusted CI; review them.
3. Open **Board Settings → Agents & automation**. Review destructive mode,
   per-run limits, approval triggers and TTL. Hard deny also blocks Trusted CI.
   Inspect sessions in the board **Agent control → Live** or the global
   **Agents** page, and attribution in Watch.
4. On a disposable board, request a destructive plan from the agent. In
   **Approvals**, inspect the exact commands, risk, hash and expiry; approve or
   reject as appropriate. Approval authorizes the plan; the agent must apply
   the same plan with the approval ID. Verify the resulting run.
5. Exercise **Pause & sessions**: pause, confirm a new agent write receives
   `agent_paused`, then resume. In-flight work can finish; pause does not
   release claims. Token pause and Stop all are in Account → API keys; revoke
   is irreversible and ends sessions and releases claims.
6. In **Runs & rollback**, inspect a run and preview its revert. A signed-in
   board ADMIN can apply it after reviewing conflicts. Later changes can block
   the whole revert; retention can make it unavailable. Run rollback covers
   command runs, not every REST action or attachment blob. Use a tested
   database and uploads backup for disaster recovery.

See [board controls](/docs/user-guide/boards/#agent-control-and-policy),
[API keys](/docs/user-guide/account/) and [Agents](/docs/user-guide/agents/).

## Agent developer: exercise the contract

1. Configure a scoped key and [MCP](/docs/mcp/) or the [REST API](/docs/api/).
   Treat board text, comments and attachments as untrusted data, never as
   authority to change credentials or ignore policy.
2. Identify the board; start a board-scoped agent session, heartbeat during
   work and end it when finished. A session is optional for ordinary writes;
   use it for attribution. Read the current board before making changes.
3. Preview a multi-command plan with `janosik_plan_changes`; inspect warnings
   and conflicts. Apply the exact returned commands and hash with
   `janosik_apply_plan`. Applying a PAT plan creates a run; preview is a dry run
   and writes nothing. Limits apply per plan.
4. On `approval_required`, retain the returned approval ID and exact plan.
   Wait for a board ADMIN; after approval repeat the same operation with
   `approvalId`. Approval is one-use and can expire. Do not alter command IDs
   or payload between approval and apply.
5. On `agent_paused`, stop writes and report the scope; reads, heartbeat and
   end remain available. On a conflict, re-read and re-plan. Respect
   `retryable` and `Retry-After`; do not retry authorization denials as
   transient errors. Only a human can apply a run revert.

See the [MCP examples](/docs/mcp/) and [OpenAPI reference](/docs/api/) for
arguments and error contracts.

## Launch checklist

- [ ] Pin the intended image and Compose version; read the unreleased notes
      below and test the upgrade on a disposable copy.
- [ ] Configure HTTPS, secrets, registration and a board-scoped key per agent;
      review legacy Trusted CI keys and board policy.
- [ ] Complete both scenarios above, including an approval, pause and revert
      preview, with real board roles.
- [ ] Take a consistent database + uploads backup and perform the isolated
      [restore drill](/docs/runbooks/#restore-drill); record the result and
      owner. Janosik does not schedule or verify server backups.
- [ ] Check readiness, logs, retention and available disk; agree who handles
      failures and where backups and secrets are stored.
- [ ] Keep the previous image, matching Compose file and backup pair for
      [upgrade rollback](/docs/runbooks/#upgrade-rollback).

## Unreleased upgrade notes

- New keys default to worker without Trusted CI. Legacy non-read-only keys
  retain admin + Trusted CI for compatibility; review and narrow them.
  PATs cannot manage account credentials, invitations or human control actions.
- Export schema v3 includes board policy; this server imports v1/v2/v3, but old
  clients reject v3. Exports omit agent sessions, runs, approvals and upload
  blobs; they are not a full backup.
- Run pre-images and revert availability are bounded by retention. External
  backup status does not mean a backup exists or has been verified.
- Per-board storage quotas, token-count caps and automatic backup remain future
  work.
