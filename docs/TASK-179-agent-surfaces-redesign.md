# TASK-179 — Agent surfaces redesign

**Status:** planned; independent review accepted — §11 overrides the prototype where they still conflict  
**Priority:** P1 (IA, one entry, approvals truth, permissions, API boundary, prototype sync), P2 (runs, policy, mobile, docs)  
**Code baseline:** `main` = `fc6c3e7` (166.17 and 178 merged).  
**Spec/report commit:** `7cb0405`; current docs main `fc6c3e7`.  
**Design sources:**

- `design/agent-surfaces-prototype/index.html` — target UX after the 179.12 sync; local design artifact, tracked with this task.
- `design/agents-surface-redesign/REPORT.md` — `/agents` + header audit, evidence.
- `design/agent-control-redesign/REPORT.md` — Agent Control modal audit, evidence.
- `design/board-settings-redesign/REPORT.md` — Board Settings visual reference.
- `docs/TASK-179-independent-review.md` — independent review (2026-11-12); accepted; resolutions in §11.

## 0. Normative decision (read before §3)

The prototype is the target UX **after 179.12 syncs it with this spec**. Where
an audit report conflicts with the prototype, the prototype wins. Where the
still-unsynced prototype conflicts with §3/§4/§11, **this spec wins**; 179.12
must remove those demo-only conflicts before visual acceptance.

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
- **Per-board freshness/error:** a network failure may keep last-known rows
  with a visible stale marker + Retry; a confirmed 403/revoked/deleted board
  must remove that board’s data. One global `Updated` timestamp must not claim
  freshness after a partial success. Define a bounded fan-out/polling or
  aggregation strategy; no N-subscription explosion.
- URL contract from §3.2.
- Files: `AgentsPage.tsx`, `use-agent-sessions.ts`, `agent-model.ts`, new
  shell components, `api/client.ts`.

### 179.3 — Attention / approvals (P1)

- Attention list (approvals for ADMIN + stale sessions), filters
  `Needs / Decided / All`, counts.
- Approval card/detail: exact commands, plan hash + copy, human summary/
  targets, status, TTL/countdown, card/session/run links, decision record.
- No fabricated before/after diff or comment/attachment impact counts: use
  exact commands + human summary + known targets unless the API provides a
  timestamped snapshot. Do not promise rollback as guaranteed recovery.
- **Effective expiry:** compute `expired` from `status + expiresAt` for
  buttons, filters and counts; an open page must disable Approve when TTL
  passes without requiring a board refresh. A read-only GET must not run the
  writing expiry path; document the existing lazy expiry/notification owner.
- Approve (hash confirmation), Reject (required reason in UI; API optional),
  Cancel request (client method missing; add it), expired/consumed disabled.
- Status copy for pending/approved/rejected/expired/cancelled/consumed.
- No orphan detail after action; Retry on detail error.
- Do not change existing PAT approval visibility in this task; 179.10 is
  session-only. Flag it as a separate security decision if needed.
- Files: `ApprovalsPanel`, new shared approval components, `api/client.ts`
  (`cancelApproval`), locales, tests.

### 179.4 — Sessions / Live (P1/P2)

- Sessions grouped board-first/token; named filters; master-detail.
- Detail: keep the real lifecycle values (`active`, `idle`,
  `waiting_approval`, `completed`, `failed`, `cancelled`); pause and stale are
  separate computed fields. Show `No heartbeat · N min` separately; never
  show Active+Stale as two lifecycle statuses. Preserve old filters.
- Actions: board pause/resume (confirm + reason, single banner); session
  pause/resume/end (reason, confirm, busy/error); end releases claims; pause
  does not. Hide actions on terminal sessions.
- Remove Stop token/Stop all from board Live; `Manage tokens` link to Account.
  Show `Token settings` only for the current user’s own token; provide a
  read-only/no-link state for others.
- Claims/in-flight explanation; no release-claim action.
- Files: `PausePanel`/`LivePanel`, session hooks, shared rows, locales.

### 179.5 — Runs and rollback (P1/P2)

- Filters: status/kind/token/session/board/time; named token/session
  comboboxes; Clear filters.
- List/detail: total + load more, retry detail, applied/reverted/failed
  badges right-aligned, conflicts/expired.
- Preview revert for members; apply revert ADMIN with danger confirm and
  impact/conflicts; `run.reverted` refresh. Describe rollback as conditional:
  it can be blocked by conflicts, missing preimages or retention; do not
  promise it as guaranteed recovery.
- Preimages/diff ADMIN only; member read-only notice.
- Deep links from `/agents` and approvals must include `?board=` (or use a
  documented lookup endpoint); copy-link, refresh, back/forward and revoked
  board must be tested.
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
- Baseline/dirty, Save/Cancel, inline validation, reset disabled on defaults.
- **CAS conflict must be field-level:** keep the original base, latest server
  policy and local draft; after Reload, merge only fields the user actually
  changed. Never silently send a whole stale draft over a newer policy. If the
  same field changed on both sides, show an explicit conflict and require a
  choice. Reset has its own conflict/confirm path.
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
- **All primary touch actions ≥44 px**, not only tabs/close: refresh, end
  session, pause/resume, approve/reject, destructive confirm; keep the visual
  icon compact with a larger hit area.
- tablist arrows/Home/End, focus trap/return, reduced motion, contrast AA,
  lazy chunk fallback.
- Visual comparison with tracked prototype at 1440/1024/390.

### 179.10 — Read-only `/agents` aggregation API (P1)

- **Principal boundary:** endpoint is **session-only** (`SessionOnlyGuard`),
  because `/agents` is a human control-room page. PAT is rejected with
  `pat_forbidden`; do not fan out PAT board scope into this endpoint. If a
  future agent/MCP overview needs it, that is a separate contract.
- Use the current human user’s **accepted, non-expired memberships** per
  board. Approvals only for boards where the user is `ADMIN`; sessions/runs
  for boards where the user is `ADMIN`/`MEMBER`/`VIEWER` as currently allowed.
  Pending invites, expired/viewer-expired, revoked memberships and deleted
  boards are excluded. A read-only GET must not delete/expire memberships.
- `GET /agents/overview` (or split `approvals`/`runs`) with `boardId`,
  `section`, `q`, `status`, `kind`, `tokenId`, `sessionId`, `from`, `to`,
  `cursor`, `limit`. Define a per-section schema; do not apply one `items`
  shape to approvals, sessions and runs.
- **Effective approval status:** compute from `status + expiresAt` in one
  time slice for items, filters, totals and badges. Do **not** call the
  writing `expireOverdue` path from this read-only GET; do not create
  activity/notification/SSE from a read. Existing board endpoints keep their
  lazy-expiry behavior. The UI shows the effective `expired` state even if
  the row’s stored status is still pending/approved.
- **Ordering/cursor:** pending approvals `expiresAt ASC, id ASC`; decided
  `decidedAt DESC, id DESC`; runs/sessions stable order by their existing
  cursor keys. Sort server-side before limit/cursor. A cursor must be
  opaque and bound to the same section/filter/scope.
- Response: `items`, `nextCursor`, `total`, scope counts, `refreshedAt`,
  and display names. Display names are allowed only for boards/objects the
  caller can already see; define the disclosure policy in tests.
- No writes, no approval detail beyond existing board endpoint. If a field is
  missing in DTOs, add additive read-only fields.
- Update OpenAPI; no new MCP tool.
- Tests: session-only PAT rejection, cross-board isolation, mixed roles,
  pending/expired/revoked memberships, deleted boards, cursor/total/search,
  names disclosure, effective expiry without DB writes, sorting across
  pages.

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

### 179.12 — Sync the prototype and close the independent review (P1)

The current prototype still demonstrates four things this spec forbids; fix the
HTML/README/screenshots before visual acceptance:

- remove **Stop all / Stop token** from board Live; keep only the
  `Manage tokens` link to Account;
- remove approval count from the bell; keep it invitations-only until
  TASK-177.6;
- remove fabricated approval **before/after diff** and impact counts; show
  commands + human summary + targets only;
- remove member **Board Settings** state; gear is ADMIN-only.

Also fix the reproduced prototype bugs:

- header pending count must follow the selected board scope, not always
  `pendingCount('all')`; show unknown/stale, never a false zero on error;
- per-board role model, not one global `state.role`; demonstrate ADMIN A +
  MEMBER B;
- sort pending approvals by expiry in the demo data, not only the label;
- copy run links only with `?board=`;
- show `Token settings` only for the current user’s own token;
- make all mobile actions ≥44 px, not only tabs/close;
- per-board freshness/partial error in the demo, not one global timestamp.

Update `design/agent-surfaces-prototype/README.md` and screenshots; validate
ADMIN/MEMBER/mobile; then mark the visual DoD reproducible.

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
| Approvals list/detail | yes | no (403 server) | no | existing board behavior; not asserted by TASK-179 |
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

**PAT note:** 179.10 is session-only. Existing PAT visibility on board
approval endpoints is **not changed** by this task and must not be described
as “own” until a separate security decision/tests confirm it. Do not widen PAT
access while adding the aggregation.

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

1. **Decision/docs + 179.12** — this spec, accepted independent review, and
   a prototype synced with §3/§4/§11 (remove forbidden demo actions).
2. **179.10 + 179.8 truth/primitives** — session-only aggregation API with
   effective expiry/sorting/names, count hook, role gates, badge/combobox/
   status primitives, testid aliases.
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
- 179.12 prototype sync closed; no forbidden demo action remains; visual DoD
  reproducible from the tracked prototype.

## 11. Independent review resolutions (2026-11-12)

Source: [`docs/TASK-179-independent-review.md`](TASK-179-independent-review.md).
All findings are accepted. Where the still-unsynced prototype conflicts with
this section or §3/§4, this spec wins until 179.12 fixes the prototype.

| # | Review finding | Resolution |
| --- | --- | --- |
| 1 | Prototype contradicts spec (Stop token/all in Live, bell approval count, fabricated diff, member Board Settings) | 179.12 removes these; spec rules override the demo until then; README/screenshots updated |
| 2 | 179.10 lacks PAT/board-membership boundary | **Session-only endpoint**; accepted, non-expired memberships only; no PAT fan-out; no membership writes; same scope for items/counts/search/cursors |
| 3 | Expiry needs a no-writes contract | Compute effective status from `status + expiresAt`; read-only GET does not call writing `expireOverdue`; existing lazy expiry stays on board endpoints; UI disables Approve at TTL; activity/notification ownership documented |
| 4 | Policy Reload can overwrite another admin | Field-level CAS merge: base + server + draft; only locally changed fields applied; same-field conflict requires explicit choice; reset has separate confirm |
| 5 | Impact/rollback promises exceed data | No fabricated counts; show commands + summary + known targets; rollback described as conditional (conflicts/preimages/retention) |
| 6 | Header count ignores selected board; mixed roles not demoed | Scope-correct `usePendingApprovals`; board/All counts differ; unknown on error, not zero; per-board role in 179.12 |
| 7 | “Expires first” not sorted | Pending `expiresAt ASC, id ASC`; decided `decidedAt DESC, id DESC`; server-side before cursor/limit; stable cursor |
| 8 | PAT `own` matrix unverified | 179.10 session-only; existing board PAT approval visibility unchanged and not asserted; separate security decision if changed |
| 9 | Session statuses incomplete | Keep `active/idle/waiting_approval/completed/failed/cancelled`; pause/stale separate; preserve old filters; tests all combinations |
| 10 | Run links miss `?board=` | Copy links include board; `?run/?approval` require `?board` or lookup; test refresh/back/revoked |
| 11 | Member Live links to someone else’s token settings | Show token settings only for own token; others read-only/no link; define display-name disclosure in 179.10 |
| 12 | Mobile touch targets <44 | All primary actions ≥44 px, not only tabs/close; test 390 focus/neighbors |
| 13 | Freshness/partial errors underdefined | Per-board freshness/error; stale + Retry on network failure; remove data on confirmed 403/revoke/delete; bounded fan-out/polling |
| 14 | Search/total/schema ambiguous | Per-section schema; whitelist search fields; total before/after filter defined; no search over unauthorized data; stable cursor; tests >1 page/Cyrillic/mixed roles |

**Review-driven additions:** 179.12 prototype sync; 179.10 session-only boundary,
effective expiry, ordering/cursor and display-name policy; 179.7 field-level
merge; 179.4 full lifecycle statuses; 179.5 board-scoped run links; 179.9
44 px hit areas; 179.2 per-board freshness; 179.3 expiry/impact honesty; 179.8
scope-correct counts. A second independent review is recommended after 179.12
and 179.10 are implemented, before visual acceptance.
