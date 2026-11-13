# TASK-179 — `/agents` Empty-state element audit

**Scope.** One `/agents` surface with no sessions, approvals or runs (a fresh
ADMIN test account on three empty boards). Default-data and partial-error states
are out of scope for this pass.

**Sources of truth.**

- Visual: `design/agent-surfaces-prototype/index.html`, prototype state
  `Empty`, light theme, device widths 1440 / 1024 / 390.
- Measurements: `getBoundingClientRect()` + `getComputedStyle()` for every row
  below, captured from the prototype and from the running branch at the same
  viewport. Screenshots: `.tmp-shots/empty-{attention,sessions,runs}-{width}.png`
  and `.tmp-shots/proto-empty-*` (local evidence, not committed).

**Rules.** A missing element, or a different font size/weight/position, is
blocking. Two deliberate exceptions are marked below: the app-wide header height
(requested in the feedback) and the 11 px type floor enforced by
`design-system.test.ts`; the prototype's 10.5 px mobile subtitle therefore
renders at 11 px.

## 1440 × 900

| Element | Mockup | App | Status |
| --- | --- | --- | --- |
| Header container | 52 px high, `padding: 0 14px`, `gap: 10px`, border-bottom, surface 72 % | 56 px high (app-wide header; item 7), same padding/gap/border/background | Match (intentional height) |
| Wordmark “Janosik” | Space Grotesk 14/700, 52×14, tracking −0.02 em | App body stack 14/700, 55×14 (item 8: app font, not display) | Match (intentional face) |
| Header board scope | 30 px, 13/600, `padding: 0 8px`, gap 6, radius 6, transparent border, surface on hover | Same | Match |
| Header breadcrumb | `chevron-right` + `Agents` 12/500 | `Agents` 12/500, no chevron (item 6) | Match (intentional removal) |
| “Global view” badge | 23 px, 11/400, `padding: 0 7px`, gap 5, radius 5, primary 7 % fill / 24 % border | Same | Match |
| Header actions | Search, bell, Agents pill (30 px, 11.5/600, icon 15, radius 6, primary 7 %), 26 px avatar | Same; avatar 26 px | Match |
| Rail | 222 px wide, `padding: 14px 10px 12px`, surface 58 % | Same; height fills the 900 px frame | Match |
| Rail title “Agents” | Space Grotesk 17/700, lh 1.15, tracking −0.025 em; x = 16, y = 14 from rail top | Same | Match |
| Rail tagline | 11/400, lh 1.45, `max-width: 19ch` | Same | Match |
| Rail tabs | 34 px high, 12/550, gap 8, `padding: 0 8px`, icon 14, radius 6; selected = surface + border + inset 2 px primary | Same | Match |
| “Boards / Pending” label | 11/650, uppercase, tracking 0.07 em, `padding: 0 8px 5px` | Same | Match |
| Board rows | 32 px, 11.5/400, `padding: 0 8px`, gap 7, radius 6; active hover-64 % / border-72 % | Same | Match |
| Rail footer | 11/400, lh 1.5; “Manage tokens” 11/600 with 11 px arrow-up-right icon | Same | Match |
| Main inner | max-width 980, `padding: 16px 18px 24px` | Same | Match |
| Page title | Space Grotesk 18/700, lh 1.2, tracking −0.025 em | Same | Match |
| Page subtitle | 11.5/400, lh 1.45, muted | Same | Match |
| Freshness | 11/400, gap 6, 6 px dot | Same | Match |
| Refresh | 28 px, 11/650, `padding: 0 9px`, gap 6, radius 6, surface 65 %, border | Same | Match |
| Section extra | “Manage tokens” / “Clear all” 28 px, 11/650, muted, radius 6 | Same; both 28 px and visible on every width | Match |
| Search | 340 px wide, 30 px, 11.5/400, `padding: 0 9px 0 27px`, radius 6, surface 38 %, 13 px icon | Same | Match |
| Agent/status selects | 28 px, 11/400, `padding: 0 8px`, gap 6, radius 5, surface 65 %, border | Same | Match |
| Board filter chip | 106×28, 11/400, `padding: 0 8px`, gap 5, radius 6, surface 58 %, folder icon 12 | Same | Match |
| Runs filters | Five selects (status, kind, time, agent, session), no board chip; “0 runs shown” 11/400 right | Same five selects; board scope stays in the header (item 12); total right | Match |
| Attention “All clear” | 52 px, `padding: 9px 11px`, gap 10, radius 8, success 5 % fill / 28 % border; 30 px icon, title 11.5/650, body 10.5/1.45; ghost button 28/11/650 | Same; body 11/1.45 (11 px floor) | Match (0.5 px type floor) |
| Sessions empty block | `min-height: 240px`, `padding: 32px 24px`, gap 10; icon 38/radius 9 on surface; title 13/650 lh 1.45; body 11.5/1.55 max 42ch; actions gap 7, top 4 | Same | Match |
| Sessions empty actions | Create API key (primary 28/11/650), Read docs (outline 28/11/650), plus demo-only “Show demo data” | Create API key + Read docs, 28/11/650, radius 6; demo-only control intentionally absent (would fabricate data) | Match (demo control excluded) |
| Runs empty block | Same box as Sessions; history icon; title “No runs yet”; body 11.5/1.55 | Same | Match |
| Runs empty actions | Clear filters (outline 28/11/650), How rollback works (ghost 28/11/650, muted) | Same; rollback is muted and smaller (items 14–15) | Match |
| Detail panel | 352 px, surface 48 %, left border | Same | Match |
| Detail head | `padding: 12px 14px 8px`, gap 8, bottom border; eyebrow 11/650 uppercase tracking 0.07, h2 13/650 lh 1.35 | Same | Match |
| Detail empty | 34 px icon radius 8 on surface, gap 8, `padding: 28px`; title 12/650 lh 1.45; body 11/1.5 max 30ch | Same | Match |
| Detail action | Create API key primary 28/11/650, fill #1d4ed8 (light) | Same | Match |
| “No active selection” h2 | 13/650 | 13/650 (item 1) | Match |
| Empty detail copy | “No sessions to inspect” + “Create an API key and connect an agent…” | Same in Attention, Sessions and Runs empty states; “Select a run” placeholder removed (items 9, 16) | Match |

## 1024 × 768

| Element | Mockup | App | Status |
| --- | --- | --- | --- |
| Header | 52 px | 56 px app-wide header (item 7) | Match (intentional height) |
| Rail / main | 208 px rail, detail panel hidden, main 802 px | Same | Match |
| Page head + toolbar | Title 18/700, subtitle 11.5, search 340, five runs filters, total right | Same | Match |
| Empty blocks | Same 240 px / 38 px icon / 13/650 title / 11.5 body / 28 px buttons | Same; relative position after the toolbar is identical (icon at +146 px from the content top in both) | Match |
| Horizontal overflow | None | `scrollWidth === 1024` on Attention, Sessions and Runs | Match |

## 390 × 844

| Element | Mockup | App | Status |
| --- | --- | --- | --- |
| Header | 61 px (52 min + 8 px padding), wordmark/crumb/global hidden, bell + Agents + account hidden on mobile | 56 px (app-wide `min-h-14`; item 7); wordmark/crumb/global hidden; bell + “Agents” label; account hidden | Match (intentional height) |
| Header board scope | 44 px, 13/600, radius 6 | 44 px, 13/600, radius 6 | Match |
| Header Agents pill | 44 px, bot icon + label | 44 px, bot icon + label | Match |
| Rail row | 57 px, `padding: 6px 9px`; tabs 44 px, 11/550, icon 12, radius 5, natural width | Same | Match |
| Page head | h1 17/700, subtitle 10.5/1.45, margin-bottom 9 px; actions 44 px | h1 17/700, subtitle 11/1.45 (11 px floor), margin-bottom 9 px; actions 44 px | Match (0.5 px type floor) |
| Toolbar | Search 44 px; selects 44 px; runs filters wrap 4 + 1 | Same; runs filters wrap 4 + 1 | Match |
| Sessions empty | 38 px icon, 13/650 title, 11.5 body, 28 px actions, gap 7 | Same | Match |
| Runs empty | 38 px history icon, 13/650 title, 11.5 body, 28 px Clear filters + muted How rollback works | Same | Match |
| Detail | Hidden until a row is selected | Hidden in the empty state | Match |
| Horizontal overflow | None | `scrollWidth === 390` on Attention, Sessions and Runs | Match |

## Regression notes

- `/agents?section=sessions&session=cmwdw8dnb00cyidjoyper0ppj` (deleted
  session): the DB row is gone, the list stays empty and the detail renders
  “Session unavailable” with “Clear selection”; no deleted name, plan or hash
  is resurrected from cache (items 3, 9).
- Empty sessions no longer render the heartbeat note or “Group by” toggle;
  those appear only when the scope actually has sessions, matching the
  prototype's empty branch.
- “Clear all” is rendered at every width and clears `status`, `kind`, `time`,
  `agent`, `session`, `q`, `run` and `approval` while keeping `section=runs` and
  the board scope (items 11, 12).
- Header uses one height (`min-h-14` / `sm:h-14`) on `/agents` and board routes;
  the breadcrumb chevron is gone and the wordmark uses the app body stack.
