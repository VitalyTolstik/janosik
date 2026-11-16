# TASK-179 pixel-parity evidence

Branch: `fix/agents-pixel-parity`  
Captured: 2026-11-16  
Visual source of truth: [`design/agent-surfaces-prototype/index.html`](../../agent-surfaces-prototype/index.html)  
Spec: [`docs/TASK-179-agent-surfaces-redesign.md`](../../../docs/TASK-179-agent-surfaces-redesign.md)

This folder is the phase-1 evidence set for the final agents/agent-control
visual pass. It is produced from a **disposable** stack, never from the live
dev database or the app on `:3000`/`:5173`.

## Capture matrix

| Item | Value |
| --- | --- |
| UI | Vite dev server on `127.0.0.1:5301` (API proxied to `:5302`) |
| API | disposable NestJS process on `127.0.0.1:5302` |
| DB | disposable PostgreSQL container `janosik-pixel-db` on `127.0.0.1:5434` (`janosik_pixel`) |
| Fixtures | [`scripts/seed-agent-pixel-demo.mjs`](../../../scripts/seed-agent-pixel-demo.mjs) |
| Viewports | `1440×900`, `1024×900`, `390×844` |
| Themes / roles | light + dark, ADMIN + MEMBER |
| Browser | Playwright Chromium, animations disabled by the capture script |
| Screenshots | [`screenshots/`](./screenshots) — full role/theme/viewport matrix plus all approval/run/session states and RU captures |
| Reference captures | [`mockup/`](./mockup), [`mockup-matrix/`](./mockup-matrix) |
| Before captures | [`app-before/`](./app-before) |
| Measurements | [`app-measurements.json`](./app-measurements.json), [`measurements.json`](./measurements.json), [`mockup-measurements.json`](./mockup-measurements.json) |

The seed uses the real command transport: runs have genuine `Command` rows and
`CommandPreimage` rows, so the applied/reverted/failed/conflict/retention
rollback states in the screenshots are real API states, not mocked HTML.

## Feedback checklist

The handoff called out these areas; each row names the implementation and the
place that pins it.

| Area | Result | Implementation / evidence |
| --- | --- | --- |
| Approvals / Inbox detail header | Covered | Board detail header now carries the effective status pill, risk chip and board chip; the global panel keeps its `Selected approval` eyebrow. `AttentionApprovals.tsx`, `control-approval-detail-*`, `agents-approval-detail-*`. |
| Approvals / Inbox detail body | Covered | Status banner, lead sentence, Request grid, exact plan commands/targets, integrity hash + copy, decision history, related links and technical JSON. `AttentionApprovalDetail`; `AgentControlDialog.test.tsx` and `AttentionApprovals.test.tsx`. |
| Approvals / Inbox detail footer | Covered | Board variant uses the shared 50 px footer and spans the whole modal at ≥761 px; it shows the exact hash plus Reject/Approve, or the read-only hint. `ac-foot-approval` in `agent-control.css`; `AgentControlDialog.test.tsx` (`shows the mockup header cancel action and inline footer`). |
| Approval queue grouping and names | Covered | `Needs decision` / `Recently decided` groups, status + risk + TTL metadata, exact-session name fallback, and the mockup row density. `ApprovalsPanel.tsx`, `AgentControlDialog.test.tsx` and the `AgentsPage.test.tsx` exact-session case. |
| Pause / End modals | Covered | 440 px, 10 px radius, 15 px icon, 14 px title, 70 px reason field for pause, target row for end, 28 px footer actions (44 px on mobile). `AgentActionDialog.tsx`; `app-measurements.json` keys `pauseDialog`/`pauseTitle`/`pauseReason`/`endDialog`/`endTarget`. |
| Run-detail footer sizing/order | Covered | Helper line above the action row, 11 px info glyph, 32 px `Open board`/`Copy link` buttons, 352 px pane. `run-ui.tsx`; `app-measurements.json` keys `runFooter`, `runFooterOpen`, `runFooterCopy`; `AgentsPage.test.tsx` checks the footer destination. |
| Open board destinations | Covered | Every `Open board` action lands on the board's Agent Control surface: `?agents=inbox` for approvals, `?agents=live` for sessions, `?agents=runs` for runs. `routes.agentControl`; `AgentsPage.test.tsx` expects `/board/board-1?agents=live` and `?agents=runs`. |
| Idle / stale session state | Covered | Lifecycle pill stays real (`idle` is not stale); a human pause replaces `idle` with `Paused`; stale is a separate heartbeat warning with relative time only; paused/stale rows stay in the live preview and are excluded from `Needs a nudge`. `agent-model.ts`, `session-ui.tsx`, `AgentsPage.tsx`; `agent-model.test.ts` and `status-badge.test.tsx`. |
| Rollback fixtures | Covered | The seed creates applied, reverted, failed, conflict and retention-expired runs through the real batch endpoint, including preimages and a genuine conflict. `scripts/seed-agent-pixel-demo.mjs`; `state-run-*` screenshots; `RunsPanel.test.tsx`. |
| Runs count / limit | Covered | Board Runs shows five rows per page, `5 of N` from loaded rows, `Load more` appends five and fetches the next server cursor; the global list keeps its own board-scoped page. `RunsPanel.tsx`, `use-agent-runs.ts`; `RunsPanel.test.tsx` (`shows a total and appends the next page with Load more`). |
| Approvals expired / consumed / cancelled copy | Covered | Effective expiry is computed from `status + expiresAt`; disabled actions and banner/history copy switch without a refresh. `effectiveApprovalStatus`, `statusHint`; `state-approval-*` screenshots; `AgentControlDialog.test.tsx` (`explains an expired request`). |
| Mobile geometry | Covered | 390 full-screen modal, 44 px close/rail/actions, one scroll pane; 1024 sheet below the real header. `control-*.png` at 390/1024; `design-system.test.ts` pins the shell rules. |
| RU locale | Covered | The new `expires in N min` row label has an RU translation; RU captures verify no fallback. `ui/src/locales/ru/translation.json`; `agents-attention-admin-dark-1440-ru-RU.png`, `control-inbox-admin-dark-1440-ru-RU.png`. |
| Token/actor names | Partial by contract | Own-token names come from `listTokens`; another member's token name is deliberately not disclosed by the board API. Approval rows fall back to the exact session name, and board run rows fall back to a short token id. This is a display/security boundary, not missing UI state. |
| Partial board error / stale rows | Covered | Existing 166.17 retention behavior is preserved; global updated state switches to `incomplete`. `AgentsPage.test.tsx` partial-error case. |
| Unknown `?board=` / deep-link board requirement | Covered | Unknown board shows recovery copy; `?approval`/`?run` without `?board` is rejected with the documented message. `AgentsPage.test.tsx`. |
| No fabricated diffs / impact promises | Covered | Approval surfaces show exact commands, plan hash, summary and known targets; rollback is described as conditional. `AttentionApprovals.tsx`, `run-ui.tsx`; the `runFooter`/approval tests. |

The broader 24-element comparison remains in
[`../README.md`](../README.md); this folder records the final screenshot and
computed-style pass, not a second copy of that table.

## Reproduce

```bash
# 1. disposable database (do not point this at the dev DB)
docker run --rm --name janosik-pixel-db \
  -e POSTGRES_DB=janosik_pixel -e POSTGRES_USER=janosik \
  -e POSTGRES_PASSWORD=pixel -p 127.0.0.1:5434:5432 -d postgres:16-alpine

# 2. schema and API build
DATABASE_URL=postgresql://janosik:pixel@127.0.0.1:5434/janosik_pixel \
  npx prisma migrate deploy -w backend
npm run build -w backend

# 3. API on 5302
DATABASE_URL=postgresql://janosik:pixel@127.0.0.1:5434/janosik_pixel \
JWT_SECRET=pixel-parity-test-secret-0123456789abcdef PORT=5302 \
PUBLIC_ORIGIN=http://127.0.0.1:5301 COOKIE_SECURE=false \
node backend/dist/main.js

# 4. UI on 5301 with the API proxy
cd ui
UI_API_PROXY=http://127.0.0.1:5302 npx vite --port 5301 --strictPort --host 127.0.0.1

# 5. seed and capture
cd ..
SEED_ALLOW=1 DATABASE_URL=postgresql://janosik:pixel@127.0.0.1:5434/janosik_pixel \
  API_URL=http://127.0.0.1:5302 node scripts/seed-agent-pixel-demo.mjs \
  > /tmp/pixel-seed.json
node design/task-179-visual-acceptance/pixel-parity/tools/measure-app.mjs
node design/task-179-visual-acceptance/pixel-parity/tools/capture-parity.mjs
```

`capture-parity.mjs` reads `/tmp/pixel-seed.json`; redirect the seed output
there or the extra-state run ids point at the previous seed.

## Known non-blocking notes

- The seeded run title for another member's token may omit a truncated token
  prefix; the meta row still shows the short token id and the run detail shows
  attribution. The API does not disclose another user's token name.
- Each `screenshots/errors-*.json` contains the single expected pre-login
  `401 (Unauthorized)` from the `/auth/refresh` probe. There are no page errors
  and no other console errors in the matrix.
- The partial-error captures deliberately keep one board's rows while the
  second board fails; the global timestamp reports `incomplete`, never a fresh
  global time after partial success.
- The full browser e2e suite is intentionally left to PR CI; this folder is the
  mocked/real-API visual matrix.
