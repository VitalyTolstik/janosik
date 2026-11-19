# TASK-180.7 — Demo, retention and snapshots

Base: `244d0cec` (`origin/main`).

| ID | Implementation | Regression evidence |
| --- | --- | --- |
| H9 | Demo start and stop clean pending recorded runs. The manifest identifies the board, users, cards, columns, labels and observation share. Demo-authored creation commands identify card links and checklist rows. Cleanup scopes relations to the run, keeps parents required by user-created rows and deletes a dedicated board only after its recorded footprint is removed and the board is empty. Provisioning errors roll back the known footprint. | [Admin demo E2E](../backend/test/admin-throttle-demo.e2e-spec.ts) starts on a real board with a demo title, card/column names and a demo-domain member. A previous run's recorded link, card and user disappear at startup. A real-to-real link and a user link to a demo card, both real memberships, the existing share and the board survive start and stop. The current run's observation share is removed. Existing dedicated-board lifecycle tests still pass. |
| M18 | Snapshot capture stores the sanitized board and roster, opted-in comments and attachment metadata, and independent file copies. Refresh replaces the capture. The public reads use only captured data, with the existing comment cursor and visibility flags. PostgreSQL tracks each captured file by share so expiry or permanent removal releases its reference to the orphan sweep. Archive, soft deletion and hard purge of the source board preserve the capture. | [Public share E2E](../backend/test/board-share.e2e-spec.ts) compares the same comment pages, metadata and downloaded bytes after editing, deleting and adding source data, then after board archive, deletion and hard purge. It verifies the source file is gone, the orphan sweep preserves the referenced copy, and an expired share releases the copy. It also verifies flag changes, refresh and replacement of copy references. |
| M19 | The per-process live-share cache stores up to 64 board aggregates, pruning expired entries on insert and evicting the least recently used aggregate at capacity. Sequence checks, TTL and per-board single-flight requests still apply. | [Cache unit tests](../backend/src/share/share-aggregate-cache.spec.ts) fill the cache, touch an older entry, exceed capacity, and verify LRU eviction plus expiry pruning on insertion. Existing live share cache tests cover command invalidation and rebuild deduplication. |
| M23 | `sweep-agent-sessions` removes ended sessions after the configured retention window. `sweep-approvals` uses `decidedAt` for rejected or cancelled requests, `expiresAt` for expired requests and `consumedAt` for consumed requests. Both jobs page deletions and recheck eligibility. The board purge transaction removes all sessions and approvals for the purged board. | [Admin maintenance E2E](../backend/test/admin-queues.e2e-spec.ts) runs both named jobs through HTTP, verifies that old terminal rows are removed and open or recently terminal rows survive, then checks that permanent board purge removes its remaining sessions and approvals. The second run of each sweep removes zero rows. |

The [Prisma migration](../backend/prisma/migrations/20261119150000_task_180_7_snapshots_retention/migration.sql)
adds snapshot file references and retention indexes. The [OpenAPI contract](../site/public/openapi.yaml)
and EN/RU admin, REST, sharing, security and self-hosting docs describe the changed behavior.

## Verification

- Backend and shared typechecks and the UI project typecheck passed.
- Targeted backend unit tests passed (71 tests in 9 suites).
- Focused UI tests passed (26 tests in 4 suites): public board, share dialog,
  master share list and demo panel.
- Repository lint passed with 77 existing UI warnings. Repository Prettier,
  `git diff --check`, OpenAPI validation and its 10 tests passed.
- A clean PostgreSQL 16 database applied all Prisma migrations. Prisma reported
  no differences between the migrated database and the schema.
- Backend API E2E passed (118 tests in 8 suites) against the isolated
  PostgreSQL database. Existing image fixtures logged FFmpeg thumbnail failures
  with the local binary. The share tests exercise original-file downloads.
  The full Docker/browser matrix was outside the requested verification scope.

## Residual risks and compatibility

- H9: a hard process exit before the manifest is saved, or command retention
  trimming the only ownership record for a child row, can leave demo artifacts
  behind. Cleanup deliberately requires recorded ownership.
- M18: legacy snapshots keep serving the captured board and roster. Their
  comments and files require an explicit refresh from an accessible source
  board. Capturing attachment files uses upload-volume space and the board-write
  transaction budget. Expired or replaced copies are reclaimed by the orphan
  sweep after its grace window.
- M19: the limit is a count of cached boards per process. Memory depends on
  individual board size and concurrent in-flight rebuilds.
- M23: the age sweeps preserve open sessions and pending or approved requests.
  Approval expiry is still enforced by the approval flow. Records orphaned by
  board purges predating this change are outside board-purge cleanup.
