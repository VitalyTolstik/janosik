# TASK-180.1 — Rollback and run correctness

Implements the 180.1 slice of `TASK-180-bug-research-remediation.md` on top of
TASK-176.8 branch A (`05d0df30`). No PR/merge is part of this stream.

## What changed

| ID | Change |
|---|---|
| C1 | `finalizePreimage` stores `inverse: null` when the command wrote no entity, and `RunsService.analyze` ignores a legacy no-op pre-image even if an older row still carries `DELETE_COLUMN`/`DELETE_CARD`. A no-op-only run previews `canRevert:false` and cannot be applied. |
| H4 | Card membership/order writes bump the column's `version` (raw SQL, so `updatedAt` stays untouched). A run-created column's `postVersion` now changes when a human adds, moves, archives or deletes a card later, so `DELETE_COLUMN` is refused with a conflict instead of cascading over the new card. |
| H5 | `RESTORE_CARD`/`UNARCHIVE_CARD` inverses are checked against the recorded source column at preview/apply time. A deleted source column is a `run_conflict` (`deleted`/`missing`), never a silent fallback to column 1 or a `reverted` run with the card still gone. |
| H6 | `analyze` compares retained commands with `run.commandCount`; a partial command set is `409 run_expired` without applying anything. |
| M20 | A concurrent replay with the same revert `commandId` is reconciled only when the existing revert's `revertsRunId` matches. A key reused for another run is `409 run_conflict` with that target `runId`. |
| M21 | The run detail reuses one `commandId` per attempt until a success; a retry after a lost response sends the same key and reconciles to the committed revert. |
| M22 | The preview runs the apply-time precondition pass: WIP/collection checks replayed in inverse order, removed assignee membership, and the 2 MiB inverse payload cap. Conflicts use `wip`, `assignee_not_member` and `payload_too_large` reasons. The UI maps `limit_exceeded`, `validation_failed` and `payload_too_large` to specific copy. |
| L21 | A missing `commandId` is `400 validation_failed`; `run_conflict` carries `runId`/`currentVersion`; `run_expired` carries `runId`/`retentionDays`. Read-only PATs may use the generic `revert` route with `{dryRun:true}`; a real revert stays `403 pat_forbidden`. |
| L37 | The dead `failed` run status is removed from the shared status list, filters, UI, MCP schema, agents-overview counts, OpenAPI and docs. A failed transaction rolls back and creates no run; no failed-run semantics were added. |
| L38 | A fresh run commit publishes board-scoped `run.created`; an open board Runs tab refreshes without a reload. `run.reverted` is unchanged. Admin/internal commands stay run-free and publish neither event. |

## Cross-cluster boundaries

- **180.2** owns the forged `inverse:true` auth/refusal and RESTORE collection
  caps. This stream only inspects server-built inverses.
- **180.3** owns the full PAT/session error-code matrix. We allowlisted the
  generic `POST /boards/:id/runs/:runId/revert` route so the controller can
  decide `{dryRun:true}` and the service returns the documented
  `pat_forbidden` for a real revert; other read-only control routes are
  unchanged.
- **180.5** must re-check the public run contract after this removal of
  `failed` (OpenAPI, REST docs, MCP description).
- **180.6** owns routing run events to every board on the global `/agents`
  overview. `run.created` is board-scoped today; only the active board stream
  reaches the UI.
- **180.7** owns retention/demo cleanup. If a sweep removes commands from a run,
  this stream now reports `run_expired` instead of a partial revert. The sweep
  should keep `commandCount` meaningful or rely on that refusal.

## Tests added

- `backend/test/runs.e2e-spec.ts`: no-op inverses for `ADD_COLUMN`, `ADD_LABEL`,
  `DUPLICATE_CARD`, `DUPLICATE_COLUMN`, `SET_CARD_LABEL`, `ADD_CHECKLIST`,
  `ADD_CHECKLIST_ITEM`; no-op-only run; H4 later card; H5 deleted source column
  for delete and archive; H6 removed command; M20 concurrent/different-run
  replay; M22 WIP, removed assignee and oversized inverse; L21 400/context/
  read-only PAT dry run; L38 `run.created`; `reverted` filter and rejection of
  the retired `failed` filter.
- `backend/src/runs/runs.service.spec.ts`: constructor + precondition wiring.
- `backend/src/common/membership.guard.spec.ts`: generic revert route is a
  read-only control operation.
- `ui/.../RunsPanel.test.tsx`: same-key lost-response retry, specific limit/
  validation/payload copy, `run.created` list refresh.
- Shared/UI docs tests updated for the two-status run contract.

## Verification

See the stream report for exact commands and results.
