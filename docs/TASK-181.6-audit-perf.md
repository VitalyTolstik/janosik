# TASK-181.6 Audit hub benchmark

On PostgreSQL 16.15, applying the five measured indexes cut the work of the
Audit Action, Command Actor/Action, and Activity Actor/Event exact counts.
After the migration, 81 of 87 filtered cases met both 5k thresholds. The
remaining six are listed below. No filtered page or count plan examined
10,000 or more rows in a sequential scan.

Raw SQL, exact totals, samples, and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
for every page and count are in the
[before-migration run](../scripts/perf/results/task-181.6-audit-gate-before.json.gz)
and [after-migration run](../scripts/perf/results/task-181.6-audit-gate-after.json.gz).

## Method

The shared 5k gate fixture has 5,000 cards, 5,000 audit rows, 2,000 commands,
2,000 activity rows, 10 masters, and 100 users. Event timestamps are spaced
90 seconds apart. The period cases use the inclusive 24-hour lower bound.
The combined Audit case selects master, action, target type and target ID.
Commands combine actor, type, board, and both card and column touches.
Activity combines actor, type, board and card.

The benchmark runs the shipped predicates, ordering, page and exact count in
one transaction. Display joins for Commands and Activity are scoped to the
page to approximate Prisma's relation queries. The timings cover these
queries and the local database round trip. HTTP, audit target existence
checks, and command-to-audit correlation are outside that measurement. Each
case has three fresh-connection samples with shared buffers intact and ten
warm samples at offset zero with page sizes 25, 50 and 100. The fixture is the
same for both runs, with `ANALYZE` after seeding and after the migration.

A filtered case fails above +20% warm p95 versus its unfiltered list at the
same page size, or when a sequential scan in either plan examines at least
10,000 rows across all loops, including rows rejected by the filter.

```bash
# Set DATABASE_URL and ADMIN_FILTER_PERF_DATABASE_URL to the same scratch DB.
# Deploy migrations through 20261119160000_task_180_7_snapshot_content first.
node scripts/perf/seed-admin-filters.mjs --preset gate
npm run perf:admin-filters -- --preset gate --audit --output before.json
npm run prisma:deploy -w backend
# Run ANALYZE in the scratch DB.
npm run perf:admin-filters -- --preset gate --audit --output after.json
```

## Index decisions

EXPLAIN execution times in milliseconds for the count at page size 100.
Each new count plan below uses an index-only scan. Without an index on the
filtered value, the counts without a period scanned the full event table.

| New index                          | Count without period, before → after | Count with period, before → after |
| ---------------------------------- | -----------------------------------: | --------------------------------: |
| `AdminAuditLog(action, createdAt)` |                        0.356 → 0.109 |                     0.154 → 0.046 |
| `Command(actorId, createdAt)`      |                        0.087 → 0.056 |                     0.131 → 0.054 |
| `Command(type, createdAt)`         |                        0.199 → 0.155 |                     0.132 → 0.075 |
| `Activity(actorId, createdAt)`     |                        0.094 → 0.039 |                     0.106 → 0.044 |
| `Activity(type, createdAt)`        |                        0.122 → 0.074 |                     0.141 → 0.055 |

The Command and Activity actor pages with period switched from date scans
rejecting 951 of 961 rows to bitmap scans on the actor-and-date indexes.
The audit actor count already uses `AdminAuditLog(adminId, createdAt)`.
The exact target pair and combined audit cases use the existing target
index. The standalone target ID plus 24-hour case uses the date index
and rejects 960 rows. It stayed within the budget. Command card and column
touches use the existing GIN index when queried together on their own.

For broad type filters the page planner can prefer scanning in date order.
In the 100-row Activity Event case, the page visited 401 activity rows to
find 101 candidates for the ordered page. The index improved the exact count
and the overall warm p95 still missed the budget. The five added indexes
occupied 656 KiB in total on the 5k fixture. The migration builds them using
standard PostgreSQL index creation, which can block writes to the affected
tables while each index builds. Schedule the migration in a quiet window
on larger installations. It has no data backfill.

## Warm p95 in milliseconds

Each cell reports page sizes 25, 50 and 100 in that order. The raw artifacts
also contain cold and warm p50, cold p95, and each case's delta.

| List / facet               | Exact total |      Before 25 / 50 / 100 |       After 25 / 50 / 100 |
| -------------------------- | ----------: | ------------------------: | ------------------------: |
| audit / unfiltered         |        5000 |     2.324 / 2.250 / 2.761 |     2.334 / 2.386 / 2.569 |
| audit / period             |         961 |     2.098 / 2.431 / 2.476 |     2.386 / 2.658 / 2.565 |
| audit / actor              |         500 |     2.188 / 2.316 / 2.556 |     2.766 / 2.724 / 2.651 |
| audit / actor-period       |          97 |     2.192 / 2.214 / 2.540 |     2.282 / 2.455 / 2.568 |
| audit / action             |        1000 |     2.065 / 2.361 / 2.580 |     2.046 / 2.591 / 2.544 |
| audit / action-period      |         193 |     2.343 / 2.529 / 2.615 |     2.192 / 2.445 / 2.454 |
| audit / target-type        |        1000 |     2.020 / 2.320 / 2.387 |     2.113 / 2.319 / 2.413 |
| audit / target-type-period |         193 |     2.191 / 2.262 / 2.537 |     2.420 / 2.235 / 2.639 |
| audit / target-id          |           1 |     1.985 / 2.002 / 2.015 |     1.911 / 1.972 / 2.080 |
| audit / target-id-period   |           1 |     2.305 / 2.250 / 2.428 |     2.262 / 2.201 / 2.385 |
| audit / target             |           1 |     2.028 / 1.953 / 1.814 |     1.997 / 1.988 / 1.880 |
| audit / target-period      |           1 |     1.746 / 1.792 / 1.998 |     1.990 / 1.979 / 1.874 |
| audit / combined           |           1 |     1.893 / 1.872 / 2.128 |     2.453 / 1.893 / 1.825 |
| audit / combined-period    |           1 | **4.776** / 1.670 / 1.807 | **5.090** / 1.886 / 1.838 |
| commands / unfiltered      |        2000 |     3.310 / 2.738 / 3.865 |     2.647 / 2.789 / 3.848 |
| commands / period          |         961 |     2.386 / 2.311 / 2.586 | **3.187** / 2.351 / 2.681 |
| commands / actor           |          20 |     2.704 / 2.227 / 2.376 |     2.446 / 2.026 / 2.209 |
| commands / actor-period    |          10 |     2.448 / 2.253 / 2.290 |     2.530 / 2.027 / 2.300 |
| commands / type            |         667 |     2.533 / 2.349 / 2.964 |     2.534 / 2.334 / 2.677 |
| commands / type-period     |         321 |     2.378 / 2.743 / 2.649 |     2.477 / 2.488 / 2.611 |
| commands / touches         |           1 |     2.388 / 2.880 / 2.330 |     2.614 / 2.450 / 2.445 |
| commands / touches-period  |           1 |     2.749 / 2.450 / 2.251 |     2.621 / 2.308 / 2.243 |
| commands / combined        |           1 |     2.349 / 2.247 / 2.038 | 2.513 / **5.088** / 2.125 |
| commands / combined-period |           1 |     2.320 / 2.294 / 2.050 |     2.652 / 1.975 / 2.239 |
| activity / unfiltered      |        2000 |     2.729 / 4.438 / 3.681 |     3.122 / 2.696 / 4.109 |
| activity / period          |         961 |     3.160 / 2.821 / 3.830 | 3.114 / **3.899** / 3.393 |
| activity / actor           |          20 |     2.636 / 2.831 / 2.448 |     2.571 / 2.108 / 1.896 |
| activity / actor-period    |          10 |     2.928 / 2.248 / 2.375 |     2.391 / 2.083 / 2.058 |
| activity / type            |         500 | 2.794 / 2.852 / **6.191** | 2.792 / 3.018 / **7.164** |
| activity / type-period     |         241 |     2.588 / 2.545 / 2.784 |     2.729 / 2.394 / 2.674 |
| activity / combined        |           1 |     2.587 / 1.990 / 2.212 |     2.379 / 2.001 / 1.829 |
| activity / combined-period |           1 |     2.438 / 2.205 / 2.008 | 2.551 / 2.109 / **6.212** |

## Pre-rollout exception

**Recorded 2026-11-20 for TASK-181.6.** Six after-migration cases exceeded
the relative p95 budget. Their exact totals and scan limits held. The highest
warm p95 was 7.164 ms. Page and count EXPLAIN execution together stayed below
1.3 ms for these cases, while several of the warm misses came from a single
round trip in the ten-sample window.

| List / facet                 | Page size |   Warm p95 (delta) |
| ---------------------------- | --------: | -----------------: |
| Audit / Combined + period    |        25 | 5.090 ms (+118.1%) |
| Commands / Period            |        25 |  3.187 ms (+20.4%) |
| Commands / Combined          |        50 |  5.088 ms (+82.4%) |
| Activity / Period            |        50 |  3.899 ms (+44.7%) |
| Activity / Event             |       100 |  7.164 ms (+74.3%) |
| Activity / Combined + period |       100 |  6.212 ms (+51.2%) |

These results permit integration. **Passing both thresholds at 25k is a hard
rollout gate for the Audit hub.** Seed a fresh dedicated database with
`--preset full`, run `npm run perf:admin-filters -- --preset full --audit`
with the shipping migration, and record page and count plans before rollout.
