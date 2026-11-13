# TASK-179 — URL and testid migration

**Status:** accepted for TASK-179.11 (2026-11-13).  
**Scope:** every URL parameter and `data-testid` the agent surfaces exposed
before TASK-179, plus the new `/agents` master-detail contract.

The rule is simple: **old links keep working; old testids keep working or have
a documented replacement.** A removed tab cannot keep its old testid pretending
to be a tab, so the one intentional removal is called out below.

## 1. URL contract

### 1.1 `/agents` query parameters

| Parameter | Values | Status | Behaviour | Covered by |
| --- | --- | --- | --- | --- |
| `section` | `attention` \| `sessions` \| `runs` | stable (new) | Selects the rail section; absent/unknown falls back to `attention`. | `agent-model.test.ts`, `AgentsPage.test.tsx`, `e2e/tests/app/agents/agents-console.spec.ts` |
| `board` | board id \| absent = all | stable | Board scope for the page, header combobox and counts. Unknown/revoked ids render the recovery state, never an empty list. | `AgentsPage.test.tsx`, `e2e/tests/app/agents/agents-console.spec.ts`, `e2e/tests/app/agents/runs-policy.spec.ts` |
| `token` | token id | **legacy alias** | Pre-179 spelling of the token/session filter. `readAgentFilter` treats it exactly like `agent`; switching sections keeps it. | `agent-model.test.ts`, `AgentsPage.test.tsx`, `e2e/tests/app/agents/agents-console.spec.ts` |
| `agent` | token id | stable (new) | Canonical token filter. When both spellings are present, `agent` wins. | same as above |
| `status` | `all`, `live`, `stale`, session lifecycle values, run statuses in `runs` | stable | Session/run status filter; invalid values are ignored. | `agent-model.test.ts`, `AgentsPage.test.tsx` |
| `time` | `any`, `1h`, `24h`, `7d`, `30d` | stable | Last-seen window for sessions and time window for runs; invalid values are ignored. | `agent-model.test.ts`, `AgentsPage.test.tsx` |
| `q` | free text | stable | Search over the whitelisted session/run fields; trimmed by the API. | `AgentsPage.test.tsx` |
| `group` | `board` \| `token` | stable (new) | Sessions grouping switch; absent/unknown = `board`. | `agent-model.test.ts`, `AgentsPage.test.tsx` |
| `session` | session id | stable (new) | Opens the session detail. A deleted/unknown id shows the “Session unavailable” recovery, not an orphan pane. | `AgentsPage.test.tsx` |
| `approval` | approval id | stable (new) | Opens the approval detail **only with `board`**. Without `board` the page shows the documented missing-scope recovery. | `AgentsPage.test.tsx` |
| `run` | run id | stable (new) | Opens the run detail **only with `board`**. Copy-link output always includes `board`. | `AgentsPage.test.tsx`, `e2e/tests/app/agents/runs-policy.spec.ts` |

Rules:

- `?approval=` and `?run=` **require `?board=`**. There is no global lookup
  endpoint yet, so the UI must never guess the board. The recovery copy is
  shared: “Approval and run links must include a board.”
- Filters are additive and survive section switches (`?token`, `?agent`,
  `?board`, `?status`, `?time`, `?q`), except values that belong to the other
  section: switching from Runs to Sessions drops run-only `kind`/status/time
  semantics.
- A section switch closes `session`, `approval` and `run`; a board change closes
  `approval`, `run` and `session` so no detail outlives its scope.
- Unknown `?board=` keeps the message + recovery action; it does not silently
  reset to All boards.

### 1.2 Preserved deep links

| Link | Status | Behaviour |
| --- | --- | --- |
| `/agents` | stable | Global control room, default Attention. |
| `/agents/:tokenId` | **preserved canonical deep link** | Token → sessions detail. It keeps its own route, back link and focus behaviour; it is not redirected and not deleted by the master-detail work. |
| `/board/:boardId` | stable | Board route; the Agent Control modal is still reachable from the single board Bot. |
| `/agents?section=runs&board=<id>&run=<id>` | stable (new) | Copy-link, reload and back/forward keep the run detail; the link includes `board`. |
| `/agents?section=sessions&board=<id>&session=<id>` | stable (new) | Session detail from a run/approval link. |
| `/agents?section=attention&board=<id>&approval=<id>` | stable (new) | Approval detail from a link or notification. |
| `/agents/:tokenId` → `/agents` | stable | The token detail’s back control returns to the global page. |

Board-scoped Agent Control is still a modal without its own URL. The
documented deep links are the global `/agents` ones above; the modal keeps its
opener/focus contract instead of inventing a second route.

## 2. Testid contract

### 2.1 Required stable ids

These ids are part of the external test contract (browser e2e and downstream
automation). They must keep their meaning:

| Testid | Surface | Meaning |
| --- | --- | --- |
| `agent-control-trigger` | board header | ADMIN Bot entry that opens the board modal. |
| `agent-runs-trigger` | board header | MEMBER/VIEWER entry that opens the same modal on read-only Runs/Live. |
| `agent-control-dialog` | modal | The single board-scoped Agent Control dialog. |
| `agent-approvals-tab` | modal rail | Inbox tab (ADMIN only). |
| `agent-pause-tab` | modal rail | Live tab. |
| `agent-runs-tab` | modal rail | Runs tab. |
| `agent-control-all-agents` | modal | Cross-link to the global `/agents` page. |
| `agent-open-policy` | modal | Link that closes the modal and opens Board Settings → Agents & automation. |
| `agents-trigger` | global header | The one `Agents` link on `/agents` and `/agents/:tokenId`. |
| `agents-page` | `/agents` | Page shell. |
| `agents-search` | `/agents` | Search input. |
| `agents-refresh` | `/agents` | Manual refresh. |
| `agents-updated` | `/agents` | Freshness label. |
| `agents-section-attention` / `-sessions` / `-runs` | `/agents` | Rail tabs. |
| `agents-approval-card` / `agents-approval-detail` / `agents-approvals` | `/agents` Attention | Global approval list/detail. |
| `agent-run-list` / `agent-run-detail` / `agent-run-*` | modal + `/agents` Runs | One run component family; filter, detail, retry, copy, preview and revert ids are shared by both surfaces. |
| `agent-session-list` / `agent-session-row-<id>` / `agents-session-row-<id>` | token detail / `/agents` Sessions | Session list and row ids. |
| `board-settings-dialog` / `board-settings-agents` | Board Settings | Settings shell and the Agents & automation rail entry. |
| `agent-policy-*` | Board Settings | Policy fields and actions keep their TASK-166 ids. |

### 2.2 Renamed or rehomed ids

| Old testid | Status | Replacement | Reason |
| --- | --- | --- | --- |
| `agent-policy-tab` | **removed** | `agent-open-policy` (opens Board Settings) + `board-settings-agents` + `agent-policy-panel` | TASK-179.7 moved policy out of the modal. Keeping a fake “tab” id would make old automation click a link and then assert tab semantics that no longer exist. Tests must assert absence (already done in `AgentControlDialog.test.tsx`, `e2e/tests/app/agents/runs-policy.spec.ts`). |
| `agent-sessions-refresh` | renamed | `agent-live-refresh` | The Live panel owns the refresh control. |
| `agent-status-<status>` | stable | — | Kept by the shared status badge. |
| `approval-filter-<value>` | stable | — | Kept by the modal approval filters. |
| `approval-card` / `approval-detail` / `approval-queue` | stable in modal | — | The global page adds `agents-approval-*`; the modal keeps the old ids. |
| `agent-run-preimages` / `agent-run-diff` | stable | — | Still ADMIN-only; members see the read-only notice. |

New ids added in TASK-179 are additive only; no existing id was repurposed.

## 3. Verification map

| Check | Where |
| --- | --- |
| `?token=` alias, `?agent=` precedence, full legacy URL contract | `ui/src/components/agents/agent-model.test.ts` |
| `?agent=`, `?q=`, `?time=`, approval/run missing `board` | `ui/src/components/agents/AgentsPage.test.tsx` |
| `/agents/:tokenId` route is not the generic 404 | `ui/src/App.routing.test.tsx` |
| `/agents/:tokenId` + legacy `?token=` in a real browser | `e2e/tests/app/agents/agents-console.spec.ts` |
| Run copy-link/reload/back-forward and `?run` without `board` | `e2e/tests/app/agents/runs-policy.spec.ts` |
| Required modal ids, policy tab absence, member entry | `ui/src/components/agent-control/AgentControlDialog.test.tsx`, `ui/src/components/Header.agents.test.tsx`, `e2e/tests/security/agent-control.spec.ts` |
| 390/mobile and reduced motion | `e2e/tests/app/agents/design-a11y.spec.ts` |

Aliases are kept for one release per the spec (§9). Removing one requires a
follow-up task that updates this table and every test listed above.

## 4. Cleanup audit (old entry/route code)

| Old duplicate | State after 179.11 | Evidence |
| --- | --- | --- |
| Two Bot entries on a board route | Removed. `Header.tsx` renders one `AgentControlButton`; the global `agents-trigger` link exists only on `/agents`/`/agents/:tokenId`. Account keeps its explicit `account-open-agents` entry, which the spec allows. | `Header.tsx`, `Header.agents.test.tsx` (“keeps one board entry…”), `e2e/tests/security/agent-control.spec.ts` |
| A separate old agents console route | Removed. `routes.agents` (`/agents`) and `routes.agentPattern` (`/agents/:tokenId`) are the only agent routes; `/agents/:tokenId` is deliberately preserved. | `routes.ts`, `App.tsx`, `App.routing.test.tsx`, `agents-console.spec.ts` |
| Policy tab inside Agent Control | Removed. Policy lives only in Board Settings → Agents & automation; the modal keeps the `agent-open-policy` link. The old `PolicyPanel` file is gone. | `AgentControlDialog.tsx`, `AgentControlDialog.test.tsx`, `runs-policy.spec.ts` |
| Duplicate approval/run/session renderers | Removed as separate implementations: the modal and `/agents` share `ApprovalsPanel`/`approval-ui`, `run-ui`, `session-ui`, `agents-ui` and the same status badge. The global page adds wrappers, not a second data model. | component tree, `design-system.test.ts` |
| Duplicate public entry in the board header | Removed: the board header has no global `Agents` link; `/agents` is reachable from the modal rail (“All agents across boards”) and Account. | `Header.tsx`, `Header.agents.test.tsx` |
