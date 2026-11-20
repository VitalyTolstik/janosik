# TASK-181.3 cards filter benchmark

All 48 cases passed the 5,000-card gate on PostgreSQL 16.15. Filtered warm
p95 ranged from 2.6% to 70.3% below the unfiltered baseline at the same page
size. The largest sequential scan examined 5,000 rows. An earlier run
overlapped the Docker build and UI suite and exceeded the budget in 19 cases.
The recorded gate run used the same database and ran with those jobs idle.

The benchmark measures the SQL page projection and exact count at offset 0
in one transaction, at page sizes 25, 50 and 100. Each case records three
fresh-connection and ten warm samples. Fresh connections share PostgreSQL
buffers. The benchmark covers the cards predicates at the SQL boundary.
The 25,000-card qualification belongs to rollout.

The exact counts used `Card_assigneeId_idx`, `Card_dueDate_idx` and
`CardLabel_labelId_idx` where applicable. The combined case used a bitmap
intersection of the assignee and due indexes. The priority, period and
attachment counts sequentially scanned the 5,000-card relation. The gate
measurements justified keeping the existing indexes.

[Raw timings and EXPLAIN (ANALYZE, BUFFERS) plans](../scripts/perf/results/task-181.3-cards-gate.json.gz)

```bash
# Point ADMIN_FILTER_PERF_DATABASE_URL at a dedicated, migrated PostgreSQL database.
node scripts/perf/seed-admin-filters.mjs --preset gate
npm run perf:admin-filters -- --preset gate --cards --output timings.json
```

## Results for page size 50

| Facet | Exact total | Cold p50 (ms) | Cold p95 (ms) | Warm p50 (ms) | Warm p95 (ms) | Warm p95 delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| unfiltered | 5000 | 11.117 | 11.209 | 4.884 | 5.372 | +0.0% |
| board | 250 | 9.584 | 10.393 | 2.458 | 2.917 | -45.7% |
| label | 183 | 11.334 | 11.570 | 3.027 | 3.112 | -42.1% |
| assignee | 46 | 7.421 | 7.771 | 2.226 | 2.762 | -48.6% |
| priority | 1430 | 10.064 | 11.442 | 3.858 | 4.150 | -22.7% |
| due | 750 | 8.606 | 8.823 | 2.513 | 2.691 | -49.9% |
| labels-any | 250 | 11.652 | 12.250 | 3.480 | 3.753 | -30.1% |
| labels-all | 50 | 11.817 | 12.116 | 2.671 | 2.871 | -46.6% |
| assignee-or-unassigned | 546 | 9.390 | 9.961 | 2.907 | 3.602 | -33.0% |
| unassigned | 454 | 8.373 | 9.388 | 2.352 | 2.538 | -52.8% |
| overdue | 2160 | 9.819 | 11.249 | 3.224 | 3.691 | -31.3% |
| no-due-date | 715 | 8.403 | 8.854 | 2.343 | 2.722 | -49.3% |
| period | 961 | 8.718 | 9.451 | 3.389 | 3.724 | -30.7% |
| attachments | 1000 | 9.679 | 9.732 | 3.306 | 3.964 | -26.2% |
| no-attachments | 4000 | 9.531 | 11.331 | 4.866 | 5.231 | -2.6% |
| combined | 58 | 8.098 | 9.721 | 2.352 | 2.548 | -52.6% |
