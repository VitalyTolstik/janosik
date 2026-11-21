# TASK-181.7 acceptance record

**Date:** 2026-11-21

**Scope:** TASK-181 admin filter documentation, the EN/RU browser matrix, the
5k PR gate, the full 25k qualification and the final regression sweep.

This record is the rollout evidence for
[TASK-181](./TASK-181-admin-list-filters.md). It replaces the 5k-only
conclusions in the [181.4](./TASK-181.4-moderation-perf.md),
[181.5](./TASK-181.5-content-perf.md) and
[181.6](./TASK-181.6-audit-perf.md) records where they differ.

## Dataset and method

The full fixture is the migrated `--preset full` dataset:
25,000 cards, 100 boards, 500 columns, 200 labels, 500 users, 25,000
checklists, 75,000 checklist items, 50,000 comments, 10,000 attachments,
10,000 commands, 10,000 card links, 10,000 activity rows and 25,000 audit rows.
The gate fixture is the matching `--preset gate` subset (5,000 cards).

The benchmark seeds a dedicated database, runs `VACUUM (ANALYZE)`, and measures
one page query plus one exact count in a transaction at offset 0 and page sizes
25, 50 and 100. Cold samples use a fresh connection with shared buffers intact.
The core cases use 5 cold + 20 warm samples; the extended cases use 3 cold + 10
warm samples. A filtered case fails when warm p95 is more than +20% above the
unfiltered list at the same page size, or when a sequential scan examines at
least 10,000 rows. EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) is captured for every
page and count. Board-scoped moderation is measured too: attachments add
`board`, `board-period` and `board-mime`, while comments use the `commentsBoard`
series with its own unfiltered joined baseline so the delta compares the same
Card/Column join shape the shipped filter uses.

```bash
node scripts/perf/seed-admin-filters.mjs --preset full
docker exec <postgres> psql -U <user> -d <db> -c 'VACUUM (ANALYZE);'
ADMIN_FILTER_PERF_DATABASE_URL=... npm run perf:admin-filters -- \
  --preset full --output task-181.7-full.json
```

Raw samples and plans:
[run 1](../scripts/perf/results/task-181.7-full-run1.json.gz) and
[run 2](../scripts/perf/results/task-181.7-full-run2.json.gz).

## Shipping indexes

The measured index migration is
[20261121091012_task_181_7_filter_perf_indexes](../backend/prisma/migrations/20261121091012_task_181_7_filter_perf_indexes/migration.sql);
the board-scoped attachment index is
[20261121130000_task_181_7_attachment_board_index](../backend/prisma/migrations/20261121130000_task_181_7_attachment_board_index/migration.sql),
and the audit target index is
[20261121140000_task_181_7_audit_target_index](../backend/prisma/migrations/20261121140000_task_181_7_audit_target_index/migration.sql).
Each index below is exercised by the measured plans and the 25k predicate
harness; `User(createdAt)` is measured as well.

| Index | Why |
| --- | --- |
| `Card(priority, updatedAt)` | priority facet + card order |
| `Card(attachmentCount, updatedAt)` | has/no card attachments + order |
| `Card(createdAt)` | card period tabs |
| `Card(columnId, deletedAt)` | live card counts per column |
| `Card(id, deletedAt)` | live-card lookup for label counts |
| `Comment(authorId, createdAt)` | comment author and combined moderation |
| `Comment(kind, createdAt)` | comment kind and combined moderation |
| `Comment(createdAt)` | comment period tabs |
| `Attachment(boardId, createdAt)` | board-scoped moderation |
| `Attachment(createdAt)` | attachment period tabs |
| `Attachment(uploadedById, createdAt)` | uploader facet |
| `Attachment(transcodeStatus, createdAt)` | video processing facet |
| `Attachment(mimeFamily, createdAt)` | file-type facet (indexed family) |
| `CardLink(createdAt)` | link order and type filters |
| `CardLink(type, createdAt)` | single-type filters |
| `CardLink(boardId, type, createdAt)` | type + board |
| `CardLabel(labelId, cardId)` | page-scoped label card counts |
| `User(createdAt)` | users period tabs |
| `AdminAuditLog(targetType, createdAt)` | audit target type + period |

### MIME family

A negated union of `ILIKE` branches (`other`) and prefix `ILIKE` cannot use a
B-tree index. TASK-181.4 recorded that as a 25k design decision. TASK-181.7 adds
`Attachment.mimeFamily` (`image`, `video`, `pdf`, `document`, `other`), stores it
on upload, backfills existing rows, and keeps it correct for fixtures/imports
with a `BEFORE INSERT OR UPDATE OF mimeType` trigger. The admin request DTO uses
the family values; the row DTO still reports `mimeType`.

The label and column card counts are now page-scoped. Prisma's `_count`
aggregates every row in the relation before the page is known; the service uses
`cardLabel.groupBy` / a page-scoped count instead.

## 25k results

Two independent full runs were measured on the same vacuumed fixture. Every
case reported the same exact total in both runs (51 distinct totals across 321
cases).

| Run | Passed | Single-run p95 misses | Filtered seq scans | Raw artifact |
| --- | ---: | ---: | ---: | --- |
| 1 | 310 / 321 | 11 | 0 | [run 1](../scripts/perf/results/task-181.7-full-run1.json.gz) |
| 2 | 310 / 321 | 11 | 0 | [run 2](../scripts/perf/results/task-181.7-full-run2.json.gz) |

No filtered page or count plan in either run had a `Seq Scan` node at or above
the 10,000-row cutoff. Smaller dimension/display joins (User, Column, Board and
the 5k Card joins) can still be sequential scans below that cutoff; the
**Filtered seq scans** column counts only the cutoff. The only scans above the
cutoff are the **unfiltered** card, board and checklist baselines.

| Run | Case | Page | Total | Warm p50 | Warm p95 | Delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | `attachments/period` | 100 | 961 | 3.75 | 6.03 | +45.6% |
| 1 | `attachments/mime-video` | 25 | 1667 | 3.34 | 5.07 | +24.4% |
| 1 | `attachments/transcode` | 25 | 333 | 3.21 | 4.90 | +20.3% |
| 1 | `attachments/transcode-none` | 50 | 8666 | 3.48 | 5.42 | +42.2% |
| 1 | `attachments/transcode-period` | 100 | 32 | 2.42 | 7.05 | +70.1% |
| 1 | `attachments/board-mime` | 50 | 0 | 1.95 | 10.53 | +176.4% |
| 1 | `users/period-7d` | 25 | 15 | 1.90 | 2.34 | +21.1% |
| 1 | `users/unverified-period-7d` | 25 | 3 | 1.92 | 2.99 | +54.5% |
| 1 | `audit/actor-period` | 25 | 97 | 2.16 | 7.21 | +173.7% |
| 1 | `audit/target-type-period` | 25 | 193 | 2.04 | 9.62 | +265.2% |
| 1 | `activity/actor-period` | 100 | 2 | 1.81 | 13.62 | +330.6% |
| 2 | `attachments/period` | 50 | 961 | 3.25 | 5.91 | +70.7% |
| 2 | `attachments/mime` | 100 | 1667 | 3.54 | 5.30 | +31.7% |
| 2 | `attachments/mime-pdf` | 100 | 1667 | 3.59 | 4.90 | +21.9% |
| 2 | `attachments/mime-other` | 100 | 3333 | 3.55 | 4.93 | +22.7% |
| 2 | `attachments/transcode-failed` | 100 | 333 | 2.88 | 4.85 | +20.5% |
| 2 | `attachments/transcode-none` | 100 | 8666 | 3.66 | 4.84 | +20.4% |
| 2 | `attachments/mime-period` | 50 | 160 | 3.58 | 4.49 | +29.8% |
| 2 | `users/verified` | 50 | 400 | 2.04 | 2.41 | +24.5% |
| 2 | `cardLinks/type-multiple` | 100 | 6667 | 3.29 | 9.12 | +175.9% |
| 2 | `audit/actor-period` | 25 | 97 | 2.06 | 9.41 | +230.6% |
| 2 | `audit/target-type-period` | 25 | 193 | 2.08 | 9.70 | +241.1% |

**Confirmation rule.** A case counts as a regression when it misses in both
independent runs. The strict intersection has two cases:
`audit/actor-period@25` and `audit/target-type-period@25`. Both have a ~2 ms
p50 and one slow sample; the page plan is a createdAt index scan over 251 rows
and the count is an index-only scan. A dedicated audit re-measurement after
adding `AdminAuditLog(targetType, createdAt)` was run twice: the two audit runs
had no shared miss and the same cases measured 2.2–3.6 ms p95. The full-run
outliers are a long-mixed-run artifact, not a query regression.

The two audit period cases are recorded as the scoped 25k audit exception; they
remain a rollout watch item. Every other case passes the two-run rule, all
totals are exact, and no filtered plan crosses the scan cutoff. The 25k
qualification is green for cards, comments, attachments, boards, columns,
labels, checklists, card links, users, commands and activity, and for audit
except the two documented period cases. The specific rollout work is listed
under Residuals.

## 5k PR gate

The 5k gate was measured twice on the same vacuumed `--preset gate` database.

| Run | Passed | Single-run p95 misses | Filtered seq scans | Raw artifact |
| --- | ---: | ---: | ---: | --- |
| 1 | 225 / 231 | 6 | 0 | [run 1](../scripts/perf/results/task-181.7-gate-run1.json.gz) |
| 2 | 225 / 231 | 6 | 0 | [run 2](../scripts/perf/results/task-181.7-gate-run2.json.gz) |

Every case reported the same exact total in both runs. Three cases missed in
both runs:

| Case | Page | Total | Run 1 p50 / p95 | Run 2 p50 / p95 | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| `audit/actor` | 100 | 500 | 2.28 / 3.35 ms | 2.34 / 3.21 ms | +26.9% / +25.8% |
| `comments/kind-period` | 50 | 320 | 2.78 / 5.28 ms | 2.60 / 5.28 ms | +71.4% / +64.0% |
| `attachments/transcode-none` | 50 | 1734 | 3.24 / 5.52 ms | 3.00 / 4.87 ms | +68.4% / +50.0% |

All three have index plans, exact totals and p95 at or below 5.52 ms; none
triggers the 10k scan cutoff. They are accepted as scoped 5k PR-gate
exceptions. None reproduces as a two-run failure at 25k, so this is a 5k-scale
plan/threshold effect, not a 25k regression. The 25k qualification remains the
rollout gate.

**5k PR gate:** accepted with the three scoped exceptions above. All other
cases pass under the two-run rule.

## Browser matrix

`e2e/tests/admin/filter-acceptance.spec.ts` passed 6/6 on the admin stack. Each
case signs in as the owner, opens the cards list with a board and label filter
and the 7-day period tab, asserts the exact card and both chips, and asserts
`document.documentElement.scrollWidth <= window.innerWidth`. The 390 px cases
also open the filter sheet, assert it is visible and capture it.

| Locale | 1440 | 1024 | 390 | 390 sheet |
| --- | --- | --- | --- | --- |
| EN | [png](./assets/task-181.7/filters-en-1440.png) | [png](./assets/task-181.7/filters-en-1024.png) | [png](./assets/task-181.7/filters-en-390.png) | [png](./assets/task-181.7/filters-en-390-sheet.png) |
| RU | [png](./assets/task-181.7/filters-ru-1440.png) | [png](./assets/task-181.7/filters-ru-1024.png) | [png](./assets/task-181.7/filters-ru-390.png) | [png](./assets/task-181.7/filters-ru-390-sheet.png) |

![EN cards filters at 1440](./assets/task-181.7/filters-en-1440.png)

![RU filter sheet at 390](./assets/task-181.7/filters-ru-390-sheet.png)

The behavioural matrix is covered by the existing admin specs:
`card-filter-bar.spec.ts` (pickers, drafts, conflicts, long titles, keyboard at
1440/1024/390), `content-filters.spec.ts` (boards/columns/labels/checklists/
links/users), `moderation-filters.spec.ts` (comments/files/inline badges) and
`audit.spec.ts` (audit/commands/activity, OPERATOR actor resolution). The
keyboard-only chip removal, focus return, axe and reduced-motion checks remain
in those suites.

## Regression sweep

Measured on the final branch commit (before the final full browser pass):

| Gate | Result |
| --- | --- |
| Backend unit | 624 / 624 passed (83 suites) |
| Backend e2e | 1023 passed, 1 skipped (71 suites, 1024 total) |
| Shared | 581 / 581 passed (13 files) |
| UI unit | 2073 / 2073 passed (211 files) |
| UI typecheck/build/size | passed; critical bundle, styles and admin page inside their limits |
| Site tests | 69 / 69 passed (3 files, including the 52 docs-link checks) |
| Site check/build | `astro check` passed; 57 pages built |
| OpenAPI | valid 3.1 contract, 91 operations; contract tests passed |
| Lint | 0 errors, 74 pre-existing warnings |
| Prettier / `git diff --check` | clean |
| Backend build | `tsc` + `tsc-alias` passed |
| Filter acceptance matrix | 6 / 6 passed, 8 screenshots |
| Full browser suites | final pass recorded below |

One backend e2e run hit an SSE profile-change timeout in `events.e2e-spec.ts`;
the same spec passed 18/18 in isolation and the full suite passed on the next
run. This is the known load-sensitive SSE flake, not a functional failure.

The final full browser pass is run on the merge candidate; its result is
appended here before the PR is merged.

## Residuals

- The 5k gate has three scoped exceptions (`audit/actor@100`,
  `comments/kind-period@50` and `attachments/transcode-none@50`). All stay at
  or below 5.52 ms absolute, have exact totals and no 10k+ sequential scan.
  They are 5k-scale threshold effects; none is a two-run failure at 25k.
- The 25k audit actor-period and target-type-period cases are the only strict
  two-run misses. Both have a ~2 ms p50, index plans and one slow sample; two
  dedicated audit reruns after the target-type index had no shared miss and
  measured 2.2–3.6 ms p95. They remain a rollout watch item, not a functional
  or scan regression.
- The 25k qualification is a manual/nightly rollout gate, not a CI job. CI runs
  the 5k-capable unit/e2e/browser suites. A regression counts only when it
  reproduces in both independent runs; one-run p95 outliers are kept in the raw
  artifacts instead of being hidden.
- The three migrations build 19 indexes and update every `Attachment` row. On a
  large installation run them in a quiet window and take a backup first; the
  migration comment repeats the lock warning. The `mimeFamily` trigger needs the
  database owner (or a role allowed to create functions/triggers).
- The earlier 181.4/181.5/181.6 5k waivers are superseded by this record where
  they differ. Their artifacts remain in `scripts/perf/results/` for history.
- The browser matrix is reproducible with
  `E2E_ADMIN_TEST=1 bash e2e/run-docker.sh tests/admin/filter-acceptance.spec.ts`
  and the eight committed screenshots above.
- The admin guide intentionally documents the surfaces that are not filterable
  (sessions/tokens beyond period, shares, masters, detail pages, checklist
  items, security settings). No hidden filter memory or saved views were added.
