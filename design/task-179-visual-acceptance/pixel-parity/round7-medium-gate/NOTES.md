# Round 7 — Medium-gate regressions (Y/Z/AA)

Captured 2026-11-17 from the disposable stack on `:5301`/`:5302`
(`janosik-pixel-db` on `127.0.0.1:5434`), freshly seeded with
`SEED_KEEP_HEARTBEATS=1`.

| Finding | Result | Evidence |
| --- | --- | --- |
| M4 duplicate partial-error banners | Fixed | `m4-sessions.png`, `m4-runs.png`, `m4-both.png`, `m4-m14-results.json`: exactly one alert in each mode. Sessions-only → sessions banner; runs-only → runs banner; both → one runs banner naming the failed boards. Retry refreshes the relevant fan-out(s). |
| Header overlap at 721–800 | Fixed | `header-results.json`, `header-721/768/800/900.png`: header overflow 0 px; title `Agent Ops Demo` is full and never crosses the Agents button; a hit test at the Agents centre always opens Agents. |
| Lost labeled Global search | Fixed | `header-1024.png`, `header-1440.png`: `Global search` label visible at 1024/1440; absent at 390. |
| Hide boundary at exactly 720 | Fixed | `header-719/720/721.png`: settings/notifications hidden at 719/720 and present at 721; `max-[720.98px]` covers 720. |
| Next pending leaves Decided | Fixed | `m14-next-pending-coherent.png`: after Next pending, Needs is `aria-pressed=true`, the pending row is `aria-current=true`, and the detail is pending. |
| Repeated “unavailable” copy | Fixed | Banner copy now reads e.g. `Some boards are unavailable. Boards: Website Relaunch. Showing the last loaded runs…`; no `Unavailable:` repetition. |
| Phone board switcher lost | Fixed | `header-390.png`: compact 44 × 44 switcher restored; title 151.7 px; Agents and Account remain 44 px; header overflow 0. |

Deliberate layout split for the board header:

- ≤720 px: title + board switcher + Agents + Account; other chrome hidden.
- 721–1023 px: title + switcher + notifications + settings + icon-only search
  + Agents + Account; undo/redo/data/members/share/help wait for the full
  header.
- ≥1024 px: labeled Global search, undo/redo, data, members/share.
- ≥1200 px: help menu and presence stack.

This keeps the title readable and the primary actions hit-testable without
reintroducing the tablet overlap. The e2e regression test
`e2e/tests/app/agents/design-a11y.spec.ts` walks 390/719/720/721/768/800/900/
1024/1440 and asserts hit tests, overflow, title/Agent separation, the 720
boundary and the labeled-search breakpoint.
