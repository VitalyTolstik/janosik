# TASK-181.5 content filter benchmark

On PostgreSQL 16.15, **62 of 63 filtered cases met both 5k thresholds**. The
checklist Board filter at 25 rows reached **4.702 ms warm p95 (+34.0%)** against
3.509 ms unfiltered. The highest filtered warm p95 was 5.024 ms. No filtered
page or count plan hit the sequential scan cutoff.

[Raw samples, parameterized SQL and EXPLAIN (ANALYZE, BUFFERS) plans](../scripts/perf/results/task-181.5-content-gate.json.gz)

## Method

The migrated gate fixture has 5,000 cards, 100 users, 20 boards, 60 board
memberships, 100 columns, 40 labels, 5,000 checklists with 15,000 items, and
2,000 card links. User creation dates are spaced 12 hours apart. The period
predicates use the same inclusive lower bounds as the Users tabs.
The board membership case selects the second accepted ADMIN on board zero.
The card-link case selects a card with an incoming and an outgoing link.

The harness times a SQL page and exact count in one transaction at offset
zero and page sizes 25, 50 and 100. It approximates Prisma's separate
relation queries with page-scoped display joins and includes the grouped card
counts before pagination for Columns and Labels. It aggregates checklist
item counts in SQL. The timings cover SQL and the local database round trip.
Each case has three fresh-connection samples with shared buffers intact
and ten warm samples. The artifact includes both plans, exact totals and
cold and warm p50/p95 for all 81 cases, including 18 baselines.

Each delta compares with the unfiltered list at the same page size. A
filtered case fails above +20% warm p95 or when any sequential scan node in
either plan examines at least 10,000 rows, including rows rejected by the
filter, across all loops.

```bash
# Set ADMIN_FILTER_PERF_DATABASE_URL to a fresh, dedicated, migrated database.
node scripts/perf/seed-admin-filters.mjs --preset gate
npm run perf:admin-filters -- --preset gate --content --output timings.json
```

## Warm p95 in milliseconds

| List / facet | Exact total | 25 rows (delta) | 50 rows (delta) | 100 rows (delta) |
| --- | ---: | ---: | ---: | ---: |
| Users / Unfiltered | 100 | 2.229 | 2.174 | 2.018 |
| Users / Verified | 80 | 1.771 (−20.5%) | 1.884 (−13.4%) | 2.023 (+0.3%) |
| Users / Unverified | 20 | 1.935 (−13.2%) | 1.869 (−14.0%) | 2.058 (+2.0%) |
| Users / 24h | 3 | 2.238 (+0.4%) | 1.945 (−10.6%) | 1.991 (−1.4%) |
| Users / 7d | 15 | 2.105 (−5.6%) | 2.113 (−2.8%) | 1.951 (−3.3%) |
| Users / 30d | 61 | 1.862 (−16.4%) | 2.338 (+7.5%) | 2.194 (+8.7%) |
| Users / Verified + 30d | 48 | 1.880 (−15.6%) | 2.057 (−5.4%) | 1.994 (−1.2%) |
| Users / Unverified + 7d | 3 | 1.798 (−19.3%) | 1.876 (−13.7%) | 2.139 (+6.0%) |
| Boards / Unfiltered | 20 | 3.070 | 2.310 | 2.555 |
| Boards / Admin member | 1 | 2.603 (−15.2%) | 2.104 (−8.9%) | 2.030 (−20.5%) |
| Columns / Unfiltered | 100 | 3.762 | 3.281 | 3.324 |
| Columns / Board | 5 | 3.188 (−15.3%) | 2.930 (−10.7%) | 3.620 (+8.9%) |
| Labels / Unfiltered | 40 | 5.389 | 4.310 | 5.260 |
| Labels / Board | 2 | 5.024 (−6.8%) | 4.439 (+3.0%) | 4.470 (−15.0%) |
| Checklists / Unfiltered | 5000 | 3.509 | 3.429 | 4.685 |
| Checklists / Board | 250 | **4.702 (+34.0%)** | 3.951 (+15.2%) | 4.653 (−0.7%) |
| Checklists / Card | 1 | 2.643 (−24.7%) | 1.958 (−42.9%) | 2.137 (−54.4%) |
| Checklists / Board + card | 1 | 3.220 (−8.2%) | 2.077 (−39.4%) | 2.096 (−55.3%) |
| Card links / Unfiltered | 2000 | 3.170 | 2.762 | 3.854 |
| Card links / Blocks | 667 | 3.158 (−0.4%) | 2.993 (+8.4%) | 4.109 (+6.6%) |
| Card links / Relates to | 667 | 3.302 (+4.2%) | 3.003 (+8.7%) | 3.956 (+2.7%) |
| Card links / Duplicates | 666 | 3.391 (+7.0%) | 2.958 (+7.1%) | 3.700 (−4.0%) |
| Card links / Blocks or relates to | 1334 | 2.957 (−6.7%) | 3.023 (+9.5%) | 3.913 (+1.5%) |
| Card links / Card | 2 | 2.700 (−14.8%) | 2.044 (−26.0%) | 1.904 (−50.6%) |
| Card links / Board | 100 | 2.754 (−13.1%) | 2.479 (−10.2%) | 3.361 (−12.8%) |
| Card links / Type + board | 67 | 2.806 (−11.5%) | 2.601 (−5.8%) | 2.557 (−33.7%) |
| Card links / Type + board + card | 1 | 2.582 (−18.5%) | 2.352 (−14.8%) | 2.280 (−40.8%) |

## Query plans and index decision

At page size 25, the checklist Board page took 0.536 ms and the count
took 1.152 ms in EXPLAIN, compared with 0.275 ms and 0.331 ms unfiltered.
The exact count scanned 5,000 cards to find the 250 in the board's columns,
then used the existing `Checklist(cardId, position)` index. The page used
the same checklist index and reached the board through the card's column.
The filtered Labels page examined 6,000 label links and 5,000 cards for the
grouped card counts, including groups outside the selected board.
Both paths warrant checking at 25k. Index and query changes should be driven
by those plans.

## Pre-rollout exception

**Recorded 2026-11-20 for TASK-181.5.** The 5k checklist Board latency miss
is accepted for integration before rollout given its 4.702 ms absolute warm
p95, exact total, and scan size below the cutoff. TASK-181.5 carries no index
migration. Passing the +20% warm p95 and sequential scan thresholds at 25k
for the shipped content facets is a hard rollout gate under TASK-181.7.
Run the same harness against a freshly seeded, dedicated `--preset full`
database and record the page and count plans before rollout.
