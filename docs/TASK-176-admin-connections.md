# TASK-176 — Admin connections, honest data, and comment editing

**Status:** planned  
**Base:** `main` = `a858c75`  
**Source:** `design/admin-connections-review/REVIEW.md` (independent verification of `design/admin-ui-study/MISSING-CONNECTIONS.md`)  
**Scope:** master panel `/admin/*`, shared admin DTOs, admin backend, comment editing in the normal user product.

This document turns the audit into an executable task. It does not re-open intentional product boundaries; those are listed in §2 and §10.

---

## 1. Why

The master panel is a support/moderation/investigation console, not a second board client. That boundary is deliberate. However, the audit confirmed four real bugs and a set of product gaps that are **not** deliberate:

- a bulk action can confirm N selected rows but silently apply only the IDs visible on the current page;
- global search can land on a card where the found comment/attachment is outside the first 50 rows;
- profile and card tabs show limited samples while presenting them as complete lists;
- several identity links and addressable filters are missing even though the data and routes already exist.

Separately, the product has no way for a user to edit their own comment, although comments are otherwise a first-class collaboration feature. TASK-176 adds that capability as a normal user feature, not as an admin override.

## 2. Goals and non-goals

### Goals

1. Make every bulk confirmation truthful: what the UI counts is exactly what the server applies.
2. Make limited result sets honest: exact totals where they exist, `N of M` / `Load more` where they do not.
3. Add direct, addressable navigation between existing entities: comment author, timeline actor, last actor, inviter, board/column/label filtered lists, audit target.
4. Preserve list context across navigation (search, filters, pagination, return path).
5. Add per-row moderation actions where the API already exists.
6. Add **author-only comment editing** in the normal user UI, with API, realtime, tests and docs.
7. Provide a small, auditable admin content-editing pilot (description + move card) without turning `/admin` into a full board client.

### Non-goals / deliberate boundaries

- Do **not** make `/admin/cards/:id` a full card editor in this task. A narrow pilot is 176.8; the broad editor is a separate product decision (176.9).
- Do **not** add a master-wide agent control section. The agent contour stays in `/agents` and the board-scoped `AgentControlDialog` (176.11).
- Do **not** allow masters to edit other users' comment text. 176.2 is author-only. Admin editing of someone else's comment is a separate product/attribution decision.
- Do **not** weaken tests, remove audit, or make destructive operations silent.
- Do **not** turn pagination limits into "everything at once". Performance and explicit limits stay; only their presentation becomes honest.

## 3. Subtask map

| ID | Title | Priority | Effort | Verdict | Wave |
| --- | --- | --- | --- | --- | --- |
| 176.1 | Bulk selection contract | P1 | S | Real bug | 1 |
| 176.2 | Author-only comment editing | P1 | M | New user feature | 1 |
| 176.3 | Honest counters and paginated samples | P1 | M | Real bug | 1 |
| 176.4 | Direct identity links + OPERATOR fallback | P2 | S | Product gap | 2 |
| 176.5 | URL list state + exact search target | P2 | M | Real bug / gap | 2 |
| 176.6 | Addressable `boardId` / `columnId` / `labelId` filters | P2 | M | Product gap | 2 |
| 176.7 | Per-row moderation actions in profile/card | P2 | S | Product gap | 2 |
| 176.8 | Admin editing pilot: description + move card | P2 | M | Product decision | 3 |
| 176.9 | Broader admin card editing | P3 | L | Product decision | 3 |
| 176.10 | Command ↔ audit correlation and master attribution | P3 | M | Product decision | 3 |
| 176.11 | Admin agent section / boundary documentation | P3 | S | Deliberate boundary | done (docs-only) |
| 176.12 | Checklist-item browser / search | P3 | M | Low value | deferred |

Waves are a recommendation, not a hard dependency. 176.1–176.3 are the first PR set. 176.4–176.7 can run in parallel after the first merge. 176.8–176.10 require explicit product sign-off; 176.11 is closed as a docs-only boundary.

---

## 4. 176.1 — Bulk selection contract (P1, S)

### Problem

`ui/src/admin/EntityPage.tsx` keeps `selected` across pages but builds the request as:

```ts
const ids = visibleIds.filter((id) => selected.has(id));
```

The panel and confirm dialog use `selected.size`. A user selects A on page 1 and B on page 2, sees “2 selected”, confirms “Delete 2 items”, and the server receives only `[B]`. The toast says success and `selected` is cleared, so A silently survives.

### Required contract

Adopt one contract and make counter, confirmation and request identical:

**Selection lives across pages; the action applies to all saved IDs. Search/status/period/limit changes clear the selection; offset/page changes do not.**

- `runBulk` sends `Array.from(selected)`, not `visibleIds.filter(...)`.
- Guard the backend `AdminBulkDto` cap (500 IDs): if `selected.size > 500`, block with a clear message before the request; do not let six pages of 100 produce a 400.
- Clear selection on `search/status/period/limit` changes. Keep it on pagination.
- Show `N selected (M on this page)` if it helps; the confirmation must say “Apply to N selected?”.
- Partial failure keeps only failed IDs selected, as today, but only for the IDs actually sent.
- Do not change the backend contract unless a clearer `413/422` message for >500 is needed.

### Files

- `ui/src/admin/EntityPage.tsx`
- `ui/src/admin/use-admin-list.ts` (selection reset hook / filter-change wiring)
- `ui/src/admin/EntityPage.skeleton.test.tsx` or a new focused component test
- `backend/src/admin/dto/admin-v3.dto.ts` (read-only confirmation of 500 cap)
- `e2e/tests/admin/boards.spec.ts` (extend B5) or a new bulk spec

### Acceptance criteria

- Cross-page delete/restore applies to every selected ID; server body equals the visible count.
- Changing search/status/period/limit clears selection; changing page does not.
- >500 selected is blocked client-side with a clear message; no silent truncation.
- Partial failure leaves exactly the failed IDs selected and reports them.
- Unit/component test with two mock pages and an E2E with 26+ rows / page size 25.

### Tests

- Component: page 1 select A, page 2 select B, run bulk → request `["A","B"]`.
- Component: filter change clears selection; page change preserves it.
- E2E: delete both, verify both gone; restore both; partial failure path.

---

## 5. 176.2 — Author-only comment editing (P1, M)

### Product requirement

A user must be able to edit **their own** comment. This is a normal product feature, not an admin moderation action. Other users, viewers and masters cannot edit someone else's comment. Deleted comments cannot be edited. The edit preserves the comment kind and any inline attachments.

### Backend

- Add `Comment.editedAt DateTime?` to `backend/prisma/schema.prisma` (nullable; existing rows are not edited). A migration is required.
- Add `PATCH /comments/:commentId` (or `PATCH /cards/:cardId/comments/:commentId` if the existing `CardAccessGuard` requires a card param; follow the delete route’s guard pattern). Body: `{ text: string }`.
- Validate: non-blank, `LIMITS.comment`, card/board membership, comment exists and `deletedAt: null`.
- Author check: only `comment.authorId === current user.id`. Non-author → `403` with a stable code (e.g. `comment_forbidden` or the existing `forbidden` envelope); deleted → `404`.
- Update `text`, set `editedAt = now()`; do not change `createdAt`, `kind`, `authorId`, attribution fields or `deletedAt`.
- Reconcile inline attachments: call the same `reconcileDescriptionAttachments(tx, boardId, oldText, newText)` path used by create, so removed/added inline media does not leak.
- Write an `Activity` row `comment_updated` with `{ commentId, text }` in the same transaction, and emit an SSE activity frame `kind: "comment_updated"` with the comment id in `detail`. Add `comment_updated` to `ACTIVITY_EVENT_TYPES`.
- Keep the existing idempotency/attribution semantics; a PATCH is naturally idempotent, no new idempotency key is required.
- Do not add an admin override in this subtask.

### Shared/API

- `CommentDto` gains `editedAt?: number` (Unix ms) and the UI can render an “edited” marker.
- `ui/src/api/client.ts` gains `updateComment(commentId, text)`.
- Add the route to REST docs and the OpenAPI document (coordinate with TASK-166.11 if it is still in flight).
- MCP: out of scope for 176.2. If agents should edit their own comments later, add a tool after 166.11 and update the pinned tool count explicitly.

### UI

- `ui/src/components/board/CardComments.tsx`: for a comment authored by the current user, show an `Edit` action next to `Delete` (VIEWER never sees either).
- Inline edit with the existing `CommentEditor` (or a compact textarea with the same limit/counter) prefilled with the current text; `Save` / `Cancel`; `Ctrl/Cmd+Enter` saves, `Escape` cancels.
- Save updates the row in place (optimistic or after response), sets the “edited” marker and keeps the list position. On error, restore the original text and show the existing toast pattern.
- Do not allow editing while sending; do not lose the draft on a failed save.
- `CommentDto.editedAt` → localized “edited” label with a timestamp tooltip; `ui/src/utils/activity.ts` gets a `comment_updated` sentence.
- Realtime: a second tab receives `comment_updated` and updates the row (or refetches the newest page) without a reload.
- Admin card detail shows the edited marker but still has no edit control.

### Acceptance criteria

- Author edits own comment; text and `editedAt` update; `kind` and inline attachments survive.
- Non-author, VIEWER, anonymous and PAT-without-author get a documented 403/404; deleted comment cannot be edited.
- Empty/over-limit text is rejected consistently with create.
- Activity feed shows `comment_updated`; second tab updates live.
- Admin panel shows the edited marker, not an edit action.
- EN/RU copy, API docs, user guide, CHANGELOG.

### Tests

- Backend e2e: author success; non-author 403; deleted 404; blank/limit 400; activity + SSE; attachments reconciliation.
- UI unit: edit action visibility (own vs other), save/cancel, error restore, edited marker.
- E2E: author edits a comment; another user cannot; second tab sees the update.
- Regression: create/delete/list comments and comment counts unchanged.

---

## 6. 176.3 — Honest counters and paginated samples (P1, M)

### Problem

Profile and card detail show limited samples as if they were complete:

- profile: memberships/created/assigned cards `take: 100`, comments/attachments/sessions/tokens/commands/activity `take: 25`, `cardsCreated = createdCards.length`;
- card: comments/attachments `take: 50`, timeline merged and sliced to 50, no pagination or “last 50” label;
- deleted/revoked rows occupy the same slots and can push live rows out.

### 176.3.1 — Profile

- Use exact `counters` where available; for `cardsCreated`, either compute an exact total or label it “last 100 derived from commands” — never present a sample as a total.
- Tabs show `25 of N` (or `100+` when no exact count) and offer `Load more` / pagination.
- Default to live rows; show deleted/revoked behind an explicit filter or badge. Do not let deleted rows crowd live rows.
- Make the definitions of tab counts and `counters` consistent; document any intentional difference.
- Test with >25 comments, >25 sessions, >100 cards, and >25 deleted comments.

### 176.3.2 — Card detail

- Comments/attachments: paginate or `Load more`; show `50 of N`; use existing `commentIds` / `attachmentCount` where exact.
- Timeline: show `50 of N` or add pagination; do not silently slice.
- Exclude soft-deleted rows by default; provide an explicit “show deleted” control if moderation needs it.
- Add an anchor/highlight path for a specific comment/attachment coming from search (see 176.5).
- Test a card with >50 comments, >50 attachments and deleted rows.

### 176.3.3 — Docs and UI copy

- Admin docs must state the real limits and the meaning of each counter; no “count” that is actually a page length.
- Add a small `N of M` component or reuse an existing one; keep the layout stable on mobile.

### Files

- `backend/src/admin/admin-entities.service.ts`
- `shared/src/admin.ts` (`AdminUserDetailDto`, `AdminCardDetailDto` counters/totals)
- `ui/src/admin/UserDetailPage.tsx`, `ui/src/admin/CardDetailPage.tsx`
- admin docs EN/RU
- e2e/backend tests for >limit data

### Acceptance criteria

- No tab or block presents a sample as a full total.
- `cardsCreated` is either exact or explicitly labelled as a limited derivation.
- Deleted/revoked rows no longer hide live rows by default.
- Load more/pagination works and is keyboard accessible.

---

## 7. 176.4 — Direct identity links + OPERATOR fallback (P2, S)

### Required links

- `comment.authorId` → `/admin/users/:id` on card detail (the moderation list already links it).
- `timeline.actorId` → profile on card detail; fallback to text for deleted/missing users.
- `lastActorId` → add it to `AdminCardDetailDto` (the service already reads it) and link “Last changed by”.
- `invitedById` → add it to `AdminUserMembershipDto` (the service already reads it) and link “Invited by” on board and user detail.
- Audit target: map compatible `targetType` values (`user`, `board`, `card`) to routes; `null`/unknown → text + copyable id.
- Audit actor: if the current master is `OPERATOR`, do not render a link to the owner-only masters page; show text instead of a 403 screen.

### Files

- `ui/src/admin/CardDetailPage.tsx`, `BoardDetailPage.tsx`, `UserDetailPage.tsx`, `entity-configs.tsx`
- `backend/src/admin/admin-entities.service.ts`
- `shared/src/admin.ts`
- `ui/src/admin/entity-configs.test.tsx` or focused tests

### Acceptance criteria

- Every existing ID is a working link; deleted targets degrade to text, not a broken route.
- `OPERATOR` never gets a 403 from an audit row link.
- No email is used as an identifier when an ID exists.
- Keyboard focus and accessible names are preserved.

---

## 8. 176.5 — URL list state + exact search target (P2, M)

### Problem

`useAdminList` keeps `search/status/period/limit/offset` in local state; detail back-buttons go to fixed routes. Global search links a comment/attachment to a card without the object id or anchor, and the card may not have that row in its first 50.

### Required behavior

- Serialize list state into URL query params and restore it on load/back/forward.
- Preserve `returnTo` when navigating to user/board/card detail; the back control returns to the exact filtered page.
- Global search for a comment/attachment:
  - pass the object id and open the exact moderation row or card section;
  - if the object is outside the loaded page, fetch the page around it or show a clear “found but not in the first page” path;
  - label results so the user knows what was found.
- Add a shared helper for typed query-state (avoid ad-hoc `URLSearchParams` in every page).
- Do not put transient secrets in URLs.

### Acceptance criteria

- Reloading a filtered list restores search, status, period, page and page size.
- Back from detail returns to the same filtered page; browser back/forward works.
- A comment/attachment found in global search is visible and highlighted after navigation, regardless of the 50-row first page.
- Links are shareable; no hidden state is required.

---

## 9. 176.6 — Addressable `boardId` / `columnId` / `labelId` filters (P2, M)

### Problem

Board counters are plain text; column and label rows do not lead to their exact cards. A name search is ambiguous and cannot replace an ID filter.

### Required behavior

- Extend the admin list query DTO with structured `boardId`, `columnId`, `labelId` (and `cardId` where useful), validated as IDs.
- Apply them server-side with the same status/period semantics as existing lists; document whether deleted/archived rows are included.
- Link board counters (`cards`, `comments`, `attachments`, `commands`, `activity`) to the corresponding list with the exact `boardId`.
- Link a column to its cards (`?columnId=...`) and a label to its cards (`?labelId=...`); link card titles to `/admin/cards/:id`.
- Do not add a new top-level `cardLabels` tab merely because the endpoint exists; filter cards instead.
- Preserve the filter in the URL (depends on 176.5).

### Acceptance criteria

- “Comments on this board” opens exactly that board's comments, including same-name boards.
- “Cards in this column” and “cards with this label” are exact and paginated.
- Deleted/archived entities have a documented, consistent behavior.
- No cross-board leakage; permissions checked.

---

## 10. 176.7 — Per-row moderation actions in profile/card (P2, S)

The APIs already exist; the detail pages do not expose them.

- User profile comments: delete a single comment (same confirm/audit as moderation list).
- User profile sessions: revoke a single session.
- User profile tokens: revoke a single token.
- Card detail comments/attachments: delete the specific row.
- Reuse existing admin endpoints and confirmation patterns; refresh the row/list after success; show API errors; keep revoked/deleted rows visible with their state.
- Add tests for success, 403, already-revoked/deleted, and refresh.

Do not add master-authored comments/uploads in this subtask; authorship policy is a separate decision (§11).

---

## 11. 176.8 — Admin editing pilot: description + move card (P2, M) — product decision

This is the smallest useful admin content edit. It does **not** open the full editor.

- Add an edit control for the card description on `/admin/cards/:id` (currently read-only).
- Add a move-card control in the content editor (currently only add/rename/archive/update title).
- Submit through `POST /admin/boards/:id/commands` with `UPDATE_CARD` / `MOVE_CARD`, using the existing strict validator, WIP/version checks and command log.
- Show an explicit banner: “You are acting as the board owner; this change appears as the owner in the board history.”
- Add `commandId` (or a correlation id) and `masterId` to the admin audit for these actions before shipping; do not silently attribute a master edit to the owner.
- Keep it behind a product flag until attribution is accepted.

Do not proceed without owner sign-off. If approved, ship separately from 176.1–176.7.

---

## 12. 176.9 — Broader admin card editing (P3, L) — product decision

Not a bugfix. It covers assignee, due date, priority, cover, labels, checklists and links. The commands exist, but the product must decide:

- whether a master may edit user content at all;
- how the action is attributed in the board timeline and audit;
- whether there is an “edit as master” vs “edit as owner” mode;
- what happens on version conflicts and deleted entities.

If approved, start with one field at a time behind the 176.8 attribution model. Do not build a full card editor first.

Master-authored comments/uploads are also a separate product decision: decide the author identity, history display and responsibility before adding the controls.

---

## 13. 176.10 — Command ↔ audit correlation (P3, M) — product decision

- Add a stable `commandId` to the admin audit details for `board.command` (new rows first; backfill only if reliable).
- Add an internal “open audit entry” link from the command row and the card timeline.
- Surface the actual master and the technical actor without changing board-facing attribution unless the product decides to expose master actions to board members.
- Test historical rows without the correlation, deleted boards/cards and OPERATOR access.

---

## 14. 176.11 — Admin agent section (P3, S) — closed (docs-only)

Do not add a cross-board agent control section to `/admin`. The agent contour is
board-scoped by design. The deliverable is documentation:

- state in the admin docs and ADR that `/admin` does not manage agent runs/approvals/policy;
- explain where the user/board admin finds them (`/agents`, `AgentControlDialog`);
- if cross-board oversight is needed later, open a separate task with a master API, audit and permission model.

**Delivered (2026-11-13, docs-only, no code/UI/API changes):**

- `site/src/content/docs/docs/admin/index.md` and the RU counterpart gained an
  explicit boundary section: no runs/approvals/policy control and no
  cross-board agent section in `/admin`; `/agents`, board Agent Control and
  Board Settings → Agents & automation are named as the real surfaces, and
  token revocation in Access is described as account administration, not agent
  control.
- `site/src/content/docs/{docs,ru/docs}/admin/redesign.md` state that the eight
  hubs are the whole panel and there is deliberately no Agents hub.
- ADR-166 §2 principle 5 and new §18 record the same boundary and the future
  process (master API, permission model, audit).
- `CHANGELOG.md` and `ROADMAP.md` record the closure.

TASK-179 remains the owner of the `/agents` and board agent-control UX; this
subtask only fixes the admin boundary and does not duplicate that design.

---

## 15. 176.12 — Checklist-item browser (P3, M) — deferred

A separate top-level checklist-item browser has low value. If search across checklist items is needed, add a filter (`checklistId`, text) and an anchor into the card, not a new entity tab. Revisit after 176.5/176.6.

---

## 16. Audit-to-subtask map

| Audit item | Subtask |
| --- | --- |
| 1 comment author link | 176.4 |
| 2 timeline actor link | 176.4 |
| 3 last actor id/link | 176.4 |
| 4 inviter id/link | 176.4 |
| 5 board → filtered lists | 176.6 |
| 6 column → cards | 176.6 |
| 7 label → cards | 176.6 |
| 8 checklist-item browser | 176.12 |
| 9 audit target/actor; OPERATOR 403 | 176.4 + 176.10 |
| 10 command ↔ audit | 176.10 |
| 11 global search exact target | 176.5 |
| 12 per-row actions in profile | 176.7 |
| 13 admin agent section | 176.11 |
| 14 return-to-list context | 176.5 |
| 15 profile limits/counters | 176.3 |
| 16 card limits/counters | 176.3 |
| Bulk-selection bug | 176.1 |
| Edit card description | 176.8 |
| Move card in content editor | 176.8 |
| Other card fields / labels / checklists | 176.9 |
| Edit comment text | 176.2 (author-only) |
| Master edits someone else's comment | product decision, not in 176.2 |
| Files/comments from profile/card | 176.7 |

---

## 17. Cross-cutting definition of done

Every subtask PR must include:

- tests at the right level (unit/component/backend e2e/browser) and no weakened expectations;
- EN/RU user/API docs where behavior or copy changes;
- `CHANGELOG.md` entry;
- audit/activity coverage for new writes;
- keyboard and focus checks; no horizontal overflow at 390 px for UI work;
- `npm run format:check`, lint, typecheck and the relevant test suites;
- no unrelated refactors or formatting churn.

Suggested PR split:

1. **176.1** — one small PR, highest urgency.
2. **176.2** — backend + shared + UI + docs in one PR (migration included).
3. **176.3** — one PR, optionally split profile/card if large.
4. **176.4 + 176.7** — one small “navigation/actions” PR.
5. **176.5** — one infrastructure PR; **176.6** follows.
6. **176.8** — only after explicit product sign-off; separate PR.
7. **176.9 / 176.10** — separate product decisions.

## 18. Open product decisions

1. Comment editing: should masters ever edit another user's comment? (Current answer: no; author-only.)
2. Should a master edit appear as the owner or as the master in board history? (176.8 must answer before shipping.)
3. Is cross-board agent oversight needed in `/admin`, or is `/agents` + board dialog enough? (Current answer: enough; recorded as a deliberate boundary in the admin docs and ADR-166 §18 by 176.11.)
4. Is cross-page bulk selection the desired contract, or should selection be page-local? (176.1 recommends cross-page with a 500 guard.)
5. Should deleted/revoked rows be hidden by default or shown with a filter? (176.3 recommends hidden by default with an explicit filter.)
