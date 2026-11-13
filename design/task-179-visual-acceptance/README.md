# TASK-179.11 — final visual acceptance

Date: 2026-11-13.  
Reference: the tracked prototype
[`design/agent-surfaces-prototype/index.html`](../agent-surfaces-prototype/index.html)
and its screenshots, not the audit reports. Where the prototype conflicts with
the spec, the spec wins (see
[`docs/TASK-179-agent-surfaces-redesign.md`](../../docs/TASK-179-agent-surfaces-redesign.md)
§0, §3 and §11).

## Method

- Chromium (Playwright) against the Vite build of
  `feat/TASK-179.11-cleanup-docs`.
- Dark theme, `en-US`, viewports **1440×900**, **1024×900**, **390×844**.
- Deterministic local API stand-in built from the UI test `FakeServer` plus the
  read-only TASK-179 endpoints (overview, approvals, runs, policy). No
  production data, no Docker stack and no browser e2e suite was used for the
  captures. The real backend contract is exercised by the browser e2e suites in
  CI.
- Computed styles and bounding boxes were read from the live app and from the
  tracked prototype (`measurements.json` in this folder). Screenshots are
  full-viewport captures (`page.screenshot`, animations disabled).

## States

| Surface | Default (data) | Empty | Partial error |
| --- | --- | --- | --- |
| `/agents` Attention | two approvals + a stale session | `All clear` (no approvals, no stale sessions) | one board unavailable, loaded rows retained |
| `/agents` Sessions | two sessions on one board | `No agent sessions yet` + Create API key / Read docs | unavailable board marked, Retry banner, rows retained |
| `/agents` Runs | two runs, master-detail | empty state + Clear filters | covered by the Sessions partial-error regression (same fan-out) |
| Board Agent Control | Inbox / Live / Runs | empty states per panel | existing 166.17 retention guard |
| Board Settings → Agents & automation | safe defaults, 8 triggers, limits | — | CAS banner covered by unit/e2e |

Screenshots are in [`screenshots/`](screenshots/); the filename ends with the
viewport (`-1440`, `-1024`, `-390`).

## Element comparison

`mockup` = tracked prototype (DOM/CSS measurement at true 1440, or the CSS token
where the value is static). `app` = this branch, measured in Chromium.

| # | Element | Mockup | App | Status |
| --- | --- | --- | --- | --- |
| 1 | Brand wordmark | Space Grotesk 14 px / 700 / 14 px, `-0.02em` | Space Grotesk 14 px / 700 / 14 px, `-0.02em` | **match** (fixed in this PR — it had fallen back to the body stack) |
| 2 | Rail title `Agents` | Space Grotesk 17 px / 700 / 19.55 px, `-0.025em` | Space Grotesk 17 px / 700 / 19.55 px | match |
| 3 | Rail subtitle | 11 px / 400 / 15.95 px, muted `#93a4bd`, max 19ch | same | match |
| 4 | Rail tab | 34 px high, 12 px / 550 / 17.4 px, radius 6, padding 0 8 | same, selected border + 2 px primary inset | match |
| 5 | Page title | Space Grotesk 18 px / 700 / 21.6 px, `-0.025em` | Space Grotesk 18 px / 700 / 21.6 px | match |
| 6 | Page subtitle | 11.5 px / 400 / 16.675 px, muted | same | match |
| 7 | Freshness | 11 px / 400 muted; prototype shows per-board `Agent Ops 12s ago · Website 8s ago` | 11 px / 400; one `Updated Ns ago`, and `Update incomplete` on partial failure | **spec-compliant difference**: §179.2 allows one global timestamp only if it never claims freshness after a partial success; the app switches to `Update incomplete` and keeps the stale board marker |
| 8 | Refresh button | 28 px high, 11 px / 650, radius 6, padding 0 9 | same | match |
| 9 | Search input | 30 px high, 11.5 px, radius 6, padding-left 27 | same | match |
| 10 | Approval card | padding 11/12/10/14, radius 8, 3 px warning left bar, border `#24324a` | same | match |
| 11 | Approval title / sentence | 13 px / 650 / 1.35; 11.5 px / 400 / 1.5 | same | match |
| 12 | Approval actions | 28 px desktop, 44 px mobile, hash hidden at 390 | same | match (mobile hash hidden in this PR) |
| 13 | Detail panel | 352 px wide at 1440, hairline left border, 13 px / 650 title | 352 px, same border/bg mix, 13 px / 650 | match |
| 14 | Modal shell | 1120×760 at 1440, radius 11, border `#24324a` | 1120×760, radius 11 | match |
| 15 | Modal header | title 16 px / 700 Space Grotesk, 32 px bot tile, 22 px status chips | same | match |
| 16 | Modal rail | 206 px wide, tabs 38 px, 12 px / 550 | same | match |
| 17 | Modal footer | 50 px desktop, 56 px mobile, helper left / actions right | same | match |
| 18 | Live status card | icon + text + actions; mobile wraps actions below the copy | same after this PR’s mobile rule | **fixed**: actions previously squeezed the copy into a 13 px column at 390 |
| 19 | Run detail footer | helper on its own line, action row below | same after this PR | **fixed**: at 352 px the one-row footer crushed the helper into a 70 px column at 1440 |
| 20 | Settings dialog | 1040×756 at 1440, radius 11 | 1040×756, radius 11 | match |
| 21 | Settings title / rail | 17 px / 700 display; rail 194 px, tabs 38 px | same | match |
| 22 | Settings columns | destructive radio cards + 2-column limits, full-width trigger grid, sticky footer | same; extra policy trigger rows are data-driven (`requireApprovalFor` is 8 actions) | match |
| 23 | Colors | background `#0b1220`, surface `#172033`, border `#24324a`, primary `#3b82f6`, warning `#f59e0b`, success `#10b981`, danger `#ef4444` | same tokens | match |
| 24 | Typography floor | 11–18 px; RU headings use the body stack (no Cyrillic in Space Grotesk) | same; `html[lang="ru"] .font-agent-display` falls back | match |

No element in the accepted surfaces is missing. The intentional content
differences are data-driven (real board/token/run names, the number of policy
triggers, TTL values) and do not change layout metrics.

## Responsive checks

| Check | 1440 | 1024 | 390 |
| --- | --- | --- | --- |
| `/agents` rail + main + detail | 3 columns | rail + main, detail hidden until a row is selected | stacked rail/main, one scroll |
| Board modal | 1120 px centred, below header | sheet below the real 56 px header | full-screen, close 44 px, rail tabs 44 px |
| Board Settings | 1040 px centred | sheet below header | full-screen, horizontal rail, sticky footer |
| Horizontal overflow | none | none | none |
| Console errors | none | none | none (only the deliberate 500 responses in the partial-error state) |
| Touch targets | — | — | refresh, approval actions, Live actions, rail tabs, close, footer confirms ≥44 px |

The `390` captures are single-scroll screenshots; the content below the fold is
reached by scrolling the page or the modal body, not by a second pane. The
`agents-sessions-partial-390` capture shows the retained rows and the Retry
banner with no horizontal overflow.

## Fixes made during acceptance

1. **Wordmark face**: the `/agents` wordmark rendered in the body stack; it now
   uses the Space Grotesk display face from the prototype. The header unit test
   pins the new expectation.
2. **Live status card at 390**: the fixed action cluster squeezed the copy into
   a one-character column and overlapped the buttons. The card now wraps and
   puts the actions on their own row, matching the prototype’s mobile layer.
3. **Run detail footer**: the one-row footer crushed the helper at 352 px. It
   now stacks the helper above the action row, like the prototype’s
   `.detail-foot`.
4. **Approval hash at 390**: hidden on mobile as in the prototype; desktop
   keeps the copyable hash in the detail.
5. **Approval custom copy**: a `custom` request no longer appends the
   destructive/done extra sentence to the list card.

## Remaining notes

- The prototype’s default Attention state pre-selects an approval and shows its
  detail. The app only opens a detail from `?approval=` (or a click), which
  keeps the URL the single source of truth and avoids an orphan sheet on
  mobile. This is a behaviour choice, not a missing element: the no-selection
  pane is the documented state and detail renders on selection.
- Existing focus/return, reduced-motion, 44 px and keyboard acceptance is
  covered by `e2e/tests/app/agents/design-a11y.spec.ts` and is not duplicated
  here. The browser suite runs in CI; this folder is the visual evidence.
