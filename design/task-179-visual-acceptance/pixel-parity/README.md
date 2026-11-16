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

The handoff's 20-item feedback checklist maps to these rows; each row names
the implementation and the place that pins it.

| Area | Result | Implementation / evidence |
| --- | --- | --- |
| Approvals / Inbox detail header | Covered | Board detail header now carries the effective status pill, risk chip and board chip; the global panel keeps its `Selected approval` eyebrow. `AttentionApprovals.tsx`, `control-approval-detail-*`, `agents-approval-detail-*`. |
| Approvals / Inbox detail body | Covered | Status banner, lead sentence, Request grid, exact plan commands/targets, integrity hash + copy, decision history, related links and technical JSON. `AttentionApprovalDetail`; `AgentControlDialog.test.tsx` and `AttentionApprovals.test.tsx`. |
| Approvals / Inbox detail footer | Covered | The board variant portals its footer into the modal's flex footer slot after `.ac-body`: 50 px normally, 130 px with the reject form, so it never overlays body content. It shows the exact hash plus Reject/Approve, or the read-only hint. `ac-foot-approval` / `ac-footer-host` in `agent-control.css`; `AgentControlDialog.test.tsx` (`shows the mockup header cancel action and inline footer`). |
| Approval queue grouping and names | Covered | `Needs decision` / `Recently decided` groups, status + risk + TTL metadata, exact-session name fallback, and the mockup row density. `ApprovalsPanel.tsx`, `AgentControlDialog.test.tsx` and the `AgentsPage.test.tsx` exact-session case. |
| Pause / End modals | Covered | 440 px, 10 px radius, 15 px icon, 14 px title, 70 px reason field for pause, target row for end, 28 px footer actions (44 px on mobile). `AgentActionDialog.tsx`; `app-measurements.json` keys `pauseDialog`/`pauseTitle`/`pauseReason`/`endDialog`/`endTarget`. |
| Run-detail footer sizing/order | Covered | Helper line above the action row, 11 px info glyph, 32 px `Open board`/`Copy link` buttons, 352 px pane. `run-ui.tsx`; `app-measurements.json` keys `runFooter`, `runFooterOpen`, `runFooterCopy`; `AgentsPage.test.tsx` checks the footer destination. |
| Open board destinations | Covered | Every `Open board` action lands on the board's Agent Control surface: `?agents=inbox` for approvals, `?agents=live` for sessions, `?agents=runs` for runs. `routes.agentControl`; `AgentsPage.test.tsx` expects `/board/board-1?agents=live` and `?agents=runs`. |
| Idle / stale session state | Covered | The primary pill keeps the lifecycle for an unpaused session; a separate no-heartbeat signal shows its age. A human pause uses `Paused`. The seeded Idle row keeps a fresh heartbeat, and paused/stale rows stay in the live preview but are excluded from `Needs a nudge`. `agent-model.ts`, `session-ui.tsx`, `AgentsPage.tsx`; `agent-model.test.ts` and `status-badge.test.tsx`. |
| Rollback fixtures | Covered | The seed creates applied, reverted, failed, conflict and retention-expired runs through the real batch endpoint, including preimages and a genuine conflict. `scripts/seed-agent-pixel-demo.mjs`; `state-run-*` screenshots; `RunsPanel.test.tsx`. |
| Runs count / limit | Covered | Board Runs shows five rows per page, `5 of N` from loaded rows, `Load more` appends five and fetches the next server cursor; the global list keeps its own board-scoped page. `RunsPanel.tsx`, `use-agent-runs.ts`; `RunsPanel.test.tsx` (`shows a total and appends the next page with Load more`). |
| Approvals expired / consumed / cancelled copy | Covered | Only an undecided `pending` row expires from `status + expiresAt`; a decided approval keeps `Approved` even past the decision TTL, while apply-time still refuses a lapsed apply window. Disabled actions and banner/history copy switch without a refresh. `effectiveApprovalStatus`, `statusHint`; `state-approval-*` screenshots; `AgentControlDialog.test.tsx` (`explains an expired request`). |
| Mobile geometry | Covered | 390 full-screen modal, 44 px close/rail/actions, one scroll pane; 1024 sheet below the real header. `control-*.png` at 390/1024; `design-system.test.ts` pins the shell rules. |
| Session detail body/footer | Covered | Status/hint banner, chips, meta grid, current work, paused semantics, and the footer `Open board` / quiet Pause·Resume / danger End; member and terminal variants keep only their allowed actions. `session-ui.tsx`; `agents-session-detail-*`, `agents-session-pause-*`, `agents-session-end-*`. |
| Counts and rail badges | Covered | Attention badge is the pending-decision count only; stale and paused sessions do not inflate it; board scope and All boards keep separate scope counts. `use-pending-approvals.test.tsx`, `AgentsPage.test.tsx`. |
| RU locale | Covered | The new `expires in N min` row label has an RU translation; RU captures verify no fallback. `ui/src/locales/ru/translation.json`; `agents-attention-admin-dark-1440-ru-RU.png`, `control-inbox-admin-dark-1440-ru-RU.png`. |
| Token/actor names | Covered | Board-scoped sessions and runs now carry additive `tokenName` / `actorName` / `sessionName` attribution, so another member's token is named in the demo instead of collapsing to a session name or CUID. Approval rows still prefer the exact session and fall back to the token id when attribution is unavailable. `agent-sessions.service.ts`, `runs.service.ts`, `run-ui.tsx`, `session-ui.tsx`; `agent-model.test.ts`. |
| Partial board error / stale rows | Covered | Existing 166.17 retention behavior is preserved; global updated state switches to `incomplete`. `AgentsPage.test.tsx` partial-error case. |
| Unknown `?board=` / deep-link board requirement | Covered | Unknown board shows recovery copy; `?approval`/`?run` without `?board` is rejected with the documented message. `AgentsPage.test.tsx`. |
| No fabricated diffs / impact promises | Covered | Approval surfaces show exact commands, plan hash, summary and known targets; rollback is described as conditional. `AttentionApprovals.tsx`, `run-ui.tsx`; the `runFooter`/approval tests. |
| No horizontal overflow or page errors | Covered | `overflow-1024`/`overflow-390` are false; there are no `pageerror` entries. Console entries are limited to the expected pre-login `/auth/refresh` 401s and the documented conflict-preview 409 (see Known non-blocking notes). |

The broader 24-element comparison remains in
[`../README.md`](../README.md); this folder records the final screenshot and
computed-style pass, not a second copy of that table.

## Reproduce

```bash
# 1. disposable database (do not point this at the dev DB)
docker run --rm --name janosik-pixel-db \
  -e POSTGRES_DB=janosik_pixel -e POSTGRES_USER=janosik \
  -e POSTGRES_PASSWORD=pixel -p 127.0.0.1:5434:5432 -d postgres:16-alpine

# 2. schema and TypeScript compilation
DATABASE_URL=postgresql://janosik:pixel@127.0.0.1:5434/janosik_pixel \
  npx prisma migrate deploy -w backend
npx tsc -b backend shared

# 3. API on 5302
DATABASE_URL=postgresql://janosik:pixel@127.0.0.1:5434/janosik_pixel \
JWT_SECRET=pixel-parity-test-secret-0123456789abcdef PORT=5302 \
PUBLIC_ORIGIN=http://127.0.0.1:5301 COOKIE_SECURE=false THROTTLE_LIMIT=1000000 \
node backend/dist/main.js

# 4. UI on 5301 with the API proxy
cd ui
UI_API_PROXY=http://127.0.0.1:5302 npx vite --port 5301 --strictPort --host 127.0.0.1

# 5. seed and capture
cd ..
SEED_ALLOW=1 SEED_KEEP_HEARTBEATS=1 \
  DATABASE_URL=postgresql://janosik:pixel@127.0.0.1:5434/janosik_pixel \
  API_URL=http://127.0.0.1:5302 setsid node scripts/seed-agent-pixel-demo.mjs \
  > /tmp/pixel-seed.json 2> /tmp/pixel-seed.log < /dev/null &
node design/task-179-visual-acceptance/pixel-parity/tools/measure-app.mjs
node design/task-179-visual-acceptance/pixel-parity/tools/capture-parity.mjs
```

`capture-parity.mjs` reads `/tmp/pixel-seed.json`; redirect the seed output
there or the extra-state run ids point at the previous seed.

## Known non-blocking notes

- Runs and sessions name the token, actor and session from board-scoped
  attribution fields. If a legacy row has no attribution, the run title omits
  the truncated token prefix and the meta row shows a short id; the detail still
  keeps the true identifiers in `title` attributes.
- Each `screenshots/errors-*.json` contains the expected pre-login
  `401 (Unauthorized)` from the `/auth/refresh` probe. The conflict-run detail
  deliberately logs one `409 (Conflict)` from `preview`; that is the API
  contract for a blocked rollback, not a page error. Other captures have no
  additional console errors.
- The partial-error captures deliberately keep one board's rows while the
  second board fails; the global timestamp reports `incomplete`, never a fresh
  global time after partial success.
- The full browser e2e suite is intentionally left to PR CI; this folder is the
  mocked/real-API visual matrix.

## Round 3

The matrix was recaptured from the disposable stack after the round-3 UI
changes. `measurements.json` records the capture script's computed values;
`round3-board-reject-*` contains the additional reject-form checks. The
read-only `tools/verify-round3.mjs` checks the actual rollback preview API,
responsive approval controls, the no-session approval link, RU filtered-empty
state and MEMBER controls. It uses the seeded users and does not submit a
mutation. `capture-parity.mjs` also pauses and resumes the demo board to capture
that state, so reseed after capture before handing the stack to a reviewer.

The demo now gives the independent applied runs independent card writes. The
intentional conflict remains `run-121`; run pagination groups by actual day,
including across midnight, rather than putting every loaded row under Today.
The optional `SEED_KEEP_HEARTBEATS=1` seed mode updates the designated fresh
session heartbeats with the current time once a minute; the deliberately stale
and terminal rows are not updated. It is a long-running disposable process and
must be stopped before reseeding. Run the seed in a foreground terminal or
supervised process and redirect its JSON output to `/tmp/pixel-seed.json`.

Source-of-truth decisions and remaining differences:

- Board Live retains **Manage tokens**. The spec §3.3 explicitly puts Stop all
  in Account → API keys.
- The global Attention Needs/Decided/All filter remains: §179.3 explicitly
  requires those filters, even though the prototype omits them there.
- Approval Run links remain when a run exists: §179.3 requires run links. A
  missing session no longer links to an unrelated token-filtered sessions page.
- Stale heartbeat copy keeps the lifecycle and shows a separate no-heartbeat age as required by §179.4.
- The global 1024 px detail is a dismissible sheet in this implementation, so
  it retains its Back control; the board approval detail hides it at 1024 px.
- An unknown approval count remains hidden instead of displayed as zero. The
  existing count contract distinguishes unknown from zero; a dash badge is a
  remaining visual difference.
- Run footer buttons retain the measured 1–2 px width difference. Their hit
  targets and order are unchanged. Per-board freshness timestamps describe the
  most recent successful fetch, not an agent heartbeat.

Round-3 browser assertions measured equal reject form/textarea widths of
1094 px at 1440, 976 px at 1024 and 372 px at 390, in both themes. The
390 px approval buttons were at least 150×44 px, and the Live Pause/End
controls wrapped with 44 px heights. The later `app-measurements.json` pass
measured the pause dialog at 440×244 px and the end dialog at 440×178.7 px.
The real preview API returned `canRevert=true` for runs 128 and 126 and
`canRevert=false` for run 121. These measurements do not establish a complete
pixel-by-pixel comparison for every error, role and locale combination.

## Round 4

`tools/verify-round4.mjs` exercises the unfiltered run badge, failed-run
commands, missing and unknown board recovery, and stale lifecycle in the
1440/1024/390 × light/dark × ADMIN/MEMBER × EN/RU matrix. It also checks
the approval confirmation and reject form for ADMIN, plus rollback styling and equal footer widths, and records screenshots and results in
`round4-browser-results.json`. The browser check is read-only. The approval
loading skeleton, full pagination of the run count, and all-board detail
scope are covered by UI component tests. `tools/verify-round4-token.mjs`
checks the token-page title, lifecycle, and one stale signal per card across
the same matrix. The run badge is withheld until all
pages are loaded, or when a board could not be read; it is never presented as
a total while incomplete.

For the detached heartbeat process, stop the prior seed process before
re-seeding. `setsid` and redirected standard streams let it survive the
launching shell. Check it with `pgrep -af '[s]eed-agent-pixel-demo.mjs'`
and verify heartbeat timestamps advance from a separate shell. The designated
fresh rows are updated once per minute; the deliberately stale row is not.
Pending demo approvals have a 72-hour expiry. The sixth run is placed on the
current calendar day, including just after midnight. Board Runs deliberately
groups by each run's actual day rather than the prototype's single Today
group.

The request metadata names the requesting agent, as in the prototype; the
decision history retains the human account recorded by the API. The API
does not provide a failure reason for failed commands, so the command copy
says “Not applied” instead of inventing a stale-version diagnosis. The
disposable failed-run fixture is synthetic: it is made from an applied run
and then marked failed in the seed to exercise this display.
