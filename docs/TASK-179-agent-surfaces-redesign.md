# TASK-179 — Agent surfaces redesign

**Status:** planned  
**Priority:** P1 (IA, one entry, approvals truth, permissions), P2 (runs, policy, mobile, docs)  
**Code baseline:** `main` = `737bf08` (166.17 and 178 merged).  
**Spec/report commit:** `762f4da` (current `main` at the time of this revision).  
**Design sources:**

- `design/agent-surfaces-prototype/index.html` — **normative target UX** (interactive; local design artifact, tracked with this task).
- `design/agents-surface-redesign/REPORT.md` — `/agents` + header audit, evidence.
- `design/agent-control-redesign/REPORT.md` — Agent Control modal audit, evidence.
- `design/board-settings-redesign/REPORT.md` — Board Settings visual reference.

## 0. Normative decision (read before §3)

The prototype is the target UX. Where an audit report conflicts with the
prototype, the prototype wins; the reports remain evidence, not an alternative
IA.

- **Board-scoped Agent Control remains a modal:** Inbox / Live / Runs.
- **Approvals and pause do not move into Board Settings.**
- **Policy lives only in Board Settings → Agents & automation.**
- **`/agents` is the global cross-board inbox**, not a board view tab and not
  a master-panel section.
- The first report's “delete the modal and move approvals/pause into Board
  Settings” proposal is **not adopted**.
- TASK-177.14 (approval truth / empty CTA) is absorbed by 179.3/179.2.
  TASK-177.6 remains the owner of the bell/attention inbox; TASK-179 must not
  create a second bell or a fake approval count in it.

## 1. Goal

Three clear layers:

1. **`/agents`** — global cross-board inbox: Attention, Sessions, Runs; board
   scope, search, deep links, one pending count.
2. **Board-scoped Agent Control** — one modal like Board Settings, only
   operational work: Inbox / Live / Runs.
3. **Board Settings → Agents & automation** — configuration: destructive gate,
   approval triggers, limits, TTL, approver roles.

## 2. Non-goals

- No new approval/pause/run/token semantics.
- No fifth board view tab; no master-panel agent section.
- No full account/API-key redesign; only a link to Account → API keys.
- No new writes in the `/agents` aggregation endpoint (§179.10); read-only.
- No second bell; TASK-177.6 owns attention inbox.

## 3. Target IA

### 3.1 Header matrix (exact)

| Route | Header | Agent entry | Notes |
| --- | --- | --- | --- |
| `/board/:id` | Board header (title, members, share, gear) | **Exactly one Bot `Agents`** → board modal | No second Bot; no global Agents link in this header |
| `/agents` | Global header with breadcrumb `Boards / Agents` | **Exactly one Bot `Agents`** → `/agents` | No BoardTitle/Members/Share/BoardSwitcher/Settings/Presence; no Undo/Redo |
| `/agents/:tokenId` | Same global header | one Bot → `/agents` | Keep as canonical token/session deep link; do not delete |
| `/` (boards list) | Global header | one `Agents` entry in Account/global menu | No board controls |

- On a board route, `/agents` is reachable from the Agent Control rail
  **“All agents across boards”** and from Account.
- `/agents/:tokenId` is preserved (token → sessions). Do not remove it in
  cleanup; if it must change, add a documented redirect and testid alias.
- Lazy modal chunk must show a skeleton/spinner, not a dead click.
- Focus returns to the actual trigger after close/navigation.

### 3.2 `/agents` page

- Global page; left rail **Attention / Sessions / Runs**.
- Top bar: board scope combobox (`All boards` or one board), search, pending
  count, `Updated Ns ago` + Refresh, `Manage tokens` link.
- URL contract:
  - `?section=attention|sessions|runs`
  - `?board=<id>`
  - `?session=<id>`, `?agent=<tokenId>`, `?approval=<id>`, `?run=<id>`
  - `?approval` and `?run` require `?board` (or a documented lookup endpoint).
- Default: Attention. Attention = pending approvals (ADMIN) + stale sessions
  (no heartbeat); MEMBER/VIEWER see only stale sessions.
- Sessions: board-first grouping, token grouping inside a board, master-detail.
- Runs: filters + master-detail; read-only for MEMBER/VIEWER.
- Empty state: `Create API key` → Account → API keys, `Read docs`.
- Filtered-empty: `Clear filters`.
- Unknown `?board=`: clear message + recovery, not an empty trigger.
- Partial board failure: keep loaded sessions and show a warning with Retry
  (166.17 behavior; keep as regression guard).
- `<title>Agents — Janosik`; mobile 390: stacked list/detail, one scroll.

### 3.3 Board-scoped Agent Control modal

- One modal, Board Settings shell: header, vertical rail **Inbox / Live /
  Runs**, single scroll body, sticky footer where actions need it.
- **Inbox:** approvals for this board; all statuses; detail; approve/reject/
  cancel. ADMIN only.
- **Live:** board pause/resume, session pause/resume/end, claims/in-flight.
  ADMIN only. **No Stop token / Stop all here** — those are owner actions in
  Account → API keys; show a `Manage tokens` link.
- **Runs:** board-scoped runs, detail, preview, revert. Runs preview is
  available to members; apply revert is ADMIN.
- **Policy is not here.** Link “Open policy in Board Settings”.
- MEMBER/VIEWER: no Inbox; **Live and Runs are read-only**; initial tab Live.
- Mobile: full-screen, rail tabs 44 px, close 44 px, one scroll, focus return.
- 1024: modal/sheet must not cover the board header with an invisible overlay;
  test the actual header height.

### 3.4 Board Settings → Agents & automation

- Add a top-level Board Settings rail/tabs: **Workflow | Agents & automation**.
- Workflow keeps its current Columns/Matrix rail and body.
- Agents & automation:
  - destructive mode `approval | deny`;
  - `requireApprovalFor` triggers: non-destructive editable, destructive
    disabled with “covered by destructive mode”;
  - max commands 1–100, max cards 1–50, TTL 5–1440;
  - approver roles fixed `ADMIN` (read-only display);
  - `Using safe defaults` state; reset disabled on defaults.
- Dirty state is lifted to the Board Settings dialog and covers both
  Workflow and Policy; close/discard guard; Save/Cancel; inline error;
  CAS conflict + **Reload** keeps the draft.
- Gear is ADMIN-only; no member read-only Board Settings.
- Link from Agent Control closes the modal and opens Board Settings on the
  Agents & automation section.

### 3.5 Counts and scope

- One `usePendingApprovals` hook/selector, scope-correct values:
  - board icon: pending approvals for the current board (ADMIN only; hidden
    for MEMBER/VIEWER);
  - `/agents?board=X`: same as board icon;
  - `/agents` All boards: sum over boards where the user is ADMIN;
  - global header on `/agents`: same as current scope.
- `99+` on every surface; latest-100 sentinel is allowed only if the
  aggregation endpoint cannot return an exact total, with an explicit
  `99+` label.
- Bell: TASK-177.6 owns attention items; until then the bell stays
  invitations-only and must not show a fake approval count.

### 3.6 Roles

- **ADMIN:** Inbox/Live/Runs; approvals, board pause, session pause/resume/end,
  runs apply, policy.
- **MEMBER/VIEWER:** no Inbox; Live and Runs read-only; Attention only stale
  sessions; no approvals API calls. Initial tab Live.
- Per-board `boardRole`; mixed roles (ADMIN on A, MEMBER on B) must work.
- Preimages/diff: ADMIN JWT only; MEMBER/VIEWER see timeline/attribution/
  conflicts and a read-only notice.
- Token owner: token pause/stop-all in Account; not board ADMIN.

## 4. Subtasks

### 179.1 — Entry points and route-aware header (P1)

- One board Bot → modal; no second Bot; one global Agents entry.
- Global header variant for `/agents` and `/agents/:tokenId`; no board
  controls on global; no Undo/Redo for VIEWER.
- Preserve `/agents/:tokenId`; focus/lazy fallback.
- Files: `Header.tsx`, `AgentControlButton.tsx`, `App.tsx`, `routes.ts`,
  `components/agents/*`, locales.

### 179.2 — `/agents` shell (P1)

- Rail, board scope, search, updated/refresh, manage tokens, `<title>`,
  empty/filtered-empty/unknown-board/offline/partial-error.
- URL contract from §3.2.
- Files: `AgentsPage.tsx`, `use-agent-sessions.ts`, `agent-model.ts`, new
  shell components, `api/client.ts`.

### 179.3 — Attention / approvals (P1)

- Attention list (approvals for ADMIN + stale sessions), filters
  `Needs / Decided / All`, counts.
- Approval card/detail: exact commands, plan hash + copy, human summary/
  targets, status, TTL/countdown, card/session/run links, decision record.
- No fabricated before/after diff: use commands + summary unless API adds
  snapshots.
- Approve (hash confirmation), Reject (required reason in UI; API optional),
  Cancel request (client method missing; add it), expired/consumed disabled.
- Status copy for pending/approved/rejected/expired/cancelled/consumed.
- No orphan detail after action; Retry on detail error.
- Files: `ApprovalsPanel`, new shared approval components, `api/client.ts`
  (`cancelApproval`), locales, tests.

### 179.4 — Sessions / Live (P1/P2)

- Sessions grouped board-first/token; named filters; master-detail.
- Detail: lifecycle `active/waiting_approval/paused/ended` + separate
  `No heartbeat · N min`; never show Active+Stale as two statuses.
- Actions: board pause/resume (confirm + reason, single banner); session
  pause/resume/end (reason, confirm, busy/error); end releases claims; pause
  does not.
- Remove Stop token/Stop all from board Live; `Manage tokens` link to Account.
- Claims/in-flight explanation; no release-claim action.
- Files: `PausePanel`/`LivePanel`, session hooks, shared rows, locales.

### 179.5 — Runs and rollback (P1/P2)

- Filters: status/kind/token/session/board/time; named token/session
  comboboxes; Clear filters.
- List/detail: total + load more, retry detail, applied/reverted/failed
  badges right-aligned, conflicts/expired.
- Preview revert for members; apply revert ADMIN with danger confirm and
  impact/conflicts; `run.reverted` refresh.
- Preimages/diff ADMIN only; member read-only notice.
- Deep links from `/agents` and approvals.
- Files: `RunsPanel` extraction, shared run list/detail, API client.

### 179.6 — Board Settings shell (P2)

- Extract `BoardSettingsShell` with top-level `Workflow | Agents &
  automation` rail; Workflow keeps Columns/Matrix; sticky header/footer,
  single scroll, mobile.
- Lift dirty state to the dialog; close/discard guard for both sections.
- Files: `BoardSettingsDialog.tsx`, new shell, `WorkflowSettings.tsx`.

### 179.7 — Policy in Board Settings (P2)

- `AgentsAutomation` with all policy fields and `requireApprovalFor`;
  destructive triggers disabled, non-destructive editable.
- Baseline/dirty, Save/Cancel, inline validation, CAS conflict + Reload
  (keep draft), reset disabled on defaults.
- Remove Policy tab from Agent Control; add link.
- Files: `PolicyPanel`/`usePolicyDraft`, `AgentsAutomation`, DTO/save tests.

### 179.8 — Counts and permissions (P1)

- `usePendingApprovals(scope)`; board/global/All-boards counts; `99+`.
- MEMBER/VIEWER no approvals calls; Live/Runs read-only; per-board role;
  mixed-role tests.
- Replace member test that mocks a successful approvals response with
  “listApprovals is not called”; remove 403+Retry trap.
- Bell remains invitations until TASK-177.6.
- Files: hooks, `AgentControlButton`, `AgentsPage`, tests.

### 179.9 — Design system, mobile, a11y (P1/P2)

- Custom combobox/listbox everywhere; no native `<select>`; opaque popover,
  z-index, keyboard, 44 px mobile rows.
- Status badges: one component, dot + label, vertical centering; Applied/
  Reverted/Failed/Pending/Expired/Cancelled.
- Typography: Space Grotesk only for Latin display; Russian headings use the
  body stack (the display face lacks Cyrillic); sizes 11–18 px.
- Modal shell, vertical rail, full-screen 390, 1024 sheet without header
  overlay, close 44, one scroll, safe-area.
- tablist arrows/Home/End, focus trap/return, reduced motion, contrast AA,
  lazy chunk fallback.
- Visual comparison with tracked prototype at 1440/1024/390.

### 179.10 — Read-only `/agents` aggregation API (P1)

- Add read-only `GET /agents/overview` (or split `approvals`/`runs`) with
  per-board RBAC, `boardId`, `section`, `q`, `status`, `kind`, `tokenId`,
  `sessionId`, `from`, `to`, `cursor`, `limit`.
- Response: `items`, `nextCursor`, `total`, scope counts, `refreshedAt`,
  display names for board/token/session/actor.
- Approvals: ADMIN only, cursor/total; runs/sessions: member boards only;
  no writes, no approval details beyond existing board endpoint.
- If a field is missing in DTOs, add additive fields; do not change existing
  board endpoints.
- Update OpenAPI, MCP? No new MCP tool.
- Tests: cross-board isolation, ADMIN/MEMBER/VIEWER, pagination/cursor,
  names, archived boards, no write side effects.

### 179.11 — Cleanup, migration, docs, tests (P2)

- URL/testid migration table: keep `?token/?status/?time/?q`,
  `/agents/:tokenId`; add `?session/?agent/?approval/?run`; testid aliases
  for `agent-control-trigger`, `agent-runs-trigger`, `agent-control-dialog`,
  `agent-approvals-tab`, `agent-policy-tab`, `agent-run-*`.
- Remove old duplicate entry/route code; do not delete working deep links.
- EN/RU docs: `/agents`, modal Inbox/Live/Runs, Board Settings → Agents &
  automation, permissions, URL/deep links.
- CHANGELOG; ROADMAP status.
- Test matrix (see §7); visual acceptance with tracked prototype.
- No weakened tests; per-PR tests, not all at the end.

## 5. Control contract (expanded)

| Control | Target | Permission | Key state/test |
| --- | --- | --- | --- |
| Board scope combobox | All boards / one board; `?board=` | all | custom listbox, 390, unknown board |
| Search | agents/cards/sessions/runs | all | empty, clear |
| Refresh + Updated | manual refresh + freshness | all | stale, partial error |
| Manage tokens | link Account → API keys | all | empty CTA |
| Attention approval | review/approve/reject/cancel | ADMIN | statuses, hash, TTL |
| Attention stale session | open/end/resume | depending role | heartbeat, no 403 |
| Approve | hash confirm + one-use | ADMIN | expired/consumed/CAS |
| Reject | required UI reason | ADMIN | reason/history |
| Cancel request | requester/ADMIN | requester/ADMIN | confirm, client method |
| Session pause/resume | reason + confirm | ADMIN | agent_paused, claims |
| Session end | confirm; releases claims | ADMIN/owner | busy/error |
| Board pause/resume | confirm + reason, one banner | ADMIN | in-flight |
| Stop token/all | **not here**; link Account | owner | no board-admin action |
| Run filters | named token/session, status/kind/time | all read | clear, total |
| Preview revert | conflict/diff preview | members | expired/conflict |
| Apply revert | danger confirm | ADMIN | all-or-nothing, SSE |
| Policy | destructive/triggers/limits/TTL | ADMIN | dirty/CAS/reload/reset |
| Agents entry | one board icon + one global link | role-aware | no duplicate |
| Pending badge | scope-correct count, `99+` | role-aware | sync/board/All |

## 6. Permissions (corrected)

| Capability | ADMIN | MEMBER | VIEWER | PAT |
| --- | --- | --- | --- | --- |
| Approvals list/detail | yes | no (403 server) | no | own |
| Approve/Reject | yes | no | no | no |
| Cancel approval | yes | no | no | requester |
| Session list/detail | yes | yes | yes | observer+ |
| Session pause/resume | yes | no | no | no |
| Session end | yes | no | no | owner |
| Board pause/resume | yes | no | no | no |
| Stop token/all | owner | owner | owner | no |
| Runs list/detail/preview | yes | yes | yes | yes |
| Preimages/diff | yes | no | no | no |
| Apply revert | yes | no | no | no |
| Policy get/update | yes | no | no | no |
| API-key creation | yes | yes | yes | no |

## 7. Test matrix

- **Unit:** pending count per scope; role gates (no approvals call for
  member); combobox; tablist; badges; policy dirty/CAS/triggers; URL parser;
  status copy.
- **Browser ADMIN:** all approval statuses, approve/reject/cancel, expiry,
  sessions pause/resume/end, board pause, runs preview/revert, policy
  save/reset/CAS, 99+, partial error, deep links/back-forward, 390 focus.
- **Browser MEMBER/VIEWER:** no Inbox, no approval network call, Live/Runs
  read-only, no 403+Retry, mixed-role per board, 390.
- **API 179.10:** cross-board isolation, cursor/total, names, archived,
  member/viewer scopes, no writes.
- **Visual:** 1440/1024/390 vs tracked prototype; focus rings; reduced
  motion; no horizontal overflow.
- **Migration:** old URLs/testids; `/agents/:tokenId`; `?approval/?run`
  require `?board`; testid aliases.
- **Regression:** 166.17 partial-error retention; 178 Board Settings
  workflow; existing approval/pause/run/policy e2e.

## 8. Recommended PR split

1. **Decision/docs** — this spec + committed prototype/evidence.
2. **179.10 + 179.8 truth/primitives** — aggregation API, count hook,
   role gates, badge/combobox/status primitives, testid aliases.
3. **179.1 + 179.6** — route-aware header, one entry, Board Settings shell
   (separate owners due Header/BoardSettings overlap).
4. **179.2 + 179.3** — `/agents` shell + Attention/approvals.
5. **179.4** — Sessions/Live.
6. **179.5** — Runs/rollback.
7. **179.7 + 179.9 + 179.11** — Policy, visual/mobile/a11y, cleanup/docs/tests.

179.4 and 179.5 can run in parallel after shared session/run primitives.
179.7 can run parallel with 179.4/179.5 if the BoardSettings shell owner is
fixed.

## 9. Rollout and risks

- No DB migration; 179.10 adds read-only endpoints only.
- Keep old URLs/testids; add aliases for one release.
- Header restructuring is the riskiest; test board/global/mobile/roles.
- Policy move: dirty state across two sections; CAS reload must keep draft.
- Bell is not changed here; TASK-177.6 owns attention inbox.
- Prototype/evidence are tracked with this task so visual DoD is reproducible.
- No new agent capabilities; no permission widening.

## 10. Definition of done

- One board Bot + one global Agents entry; no duplicate icon; no disappearing
  header controls.
- `/agents` Attention/Sessions/Runs with board scope, search, URL state,
  refresh, empty CTA, one scope-correct count, `99+`.
- Board modal Inbox/Live/Runs; no Policy; member/viewer read-only.
- Board Settings has Workflow | Agents & automation; policy fields,
  triggers, dirty/CAS/reload/reset.
- Approvals all statuses; cancel; reject reason; expired disabled; no orphan
  detail; no fabricated diff.
- Sessions/runs actions and permissions match §6; stop token/all only in
  Account.
- 179.10 read-only aggregation with cursor/total/names and per-board RBAC.
- 1440/1024/390 match tracked prototype; a11y/focus/mobile; no horizontal
  overflow; no console errors.
- EN/RU docs, CHANGELOG, ROADMAP, testid/URL migration; unit/browser/mobile
  tests green; no weakened expectations.
