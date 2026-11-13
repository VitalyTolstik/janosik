---
title: Agents
description: The global Agents control room, the board Agent Control modal, policy in Board Settings, permissions, and the URL/deep-link contract.
---

TASK-179 splits agent work into three layers: a global control room, a
board-scoped operations modal, and configuration in Board Settings. The layers
share one set of approval, session, run and status components, so the same
evidence is visible everywhere without a second source of truth.

## The three surfaces

| Surface | Address | What it is for |
| --- | --- | --- |
| Global control room | `/agents` | Anything that needs a human or spans boards: Attention, Sessions, Runs. |
| Board Agent Control | board header Bot button | Operational work on one board: Inbox, Live, Runs. |
| Board Settings → Agents & automation | board gear → Agents & automation | Configuration: destructive mode, approval triggers, limits, TTL and approver roles. |

On a board, the header has exactly one Bot button. It opens Agent Control. The
global page is reachable from the modal’s **All agents across boards** link and
from Account. On `/agents` the header is the global variant: board title,
members, share, gear and undo/redo are intentionally absent.

## The global `/agents` control room

The left rail has three sections:

- **Attention** — pending approvals for boards where you are an ADMIN, plus
  live sessions with no recent heartbeat. A MEMBER or VIEWER sees only the
  stale sessions; approvals are never requested for them, so the section does
  not turn into a 403 with a Retry button.
- **Sessions** — every session you can see, grouped by board by default, then
  by token inside a board. **Group by Agent (token)** switches the grouping.
  A session keeps its real lifecycle status (`active`, `idle`,
  `waiting_approval`, `completed`, `failed`, `cancelled`); pause and stale are
  separate facts, shown beside it. “No heartbeat · N min” is not a lifecycle
  status.
- **Runs** — the run history for the selected scope, newest first, with
  status/kind/time/token/session filters, total/load more, a detail pane and a
  conditional rollback path.

The top bar has a board-scope combobox (`All boards` or one board), the
section count, search, `Updated Ns ago` plus Refresh, and **Manage tokens**
(Account → API keys). Search and filters live in the URL, so reload,
copy-link and browser back/forward restore the same view.

### Empty, filtered-empty and failure states

- A first run with no sessions shows **Create API key** and **Read docs**; the
  link opens Account → API keys, not a dead end.
- A filtered list with no matches shows **Clear filters**.
- An unknown or revoked `?board=` shows a clear message with a recovery
  action. It never pretends the scope is empty.
- If one board’s session request fails, the rows already loaded stay visible;
  the unavailable board is marked stale and the banner offers Retry. A
  confirmed 403/revoked/deleted board removes that board’s data instead of
  keeping it as “stale”. One global timestamp never claims a partially failed
  fan-out is fresh.

### Approvals in Attention

An approval is a request from an agent to apply an exact plan. Open it to see
the human summary, risk, board and target, requester/agent/session, the exact
commands or operations, the plan hash and TTL, and the decision record.

- **Approve** asks you to confirm the exact plan hash. Approval authorizes only
  that plan; the agent must repeat the same operation with the approval id.
  Approving does not apply the plan for the agent.
- **Reject** requires a reason in the UI and writes it to the decision record.
- **Cancel request** cancels a request you are allowed to withdraw.
- Effective expiry is computed from status and TTL on the client. When the TTL
  passes while the page is open, Approve disables without a refresh; a stored
  `pending` row reads `Expired`.
- `Consumed` means the plan was applied; the approval is one-use and cannot be
  replayed.
- Rollback is conditional: later edits can create conflicts, missing preimages
  or an expired retention window can block it. The UI does not promise a
  guaranteed recovery and does not fabricate a before/after diff.

### Rollback and run recovery

Rollback reverses an applied run by creating a new **revert** run; it never
rewrites history in place. The UI previews the inverse commands before an
ADMIN confirms.

- Only an `applied` run can be reverted, and only by a signed-in board ADMIN.
  A MEMBER can inspect the run and preview the rollback but cannot apply it.
- Later edits can turn a command into a conflict. A missing preimage or an
  expired retention window also blocks the revert. The preview names the
  blocked command; there is no “force” rollback.
- If the preview reports a conflict, resolve the later edit first or leave the
  run as applied.
- The revert is recorded as its own run with its own status, so the history
  stays append-only and the original run is marked `reverted`.
- Preimages are visible to a board ADMIN in the browser session. A PAT or a
  MEMBER sees the timeline, commands and conflicts, but not the before-state.

### Sessions and human control

Session rows show the board, token/agent name, lifecycle status, heartbeat,
stale/paused badges, the current card and run, and the latest session name.

| Action | ADMIN | MEMBER/VIEWER | Notes |
| --- | --- | --- | --- |
| Pause/resume a session | yes | no | Reason + confirm; in-flight work finishes, claims stay. |
| End a session | yes | no | Confirm; terminal, releases claims. |
| Pause/resume the board | yes | no | Confirm + reason, one board banner; reads/heartbeat/end stay available. |
| Stop token / Stop all / revoke | owner in Account | owner in Account | Never a board-ADMIN action. |
| Open the board/card | yes | yes | `Open board` preserves the board or card deep link. |

A token-level or board-level pause is shown as a badge and is not cleared from
the session actions. `Token settings` appears only for the caller’s own token;
another member’s token is read-only and has no link into their Account.

## Board Agent Control (modal)

The board modal uses the Board Settings shell and a vertical rail:

- **Inbox** — approvals for this board, all statuses, with the same detail,
  hash, TTL and decision controls. ADMIN only.
- **Live** — board pause/resume and session pause/resume/end. ADMIN gets the
  actions; MEMBER/VIEWER get the same evidence read-only and start on Live.
  There is no Stop token or Stop all here: the only token path is **Manage
  tokens** → Account → API keys.
- **Runs** — board-scoped runs, detail, preview and revert. Members can inspect
  and preview; applying a revert is ADMIN-only. Preimages/diff are ADMIN-only;
  members see the timeline, attribution, conflicts and a read-only notice.
- **Policy is not in the modal.** The footer link **Open policy settings**
  closes the modal and opens Board Settings on Agents & automation.

Mobile behaviour: full-screen at 390, one scroll, rail tabs and close at least
44 px, focus returns to the Bot that opened it. At 1024 the sheet and its scrim
start below the real board header instead of covering it with an invisible
overlay.

## Board Settings → Agents & automation

The gear is ADMIN-only. The settings shell now has two top-level sections:

- **Workflow** — the existing Columns/Matrix editor.
- **Agents & automation** — the agent policy:
  - destructive mode: **Require approval** or **Hard deny**;
  - approval triggers: non-destructive actions are editable; destructive
    actions are visibly disabled with “covered by destructive mode”;
  - max commands per run (1–100), max cards per run (1–50), approval TTL
    (5–1440 minutes);
  - approver roles: fixed `ADMIN`, read-only;
  - `Using safe defaults` and a reset control that is disabled when the policy
    is already default;
  - dirty tracking across both sections, a discard guard, Save/Cancel and
    inline validation;
  - compare-and-swap save: if another admin changed the policy first, reload
    keeps your draft and the merge only applies fields you actually changed.
    If both sides changed the same field, you get an explicit choice; a stale
    whole draft is never silently written over a newer policy.

## Permissions

| Capability | ADMIN | MEMBER | VIEWER | Agent token (PAT) |
| --- | --- | --- | --- | --- |
| Attention approvals list/detail | yes | no (not requested) | no (not requested) | not via this page |
| Approve / reject | yes | no | no | no |
| Cancel approval | yes | no | no | requester only |
| Sessions list/detail | yes | yes | yes | observer+ |
| Session pause/resume | yes | no | no | no |
| Session end | yes | no | no | owner |
| Board pause/resume | yes | no | no | no |
| Stop token / Stop all | owner in Account | owner in Account | owner in Account | no |
| Runs list/detail/preview | yes | yes | yes | yes |
| Preimages / diff | yes | no | no | no |
| Apply revert | yes | no | no | no |
| Policy read/update | yes | no | no | no |
| API key creation | yes | yes | yes | no |

Roles are per board. Being ADMIN on one board and MEMBER on another is a
supported mix: counts, the Inbox tab, the gear and the read-only notices all
follow the role of the board in scope. `/agents` is a browser-session page; the
read-only aggregation endpoint rejects a PAT with `pat_forbidden` rather than
fanning PAT scope across boards.

## URLs and deep links

The global page keeps filters and selection in the URL:

| Parameter | Meaning |
| --- | --- |
| `?section=attention\|sessions\|runs` | Rail section; default `attention`. |
| `?board=<id>` | One board or `All boards` when absent. |
| `?token=<id>` | Legacy token filter; still accepted. |
| `?agent=<id>` | Canonical token/agent filter (wins over `token`). |
| `?status=…`, `?time=…`, `?q=…` | Status, last-seen window and search. |
| `?group=board\|token` | Sessions grouping. |
| `?session=<id>` | Open a session detail. |
| `?approval=<id>` | Open an approval detail; **requires `board`**. |
| `?run=<id>` | Open a run detail; **requires `board`**. |

Examples:

```text
/agents?section=sessions&board=b1&token=t1
/agents?section=attention&board=b1&approval=a1
/agents?section=runs&board=b1&run=r1
/agents?section=runs&board=b1&status=failed&time=24h&agent=t1
```

Run copy-link always includes `board`; the copied URL survives reload and
back/forward. `/agents/:tokenId` remains a canonical token → sessions deep link
and is not redirected. Opening `?approval=` or `?run=` without `?board=` shows
a recovery message instead of guessing.

The board modal has no separate URL; use the board route and the single Bot
entry. Its close/Escape returns focus to the Bot, and the global cross-link
returns focus to the header `Agents` link.

## Next

- [API keys and token pause](/docs/user-guide/account/)
- [Agent launch checklist](/docs/agent-launch/)
- [Board workflow and settings](/docs/user-guide/boards/)
