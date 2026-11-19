# TASK-180.7 — Demo, retention and snapshots

Base commit `244d0cec` (`origin/main`).

| ID | Implementation | Regression evidence |
| --- | --- | --- |
| H9 | Start and stop serialize in each backend process. Provisioning reserves IDs in `DemoRun` before writing demo data. Cleanup uses those IDs and can retry interrupted starts. Older runs fall back to their remaining creation commands. A dedicated board with dependencies stays pending. Existing boards and user-created dependencies are preserved. EN/RU confirmation describes the scope and the Board id warning explains that the observation link publishes existing content and comments. | [Admin demo API tests](../backend/test/admin-throttle-demo.e2e-spec.ts) cover concurrent starts and stop during provisioning, checklist item and link cleanup after `sweep-commands`, pending cleanup and retry, and preservation of existing real rows and cross-board references. The existing-board fixture verifies cleanup of both a previous run's observation share and the current run's share. The running scenario creates checklists and items. The link test seeds a manifest-recorded link explicitly. [Demo page tests](../ui/src/admin/DemoPage.test.tsx) assert the warning and confirmation copy. |
| M18 | Snapshots freeze the board, roster, opted-in comments and files. Indexed comment pages and file references live separately from the board JSON. Share lists and authorization read metadata only. Owner responses distinguish configured flags from effective visibility. Creation and refresh reject capture of more than 500 files or 100 MiB before copying. Older board-only snapshots can serve retained source rows up to the capture time. | [Public share API tests](../backend/test/board-share.e2e-spec.ts) verify frozen pages, metadata and bytes through source edits, removal and hard purge, legacy cutoff and detachment behavior, visibility before and after refresh, atomic rejection of oversized captures, and the documented account-erasure exception. [Share dialog tests](../ui/src/components/board/ShareDialog.test.tsx) verify snapshot comment defaults and the refresh warning. |
| M19 | Each process stores up to 64 live board aggregates in an LRU cache and admits up to 64 distinct cold rebuilds at once. Concurrent requests for one board share its rebuild. | [Cache tests](../backend/src/share/share-aggregate-cache.spec.ts) verify sequence and TTL invalidation, LRU, expiry pruning and admission control for rebuilds. |
| M23 | `sweep-agent-sessions` removes sessions past retention from `endedAt`. `sweep-approvals` expires overdue pending requests across all boards. Retention uses `decidedAt` for rejected or cancelled requests, `expiresAt` for expired or lapsed approved requests, and `consumedAt` for consumed requests. Hard board purge removes all of its sessions and approvals. The Purge now confirmation describes that scope. | [Admin maintenance API tests](../backend/test/admin-queues.e2e-spec.ts) verify expired requests on idle boards, the expiration activity, removal of lapsed and old terminal rows, preservation of open and recent rows, and removal of the remaining agent data when its board is purged. Repeated sweeps remove zero rows. |

The [retention migration](../backend/prisma/migrations/20261119150000_task_180_7_snapshots_retention/migration.sql)
and [concurrent index helper](../backend/scripts/db-indexes.cjs) cover large
installs. The [snapshot migration](../backend/prisma/migrations/20261119160000_task_180_7_snapshot_content/migration.sql)
backfills captured content and reopens previously stopped dedicated runs
whose boards remain. The [OpenAPI contract](../site/public/openapi.yaml) and
EN/RU admin, REST, sharing, account, security and self-hosting docs describe
the behavior.

## Verification

- Backend, shared and UI typechecks passed.
- Targeted backend unit tests passed (68 tests in 8 suites).
- Focused UI tests passed (38 tests in 5 suites).
- Repository lint passed with 77 existing UI warnings. Repository Prettier,
  `git diff --check`, OpenAPI validation and its 10 tests passed.
- A clean PostgreSQL 16 database applied all 65 migrations and matched the
  Prisma schema. A separate upgrade test prebuilt the retention indexes
  concurrently, then verified migrated legacy snapshot data, preservation of
  capture opt-outs, normalized records and retryable legacy demo cleanup.
- Backend API E2E passed (180 tests in 10 suites) with isolated PostgreSQL.
  Existing image fixtures logged FFmpeg thumbnail failures with the local
  binary. The snapshot tests verified original downloads. The full
  Docker/browser matrix was outside the requested scope.

## Compatibility and limits

- Demo lifecycle serialization is per backend process. A legacy run whose
  child creation commands have already been trimmed can still have rows
  without an ownership record. Those rows are preserved. User-created
  dependencies can keep dedicated-board cleanup pending.
- The legacy snapshot fallback lasts as long as the qualifying source rows.
  Published independent captures remain available after source account
  erasure until the owner refreshes, the link is revoked or it expires.
  File copies use the board-write transaction budget. Unreferenced files
  are eligible for orphan cleanup after the storage grace period.
- Cache and work limits count board aggregates per process. Memory use
  depends on the size of the individual aggregates.
- An open session or an approval still in its decision or apply window can
  survive until it becomes eligible or its board is purged. Rows orphaned by
  board purges predating TASK-180.7 are outside the board-purge cleanup path.
