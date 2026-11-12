# Agent surfaces redesign — interactive gallery

A single-file design artifact for the approved agent-surface direction:

1. **`/agents`** — a global cross-board attention inbox.
2. **Agent control** — a compact, board-scoped modal with **Inbox / Live / Runs** on a vertical rail.
3. **Board Settings → Agents & automation** — policy, limits, TTL, roles, CAS and dirty state.
4. **Before / evidence** — selected audit captures and a defect ledger.
5. **Controls table** — current → proposed → behaviour → permission → test for 44 controls.

This is design work, not product code. It does not call the Janosik API, read secrets, or change application source, tests, data or docs.

## Open it

No build step and no CDN. Everything except the evidence images and the two Space Grotesk woff2 files is embedded in `index.html`.

```bash
cd design/agent-surfaces-prototype
python3 -m http.server 4176
# open http://127.0.0.1:4176/index.html
```

Opening `index.html` directly from disk also works, but some browsers restrict clipboard/file access. The HTTP server is the recommended path.

```
design/agent-surfaces-prototype/
├── index.html                  # gallery + three live surfaces + evidence + controls table
├── evidence/                   # selected before captures and approved target mockups
├── fonts/                      # self-hosted Space Grotesk 500/700 (latin subset)
├── screenshots/                # validation captures
└── README.md
```

## What is interactive

### Gallery chrome

- **Sections** in the sidebar: `/agents`, Agent control, Board Settings, Before / evidence, Controls table.
- **Device switch**: Desktop 1440, Tablet 1024, Mobile 390. The nominal frame is fitted into the available gallery column; at a 1440 px browser viewport the desktop frame is slightly narrower, at 1920 px it renders at a true 1440 px. Mobile fits at 390.
- **Before / After**: Before shows the selected audit screenshots as evidence with captions; After shows the live proposed surface. Applies to the first three surfaces.
- **Theme**: dark default, light toggle. Tokens come from `brand/src/tokens.css`; light values are mirrored.
- **Roles**: per-board roles, not one global role. The default **Mixed** preset is ADMIN on Agent Ops Demo and MEMBER on Website Relaunch; **Admin** and **Member** presets set both boards. Scope and role changes keep counts, selected detail and the board scene in sync.
- **Demo state**: Default / Loading / Empty / Partial error for `/agents`; Default / Loading / Empty / Error for Agent control; Default / CAS conflict for Board Settings. Partial error is per board and never turns the pending count into a false zero.
- **99+**: stress-tests the single pending count in the header, rail, board icon, Agent control header and Board Settings rail. The bell is invitations-only and has no approval badge.
- **Custom comboboxes**: the board scope, agent/status filters, run filters, prototype state and approver field use one portaled ARIA combobox/listbox — no native `<select>` popups. Keyboard: arrows, Home/End, Enter, Escape, Tab, first-letter typeahead; click-outside closes; focus returns on select/Escape. Rows are 36 px on desktop and 44 px on mobile.
- **Notes**: opens the annotation drawer and numbered pins. Each section has three "defect → change" notes.
- **Reset**: restores all demo state (theme is preserved).
- **Evidence**: click any screenshot for a lightbox; filter by surface or approved target.
- **Controls table**: search, expand/collapse groups, 44 rows across four groups.

### `/agents`

- Board scope combobox (All boards, Agent Ops Demo, Website Relaunch), search, agent/status comboboxes, Clear filters. The scope note and board counts live inside the opaque listbox, not underneath it.
- Attention inbox with a pending approval and stale-session cards.
- Review plan → right detail panel; approve/reject with a required rejection reason.
- Approve changes the request status, decision history and **all pending counts** at once. The default scope has two pending approvals on Agent Ops Demo; Website Relaunch has a pending approval that is hidden while the user is MEMBER there. 99+ is a display stress test.
- Sessions are grouped by board by default; a "Group by Agent (token)" toggle demonstrates token grouping.
- Session detail has pause/resume/end. Pause asks for a reason; End releases claims.
- Runs has status/kind/time/agent/session comboboxes, run selection, timeline, command diff, technical preimages, preview, and revert with a danger confirm. Status badges use one shared mark+label component, right-aligned in a stable column across Applied / Reverted / Failed. The conflict run is disabled with an explicit reason.
- Empty sessions show **Create API key** + Read docs. The Runs demo state has loading/empty/error states.
- Deep links and a route-aware global header are indicated in the preview URL and the scope/breadcrumb. `?board=` is present for run and approval links, and copied run links always include it. Board controls intentionally do not live in the global header.

### Agent control modal

- Open from the single **Agents** button in the board mock; close with X, Escape or the scrim.
- Focus returns to the trigger; the modal has a focus trap and a role=tablist rail with arrow/Home/End keys.
- **Inbox** (ADMIN): Needs / Decided / All with true counts; all six approval statuses; exact commands, human summary, known targets, plan hash, TTL, risk, card/token/session links, decision history; sticky footer. There is no fabricated before/after diff or comment/attachment impact count. Approve asks for confirmation of the exact hash; Reject requires a reason; Cancel request has its own confirm.
- **Live**: board pause/resume with a reason and one banner; session pause/resume/end; claims/in-flight semantics; no repeated "board paused" text in every row. **No Stop token / Stop all**: the only token path is `Manage tokens` → Account → API keys. `Token settings` appears only for the current user's own token; other tokens are read-only and show “Other member's token”.
- **Runs**: named token/session filters instead of UUID text; run detail with timeline, attribution, diffs, preview and rollback; danger confirmation; conflict/expired/reverted/failed states.
- **MEMBER/VIEWER**: no Inbox tab, no approval request, no 403. Live and Runs are read-only and explain who can act.
- Mobile: the modal is full-screen inside the 390 preview, with a 44 px close, 44 px rail tabs, one pane (list → detail with Back) and a sticky footer. All primary actions are at least 44 px: refresh, pause/resume, end session, approve/reject, hash copy, related links and destructive confirm.
- A rejection draft is protected on close; a dirty rejection triggers a discard confirmation.

### Board Settings → Agents & automation

- Native settings shell with a **Workflow / Agents & automation** rail.
- Destructive mode radio cards; approval limits; TTL; approver roles; approval triggers.
- Destructive triggers are visibly "covered by destructive mode" and disabled, so there are no dead checkboxes.
- Dirty footer with Discard / Save; Save is disabled when clean.
- Close/Escape/overlay on a dirty draft opens a discard confirmation.
- **Demo state → CAS conflict** shows the conflict banner with **Reload policy**; reload keeps the draft, updates the version and clears the banner.
- Reset to defaults is disabled when the policy is already default.
- The gear is ADMIN-only. MEMBER has no Board Settings state and no read-only settings form; the scene shows a short admin-only callout instead.

## Baseline (current `main`)

- Current `main` at prototype sync: **`4a79e12`** — “fix(agents): show the mock All clear state (TASK-179.3 follow-up)”.
- Merge commit **`fb3a530`** — TASK-166.17 “Harden agent control and consolidate board display”.
- The two audit reports used the feature baseline **`c6688f3`** over **`360938b`**. Evidence screenshots in this gallery come from that audit build.

What 166.17 changed relative to the reports:

1. **Board display controls were consolidated into `BoardDisplayMenu`** (column style, density, glass). The Board/Calendar/Table/Watch `ViewSwitcher` remains. The board mock now includes the display-menu affordance; the agent IA is unaffected.
2. **`/agents` retains previously loaded sessions when one board request fails** (`use-agent-sessions.ts`, `AgentsPage.test.tsx`). A partial failure shows a per-board stale marker and a warning with Retry while keeping rows. The prototype’s **Partial error** state marks Website Relaunch unavailable, keeps Agent Ops Demo fresh, shows `—` for unknown pending counts and never presents a false zero. One global timestamp never claims both boards are fresh.
3. Backend/MCP hardening (session attribution, limits, approvals, pause, idempotency, rate limits) does not change the visual IA. All API behaviour in this gallery is synthetic.
4. **The two Bot icons and the disappearing board controls were not changed by 166.17.** Current `Header.tsx` still renders both `agents-trigger` and `AgentControlButton`; the board-settings redesign (TASK-178) is merged and used as the native modal reference. Those findings remain valid at `4a79e12`.
5. The target IA is unchanged: one global `/agents` inbox, one board-scoped Agent control, policy only in Board Settings, one Bot entry, one pending count.

## Fonts

- **Space Grotesk 500 / 700** is self-hosted from the Fontsource latin subset (`fonts/space-grotesk-500.woff2`, `space-grotesk-700.woff2`). It is used for display headings and the wordmark.
- Space Grotesk has **no Cyrillic** glyphs. Cyrillic text falls back to the app body stack:
  `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
- Product UI copy is English to match the reports; the gallery title includes the Russian “Агенты: редизайн”.

## Visual language

- Dark naval base `#0b1220`, card `#121a2e`, surface `#172033`, border `#24324a`, blue `#3b82f6`, amber `#f59e0b`, green `#10b981`, red `#ef4444`.
- One dialog surface with hairline dividers, not nested rounded cards. Rows are separated by hairlines; shadows are reserved for modal/drawer/lightbox.
- Type is 11–18 px in the product surfaces; no 10 px uppercase labels. Uppercase is used sparingly for short rail labels.
- All icons are inline SVG (Lucide-style). No emoji, no CDN, no purple gradients.
- Motion is limited to 150–200 ms state responses (dialog, drawer, toast, skeleton). `prefers-reduced-motion` disables it.

## Accessibility

- `role="tablist"` / `role="tab"` / `role="tabpanel"` for the `/agents` rail and both modal rails, with `aria-selected`, roving `tabindex`, arrow/Home/End keys.
- Comboboxes use `role="combobox"` + `role="listbox"` / `role="option"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-selected`, arrows/Home/End/Enter/Escape/Tab, and typeahead. The trigger keeps focus; the portaled listbox cannot be clipped by the header or modal.
- Visible `:focus-visible` rings.
- Focus trap in the Agent control and Board Settings modals and in confirmation dialogs; Escape closes the topmost layer.
- Agent control close/Escape returns focus to the single Agents trigger; Board Settings close/Escape returns focus to the gear. Dirty close paths confirm first.
- Touch targets: at the mobile breakpoint every primary action is at least 44 px — close, rail tabs, refresh, filters, board scope, pause/resume, end session, approve/reject, hash copy, related links, dialog confirm and sticky footer actions.
- Status is always text + colour, not colour alone. Toasts and partial errors use live/alert roles.
- Reduced motion is respected; the skeleton shimmer is removed.

## Known limitations

- **Embedded preview, not a separate browser window.** The Agent control modal fills the 390 device frame, not the whole gallery viewport. It is intended as a design preview; the real product would render it at `100dvh`.
- The nominal device frame is fitted to the available gallery column. The device chrome shows the fitted width when it is smaller than the nominal width. For a pixel-true 1440 layout, open the gallery on a wide screen (about 1920 px) and choose Desktop 1440; for a true 1024 tablet frame, choose Tablet 1024 at a 1440 px viewport.
- The board behind Agent control / Board Settings is a static board mock. The new **Board display** button opens an explanatory toast rather than a fully interactive column-style/density/glass menu.
- All data, tokens, plan hashes, sessions, runs and policy values are synthetic. No network requests are made. Account/API-key, docs, notification, member and share actions are explanatory toasts.
- State is not persisted across reloads. “Copy” uses the Clipboard API with a legacy fallback.
- Approval TTLs count down from the demo start time. The effective status is computed from `status + expiresAt`; when a pending TTL passes, Approve is disabled and the row reads Expired without mutating the stored status.
- The **Demo state → CAS conflict** switch is a simulation for reviewing the banner and Reload flow. It does not require a dirty draft; in the product CAS is reached while saving a draft.
- The evidence screenshots are captures from `c6688f3`, not regenerated on `4a79e12`. Captions call out where 166.17 changes current behaviour (partial-error retention); header and Agent-control captures remain representative of current `main`. The validation screenshots in `screenshots/` were regenerated from the synced prototype.
- The gallery is validated at 1440, 1024 and 390 CSS px in Chromium. 320 px, Safari/Firefox, screen-reader output, real touch devices and safe-area insets were not separately tested.
- The prototype does not implement real CAS, approval or rollback transport; it demonstrates the interaction model and the state transitions. The backend/MCP hardening in 166.17 is not modelled beyond the partial-error display.

## Validation

Validated with Playwright in Chromium on 13 November 2026. Captures are in `screenshots/`:

| File | What it validates |
|---|---|
| `01-gallery-1440.png` | Gallery at 1440: top bar, sidebar, stage, annotations entry |
| `02-agents-desktop-1440.png` | True 1440 `/agents` surface, custom filters, master-detail |
| `03-combobox-board-desktop.png` | Custom board-scope combobox open, opaque listbox, scope note |
| `04-combobox-board-mobile.png` | 390 board-scope combobox: 44 px rows, contained in frame |
| `05-combobox-tablet.png` | 1024 Agent filter combobox open, contained in frame |
| `06-agents-mobile-390.png` | 390 `/agents` surface with custom filter triggers |
| `07-agent-control-desktop.png` | Agent control Inbox at 1440 |
| `08-agent-control-live.png` | Live: board status, session groups, controls |
| `09-agent-control-runs.png` | Runs: custom filters, list, detail |
| `10-agent-control-mobile.png` | Full-screen 390 Agent control, list + decision hint |
| `11-settings-desktop.png` | Board Settings → Agents & automation at 1440 |
| `12-settings-mobile.png` | Full-screen 390 Board Settings |
| `13-settings-cas.png` | CAS conflict banner + Reload |
| `14-evidence-board.png` | Evidence board, baseline banner and defect ledger |
| `15-controls-table.png` | Collapsible 44-control table |
| `16-before-agents.png` | Before/After mode with audited screenshots |
| `17-member-agents.png` | MEMBER scope on Website Relaunch: no approvals, read-only session detail |
| `18-member-control.png` | MEMBER Agent control: Live/Runs only, no Inbox, no gear |
| `19-light-theme.png` | Light theme |
| `20-partial-error.png` | Per-board partial error: Website unavailable, Agent Ops fresh, retained rows |
| `21-annotations.png` | Numbered pins and review notes |
| `22-runs-badges-desktop.png` | Runs status badges right-aligned: Applied / Reverted / Failed |
| `23-runs-badges-tablet.png` | Run row alignment at 1024 |
| `24-runs-badges-mobile.png` | Run row alignment at 390 |
| `25-member-no-settings.png` | MEMBER board: gear absent, admin-only callout, no read-only settings form |
| `26-empty-sessions.png` | Empty sessions with Create API key CTA |
| `27-badge-99plus.png` | Single pending count, 99+ stress state (no bell badge) |
| `28-agent-control-statuses.png` | Pending / Rejected / Expired / Applied status badges in Inbox |
| `29-scoped-counts.png` | ADMIN on both boards: Website scope 1, All 3, Agent Ops 2 |
| `30-partial-unknown.png` | Partial error: All and Website show `—`, Agent Ops keeps its known count |
| `31-token-ownership.png` | Live: own token has Token settings, other member's token is read-only |

Checks performed:

- All five sections and all three device modes switch without errors.
- Dark and light themes; Mixed (ADMIN A + MEMBER B), Admin-on-both and Member-on-both presets; Before/After.
- **No native `<select>` remains.** Every dropdown is the custom ARIA combobox/listbox; all triggers have `aria-expanded`/`aria-controls`, options expose `role="option"` + `aria-selected`, and the active option is tracked with `aria-activedescendant`.
- Comboboxes open by mouse and by Arrow/Enter/Space; arrows/Home/End move, Enter/Space select, Escape closes and returns focus, Tab closes, click-outside closes, and first-letter typeahead works. Rows are 36 px desktop / 44 px mobile.
- Listboxes have an opaque surface at z-index 260 and are portaled to the page but bounded to the active device frame, so no text bleeds through and nothing is clipped at 1024/390.
- No console errors and no horizontal page overflow at 390, 1024 or 1440.
- Runs status badges use the same mark + label component; measured mark and label centers are 0 px off the badge center at 1440, 1024 and 390. Applied / Reverted / Failed align in a stable right column; Pending / Approved / Rejected / Expired / Cancelled / Applied were exercised in the approval flows.
- Approval approve/reject/cancel changes the status and all pending counts (header, rail, board badge, modal header, Board Settings rail). The bell never shows an approval badge.
- Scope counts are correct: ADMIN A + MEMBER B shows Agent Ops 2, Website hidden, All 2; Admin-on-both shows Agent Ops 2, Website 1, All 3. A partial error shows `—` for unknown scopes, not 0.
- Pending approvals are sorted by `expiresAt ASC, id ASC`; the two default pending rows render earliest first.
- MEMBER hides the approval card, the Agent control Inbox tab and the Board Settings gear; there is no 403/Retry trap and no read-only settings form.
- Session pause/resume/end and board pause/resume work. Board Live has no Stop token/Stop all; `Manage tokens` links to Account, and `Token settings` is shown only for the current user's own token.
- Run conflict blocks rollback; applied run rollback uses a danger confirm and updates to Reverted.
- Board Settings dirty/Save/Discard/Reset and CAS conflict/Reload preserve or discard the draft as labelled.
- Loading, empty and partial-error states switch; partial error keeps last-loaded rows, marks the unavailable board and leaves the healthy board's freshness intact.
- The empty sessions state exposes Create API key + Read docs.
- The 99+ badge appears in every count surface when stress-tested; the bell stays invitations-only.
- Escape/close in Agent control and Board Settings returns focus to the trigger; tablists support arrows/Home/End and the modal traps focus.
- At 390, every visible primary button in the app shell, Agent control modal and Board Settings modal measures at least 44 px; the same check passes for the dialog footer. The 1024 sheet starts below the 48 px board header instead of covering it.
- All 44 evidence images and both self-hosted fonts load; no external requests. The validation screenshots were regenerated on the synced prototype.
