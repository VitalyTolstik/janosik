# Round 8 — Low-severity parity pass

Base: `035ee2ea` (`checkpoint-before-low-fix`) on `fix/agents-pixel-parity`.
Scope: only the low-risk Low findings. High/Medium gates were already closed;
this round does not change their behavior.

## Fixed

| # | Item | Result |
| --- | --- | --- |
| 1 | Pause/Resume icons 16 → 13 px | `[&_svg]:!h-[13px] [&_svg]:!w-[13px]` on both footer buttons. Measured Pause: button **103.7 × 32**, SVG **13 × 13**. |
| 2 | Approve-confirm buttons narrower | Added `font-agent-surface` to the approve dialog and used the 10 px padding token. Measured Cancel **61.1 × 28**, Approve plan **102.6 × 28**. |
| 3 | Decided board footer Close 32 → 28 | The outline Close uses `h-7`, `px-[9px]`, `text-[11px]`. Measured **53.4 × 28**. |
| 4 | Raw run conflict/internal ids | Conflicts resolve `kind:id` touches against the board (and pre-images for deleted entities), and localize the reason. Measured: `card “Landing page rewrite — final” · changed · v3 → v4`. Unknown action diffs say **Changed**; raw ids/`vN` no longer leak. |
| 5 | Portaled dialog font stack | `font-agent-surface` on action, confirm, token-info and approve dialogs. The approve dialog now uses `ui-sans-serif` like the detail. |
| 6a | `Consumed` → `Applied` | EN status **Applied**, RU **Применено**, eyebrow **Approval · applied**. |
| 6b | Member note scope | Board scope: “Approvals are handled by board admins on this board.” All boards: “…on boards where you are an admin.” |
| 6c | Absolute decided time | Board Inbox and Attention decided rows use `Today, 5:15 PM` / `Yesterday, …` instead of “2 hours ago”. |
| 6d | RU “Retry” body | RU error bodies now quote the button label **Повторить**. |
| 7 | Runs page-head wraps | Freshness uses compact board labels: **Agent Ops 0s ago · Website 0s ago**. Description is one line (**16.7 px**) at 1440 and 1024; full titles stay in the tooltip. |
| 8 | RU 390 Sessions head | The header wraps the action cluster below the title when it cannot fit. RU 390: title block **370 px**, description **31.9 px** (2 lines), actions **262.5 px**, no horizontal overflow. |
| 9 | Token metadata truncation | New `shortTokenId` → `first8…last6` (`cmwc7a7y…pz4qe6`). Used in session rows, Live token groups, approval rows, run attribution and token filters; ids ≤ 15 chars stay whole. |
| 10 | Website board dot | `boardColor("px-board-website")` is **teal** (`bg-teal`, `rgb(45, 212, 191)`) in EN and RU. Other boards keep the id hash. |
| 11 | Loading skeleton/rail | Attention/Inbox use card/row skeletons; rail tabs reserve a **—** while the initial fetch is pending; Inbox filter counts show **—** instead of fake zeros. |
| 12 | Attention filtered-empty copy | Already approvals-specific at the base commit; added a regression test (`No approvals match these filters`). |
| 13 | Inbox Retry leaves “Pending unknown” | Retry now calls the shell callback, which bumps the dialog counter; the rail badge returns without SSE. Regression test added. |
| 14 | Header cross-board counts | A member-only scope requests the ADMIN-board snapshot instead of an unreadable scoped approvals call; the combobox keeps the rail counts, while the scoped badge stays unknown. |
| 16 | Board Settings saved/never-saved | The shell accepts a truthful idle label. On a never-saved policy it shows **Safe defaults** (header and footer agree); dirty/saving still win. |
| 17 | RU Board Settings mixed/truncated | Destructive copy, workflow action, scope note and approver role are localized; the approver field wraps (**38.6 px**, 2 lines) instead of truncating. |
| 18 | Header breadcrumb/actions | Added the `›` chevron between the scope and Agents (sm+). Desktop header icon buttons are **32 × 32** (bell/gear/help/undo/redo); 44 px targets below 768 px are unchanged. |

## Deferred / accepted (with reason)

- **Board Settings 30 px lower at 1440** — intentional below-header anchor.
- **Board Live rail badge stale/paused** — the spec does not define the badge.
- **Lock glyph on other-member tokens** — README documents plain text as deliberate.
- **Board Settings policy-model divergence** — source conflict, not a visual fix.
- **DELETE_CARD impact sentence** — real API impact field; §179.3 allows summary/targets.
- **Human vs agent attribution** — API truth.
- **72h TTL `expires in 4294 min`** — seed readability only.
- **Unknown counts hidden vs `—`** — documented count contract; only the initial
  loading slot shows a dash.
- **1024 scrim 52 px** — real header height.
- **Actual-day Runs grouping** — intentional spec/mockup conflict.
- **1–2 px font metrics / 390 rail tab sizes** — deferred as documented.
- **Item 15 phone settings entry** — no change; `Manage tokens` remains, no `Stop all`.
- **Item 11 “Pending” rail label during the first fetch** — the board list and
  the caller's role arrive with the same delayed overview; showing `Pending`
  before that lands would mislabel member scopes. The tab count now reserves a
  dash, and the label settles to `Pending`/`Scope` with the role.

## Evidence

`measurements.json` was captured with Playwright against the disposable stack
(`:5301` UI, `:5302` API), admin `pixel-admin@example.com`, dark theme.
Screenshots:

- `approve-dialog-1440-dark-en.png` — 61.1/102.6 × 28 buttons, ui-sans-serif.
- `decided-footer-1440-dark-en.png` — Applied status + 28 px Close.
- `runs-head-1440-dark-en.png`, `runs-head-1024-dark-en.png` — one-line head.
- `run-conflict-1440-dark-en.png` — human conflict labels.
- `header-1440-dark-en.png` — breadcrumb chevron and 32 px action cluster.
- `sessions-head-390-dark-ru.png` — readable RU title/subtitle, actions fit.
- `board-settings-agents-1440-dark-ru.png` — Safe defaults header, wrapped
  approver field, localized destructive copy.
- `attention-loading-1440-dark-en.png`, `inbox-loading-1440-dark-en.png` —
  card/row skeletons and loading dashes.

## Verification

- `npx tsc -b ui e2e backend shared` — clean.
- `npx vitest run` in `ui` — **197 files / 1692 tests passed** (plus the new
  low-round tests in the targeted run).
- Targeted: `agent-model`, `approval`, `board-color`, `status-badge`,
  `RunsPanel`, `AgentControlDialog`, `AgentsPage`, `AttentionApprovals`,
  `Header.agents`, `AgentsAutomation` — all pass.
- ESLint on every changed file — no errors (one pre-existing
  `react-hooks/set-state-in-effect` warning in `NotificationsBell.tsx`).
- Prettier `--check` on every changed file — clean.
