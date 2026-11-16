# Round 6 — Medium findings (M1–M15)

Captured 2026-11-17 from the disposable stack on `:5301`/`:5302`
(`janosik-pixel-db` on `127.0.0.1:5434`), freshly seeded with
`SEED_KEEP_HEARTBEATS=1`.

| Issue | Result | Evidence / measurement |
| --- | --- | --- |
| M1 All-boards detail scope | Fixed | `m1-all-boards-run-detail-header-1440-dark.png`; URL keeps `scope=all&board=px-board-website&run=…` while the header combobox reads `All boards`. |
| M2 Lifecycle truncation | Fixed | `m2-en-status-1024.png`, `m2-ru-status-1440.png`, `m2-ru-status-1024.png`, `m2-ru-status-390.png`; `Completed` label 67 px client/scroll at 1024, RU `Приостановлена` 105/105 with `overflow: visible`. Status columns are 104 px (EN) and 140 px (RU). |
| M3 Conflict chip before opening | Fixed | `m3-conflict-chip-board-runs-1440-dark.png`; `run-121` row already reads `1 conflict`. Read-only previews are precomputed for the visible applied rows. |
| M4 Double partial-error banner | Fixed | One `agents-runs-stale` banner names the unavailable board(s) and retries sessions + runs; covered by `AgentsPage.test.tsx`. |
| M5 Paused row duplication / stale age | Fixed | `m5-paused-live-row-1440-dark.png`; one `Paused` pill, no `Session pause` chip, no row-level reason; row height 47.9 px. Stale chip is `No heartbeat`; the subline carries `No heartbeat · Nm`. |
| M6 Approval detail header | Fixed | `m6-approval-detail-header-1440-dark.png`; measured 68.5 px (`pt-[11px] pb-[9px]`, sub-row `mb-2`). |
| M7 Board Runs Load more at 390 | Fixed | `m7-runs-load-more-390.png`; `agent-runs-more` is 76.6 × 44 px. |
| M8 Token dialog colors/action | Fixed | `m8-token-info-dialog-1440-dark.png`; muted key tile, foreground impact copy, `Open Account → API keys` 176 × 28 px. |
| M9 Board header at 390/1024 | Fixed | `m9-board-header-390.png`, `m9-board-header-1024.png`; title is the full `Agent Ops Demo` (151.7 px at 390, 167.3 px at 1024). Secondary search/undo/redo/data/help/bell/members/share/settings and the board switcher hide at ≤720 px; Agents and Account keep 44 px targets. Deliberate chrome deviation: board settings is not in the phone header (reached from the desktop header), as allowed by the brief. |
| M10 Token group header chip | Fixed | `m10-token-group-chip-1440-dark.png`; plain-mono token chip renders at 21 px high beside the agent name and counts. |
| M11 Live count on fetch failure | Fixed | `m11-live-fetch-error-1440-dark.png`; toolbar reads `Live —`, never `0 sessions`, and the red error card offers Retry. |
| M12 Board-modal error cards | Fixed | `m12-approvals-error-card-1440-dark.png`, `m12-runs-error-card-1440-dark.png`; red-tinted alert card with title/body/Retry. Filter/list headers and `Select a run`/`Select an approval` chrome are absent on zero-row errors. Live uses the same card (`m11`). |
| M13 Scoped member board counts | Fixed | `m13-scoped-member-cross-board-counts-1440-dark.png`; scoped to the member-only Website Relaunch board, the rail header still reads `Pending`, All boards shows 2 pending and Agent Ops Demo shows 2. |
| M14 Next pending under Decided | Fixed | `m14-next-pending-decided-approved-1440-dark.png`; an approved detail opened from Recently decided offers `Next pending` (the pending set ignores the active list filter). |
| M15 Non-admin run detail | Fixed | `m15-member-run-detail-1440-dark.png`; no top read-only banner, the note lives inside Commands, and command rows are 33.9 px. Attribution remains in the Attribution section. |

`results.json` holds the raw measurements above. The real browser run used the
seeded `pixel-admin@example.com` and `pixel-member@example.com` accounts.
