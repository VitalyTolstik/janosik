# TASK-181.1 admin filter benchmark results

The 5k run measured lower warm p95 for the shipped card board and single-label
predicates at every tested page size. The 250-row smoke run exceeded the budget
for board filtering at page size 25. It had three warm samples, with a median
of 3.21 ms and a maximum of 6.71 ms. The harness returned exit code 1 and saved
the timings and plans.

The current 5k run returned exit code 0. The earlier 5k run exceeded the +20%
budget for deferred audit actor and action cases. The action count plan scanned
all 5,000 audit rows without an action index. The actor count used the existing
`AdminAuditLog_adminId_createdAt_idx`, while the page scan used the created-at
index and discarded 441 nonmatching rows at page size 50. TASK-181.6 owns
remeasurement with its shipped predicates and any index changes. The full
25k-row §7.6 qualification remains pending.

PostgreSQL 16.15 in a local container. Timings cover page plus exact count in a
single transaction at offset 0. Cold samples use a fresh connection and keep
PostgreSQL shared buffers. The budget compares warm p95 to the unfiltered case
at the same page size and checks for sequential scans of at least 10,000 rows.

With `ADMIN_FILTER_PERF_DATABASE_URL` pointing to a dedicated, migrated
PostgreSQL database, seed and run each preset in its own scratch database.

```sh
node scripts/perf/seed-admin-filters.mjs --preset small
npm run perf:admin-filters -- --preset small --output /tmp/admin-filter-small.json
node scripts/perf/seed-admin-filters.mjs --preset gate
npm run perf:admin-filters -- --preset gate --output /tmp/admin-filter-gate.json
```

The JSON includes individual samples and `EXPLAIN (ANALYZE, BUFFERS)` plans.

## Small smoke run

250 cards and 250 audit rows. One cold and three warm samples per case.

| List | Facet | Page size | Total | Cold p50 (ms) | Cold p95 (ms) | Warm p50 (ms) | Warm p95 (ms) | Warm p95 delta | Scans ≥10k rows | Budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| cards | unfiltered | 25 | 250 | 10.705 | 10.705 | 2.866 | 2.868 | +0.0% | 0 | pass |
| cards | board | 25 | 50 | 8.793 | 8.793 | 3.215 | 6.708 | +133.9% | 0 | fail |
| cards | label | 25 | 50 | 9.082 | 9.082 | 3.163 | 3.276 | +14.2% | 0 | pass |
| cards | assignee | 25 | 9 | 8.385 | 8.385 | 2.337 | 2.388 | -16.7% | 0 | pass |
| cards | priority | 25 | 72 | 8.205 | 8.205 | 2.495 | 2.511 | -12.4% | 0 | pass |
| cards | due | 25 | 41 | 8.228 | 8.228 | 2.388 | 2.608 | -9.1% | 0 | pass |
| audit | unfiltered | 25 | 250 | 5.308 | 5.308 | 1.970 | 2.007 | +0.0% | 0 | pass |
| audit | actor | 25 | 25 | 5.225 | 5.225 | 1.950 | 2.051 | +2.2% | 0 | pass |
| audit | action | 25 | 50 | 5.337 | 5.337 | 1.855 | 2.026 | +0.9% | 0 | pass |

## 5k review-fix run

5,000 cards and 5,000 audit rows. Three cold and ten warm samples per case.

| List | Facet | Page size | Total | Cold p50 (ms) | Cold p95 (ms) | Warm p50 (ms) | Warm p95 (ms) | Warm p95 delta | Scans ≥10k rows | Budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| cards | unfiltered | 25 | 5000 | 12.370 | 12.859 | 5.455 | 8.871 | +0.0% | 0 | pass |
| cards | unfiltered | 50 | 5000 | 11.290 | 11.768 | 5.224 | 6.027 | +0.0% | 0 | pass |
| cards | unfiltered | 100 | 5000 | 11.719 | 12.344 | 5.686 | 6.319 | +0.0% | 0 | pass |
| cards | board | 25 | 250 | 9.010 | 9.466 | 2.336 | 3.844 | -56.7% | 0 | pass |
| cards | board | 50 | 250 | 9.351 | 9.516 | 2.508 | 2.879 | -52.2% | 0 | pass |
| cards | board | 100 | 250 | 10.178 | 12.043 | 2.678 | 2.960 | -53.2% | 0 | pass |
| cards | label | 25 | 250 | 10.616 | 10.679 | 3.717 | 4.611 | -48.0% | 0 | pass |
| cards | label | 50 | 250 | 11.288 | 12.801 | 3.644 | 4.075 | -32.4% | 0 | pass |
| cards | label | 100 | 250 | 11.628 | 11.862 | 3.987 | 4.219 | -33.2% | 0 | pass |
| cards | assignee | 25 | 46 | 9.642 | 9.966 | 2.031 | 2.962 | -66.6% | 0 | pass |
| cards | assignee | 50 | 46 | 8.491 | 8.545 | 1.998 | 2.642 | -56.2% | 0 | pass |
| cards | assignee | 100 | 46 | 8.219 | 8.442 | 2.056 | 2.257 | -64.3% | 0 | pass |
| cards | priority | 25 | 1430 | 10.814 | 11.014 | 4.141 | 4.651 | -47.6% | 0 | pass |
| cards | priority | 50 | 1430 | 10.572 | 11.075 | 4.187 | 4.792 | -20.5% | 0 | pass |
| cards | priority | 100 | 1430 | 10.811 | 11.197 | 4.308 | 4.849 | -23.3% | 0 | pass |
| cards | due | 25 | 720 | 9.208 | 9.781 | 2.629 | 3.501 | -60.5% | 0 | pass |
| cards | due | 50 | 720 | 9.488 | 9.858 | 2.706 | 3.062 | -49.2% | 0 | pass |
| cards | due | 100 | 720 | 9.677 | 9.846 | 2.834 | 3.123 | -50.6% | 0 | pass |
| audit | unfiltered | 25 | 5000 | 5.440 | 6.846 | 2.078 | 3.042 | +0.0% | 0 | pass |
| audit | unfiltered | 50 | 5000 | 5.870 | 5.931 | 2.137 | 2.517 | +0.0% | 0 | pass |
| audit | unfiltered | 100 | 5000 | 5.683 | 6.376 | 2.348 | 2.634 | +0.0% | 0 | pass |
| audit | actor | 25 | 500 | 6.117 | 6.201 | 1.834 | 2.435 | -19.9% | 0 | pass |
| audit | actor | 50 | 500 | 5.899 | 5.964 | 2.158 | 2.424 | -3.7% | 0 | pass |
| audit | actor | 100 | 500 | 6.084 | 6.813 | 2.407 | 2.636 | +0.0% | 0 | pass |
| audit | action | 25 | 1000 | 5.663 | 5.779 | 2.165 | 2.447 | -19.6% | 0 | pass |
| audit | action | 50 | 1000 | 5.929 | 6.047 | 2.397 | 2.660 | +5.7% | 0 | pass |
| audit | action | 100 | 1000 | 7.372 | 8.134 | 2.720 | 3.034 | +15.2% | 0 | pass |

## Earlier 5k audit measurements

Recorded on the branch before the review fixes with the same gate fixture and
sampling settings.

| List | Facet | Page size | Total | Cold p50 (ms) | Cold p95 (ms) | Warm p50 (ms) | Warm p95 (ms) | Warm p95 delta | Scans ≥10k rows | Budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| audit | unfiltered | 25 | 5000 | 6.126 | 7.421 | 2.197 | 2.384 | +0.0% | 0 | pass |
| audit | unfiltered | 50 | 5000 | 6.026 | 6.253 | 2.213 | 2.421 | +0.0% | 0 | pass |
| audit | unfiltered | 100 | 5000 | 6.332 | 7.137 | 2.571 | 2.819 | +0.0% | 0 | pass |
| audit | actor | 25 | 500 | 6.195 | 7.249 | 2.213 | 3.255 | +36.5% | 0 | fail |
| audit | actor | 50 | 500 | 6.176 | 7.741 | 2.205 | 3.122 | +29.0% | 0 | fail |
| audit | actor | 100 | 500 | 7.404 | 8.312 | 2.512 | 4.102 | +45.5% | 0 | fail |
| audit | action | 25 | 1000 | 6.678 | 6.776 | 2.491 | 2.974 | +24.7% | 0 | fail |
| audit | action | 50 | 1000 | 6.827 | 6.850 | 2.619 | 3.186 | +31.6% | 0 | fail |
| audit | action | 100 | 1000 | 6.640 | 8.297 | 2.659 | 2.929 | +3.9% | 0 | pass |
