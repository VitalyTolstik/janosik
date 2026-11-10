# Making a 25,000-card Janosik board feel instant

**Status:** investigation and proposal. No product code changes.
**Date:** 2026-11-10.
**Reference:** [mcmaster.com](https://www.mcmaster.com/), measured from Amsterdam, NL.
**Companion:** `docs/PERF-25K-INVESTIGATION.md` covers the backend/data
architecture (command path, aggregate loading, storage, keyset/read-model
design, cache architecture). It may land in a separate branch/worktree; this
document is written to stand alone. It deliberately does **not** repeat that
analysis. It looks at perceived performance: what the user sees, when they see
it, and what it costs to get there. Where this document needs a 25k capacity
number, it quotes the companion as the single source of truth.
**Relationship:** the companion owns `aggregateRevision`, the canonical ETag
key, and snapshot merge; this document consumes those contracts.

The target is a 25,000-card board that opens and reacts like a much smaller
one: a board-shaped first paint on a warm visit, useful columns in about a
second, filtering that feels local, and no scroll or typing jank. McMaster-Carr
is the reference because it is an ultra-fast, server-heavy catalog with a very
small interaction budget. It is not a Kanban board, so the interesting question
is which of its techniques survive contact with an authenticated, real-time,
offline-capable editor.

---

## 1. Executive summary

McMaster-Carr is fast for a specific reason: it paints a small **HTML shell**
with inline critical CSS before its large JavaScript bundle runs, then fills
the catalog from cacheable server-rendered fragments. It is not a fully
server-rendered content site, and it is not a small-JavaScript site. It is a
**shell-first, deferred-JS, cache-everything** site.

Measured on 2026-11-10 from Amsterdam:

- Homepage cold: TTFB 269 ms, FCP/LCP 376 ms, load 763 ms, 1.87 MB, 98 requests.
- Homepage warm: TTFB 37 ms, FCP/LCP 92 ms, 31 KB transferred.
- Category cold: TTFB 348 ms, FCP 456 ms, load 1.38 s, 2.85 MB, 343 requests;
  first product count at 1.15 s.
- Category warm: TTFB 170 ms, FCP 212 ms, LCP 232 ms, 126 KB transferred;
  first product count at 510 ms.
- Search result page cold: FCP 392 ms, first product count at 1.02 s.
- Search result page warm: FCP 204 ms, first product count at 445 ms.
- Filtered category warm: FCP 216 ms, first product count at 458 ms.

Run-to-run ranges are wide enough that the document reports ranges rather than
single decimals: category first content 1.02-1.15 s cold / 0.45-0.51 s warm;
search 1.02-1.55 s cold; warm ~0.45 s (the 0.62-0.63 s runs failed the final
grid check and are excluded). One cold filtered run was an outlier at 4.17 s
and is excluded from the table.

Janosik's current full-aggregate path does not scale to 25,000 cards. At 10,000
cards the measured aggregate is 6.75 MiB (7.08 MB decimal), `GET` p50 is
263 ms, first board render
is 906 ms, the JS heap is 95 MiB, and ten concurrent opens take the API to
1,479 MiB RSS. The companion's 25k estimate is **17.7 MB, GET ~640 ms, UI ~1.7 s,
heap 150-200 MiB, ~3.3 GiB for ten concurrent opens**. Those numbers are the
data/write architecture fit; this document only derives UX consequences from
them.

What transfers from McMaster:

1. **A board-shaped first paint.** A static, cacheable shell plus critical CSS;
   show a board skeleton on board routes without blocking on auth or data.
2. **Shell first, data second.** Keep the initial HTML small; defer the
   application bundle; bootstrap only a summary and the visible card windows.
3. **Immutable static assets plus a safe navigation cache.** Hashed assets are
   already immutable in Janosik; the service worker should cache only a known
   static shell, never a personalized navigation response.
4. **Conditional GET and explicit validators.** Private board JSON is
   `private, no-store`; static assets are immutable; summary/pages get a weak
   revision/query/scope ETag and the client actually sends `If-None-Match`.
5. **Prefetch on intent.** Hovering a board, typing a search, or opening a
   filter is enough notice to fetch the next small payload.
6. **Server-side search/filter with URL state and bounded summaries.** The
   result set should not require shipping all 25,000 cards to the browser.
7. **Small DOM, no long tasks.** Janosik already virtualizes; the next step is
   to stop holding all 25,000 card objects in memory.

What does **not** transfer:

- Full SSR of the interactive board. Auth, SSE, drag-and-drop, undo, and
  offline editing make full-board SSR the wrong tool.
- A CDN as a default. Janosik is self-hosted. Compression, HTTP/2, and a
  reverse proxy must work on a single box; CDN/HTTP/3 is optional P2.
- Catalog-style full page reloads for every filter. A Kanban board must keep
  SSE, in-flight commands, scroll position, and optimistic state alive.
- One megabyte of JavaScript and hundreds of image requests. Janosik's existing
  300 KB gzip critical-path budget is the right direction.
- Immutable caching of private board JSON, or `private, max-age=...` as a
  substitute for `no-store`. `private` only excludes shared caches; it does not
  protect the next user of the same browser profile.
- A personalized SSR-lite HTML response cached by the service worker. That
  would replay one account's board to the next navigation.

The recommended order is two-stage:

1. **P0a quick wins (1-2 weeks: transport days + companion P0.1
   `aggregateRevision` plumbing ~1 week):** compression, static shell with a
   route-revealed board skeleton, safe SWR of the static shell and assets only,
   prefetch, and instrumentation. Compression/static shell can ship first;
   content ETags/caching must wait for revision plumbing. This does not fix 25k
   memory.
2. **P0b read model v1 (M/L, 4-6 weeks):** summary plus bounded first pages,
   keyset SQL, no `loadBoardAggregate` wrapper. This is the change that makes
   25k fit: initial view under 2 MB, board under 1.5 s, ten opens under 1.5 GiB,
   heap under 200 MiB.

SSR-lite is a **P1 option**, not a P0 default. P1 also adds cursor pagination,
on-demand card detail, server filter/search, and a read-only offline cache.
Multi-node/edge scale is TASK-175 (XL, out of scope here).

---

## 2. Part A - McMaster-Carr, measured

### 2.1 Method and caveats

| Item               | Value                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Measurement window | 2026-11-10, 10:22-11:30 UTC (homepage 10:22-10:30; final category/search/filter 11:29)             |
| Client location    | Amsterdam, NL; public IP 5.253.67.156 (AS200566)                                                   |
| Host               | WSL2 Ubuntu 24.04.5 on Windows 11; kernel 6.18.58.1-microsoft-standard-WSL2; 16 vCPU; 23.5 GiB RAM |
| Network path       | Akamai edge 95.101.57.52 (`e11663.b.akamaiedge.net`), HTTP/2, TLS                                  |
| Browser            | Chromium 156.0.8078.4 via Playwright 1.64.1, headless, 1600x900                                    |
| User agent         | Desktop Chrome 131 on Windows 10 x64                                                               |
| Pages              | Homepage; `/products/screws/`; `/products/hex-bolts/`; `system-of-measurement~inch/`               |
| Cold               | Fresh browser context, empty HTTP cache, no service worker                                         |
| Warm               | Same context, full reload after the cold run settles; HTTP cache and active service worker warm    |
| Repetitions        | One saved run per table row; targeted follow-ups used only for ranges                              |
| Load volume        | Roughly twenty page loads and one screenshot; no scraping or load generation                       |

Timing data comes from the Navigation Timing and Paint Timing APIs. LCP, CLS,
and long tasks come from `PerformanceObserver` instances injected before the
document started. Transfer bytes come from the Chrome DevTools Protocol
(`Network.loadingFinished.encodedDataLength`), not Resource Timing:
cross-origin entries hide `transferSize` without `Timing-Allow-Origin`. Request
counts also come from CDP. DOM node count is
`document.getElementsByTagName("*").length`.

The table rows are single runs, not composites. Homepage rows come from
`measurements.json`; category, search, and filtered rows come from
`final-measurements.json` (see the appendix). The "first product" mark is the
first populated product-count element, a proxy for grid data readiness, not a
pixel paint mark. LCP on the homepage/category is the bottom navigation
container, not the product grid, so LCP understates when the catalog is usable.

Caveats:

- The CDN edge is close (Amsterdam) and the connection was unthrottled. These
  are best-case European desktop numbers, not a global median.
- Run-to-run variance is real. Category first content ranged 1.02-1.15 s cold
  and 0.45-0.51 s warm; search 1.02-1.55 s cold and ~0.45 s warm (the 0.62-0.63
  s runs failed the final grid check and are excluded). One cold filtered run
  took 4.17 s to first content and is excluded from the table.
- A couple of direct filter/search loads returned the JavaScript shell without
  populating the grid in headless; those runs were excluded. The shell timings
  are stable; first-content timings are directional.
- Six to nineteen requests failed or were canceled in each run, almost all
  tracking beacons. They are not user-facing.
- The WSL2 client adds minor NAT overhead. It does not change the cold/warm
  comparison.

Headless Chromium was not blocked. The rendered category page contained 122
product families, 489 images, 122 client-added `srcset` attributes, and the full
filter sidebar; a screenshot confirmed the real catalog.

### 2.2 Timing

| Page / mode             |   TTFB |    FCP |    LCP |    DCL |     Load | First product | Longest task / TBT |    CLS |   DOM |
| ----------------------- | -----: | -----: | -----: | -----: | -------: | ------------: | -----------------: | -----: | ----: |
| Homepage, cold          | 269 ms | 376 ms | 376 ms | 298 ms |   763 ms |             - |        123 / 73 ms |  0.031 |   403 |
| Homepage, warm          |  37 ms |  92 ms |  92 ms |  61 ms |   310 ms |             - |           0 / 0 ms |  0.030 |   403 |
| Category, cold          | 348 ms | 456 ms | 456 ms | 405 ms | 1,380 ms |      1,147 ms |        127 / 84 ms | 0.0001 | 5,490 |
| Category, warm          | 170 ms | 212 ms | 232 ms | 213 ms |   515 ms |        510 ms |         62 / 15 ms |      0 | 5,490 |
| Search, cold            | 269 ms | 392 ms | 392 ms | 327 ms | 1,255 ms |      1,020 ms |       156 / 227 ms |      0 | 4,093 |
| Search, warm            | 159 ms | 204 ms | 224 ms | 201 ms |   522 ms |        445 ms |       145 / 182 ms |      0 | 4,093 |
| Filtered category, warm | 161 ms | 216 ms | 216 ms | 204 ms |   279 ms |        458 ms |          56 / 6 ms |      0 | 5,017 |

Notes:

- The shell paints at 376-456 ms cold and 92-216 ms warm. Product data arrives
  later: the warm data gap is 0.24-0.30 s; the cold category/search gap is
  0.6-0.7 s.
- Warm homepage TTFB of 37 ms is the service worker serving the cached shell.
  Warm category TTFB of 170 ms is a **full re-fetch** of the HTML document, not
  a conditional revalidation: the response has no ETag or Last-Modified.
- Long tasks are modest (cold 123-156 ms; warm 0-145 ms, category/search). There
  is no main-thread cliff, but the search cold run accumulated 227 ms TBT.

### 2.3 Payload, protocol, and caching

| Page / mode             | Transfer | Requests |      JS |    CSS |  Images | Notes                                                                                                   |
| ----------------------- | -------: | -------: | ------: | -----: | ------: | ------------------------------------------------------------------------------------------------------- |
| Homepage, cold          |  1.87 MB |       98 | 1.09 MB | 168 KB |  374 KB | HTML `no-cache`; ~60 assets 1 year immutable; SW registered, not controlling                            |
| Homepage, warm          |    31 KB |       94 |       0 |      0 |  1.4 KB | 63 disk-cache hits; 1 service-worker hit; shell from SW                                                 |
| Category, cold          |  2.85 MB |      343 | 1.05 MB | 115 KB | 1.06 MB | HTML `no-cache`; 305 image responses (a count, not HTTP 304), cached immutable; no SW on direct landing |
| Category, warm          |   126 KB |      339 |       0 |      0 |   881 B | 80 disk-cache hits; HTML re-fetched (31 KB); no 304                                                     |
| Search, cold            |  3.93 MB |      241 | 1.05 MB | 115 KB |  856 KB | More data fragments than the category page                                                              |
| Search, warm            |  88.6 KB |      237 |       0 |      0 |   976 B | HTML + data re-fetched; no validator                                                                    |
| Filtered category, warm |   117 KB |      317 |       0 |      0 |   714 B | HTML + data re-fetched; no validator                                                                    |

All page/content requests observed were HTTP/2; no `Alt-Svc` and no HTTP/3 in
this path. Brotli was used for HTML/JS/CSS, gzip for many SVG fragments, and no
compression for PNG/WOFF2. "JS" includes a 26 KB tracking schema bundle.

Cache headers observed:

- HTML document: `cache-control: no-cache`, `content-encoding: br`, no ETag, no
  Last-Modified. Every visit re-fetches the document.
- Hashed scripts, styles, fonts, and images: immutable for a year
  (`max-age=31536000, immutable`; some variants use spaces or
  `no-transform`). This is why warm visits are cheap.
- Server-rendered catalog fragments under `/Navigate/...`:
  `public, max-age=31536000, immutable`. These are **versioned, immutable
  fragments**.
- Tracking: `no-store` / `no-cache, no-store`.

### 2.4 Search and filter: how fast the interaction feels

| Interaction              | Result                                              |                               Time | Notes                                                                                                                |
| ------------------------ | --------------------------------------------------- | ---------------------------------: | -------------------------------------------------------------------------------------------------------------------- |
| Search result page, cold | `/products/hex-bolts/`, 93 populated blocks         | FCP 392 ms; first product 1,020 ms | 3.93 MB, 241 requests                                                                                                |
| Search result page, warm | Same URL, 93 populated blocks                       |   FCP 204 ms; first product 445 ms | 88.6 KB, 237 requests; a separate 0.62 s run failed the final grid check and is excluded                             |
| Filtered category, warm  | `system-of-measurement~inch/`, 110 populated blocks |   FCP 216 ms; first product 458 ms | 117 KB, 317 requests; separate run reached 639 ms                                                                    |
| Filter click             | Full navigation, 110 blocks                         |             505 ms click-to-blocks | From `measurements.json`; a separate click run also recorded 615 ms for search including a 400 ms human typing pause |

The interaction lesson is the gap between "the page looks loaded" and "the
results are actually there": shell FCP at 204-216 ms, data at 445-458 ms warm;
cold search FCP at 392 ms, data at 1.02 s. That is exactly the gap Janosik
should close by putting a summary and the first visible page in the first
payload, rather than fetching the whole board after boot.

### 2.5 HTML and asset strategy

The raw HTML is not a tiny SSR document, but it is a deliberately staged one:

- Homepage HTML: 81.7 KB raw, 15 KB Brotli. Category HTML: 157 KB raw, 31 KB
  Brotli. Both include a 35.6 KB inline `<style>` block with critical layout
  and theme CSS.
- The category page has 17 `<script>` tags, 12 of them deferred. Four external
  bundles use `data-deferred-src` plus `data-deferred="mcm-init"`: three
  application bundles and one tracking schema (`/trk/js/schema/1.3.402`). They
  total about 1.04 MB compressed, dominated by an 892 KB main bundle. The
  JavaScript is large, but it is off the first-paint path and cached for a
  year.
- Two external stylesheets (115 KB total) exist, but the inline critical CSS
  already covers the first paint. Four WOFF2 fonts are preloaded;
  `font-display: fallback` is used. There are 17 preloads, 3 dns-prefetch
  hints, and no preconnect hint on the measured pages.
- The **server HTML has no `srcset`**. After client rendering, 122 category
  tiles get `srcset` attributes (93 on search, 110 on the filtered page). There
  is no `<picture>`, WebP, AVIF, `loading="lazy"`, or `fetchpriority` in the
  measured pages. The site wins on image strategy by making images small,
  numerous, HTTP/2-multiplexed, and immutable; the client adds responsive
  candidates, but this is not a modern-format/lazy-loading strategy.
- The shell is server-rendered; the catalog data is not. With JavaScript
  disabled, the category page is 283 nodes and 853 characters ending in "Our
  website requires JavaScript." The 122 product families appear only after the
  client fetches HTML/JSON fragments such as
  `Navigate/ClientRenderedSpecSearchWeb.aspx` and
  `Navigate/RetrieveCatalogPageList.aspx`.
- The catalog reports 91,978 products (tracking beacon from the run; the visible
  counter varies by bucket) and renders 122 family tiles in one document. No
  pager was visible and no obvious infinite-scroll sentinel was exposed. The
  catalog handles its large product count by family tiles and drill-down pages,
  not by a 25,000-row list. That is a catalog pattern, not a board pattern.
- The service worker has root scope, activates after the first homepage visit,
  and in the measured session had one cache with one entry (`/`). It is a
  navigation cache for a static shell, not an offline catalog. Assets are left
  to the HTTP cache.
- The result is a hybrid: server-rendered shell + client-rendered data +
  versioned, immutable fragments. That is more useful to Janosik than either
  "full SSR" or "pure SPA".

### 2.6 What McMaster does not do

This matters because the site is often described as "SSR" or "tiny JS". The
measurements say otherwise:

- It does **not** server-render the product grid. The no-JS page is a shell.
- It does **not** ship a small JavaScript bundle. It ships about 1 MB of
  compressed JS on the critical page and keeps it off the first-paint path.
- It does **not** put responsive-image attributes in the server HTML; the
  client adds `srcset` to the rendered tiles. It does not use WebP/AVIF,
  `<picture>`, native lazy loading, or `fetchpriority` in the measured pages.
- It does **not** use HTTP/3 on this path.
- It does **not** use ETag/304 for the HTML document; the document is
  re-fetched every time.
- It does **not** keep filter/search in the SPA. Those are full navigations,
  which is acceptable for a catalog and wrong for a live board.
- It does **not** provide full offline data. The service worker measured here
  cached the shell only.

The transferable idea is the **staging**, not the individual byte counts.

### 2.7 Transfer / do-not-transfer map

| McMaster technique                          | Measured effect                          | Janosik translation                                                        | Phase        |
| ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | ------------ |
| Inline critical CSS + server-rendered shell | FCP 376-456 ms cold, 92-216 ms warm      | Static shell + critical CSS; neutral frame + route-revealed board skeleton | P0a          |
| Deferred scripts (`data-deferred-src`)      | Shell paints before the 1 MB bundle runs | Keep the entry bundle deferred; do not gate first paint on React           | P0a          |
| Hashed assets, immutable 1 year             | 63-80 warm cache hits; JS/CSS at 0 bytes | Already implemented; verify Nest and nginx both send it                    | P0a (verify) |
| Service worker caches the static shell      | Warm TTFB 37 ms, FCP 92 ms               | SWR static shell only; never cache navigation bootstrap                    | P0a          |
| Versioned, immutable fragments              | Warm data still 88-126 KB                | Weak ETag + `If-None-Match` for private pages; `no-store` for user data    | P0a/P0b      |
| Search intent + warm shell                  | FCP 204-216 ms; data 445-458 ms warm     | Prefetch summary/first page on hover, route intent, and search typing      | P0b          |
| Brotli + HTTP/2                             | 31 KB HTML, 2.85 MB catalog cold         | Gzip/fast Brotli for JSON/JS/CSS/HTML; HTTP/2 at the proxy                 | P0a/P2       |
| Small DOM, no long tasks                    | 5,490 nodes, 127-156 ms max task         | Keep virtualization; keep per-page JSON small; budget long tasks           | P0a/P0b      |
| Full page navigation per filter             | 505 ms, but loses SPA state              | Do **not** copy; use server filter + URL state without reload              | P1           |
| 1 MB JS, 489 images, 343 requests           | Fast only because of CDN and caching     | Do **not** copy; keep 300 KB critical JS and a small request budget        | Non-goal     |

---

## 3. Part B - Janosik at 25,000 cards

### 3.1 Assumptions and current measured state

The 25,000-card case is a product-limit change, not just a rendering tweak.
The current product cap is 12 columns x 200 cards = 2,400 cards per board. The
capacity report lifted the per-column cap only in a disposable backend. This
document assumes the limits/backend stream makes 25,000 storable and
commandable; it designs the UX for that case. It does not decide the cap.

The capacity baseline comes from
`~/.janosik-dev/load/capacity-2026-11-10/REPORT.md`. The 25k column is the
companion's estimate and is the **only** 25k capacity fit used here. The
companion owns `aggregateRevision`, the canonical ETag key, and the snapshot
merge contract; this document consumes those contracts and does not redefine
them.

The baseline:

| Metric                       |    10,000 cards (measured) | 25,000 cards (companion estimate) |
| ---------------------------- | -------------------------: | --------------------------------: |
| Board aggregate              | 6.75 MiB (7.08 MB decimal) |                17.7 MB (16.9 MiB) |
| `GET /boards/:id` p50        |                     263 ms |                           ~640 ms |
| UI first render              |                     906 ms |                            ~1.7 s |
| JS heap                      |                     95 MiB |                       150-200 MiB |
| 10 concurrent opens, API RSS |                  1,479 MiB |                          ~3.3 GiB |
| DOM nodes                    |                      2,013 |           ~2,000 (virtualization) |

Important caveats:

- The 25k column is not a benchmark; it is the companion's capacity fit. Do not
  quote it as a UX measurement.
- The 10k UI numbers were taken against the Vite dev server in a disposable
  environment, not a production build. Production boot is likely faster; the
  data path and memory shape are the same.
- The capacity dataset used 500-character descriptions and no
  labels/checklists/comments/attachments. A real 25k board with metadata is
  heavier. The benchmark plan therefore requires a realistic fixture.
- Use two board shapes for every gate: **5 columns x 5,000 cards** and
  **12 columns x ~2,083 = 25,000 cards**. A 5x5,000-only result does not prove
  the 12-column layout; the 2,100 label is a rounding, not a different board.
- The machine also ran the load generator, so absolute latency is
  conservative. The cold/warm and size relationships are what matter.

### 3.2 What is already good

Janosik is not starting from zero:

- **Virtualization works.** At 10k, only 50 cards and ~2,013 nodes are mounted;
  scroll long tasks were 0 ms in the board view.
- **SSE deltas are cheap.** Twenty `UPDATE_CARD` commands at 10k produced zero
  long tasks and kept the heap at 84 MiB.
- **Static assets are content-hashed and immutable.** The Vite build emits
  hashed assets, Nest sets `public, max-age=31536000, immutable` for
  `/app/assets/*`, and the nginx contract does the same.
- **The service worker precaches entry assets** and already handles versioned
  caches, old-tab chunk fallback, and update prompts. Its navigation caching
  needs a privacy fix, not a rewrite.
- **A board skeleton exists.** `BoardShellSkeleton` mirrors the real header,
  filter bar, columns, and card geometry. It is only rendered after React
  boots; P0a can reveal an inline copy on board routes.
- **Filter state is URL-addressable.** `?f.q=...&f.due=...` is already
  implemented, including Back/Forward.
- **Optimistic UI and a command log exist.** Mutations apply locally first,
  roll back on refusal, and travel through the command path.
- **Undo history is command-pair based**, not a full-board snapshot per edit.
  Keep it bounded; do not introduce whole-board snapshots.
- **Board summaries already carry counters.** `GET /boards` returns card and
  column counts per board. That is the seed of a summary endpoint.

### 3.3 The gaps that matter for 25k

1. **No compression in the shipped path.** There is no `compression`
   middleware in the Nest app, and the checked-in nginx config does not enable
   gzip or Brotli. A 6.75 MiB (7.08 MB decimal) JSON aggregate goes over the
   wire as 6.75 MiB; the companion's 17.7 MB aggregate will do the same. This is
   the largest single
   transport win available.
2. **The HTML shell is visually empty.** `ui/index.html` has an empty `#root`
   div plus a theme preflight. Until React boots, the user sees a themed
   background, not a board.
3. **The aggregate is all-or-nothing.** `GET /boards/:id` returns every card,
   including descriptions, checklists, links, labels, assignee/due/priority,
   cover, and `attachmentCount`. It does **not** carry comments, activity
   feeds, or attachment blobs; those are separate. The UI still cannot paint
   until it has parsed the whole board payload, which is the 25k first-render
   cost.
4. **All boards hydrate in the background.** After the active board, the
   provider fetches every remaining board's aggregate. With several large
   boards, a user pays for boards they never open.
5. **Filter/search run on the fully loaded board.** `filterCardIds` and
   `searchBoards` walk in-memory cards. A server search endpoint exists
   (`GET /boards/:id/search`), but it returns ids only; the UI does not use it.
6. **Card detail fields are already in memory.** Description, checklists, and
   links ship with every card. Comments, activity, and attachments are separate
   but the dialog still expects the board's card object first.
7. **The API has a weak body-hash ETag but no client conditional GET.**
   Express 5 already emits a weak ETag and handles `If-None-Match`; the API
   client does not set or rely on it, and producing the hash still serializes
   the whole board. There is no `aggregateRevision`/page-version validator;
   `seq` alone is not a content revision, and a 304 does not advance the SSE
   baseline.
8. **The service worker caches every successful navigation under
   `APP_SHELL_URL`.** Any SSR-lite HTML with a bootstrap would be replayed to
   the next user of the profile. This must be fixed before personalized HTML is
   considered.
9. **Server mode is not offline for board data.** The service worker
   deliberately bypasses `/api/`; the board lives in memory. The shell may boot
   offline, but the board does not open from cache. This document uses
   "read-only cache of a server board" for P1; local/offline mode is a separate
   product mode, and queued writes/conflict UX belongs to P2. The companion
   treats 25k as server-mode only.
10. **The self-host nginx contract serves `/app/` from disk, not Nest.** A
    board-navigation SSR-lite route would need a proxy to Nest or the all-in-one
    image. This is a deployment constraint, not just a code change.
11. **25k memory is not a rendering problem alone.** Even with virtualization,
    holding 25k full card objects, undo history, and search indexes in the main
    thread will exceed a comfortable heap. The data model must become windowed.

### 3.4 The fast-board model

The target model has five layers:

```text
1. HTML shell        neutral static shell + critical CSS + path-revealed board skeleton
2. Summary           board meta, columns, labels, counts, role, seq
3. Column windows    first 50 cards per column, keyset-paginated after that
4. Card detail       description/checklists/links on demand;
                     comments/activity/attachments via their own endpoints
5. Live overlay      SSE actions + optimistic commands, merged into windows
```

The browser should never need the full board to paint the first screen. It
needs enough to draw the frame, the column headers, the counts, and the first
screenful of cards. Everything else is a prefetch or an on-demand fetch.

#### 3.4.1 Data contract

These are shapes, not final route names:

- `GET /api/v1/boards/:id/summary` - board metadata, columns, labels,
  per-column total/matched counts, current user's role, `seq`, `atSeq`,
  `snapshotToken`, `aggregateRevision`, `updatedAt`. Target: under 50 KB. The
  full member directory is fetched separately; a 2,000-member board would
  otherwise dominate the summary.
- `GET /api/v1/boards/:id/cards?columnId=&cursor=<position,id>&limit=50&detail=summary&q=&sort=&includeArchived=`
  - bounded card summaries plus per-column counts, `nextCursor`, `hasMore`,
    `seq`, `atSeq`, and `aggregateRevision`. Summary fields: id, title, labelIds,
    dueDate, priority, assigneeId, cover, attachmentCount, updatedAt, position.
    No description, checklists, links, comments, activity, or attachments.
    Target: 30-60 KB per page.
- `GET /api/v1/boards/:id/cards/:cardId` - the full card, fetched when the
  dialog opens (or prefetched on hover), with `boardId`, `columnId`, `version`,
  `seq`, `atSeq`, and `aggregateRevision`. Comments, activity, and attachments
  stay on their own paginated endpoints.
- The filtered/search view uses the same page endpoint with `q`/`sort` and
  returns bounded summaries plus per-column counts. **Do not return ids only**
  for a visible result list; ids-only forces one fetch per card. Reserve an
  ids-only response for counts, facets, and a top-hit prefetch.
- `GET /api/v1/boards/:id/facets` - counts for the filter UI.
- Keep `GET /boards/:id` as the compatibility/export/admin aggregate. The board
  UI switches to summary + windows behind a flag; the old path remains for
  local mode, imports, and clients that need the whole document.

These endpoints must be **bounded SQL**, not wrappers around
`loadBoardAggregate` followed by slicing:

- keyset predicates `(columnId, position, id)`, `LIMIT` on the SQL side;
- summary projections only, no checklist/link joins;
- no full-board serialization, no `loadBoardAggregate` call;
- an acceptance test that stubs/spies `loadBoardAggregate` and asserts it is
  never called by the summary/page endpoint.

Cursors are `(position, id)`, not offsets. A keyset cursor is stable for
inserts/deletes at page boundaries, but a concurrent move can make a row skip
or duplicate across pages. Carry the board `seq`/`atSeq` and
`aggregateRevision` in the response and reconcile by id/seq; refetch the page
if the revision changed. Do not pretend the cursor is a snapshot.

**Snapshot merge (P0b).** Summary and one page per column are separate HTTP
snapshots. The client:

1. buffers SSE frames while the initial summary + pages are in flight;
2. takes `summary.atSeq` as the baseline and applies buffered frames with
   `seq > atSeq`;
3. for a page with `page.atSeq < summary.atSeq`, applies the known deltas or
   refetches the page; for `page.atSeq > summary.atSeq`, advances the summary
   baseline and refetches the summary if needed;
4. never mixes a pre-move page with a post-move summary without reconciliation.

`snapshotToken` identifies the initial snapshot. A page whose
`aggregateRevision` differs from the summary's is reconciled, not silently
merged. Test a move/update/comment arriving during initial load; the final
window must match a fresh read.

#### 3.4.2 P0 shell choice: static shell + API bootstrap

P0 must pick one shell model. Use:

**Static, cacheable shell + API bootstrap.** The shell is a static document
with neutral chrome and a hidden board skeleton. A tiny inline path check
reveals the board skeleton only on `/board/...`; login, admin, and share routes
show the neutral shell. The shell contains no user data and can be cached by
the service worker. The client then fetches summary + first pages through the
API (one extra round trip).

This avoids the privacy hazard of personalized HTML and keeps the SW cache
simple. The board skeleton is inline CSS/HTML and must match
`BoardShellSkeleton`; add a geometry/screenshot drift check at 1600x900 and
390x844.

**SSR-lite is a P1 option, not a P0 default.** If it is adopted:

- Nest injects summary + first pages into the HTML for `/app/board/:id`.
- The response is `Cache-Control: private, no-store`; it contains user data.
- The service worker must **never** cache a navigation response; only the
  known static shell URL is cacheable.
- `deploy/nginx.conf` currently serves `/app/` from disk. SSR-lite needs a
  board-navigation proxy to Nest, or it is limited to the all-in-one image.
- The trade-off is one less round trip versus auth, no-store, nginx, and
  rollback complexity. Do not run both a no-store SSR-lite response and an
  SWR-cached shell for the same navigation; they are mutually exclusive.

P0a therefore shows a neutral shell and a route-revealed board skeleton, not a
personalized board document. P0b adds the API bootstrap; P1 may remove the
extra round trip with SSR-lite if the operational cost is justified.

#### 3.4.3 Interaction model

- **Board switch:** paint the static shell/skeleton from cache, fetch the new
  summary (weak ETag), then first pages. Prefetch the summary on hover/focus.
- **Scroll:** virtualize per column as today, but feed the virtual list from
  keyset pages. Fetch the next page at ~70% of the viewport; keep a small LRU.
  Render skeleton rows for unloaded regions.
- **Drag and drop:** prefetch neighbor pages when a drag starts; do not drop
  into an unloaded page until it arrives (or queue the move and resolve
  server-side). The server stays authoritative on position.
- **Filter:** update the URL first (already supported), then fetch matching
  summaries and counts. Render matching windows; keep column headers/counts
  stable while the result arrives. Reconcile by `seq`.
- **Search:** debounce 150 ms, call the bounded page endpoint, show summaries;
  prefetch the top result's card detail on hover. Do not search 25k objects on
  the main thread.
- **Card open:** open the dialog with the summary fields immediately; fetch the
  full card (description/checklists/links) and comments/activity/attachments
  in parallel.
- **Live updates:** apply SSE actions to summary counts and loaded windows. If
  `seq` jumps, refetch the summary and affected pages instead of replaying an
  unknown gap. Every frame must carry board id and seq; a frame without a board
  id is dropped today, which is a correctness risk.
- **SSE frame cap:** P0.1 caps the **whole frame** below the client's 1 MB
  parser buffer (for example 256 KiB), not just the description. Keep the ~2 KB
  description cap as an additional payload optimization. If a frame would
  exceed the whole-frame cap, send a summary delta plus `detailStale: true` and
  let the open card fetch detail; never broadcast a 2 MB/8 MB command envelope.
- **Offline:** P1 caches a **read-only copy of a server board** (summary, last N
  pages, card detail LRU) in IndexedDB, namespaced per user, cleared on logout.
  Show "last synced" and a read-only badge. Queued writes/conflict UX is P2 and
  only for server-mode boards; local/offline mode is a separate product mode.

#### 3.4.4 Caching and prefetch rules

| Data                    | Cache policy                                                                                    | Invalidation                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hashed JS/CSS/fonts     | `public, max-age=31536000, immutable`                                                           | New hash on deploy                                                                            |
| Static shell HTML       | SW stale-while-revalidate + navigation preload; `no-cache` at origin                            | New SW version; update prompt                                                                 |
| Board summary           | `private, no-store` (or `private, no-cache` with server auth revalidation) + weak revision ETag | `aggregateRevision` bump (command or non-command), membership/role change, SSE `seq` ordering |
| Column/page summaries   | `private, no-store` + weak revision/query ETag                                                  | `aggregateRevision` bump, cursor/query change, SSE affecting the page                         |
| Card detail             | `private, no-store`; memory/IndexedDB LRU                                                       | `aggregateRevision`/card version, comments/attachments events                                 |
| Facets                  | `private, no-store` + weak revision ETag                                                        | `aggregateRevision` bump, counts/labels change                                                |
| SSR-lite bootstrap HTML | `private, no-store`; never SW-cached                                                            | Per request                                                                                   |
| Public snapshot share   | `public, max-age=...` (immutable snapshot)                                                      | New snapshot                                                                                  |
| Live public share       | `private, no-cache` or short SWR                                                                | SSE                                                                                           |
| SSE                     | no compression buffering, `no-transform`, `X-Accel-Buffering: no`                               | n/a                                                                                           |

Why `no-store`:

- `private` only keeps shared caches out. It does **not** stop the next user of
  the same browser profile from reading a cached summary, card detail, or
  facet response.
- Board JSON is per-user. Use `private, no-store`. If a deployment insists on
  `private, no-cache`, it must revalidate with the server on every use and
  reject a 304 for a different principal.
- With `no-store`, the browser does not persist the response; the client keeps
  the last payload in memory/IndexedDB and sends `If-None-Match` explicitly.
  If browser-managed revalidation is preferred, use `private, no-cache` plus
  server auth revalidation; do not combine `no-store` with an expectation of
  automatic HTTP-cache revalidation.

Validator rules:

- The ETag key is **board id + `aggregateRevision` + route + canonical query
  (`columnId`, cursor, limit, sort, q, `includeArchived`) + principal scope
  (member role or share id/scope) + projection**. Two cursors, two queries, two
  roles or two shares must never share an ETag. Use the companion's canonical
  shape: `W/"board:<id>:<revision>:<routeHash>:<scope>:<projection>"`.
- Use a weak ETag for JSON. Weak is correct because gzip and Brotli differ
  byte-for-byte. If a strong ETag is ever used, it must be byte-identical;
  include the encoding and membership/role version, or do not use strong.
- Check `If-None-Match` before `loadBoardAggregate`/JSON serialization. A 304
  must still carry `X-Board-Seq`; on 304 read it and advance the SSE `since`
  baseline. Do not "keep current state" without moving the baseline, or the
  next SSE connection replays a gap.
- `aggregateRevision` is not `seq`. It must bump on every board-scoped writer,
  including comments, attachments, agent-session end, and admin
  restore/recount, even when `seq` does not move.
- Gate on validator correctness: unchanged content -> 304; changed content ->
  200 with a new revision. A 304 ratio is not a valid target when every command
  changes the revision.

Validator tests (required):

- two cursors -> different ETags;
- two queries (`q`/sort/includeArchived) -> different ETags;
- two roles or two share scopes -> different ETags;
- a comment, attachment, or admin write that does not bump `seq` still bumps
  `aggregateRevision` and invalidates the content ETag;
- a 304 on unchanged content still returns the seq/revision needed to resume
  SSE.

Service-worker rules:

- `ui/src/pwa/sw.js` currently stores **every successful navigation** under
  `APP_SHELL_URL`. That replays a board navigation (and any bootstrap) to the
  next user. Change it so only a known static shell can be stored.
- Revalidation path: fetch the known `APP_SHELL_URL` as a normal request, or
  verify a navigation-preload response is byte-identical to the static shell
  before storing it. Never store a navigation response merely because it
  returned 200.
- Cache only statically known shell/asset URLs. Never cache
  `request.mode === "navigate"` responses in general, and never cache a
  response containing a bootstrap or user data.
- On auth change/logout, clear user-scoped caches and IndexedDB namespaces.
- Acceptance test: after opening a board, assert `cache.match(APP_SHELL_URL)`
  is the static shell and does **not** contain the board id, board title, or
  bootstrap marker. Test board -> shell navigation and a second account.
- SWR is limited to non-sensitive static shell/static assets.

Prefetch only on genuine intent and only same-origin, authenticated data:

- board switcher hover/focus -> summary;
- board route intent -> summary + first page per column;
- column scroll -> next page;
- card hover/focus -> card detail;
- filter popover open -> facets;
- search typing after 2 characters/150 ms -> bounded result page + top hit;
- idle time -> next board's summary, if the connection is not metered.

Respect `navigator.connection.saveData` and slow effective types. Abort
prefetches when intent changes. Never prefetch another user's data or put
private API responses in a shared cache.

### 3.5 Phased plan

Map UX phases to the architecture work explicitly:

| UX phase                 | Architecture dependency                                                                                    | Main gate                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P0a quick wins           | Companion P0.1 `aggregateRevision` plumbing; compression/static shell can ship first, content ETags cannot | Compressed transfer <=5.5 MB (capacity fixture); no regression >10%; 10 opens <=3.5 GiB |
| P0b read model v1        | Companion P0.2: summary + bounded pages, keyset SQL, snapshot merge                                        | Initial view <2 MB; board <1.5 s; 10 opens <1.5 GiB; heap <200 MiB                      |
| P1 windowed interactions | Companion P1: pagination/search/read-only cache                                                            | Filter/search/card/scroll budgets; read-only offline                                    |
| P2 optional polish       | TASK-175 for multi-node/edge; this plan only static edge/offline hardening                                 | Optional, not a release gate                                                            |

Phase mapping: **P0a = companion P0.1**, **P0b = companion P0.2**, **P1 =
companion P1**, **P2 = optional polish/TASK-175**.

#### P0a - quick wins (1-2 weeks: transport days + revision plumbing ~1 week)

Owner: UI platform + API + SRE/self-host.

1. **Compression.** Gzip as the portable default; fast Brotli (q4-5) where the
   proxy supports it. Precompress static assets at build time. For dynamic
   JSON, do not run Brotli q11 on a 17 MB body: it is CPU-heavy. Compress the
   existing aggregate now; compress summaries/pages when P0b lands. Cache the
   compressed bytes keyed by the validator, skip SSE and images, set `Vary` to
   `Accept-Encoding`, and measure CPU on a 4 vCPU box.
2. **Cache/validator contract (depends on companion P0.1).** Immutable hashed
   assets stay. Private board JSON becomes `private, no-store` (or
   `private, no-cache` with auth revalidation). **Content ETags/304 must not
   ship before `aggregateRevision` plumbing lands**, because `seq` is not a
   content revision. Compression and the static shell can ship first; until
   revision plumbing exists, do not advertise content ETags or cache content.
   Once it lands, use the canonical key
   `W/"board:<id>:<revision>:<routeHash>:<scope>:<projection>"` (board id +
   revision + route + canonical query + principal scope + projection) and make
   the client send `If-None-Match`; on 304 read `X-Board-Seq` (include it on the 304) and advance SSE `since`. Add the cursor/query/role/share and
   non-command-writer tests from 3.4.4.
3. **Static shell + route skeleton.** Neutral static shell for login/admin/
   share; a tiny inline path check reveals the board skeleton on `/board/`.
   Inline critical CSS; update the CSP hash for the inline path check; remove
   the skeleton when React mounts. Add a geometry/screenshot drift check
   against `BoardShellSkeleton`.
4. **Safe SWR shell.** Service worker serves the cached static shell
   immediately, revalidates in the background, and updates on the next
   navigation/update prompt. Never cache navigation responses with a bootstrap;
   clear user caches on auth change. Test that `cache.match(APP_SHELL_URL)` is
   the static shell and does not contain the board id/title/bootstrap marker;
   test board -> shell navigation and a second account.
5. **Prefetch on intent (stopgap).** Prefetch the board route chunk and the
   existing `GET /boards` summary list on switcher hover/focus; do not prefetch
   a full 25k aggregate. Per-board summary/first-page prefetch arrives with
   P0b, when those endpoints exist.
6. **Instrumentation.** `board:shell-painted`, `board:first-cards`,
   `board:interactive`, `card:open`, `filter:applied`, `search:results`.
   `board:interactive` means the first cards are painted and card open, column
   scroll, and filter input work without a >50 ms long task.
7. **SSE whole-frame cap.** Cap the frame below the client's 1 MB parser buffer
   (for example 256 KiB); if it would exceed, send a summary delta plus
   `detailStale` and let the open card fetch detail. Keep the ~2 KB description
   cap as a payload optimization, not the frame cap.

Acceptance: compressed 25k aggregate 3.5-4.5 MB gzip on the **500-character,
no-metadata capacity fixture**; the realistic long-description/metadata fixture
is a separate measured gate, expected to compress worse. Cold transfer
<=5.5 MB; no regression >10%; 10 concurrent opens <=3.5 GiB (3.5 GB decimal is
3.26 GiB, below the ~3.3 GiB estimate; the gate is 3.5 GiB). This needs at
least 6 GiB total host RAM or a concurrency cap; a 2 GiB VPS is not viable.
Heap <=250 MiB. P0a does **not** fix the 25k memory profile. Content ETags are
gated on the companion's P0.1 `aggregateRevision` plumbing; do not claim them
before it lands.

Rollout/rollback: feature-flag the new cache headers/SW; bump the SW cache
version; keep the old aggregate path as fallback. Roll back by disabling the
flag and clearing the SW/user caches.

#### P0b - read model v1 (M/L, 4-6 weeks)

Owner: API/read model + UI data layer. Depends on the companion's P0.2
read-model v1.

1. **Summary endpoint** with columns, labels, counts, role, `seq`, `atSeq`,
   `snapshotToken`, `aggregateRevision`; no member directory, no cards.
2. **Bounded page endpoint** (`cards?columnId=&cursor=&limit=&detail=summary`)
   with keyset SQL, summary projections, no checklist/link joins, and no
   `loadBoardAggregate` call. Each page carries `seq`, `atSeq`,
   `aggregateRevision`, and `nextCursor`. Acceptance test asserts the aggregate
   loader is not called.
3. **Switch the active board** to summary + first 50 cards/column; prefetch
   summary/first pages on board intent; stop background full-aggregate
   hydration; fetch other boards on demand.
4. **Add a single-card detail endpoint** (description/checklists/links) so the
   dialog never needs the aggregate; keep the aggregate for
   export/import/admin/local mode only. Comments/activity/attachments remain
   P1.

Acceptance: initial view <2 MB cold (compressed); board <1.5 s warm; 10
concurrent opens <1.5 GiB RSS; heap <200 MiB; card open <=400 ms; no long task
over 200 ms; CLS <=0.05; validator correctness 100%; both 5x5,000 and
12x~2,083 = 25,000 shapes pass. Feature-flag the read model and keep an
aggregate fallback for one release.

#### P1 - windowed interactions + optional SSR-lite (weeks)

Owner: UI + API.

1. Cursor-paginated column pages, page cache, neighbor prefetch on scroll/drag.
2. Extend card detail with comments/activity/attachments on their own
   endpoints; P0b ships the base description/checklists/links detail endpoint.
3. Server-side filter/search/facets using the bounded page endpoint; no
   ids-only visible lists.
4. Keep URL-addressable filter state; add view/sort/cursor where useful.
5. SSE delta application to summary/windows; `seq` gap refetch; board id + seq
   in every frame; whole-frame cap from P0.1; ~2 KB description optimization
   with `detailStale` when exceeded.
6. Worker-side filter/sort for loaded data; IndexedDB read-only cache of the
   server board (summary/pages/card LRU), per-user, cleared on logout.
7. Optional SSR-lite: only with a nginx board-navigation proxy/all-in-one
   image, `private, no-store`, and no SW navigation caching. Trade-off
   documented above.

Acceptance (release gate): filter <=50 ms local / <=150 ms server p95;
card open <=250 ms; longest task <=100 ms; heap <=150 MiB; cold first
meaningful board paint <=1.5 s; cold transfer <2 MB; read-only offline boot;
304 correctness (unchanged -> 304, changed -> 200) 100% on the fixture; mobile
and tablet budgets pass. Do not use a looser 100/250/400/200 ms entry gate as
the release gate.

Rollout/rollback: feature-flag cursor pages and server search; keep the
aggregate plus client-filter fallback for one release; roll back by disabling
the flag. The read-only cache is keyed by user and schema version and is purged
on logout/auth change.

#### P2 - optional edge/offline polish (quarter)

Owner: platform/SRE + UI.

- Optional CDN/edge for static assets and public snapshots only; HTTP/3 at the
  edge; HTTP/2 at the origin.
- Prefetch graph and worker-side global index.
- Read-only offline cache hardening, quota handling, multi-tab coordination.
- Queued writes/conflict UX for server-mode boards (not local mode).
- RUM and per-tenant budgets.
- **Multi-node/edge scale is TASK-175 (XL, out of scope for this document).**
  Do not put it in this plan or imply that this document delivers it.

Acceptance: optional static/public-snapshot edge cache hit ratio; the edge
cache has no user-scoped entries, and purge-on-logout applies only to
client/SW caches. RUM budgets recorded; no regression in P1 gates. None of
these are a release gate for the 25k read model.

### 3.6 UX SLOs for 25,000 cards

Definitions:

- **Cold:** new browser profile, empty HTTP cache, no service worker, server
  warm.
- **Warm:** same profile, service worker active, HTTP cache warm, server warm.
- **WAN profile:** 40 ms RTT, 20 Mbps down / 5 Mbps up. All rows below use WAN
  unless marked LAN; LAN results are diagnostic, not a release gate.
- **Board fixture:** 25,000 cards, realistic long descriptions and metadata;
  both 5x5,000 and 12x~2,083 = 25,000. Not the 500-character-only capacity fixture.
- **First meaningful board paint:** header, column headers, counts, and at
  least 10 cards per visible column; not a spinner.
- **`board:interactive`:** first cards painted and card open, column scroll,
  and filter input work without a >50 ms long task.
- **Server baseline:** 4 vCPU / 8 GiB RAM, Postgres on the same host,
  production build; record the actual hardware in every benchmark report.
- **Warm TTFB:** report the SW shell response separately from the network/API
  TTFB; do not blend them.
- **LCP element:** the board header or first card tile, whichever is larger;
  record the element. If the element varies by run, treat LCP as diagnostic,
  not a release gate.
- **SSE delta:** start = server commit/`seq` emission; end = next paint after
  applying to the summary/window. Report p95.
- **Percentiles:** all gates are p95 over 5 runs unless marked max; a regression
  > 10% versus the previous phase fails even if the absolute number passes.

| Area          | Metric                                      |      P0a stopgap |    P0b read model |        P1 target |
| ------------- | ------------------------------------------- | ---------------: | ----------------: | ---------------: |
| Cold load     | TTFB                                        |         <=800 ms |          <=500 ms |         <=400 ms |
| Cold load     | FCP                                         |          <=1.5 s |           <=1.0 s |         <=800 ms |
| Cold load     | First meaningful board paint                |          <=2.5 s |           <=2.0 s |          <=1.5 s |
| Cold load     | Transfer                                    |         <=5.5 MB |             <2 MB |            <2 MB |
| Warm load     | SW shell TTFB / API TTFB                    | <=250 / <=800 ms |  <=150 / <=250 ms | <=100 / <=200 ms |
| Warm load     | FCP                                         |         <=500 ms |          <=300 ms |         <=200 ms |
| Warm load     | LCP                                         |          <=1.2 s |           <=1.0 s |         <=800 ms |
| Warm load     | First meaningful board paint                |          <=2.0 s |           <=1.5 s |          <=1.0 s |
| Navigation    | Board switch, first cards                   |          <=1.2 s |           <=1.0 s |         <=800 ms |
| Filter/search | Local keypress -> paint                     |    no regression | <=100 ms (loaded) |          <=50 ms |
| Filter/search | Server p95                                  |          measure |                 - |         <=150 ms |
| Scroll        | Longest task                                |         <=250 ms |          <=200 ms |         <=100 ms |
| Scroll        | p95 frame                                   |                - |         <=16.7 ms |        <=16.7 ms |
| Card open     | Summary -> full detail                      |                - |          <=400 ms |         <=250 ms |
| Live          | SSE delta p95                               |         <=150 ms |          <=100 ms |          <=50 ms |
| Memory        | UI JS heap                                  |        <=250 MiB |          <200 MiB |        <=150 MiB |
| Memory        | API RSS, 10 concurrent opens                |        <=3.5 GiB |          <1.5 GiB |         <1.5 GiB |
| Quality       | CLS                                         |            <=0.1 |            <=0.05 |           <=0.05 |
| Correctness   | Validator: unchanged -> 304, changed -> 200 |                - |              100% |             100% |

Why these numbers:

- The P0a row is deliberately a stopgap: full-aggregate 25k still needs
  ~3.3 GiB for 10 opens, so a 2 GiB VPS cannot be promised. Either require >=6 GiB
  or cap concurrency until P0b. The 1.5 GiB gate belongs to the read model.
- P0a's filter row is **measure/no regression**, not a 150 ms gate; the full
  filter SLO starts at P1.
- P0b/P1 align with the companion: initial view <2 MB, board <1.5 s, 10 opens
  <1.5 GiB, heap <200 MiB. P1 tightens the interaction budgets.
- P0b only has the loaded windows; its filter gate is for those windows. A
  full-board server filter is P1. Do not claim a 25k filter SLO on P0b.
- The 304 row is a correctness gate, not a hit-ratio gate. A
  revision-based validator invalidates on every content change, so a high 304
  ratio on focus refetch is not a sensible target. Measure unchanged vs changed
  on the fixture.
- Filtering 25k lightweight records in a worker can be under 100 ms. A server
  filter needs a trigram/FTS index to stay under 250 ms p95.
- The no-long-task budget is the guard against shipping 17.7 MB of JSON. A
  300 KB page parses in milliseconds; a 17.7 MB page does not.
- `private, no-store` does not mean "no cache": the client can keep a
  memory/IndexedDB read-only cache with explicit user namespacing. It means no
  HTTP/SW cache reuse across users.

Mobile/tablet: for 390x844 and 1024x768, add +1 s to the cold/warm first
meaningful paint budgets and +50 ms to the local filter budget; scrolling stays
60 fps. Table and calendar views are not re-derived here; cross-reference the
companion for their row counts and virtualization budgets.

### 3.7 Benchmark plan

Do not run this now: other streams are using the machine. This is the plan for
a dedicated, idle environment.

#### Matrix

| Dimension   | Values                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Build       | `main` at 3031d8b, P0a, P0b, P1, P2                                                              |
| Board size  | 10,000; 25,000 (5x5,000); 25,000 (12x~2,083)                                                     |
| Fixture     | realistic: long descriptions, labels, checklists, comments on a sample                           |
| Cache state | cold context; warm reload; service-worker-controlled second visit                                |
| Network     | LAN (<1 ms, 1 Gbps); WAN (40 ms, 20/5 Mbps); optional 3G (150 ms, 1.6/0.75 Mbps)                 |
| Concurrency | 1, 5, 10 simultaneous board opens                                                                |
| View        | board, table, calendar, filtered board, search results, open card dialog; mobile board (390x844) |
| Repetitions | 5 per cell; report median and p95; discard the first warm-up                                     |

#### Metrics to capture

Timing: TTFB (SW shell vs API separately), FCP, LCP, DCL, load,
`board:shell-painted`, `board:first-cards`, `board:interactive`,
`filter:applied`, `search:results`, `card:open`.

Network: total transfer, request count, bytes by type, HTTP protocol,
content-encoding, cache status, 304 correctness, compressed vs uncompressed
variant.

Runtime: DOM nodes, mounted cards, long-task count/max/TBT, CLS, frame times
during a 5 s scroll, JS heap before/after GC, React commit durations.

Server: GET p50/p95, response bytes, CPU, RSS, 10-concurrent RSS, SSE
connections, delta latency, error rate, Postgres query time for
filter/search/facets, and a spy that `loadBoardAggregate` is not called by the
summary/page endpoint.

Correctness: card counts match the database, filter result set matches SQL, no
lost commands, no duplicate cards after reconnect, SSE gap recovery, cursor
stability under concurrent moves (reconcile by id/seq), 304 correctness.

#### Procedure

1. Seed a disposable database with the 10k/25k shapes and the realistic
   fixture; lift caps only there.
2. Build production UI and API. Serve through Nest static and, separately,
   through the nginx contract. Do not measure the Vite dev server.
3. Use the same Playwright/CDP harness and viewport as the McMaster
   measurements (1600x900, desktop UA, cold context vs warm reload).
4. Capture a Chrome trace for every run; keep JSON/trace/screenshot artifacts
   outside the repo (for example under
   `~/.janosik-dev/ux-investigation/bench/`).
5. Run the McMaster baseline on the same client/network before each campaign,
   but keep it to a handful of loads and reuse it; do not load-test or scrape
   McMaster. Re-baseline if the network/day changes.
6. Publish a small table per phase and per board shape; do not collapse
   5x5,000 and 12x~2,083 into one score.

#### Pass/fail gates

- P0a: compressed 25k aggregate 3.5-4.5 MB gzip on the 500-character/
  no-metadata capacity fixture (realistic long-description/metadata fixture is
  a separate measured gate); cold transfer <=5.5 MB; no regression >10%;
  10 concurrent <=3.5 GiB; heap <=250 MiB; no long task >250 ms. Report
  compression on both fixtures; do not extrapolate the realistic fixture.
  Document that this needs >=6 GiB total host RAM or a concurrency cap, and
  that content ETags are gated on companion P0.1 `aggregateRevision`.
- P0b: initial view <2 MB; warm board <1.5 s; cold board <2.0 s; 10 concurrent
  <1.5 GiB; heap <200 MiB; no long task >200 ms; CLS <=0.05; validator
  correctness 100%; both board shapes pass; aggregate loader not called.
- P1: warm board <1.0 s; cold FMBP <=1.5 s; cold transfer <2 MB; filter <=50 ms
  local / <=150 ms server p95; card open <=250 ms; longest task <=100 ms; heap
  <=150 MiB; read-only offline boot; validator correctness 100%; mobile/tablet
  budgets pass.
- P2: optional only; TASK-175 owns multi-node/edge scale.

Comparison to McMaster: use its warm/cold numbers as a reference line, not a
pass/fail threshold. Janosik should beat McMaster on first-payload bytes (no
2.85 MB catalog, no 489 images) and should be within roughly 5x of its warm
paint time. It will not match a 92 ms warm FCP on a cold self-hosted server
without a CDN; the gate is the user-perceived board, not the CDN's homepage.

### 3.8 Risks and non-goals

| Risk                             | Why it bites                                                                                                           | Mitigation                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private JSON cached across users | `private, max-age` keeps shared caches out but not the next profile user; SW navigation caching can replay a bootstrap | `private, no-store` for board JSON; cache only static shell URLs; test `cache.match(APP_SHELL_URL)` is the static shell and contains no board id/title/bootstrap; clear user caches on auth change |
| SSR-lite vs SWR shell            | Personalized `no-store` HTML and an SWR-cached shell are mutually exclusive                                            | P0 static shell + API bootstrap; P1 SSR-lite with no SW navigation cache and a nginx proxy/all-in-one                                                                                              |
| Auth leakage                     | Board HTML/JSON is per-user; a shared cache or CDN would serve one user's board to another                             | Per-request auth; `private, no-store`; no shared edge cache for API; clear caches on logout                                                                                                        |
| Cache invalidation               | Summary/pages/facets go stale after commands, SSE, or reconnects                                                       | Revision/query/scope ETag; bump `aggregateRevision` on non-command writers; SSE invalidation; `seq` gap refetch; 304 advances `since`; user-scoped client cache                                    |
| Self-host without CDN            | Brotli/HTTP2/3 may be missing; CPU is limited; TLS termination varies                                                  | Gzip portable default; fast Brotli/precompressed static; HTTP/2 at the proxy (TLS); test 4 vCPU; CDN optional                                                                                      |
| 25k RAM                          | Full aggregate needs ~3.3 GiB for 10 opens; a 2 GiB VPS cannot host it                                                 | P0a requires >=6 GiB total host RAM or a concurrency cap; P0b read model brings 10 opens <1.5 GiB                                                                                                  |
| Multi-board hydration            | Background loading every aggregate multiplies payload and memory                                                       | Summaries only; active board on demand; cancel prefetch                                                                                                                                            |
| 25k memory                       | Full card objects, undo history, search indexes, JSON parse                                                            | Windowed pages, worker index, LRU detail, bounded command-pair undo                                                                                                                                |
| SW staleness                     | Cached shell points at old chunks after deploy                                                                         | SWR + versioned cache + old-cache fallback + update prompt; never cache HTML as JS                                                                                                                 |
| Drag/drop pagination             | Dropping into an unloaded page has no target order; concurrent moves conflict                                          | Prefetch neighbors; server-authoritative position; queue/refuse until loaded                                                                                                                       |
| Filter/search consistency        | Server result and local window diverge while commands arrive                                                           | Carry `seq`; reconcile on response; refetch affected pages; URL source of truth                                                                                                                    |
| Offline confusion                | A read-only server-board cache is not local/offline mode; queued writes/conflict UX is P2                              | Separate the two modes; 25k is server-mode only; P1 read-only, P2 queued writes                                                                                                                    |
| SSE frame size                   | One long description or a command envelope can exceed the client 1 MB parser buffer and block the stream               | P0.1 whole-frame cap (e.g. 256 KiB); ~2 KB description optimization; `detailStale` + detail fetch for larger changes                                                                               |
| Real-time scale                  | SSE fan-out/reconnect storms                                                                                           | Per-board channels, backpressure, resume from `seq`; TASK-175 owns multi-node                                                                                                                      |

Non-goals:

- Server-rendering all 25,000 cards or making the board crawlable.
- Requiring a CDN, HTTP/3, or a specific reverse proxy for self-host.
- Replacing Postgres or adding a separate search engine in P0/P1.
- Changing command semantics, WIP rules, or undo behavior; undo is already
  command-pair based.
- Raising the 25k cap itself; that is a product/limits decision.
- A visual redesign; the skeleton must match current geometry.
- Multi-node/edge scale; that is TASK-175 (XL).
- Full offline editing with conflict-free semantics; P1 is read-only cache,
  P2 is queued writes/conflict UX for server-mode boards.

### 3.9 First two things to build

**1. Compression + cache/validator contract (S for transport, ~1 week for
revision plumbing).**

Enable gzip (portable default) and fast Brotli where available; precompress
static assets; use `private, no-store` for board JSON. The content-ETag half
**depends on companion P0.1 `aggregateRevision` plumbing**; do not claim
content ETags before it lands. Once it does, use the canonical key
`W/"board:<id>:<revision>:<routeHash>:<scope>:<projection>"` (board id +
revision + route + canonical query + principal scope + projection), make the
client send `If-None-Match`, and on 304 read `X-Board-Seq` and advance SSE
`since`. Do not run Brotli q11 on a 17 MB JSON. Expected: 17.7 MB raw ->
3.5-4.5 MB gzip (3.9-5.1x) on the 500-char fixture; on 20 Mbps that is roughly
1.4-1.8 s of transfer, not under 1 s. The realistic long-description/metadata
fixture is a separate measured gate. Warm focus refetch becomes a 304 with no
body when content is unchanged. Risk: low-to-medium; SSE exclusion, `Vary`,
weak ETag/encoding, non-command revision bumps, and 304 baseline handling need
tests.

**2. Static shell + route-revealed board skeleton + safe SWR (S: 2-3 days).**

Keep the static shell neutral for login/admin/share; reveal a board skeleton
only on `/board/` with a tiny inline path check. Cache only the static shell
URL in the service worker; never cache navigation responses or bootstrap HTML;
clear user caches on auth change. Test that `cache.match(APP_SHELL_URL)` is the
static shell with no board id/title/bootstrap, board -> shell navigation, and a
second account. Expected: warm first paint well under 200 ms, no board flash on
auth/admin/share, and no cross-user replay. Risk: low-to-medium; geometry drift
test and SW cache test are required.

**Next: read model v1 (M/L: 4-6 weeks).** Summary + bounded first pages with
keyset SQL; no `loadBoardAggregate` wrapper; stop background aggregate
hydration. This is the change that makes 25k fit: initial view <2 MB, board
<1.5 s, 10 opens <1.5 GiB, heap <200 MiB. It depends on the companion's
read-model v1 and should be feature-flagged with an aggregate fallback.

---

## 4. Appendix - raw notes and reproducibility

Artifacts from the McMaster reconnaissance (not committed; outside the repo):

- `~/.janosik-dev/ux-investigation/final-measurements.json` - single-run category,
  search, and filtered cold/warm rows used in the tables; homepage rows come
  from `measurements.json`.
- `~/.janosik-dev/ux-investigation/measurements.json` - homepage cold/warm and
  the original category run; search/filter click interactions.
- `~/.janosik-dev/ux-investigation/inspect.json` - request-level category
  breakdown, top transfers, service worker details.
- `~/.janosik-dev/ux-investigation/measure-pages.log` - early direct
  search/filter runs, including the failed final-grid checks.
- `~/.janosik-dev/ux-investigation/sw.json` - service worker registration,
  controller, cache keys/entries.
- `~/.janosik-dev/ux-investigation/headers.txt` - document response headers.
- `~/.janosik-dev/ux-investigation/category.png` - rendered category screenshot.

Janosik capacity source:
`~/.janosik-dev/load/capacity-2026-11-10/REPORT.md` (WSL, not in git). The
25k numbers (17.7 MB, ~640 ms, ~1.7 s, 150-200 MiB, ~3.3 GiB) are quoted from the
companion; the companion is not present in this worktree, so they are treated
as the authoritative capacity fit rather than re-derived here.

Rounding: times are rounded to the nearest millisecond; byte counts are shown
as decimal KB/MB (1,000/1,000,000). The tables intentionally show one saved run
per row; run-to-run ranges are stated in the notes. The benchmark plan requires
five repetitions and p95 before any SLO is treated as passed.

Prettier note: the repository's `.prettierignore` contains `*.md`, so
`npx prettier --check docs/PERF-25K-UX.md` treats the file as ignored. The
substantive check is
`npx prettier --check --ignore-path /dev/null docs/PERF-25K-UX.md`. Table
widths are checked manually because Prettier preserves wide Markdown tables.

The companion `docs/PERF-25K-INVESTIGATION.md` should be read for the command
path, aggregate construction, keyset/read-model SQL, database indexes, and
cache architecture. This document assumes those are being addressed; it does
not re-derive them.
