# TASK-177 — Human last mile: all 18 product gaps

**Status:** planned  
**Base:** `main` = `131dd70`  
**Source:** `design/project-gaps-review/REVIEW.md` (static review of `a858c75`)  
**Scope:** **all 18 findings G-01…G-18.** No finding is deferred or treated as “won’t fix”.  
**Related:** TASK-176 (`docs/TASK-176-admin-connections.md`) covers the admin/API gaps and author-only comment editing. TASK-177 covers the human UI last mile on top of it.

---

## 1. Goal

Close every confirmed gap from the review so that:

- actions already supported by REST/MCP are reachable in the normal UI;
- destructive actions are honest and recoverable at the level the product promises;
- counts, badges and lists never present a loaded sample as a complete total;
- user content (comment draft, task spec, claims, attachments, shares, invitations) can be managed by the person who owns it;
- the UI works on touch and keyboard, not only hover/mouse.

All 18 findings are in scope. Product decisions are **prerequisites**, not exclusions. If the owner does not override a decision, use the recommended default in §4.

## 2. Non-goals

- No new board rendering model, no board-settings redesign, no TASK-166 security changes.
- No master-wide agent control section (TASK-176.11).
- No editing another user’s comment text; comment moderation by board ADMIN remains a separate decision.
- No full admin card editor; TASK-176.8/176.9 owns that.

## 3. Findings → subtasks

| Finding | Summary | Subtask |
| --- | --- | --- |
| G-01 | Share link cannot be edited after creation | 177.1 |
| G-02 | MEMBER/VIEWER cannot leave a board | 177.2 |
| G-03 | Task spec read-only; claim invisible/release only via session end | 177.4 |
| G-04 | Comment draft lost when the card closes | 177.3 |
| G-05 | Comments/History badges count the loaded page, not the total | 177.3 |
| G-06 | Comment kind is write-once and cannot be filtered | 177.11 |
| G-07 | Pending invitation cannot be edited, extended or resent | 177.8 |
| G-08 | Revoke share has no confirmation | 177.8 |
| G-09 | Admin shares shows the first 100 and hides the rest | 177.5 |
| G-10 | Admin shares hides expiry; expired looks active | 177.5 |
| G-11 | Board switcher card count includes archived cards | 177.8 |
| G-12 | Comment/link delete is hover-only on touch | 177.8 |
| G-13 | File removed from description cannot be restored | 177.9 |
| G-14 | Per-board export exists in API/docs but not in UI | 177.7 |
| G-15 | “Permanent” delete is a soft-delete recoverable by an admin | 177.7 |
| G-16 | `notifyAttention` and attention inbox have no UI | 177.6 |
| G-17 | Global search caps 20 before grouping, hiding board hits | 177.10 |
| G-18 | “Board exported” toast when all boards were exported | 177.8 |

## 4. Product decisions and recommended defaults

These must be recorded in the implementation PR. If the owner does not choose otherwise, implement the recommended default.

1. **Task spec / claim (G-03).** Recommended: board `ADMIN` and `MEMBER` may edit/clear the task spec; every change is attributed to the human in Activity. Show a claim pill (`Claimed by … until …`) to all members; `Release claim` is available to the claim owner and board `ADMIN`, with confirmation; release writes Activity and does not silently kill the agent session.
2. **“Permanent” delete (G-15).** Recommended: keep soft-delete, stop saying “permanently”; copy says “Removed from the board. An administrator can restore it during the retention period.” Add a user-facing **Recently deleted** view for cards/columns/comments/attachments with restore during retention. Do not implement true purge in this task.
3. **Self-leave (G-02).** Recommended: `MEMBER`/`VIEWER` may leave; the last `ADMIN` cannot leave until another admin exists; authored content remains and is attributed normally.
4. **Share edit scope (G-01).** Recommended: allow title, `includeComments`, `includeAttachments`, `expiresAt`; `mode` and token are immutable. Changing a live link’s privacy flags requires confirmation and an audit entry.
5. **Detached attachments (G-13).** Recommended: provide `Restore to description` (append an inline markdown reference) and `Download`/copy URL; no new backend re-attach route unless the client append proves insufficient.
6. **Global search cap (G-17).** Recommended: group `Cards` and `Boards` before applying per-group caps; show `20 of N` or a `Show all` action; a board hit must never be hidden by card hits.
7. **Attention inbox (G-16).** Recommended: ship the `notifyAttention` toggle and a bell/inbox with read/read-all now; TASK-173.6 remains the home for broader attention features (digest, subscriptions).
8. **Comment moderation.** Author-only editing/kind changes. Board-ADMIN deletion of another user’s comment remains an open product decision and is not silently added.
9. **User restore (G-15).** Recommended: `Recently deleted` during retention, as in decision 2.

## 5. Subtasks

### 177.1 — Share link edit (G-01) · P2, S/M

- Add `Edit` to each share row, reusing the create form in edit mode.
- Fields: title, `includeComments`, `includeAttachments`, `expiresAt`; `mode`/token immutable.
- Call existing `PATCH /boards/:id/shares/:shareId`; refresh the row and list.
- Confirm when changing privacy flags on a live link; server audit already exists.
- Tests: component edit/cancel/PATCH body; E2E live link flags change and public comments endpoint behavior; snapshot expiry clear.
- Files: `ui/src/components/board/ShareDialog.tsx`, `ui/src/api/client.ts`, locales, ShareDialog tests.

### 177.2 — Self-leave board (G-02) · P2, M

- Backend: `DELETE /boards/:id/members/me` (or a self path on the existing member route) for `MEMBER`/`VIEWER`; last `ADMIN` cannot leave (`409`/`403` with a clear code).
- Write Activity `member_left`, publish membership SSE; remove the board from the user’s switcher; close the live connection.
- UI: `Leave board` in the user’s own row with confirmation; admins keep remove-other behavior.
- Tests: backend e2e member/viewer leave, last-admin guard, admin-remove regression; UI component; E2E board disappears and direct URL is denied.
- Files: `backend/src/boards/boards.controller.ts`, `boards.service.ts`, `shared/src/api.ts`, `ui/src/components/board/BoardMembersDialog.tsx`, `ui/src/api/client.ts`.

### 177.3 — Comment draft safety + honest activity counts (G-04, G-05) · P1, S

- Keep a per-card draft (`module-level Map<cardId, {text, kind}>`, or a persisted store with TTL) and restore it on reopen; clear on successful send/cancel.
- Do not lose the draft on Escape/close or linked-card navigation. Optionally confirm discard if the draft is non-empty and no persistence is used.
- Badges: show `50+` when `nextCursor !== null`; if a total is available, show `N of M`. History uses the folded row count and must say what it counts.
- Tests: component type→close→reopen restore, send clears, failure keeps text; E2E 60+ comments badge not a false total.
- Files: `ui/src/components/board/CardComments.tsx`, `CardActivity.tsx`, `CardHistory.tsx`, `CardDialog.tsx`, locales.

### 177.4 — Agent-owned card state (G-03) · P2, M

- Wire `SET_CARD_TASK_SPEC` into `BoardContext` and add an edit/clear control for `Acceptance criteria`/`Definition of done`; permission per decision 1; Activity attribution.
- Show claim pill with `claimedBy`/`leaseUntil` and a `Release claim` action with confirmation; write Activity; do not end the agent session implicitly.
- Tests: human edit/clear task spec, DoD gate sees the new contract; claim display/release permissions; E2E agent sets contract → human edits → MCP move-to-done uses the new DoD.
- Files: `ui/src/components/board/CardTaskSpec.tsx`, `CardDialog.tsx`, `ui/src/store/BoardContext.tsx`, shared action wiring, locales.

### 177.5 — Admin shares truthful list (G-09, G-10) · P3, S

- Add pagination/total to `/admin/shares` using the existing `total/offset/limit`; label `N of M`.
- Add `Expires` column and `Expired` badge (`expiresAt <= now`, freeze `now` on mount); optionally `Last viewed`.
- Tests: 101 mock rows paginate; search resets offset; expired row badge; no-expiry dash.
- Files: `ui/src/admin/SharesPage.tsx`, `shared/src/admin.ts` if a missing field, locales.

### 177.6 — Notification preferences + attention inbox (G-16) · P2, S/M

- Add `notifyAttention` toggle to Account → Profile, using `PATCH /users/me/notification-settings`; load/persist, revert on error.
- Add attention items to the bell/inbox: list, unread badge, mark read, read-all; link each item to the board/card/approval.
- Keep existing invitation notifications working; do not confuse attention and invitations.
- Tests: component toggle load/save/error; E2E opt-out suppresses email; inbox read/read-all and deep links.
- Files: `ui/src/components/account/ProfileSection.tsx`, `ui/src/components/NotificationsBell.tsx`, `ui/src/api/client.ts`, attention UI, locales.

### 177.7 — Delete semantics + per-board export (G-14, G-15) · P2, M

- Add `Export this board` to the Data menu using `GET /boards/:id/export`; disable when no board is open; handle `413` with a clear message; keep all-boards export separate.
- Change delete copy in cards/boards/columns to the honest soft-delete wording from decision 2.
- Add `Recently deleted` for cards/columns/comments/attachments with restore during retention, or explicitly document admin-only restore if the owner chooses that variant. Do not claim “permanent” unless true purge is implemented.
- Tests: per-board export/re-import; no-board disabled; delete → reload → Recently deleted → restore; copy snapshots; admin restore remains.
- Files: `ui/src/components/DataMenu.tsx`, `ui/src/api/client.ts`, user guide EN/RU, delete dialogs/copy.

### 177.8 — Small UX batch (G-07, G-08, G-11, G-12, G-18) · P3, S

- Pending invitation row: role and expiry controls using the existing `updateMember`; resend remains a separate email feature if not already available.
- Share revoke: shared `ConfirmDialog` with link name/mode; cancel does not call the API.
- Board switcher: count active cards only, or label `active/total`; test archive/unarchive.
- Touch: add `no-hover:opacity-100` to comment delete and card-link remove; ensure hit target and focus-within.
- Export toast: `All boards exported` (with count) for all-boards; `Board exported` only for per-board.
- Tests: component and mobile Playwright where behavior is visual; copy snapshots.
- Files: `BoardMembersDialog.tsx`, `ShareDialog.tsx`, `BoardSwitcher.tsx`, `CardComments.tsx`, `CardLinks.tsx`, `DataMenu.tsx`, locales.

### 177.9 — Detached attachments restore (G-13) · P3, M

- Add `Restore to description` (append inline markdown with the attachment id) and `Download`/copy URL for files in “Removed from descriptions”.
- If client-side restore cannot preserve ordering/reconciliation, add a server `POST /cards/:cardId/attachments/:id/reattach` with board/card checks.
- Tests: remove → reload → restore → save → image renders; permissions; 20-attachment limit; already deleted file cannot be restored.
- Files: `ui/src/components/board/CardAttachments.tsx`, `ui/src/api/client.ts`, backend attachments only if needed, user guide.

### 177.10 — Global search grouping (G-17) · P3, S

- Group `Cards` and `Boards` before applying caps; a board hit must remain visible when card hits exceed 20.
- Add `20 of N` or `Show all results`; keep the palette bounded.
- Tests: 21 card hits + 1 exact board hit → board present; counter/Show all; existing cap test adapted, not deleted.
- Files: `ui/src/components/GlobalSearch.tsx`, `ui/src/utils/filter.ts`, search tests, user guide if the cap is documented.

### 177.11 — Comment kind edit + filter (G-06) · P3, S

- Extend the author-only comment PATCH from TASK-176.2 to accept `kind` as well as `text`; set `editedAt` and Activity `comment_updated`; do not resend blocker attention for an already-sent comment unless the product explicitly wants a new event.
- Add kind filter chips (`All / Note / Status / Question / Blocker / Evidence / Handoff`) using the existing server `?kind=`.
- Tests: author changes kind; non-author denied; filter returns only that kind; attention dedup; UI marker.
- Files: `backend/src/comments/comments.controller.ts`, `comments.service.ts`, `shared/src/api.ts`, `ui/src/components/board/CardComments.tsx`, MCP follow-up only after TASK-166.11 (tool count bump explicit).

## 6. Order and PR split

1. **177.3** — P1 data-loss fix, one small PR.
2. **177.1 + 177.5 + 177.8** — small UI PRs; 177.8 can be split if needed.
3. **177.10 + 177.11** — small independent PRs (177.11 after TASK-176.2).
4. **177.2** — backend + UI, separate PR.
5. **177.6** — toggle first; inbox in the same PR if the surface is ready, otherwise a follow-up inside TASK-177 (not deferred).
6. **177.4 + 177.7 + 177.9** — after decisions in §4; do not drop them from the task if a decision is slow, record the chosen variant and implement.

## 7. Definition of done

- Every G-01…G-18 row has a merged fix and a test that would fail without it.
- EN/RU copy for every new surface; user guide/API docs where behavior changed.
- `CHANGELOG.md` entries; no test weakening.
- Keyboard and touch checked; 390 px for UI changes.
- New writes have Activity/audit coverage; destructive actions have confirmation.
- `npm run format:check`, lint, typecheck and relevant unit/e2e/browser suites green.
- No unrelated refactors, no board-settings files, no TASK-166 security changes.

## 8. Acceptance summary

| Area | Acceptance |
| --- | --- |
| Share | Edit title/flags/expiry; mode/token unchanged; live privacy change confirmed |
| Membership | Member/viewer can leave; last admin cannot; board disappears |
| Comments | Draft survives close/reopen; counts show `50+`/total; kind filter and author kind edit |
| Task spec/claim | Human can edit/clear spec; claim visible; release with audit |
| Admin shares | Pagination, total, expiry/expired status |
| Notifications | `notifyAttention` works; attention inbox read/read-all |
| Delete/export | Honest copy, Recently deleted restore, per-board export |
| Small UX | Pending invite edit, revoke confirm, active count, touch actions, export toast |
| Attachments | Detached file can be restored/downloaded |
| Search | Board hits survive the cap; `20 of N`/Show all |

## 9. UI roast additional findings (also in TASK-177)

Source: `design/ui-roast/REVIEW.md` (live 1440/1024/390 + axe-core). These are **new** findings beyond G-01…G-18. They are added to TASK-177 so nothing is forgotten; they do not replace the first wave.

### 9.1 New findings

| ID | Finding | Class | Sev | Subtask |
| --- | --- | --- | --- | --- |
| U-01 | `@mention` is plain text: no picker, no notification, no recipient | BASIC MISSING | P1 | 177.12 |
| U-02 | Global/board search does not find comments or attachment filenames | BASIC MISSING | P2 | 177.13 |
| U-03 | `/agents` shows `0 waiting approval` while a board has Pending 1; empty agents has no CTA | INCONSISTENT / BURIED | P2 | 177.14 |
| U-04 | Card a11y: unnamed checklist toggle/progressbar, focus lost after close, contrast, no h1/duplicate main/li outside list | BROKEN / A11Y | P2 | 177.15 |
| U-05 | First-run creates “New board” without asking a name; no template; rename affordance invisible | INCONSISTENT | P2 | 177.16 |
| U-06 | Comment delete: confirm has no text preview, no undo, touch target 22×22 | POLISH / SAFETY | P2 | 177.17 |
| U-07 | Mobile safe-area is not set; card label is clipped/covered by hover actions | POLISH / MOBILE | P3 | 177.18 |
| U-08 | No multi-select/bulk actions for cards | BASIC MISSING | P3 | 177.19 |
| U-09 | No watchers/follow, saved views, or assignment/due notifications | PRODUCT DECISION | P3 | 177.20 |

### 9.2 Additional subtasks

#### 177.12 — Mentions and mention notifications (U-01) · P1/P2, L

- Parse `@` in comments; add an autocomplete user-picker from board members (keyboard, no free-text ambiguity).
- Store mentions explicitly or resolve at write time; create an attention notification for each mentioned member (respect `notifyAttention`).
- Bell/inbox row with actor, card, board, excerpt, deep link; read/read-all via 177.6.
- Do not notify the author; dedupe repeated mentions; deleted comments/boards must not resurrect notifications.
- Product decision: if mentions are out of product scope, remove the `@` affordance/copy instead of leaving plain text. The owner has chosen to implement them.
- Tests: parser, picker, permission (mentioned user must be a board member), notification/email, opt-out, deep link, deleted target.
- Files: comments controller/service, shared DTO/attention type, comments UI, NotificationsBell, locales.

#### 177.13 — Search comments and attachments (U-02) · P2, S/M

- Extend global and board search with comment text and attachment file names. The backend `searchCards` already has a comment path; expose it to the UI and keep title/description/label/checklist hits.
- Results need a type badge (`Comment`, `Attachment`, `Card`, `Board`) and a deep link to the card/comment/attachment.
- Show `20 of N`/Show all per 177.10; do not hide board hits.
- Tests: comment-only match, attachment filename match, permission filtering, deleted rows, result grouping/cap.
- Files: `ui/src/utils/filter.ts`, `GlobalSearch.tsx`, board search, `ui/src/api/client.ts`, backend search if a DTO field is missing.

#### 177.14 — Agent approval truth and empty CTA (U-03) · P2, S

- `/agents` must count pending approvals, not only session status; link each pending item to the board approval dialog or a global approval inbox (177.6).
- Keep the board badge and `/agents` count consistent; refresh via SSE/poll.
- Empty `/agents` gets a `Create API key` CTA to Account → API keys and a short “start an agent” path.
- Tests: one pending approval → `/agents` shows 1 and deep-links; approve/expire updates both; empty CTA visible.
- Files: `ui/src/admin/AgentsPage.tsx` (or current agents page), API client, board control store, locales.

#### 177.15 — Accessibility pass (U-04) · P2, S/M

- Checklist item toggle gets an accessible name (item text); progressbar gets `aria-label`/`aria-valuetext`.
- Return focus to the card/trigger after dialog close; keep the focus trap.
- Fix contrast tokens: `Block type`, empty placeholder, active tab, label chip, activity tab (target AA; use axe pairs).
- Semantics: one `h1` for the page/board, one `main` per page (dialog should not introduce a second `main`), insert-zone `li` inside a list.
- Add axe-core checks to the card/board suite; do not weaken existing a11y expectations.
- Tests: axe on card/board light+dark; keyboard open→Escape→focus returns; checklist toggle name.
- Files: `CardChecklists.tsx`, `CardDialog.tsx`, `BoardTitle.tsx`, theme tokens, a11y tests.

#### 177.16 — First-run and board metadata (U-05) · P2, S/M

- Empty-state `New board` asks for a name (reuse the switcher input) instead of creating “New board”.
- Add a first-run template/example (columns + one sample card/checklist) or a clear “start empty” choice.
- Make rename discoverable: pencil/menu next to the title, not only click-on-heading.
- Tests: first board named by user; template path; rename via visible control; keyboard.
- Files: `App.tsx`, `BoardSwitcher.tsx`, `BoardTitle.tsx`, empty states, locales.

#### 177.17 — Comment delete safety (U-06) · P2, S

- Confirm dialog shows the comment excerpt/author, not a generic “Delete this comment?”.
- Add undo (toast action) where feasible; if undo is not possible, say “cannot be undone” honestly and keep the excerpt.
- Touch target ≥44 px; `no-hover` visibility is already 177.8, this subtask covers the dialog/undo.
- Tests: confirm shows excerpt; cancel keeps comment; undo restores; touch target.
- Files: `CardComments.tsx`, `ConfirmDialog`, locales, tests.

#### 177.18 — Mobile safe-area and card metadata (U-07) · P3, S

- Add `viewport-fit=cover` and `env(safe-area-inset-*)` padding for header/dialogs/sticky footers; check standalone iOS.
- Fix card label clipping: reserve space for hover actions or move actions so the label is readable; test 390 and 1440.
- Tests: viewport meta snapshot; Playwright 390 no overflow; label visible under hover/touch.
- Files: `ui/index.html`, shell/dialog CSS, `CardItem.tsx`.

#### 177.19 — Bulk card actions (U-08) · P3, M — product decision

- Multi-select cards in board/table; bulk move, archive, delete, label/assignee where supported.
- Reuse command batch/plan; confirmation for destructive; preserve undo/rollback semantics.
- Product decision: if the target is Trello-class, this can be a later wave; it remains in TASK-177, not forgotten.
- Tests: select across columns, bulk move/archive/delete, partial failure, keyboard.
- Files: board selection state, command batch/plan client, bulk action bar, locales.

#### 177.20 — Watchers, saved views, assignment/due notifications (U-09) · P3, L — product decision

- Card/board follow or watch; saved filter views; assignment/due notifications (respect preferences).
- Reuse attention infrastructure; deep links; read/read-all via 177.6.
- Product decision: scope can be split into follow-up waves, but the item stays in TASK-177.
- Tests: follow/unfollow, notification on change, saved view restore, opt-out.
- Files: follow model/API or attention subscription, board filter state, NotificationsBell.

### 9.3 Already covered / duplicates

| UI-roast finding | Already covered by |
| --- | --- |
| Edit own comment | TASK-176.2 |
| Comment draft loss | 177.3 (G-04) |
| Touch delete visibility | 177.8 (G-12) |
| Attention inbox / `notifyAttention` | 177.6 (G-16) |
| Self-leave | 177.2 (G-02) |
| Share edit / revoke confirm / per-board export | 177.1, 177.7, 177.8 (G-01/G-08/G-14) |
| Switcher archived count / Comments badge | 177.8 (G-11), 177.3 (G-05) |
| Global search cap/grouping | 177.10 (G-17) |
| Account sessions list/revoke | TASK-174.2 (`launch-gaps-human-control.md`) |
| Global approval entry | 177.6/177.14 |

## 10. Updated order

1. 177.3 (P1 data loss), 177.15 (a11y), 177.17 (delete safety).
2. 177.1 + 177.5 + 177.8 + 177.16 + 177.18.
3. 177.2, 177.6, 177.13, 177.14.
4. 177.10, 177.11, 177.12.
5. 177.4, 177.7, 177.9, 177.19, 177.20 after decisions.

All items remain in TASK-177; this order is about risk and dependencies, not scope cuts.
