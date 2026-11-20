# TASK-181.4 moderation filter benchmark

The 5k gate did **not** pass on PostgreSQL 16.15. Of 66 filtered cases, 38 met
both thresholds. All 21 comment cases scanned 10,000 rows. Eight cases exceeded
the +20% warm p95 budget, including one of those comment cases. The highest
filtered warm p95 was 6.558 ms for comments and 7.721 ms for attachments.

[Raw samples, SQL and EXPLAIN (ANALYZE, BUFFERS) plans](../scripts/perf/results/task-181.4-moderation-gate.json.gz)

## Method

The migrated gate fixture has 5,000 cards, 10,000 comments and 2,000
attachments. The harness measures the SQL page and exact count in one
transaction at offset 0 and sizes 25, 50 and 100. The page joins display
relations after the limit, mirroring the application's page-first relation
loading. The timings cover SQL and the local database round trip. Each case
has three fresh-connection samples with shared PostgreSQL buffers and ten warm
samples. The artifact includes all samples, cold and warm p50/p95, the exact
totals and both plans for all 72 cases, including six baselines.

The 24-hour predicate includes its lower bound. Combined cases also include
the upper bound and match three comments or four attachments. Comment kinds
cover both one kind and the blocker-or-question combination. Attachments cover
all five MIME families and all four transcode states. Each delta uses the
unfiltered list at the same page size. The harness flags a warm p95 increase
above 20% or a filtered sequential scan examining at least 10,000 rows.

```bash
# Set ADMIN_FILTER_PERF_DATABASE_URL to a fresh, dedicated, migrated database.
node scripts/perf/seed-admin-filters.mjs --preset gate
npm run perf:admin-filters -- --preset gate --moderation --output timings.json
```

## Comments

| Facet | Exact total | 25 warm p95 ms (delta) | 50 warm p95 ms (delta) | 100 warm p95 ms (delta) |
| --- | ---: | ---: | ---: | ---: |
| Unfiltered | 10000 | 7.482 | 4.454 | 5.669 |
| Period | 961 | 5.839 (−22.0%) | 5.814 (+30.5%) | 6.558 (+15.7%) |
| Author | 100 | 3.439 (−54.0%) | 4.032 (−9.5%) | 4.294 (−24.2%) |
| Blocker | 1667 | 4.213 (−43.7%) | 4.031 (−9.5%) | 4.534 (−20.0%) |
| Blocker or question | 3334 | 4.678 (−37.5%) | 4.899 (+10.0%) | 5.798 (+2.3%) |
| Author + period | 9 | 3.780 (−49.5%) | 3.567 (−19.9%) | 3.313 (−41.6%) |
| Kinds + period | 320 | 4.616 (−38.3%) | 4.713 (+5.8%) | 4.841 (−14.6%) |
| Author + kinds + bounded period | 3 | 4.078 (−45.5%) | 2.908 (−34.7%) | 2.856 (−49.6%) |

## Attachments

| Facet | Exact total | 25 warm p95 ms (delta) | 50 warm p95 ms (delta) | 100 warm p95 ms (delta) |
| --- | ---: | ---: | ---: | ---: |
| Unfiltered | 2000 | 3.743 | 3.349 | 4.706 |
| Period | 961 | 4.090 (+9.3%) | 3.265 (−2.5%) | 4.174 (−11.3%) |
| Uploader | 20 | 2.984 (−20.3%) | 2.237 (−33.2%) | 2.410 (−48.8%) |
| Images | 334 | 4.065 (+8.6%) | 4.603 (+37.4%) | 3.829 (−18.6%) |
| Videos | 333 | 4.404 (+17.7%) | 3.834 (+14.5%) | 3.730 (−20.7%) |
| PDF | 334 | 4.382 (+17.1%) | 3.929 (+17.3%) | 3.696 (−21.5%) |
| Documents | 333 | 5.636 (+50.6%) | 5.260 (+57.1%) | 5.390 (+14.5%) |
| Other | 666 | 7.667 (+104.8%) | 7.721 (+130.5%) | 7.571 (+60.9%) |
| Pending | 66 | 2.878 (−23.1%) | 2.686 (−19.8%) | 2.823 (−40.0%) |
| Failed | 66 | 2.800 (−25.2%) | 2.459 (−26.6%) | 2.521 (−46.4%) |
| Done | 134 | 2.850 (−23.9%) | 2.510 (−25.0%) | 3.739 (−20.6%) |
| No transcoding | 1734 | 3.479 (−7.0%) | 3.372 (+0.7%) | 4.217 (−10.4%) |
| Uploader + period | 10 | 3.004 (−19.7%) | 2.240 (−33.1%) | 2.184 (−53.6%) |
| Documents + period | 160 | 4.299 (+14.9%) | 4.165 (+24.4%) | 4.399 (−6.5%) |
| Pending + period | 32 | 3.001 (−19.8%) | 2.512 (−25.0%) | 2.419 (−48.6%) |
| Uploader + video + pending + bounded period | 4 | 2.813 (−24.8%) | 2.225 (−33.6%) | 2.095 (−55.5%) |

## Index decision

The gate fixture puts the comment relation exactly at the scan cutoff. Both
plans for every filtered case scanned all 10,000 comments. At page size 50,
the period plan took 1.466 ms for the page and 0.466 ms for the exact count.
Author and kind met the latency budget at every size. Author equality is
selective (1% of rows), whereas two kinds match a third of the relation and
period-only has no equality prefix. Keep the existing schema for this wave
given the measured SQL costs. The 25k rollout qualification should compare
`Comment(authorId, createdAt)` for author, `Comment(kind, createdAt)` for kind,
and a date-leading index for period-only against the page and exact count.

The attachment misses are in the MIME predicates. The plans examine 2,000
attachments, with up to 1.655 ms for the count among the misses. Documents
combines several case-insensitive branches and Other negates the union of the
named families. A plain index on the stored MIME value or a board-leading
index would leave the measured unscoped complement without a usable range.
The small scan and sub-8 ms warm p95 leave a MIME expression or classification
index for evaluation at rollout scale. Uploader, transcode and their period
combinations met the gate, so this wave adds no index migration.
