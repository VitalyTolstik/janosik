# Making a 25,000-card Janosik board feel instant

**Status:** investigation and proposal. No product code changes.
**Date:** 2026-11-10.
**Reference:** [mcmaster.com](https://www.mcmaster.com/), measured from Amsterdam, NL.
**Companion:** `docs/PERF-25K-INVESTIGATION.md` covers the backend/data
architecture (command path, aggregate loading, storage, cache design). It may
land in a separate branch/worktree; this document is written to stand alone.
This document deliberately does **not** repeat that analysis. It looks at
perceived performance: what the user sees, when they see it, and what it costs
to get there.

The target is a 25,000-card board that opens and reacts like a much smaller
one: a board-shaped first paint in well under a second on a warm visit, useful
columns in about a second on a cold visit, filtering that feels local, and no
scroll or typing jank. McMaster-Carr is the reference because it is an
ultra-fast, server-heavy catalog with a very small interaction budget. It is
not a Kanban board, so the interesting question is which of its techniques
survive contact with an authenticated, real-time, offline-capable editor.

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
- Category page cold: TTFB 279 ms, FCP/LCP 400 ms, load 658 ms, 2.87 MB,
  342 requests, first product count at 968 ms.
- Category page warm: TTFB 162 ms, FCP 204 ms, LCP 220 ms, 125 KB transferred,
  first product count at 447 ms.
- Search submit from a warm homepage: results shell FCP 324 ms; first product
  count at 627 ms.
- Filter click on a warm category page: grid blocks at 505 ms; first product
  count at 639 ms on a direct warm load, with a full URL-addressable
  navigation.

Janosik's current full-aggregate path does not scale to 25,000 cards. At 10,000
cards the measured aggregate is 6.75 MB, `GET` p50 is 263 ms, first board render
is 906 ms, the JS heap is 95 MB, and ten concurrent opens take the API to
1.48 GB RSS. Keeping the same shape at 25,000 cards implies roughly 16.9 MB,
~650 ms GET, ~1.7-2.3 s first render, ~200-250 MB heap, and ~3.5-3.9 GB for ten
concurrent opens. Those are estimates, not measurements, but the direction is
unambiguous: the first screen cannot contain the whole board.

What transfers from McMaster:

1. **A board-shaped first paint.** Inline skeleton HTML and critical CSS, so
   the user sees the board frame before React, auth, or board data arrive.
2. **Shell first, data second.** Keep the initial HTML small and defer the
   application bundle; fetch only a summary and the visible card windows.
3. **Immutable static assets plus a navigation cache.** Hashed assets are
   already immutable in Janosik; the service worker should serve the shell
   stale-while-revalidate instead of network-first.
4. **Conditional GET and aggressive reuse.** ETag/304 for private board data;
   immutable long-lived caching for static assets; stale-while-revalidate for
   summary/facets.
5. **Prefetch on intent.** Hovering a board, typing a search, or opening a
   filter is enough notice to fetch the next small payload.
6. **Server-side search/filter with URL state and cacheable results.** The
   result set should not require shipping all 25,000 cards to the browser.
7. **Small DOM, no long tasks.** McMaster stays at 5,490 nodes and one 122 ms
   task on a 122-tile category page. Janosik already virtualizes; the next step
   is to stop holding all 25,000 card objects in memory.

What does **not** transfer:

- Full SSR of the interactive board. Auth, SSE, drag-and-drop, undo, and
  offline editing make full-board SSR the wrong tool. Server-render (or
  bootstrap) only the shell, summary, and first visible window.
- A CDN as a default. Janosik is self-hosted. Compression, HTTP/2, and a
  reverse proxy must work on a single box; CDN/HTTP/3 is an optional P2.
- Catalog-style full page reloads for every filter. A Kanban board must keep
  SSE, in-flight commands, scroll position, and optimistic state alive.
- One megabyte of JavaScript and hundreds of image requests. Janosik's existing
  300 KB gzip critical-path budget is the right direction; do not copy
  McMaster's catalog payload.
- Immutable caching of private board JSON. Only static assets, public shares,
  and precomputed fragments can be cached that way.

The recommended order is: **transport and first paint first**, then the
structural split. The two immediate builds are (1) compression plus ETag/304
and an explicit cache policy, and (2) an inline board skeleton plus a
stale-while-revalidate shell. Both are S-sized. The first structural
investment, summary plus first-page windows, is M/L and is what actually makes
25,000 cards fit.

---

## 2. Part A - McMaster-Carr, measured

### 2.1 Method and caveats

| Item               | Value                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Measurement window | 2026-11-10, 10:22-10:42 UTC                                                                                                         |
| Client location    | Amsterdam, NL; public IP 5.253.67.156 (AS200566)                                                                                    |
| Host               | WSL2 Ubuntu 24.04.5 on Windows 11; kernel 6.18.58.1-microsoft-standard-WSL2; 16 vCPU; 23.5 GiB RAM                                  |
| Network path       | Akamai edge 95.101.57.52 (`e11663.b.akamaiedge.net`), HTTP/2, TLS                                                                   |
| Browser            | Chromium 156.0.8078.4 via Playwright 1.64.1, headless, 1600x900                                                                     |
| User agent         | Desktop Chrome 131 on Windows 10 x64                                                                                                |
| Pages              | Homepage; category `/products/screws/`; search submit to `/products/hex-bolts/`; filter `system-of-measurement~inch/`               |
| Cold               | Fresh browser context, empty HTTP cache, no service worker                                                                          |
| Warm               | Same context, full reload after the cold run settles; HTTP cache and the now-active service worker are warm                         |
| Repetitions        | One primary run per condition, with targeted follow-ups for first-grid and search marks (this is a reconnaissance, not a load test) |
| Load volume        | Roughly twenty page loads and one screenshot in total; no scraping or load generation                                               |

Timing data comes from the Navigation Timing and Paint Timing APIs. LCP, CLS,
and long tasks come from `PerformanceObserver` instances injected before the
document started. Transfer bytes come from the Chrome DevTools Protocol
(`Network.loadingFinished.encodedDataLength`), not from Resource Timing:
cross-origin entries hide `transferSize` without `Timing-Allow-Origin`, so
Resource Timing undercounted the category page by more than an order of
magnitude in a first pass. Request counts also come from CDP. DOM node count is
`document.getElementsByTagName("*").length`.

Pages were allowed to settle for 3.5 s cold and 2.5 s warm. Waiting for
`networkidle` is not useful on McMaster: analytics beacons keep polling, and
the product fragments arrive after `load`. "Load" in the tables is therefore the
browser load event, not "everything the user sees is ready". The category page
gets a separate "first grid content" mark, measured by a mutation observer on
the first populated product-count element. That count ("9,922 products") is a
proxy for grid data readiness, not a pixel-level paint mark.

Caveats:

- The CDN edge is close (Amsterdam) and the connection was unthrottled. These
  are close to best-case European desktop numbers, not a global median.
- One sample per condition. McMaster runs experiments and may vary markup,
  bundle hashes, and fragment endpoints by geography or bucket.
- The WSL2 client adds a small amount of NAT overhead. It does not change the
  cold/warm comparison.
- LCP is misleading on this site: the LCP element was the bottom navigation
  container, not the product grid. The grid appears later. That is why the
  category row also reports first grid content.
- Six to nineteen requests failed or were canceled in each run, almost all
  tracking beacons. They are not user-facing.
- Two direct-to-filter/search loads returned the JavaScript shell without
  populating the grid in headless. Those runs were excluded. The interaction
  numbers are therefore ranges from rendered runs, not a benchmark; the page
  shell timings are stable.
- The service worker was inspected separately with
  `navigator.serviceWorker.getRegistrations()` and `caches.keys()`.

Headless Chromium was not blocked. The rendered category page contained 122
product families, 489 images, and the full filter sidebar; a screenshot
confirmed it was the real catalog, not a bot shell.

### 2.2 Timing

| Page / mode           |   TTFB |    FCP |    LCP |    DCL |   Load | First grid content | Longest task / TBT |   CLS | DOM nodes |
| --------------------- | -----: | -----: | -----: | -----: | -----: | -----------------: | -----------------: | ----: | --------: |
| Homepage, cold        | 269 ms | 376 ms | 376 ms | 298 ms | 763 ms |                  - |     123 ms / 73 ms | 0.031 |       403 |
| Homepage, warm reload |  37 ms |  92 ms |  92 ms |  61 ms | 310 ms |                  - |        0 ms / 0 ms | 0.030 |       403 |
| Category, cold        | 279 ms | 400 ms | 400 ms | 320 ms | 658 ms |             968 ms |     122 ms / 72 ms |     0 |     5,490 |
| Category, warm reload | 162 ms | 204 ms | 220 ms | 201 ms | 271 ms |             447 ms |       57 ms / 7 ms |     0 |     5,490 |

Notes:

- The homepage LCP is the bottom navigation container, not a hero image or the
  category tiles. The page is visually complete very early.
- The category LCP is also not the product grid. The shell paints at 400 ms;
  the first product count ("9,922 products") arrives at 968 ms cold and 447 ms
  warm. That is the more honest "first meaningful content" number.
- Warm homepage TTFB of 37 ms is the service worker serving the cached shell.
  Warm category TTFB of 162 ms is a network revalidation of the HTML document:
  the category was opened directly, so no service worker controlled it. A
  root-scope worker would control a later category navigation, but it caches
  only `/`, so the category HTML would still come from the network.
- Long tasks are modest: one ~122 ms task cold on both pages, none on the warm
  homepage, one 57 ms task on the warm category page. There is no main-thread
  cliff.

### 2.3 Payload, protocol, and caching

| Page / mode    | Transfer | Requests |      JS |    CSS |  Images |  Fonts | XHR + fetch |  HTTP/2 | Content-encoding          | Cache outcome                                                                |
| -------------- | -------: | -------: | ------: | -----: | ------: | -----: | ----------: | ------: | ------------------------- | ---------------------------------------------------------------------------- |
| Homepage, cold |  1.87 MB |       98 | 1.09 MB | 168 KB |  374 KB | 109 KB |       92 KB |   94/98 | br 21, gzip 7, none 70    | HTML `no-cache`; ~60 assets 1 year immutable; SW registered, not controlling |
| Homepage, warm |    31 KB |       94 |       0 |      0 |  1.4 KB |      0 |       30 KB |   90/94 | br 20, gzip 7, none 67    | 63 from disk cache; 1 from service worker; shell from SW                     |
| Category, cold |  2.87 MB |      342 | 1.05 MB | 115 KB | 1.06 MB | 109 KB |      501 KB | 338/342 | br 16, gzip 145, none 181 | HTML `no-cache`; 304 images 1 year immutable; no SW on a direct landing      |
| Category, warm |   125 KB |      336 |       0 |      0 |       0 |      0 |       94 KB | 332/336 | br 13, gzip 145, none 178 | 80 from disk cache; HTML re-downloaded (31 KB); no 304                       |

The remaining protocol entries are `data:` URIs and two HTTP/1.1 connections
(analytics/socket endpoints), not page assets. "JS" includes a 26 KB tracking
schema bundle in addition to the application bundles.

The key cold/warm contrast:

- On the warm homepage, almost everything is a cache hit. Only 31 KB crosses
  the network, and the shell is served by the service worker. FCP is 92 ms.
- On the warm category page, 80 requests are disk-cache hits and images cost
  zero bytes. But the 31 KB HTML is downloaded again because the response is
  `cache-control: no-cache` with **no ETag or Last-Modified**, so there is no 304. The page still transfers 125 KB, mostly the document and data fragments.
- On the cold category page, 304 image requests and 1.05 MB of JavaScript are
  the bulk. HTTP/2 multiplexing and the nearby edge make that a 658 ms load;
  the shell is already visible at 400 ms.

Cache headers observed:

- HTML document: `cache-control: no-cache`, `content-encoding: br`, no ETag, no
  Last-Modified. Every visit re-downloads the document.
- Hashed scripts, styles, fonts, and images: immutable for a year
  (`max-age=31536000, immutable`; some variants use spaces or
  `no-transform`). This is why warm visits are cheap.
- Server-rendered data fragments under `/Navigate/...`:
  `public, max-age=31536000, immutable` for several HTML/JSON fragment
  endpoints. This is content-addressed catalog data, not user data.
- Tracking: `no-store` / `no-cache, no-store`.
- Protocol: HTTP/2 only; no `Alt-Svc`, no HTTP/3 in this path. Brotli for
  HTML/JS/CSS, gzip for many SVG fragments, no compression for PNG/WOFF2.

### 2.4 Search and filter: how fast the interaction feels

| Interaction                          | What happened                                                                         |                                                                          Time | Notes                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------ |
| Search "hex bolt" from warm homepage | Full navigation to `/products/hex-bolts/`; 93 product blocks                          |                           FCP 324 ms; first product count 627 ms; load 358 ms | 400 ms of human typing pause is excluded. A direct cold search load was FCP 492 ms, first product 1.55 s, 3.93 MB. |
| Filter "Inch" on warm category       | Full navigation to `/products/screws/system-of-measurement~inch/`; 110 product blocks | 505 ms click-to-grid blocks; first product count 639 ms on a direct warm load | No SPA transition; URL is shareable and Back works.                                                                |
| Repeat category visit                | Warm reload                                                                           |                                                          First grid at 447 ms | Shell FCP 204 ms; data is the remaining cost.                                                                      |
| First category visit                 | Cold load                                                                             |                                                          First grid at 968 ms | Shell FCP 400 ms; data round trip is the gap.                                                                      |

Both interactions show the same shape: the shell paints at 200-320 ms, and the
product data arrives roughly 0.3-1.0 s later (627-639 ms warm, 1.55 s cold).
That gap between "the page looks loaded" and "the results are actually there"
is exactly the gap Janosik must close with a summary plus first-page bootstrap.
The lesson is not "copy the full navigation"; it is **prefetch the data the
user is about to need, and put the first useful data in the same response as
the shell.**

### 2.5 HTML and asset strategy

The raw HTML is not a tiny SSR document, but it is a deliberately staged one:

- Homepage HTML: 81.7 KB raw, 15 KB Brotli. Category HTML: 157 KB raw, 31 KB
  Brotli. Both include a 35.6 KB inline `<style>` block with the critical
  layout and theme CSS.
- The category head contains 16 `<script>` tags, but they are **not**
  parser-blocking. The four external bundles use `data-deferred-src` plus
  `data-deferred="mcm-init"`; the other deferred blocks are inline init/state
  scripts. Twelve of the 16 are deferred in total, and a small inline loader
  installs the external bundles after the shell. The four external bundles
  total about 1.04 MB compressed, dominated by an 892 KB main bundle. The
  JavaScript is large, but it is off the first-paint path and cached for a
  year.
- Two external stylesheets (115 KB total) exist, but the inline critical CSS
  already covers the first paint. Four WOFF2 fonts are preloaded;
  `font-display: fallback` is used. There are 17 preloads, 3 dns-prefetch
  hints, and no preconnect hint on the measured pages.
- There is no `srcset`, `<picture>`, WebP, AVIF, `loading="lazy"`, or
  `fetchpriority` in the category HTML. The site wins on image strategy by
  making images small, numerous, HTTP/2-multiplexed, and immutable - not by
  using modern responsive formats. Many of the 489 `<img>` elements are tiny
  SVG attribute icons. The product grid itself is 122 families, not 25,000
  rows.
- The shell is server-rendered; the catalog data is not. With JavaScript
  disabled, the category page is 283 nodes and 853 characters of text ending in
  "Our website requires JavaScript." The 122 product families appear only after
  the client fetches HTML/JSON fragments such as
  `Navigate/ClientRenderedSpecSearchWeb.aspx` and
  `Navigate/RetrieveCatalogPageList.aspx`.
- Pagination/infinite scroll: the measured category page renders 122 product
  families in one document. No pager was visible, and the page did not expose
  an obvious infinite-scroll sentinel in the DOM. The catalog handles its
  92,755 products by family tiles and drill-down pages, not by a 25,000-row
  list. That is a catalog pattern, not a board pattern, and it does not answer
  the "25k rows in one column" question.
- The service worker has root scope, activates after the first homepage visit,
  and in the measured session had one cache with one entry (`/`). It is a
  navigation cache, not an offline catalog. Assets are left to the HTTP cache.
- The result is a hybrid: server-rendered shell + client-rendered data +
  server-generated, immutable fragments. That is more useful to Janosik than
  either "full SSR" or "pure SPA".

### 2.6 What McMaster does not do

This matters because the site is often described as "SSR" or "tiny JS". The
measurements say otherwise:

- It does **not** server-render the product grid. The no-JS page is a shell.
- It does **not** ship a small JavaScript bundle. It ships about 1 MB of
  compressed JS on the critical page and keeps it off the first-paint path.
- It does **not** use modern responsive images or lazy loading.
- It does **not** use HTTP/3 on this path.
- It does **not** use ETag/304 for the HTML document; the document is
  re-downloaded every time.
- It does **not** keep filter/search in the SPA. Those are full navigations,
  which is acceptable for a catalog and wrong for a live board.
- It does **not** provide full offline data. The service worker measured here
  cached the shell only.

The transferable idea is the **staging**, not the individual byte counts.

### 2.7 Transfer / do-not-transfer map

| McMaster technique                          | Measured effect                                            | Janosik translation                                                       | Phase       |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| Inline critical CSS + server-rendered shell | FCP 376-400 ms cold, 92-204 ms warm                        | Inline board skeleton and critical CSS in `index.html`; React replaces it | P0          |
| Deferred scripts (`data-deferred-src`)      | Shell paints before the 1 MB bundle runs                   | Keep the entry bundle deferred; do not gate first paint on React          | P0          |
| Hashed assets, immutable 1 year             | 63-80 warm cache hits; JS/CSS at 0 bytes, images near zero | Already implemented; verify Nest and nginx both send it                   | P0 (verify) |
| Service worker caches the shell only        | Warm TTFB 37 ms, FCP 92 ms                                 | Stale-while-revalidate shell; keep entry-asset precache                   | P0          |
| Server fragments cached immutable           | Warm data still only 94 KB                                 | ETag + SWR for summary/facets; never cache private HTML at a shared edge  | P0/P1       |
| Search intent + warm shell                  | Shell FCP 324 ms, first content 627 ms                     | Prefetch summary/first page on hover, route intent, and search typing     | P0/P1       |
| Brotli + HTTP/2                             | 31 KB HTML, 2.87 MB catalog cold                           | Brotli/gzip for JSON/JS/CSS/HTML; HTTP/2 at the proxy                     | P0/P2       |
| Small DOM, no long tasks                    | 5,490 nodes, 122 ms max task                               | Keep virtualization; keep per-page JSON small; budget long tasks          | P0/P1       |
| Full page navigation per filter             | 505 ms, but loses SPA state                                | Do **not** copy; use server filter + URL state without reload             | P1          |
| 1 MB JS, 489 images, 342 requests           | Fast only because of CDN and caching                       | Do **not** copy; keep 300 KB critical JS and a small request budget       | Non-goal    |

---

## 3. Part B - Janosik at 25,000 cards

### 3.1 Assumptions and current measured state

The 25,000-card case is a product-limit change, not just a rendering tweak.
The current product cap is 12 columns x 200 cards = 2,400 cards per board. The
capacity report lifted the per-column cap only in a disposable backend. This
document assumes the limits/backend stream makes 25,000 storable and
commandable; it designs the UX for that case. It does not decide the cap.

The measured baseline comes from
`~/.janosik-dev/load/capacity-2026-11-10/REPORT.md`:

| Metric                       |  10,000 cards (measured) | 25,000 cards (linear estimate) | Basis                                       |
| ---------------------------- | -----------------------: | -----------------------------: | ------------------------------------------- |
| Board aggregate              |                  6.75 MB |                       ~16.9 MB | 2.5x cards, same 5-column shape             |
| `GET /boards/:id` p50 / p95  |             263 / 275 ms |                 ~650 / ~690 ms | Same-host, uncompressed JSON; payload-bound |
| UI first render              |                   906 ms |                     ~1.7-2.3 s | 5k -> 10k added 279 ms; parse/commit grows  |
| JS heap                      |                    95 MB |                    ~200-250 MB | 2.5x card objects plus baseline             |
| 10 concurrent opens, API RSS |                  1.48 GB |                    ~3.5-3.9 GB | Full aggregate materialized per open        |
| DOM nodes                    |                    2,013 |                         ~2,000 | Virtualization holds; no DOM growth         |
| Longest UI task              |                   184 ms |                    ~200-300 ms | JSON parse + first commit                   |
| SSE delta application        | 20 updates, 0 long tasks |                          Cheap | Deltas are small actions, not full cards    |

Important caveats:

- The 25k column is an extrapolation. It is not a benchmark and should not be
  quoted as one.
- The 10k UI numbers were taken against the Vite dev server in a disposable
  environment, not a production build. Production boot is likely faster; the
  data path and memory shape are the same.
- The capacity dataset used 500-character descriptions and no
  labels/checklists/comments/attachments. A real 25k board with metadata will
  be heavier. Treat 16.9 MB as a lower bound.
- The machine also ran the load generator, so absolute latency is conservative.
  The cold/warm and size relationships are what matter.

### 3.2 What is already good

Janosik is not starting from zero. Several of the hard parts are already in
place:

- **Virtualization works.** At 10k, only 50 cards and ~2,013 nodes are mounted;
  scroll long tasks were 0 ms in the board view. The DOM is not the problem.
- **SSE deltas are cheap.** Twenty `UPDATE_CARD` commands at 10k produced zero
  long tasks and kept the heap at 84 MB. The real-time transport is not the
  bottleneck.
- **Static assets are content-hashed and immutable.** The Vite build emits
  hashed assets, Nest sets `public, max-age=31536000, immutable` for
  `/app/assets/*`, and the nginx contract does the same.
- **The service worker precaches entry assets.** It already handles versioned
  caches, old-tab chunk fallback, and update prompts. It needs a shell-strategy
  change, not a rewrite.
- **A board skeleton exists.** `BoardShellSkeleton` already mirrors the real
  header, filter bar, columns, and card geometry. It is only rendered after
  React boots; it should also exist in the HTML shell.
- **Filter state is URL-addressable.** `?f.q=...&f.due=...` is already
  implemented, including Back/Forward. That is a strong foundation for server
  filtering and deep links.
- **Optimistic UI and a command log exist.** Mutations apply locally first,
  roll back on refusal, and travel through the command path. The UX can stay
  optimistic while the data layer changes underneath.
- **Board summaries already carry counters.** `GET /boards` returns card and
  column counts per board. That is the seed of a summary endpoint.

### 3.3 The gaps that matter for 25k

1. **No compression in the shipped path.** There is no `compression`
   middleware in the Nest app, and the checked-in nginx config does not enable
   gzip or Brotli. A 6.75 MB JSON aggregate goes over the wire as 6.75 MB. At
   25k that becomes ~17 MB. This is the largest single transport win available.
2. **The HTML shell is visually empty.** `ui/index.html` contains `<div
id="root"></div>` plus a theme preflight. Until React boots, the user sees a
   themed background, not a board. On a cold or slow connection that is the
   difference between "instant" and "is it loading?".
3. **The aggregate is all-or-nothing.** `GET /boards/:id` returns every card,
   including descriptions, checklists, links, and activity. The UI cannot paint
   until it has parsed the whole thing. At 25k, that is the first-render cost.
4. **All boards hydrate in the background.** After the active board, the
   provider fetches every remaining board's aggregate. With several large
   boards, a user pays for boards they never open. At 25k this is
   multiplicative.
5. **Filter/search run on the fully loaded board.** `filterCardIds` and
   `searchBoards` walk in-memory cards. That is fine at 2,400; at 25k it
   couples typing latency to the whole dataset. A server search endpoint
   already exists (`GET /boards/:id/search`), but the UI does not use it.
6. **Card details are already in memory.** Description, checklists, activity,
   and links ship with every card. There is no "open card, fetch detail" path
   to make cheap.
7. **No explicit API validator/cache contract.** The shell has `no-cache`, but
   there is no seq-based strong ETag and no `If-None-Match` handling for board
   payloads. A focus refetch can re-download megabytes instead of receiving a 304.
8. **Server mode is not offline for board data.** The service worker
   deliberately bypasses `/api/`; the board lives in memory. The shell may boot
   offline, but the board does not open from cache. At 25k, a real offline
   story needs IndexedDB pages, not a larger in-memory aggregate.
9. **25k memory is not a rendering problem alone.** Even with virtualization,
   holding 25k full card objects, undo history, and search indexes in the main
   thread will exceed a comfortable heap. The data model must become windowed.

### 3.4 The fast-board model

The target model has five layers:

```text
1. HTML shell        inline skeleton + critical CSS + preloads
2. Summary           board meta, columns, labels, counts, role, seq
3. Column windows    first 50 cards per column, cursor-paginated after that
4. Card detail       description/checklists/activity/links on demand
5. Live overlay      SSE actions + optimistic commands, merged into windows
```

The browser should never need the full board to paint the first screen. It
needs enough to draw the frame, the column headers, the counts, and the first
screenful of cards. Everything else is a prefetch or an on-demand fetch.

#### 3.4.1 Proposed data contract

These are shapes, not final route names:

- `GET /api/v1/boards/:id/summary` - board metadata, columns, labels,
  per-column total/matched counts, current user's role, `seq`, `updatedAt`.
  Target: under 50 KB. The full member directory is fetched separately, as it
  is today; a 2,000-member board would otherwise dominate the summary.
- `GET /api/v1/boards/:id/columns/:columnId/cards?cursor=<position,id>&limit=50`
  - ordered card summaries: id, title, labelIds, dueDate, priority, assigneeId,
    cover, attachmentCount, updatedAt, position. No description, checklists,
    activity, or links. Target: 30-60 KB per page.
- `GET /api/v1/boards/:id/cards/:cardId` - the full card, fetched when the
  dialog opens (or prefetched on hover).
- `GET /api/v1/boards/:id/search?q=...&filters=...&cursor=...` - matching card
  ids plus per-column counts. Extend the existing search endpoint rather than
  inventing a second one.
- `GET /api/v1/boards/:id/facets` - counts for the filter UI; ETag + SWR.
- Keep `GET /boards/:id` as the compatibility/export/admin aggregate. The
  board UI switches to summary + windows behind a flag; the old path remains
  for local mode, imports, and clients that need the whole document.

Cursors should be `(position, id)`, not offsets. Offset pagination shifts when
a card moves; a keyset cursor stays stable and can be indexed with
`(columnId, position, id)`. The response should carry the board `seq` so the
client can tell whether a window is still consistent with the SSE stream.

#### 3.4.2 First screen: SSR-lite before SSR

The lowest-risk way to remove the post-boot data round trip is **SSR-lite**:

1. Nest serves the app shell for `/app/board/:id`.
2. If the request has a valid session, Nest injects a JSON bootstrap block with
   the summary and the first page per column (for example 20-50 cards each).
3. The HTML paints the skeleton immediately; the entry bundle boots React
   with the bootstrap data already present.
4. React opens the SSE stream at `since=seq` and replaces the bootstrap windows
   with live data only if the seq moved.

This is not React SSR and has no hydration mismatch: the server emits JSON, the
client renders. It avoids adding an SSR runtime to a React Router SPA, and it
keeps the HTML private (`Cache-Control: private, no-store`) without a CDN
question. It also gives the browser the first useful data in the same response
as the shell. Escape `</script>` in the JSON block and keep the existing CSP
nonce/hash discipline; a JSON block is not executable, but it still must not be
able to break out of its element.

Full streamed SSR (`renderToPipeableStream`) is a later option if SSR-lite is
not enough. If it is used, render only the shell, summary, and first visible
cards; never the whole board. Auth, CSP nonces, cookie refresh, and hydration
mismatch are the reasons to defer it.

#### 3.4.3 Interaction model

- **Board switch:** paint the shell from cache, show the previous board's frame
  if possible, fetch the new summary (ETag), then first pages. Prefetch the
  summary on hover/focus in the switcher.
- **Scroll:** virtualize per column as today, but feed the virtual list from
  cursor pages. Fetch the next page at ~70% of the viewport; keep a small LRU of
  pages. Render skeleton rows for unloaded regions rather than blank space.
- **Drag and drop:** prefetch neighbor pages when a drag starts; disallow a
  drop into a page that has not loaded until the page arrives (or queue the
  move and resolve it server-side). The server stays authoritative on position.
- **Filter:** update the URL first (already supported), then fetch matching ids
  and counts. Render matching windows; keep column headers and counts stable
  while the result arrives. Optimistically highlight, reconcile on response.
- **Search:** debounce 150 ms, call the server, show ids/results; prefetch the
  top result's card detail on hover. Do not search 25k objects on the main
  thread.
- **Card open:** open the dialog with the summary fields immediately, fetch the
  full card detail in parallel, and stream comments/attachments separately.
- **Live updates:** apply SSE actions to the summary counts and any loaded
  window. If `seq` jumps, refetch the summary and the affected column pages
  instead of trying to replay an unknown gap. Ensure every frame carries a
  board id; a frame without one is dropped today, which is a correctness risk.
- **Offline:** cache the summary, last N windows, and pending commands in
  IndexedDB. On boot, show the cached board read-only with a "last synced"
  badge; queue commands and replay on reconnect. Clear the cache on logout and
  namespace it per user.

#### 3.4.4 Caching and prefetch rules

| Data                  | Cache policy                                                                                | Invalidation                                                            |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Hashed JS/CSS/fonts   | `public, max-age=31536000, immutable`                                                       | New hash on deploy                                                      |
| App shell HTML        | SW stale-while-revalidate + navigation preload; `no-cache` at origin                        | New SW version; update prompt                                           |
| Board summary         | `private, max-age=5, stale-while-revalidate=30`, strong ETag from the summary version/`seq` | SSE `seq`, command response, membership/role change, focus revalidation |
| Column page           | `private, max-age=0, must-revalidate`, ETag from page hash/version                          | SSE affecting the column, cursor invalidation                           |
| Card detail           | memory LRU + IndexedDB; `private, max-age=30, stale-while-revalidate=120`                   | `UPDATE_CARD`, comments/attachments events                              |
| Facets                | `private, max-age=30, stale-while-revalidate=120`, ETag                                     | Commands that change counts/labels                                      |
| Public snapshot share | `public, max-age=...` (immutable snapshot)                                                  | New snapshot                                                            |
| Live public share     | `private, no-cache` or short SWR                                                            | SSE                                                                     |
| SSE                   | no compression buffering, `no-transform`, `X-Accel-Buffering: no`                           | n/a                                                                     |

Prefetch only on genuine intent and only same-origin, authenticated data:

- board switcher hover/focus -> summary;
- board route intent -> summary + first page per column;
- column scroll -> next page;
- card hover/focus -> card detail;
- filter popover open -> facets;
- search typing after 2 characters/150 ms -> search results and top hit;
- idle time -> next board's summary, if the connection is not metered.

Respect `navigator.connection.saveData` and very slow effective types. Abort
prefetches when the intent changes. Never prefetch another user's data or put
private API responses in a shared HTTP cache.

### 3.5 Phased plan

#### P0 - transport, shell, and the first split (days to two weeks)

Goal: make the current board feel dramatically faster without waiting for a
data-model rewrite.

1. **Compression.** Enable Brotli and gzip for HTML, JS, CSS, JSON, and SVG.
   Precompress static assets at build time and serve the `.br`/`.gz` variant;
   compress dynamic JSON at the proxy or in Nest. Skip SSE, images, and already
   compressed media. Add `Vary: Accept-Encoding`. The immediate target is the
   6.75 MB aggregate at 10k and the ~17 MB aggregate at 25k.
2. **A real cache contract.** Keep immutable hashed assets. Add a strong,
   summary-version/seq-based ETag to the board summary and windows, honor
   `If-None-Match`, and return 304 with no body. Set `Cache-Control: private, no-cache` (or short
   SWR for counts) on private JSON. Do not put authenticated JSON in a shared
   cache.
3. **Inline board skeleton.** Move the existing `BoardShellSkeleton` geometry
   into `index.html`: header, filter bar, four columns, three card placeholders
   each, plus the themed backdrop. Keep it under a few KB and remove it when
   React mounts. This makes the first paint a board instead of an empty
   background.
4. **Stale-while-revalidate shell.** The service worker currently uses
   network-first for the shell. Serve the cached shell immediately, revalidate
   in the background, and update on the next navigation or via the existing
   update prompt. Precache the entry assets as today; keep old-cache fallback
   for old tabs.
5. **Prefetch on intent.** Prefetch the board summary on switcher hover/focus
   and on route intent. Prefetch the first page per column when the board route
   is likely. Use low priority and abort on leave.
6. **Split summary + first page.** Add the summary endpoint and a first-page
   endpoint (50 cards per column), switch the active board to them, and stop
   hydrating every other board's full aggregate in the background: summaries
   only, other boards on demand. Keep the aggregate as a fallback. This is the
   first structural change and the one that makes 25k fit in the first payload.
7. **Wire conditional GET in the client.** Send `If-None-Match` on focus and
   route revalidation; treat 304 as "keep the current state". This turns a
   multi-megabyte refresh into an empty response.
8. **Instrument the UX.** Add `performance.mark()` calls for
   `board:shell-painted`, `board:first-cards`, `board:interactive`,
   `card:open`, and `filter:applied`, and a CI budget check. Without marks,
   "feels fast" is not measurable.

Expected P0 effect: first board data payload from ~17 MB to under ~1 MB
compressed, plus the existing ~300 KB JS budget; warm first meaningful board
paint around 1-1.5 s; cold around 2.5-3 s; ten concurrent opens under ~2.5 GB.
The memory target is not fully solved until the UI stops holding full cards.

#### P1 - windowed board, server filter, SSR-lite, offline (weeks)

Goal: make 25k a first-class data size, not a tolerated one.

1. **Cursor-paginated columns.** Replace full `column.cardIds` rendering with
   `(position, id)` pages of 50. Cache pages in memory and IndexedDB; prefetch
   neighbors on scroll and drag.
2. **Card details on demand.** Move description, checklists, activity, and
   links out of the list payload. Open the summary instantly, fetch the rest;
   prefetch on hover.
3. **Server-side filter and search.** Extend `GET /boards/:id/search` with the
   existing `CardFilter` facets, return ids plus per-column counts, and add
   `pg_trgm`/GIN or Postgres FTS indexes. Cache facet counts with ETag/SWR.
4. **Keep URL state.** The `f.*` filter namespace already works. Add `view`,
   `sort`, and `cursor` where useful so a filtered, scrolled board is a
   shareable link.
5. **SSR-lite bootstrap.** Inject summary + first pages into the HTML response
   for authenticated board routes. Fall back to the SPA shell for
   unauthenticated or unsupported cases.
6. **Live overlay with gap recovery.** Apply SSE actions to summary counts and
   loaded windows; detect `seq` gaps and refetch the affected pages. Always
   carry board id and seq in the frame.
7. **Worker-side filter/sort for loaded data.** Keep a lightweight index in a
   Web Worker for instant local narrowing; reconcile with the server result
   when it arrives.
8. **Offline-first board cache.** IndexedDB for summary, pages, card detail
   LRU, and pending commands; stale-while-revalidate on boot; clear on logout;
   show staleness and conflict states.

Expected P1 effect: first board data payload under ~300 KB (on top of the
existing ~300 KB JS budget); warm first meaningful board paint under ~700 ms;
cold under ~2 s; filter under 100 ms locally and ~250 ms server p95; ten
concurrent opens under ~1.5 GB; UI heap under ~150 MB.

#### P2 - edge, HTTP/3, prefetch graph, multi-node (quarter)

1. **Optional edge/CDN for static assets and public snapshots only.** Never
   cache authenticated board HTML or JSON at a shared edge. Self-hosters
   without a CDN get the same code path via nginx/Caddy.
2. **HTTP/3 at the edge, HTTP/2 at the origin.** Do not block the product on
   HTTP/3; it is a latency bonus, not the architecture.
3. **Prefetch graph.** Learn board/column navigation patterns; prefetch the
   next likely board or page on idle. Keep the budget and cancellation rules.
4. **Worker-side global index.** Extend the P1 worker index from the loaded
   window to a cross-board/global search/sort index, with a size cap and
   incremental updates.
5. **Offline-first full board.** Background sync for commands, conflict UX,
   compressed page storage, multi-tab coordination, quota handling.
6. **Multi-node API and SSE.** Stateless API nodes, Redis pub/sub for SSE,
   shared summary/page caching, consistent seq.
7. **RUM and budgets.** Per-tenant performance telemetry, regression gates,
   and a public "fast board" budget in CI.

### 3.6 UX SLOs for 25,000 cards

Definitions:

- **Cold:** new browser profile, empty HTTP cache, no service worker, server
  warm.
- **Warm:** same profile, service worker active, HTTP cache warm, server warm.
- **WAN profile:** 40 ms RTT, 20 Mbps down / 5 Mbps up.
- **Board:** 25,000 cards, 5 columns, 500-character descriptions, 10% of cards
  with labels/checklists/comments.
- **First meaningful board paint:** the header, column headers, counts, and at
  least the first screenful of cards (10+ per visible column), not a spinner or
  an empty frame.
- **Server:** 4 vCPU / 8 GB, Postgres on the same host, production build.

| Area          | Metric                          |   P0 gate |  P1 target | Final target |
| ------------- | ------------------------------- | --------: | ---------: | -----------: |
| Cold load     | TTFB                            | <= 800 ms |  <= 500 ms |    <= 400 ms |
| Cold load     | FCP                             |  <= 1.5 s |   <= 1.0 s |    <= 800 ms |
| Cold load     | First meaningful board paint    |  <= 3.0 s |   <= 2.0 s |     <= 1.5 s |
| Cold load     | Interactive                     |  <= 4.0 s |   <= 3.0 s |     <= 2.5 s |
| Cold load     | Transfer                        | <= 2.5 MB |  <= 1.0 MB |    <= 600 KB |
| Warm load     | TTFB                            | <= 250 ms |  <= 150 ms |    <= 100 ms |
| Warm load     | FCP                             | <= 500 ms |  <= 300 ms |    <= 200 ms |
| Warm load     | LCP                             |  <= 1.2 s |   <= 1.0 s |    <= 800 ms |
| Warm load     | First meaningful board paint    |  <= 1.5 s |  <= 700 ms |    <= 500 ms |
| Warm load     | Transfer                        | <= 500 KB |  <= 200 KB |    <= 150 KB |
| Navigation    | Board switch, warm, first cards |  <= 1.0 s |  <= 800 ms |    <= 500 ms |
| Filter/search | Local keystroke -> paint        | <= 150 ms |  <= 100 ms |     <= 50 ms |
| Filter/search | Server p95                      | <= 300 ms |  <= 250 ms |    <= 150 ms |
| Scroll        | Longest task                    | <= 250 ms |  <= 200 ms |    <= 100 ms |
| Scroll        | p95 frame time                  |         - | <= 16.7 ms |   <= 16.7 ms |
| Card open     | Click -> full detail            |         - |  <= 400 ms |    <= 250 ms |
| Live          | SSE delta applied p95           | <= 150 ms |  <= 100 ms |     <= 50 ms |
| Memory        | UI JS heap                      | <= 250 MB |  <= 150 MB |    <= 120 MB |
| Memory        | API RSS, 10 concurrent opens    | <= 2.5 GB |  <= 1.5 GB |    <= 1.0 GB |
| Quality       | CLS                             |    <= 0.1 |    <= 0.05 |      <= 0.05 |
| Caching       | 304 ratio on focus refetch      |    >= 80% |     >= 90% |       >= 95% |

Why these numbers:

- McMaster's warm FCP/LCP of 92 ms is the ideal, but Janosik must authenticate
  and load private board data. A 150-300 ms warm FCP with a 700 ms first
  meaningful board paint is the realistic "instant" band. The shell, not the
  data, should own the first 200 ms.
- McMaster's first product content is 968 ms cold and 447 ms warm. Janosik's
  25k board cannot beat that on cold data, but summary + first page should get
  within roughly 2x of the warm number and under 2 s cold. A 3 s P0 gate
  acknowledges the current full-aggregate path.
- The 10-concurrent 1.5 GB target cannot be met while each open loads the full
  aggregate: the measured 10k path already uses 1.48 GB. P0 sets a 2.5 GB
  stopgap; P1's summary + page path is what makes 1.5 GB credible.
- Filtering 25k lightweight records in a worker can be under 100 ms. A server
  filter needs a trigram/FTS index to stay under 250 ms p95; without an index,
  the gate should fail rather than be waived.
- The no-long-task budget is the guard against shipping 17 MB of JSON. A 300 KB
  page parses in a few milliseconds; a 17 MB page does not.
- A 150 MB heap assumes summary and windows, not 25k full cards, and an LRU for
  card detail. It also leaves room for undo history, which must not snapshot
  the whole board on every edit.

### 3.7 Benchmark plan

Do not run this now: other streams are using the machine. This is the plan for
a dedicated, idle environment.

#### Matrix

| Dimension   | Values                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| Build       | `main` at 3031d8b, P0, P1, P2                                                    |
| Board size  | 10,000; 25,000; 25,000 with 12 columns                                           |
| Metadata    | plain (title + description); 10% with labels, checklists, comments               |
| Cache state | cold context; warm reload; service-worker-controlled second visit                |
| Network     | LAN (<1 ms, 1 Gbps); WAN (40 ms, 20/5 Mbps); optional 3G (150 ms, 1.6/0.75 Mbps) |
| Concurrency | 1, 5, 10 simultaneous board opens                                                |
| View        | board, table, filtered board, search results, open card dialog                   |
| Repetitions | 5 per cell; report median and p95; discard the first warm-up                     |

#### Metrics to capture

Timing: TTFB, FCP, LCP, DCL, load, `board:shell-painted`,
`board:first-cards`, `board:interactive`, `filter:applied`, `search:results`,
`card:open`.

Network: total transfer, request count, bytes by type, HTTP protocol,
content-encoding, cache status, 304 count/ratio, compressed vs uncompressed
variant.

Runtime: DOM nodes, mounted cards, long-task count/max/TBT, CLS, frame times
during a 5 s scroll, JS heap before/after GC, React commit durations from the
Profiler.

Server: GET p50/p95, response bytes, CPU, RSS, 10-concurrent RSS, SSE
connections, delta latency, error rate, Postgres query time for
filter/search/facets.

Correctness: card counts match the database, filter result set matches SQL,
no lost commands, no duplicate cards after reconnect, SSE gap recovery, cursor
stability while cards move.

#### Procedure

1. Seed a disposable database with the 10k/25k shapes; lift caps only in that
   environment. Never run this against the shared dev stack.
2. Build production UI and API. Serve through Nest static and, separately,
   through the nginx contract. Do not measure the Vite dev server.
3. Use the same Playwright/CDP harness and viewport as the McMaster
   measurements (1600x900, desktop UA, cold context vs warm reload). Inject
   the performance observers before navigation.
4. Capture a Chrome trace for every run; keep the JSON, trace, and screenshot
   artifacts outside the repo (for example under
   `~/.janosik-dev/ux-investigation/bench/`).
5. Run the McMaster baseline on the same client and network profile before
   each Janosik campaign. Keep it to a handful of loads and reuse the result
   across runs; do not load-test or scrape McMaster. Do not compare numbers
   taken on different days or networks without re-baselining.
6. Publish a small table per phase, not one aggregate score. A regression in
   cold TTFB and a win in warm paint are different stories.

#### Pass/fail gates

Use the SLO table above as the gate. Add these binary checks:

- P0: 25k cold first meaningful board paint <= 3.0 s; warm <= 1.5 s; transfer
  <= 2.5 MB; 10 concurrent <= 2.5 GB; no long task > 250 ms; filter <= 300 ms
  p95; zero correctness failures.
- P1: 25k warm first meaningful board paint <= 700 ms; cold <= 2.0 s; transfer
  <= 1.0 MB; 10 concurrent <= 1.5 GB; no long task > 200 ms; filter <= 100 ms
  local / <= 250 ms server p95; card open <= 400 ms; 304 ratio >= 90%.
- P2: warm LCP <= 1 s; cold <= 2 s; 10 concurrent <= 1.5 GB, with <= 1.0 GB as
  the stretch target; HTTP/3 and edge cache hit ratio reported but not required
  for self-host.
- Any regression > 10% versus the previous phase fails the gate even if the
  absolute number is still under the target.

Comparison to McMaster: use its warm/cold numbers as a reference line, not as
a pass/fail threshold. Janosik should beat McMaster on first-payload bytes
(no 2.87 MB catalog, no 489 images) and should be within a small multiple of
its warm paint time. It will not match a 92 ms warm FCP on a cold self-hosted
server without a CDN; the gate is the user-perceived board, not the CDN's
homepage.

### 3.8 Risks and non-goals

| Risk                      | Why it bites                                                                                         | Mitigation                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| SSR complexity            | React Router SPA has no server render path; auth, CSP nonces, hydration mismatch, duplicate fetching | Prefer SSR-lite (JSON bootstrap). If SSR, render shell + first window only; private/no-store; fallback to SPA shell |
| Auth leakage              | Board HTML/JSON is per-user; a shared cache or CDN would serve one user's board to another           | Per-request auth; `private, no-store` for personalized HTML; no shared edge cache for API; clear caches on logout   |
| Cache invalidation        | Summary/pages/facets go stale after commands, SSE, or reconnects                                     | Summary-version/seq ETag, SSE invalidation, gap refetch, short SWR windows, versioned SW caches                     |
| Self-host without CDN     | Brotli/HTTP2/3 may be missing; CPU is limited; TLS termination varies                                | Ship compression in the default path; document nginx/Caddy; test on 4 vCPU; make CDN optional                       |
| Multi-board hydration     | Background loading every aggregate multiplies payload and memory                                     | Load summaries only; hydrate active board; lazy-load others on intent; cancel prefetch                              |
| 25k memory                | Full card objects, undo history, search indexes, and JSON parse exceed a tab                         | Windowed pages, worker index, LRU card detail, bounded undo, avoid whole-board snapshots                            |
| Service-worker staleness  | Cached shell points at old hashed chunks after a deploy                                              | SWR + versioned cache + old-cache fallback + update prompt; never cache HTML as JS                                  |
| Drag/drop with pagination | Dropping into an unloaded page has no target order; concurrent moves can conflict                    | Prefetch neighbors on drag; server-authoritative position; queue/refuse until page loads                            |
| Filter/search consistency | Server result and local window can diverge while commands arrive                                     | Carry `seq`; reconcile on response; refetch affected pages; keep URL as source of truth                             |
| Offline conflicts         | Queued commands may conflict with server changes on reconnect                                        | Existing optimistic rollback + command log; show conflict state; last-writer/seq policy documented                  |
| Real-time scale           | SSE fan-out and reconnect storms at 25k-card boards                                                  | Per-board channels, backpressure, resume from `seq`, connection limits; companion doc owns backend capacity         |

Non-goals:

- Server-rendering all 25,000 cards or making the board crawlable.
- Requiring a CDN, HTTP/3, or a specific reverse proxy for a self-hosted install.
- Replacing Postgres or adding a separate search engine in P0/P1.
- Changing command semantics, WIP rules, or undo behavior as part of this UX
  work; the companion document owns the command path.
- Raising the 25k cap itself; that is a product/limits decision.
- A visual redesign. The skeleton must match the current board geometry, not
  introduce a new one.
- Offline editing with full conflict-free semantics beyond what the command log
  and optimistic rollback already provide; P1 is read-offline plus queued
  writes, with conflicts surfaced.

### 3.9 First two things to build

**1. Compression + ETag/304 + an explicit cache policy (S: 2-4 days).**

Enable Brotli/gzip on the shipped path, precompress static assets, add a
strong `ETag` derived from the summary version/`seq`/page version, honor
`If-None-Match`, and set `private` cache headers for board JSON. This is the
highest-ROI change because it requires no UI rewrite:

- 25k aggregate: ~16.9 MB raw -> roughly 1.5-2.5 MB gzip / ~1.2-2.0 MB Brotli
  for JSON with repeated keys. On a 20 Mbps WAN that is the difference between
  ~7 s and under ~1 s of transfer.
- Warm focus refetch: multi-megabyte body -> 304 with no body.
- Risk: low. The main care points are SSE (no buffering/compression), `Vary:
Accept-Encoding`, and distinct ETags for compressed/uncompressed variants.

**2. Inline board skeleton + stale-while-revalidate shell (S: 2-3 days).**

Put the existing board geometry into the HTML response and serve the cached
shell immediately on repeat visits. The user sees a board frame before React,
auth, or data:

- Warm first paint: from "blank until JS boots" to a board skeleton in well
  under 200 ms.
- Cold first paint: a board-shaped frame at HTML paint time, with minimal
  layout shift when the real board replaces it.
- Risk: low to medium. Keep the skeleton geometry in sync with the real
  `BoardShellSkeleton`; do not cache personalized HTML in a shared cache; keep
  the current update prompt and old-cache fallback.

**The next structural investment (M/L: 1-2 weeks):** summary + first-page
windows. It is not one of the two immediate builds because it touches the API,
the client state model, and the tests. But it is the change that actually makes
25k fit: first board data payload from ~17 MB to a few hundred KB, first
meaningful board paint under a second, and ten concurrent opens under 1.5 GB.
If only one structural item can be funded after the two quick wins, fund this
one.

---

## 4. Appendix - raw notes and reproducibility

Artifacts from the McMaster reconnaissance (not committed; outside the repo):

- `~/.janosik-dev/ux-investigation/measurements.json` - cold/warm page metrics,
  network summaries, cache headers, DOM/long-task/CLS data.
- `~/.janosik-dev/ux-investigation/inspect.json` - request-level category
  breakdown, top transfers, resource timeline, service worker details.
- `~/.janosik-dev/ux-investigation/sw.json` - service worker registration,
  controller, cache keys/entries before and after reload.
- `~/.janosik-dev/ux-investigation/headers.txt` - document response headers.
- `~/.janosik-dev/ux-investigation/category.png` - rendered category screenshot.

Janosik capacity source:
`~/.janosik-dev/load/capacity-2026-11-10/REPORT.md` (WSL, not in git).

Rounding: times are rounded to the nearest millisecond; byte counts are shown
as decimal KB/MB (1,000/1,000,000). The capacity report's MB figures are quoted
as published. The tables intentionally show one sample per cell; the benchmark
plan requires five repetitions and p95 before any SLO is treated as passed.

The companion `docs/PERF-25K-INVESTIGATION.md` should be read for the command
path, aggregate construction, database indexes, and cache architecture. This
document assumes those are being addressed; it does not re-derive them.
