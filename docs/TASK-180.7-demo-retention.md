# TASK-180.7 — Demo, retention and snapshots

Base commit `244d0cec` (`origin/main`).

| ID | Implementation | Regression evidence |
| --- | --- | --- |
| H9 | Start and stop serialize in each backend process. Provisioning reserves IDs in `DemoRun` before writing demo data. Cleanup uses those IDs and can retry interrupted starts. Older runs fall back to their remaining creation commands. A dedicated board with dependencies stays pending. Existing boards and user-created dependencies are preserved. EN/RU copy qualifies cleanup success and warns that the public observation link exposes existing content and comments on the saved Board id. | [Admin demo API tests](../backend/test/admin-throttle-demo.e2e-spec.ts) cover concurrent starts and stop during provisioning, checklist item and link cleanup after `sweep-commands`, pending cleanup and retry, and preservation of existing real rows and cross-board references. The existing-board fixture verifies cleanup of both a previous run's observation share and the current run's share. The running scenario creates checklists and items. The link test seeds a manifest-recorded link explicitly. [Demo page tests](../ui/src/admin/DemoPage.test.tsx) verify the saved-target warning, the confirmation and the toast for a successful stop with retained dependencies. |
| M18 | Snapshots freeze the board, roster, opted-in comments and files. Indexed comment pages and file references live separately from the board JSON. Share lists and authorization read metadata only. Owner responses distinguish configured flags from effective visibility. Creation and refresh cap files at 500 and 100 MiB and comments at 1,000 and 10 MiB of UTF-8 comment JSON. Older board-only snapshots can serve source rows up to the capture time while the source board is available. The user-deletion UI and docs explain that published snapshot copies can remain public after erasure. | [Public share API tests](../backend/test/board-share.e2e-spec.ts) verify frozen pages, metadata and bytes through source edits, removal and hard purge, legacy cutoff and soft-deletion behavior, visibility before and after refresh, file count and byte boundaries, comment limits and the account-erasure exception. [Share dialog tests](../ui/src/components/board/ShareDialog.test.tsx) verify snapshot comment defaults and the refresh warning. [Admin UI tests](../ui/src/admin/AdminApp.test.tsx) verify the deletion caveat and security policy links. |
| M19 | Each process stores up to 64 live board aggregates in an LRU cache and admits up to 64 distinct cold rebuilds at once. Concurrent requests for one board share its rebuild. | [Cache tests](../backend/src/share/share-aggregate-cache.spec.ts) verify sequence and TTL invalidation, LRU, expiry pruning and admission control for rebuilds. |
| M23 | `sweep-agent-sessions` removes sessions past retention from `endedAt`. `sweep-approvals` expires overdue pending requests across all boards. Retention uses `decidedAt` for rejected or cancelled requests, `expiresAt` for expired or lapsed approved requests, and `consumedAt` for consumed requests. Hard board purge removes all of its sessions and approvals. The Purge now confirmation describes that scope. | [Admin maintenance API tests](../backend/test/admin-queues.e2e-spec.ts) verify expired requests on idle boards, the expiration activity, removal of lapsed and old terminal rows, preservation of open and recent rows, and removal of the remaining agent data when its board is purged. Repeated sweeps remove zero rows. |

The [retention migration](../backend/prisma/migrations/20261119150000_task_180_7_snapshots_retention/migration.sql)
and [concurrent index helper](../backend/scripts/db-indexes.cjs) cover large
installs. The [snapshot migration](../backend/prisma/migrations/20261119160000_task_180_7_snapshot_content/migration.sql)
backfills captured content and reopens previously stopped dedicated runs
whose boards remain. The [OpenAPI contract](../site/public/openapi.yaml) and
EN/RU admin, REST, sharing, account, security and self-hosting docs describe
the behavior.

The retention migration's `IF NOT EXISTS` came from the preceding branch
commit (`fec83150`) so first application accepts indexes built concurrently
by the helper. The review follow-up leaves the migration files at that
revision. The upgrade check starts from the released `v0.2.0` schema.

## Verification

Typechecks passed with `npm run typecheck -w backend`, `npm run typecheck -w shared`
and `npx tsc -b ui`. `npm run lint` reported 77 existing UI warnings and zero
errors. `npm run format:check` and `git diff --check` passed.
`npm run check -w site`, `npm run build:site` and `npm run test -w site`
(69 tests across 3 suites) passed. `npm run openapi:check` validated 90
operations and `npm run openapi:test` passed all 10 tests.

Backend unit selection from the previous evidence, 68 tests across 8 suites.
Adding `src/attachments/attachments.service.spec.ts` to the same command
reproduces 72 tests across 9 suites.

```sh
npm run test:unit -w backend -- --runInBand src/share \
  src/ops/maintenance.service.spec.ts src/users/account-deletion.service.spec.ts \
  src/common/board-write.service.spec.ts src/approvals
```

The first UI command below had 38 tests across 5 files at `fec83150` and
now has 39 after adding the demo-stop case. The separately reported 34
across 5 came without a file list. The second command passed 64 tests
across 3 admin suites.

```sh
npm run test -w ui -- src/admin/DemoPage.test.tsx src/admin/SharesPage.test.tsx \
  src/components/board/ShareDialog.test.tsx src/share/PublicBoardPage.test.tsx \
  src/components/account/DataPrivacySection.test.tsx
npm run test -w ui -- src/admin/AdminApp.test.tsx src/admin/UserDetailPage.test.tsx \
  src/admin/admin-i18n.test.ts
```

Backend API E2E passed 183 tests across 10 suites on isolated PostgreSQL 16.
Some existing image fixtures logged FFmpeg thumbnail failures. The share
tests verified original file downloads.

```sh
npm run test:e2e -w backend -- --runTestsByPath test/admin-queues.e2e-spec.ts \
  test/admin-throttle-demo.e2e-spec.ts test/board-share.e2e-spec.ts \
  test/approvals.e2e-spec.ts test/task-166-scopes.e2e-spec.ts \
  test/agent-review-hardening.e2e-spec.ts test/write-contract.e2e-spec.ts \
  test/admin.e2e-spec.ts test/command-ids.e2e-spec.ts \
  test/agent-control-approval-security.e2e-spec.ts
```

A clean database applied all 65 migrations using `prisma migrate deploy`.
The upgrade database applied the 48 migrations from `v0.2.0`, ran
`node scripts/db-indexes.cjs` from `backend` twice with the agent tables
absent, applied the migrations through the base commit, and ran the helper twice again
before applying the two TASK-180.7 migrations. SQL assertions verified the
valid indexes, migrated legacy snapshot records and capture opt-outs, and
reopening of retained dedicated demos. On both databases,
`prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
from `backend` reported zero schema drift. The Docker/browser matrix was
outside the requested scope.

## Compatibility and limits

- Demo lifecycle serialization is per backend process. A legacy run whose
  child creation commands have already been trimmed can still have rows
  without an ownership record. Those rows are preserved. User-created
  dependencies can keep dedicated-board cleanup pending. A run on a provided
  board can be marked stopped with recorded demo rows still needed by
  user-created data. Those rows are outside automatic retry and can be
  removed manually once their dependencies are resolved.
- The legacy snapshot fallback lasts while the source board and the
  qualifying rows are available. Soft-deleting the source board disables it.
  Published independent captures remain available after source account
  erasure until the owner refreshes, the link is revoked or it expires.
  File copies hold source attachment locks within the 15-second board-write
  transaction so transcode cannot replace selected files during capture.
  Slow storage can still exhaust the budget even under the 500-file and
  100 MiB caps. A timed-out refresh keeps the previous capture. Unreferenced
  files are eligible for orphan cleanup after the storage grace period.
- Cache and work limits count board aggregates per process. Memory use
  depends on the size of the individual aggregates.
- An open session or an approval still in its decision or apply window can
  survive until it becomes eligible or its board is purged. Rows orphaned by
  board purges predating TASK-180.7 are outside the board-purge cleanup path.
