# TASK-179 — Agent surfaces redesign

**Status:** planned  
**Priority:** P1 (IA, permissions, one entry, approvals truth), P2 (polish, mobile, docs)  
**Baseline:** `main` = `737bf08`; TASK-166.17 merged (`fb3a530`), TASK-178 merged (`360938b`).  
**Design sources (approved):**

- `design/agents-surface-redesign/REPORT.md` — `/agents` page + header audit and target IA.
- `design/agent-control-redesign/REPORT.md` — board-scoped Agent control audit and target IA.
- `design/agent-surfaces-prototype/index.html` — interactive target prototype (desktop/tablet/mobile, before/after, 44-control table); local design artifact, not part of the production bundle.
- `design/board-settings-redesign/REPORT.md` and the merged Board Settings shell — visual reference for a native Janosik modal.

This is a UI/UX refactor on top of the existing agent-control backend. Do not add new agent capabilities, change approval semantics, or create a second source of truth for sessions/approvals/runs.

---

## 1. Goal

Turn the current agent surfaces into three clear layers:

1. **`/agents`** — a global cross-board inbox: what needs a human, what is running now, what happened.
2. **Board-scoped Agent control** — one compact modal like Board Settings, with only operational work: **Inbox / Live / Runs**.
3. **Board Settings → Agents & automation** — configuration: destructive gate, limits, TTL, approver roles.

One entry, one pending count, one set of permissions. No duplicate Bot icons, no disappearing header controls, no “0 waiting” while a board has a pending approval, no MEMBER 403 trap.

## 2. Non-goals

- No new approval/pause/run semantics; reuse the shipped endpoints and DTOs.
- No new board workflow, plan/apply or token features.
- No fifth `Agents` tab in Board/Calendar/Table/Watch.
- No master-panel agent section; `/admin` remains separate.
- No full account/API-key redesign; only links needed by the empty state.
- No backend schema/migration unless a missing read-only aggregation endpoint is proven necessary.

## 3. Target IA

### 3.1 Header and entry points

- **Board header:** exactly **one** agent icon (`Agents`) for board `ADMIN`; it opens the board-scoped Agent Control modal. `MEMBER`/`VIEWER` see a read-only runs entry (same modal, runs only) as today, or the single icon with read-only content.
- **Global header/account:** exactly **one** `Agents` entry to `/agents`. Do not render a second identical Bot icon next to it.
- **Route-aware header:** on `/agents`, do not render board-scoped controls that would disappear. Either use the global header or show a clear board context with a back link; the board title/members/share/settings must not silently unmount as a side effect.
- **Counts:** the pending-approval badge is the same number in the global header, board icon, `/agents` rail and bell; `99+` when over 99.
- Icon: use the app's animated icon system if a suitable `bot`/`agents` icon exists; otherwise use one consistent Lucide-style icon across both entries. No mixed icon families.

### 3.2 `/agents` page

- Global page, not a board view tab and not a modal.
- Left rail: **Attention**, **Sessions**, **Runs**.
- Top bar: board scope combobox (`All boards` or one board), search, pending count.
- URL state: `?section=attention|sessions|runs`, `?board=<id>`, optional `?run=`/`?approval=`. Deep links must open the same view.
- Default section: **Attention**.
- Attention contains pending approvals and stale/no-heartbeat sessions, sorted by urgency/expiry.
- Sessions: board-first grouping, token grouping inside a board, master-detail.
- Runs: filters + master-detail; read-only for MEMBER/VIEWER.
- Empty/loading/partial-error/error states are explicit; a board request failure must not erase already loaded sessions.
- Mobile 390: stacked list/detail, one scroll, no horizontal overflow.

### 3.3 Board-scoped Agent control modal

- One modal, Board Settings shell: header, vertical rail **Inbox / Live / Runs**, single scroll body, sticky footer where actions need it.
- **Inbox:** approvals for this board (all statuses), detail, approve/reject, cancel request.
- **Live:** board pause/resume, session pause/resume/end, stop token/all, reason, claims/in-flight.
- **Runs:** board-scoped run history, detail, preview and revert.
- **Policy is removed from this modal.**
- ADMIN-only controls; MEMBER/VIEWER get read-only Runs (and no Inbox at all).
- Mobile: full-screen, rail tabs 44 px, close 44 px, one scroll, focus return.

### 3.4 Board Settings → Agents & automation

- New section/tab inside the merged Board Settings shell (same dialog, not a separate modal).
- Fields:
  - destructive mode: `approval` / `deny`;
  - max commands per run (1–100);
  - max cards per run (1–50);
  - approval TTL (5–1440 minutes);
  - approver roles (fixed `ADMIN` in this release, displayed read-only if not editable);
  - reset to defaults.
- Dirty footer, Save/Cancel, inline error, CAS conflict banner with **Reload**, reset confirm, permission state.
- Reuse `PolicyPanel` logic instead of duplicating policy state.

## 4. Subtasks

### 179.1 — Entry points and route-aware header (P1)

**Problem:** two identical Bot icons; one opens `/agents`, one opens the modal; navigating to `/agents` unmounts board title/members/share/settings/agent/settings controls.

**Implement:**
- Consolidate the board entry into one `AgentControlButton` with a single icon/aria-label/tooltip.
- Add one global `Agents` entry (global header right cluster or account menu) to `/agents`; remove the second Bot icon.
- Make the app header route-aware: on `/agents`, render a stable global header; do not mount board-scoped controls that disappear. If a board context is shown, keep a clear back path.
- Preserve the board gear (Board Settings) as a separate control.
- Focus returns to the actual trigger after closing the modal / navigating back.
- Badge sync: board icon, global entry, `/agents`, bell.

**Files:** `ui/src/components/Header.tsx`, `ui/src/components/agent-control/AgentControlButton.tsx`, `ui/src/App.tsx`, `ui/src/routes.ts`, `ui/src/components/agents/*`, `ui/src/components/NotificationsBell.tsx`, locales.

**Acceptance:** one agent icon in the board header; one global Agents entry; no header controls disappear on `/agents`; 1440/1024/390; keyboard/focus; no duplicate labels.

### 179.2 — `/agents` page shell and navigation (P1)

**Implement:**
- Page shell with left rail Attention/Sessions/Runs and top board scope + search.
- URL state for section/board and deep links.
- Attention/Sessions/Runs counts; one pending source.
- Loading skeleton, empty state, partial-error banner, error/retry.
- Board scope combobox: custom accessible listbox, not native `<select>`; opaque popup, z-index, keyboard, mobile 44 px rows.
- Mobile stacked layout; no horizontal overflow.

**Files:** `ui/src/components/agents/AgentsPage.tsx`, `use-agent-sessions.ts`, `agent-model.ts`, new shell/components, `ui/src/api/client.ts`, locales.

**Acceptance:** `/agents?section=attention&board=<id>` restores the view; Attention default; all sections/scope/search work; partial error keeps loaded sessions; 390 fits.

### 179.3 — Attention / approvals inbox (P1)

**Implement:**
- Attention list: pending approvals + stale sessions.
- Approval card shows agent, board, action/risk, TTL, card/session/run links.
- Detail: exact commands, plan hash, impact/diff, decision history, status.
- Actions: Approve, Reject (reason), Cancel request (requester/ADMIN), disabled after expiry/consumed.
- Status matrix: pending, approved, rejected, expired, cancelled, consumed.
- MEMBER/VIEWER: no approval tab/actions; no 403 + Retry trap.
- Refresh via SSE/poll; expired rows update without reload.

**Files:** `ApprovalsPanel` split into list/detail/shared; `AgentControlDialog`, new `/agents` Attention components, shared DTOs if a field is missing.

**Acceptance:** approve/reject/cancel change state and counts; expired Approve disabled; no MEMBER API call that 403s; deep links work.

### 179.4 — Sessions / Live (P1/P2)

**Implement:**
- Sessions grouped board-first then token; filters by board/agent/status.
- Detail: live/stale/paused/ended, last heartbeat, current card/run, expiry.
- Actions: pause session, resume, end, stop token, stop all, board pause/resume; reason input and confirmations.
- Claims/in-flight explanation; no silent claim release on pause.
- Permissions: board ADMIN only; read-only for others.
- Reuse existing agent-session endpoints; no new lifecycle semantics.

**Acceptance:** pause/resume/end/stop update UI and server; stale/live status is truthful; member cannot see admin actions; mobile and keyboard.

### 179.5 — Runs and rollback (P1/P2)

**Implement:**
- Run list filters (status/kind/token/session/board/time), cursor, total.
- Run detail: command timeline, attribution, plan/approval hash, diff/preimages.
- Preview revert; apply revert with danger confirm; conflicts/expired/read-only states.
- MEMBER/VIEWER: preview only; ADMIN applies.
- `run.reverted` refresh; deep links from `/agents` and approval.
- Reuse `RunsPanel` logic; extract shared components instead of duplicating.

**Acceptance:** filters/detail/preview/revert work; conflicts block the whole revert; permissions enforced; no dead-end error without Retry.

### 179.6 — Policy in Board Settings (P2)

**Implement:**
- New `Agents & automation` section in Board Settings, reusing `PolicyPanel`.
- Fields and bounds from TASK-166.15: destructive `approval|deny`, max commands 1–100, max cards 1–50, TTL 5–1440, approver roles `ADMIN`, reset.
- Dirty guard, Save/Cancel, inline error, CAS conflict + Reload, reset confirm.
- Remove Policy tab from Agent Control; keep a link “Open policy in Board Settings”.
- Permissions: board ADMIN only.

**Acceptance:** save/refetch/CAS/reset work; unsaved changes guarded; no dead checkboxes; policy shown in one place only.

### 179.7 — One count and permissions (P1)

**Implement:**
- One pending-approval selector/hook; use it in header, board icon, `/agents`, bell.
- Badge `99+`; no 50-row cap on the displayed count.
- MEMBER/VIEWER never see Approvals; Runs read-only; hide/disable admin actions.
- Fix the `readOnly` unreachable branch and remove the 403+Retry trap.
- Tests must mock the real forbidden response, not a successful response.

**Acceptance:** all counts agree; role matrix passes; no 403 in normal member flow.

### 179.8 — Design system, mobile, accessibility (P1/P2)

**Implement:**
- Custom combobox/listbox everywhere; no native `<select>`.
- Status badge component with dot + label, vertically aligned; consistent Applied/Reverted/Failed/Pending/Expired/Cancelled.
- Modal shell like Board Settings; vertical rail; sticky footer; single scroll; full-screen mobile.
- Typography/spacing/radii/colors from app tokens; Space Grotesk display/body stack; no AI-slop.
- `tablist` with Arrow/Home/End, focus trap/return, Escape, reduced motion, contrast AA, touch targets ≥44 px, safe-area.
- Visual comparison with `design/agent-surfaces-prototype/index.html` at 1440/1024/390.

**Acceptance:** no console errors, no horizontal overflow, focus visible, all controls reachable, badges aligned.

### 179.9 — Cleanup, docs, tests (P2)

- Remove old duplicate entry/component/route code; update imports and tests.
- Update EN/RU user guides: `/agents`, board Agent Control, Board Settings → Agents & automation, permissions.
- Add docs for the single pending count and the new IA.
- CHANGELOG entry; ROADMAP status; no stale references.
- Tests:
  - unit: count hook, permissions, status badges, combobox, tabs, policy dirty/CAS;
  - browser: admin/member/viewer, approvals all statuses, pause/live, runs/preview/revert, policy, mobile 390, focus;
  - backend only if a DTO/endpoint changes (prefer reuse).
- Visual acceptance: screenshots at 1440/1024/390 vs prototype; document deviations.

## 5. Control contract (summary)

| Control | Target behavior | Permission | Key state/test |
| --- | --- | --- | --- |
| Board scope combobox | All boards / one board; URL `?board=`; custom listbox | all authenticated | keyboard, 390, partial error |
| Search | filters agents/cards/sessions/runs | all | empty, no results |
| Attention item | opens approval/session detail | ADMIN for approval; member sees only own safe items | pending/expired |
| Approve | approves exact plan/hash | board ADMIN | success, expired, CAS/conflict |
| Reject | requires reason | board ADMIN | reason, history |
| Cancel request | requester/ADMIN | requester/ADMIN | pending only |
| Session pause/resume | pauses/resumes agent writes | board ADMIN | agent_paused, claims |
| End session | ends session/releases claims | board ADMIN | confirm, SSE |
| Stop token/all | stops writes | board ADMIN | confirm, scope |
| Board pause | pauses all board agents | board ADMIN | confirm, in-flight |
| Run filters | status/kind/token/session/time | all read | cursor/total |
| Preview revert | conflict/diff preview | all members | conflicts, expired |
| Apply revert | all-or-nothing | board ADMIN | danger confirm, SSE |
| Policy fields | destructive/limits/TTL | board ADMIN | dirty/CAS/reset |
| Agents entry | one board icon / one global link | role-aware | no duplicate |
| Pending badge | single count, `99+` | all | sync with bell/rail |

## 6. Permissions

| Capability | ADMIN | MEMBER | VIEWER |
| --- | --- | --- | --- |
| `/agents` Attention/approvals | yes | no approval actions | no |
| Approve/Reject/Cancel | yes | no | no |
| Sessions pause/resume/end | yes | no | no |
| Board pause/stop | yes | no | no |
| Runs list/detail | yes | yes | yes |
| Preview revert | yes | yes | yes |
| Apply revert | yes | no | no |
| Policy save/reset | yes | no | no |
| API-key creation link | yes | yes | yes |

## 7. Files and architecture

- `ui/src/components/agents/*` — `/agents` page, session model/hooks, Attention/Sessions/Runs.
- `ui/src/components/agent-control/*` — modal, Inbox, Live, Runs; extract shared list/detail.
- `ui/src/components/Header.tsx`, `App.tsx`, routes — one entry, route-aware header.
- `ui/src/components/board/BoardSettingsDialog.tsx` + new `AgentsAutomation` section — policy.
- `ui/src/components/ui/*` — custom combobox, badge, modal shell primitives if needed.
- `ui/src/api/client.ts`, `shared/src/api.ts` — only additive DTOs if a field is missing.
- `site/src/content/docs/{docs,ru}/...` — user guide.
- Tests alongside components + e2e/browser.

Do not duplicate run/approval/pause logic. Extract hooks/components and reuse between `/agents` and the board modal.

## 8. Rollout and risks

- No DB migration.
- Keep old URLs working: `/agents?section=...`, `?board=...`; add redirects if the old modal had deep links.
- Policy move changes discoverability: add a clear link in Agent Control and docs.
- Header restructuring is the riskiest part; test board context, mobile, and role variants.
- Modal focus/scroll on mobile; test 390 with a real browser.
- Do not remove tests; update them to the new IA and add regression coverage for every defect in the two reports.
- Visual acceptance: compare with the prototype, not only with the old screenshots.

## 9. Definition of done

- One board Agents icon and one global Agents entry; no duplicate Bot icon.
- `/agents` Attention/Sessions/Runs with board scope, search, URL state, one count, 99+.
- Board Agent Control: Inbox/Live/Runs; Policy only in Board Settings.
- MEMBER/VIEWER never see approval actions and never get 403+Retry.
- All approval/session/run/policy buttons behave as specified; no dead ends.
- 1440/1024/390 visually match the prototype; keyboard/focus/a11y pass; no horizontal overflow.
- EN/RU docs, CHANGELOG, ROADMAP; unit/browser/mobile tests green; no weakened expectations.
- No app behavior regressions outside the agent surfaces.
