# TASK-181 — Admin list filters and discoverable filter UX

**Status:** planned

**Revision:** 8 (2026-11-20) — records the TASK-181.4 moderation filters and
their performance evidence.

**Priority:** P1 for the shared contract and cards, P2 for the remaining hubs

**Source:** read-only research of the current master panel, 2026-11-19 — code in
`ui/src/admin/*`, `backend/src/admin/*`, the merged TASK-176.5/176.6 foundation,
the TASK-176.9 review tree `7bb2848b`, and a manual 1440/390 pass over `/admin`
(master demo account; 1024 is covered by the existing admin breakpoints and by
the implementation test matrix).

**Baseline:** `main` @ `002a31ec`; TASK-176.1–176.7 are already in `main`
(176.5/176.6 landed via PR #268); TASK-176.8–176.10 live in review branches and
are not required for this task. The one exception is the advanced `commandId`
chip/correlation: it exists only after TASK-176.10 merges; every other filter
ships without it.

**Branches:** one `feat/TASK-181.x-*` branch and PR per subtask; do not combine
the whole backlog in one PR.

## 1. Why

TASK-176.6 made admin lists addressable: `boardId`, `columnId`, `labelId` and
`cardId` are validated, sent to the server, kept in the URL and preserved through
`returnTo`. That foundation is real and should not be rebuilt.

The human last mile is missing:

- the only way to add a structural filter is to type it into the URL;
- the filter row is display/remove only;
- chips render raw ids (`b-1`, `col-2`, `label-3`), which are unreadable and
  ambiguous when two boards, columns or labels share a name;
- switching a hub tab drops the list context;
- the parser accepts every known filter key on every list, while the service
  ignores keys that do not apply — a chip can look active and change nothing;
- the remaining high-value facets (assignee, author, priority, due, comment
  kind, command type, audit action, attachment type) have no UI and, for most of
  them, no query parameter at all.

The master panel is a support, moderation and investigation console, not a
second board client. Filters are the primary way an operator narrows a global
list to the object a user is asking about. This task makes that narrowing
discoverable, honest and deep-linkable without turning `/admin` into a board UI.

## 2. Current state (evidence)

### 2.1 UI

| Area | Current behavior | Consequence |
| --- | --- | --- |
| `EntityPage.tsx` | Renders `activeFilters` from `useAdminListQuery`; each chip shows `list.filters[key]` verbatim; only an `X` and `Clear filters` | No "Add filter"; raw ids; cannot discover available facets |
| `admin-list-query.ts` | One global `AdminListFilters` object; base main has `boardId`/`columnId`/`labelId`/`cardId`, all single-valued; TASK-176.10's review tree adds `commandId` | Every entity parses keys it does not support; no multi-select |
| `use-admin-list.ts` | Sends every non-null filter to every fetcher | Unsupported filters are silently ignored server-side |
| `use-admin-list-query.ts` | URL ↔ list two-way sync; search replaces history, filters/status/period push | Good foundation to extend; do not replace |
| `entity-configs.tsx` | Per-entity status tabs and optional `periods` (only some lists define it); no facet metadata | The page cannot know which filters an entity supports |
| `hubs/HubTabs.tsx` | `hubTabHref` writes only `?tab=` | Switching tabs loses `boardId`, search and every filter |
| `AdminCommentRowDto` | No `kind` field; comments list does not show it | A kind filter would be invisible and unverifiable in the row |
| `AdminAttachmentRowDto` | `boardTitle` is hard-coded to `—` | A board filter has no readable row label to derive from |
| `SharesPage.tsx` | Fixed `limit: 100`, no pagination (TASK-177.5 owns) | Not a filter target in this task |
| `UserDetailPage` / `CardDetailPage` | Only a `live`/`all` toggle per window | Parent scope already narrows; no v1 filters here |
| `MastersPage` | No search or filters; small owner-only roster | No filters needed |
| `SecurityPage` | Bounded recent-alert list, not a full log | No filters until a real event list exists |

The manual 390 check confirmed the filter row itself wraps, but the status tab
strip clips horizontally and the chip still shows a raw id. At 1440 the row is
readable but has no add control. There is no horizontal page overflow today;
the new UI must keep it that way.

### 2.2 Backend

`AdminListQueryDto` on base main validates `boardId`, `columnId`, `labelId` and
`cardId` as id-shaped strings; TASK-176.10's review tree adds `commandId`. The
services apply these combinations on the base:

- users: `search`, `status` only — no date range;
- boards: `boardId`, `columnId`, `cardId`, `labelId`;
- cards: `boardId`, `columnId`, `labelId`, `cardId`, `status` — **no
  `from`/`to` predicate** and no period tab;
- columns: `boardId`, `columnId`, `cardId`, `labelId`;
- labels: `boardId`, `labelId`, `cardId`, `columnId`;
- checklists and checklist items: the shared card scope
  (`boardId`, `columnId`, `cardId`, `labelId`);
- card links: `boardId`, `cardId` (either side);
- comments: `boardId`, `columnId`, `labelId`, `cardId`, `status`, `from`/`to`;
- attachments: `boardId`, `cardId`, `columnId`, `labelId`, `status` — no
  `from`/`to`;
- activity: `boardId`, `cardId`, `columnId`, `labelId`, `from`/`to`;
- commands: `boardId`, `columnId`, `cardId`, `commandId` (176.10), `from`/`to`;
- audit: `commandId` (176.10), `from`/`to`;
- sessions: active-only rows plus `from`/`to`; tokens: `status` plus
  `from`/`to`; shares: `boardId` plus `from`/`to`; board members:
  `boardId`/`status`; announcements: `status`.

Period tabs exist today only on Activity, Command log, Audit, Sessions and
Tokens. **Cards, users, comments and attachments have no period tab**; comments
already accept `from`/`to`, while cards, users and attachments need the backend
predicate before a tab is added.

There is no server-side filter for card priority, assignee, due date,
attachments, comment kind, command type/actor, audit action/actor/target type,
or attachment MIME type. `AdminPage.total` is the exact server count (TASK-176.3)
and must stay the only source of result counts.

### 2.3 What is already good and must survive

- URL round-trip, browser back/forward and `returnTo` (TASK-176.5).
- Exact structural filters, including same-name boards (TASK-176.6 e2e).
- Bulk selection: survives pagination, cleared by a result-set change
  (TASK-176.1). New filters must join its scope key.
- Exact server totals with **Page X of Y** pagination on global lists. Detail
  windows are unchanged by this task.
- The panel's support vocabulary: ids are clickable/copyable, labels are
  secondary; filters must not replace exact ids with name-only matching.

## 3. Goals and non-goals

### Goals

1. Add a discoverable, keyboard-accessible "Filters" surface to the admin lists
   where filtering is genuinely useful.
2. Show human-readable chips (names, emails) with a short-id fallback only for
   deleted, missing or inherently id-only values.
3. Define a per-surface filter allowlist so an unsupported filter can never
   appear as a no-op chip.
4. Add the confirmed high-value facets: card assignee/priority/due/attachments,
   comment author/kind, attachment uploader/type, command actor/type, audit
   actor/action/target, plus the existing board/column/label scopes.
5. Keep URL state, deep links, pagination, exact totals and bulk selection
   truthful.
6. Cover EN/RU, 1440/1024/390, keyboard/focus and screen-reader labels.
7. Keep the change shippable in reviewable slices, with measured query plans and
   no speculative filters on every list.

### Non-goals

- No board-client filtering semantics on `/admin`; no drag/drop, editing or
  saved board views.
- No changes to the user-facing board `FilterBar`; reuse its semantics, not its
  component.
- No cross-board agent section (TASK-176.11 boundary still holds).
- No new top-level checklist-item browser in this task (TASK-176.12 remains
  deferred; see §5.3).
- No shares pagination/filtering (TASK-177.5 owns it).
- No session-status truthfulness, token inventory redesign or security-event
  log (separate tasks; see §5.6).
- No per-user saved filter sets, localStorage auto-restore, saved views,
  notifications or CSV export.
- No MCP or public API exposure of admin filters.
- No filter-option counts in v1; only exact result totals from `AdminPage`.

## 4. Design principles

1. **The list owns the contract.** Each entity declares its *supported* facets
   (parser, request, chips and backend validation) and its *offered* facets (the
   Add filter menu). A supported filter from an old URL is applied and shown,
   even if it is no longer offered; an unsupported one is dropped in the UI and
   rejected by the API.
2. **Exact ids, human labels.** Choose an entity by a searchable name, store
   only its id in the URL, resolve the label through the server. Never use a
   name as the filter value.
3. **Truth over decoration.** No chip without an effect; no count derived from
   loaded rows; no "all" label when the list is a sample; no silent fallback
   from a missing filter to an unfiltered list.
4. **Atomic deploy, explicit failure.** The admin UI and API ship from the same
   image/version; there is no promise that a new UI works against an old API.
   Old *URLs* remain supported by the matrix in §5.8. If the API answers
   `unsupported_filter`, the UI shows an explicit error with a Remove action and
   never leaves a chip that appears to filter an unfiltered list.
5. **Confirmed before speculative.** Ship the facets that answer a real support
   question; record the rest as deferred with a trigger.
6. **The URL is the saved view.** No hidden per-user filter memory. A shared
   link, reload and back/forward reproduce the same list.

## 5. Surface inventory and filter decisions

### 5.1 Users

Route: `/admin/users` (no hub tabs).

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Status | `status=active\|disabled` | Existing primary axis; blocked-account support | existing |
| Verified | `verified=true\|false` | TASK-53/59 leaves unverified accounts; support cleans up stuck signups | 181.5 |
| Period | `period=24h\|7d\|30d` over `createdAt` | Recent registrations, abuse clusters, onboarding issues; this task adds `periods: true` and `from`/`to` predicate | 181.5 |

Omitted: board/column/label, assignee, priority, due, author, actor, action,
attachments. A user is not a board row; membership is already a tab on
`/admin/users/:id` and a table on board detail. Filtering users by board would
duplicate a narrower, already-scoped surface.

### 5.2 Boards

Route: `/admin/boards?tab=boards`.

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Status | `status=active\|archived\|deleted` | Existing; recovery and audit | existing |
| Admin member | `adminMemberId=<user id>` | Exact "boards where this user is an accepted ADMIN"; multiple ADMINs are normal, so this is not the displayed first-admin owner label | 181.5 |

Not offered: column/label/card/assignee/priority/due/attachments (the
column/label/card structural scopes remain supported for old links; see §5.8).
Boards are containers; filtering them by content facets is indirect and slow,
and the board detail page already links to the exact content lists. A
creation-period filter is cheap but low value; defer until support asks.

`AdminBoardRowDto.userId`/`ownerEmail` remain the **displayed** first accepted
ADMIN (createdAt order) for the owner column. The filter does not reuse that
label as "the owner"; it matches every accepted ADMIN membership via
`members.some`, and excludes pending/expired VIEWER and non-admin members.
The multi-admin seed test is required (two accepted ADMINs; both match; a
MEMBER and a pending ADMIN do not).

### 5.3 Board content

Route: `/admin/boards?tab=…`.

#### Cards (`tab=cards`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Existing 176.6 scope; counter links | 181.2 |
| Column | `columnId` (single) | Existing; column → cards | 181.2 |
| Label | `labelId` (repeated) + `labelMatch=any\|all` | Existing single filter; cards carry several labels and "all of" is a real investigation query | 181.2 (single) / 181.3 (multi, all) |
| Assignee | `assigneeId` (repeated) + `unassigned=true` | Find a person's work, unassigned/stuck cards, handoffs | 181.3 |
| Priority | `priority` (repeated; `medium` includes unset) | Triage blockers/highest; aligns with product default | 181.3 |
| Due | `due=overdue\|soon\|none` | Deadline triage; `soon` = next 24 h, same as the board filter | 181.3 |
| Attachments | `hasAttachments=true\|false` | Find cards with/without card-face files; excludes inline and `descriptionDetached=true` rows | 181.3 |
| Status | `status=active\|archived\|deleted` | Existing primary axis | existing |
| Period | `period=24h\|7d\|30d` over `createdAt` | Recent work / incident window; this task adds `periods: true` and `where.createdAt = dateRange(query)` | 181.3 |
| Card id | `cardId` (advanced, paste/URL) | Exact deep link, including from global search | existing |

Omitted: author (cards do not store one; the command log does), actor/action/type
(command surface), `hasLinks`/`blocked` (the board UI has these; no support
workflow has asked for them on `/admin`), comment counts, column title.

#### Columns (`tab=columns`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Exact board scope; existing server support | 181.5 |
| Status | `status=active\|deleted` | Existing | existing |

Not offered: label/assignee/priority/due/card (the label/card structural scopes
remain supported for old links). A column row is already a structural object;
its card count links to the exact cards list.

#### Labels (`tab=labels`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Exact board palette | 181.5 |
| Status | `status=active\|deleted` | Existing | existing |

Omitted: label id (row identity), color, card count, `hasCards`. "Unused labels"
is a possible cleanup query but has no support evidence; defer.

#### Checklists (`tab=checklists`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Exact board scope | 181.5 |
| Card | `cardId` (single) | Exact card scope; drill-down from card detail | 181.5 |
| Status | `status=active\|deleted` | Existing | existing |

Omitted: progress (`doneCount`/`itemCount`), checklist title, assignee. Card
detail already shows the checklist with its items; the global list is for
investigation, not a to-do queue.

#### Card links (`tab=links`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Existing | 181.5 |
| Card | `cardId` (single, either side) | Existing server behavior; "what links touch this card?" | 181.5 |
| Type | `type=blocks\|relates_to\|duplicates` | Distinguish blockers from references and duplicates | 181.5 |
| Status | `status=active\|deleted` | Existing | existing |

Omitted: direction (from/to), label/assignee/priority/due. Direction is a
possible later refinement; it is not needed to answer "what touches this card?".

#### Checklist items

There is an `AdminChecklistItemRowDto` and a generic
`GET /admin/entities/checklistItems`, but **no UI tab**. TASK-176.12 explicitly
deferred a top-level browser as low value and recommended a card-anchored filter
if the need appears. This task keeps that decision.

If support later provides evidence, add a tab (not before) with:
`boardId`, `cardId`, `checklistId`, `done=true|false`, `status`. Until then,
checklist items are read on `/admin/cards/:id`; the generic entity endpoint can
search item text, but the current global search does not index checklist items,
so a text search is not promised here.

### 5.4 Moderation hub

Current structure: **Comments** and **Attachments** tabs.

#### Comments (`/admin/moderation?tab=comments`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Existing; board counter link | 181.4 |
| Card | `cardId` (single) | Exact card thread | 181.4 |
| Author | `authorId` (single) | Find one user's comments across cards | 181.4 |
| Kind | `kind` (repeated: note/status/question/blocker/evidence/handoff) | Triage blockers/questions; TASK-177.11 uses the same enum in the board UI | 181.4 |
| Status | `status=active\|deleted` | Existing | existing |
| Period | `period` over `createdAt` | Recent moderation window; 181.4 adds `periods: true` (backend `from`/`to` already exists) | 181.4 |

Not offered: column/label (indirect; board/card already narrow enough; the
176.6 server scopes stay supported for old links), priority, due, attachments,
assignee. Adding indirect facets to comments would join through cards for little
support value.

#### Attachments (`/admin/moderation?tab=attachments`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Existing; board counter link | 181.4 |
| Card | `cardId` (single) | Exact card files | 181.4 |
| Uploader | `uploadedById` (single) | Find one user's uploads; abuse/investigation | 181.4 |
| Type | `mime=image\|video\|pdf\|document\|other` | Support for file classes; type is visible in the row | 181.4 |
| Status | `status=active\|deleted` | Existing | existing |
| Period | `period` over `createdAt` | Recent uploads / retention window; 181.4 adds `periods: true` and `where.createdAt = dateRange(query)` | 181.4 |
| Transcode | `transcode=pending\|failed\|done\|none` | Find stuck/failed video encodes | 181.4 |

Not offered: column/label (indirect; existing server scopes stay for old links).
**Inline decision (v1):** the admin attachments tab keeps inline rows visible
with an explicit `Inline` badge (and `Detached` for `descriptionDetached=true`),
so they can be moderated/downloaded; there is no inline filter in v1. The card
`hasAttachments` filter still reflects card-face files only (non-inline,
`descriptionDetached=false`), so an inline-only card can appear here while its
`No card attachments` chip is active. This is documented and tested, not a
counter mismatch.

Both moderation lists default to **All**, which includes live and soft-deleted
rows. **Active** and **Deleted** use the comment or attachment's own
`deletedAt`. A live row under an archived or soft-deleted board/card still
appears in Active. A valid filter combination with no rows shows a tab-specific
empty message and a clear-filters action. Period bounds are inclusive and
apply to each row's `createdAt`.

MIME matching is case-insensitive against the stored `mimeType`. Images and
videos match their MIME prefixes, PDF matches `application/pdf`, and Documents
covers `text/*`, RTF, and legacy and Open XML Office formats. Other covers
the remaining types, including JSON, audio and archives. Video processing
matches the stored `transcodeStatus`. **No transcoding** covers non-video
uploads and videos uploaded with transcoding disabled. Later feature flag
changes do not change those rows' state.

### 5.5 Audit & activity hub

Current structure: **Audit trail**, **Command log**, **Activity**.

#### Audit (`/admin/audit?tab=audit`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Actor / master | `adminId` (repeated) | Exact accountability query over actors present in the audit trail; unknown-email login rows stay reachable by search. Resolution is audit-row-visible for both roles — no general master roster search | 181.6 |
| Action | `action` (repeated, exact code with typeahead) | `user.create`, `board.command`, `admin.login_failed`, … | 181.6 |
| Target type | `targetType` (repeated) | Exact stored type; options come from the server (user/board/card/session/… as present) | 181.6 |
| Target id | `targetId` (single, exact) | Reconstruct one object's full audit trail | 181.6 |
| Command id | `commandId` (single, advanced) | Existing TASK-176.10 correlation (only after that review branch merges) | existing/176.10 |
| Period | `period` over `createdAt` | Existing | existing |

Omitted: board/column/label direct filters (target type + id covers the reliable
fields), status. Audit details are free JSON; do not invent filters over
unvalidated detail keys. The owner-only Masters page remains unchanged and is
not reused as the actor picker: actor options come only from audit-visible rows.

#### Commands (`/admin/audit?tab=commands`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Existing | 181.6 |
| Actor | `actorId` (repeated) | Who issued the command | 181.6 |
| Type | `type` (repeated, exact action type) | ADD_CARD, MOVE_CARD, UPDATE_CARD, … | 181.6 |
| Card | `cardId` (single) | Existing `touches` behavior; exact card history | 181.6 |
| Column | `columnId` (single, advanced) | Existing `touches`; column-level history | 181.6 |
| Command id | `commandId` (single, advanced) | Existing 176.10 deep link (only after that review branch merges) | existing/176.10 |
| Period | `period` over `createdAt` | Existing | existing |

Omitted: status, priority, due, label. A command is an event; its type/actor/
target are the honest facets. `labelId` would require parsing payloads and is not
reliable.

#### Activity (`/admin/audit?tab=activity`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Existing | 181.6 |
| Card | `cardId` (single) | Existing | 181.6 |
| Actor | `actorId` (repeated) | Membership/comment event actor | 181.6 |
| Type | `type` (repeated, exact event type; options from distinct stored values) | Separate membership, comment, approval and agent events; the list has more than four types | 181.6 |
| Period | `period` over `createdAt` | Existing | existing |

Not offered: column/label, status, priority, due (the column/label structural
scopes remain supported for old links). Activity is a mixed event feed; the
event type is the useful split, but do not hard-code a four-value list —
`ACTIVITY_EVENT_TYPES` also contains invite accept/decline, expiry changes,
comment edits/deletes and agent-control events.

### 5.6 Access, communications and detail surfaces

These are **no new filter targets** in v1. They remain in the inventory so the
decision is explicit and does not get reinvented later. Existing period tabs on
Sessions/Tokens stay and are regression-tested.

| Surface | Decision | Reason / owner |
| --- | --- | --- |
| Sessions (`/admin/access?tab=sessions`) | Keep existing period tab; no new user/status filters | The list hard-codes live sessions (`revokedAt: null`, future expiry). A status filter would imply revoked/expired rows exist; make the list truthful first (separate task). |
| Tokens (`/admin/access?tab=tokens`) | Keep existing period tab; no new user/status filters | Backend supports status, but the page has no status tabs; a small follow-up can reuse the filter kit later. |
| Masters (`/admin/access?tab=masters`) | No filters | Owner-only, small roster; search would be more useful than filters. |
| Shares (`/admin/communications?tab=shares`) | Defer to TASK-177.5 | TASK-177.5 owns truthful pagination/expiry. Adding filters before the list is honest would compound the problem. A later pass can add board/mode/status/creator. |
| Announcements history | Active/Disabled in UI; `deleted` is a supported API alias normalized to Disabled in URL state | Small list; status already exists. Period/locale/level filters are speculative. |
| Security (`/admin/settings?tab=security`) | No filters | It is a settings page with a bounded recent-alert panel, not a full security log. TASK-161/168 own a real event list if needed. |
| User detail tabs | No v1 filters | The parent user already narrows comments/attachments/sessions/tokens/commands/activity. Board/period could help later; not worth a second filter system now. |
| Card detail windows | No v1 filters | Parent card + live/all windows are enough; timeline is a command/activity merge, not a filterable log. |
| Board detail members | No filters | Bounded by board membership; table is already scoped to one board. |
| Board content editor | No filters | The column rail is the selector; TASK-176 boundary keeps this a narrow editor. |
| Dashboard recent actions | No filters | Fixed `limit: 8`; it is a summary, not a list. |
| Checklist items | No new tab | TASK-176.12 deferred; see §5.3. |
| Card-label join (`cardLabels`) | No tab | Filter cards by `labelId` instead; do not add a join browser. |

### 5.7 Confirmed vs speculative

**Confirmed useful (in scope):**

- cards: board, column, label (any/all), assignee (+unassigned), priority, due,
  has-attachments, status, period;
- comments: board, card, author, kind, status, period;
- attachments: board, card, uploader, MIME family, transcode, status, period;
- audit: actor/master, action, target type, target id, command id, period;
- commands: board, actor, type, card, column, command id, period;
- activity: board, card, actor, type, period;
- users: status, verified, period;
- boards: status, accepted-ADMIN member;
- columns: board, status;
- labels: board, status;
- checklists: board, card, status;
- card links: board, card, type, status.

**Period model:** period is a **header tab**, never an advanced chip, on every
surface that has it. Cards, users and attachments gain `periods: true` and the
`from`/`to` predicate in their subtasks; comments already have the predicate and
gain the tab. Period is not counted in the Filters badge and is cleared by
Clear search and filters.

**Speculative / deferred (not implemented without evidence):**

- checklist-items tab with `done`;
- attachment inline flag and size buckets;
- card `hasLinks`/`blocked` facets on `/admin`;
- boards period, labels `hasCards`, users locale/notification flags;
- comments column/label, cards comment-count, commands run/token/session/actor
  type;
- audit action groups/prefixes, security-event filters;
- sessions status, tokens user/status, shares filters, announcements period;
- details pages, board members, dashboard;
- saved filter views, filter-option counts, filter presets by role.

### 5.8 Implemented vs offered matrix

`search`, `limit` and `offset` are accepted by every generic list. `status`
follows the existing per-entity allowlist, with `all` accepted everywhere.
The registry's **implemented** set contains predicates shipped on the
surface. The matrix starts from the 181.1 legacy scopes and includes the
181.4 moderation additions. **Offered** records facets planned for the picker.
A picker can expose a facet once its owning wave implements it. Legacy deep
links keep their existing behavior regardless of picker visibility.

The UI parser and request builder use only implemented facets. A hand-edited
deferred facet is omitted from the list request and a direct API call returns
400 `unsupported_filter` until its owning wave enables it. The lookup endpoint
can resolve options for later waves independently of list filtering.

| Entity | Implemented | Deferred until owning wave | Planned or existing menu/header |
| --- | --- | --- | --- |
| users | — | `verified`, `from`/`to` (period) | status, verified, period |
| boards | `boardId`, `columnId`, `cardId`, `labelId` | `adminMemberId` | status, adminMemberId |
| cards | `boardId`, `columnId`, `labelId` (single), `cardId` | repeated `labelId` + `labelMatch`, `assigneeId`, `unassigned`, `priority`, `due`, `hasAttachments`, `from`/`to` | all except `cardId` in the menu; period header; cardId advanced paste/URL |
| columns | `boardId`, `columnId`, `cardId`, `labelId` | — | board, status |
| labels | `boardId`, `labelId`, `cardId`, `columnId` | — | board, status |
| checklists | `boardId`, `columnId`, `cardId`, `labelId` | — | board, card, status |
| checklistItems | `boardId`, `columnId`, `cardId`, `labelId` | — (no tab v1) | none |
| cardLinks | `boardId`, `cardId` | `type` (static `CARD_LINK_TYPES`) | board, card, type, status |
| comments | `boardId`, `columnId`, `labelId`, `cardId`, `from`/`to`, `authorId`, `kind` | — | board, card, author, kind, period, status |
| attachments | `boardId`, `cardId`, `columnId`, `labelId`, `uploadedById`, `mime`, `transcode`, `from`/`to` | — | board, card, uploader, mime, transcode, period, status |
| activity | `boardId`, `cardId`, `columnId`, `labelId`, `from`/`to` | `actorId`, `type` | board, card, actor, type, period |
| commands | `boardId`, `columnId`, `cardId`, `commandId` (176.10), `from`/`to` | `actorId`, `type` | board, actor, type, card, column, commandId, period |
| audit | `commandId` (176.10), `from`/`to` | `adminId`, `action`, `targetType`, `targetId` | audit actor, action, targetType, targetId, commandId, period |
| sessions | `from`/`to` | — | period only (existing) |
| tokens | `status`, `from`/`to` | — | period only (existing) |
| shares | `boardId`, `from`/`to` | — | none (TASK-177.5) |
| announcements | `status` | — | Active/Disabled UI; `deleted` API alias normalized to Disabled in URL state |
| boardMembers | `boardId`, `status` | — | none |
| cardLabels | `boardId`, `columnId`, `labelId`, `cardId` | — | none (no tab) |
| admins | owner-only custom endpoint, no generic filter | — | none |

Every implemented pair has a table-driven e2e case. Cards use legacy
single-label equality in 181.1 and 181.2. Repeated `labelId` and any
`labelMatch` return 400 `unsupported_filter` on cards until 181.3. Other
legacy lists retain a single-value `labelId`.

## 6. UX specification

### 6.1 Anatomy

```
Cards                                             [Search…] [All][Active][Archived][Deleted]
[ Filters (2) ]  [Board: Design system · 7f3a ×] [Label: urgent · l1 · B1 ×] [Clear search and filters]
13 total · Page 1 of 1
```

- Keep **Search**, **status tabs** and **period tabs** in the page header. They
  are primary segmentation and are already understood.
- **Period model (decided):** period is always a header tab, never an advanced
  facet, chip or badge item. It appears only where the surface defines it; this
  task adds it to cards, users and attachments (`periods: true` + `from`/`to`)
  and to comments (`periods: true`; the backend predicate already exists).
  Activity, commands, audit, sessions and tokens keep their existing tabs.
  Period is cleared by Clear search and filters and is not counted in the Filters
badge.
- Add a **Filters** button next to the header controls with a filter icon and a
  badge showing the number of active advanced facets (not the number of values).
- Put active advanced filters on their own row below the header. Each value is
  a removable chip. The row wraps; it never scrolls horizontally.
- Show a **Clear search and filters** text button at the end of the chip row.
  It clears search, status, period and every advanced filter (same as today's
  `clearAllFilters`), with one history entry.
- Keep the existing exact total footer (`13 total`, page size, prev/next). Do
  not add filter-option counts.

### 6.2 Add-filter popover

- Clicking **Filters** opens a popover anchored to the button (desktop) or a
  full-width bottom sheet/dialog on `<640 px`.
- The popover lists only the facets supported *and offered* by the surface,
  grouped in the order defined by the config: scope (board/column/card), people
  (assignee/author/uploader/actor), properties (label/priority/due/attachments/
  kind/type/action/target). Status and period stay in the header; they are never
  duplicated in the popover.
- Each facet opens a searchable picker:
  - single-value: board, column, card, checklist, author, uploader, target id,
    board admin member;
  - multi-value: labels, assignees, actors, types, actions,
    target types, priorities, kinds.
- Single-value pickers apply on selection and close. Multi-value pickers keep a
  local draft; **Apply** commits the whole facet at once, **Clear** empties the
  draft, **Cancel/Escape** discards it. This avoids one history entry per
  checkbox.
- Picker search is debounced (250 ms), capped at 20 results, and aborts stale
  requests. A query that is an id-shaped string offers **Use id “…”** even when
  the entity is deleted or not returned by search. Selecting it creates a chip
  with a short id until resolution succeeds.
- Multi-value pickers pin selected rows at the top and show “N selected”.
  Disable unselected rows at the cap (20) with a readable hint.
- Facets that depend on a parent:
  - column/label/checklist/card pickers may be narrowed by the selected board;
    when no board is selected they search globally and show board context;
  - “Column” should suggest choosing a board first when the result set is
    large, but must not block an exact id;
  - card pickers for comments/attachments/checklists show card + board/column.
- **Board change contract.** Changing (or clearing) `boardId` clears the
  dependent structural filters `columnId`, `labelId`, `labelMatch`, `cardId`
  and `checklistId` in one committed change, and announces how many were
  cleared.
- **Conflict detection on deep links.** Resolve `ids` **unscoped** so every
  existing object is returned with its real parent `boardId`/`columnId`; use
  `boardId`/`columnId` scoping only for picker `q` searches. Then:
  - existing object whose parent differs from the active board/column
    (out-of-scope) → **conflict**: keep every filter, show a visible banner
    naming the conflicting facet(s), and offer a Remove action per dependent
    chip;
  - id reported in `missing` (hard-deleted/unknown) → **Unknown …** chip and the
    normal empty/consistent state; it is not a conflict;
  - matching parents and `total:0` → normal empty state.
  The server never widens the query. Tests cover an existing id with a
  different parent, a hard-deleted id, a matching parent with `total:0`, and
  same-title boards.
- **No active parent:** if no `boardId`/`columnId` is active, two dependent
  chips from different parents (e.g. label from Board A + card from Board B)
  are not classified as a conflict in v1; the exact AND yields a normal empty
  result. Inter-chip parent warnings are a possible later enhancement, not v1.
- If lookup fails, keep existing chips and the list; show an inline retry. Do
  not silently remove a filter or show an empty list as if it matched.

### 6.3 Choice facets and mode controls

Boolean/two-option and single-choice enum facets need an explicit control and
chip model; they are not free-text pickers.

**Choice facets**

| Facet | Control | Stored value | Visible chip | Aria label / remove label |
| --- | --- | --- | --- | --- |
| Assignee “Unassigned” | checkbox at the end of the assignee picker | `unassigned=true` | `Unassigned` | `Unassigned assignee` / `Remove filter: Unassigned` |
| Attachments | radio group: Any / Has card attachments / No card attachments | `hasAttachments=true\|false` | `Has card attachments` / `No card attachments` | `Card attachment filter` / `Remove filter: Has card attachments` |
| Verified | radio group: Any / Verified / Unverified | `verified=true\|false` | `Verified` / `Unverified` | `Email verification filter` / `Remove filter: Verified` |
| Due | radio group: Any / Overdue / Due in 24 hours / No due date | `due=overdue\|soon\|none` | `Overdue` / `Due in 24 hours` / `No due date` | `Due date filter` / `Remove filter: Overdue` |
| MIME type | radio group: Any / Images / Videos / PDF / Documents / Other | `mime=image\|video\|pdf\|document\|other` | localized type label | `File type filter` / `Remove filter: Images` |
| Transcode | radio group: Any / Pending / Failed / Done / No transcoding | `transcode=pending\|failed\|done\|none` | localized state label (`No transcoding` for `none`) | `Video processing filter` / `Remove filter: Failed` |

- “Any” is the unset state: selecting it removes the param and the chip. There
  is no chip for Any.
- A radio group is one tab stop with roving arrow/Home/End navigation; Space or
  Enter selects, Escape closes the popover and returns focus. A checkbox toggles
  with Space.
- Each chip removes only its own facet (`setFilter(key, null)` or the boolean
  equivalent), resets offset and clears bulk selection. Clear search and filters
  clears them with the rest.
- Component tests assert the control type, exact chip text, URL add/remove,
  keyboard selection, aria-label and EN/RU copy for every row above.

**Commit model (resolved Q2).** The five radio choice facets —
`hasAttachments`, `verified`, `due`, `mime`, `transcode` — apply **immediately
on selection**, close the popover and announce the exact result count after the
response. `Any` also applies immediately and removes the chip. The
`Unassigned` checkbox inside the assignee picker and the Any/All control inside
the labels picker are part of that picker's **draft**: they commit only with
**Apply**; Cancel/Escape discards the draft. Removing the
`Unassigned`/`Label match: All` chip itself applies immediately. For radio
facets, selecting is the Apply; Escape before selecting closes without change.
Tests cover each of the five radio facets (select/Any/Escape) and Add, Apply,
Cancel and Escape for both draft pickers, plus URL/selection-reset behavior.

Exact RU chip copy (use one noun form per state, no plural engine):
`Без исполнителя`, `С файлами карточки` / `Без файлов карточки`, `Подтверждён` /
`Не подтверждён`, `Просрочено` / `Срок в течение 24 часов` / `Без срока`,
`Изображения` / `Видео` / `PDF` / `Документы` / `Другое`,
`Обработка: в очереди` / `Обработка: ошибка` / `Обработка: готово` /
`Без перекодирования`, and the label-match chip `Совпадение меток: все`. RU tests assert
the same add/remove/aria behavior, not only the English strings.

**Label match mode (cards)**

- The Labels picker contains a segmented radio group **Any label / All labels**
  between the section title and the label checkboxes. It is shown only when at
  least two labels are selected; with 0–1 labels the mode is `any`, the control
  is hidden and the URL has no `labelMatch`. It is part of the labels draft and
  commits only with Apply; Cancel/Escape restores the previous mode.
- Stored value `labelMatch=any|all`; `any` is the default and is removed from
  the URL. Toggling to All adds `labelMatch=all`; toggling back to Any removes
  it. Removing labels until fewer than two remain resets to Any.
- When All is active, show a separate mode chip **Label match: All** after the
  label chips. It has an `X` that resets to Any. Accessible name:
  `Remove filter: Label match — All`; the group has
  `aria-label="Label match mode"` and `role="radiogroup"`.
- The labels facet still shows one chip per selected label; the mode chip is the
  visible statement of the AND semantics, not a replacement for label chips.
- URL/round-trip, chip removal and keyboard tests are required, plus an e2e
  proof that All returns only cards carrying every selected label.

### 6.4 Chip labels and resolution

Every filter that references an entity is resolved server-side; the UI never
uses a raw id as the visible label unless the object is missing or the value is
inherently an id.

| Filter | Visible chip | Secondary text |
| --- | --- | --- |
| Board | board title + **own short id** (`Design system · 7f3a`) | `(archived)`/`(deleted)` suffix; full id in tooltip |
| Column | column title + **own short id** + **board short id** (`In progress · c2 · B1`) | `(archived)`/`(deleted)` suffix; full ids in tooltip |
| Label | color dot + label name + **own short id** + **board short id** (`urgent · l1 · B1`) | `(deleted)` suffix; full ids in tooltip |
| Card | card title + **own short id** + **board/column short ids** (`Fix login · k1 · B1/C2`) | `(archived)`/`(deleted)` suffix; full ids in tooltip |
| User (assignee/author/uploader/actor) | display name, else email | email when name is shown; `(disabled)` suffix |
| Checklist | checklist title + **own short id** + **board short id** (`QA · ch1 · B1`) | `(deleted)` suffix; full ids in tooltip |
| Command id | `Command 7f3a…` | full id in tooltip; copy action |
| Label match | `Label match: All` (only for `labelMatch=all`) | resets to Any; `aria-label="Remove filter: Label match — All"` |
| Enum (`kind`, `type`, `action`, `targetType`, `priority`, `due`) | localized label where the catalog owns it; otherwise the canonical code | no id |
| Target id | target type + short id | full id in tooltip; link to detail only when it exists and the operator may open it |

- Resolution uses
  `GET /admin/filter-options?type=…&ids=…` (or repeated `ids`) in parallel for
  active filters. The endpoint is described in §7.4.
- While resolving, show a skeleton chip (`Board: …`) — never a raw id flash.
- If an id is missing (hard-deleted/unknown, not cross-parent), show
  `Unknown column · c2` with the full id in the tooltip; keep the filter active,
  render the normal empty/consistent state and do not call it a conflict. Do
  not drop the chip silently.
- Every structural entity chip (board/column/label/card/checklist) shows its
  **own visible short id** (8 chars), not only a tooltip; this disambiguates
  duplicate column titles and label names within the same board and duplicate
  card/checklist titles. Dependent chips also show their parent board short id
  (and column for cards), and the parent ids drive the conflict classification.
- If an entity is archived/deleted, still show its name with a suffix. The chip
  is removable; it is not an error.
- The remove button's accessible name includes the human label and the entity's
  own short id: `Remove filter: Column “In progress” · c2`. This is required on
  mobile/no-tooltip.
- Label color is never the only signal: the name is always present.

**Chip width and truncation policy.** `FilterChip` uses
`max-width: min(20rem, calc(100dvw - 2rem))`, `min-width: 0`, and the chip row
is `flex-wrap`. The title span is `min-w-0 truncate` (`overflow:hidden;
text-overflow:ellipsis; white-space:nowrap`), with the **full title** in the
`title` attribute and in the chip/remove accessible names. The own and parent
short ids are `shrink-0` and always visible; they are never the part that is
ellipsized. At 390 the maximum chip width is the viewport minus the page
padding, so a near-limit card title truncates rather than widening the row; the
row wraps and the page keeps `scrollWidth <= innerWidth`. The remove control
is `shrink-0` with a minimum 24×24 px hit target and stays a real focusable
button with an accessible name containing the full title and own/parent ids, so
keyboard/screen-reader users can remove a chip without hover or a tooltip. Own
ids stay always visible in v1 for deterministic disambiguation; duplicate-only
compaction is a follow-up backlog item, not part of 181.7.

### 6.5 Clear, empty and error states

- **Clear search and filters** resets search, status, period and advanced
  filters; it does not clear the page size (existing behavior) and does not
  navigate away.
- Removing the last active filter removes the chip row but keeps the default
  list. Do not show an empty “filters” container.
- Empty state:
  - no rows ever / no search or filters → existing “Nothing here yet”;
  - filters/search match nothing → “No cards match these filters.” +
    “Clear search and filters”;
  - if a lookup failed, the empty state must not claim “no matches”; show the
    lookup error and a retry above the empty state.
- Loading: first request keeps the table skeleton; subsequent filter changes
  keep the previous rows with `aria-busy` and a subtle refreshing state
  (existing behavior). Chips update immediately; totals update when the
  response arrives.
- 403 on an owner-only surface keeps the existing forbidden state; filters do
  not bypass it.

### 6.6 URL, history and deep links

- URL remains the source of truth (TASK-176.5): reload, back/forward, shared
  links and `returnTo` restore the exact list.
- Search still replaces the current history entry per committed search; filter
  add/remove/apply pushes one entry per committed change. Multi-select Apply
  pushes once for the facet, not once per checkbox.
- Page size and offset changes keep the existing behavior (new entry; selection
  cleared on limit, preserved on offset).
- **Board-dependent URL changes:** an interactive `boardId` change/clear removes
  `columnId`, `labelId`, `labelMatch`, `cardId` and `checklistId` in the same
  committed URL update and announces the clear. A deep link with a conflicting
  board+column/label/card keeps the params (server returns zero) and shows the
  conflict banner/Remove actions from §6.2; it never auto-widens on load.
- Period stays a header tab: `period` values are serialized exactly like today;
  it is not part of the advanced filter keys or chip row.
- Hub tab switches:
  - preserve `boardId` (and only `boardId`) across tabs that support it
    (Boards hub content tabs, moderation Comments↔Attachments, audit
    Audit↔Commands↔Activity);
  - drop search/status/period/columnId/labelId/labelMatch/cardId/checklistId
    on a tab switch unless the target explicitly supports them;
  - preserve unrelated `returnTo`.
  This keeps “I am inspecting board X” across content/moderation while avoiding
  a stale search silently hiding rows on another surface.
- Canonical URL: sort repeated values lexicographically, dedupe, omit defaults
  (`status=all`, `period=any`, default `limit`, `offset=0`), and preserve
  unknown hub/detail keys (`tab`, `comment`, `attachment`, `returnTo`).
- **Entity-specific alias normalization:** on announcements,
  `status=deleted` is read as `disabled` and the canonical URL is rewritten to
  `status=disabled`; the Disabled tab is selected and the request carries
  `status=disabled`. The API accepts `deleted` directly, but the UI does not
  keep it as an unselected/All state.
- Example deep links:
  - `/admin/boards?tab=cards&boardId=b1&labelId=l1&labelId=l2&labelMatch=all&assigneeId=u1&priority=blocker&due=overdue&status=active`
  - `/admin/moderation?tab=comments&authorId=u1&kind=blocker&kind=question&period=7d`
  - `/admin/audit?tab=audit&adminId=a1&action=board.command&period=30d`
- Never put tokens, passwords, emails as filter values, or transient secrets in
  URLs. Member ids and entity ids only.

### 6.7 Pagination, counts and selection

- `AdminPage.total` is the only result count. Never derive “13 cards” from the
  loaded page. The footer evidence is `N total` + `Page X of Y`, not a loaded-
  row sample.
- Every filter change, including status/period tab changes and choice facets,
  resets `offset` to 0; a deep link may carry an offset and must be restored
  as-is.
- Filter changes clear bulk selection (the existing 176.1 contract); offset
  changes preserve it. Extend `adminFiltersKey`/`selectionScopeKey` to all new
  filters, including multi-values, booleans and label-match mode.
- “N selected” is the saved selection count; “M on this page” is the visible
  subset. Both are exact.
- Do not show counts next to filter options in v1. If a count is added later,
  it must be an exact server aggregate for the current scope, never the number
  of loaded rows.
- If the current page is beyond the filtered total after a change, reset to the
  first page rather than showing an empty page.

### 6.8 Responsive behavior (1440 / 1024 / 390)

- 1440: header controls in one row where they fit; chip row below.
- 1024: header controls may wrap to two rows; filter popover width ≤ 20rem with
  internal scrolling; table remains its existing sticky-header viewport.
- 390: filters open as a bottom sheet or full-width popover with max height
  `70dvh`, internal scroll and a sticky Apply/Close footer; chips wrap and long
  emails truncate with `title`/accessible full text. The status/period
  `FilterTabs` strip becomes horizontally scrollable with visible edges (fixes
  the current clipped tabs); no page-level horizontal overflow
  (`scrollWidth <= innerWidth`). The 390 test must also assert every tab, chip
  and sheet control is visible/reachable with a bounding box inside the
  viewport — `scrollWidth` alone is not evidence.
- **Long-title fixture at 390:** seed a 100-char board title, a 100-char column
  title and a near-limit 300-char card title (one of them archived/deleted with
  its suffix), activate several filters together, and assert each chip's
  bounding box is inside the viewport (width ≤
  `min(20rem, viewport − 2rem)`), the title span ellipsizes while `title`/the
  accessible name keep the full text, own/parent short ids remain visible, the
  row wraps, and each remove button is reachable/removable by keyboard with a
  bounding box ≥24×24 px. Include a 50-char label and a 100-char checklist title
  in the fixture. Do not use only short duplicate names for this test.
- Touch targets: at least 32×32 px in the dense desktop panel; at least 44 px
  rows/buttons inside the mobile sheet (TASK-179.9 precedent). The remove `X`
  on a chip must be at least 24×24 px and have a larger hit area.
- No hover-only affordances; the picker and chips are usable by touch.

### 6.9 Keyboard and screen reader

- **Filters** button: `aria-haspopup="dialog"`, `aria-expanded`, visible focus
  ring. Enter/Space opens; Escape closes and returns focus to the button.
- Popover: `role="dialog"` with an accessible name (“Filters for cards”).
  Sections use headings; single-choice rows use `role="radio"` with a roving
  tabindex and arrow/Home/End navigation; multi-choice rows use
  `role="checkbox"` and Space toggles. Reuse the `useCombobox` pattern from
  TASK-179.9 for searchable pickers.
- Search fields have labels, not placeholder-only names; result rows announce
  name + context. “Use id …” is a normal option.
- After Apply, focus returns to the Filters button and an `aria-live="polite"`
  status announces “Filters applied · Results: N” using the server total after
  the response. Do not announce a speculative count before it arrives.
- Chip remove buttons are reachable in DOM order; removing a chip keeps focus
  on the next chip or the Filters button if none remain. The remove button has
  an accessible name with the full title and own/parent short ids; no hover or
  tooltip is required to remove it by keyboard/screen reader.
- Table rows/links keep their existing keyboard behavior; filters must not
  steal row clicks (the 176.5 cell-link guard stays).
- Color contrast: chips/inputs/section headings meet AA in light/dark; the label
  color dot is decorative; focus ring contrast is visible.

### 6.10 i18n (EN/RU)

- Add both dictionaries in `ui/src/admin/admin-i18n.ts`; `AdminMessageKey`
  stays type-safe. No raw English fallback in the RU UI.
- New keys (indicative): `admin.filters.open`, `admin.filters.title`,
  `admin.filters.active`, `admin.filters.clearAll`, `admin.filters.apply`,
  `admin.filters.cancel`, `admin.filters.remove`, `admin.filters.search`,
  `admin.filters.noOptions`, `admin.filters.useId`, `admin.filters.loading`,
  `admin.filters.resolveError`, `admin.filters.maxValues`,
  `admin.filters.unknown`, `admin.filters.unsupported`,
  `admin.filters.boardConflict`, `admin.filters.boardCleared`,
  `admin.filters.labelMatch`, `admin.filters.labelMatch.all`,
  `admin.filters.state.archived/deleted/disabled`, plus per-facet labels,
  choice values (`any`, `has`, `none`, `overdue`, `soon`, MIME/transcode) and
  enum values.
- Domain data (board titles, names, emails) is not translated. Dates use the
  existing locale/hour12 helpers. Avoid plural-sensitive strings; use
  “Shown {shown} of {total}” / “Показано {shown} из {total}” patterns like the
  existing dictionary.
- RU copy must be reviewed in the 390/1024 screenshots; long words like
  “Исполнитель” must not clip the chip.

## 7. API and data contract

### 7.1 Query parameters

This table describes the completed rollout. The current surface allowlist
follows §5.8. All params are optional. Shipped multi-value facets use repeated
query params.

| Param | Shape | Surfaces | Semantics |
| --- | --- | --- | --- |
| `search` | string ≤200 | all | Existing substring search; unchanged |
| `status` | single enum | per entity | Existing tabs; `all` is a universal default sentinel accepted on every surface (no-op where no status filter exists) |
| `period` | `24h\|7d\|30d` | cards, users, comments, attachments, activity, commands, audit, sessions, tokens; shares keeps legacy `from`/`to`, no UI in this task | Header tab only; UI preset → `from` timestamp. Cards/users/attachments add the predicate in this task; comments already has it |
| `limit`, `offset` | ints | all | Existing bounds/caps |
| `boardId` | single id | boards, boardMembers, cards, columns, labels, checklists, checklistItems, cardLinks, cardLabels, comments, attachments, activity, commands; shares legacy | Exact board; mismatch with `columnId` yields empty, never widened |
| `columnId` | single id | boards, cards, columns, labels, checklists, checklistItems, cardLabels, comments, attachments, activity, commands | Exact column; commands use `touches` |
| `labelId` | single id on legacy lists; repeated id (max 20) on cards | cards (offered); legacy single-value support on boards, columns, labels, checklists, checklistItems, cardLabels, comments, attachments, activity | OR on cards by default; `labelMatch=all` requires every selected label |
| `labelMatch` | `any\|all` | cards | Default `any`; only meaningful with `labelId`; visible mode chip for `all` |
| `cardId` | single id | boards, cards, columns, labels, checklists, checklistItems, cardLinks, cardLabels, comments, attachments, activity, commands | Exact card; links match either side |
| `checklistId` | single id | checklist items only (later tab) | Exact checklist |
| `assigneeId` | repeated user id (max 20) | cards | OR; combined with `unassigned` |
| `unassigned` | `true\|false` | cards | OR with `assigneeId`; omitted when false |
| `priority` | repeated enum (max 6) | cards | OR; `medium` also matches `null` (default priority) |
| `due` | `overdue\|soon\|none` | cards | Server `now`; `soon` = next 24 h; no timezone day buckets |
| `hasAttachments` | `true\|false` | cards | `attachmentCount > 0` / `= 0`; counter = live, non-inline files with `descriptionDetached=false`. Inline and `descriptionDetached=true` (detached/hidden) files are excluded |
| `adminMemberId` | single user id | boards | `members.some` with role ADMIN and acceptedAt not null; not the displayed first-admin label |
| `verified` | `true\|false` | users | `emailVerifiedAt` null/not |
| `authorId` | single user id | comments | Exact author |
| `kind` | repeated enum (max 6) | comments | note/status/question/blocker/evidence/handoff |
| `uploadedById` | single user id | attachments | Exact uploader |
| `mime` | single enum | attachments | image/video/pdf/document/other |
| `transcode` | single enum | attachments | none/pending/done/failed; `none` also covers videos when transcoding is disabled |
| `actorId` | repeated user id (max 20) | commands, activity | OR |
| `type` | repeated exact code (max 20) | commands, activity, card links | OR; command/activity options from server distinct values; card-link values are the static `CARD_LINK_TYPES` |
| `action` | repeated exact code (max 20) | audit | OR; options from server distinct values |
| `adminId` | repeated master id (max 20) | audit | OR; actor options resolve from audit-visible rows only; null-actor login rows remain search-only |
| `targetType` | repeated exact code (max 20) | audit | OR; distinct values from server |
| `targetId` | single string ≤100 | audit | Exact; may be `singleton` for settings |
| `commandId` | single id | commands, audit | Existing 176.10 correlation (only after that branch merges) |

`labelId` (cards), `assigneeId`, `actorId`, `adminId`, `type`, `action`,
`targetType` and `kind` are arrays on the wire. A single value is accepted
and normalized to a one-element array once the facet ships. `labelId` stays
single-valued on cards through 181.2 and on all other legacy lists.

`boardId`, `columnId`, `cardId`, `checklistId`, `adminMemberId`, `authorId`,
`uploadedById`, `commandId` and `targetId` accept one value. Repeated values
return 400.

### 7.2 Combination semantics

- Different facets combine with **AND** (`boardId` + `priority` + `due`).
- Values inside a multi-value facet combine with **OR** (`labelId=a` OR `b`).
- `labelMatch=all` changes only the label facet to **AND across labels**; other
  facets keep their own semantics. The UI exposes it as the Labels picker
  Any/All segmented control plus a mode chip; it is only sent with at least two
  labels and is implemented as one `labels.some` per selected id.
- `unassigned=true` is OR-ed with `assigneeId` values, matching the board
  filter. `unassigned=false` is a no-op and should not be written to the URL.
- `priority=medium` matches `priority = "medium"` **or `priority IS NULL`**
  because the product treats unset as medium (`DEFAULT_CARD_PRIORITY`). No
  separate “Unset” option exists in v1. This is deliberate and tested; do not
  make “Medium” and “Not set” disagree.
- `due=soon` uses the same 24-hour window as `dueStatus` on the board; `overdue`
  is `< now`; `none` is `IS NULL`. Archived/deleted rows are included according
  to `status`, not because of the due facet.
- `hasAttachments=true` means `attachmentCount > 0`; `false` means `= 0`.
  `attachmentCount` is maintained from live, non-inline rows with
  `descriptionDetached=false`. `descriptionDetached=true` means detached/hidden
  from the card and is **not** counted; inline files are also not counted. This
  is the same number the card face shows. Document the labels as “Has card
  attachments” / “No card attachments” and test the four cases: plain live
  file, inline-only, description-referenced (`false`), detached (`true`).
- Status semantics stay per entity: cards `active` excludes archived/deleted,
  `archived` excludes deleted, `deleted` is any soft-deleted row (including a
  formerly archived one). The default `All` continues to include
  archived/deleted rows — filters do not silently change that.
- Period is a `createdAt` window (`from` inclusive), matching existing lists.

### 7.3 Validation rules

- Ids: existing `ADMIN_ID_PATTERN` (`[A-Za-z0-9_-]{1,64}`), trimmed; empty
  single filters are treated as absent (existing behavior), except `commandId`
  and `targetId` which reject an empty value.
- Arrays: validate each element and apply the cap of 20 to distinct values
  after normalization. Enum facets use their own size (priority and kind are
  6). Reject the whole request with 400 if exceeded.
- Blank `offset` and blank `from`/`to` on surfaces with a date-range predicate
  are treated as omitted. URL canonicalization preserves explicit bounds
  in the address bar. Period tabs continue to derive the UI request bound.
- Enums: exact lowercase values; unknown value → 400. The URL parser is more
  forgiving (unknown values are dropped) so a hand-edited link cannot break the
  page; the API remains strict.
- Booleans: only `true` and `false`; `1`/`0`/`yes` → 400.
- From 181.3, cards accept `labelMatch=any` or `labelMatch=all` and omit the
  mode when fewer than two distinct labels remain.
- `adminMemberId` is a single user id; a repeated value is 400, like the other
  structural ids.
- `targetId`: string 1–100 chars, letters/digits/`_:-`; no free-text SQL or
  path fragments.
- `action`/`type`/`targetType`: exact code strings ≤100 chars, safe alphabet;
  never `contains` for these filters (use `search` for text).
- A key outside `implemented` in §5.8 returns 400 `unsupported_filter` on
  direct API calls. This includes offered facets whose wave has yet to ship
  and repeated card `labelId` in 181.1 and 181.2. The UI omits those values
  and loads the list with the remaining valid parameters.
- **Per-entity status allowlists:** `all` is included in
  `ENTITY_STATUS_VALUES` for **every** entity and is always accepted, matching
  `useAdminList`'s default; it is a no-op on surfaces with no status tabs. The
  remaining values are: users `active/disabled`; boards/cards
  `active/archived/deleted`; columns/labels/checklists/checklistItems/cardLinks/
  comments/attachments `active/deleted`; tokens/boardMembers
  `active/disabled`; announcements `active/disabled/deleted`, where `deleted`
  is a supported API alias for inactive. The **UI parser normalizes**
  announcements `status=deleted` to `disabled` and rewrites the URL to
  `status=disabled`, so the Disabled tab is selected and the request is
  `status=disabled`; the direct API still accepts `deleted`. The same strict
  guard is called by the generic `/admin/entities/:entity` route and every
  specialized list route (`/admin/cards`, `/admin/comments`, …); e2e covers both
  families plus default/no-status and explicit `status=all` on every surface.
- `unsupported_filter` response shape:
  `{ statusCode: 400, error: "Bad Request", code: "unsupported_filter",
  filter: "<offending key>", message: "Filter <key> is not supported for
  <entity>" }`. 181.1 tests that deferred URL values never reach the list
  API and the list still loads. The filter bar wave owns the Remove action
  for an unexpected API rejection of an active filter.
- Combined query length: cap at 32 values or 2 KB of filter state; the UI shows
  a readable “too many filters” message before navigation.

### 7.4 Filter option lookup

New read-only endpoint:

```http
GET /api/v1/admin/filter-options?type=board&q=design&limit=20
GET /api/v1/admin/filter-options?type=user&ids=u1&ids=u2
```

Types: `board`, `column`, `label`, `user`, `card`, `checklist`, `auditActor`,
`action`, `commandType`, `activityType`, `targetType`.

Bounds: `q` is trimmed and capped at 200 characters. Repeat `ids` for up to
20 distinct values after trimming and deduplication. `limit` accepts integers
1–50 (default 20) and caps picker searches. Exact-id resolution returns all
requested matches within the 20-ID cap, including when `limit` is smaller,
and always returns `hasMore: false`. A `type` outside the list returns 400.

Response:

```ts
interface AdminFilterOptionDto {
  id: string;
  label: string;
  /** Board title, card context, email, etc. Never a role or account secret. */
  sublabel: string | null;
  /** active | archived | deleted | disabled | revoked | null */
  state: string | null;
  /** Label palette key only for labels. */
  color?: string;
  /** Parent board for columns/labels/cards/checklists; null for every non-dependent type. */
  boardId: string | null;
  /** Parent column for cards; null otherwise. */
  columnId: string | null;
}

interface AdminFilterOptionsDto {
  items: AdminFilterOptionDto[];
  /** Exact ids that were requested but no longer exist. */
  missing: string[];
  /** Search was capped; more matches exist. Never a fabricated count. */
  hasMore: boolean;
}
```

Behavior:

- `q` searches by id and by the human field (title/name/email); exact id
  matches rank first, then label order; deterministic.
- `ids` resolves chips **unscoped by id**: every existing object is returned
  with its real parent `boardId`/`columnId`, even when it belongs to another
  board. `missing` means only hard-deleted/unknown, never “exists but out of
  scope”.
- `boardId`/`columnId` narrow **picker `q` searches only**; they never filter
  `ids` resolution. This is what makes cross-parent conflicts detectable: an
  existing column on B2 returned for an active B1 is a parent mismatch, not a
  silently missing id.
- **Parent context:** `boardId` is set for column/label/card/checklist
  options; `columnId` is set for card options; both are null for every
  non-dependent type (boards, users, audit actors, action, commandType,
  activityType, targetType). A representative enum response is tested.
- **Conflict model:**
  - existing object with parent ids different from the active filters →
    conflict banner with per-chip Remove;
  - `missing` id (hard-deleted/unknown) → `Unknown …` chip and normal
    empty/consistent result, not a conflict;
  - matching parents + `total:0` → normal empty state.
  Tests cover an existing id with a different parent, a hard-deleted id,
  matching parents with zero results, and same-title boards. With no active
  parent, cross-parent chips are not a conflict in v1; the exact AND returns a
  normal empty result.
- Search returns `hasMore` to indicate additional matches.
- `cardId` narrows checklist `q` searches where provided.
- `action`, `commandType`, `activityType`, `targetType` return distinct stored
  values (limit 50) from the corresponding table; no invented enum list that
  drifts from data. Card-link type uses the static `CARD_LINK_TYPES` constant,
  not a lookup.
- **`auditActor` is the only actor directory.** It returns `id = adminId` and
  `label = adminEmail` for actors that appear in `AdminAuditLog` (optionally
  filtered by `q`/`ids`). `sublabel` and `state` are null; it does not return
  `role`, `disabledAt`, `displayName`, TOTP or allowlist data. A master who has
  never authored an audit row is not offered; an exact `adminId` in the URL is
  applied from 181.6 and resolves from a visible audit row or the “Unknown
  actor” fallback.
- Both OWNER and OPERATOR may call `auditActor`; neither gets a general master
  roster. `GET /admin/admins` stays owner-only and is not reused by the picker.
- `user` uses the display name as `label` and email as `sublabel`. When the
  name is absent, email is the label and the sublabel is null. The account
  state is `active` or `disabled`.
- The endpoint is read-only; it must not expose data a list row would not show.
- e2e must prove: OPERATOR gets 403 from `GET /admin/admins`; `filter-options`
  with `type=admin` is 400/absent; `type=auditActor` returns only audit-visible
  id/email fields and no role/disabled state; an actor with no audit rows is not
  enumerable.

### 7.5 Permissions and scoping

- All list surfaces are already behind `AdminJwtAuthGuard`; both master roles
  can read them. New filters follow the same rule.
- Filter changes never widen scope: `boardId` + `columnId` from different boards
  returns zero, not the union. All joins go through the row's actual relations.
- Operator restrictions:
  - Masters management remains owner-only. The audit actor filter resolves only
    **audit-row-visible** actors (`adminId` + `adminEmail`) for both roles; the
    picker never queries the master roster and never returns role/disabled
    state. An OPERATOR is not linked to `/admin/access?tab=masters` (176.4
    behavior).
  - `GET /admin/filter-options?type=admin` is not a supported type; direct
    `GET /admin/admins` stays 403 for OPERATOR. No filter option may expose a
    field hidden from the corresponding list row (no secrets, no full session
    tokens, no password state).
- A direct 403 keeps the existing `ForbiddenState`; no client-side “filter
  around” fallback.

### 7.6 Performance and indexes

- Use equality/`IN` for ids and enums, range predicates for dates. Do not use
  `contains` for id/action/type filters.
- **Measured harness:** add `scripts/perf/seed-admin-filters.mjs` (extends the
  `docs/PERF-25K-UX.md` seed) and `scripts/perf/admin-filter-bench.mjs`. Full
  dataset: 25k cards, 100 boards, 500 columns, 200 labels, 50k comments, 10k
  attachments and 10k commands/activity rows. PR gate: cards (board/label/
  assignee/priority/due) and audit (actor/action) on a 5k-row subset, 3 cold +
  10 warm per facet/page size. Full 25k manual/nightly run: representative
  facets (cards board/label/assignee/priority/due, audit actor/action) at 5 cold
  + 20 warm; remaining facets at 3 cold + 10 warm. Record p50/p95 plus
  `EXPLAIN (ANALYZE, BUFFERS)`. Target ≤ +20% p95 for a single facet versus the
  unfiltered list, with no sequential scan over 10k+ rows. Commit the script
  and raw result table in the PR; “benchmark exists” is not evidence.
- [TASK-181.1 benchmark evidence](./TASK-181.1-filter-perf.md) records the
  small smoke run and 5k measurements. TASK-181.1 measures the existing board
  and single-label predicates on cards. Audit actor/action and their index
  decisions belong to 181.6. Each owning wave measures its shipped predicates
  before enabling them. The full 25k qualification remains part of rollout.
- [TASK-181.4 benchmark evidence](./TASK-181.4-moderation-perf.md) records the
  moderation predicates on the 5k gate fixture, including period and combined
  cases and their query plans.
- Candidate indexes (add only when the query plan proves a need; do not add a
  blanket index for every low-cardinality facet):
  - `Command @@index([actorId, createdAt])` for actor + period;
  - `Command @@index([type, createdAt])` for type + period;
  - `Activity @@index([actorId, createdAt])` and
    `Activity @@index([type, createdAt])`;
  - `AdminAuditLog @@index([action, createdAt])` for action + period;
  - `AdminAuditLog @@index([targetType, targetId, createdAt])` if target type
    is filtered together with period (the existing `[targetType, targetId]`
    covers the equality pair);
  - `Comment @@index([authorId, createdAt])` and `Comment @@index([kind, createdAt])`
    for moderation;
  - `Attachment @@index([uploadedById, createdAt])` for uploader;
  - `Attachment @@index([boardId, createdAt, mimeType])` for board + period +
    MIME if the plan uses it;
  - `Card @@index([priority, createdAt])` for priority + period;
  - `User @@index([createdAt])` and, only if the plan uses it,
    `User @@index([emailVerifiedAt, createdAt])` for verified + period;
  - `Card @@index([attachmentCount])` only if the zero-count query for
    `hasAttachments` proves slow;
  - `CardLink @@index([boardId, type, createdAt])` if type + board is slow.
- Existing `Card @@index([assigneeId])` and `@@index([dueDate])` cover the
  common single-facet paths; combined board/column+assignee may need a
  composite measured against the actual query.
- `adminMemberId` uses the existing `BoardMember(userId, acceptedAt)` index;
  no new index is required for the accepted-ADMIN membership lookup.
- Add indexes in a separate migration only after the plan is recorded; note the
  lock window for self-hosters in the PR. No data backfill.
- From 181.2, lookup requests are parallel, debounced and cached in memory per admin
  session with a short TTL (30–60 s). Do not refetch on every keystroke or
  pagination. Abort stale requests by generation id (TASK-180.9 M40 pattern).
- Avoid N+1: resolve labels for the page rows with the existing joins; the
  lookup endpoint is for pickers/chips, not per-row labels.

### 7.7 Pagination and totals

- Filters are applied before `count` and `findMany`; `total` is exact.
- Keep `limit`/`offset` and the 100 max/1,000,000 offset cap.
- A filter change resets `offset`; an explicit deep link keeps it.
- If `offset >= total` after a data change, render the first page or an
  explicit “page no longer exists” state; do not show an empty table with a
  wrong page counter.
- `hasMore`-style detail windows are unchanged; this task is about global list
  pagination.

## 8. Implementation notes

### 8.1 Per-surface filter registry

The shared per-surface registry supplies the allowlist for list URLs and API
requests. For example, in 181.1:

```ts
cards: {
  implemented: ["boardId", "columnId", "labelId", "cardId"],
  offered: [
    "boardId", "columnId", "labelId", "labelMatch", "assigneeId",
    "unassigned", "priority", "due", "hasAttachments",
  ],
}
```

- `readAdminListQuery`, `useAdminList` and the admin API client send facets
  only for a surface that implements them. With no surface, the URL helpers
  and list hook use an empty facet allowlist.
- The filter picker wave uses `offered` with `implemented` to determine
  what can be added. Implemented legacy facets still apply from deep links.
- The shared backend guard returns 400 `unsupported_filter` on generic and
  specialized routes for keys outside the implementation for that surface.
  It also checks the per-surface status allowlist.
- Shared helpers normalize values and enforce the unique-value budgets.

### 8.2 URL state

- Extend `AdminListFilters` to typed values:
  `string | null`, `string[]`, `boolean | null`, enum unions.
- `adminFiltersKey` must be stable and include every value/order (sorted) so
  selection scope and effect keys do not loop.
- `writeAdminListQuery` serializes repeated values with `append`, sorts and
  dedupes, and omits inactive/default values.
- Preserve `tab`, `comment`, `attachment`, `returnTo` exactly (existing).
- On an interactive `boardId` change/clear, delete dependent `columnId`,
  `labelId`, `labelMatch`, `cardId`, `checklistId` in the same URL update and
  emit the clear announcement. A deep link preserves conflicts and lets the
  conflict banner remove them (§6.2).
- Period remains a separate header-tab value, not a key in `AdminListFilters`;
  keep its existing serialization and don't include it in the Filters badge.
- Extend `admin-navigation.ts`:
  - `adminCardsHref` serializes the currently implemented card filters;
  - `adminCommentsHref`/`adminAttachmentsHref` accept author/uploader/kind/type
    where relevant;
  - `adminCommandsHref`/`adminActivityHref` accept actor/type;
  - add `adminAuditHref` for actor/action/target/period;
  - add `adminBoardsHref` with `adminMemberId` (not `ownerId`).
- `HubTabs` should copy `boardId` to the target tab when supported; add a
  per-tab `preserves` list rather than hard-coding every link.

### 8.3 Components

New files under `ui/src/admin/filters/`:

- `AdminFilterBar.tsx` — button, badge, chip row, Clear search and filters,
  live region.
- `AdminFilterPopover.tsx` — dialog/sheet shell, sections, Apply/Cancel.
- `FilterFacetPicker.tsx` — single/multi listbox or checkbox list, search,
  pinned selected rows, “Use id …”.
- `FilterChoiceGroup.tsx` — radio/boolean choice controls (2–7 options) for the
  choice facets in §6.3, with Any removal and aria labels.
- `LabelMatchControl.tsx` — Any/All segmented radio inside the Labels section
  and the `labelMatch=all` mode chip.
- `FilterChip.tsx` — icon, truncating full-title span, visible **own + parent
  short ids**, suffix, `shrink-0` remove button with a ≥24×24 px hit target;
  enforces the §6.4 max-width policy and keeps the full title in
  `title`/accessible names.
- `use-filter-options.ts` — debounce, abort/generation, in-memory cache,
  resolve-by-id; `auditActor` only for actor chips/pickers.
- `filter-registry.ts` — `AdminFilterKey`, per-entity definitions, labels,
  value parsers/serializers.

Reuse `Popover`, `Dialog`, `useCombobox`, `Button`, `Badge`, `Checkbox` and
tokens; do not fork the board `FilterBar` component. The board component is the
UX reference for chips and sections, not a shared dependency (it is
board-store-specific).

### 8.4 Row DTO changes

Minimal, additive, but update every producer:

- `AdminCommentRowDto.kind` is required for the list filter and row badge. The
  shared DTO is reused by the generic comments list, user-detail comments,
  card-detail comments and global-search comments; add `kind` to
  `listComments`, the user-detail mapping, `toCommentRow` (card/global) and all
  fake fixtures/tests. Do not add a required field to only one producer.
- `AdminAttachmentRowDto` needs a readable board label and the inline state for
  rows. `listAttachments` has its **own select path**; `ATTACHMENT_SELECT`
  (used by `toAttachmentRow` for card detail/global search) is separate. Extend
  both with `card.column.board.title`, `isInline` and `descriptionDetached`,
  map them in all three producers, and render `Inline`/`Detached` badges. Do not
  leave a hard-coded `—` where the board filter/chip depends on it.
- `AdminCardRowDto.attachmentCount` is **absent** today (not optional). Do not
  describe it as optional: add it only if the card row should show “N files”;
  the filter reads the database counter, not this row DTO.
- No schema migration for filter values except optional indexes. `Comment.kind`
  already exists.

### 8.5 Selection and bulk actions

- `selectionScopeKey` includes all filter values (sorted arrays, booleans and
  the label-match mode).
- Any filter add/remove/apply (including a chip `X` or Clear search and filters)
  clears the selection; page/offset changes preserve it; limit changes clear it.
- The bulk contract from TASK-176.1 is unchanged: count, confirm and request use
  the same saved ids; new filters must not create a hidden selection.
- Test browser back to a previous filter state: the selection is empty because
  the result set changed.

### 8.6 Backend query construction

- Build an `AND` array, not ad-hoc `where` key assignment, so facets cannot
  overwrite each other (for example `where.OR` for search plus `where.OR` for
  priority). Keep search in its own `AND` branch.
- Use `in` for multi-values: `labels: { some: { labelId: { in: ids } } }`.
- `labelMatch=all` must add one `labels.some` condition per selected id in the
  `AND` array:
  `AND: ids.map((id) => ({ labels: { some: { labelId: id } } }))`. Never use
  `labels: { every: … }` over the card's labels: that would require every label
  on the card to be selected. Test one label, two labels, a card with the
  selected labels plus an extra label, and a card missing one selected label.
- `priority=medium`: `OR: [{ priority: "medium" }, { priority: null }]`.
- `adminMemberId`: `members: { some: { userId, role: "ADMIN", acceptedAt: { not:
  null } } }`; do not use the first-admin display label.
- Period: extract the `dateRange(query)` helper from `AdminService` into a
  shared admin list utility (or import it into `AdminEntitiesService`); call it
  in `listCards`, `listUsers` and `listAttachments`. `listAttachments` currently
  has no such helper — do not call `this.dateRange` from the wrong service.
  `listComments` already has the predicate. Keep the UI `period` → `from`
  mapping in `use-admin-list`.
- `hasAttachments`: `attachmentCount: { gt: 0 }` / `{ equals: 0 }`.
  `attachmentCount` must be computed exactly like `command-writers` and
  `recountCardAttachments`: `deletedAt: null`, `isInline: false`,
  `descriptionDetached: false`. **Fix the admin recount bug**:
  `recountCardAttachments` currently omits `descriptionDetached: false`, so
  after admin delete/bulk a detached (`true`) description file is wrongly
  counted. Add the predicate (or call a shared counter helper) and test admin
  delete/bulk with a description-referenced (`false`) and a detached (`true`)
  file.
- `mime`:
  - image: `startsWith("image/")`
  - video: `startsWith("video/")`
  - pdf: `application/pdf`
  - document: `text/*`, RTF, and legacy and Open XML Office formats
  - other: the remaining types, including JSON, audio and archives
  Use `OR` branches; test each family and an unknown type.
- `transcode` exact enum.
- Audit `action`/`targetType` exact; `targetId` exact; `adminId` `in`.
- Commands `type` exact; `actorId` `in`; card/column keep the `touches`
  `has`/`hasEvery` behavior.
- Activity `type` exact; `actorId` `in`.
- Ensure status/archived/deleted semantics remain per entity and documented.

## 9. Subtasks

**Hard prerequisite:** TASK-176.5/176.6 (URL state and the structural
`boardId`/`columnId`/`labelId`/`cardId` filters) must be in the base. They are
already in `main` @ `002a31ec`; do not start 181.2 on an older base. TASK-176.8–
176.10 are not required, except for the `commandId` chip from 176.10 (§9,
181.6).

| ID | Scope | Priority | Effort | Wave | Depends on |
| --- | --- | --- | --- | --- | --- |
| 181.1 | Filter contract: implemented/offered registry, URL parser/writer, DTO arrays/booleans/enums, `filter-options` endpoint | P1 | M | 1 | TASK-176.5/6 in main |
| 181.2 | Filter bar/popover/chips/resolution on cards: board, column, label; mobile/keyboard/EN-RU | P1 | L | 1 | 181.1 |
| 181.3 | Cards full facets: assignee/unassigned, priority, due, hasAttachments, labelMatch, period | P1 | M | 1 | 181.2 |
| 181.4 | Moderation hub: comments (author/kind) and attachments (uploader/MIME/transcode); preserve board context across tabs | P2 | M | 2 | 181.2 |
| 181.5 | Content lists: users verified/period, boards accepted-ADMIN member, columns/labels/checklists/links filters | P2 | M | 2 | 181.2 |
| 181.6 | Audit hub: audit actor/action/target, commands actor/type, activity actor/type; operator-safe actor lookup | P2 | M | 2 | 181.2; 176.10 for `commandId` |
| 181.7 | Docs, CHANGELOG, EN/RU admin guide, visual/a11y/perf acceptance, final URL/regression sweep | P2 | S/M | 3 | 181.3–181.6 |

### 181.1 — Filter contract and lookup (P1)

**Deliverables**

- Shared types/constants: `AdminFilterKey`, implemented/offered registry
  (§5.8), max values, lookup DTOs, canonicalization helpers and the typed
  `unsupported_filter` envelope.
- Perf harness: add `scripts/perf/seed-admin-filters.mjs`,
  `scripts/perf/admin-filter-bench.mjs` and root `npm run perf:admin-filters`
  in this PR; the scripts are committed, not merely referenced by §7.6.
- `admin-list-query.ts`: parse and serialize implemented facets per surface,
  preserve explicit date bounds, normalize announcements `status=deleted`
  to `disabled` in both directions and generate a stable request key.
- The list hooks send implemented facets only and preserve search and browser
  history behavior.
- DTOs validate values, reject repeated singletons and cap distinct entries
  for multi-value inputs. Deferred facets return 400 `unsupported_filter`
  before DTO validation. The owning wave enables each predicate.
- `GET /admin/filter-options` with both roles, `auditActor` only for actors,
  `q`≤200 / `ids`≤20 distinct / search `limit`≤50, minimal fields,
  `missing`/`hasMore`. The client and cache arrive with the picker in 181.2.
- Table-driven backend e2e for every legacy supported pair; unit tests for
  round-trip and allowlist.

**Acceptance**

- Deep links such as `/admin/users?verified=true`, the cards list with
  `assigneeId`, and audit with `adminId` load without those facets in the
  request. The equivalent direct API calls return 400 `unsupported_filter`.
- Card labels keep their single-value results. Repeated `labelId` and
  `labelMatch` return 400 until 181.3, which owns the OR/AND predicates and
  multi-label round-trip tests.
- Every legacy pair in §5.8 still returns exactly the old rows.
- `/admin/communications?tab=history&status=deleted` selects the Disabled tab,
  rewrites the URL to `status=disabled`, and requests inactive rows; direct
  `GET /admin/entities/announcements?status=deleted` still returns 200.
- Lookup resolves board/column/label/user/card/auditActor by id and search;
  dependent options return parent `boardId`/`columnId`; `type=admin` is rejected;
  OPERATOR gets only audit-visible actor id/email and cannot enumerate
  roles/disabled state.
- Existing 176.5/176.6 tests pass unchanged (or only extend, never weaken).

### 181.2 — Filter bar and cards pilot (P1)

**Deliverables**

- `AdminFilterBar` + popover + chips + filter-options client and resolution
  cache on cards.
- Board/column/label pickers (label stays single-value in this slice; multi-label
  and `labelMatch` arrive in 181.3), add/remove/clear, human labels, unknown
  fallback.
- Board-change contract: dependent filters clear with an announcement; a
  conflicting deep link shows the conflict banner with Remove actions.
- Mobile sheet and keyboard model; EN/RU strings; live result announcement.
- `EntityPage` uses the registry and the new bar for cards; other lists keep
  their existing header until their subtask.
- Component tests with fake lookup; browser test 1440/1024/390 for cards.

**Acceptance**

- A master can add “Board: Design system”, “Column: In progress”, “Label:
  urgent” without editing the URL; chips show names/colors plus the visible
  board short id, not raw ids only. Two same-title boards produce distinct
  dependent chips via their parent `boardId`; duplicate column titles or label
  names within one board remain distinguishable by the dependent entity's own
  visible short id.
- Removing a chip/Clear search and filters updates the URL and the list;
  reload/back/forward restore the exact filtered view; `returnTo` still works.
- Changing the board clears column/label/card dependents in one URL change and
  announces the clear; a conflicting deep link shows a Remove conflict banner
  and does not silently widen.
- An unknown/deleted id shows an explicit short-id fallback, not a blank chip or
  a silent unfiltered list.
- Empty state distinguishes “no data” from “no matches”; total is the server
  total.
- 390: no horizontal page overflow; status tabs and any existing period tabs are
  reachable; sheet controls are at least 44 px; Escape closes and focus returns.
- Keyboard-only add/remove works; screen reader labels name the facet + value.

### 181.3 — Cards full facets (P1)

**Deliverables**

- Assignee multi + unassigned, multi-label + `labelMatch` any/all, priority multi
  (null=medium), due overdue/soon/none, hasAttachments, period.
- Period: `periods: true` in the cards config **and**
  `where.createdAt = dateRange(query)` in `listCards`; exact-total test with a
  seeded 24h/7d/30d boundary.
- Choice facets use the radio/two-option controls from §6.3; labels use the
  Any/All control and mode chip; query construction uses one `labels.some` per
  selected label in the AND array.
- Fix `recountCardAttachments` to include `descriptionDetached: false` and
  share the predicate with command-writers; add admin delete/bulk regression.
- Backend service mapping, DTO validation, query-plan evidence, indexes only if
  measured.
- Chips for each value; picker sections; EN/RU; tests.

**Acceptance**

- Combining facets is AND; multi-values are OR; label `all` requires every
  selected label and does not use `every` over the card's labels;
  `unassigned` ORs with assignee ids.
- `priority=medium` returns both `medium` and unset cards; the count matches a
  seeded fixture; this is documented in the chip/help.
- `due=soon` uses the 24-hour window; `overdue`/`none` are exact; archived/
  deleted inclusion follows status.
- `hasAttachments=true/false` agree with `attachmentCount`: plain live file
  counts; inline-only does not; description-referenced (`descriptionDetached=false`)
  counts; detached/hidden (`descriptionDetached=true`) does not. Admin
  delete/bulk recount uses the same predicate and is tested with both
  description states.
- Period tab restores from URL, applies the exact `from` bound, resets offset,
  clears selection and returns an exact total (the fixture crosses a boundary).
- Every choice facet and the label-match mode chip have exact text, aria-label,
  add/remove URL tests and keyboard coverage. `hasAttachments` and `verified`
  radio facets apply/close/announce immediately; `Unassigned` and label Any/All
  commit only with Apply and discard on Cancel/Escape.
- Filter changes reset the page and clear bulk selection; offset changes keep
  selection.
- No regression >20% p95 on the measured dataset; EXPLAIN evidence attached.

**Open follow-ups**

- Run the 25,000-card performance qualification during rollout.
- Backfill previously inflated `attachmentCount` values.
- Revisit listbox keyboard navigation for searchable multi-value pickers. The
  current pickers use a checkbox group.
- Refine the display of user IDs on assignee chips.

### 181.4 — Moderation hub (P2)

**Deliverables**

- Comments: author/kind filters, kind visible in the row; board/card/period
  (`periods: true`; backend `from`/`to` already exists).
- Attachments: uploader/MIME/transcode filters; board/card/period; readable
  board context; add `periods: true` and `where.createdAt = dateRange(query)`.
- Choice facets for MIME/transcode use §6.3 radio groups and exact chips.
- Preserve `boardId` across Comments↔Attachments; reset incompatible params.
- EN/RU; component/e2e/browser tests.

**Acceptance**

- Comments can be narrowed to one author or to blocker/question kinds; the row
  shows the kind badge and the total is exact.
- Attachments can be narrowed to one uploader, one MIME family, or failed
  transcodes; image/video/pdf/document/other tests cover each branch.
- Attachments tab shows `Inline`/`Detached` badges; an inline-only card is
  visible here while the `No card attachments` card filter matches it, tested
  against the counter.
- `transcode=none` matches non-video files and videos when the transcode flag is
  disabled; the test covers both `No transcoding` states.
- Both tabs restore period from URL; attachments apply the `from` predicate and
  return exact totals across a seeded period boundary.
- Switching Comments→Attachments keeps the board filter and drops the comment
  author/kind; switching back does not resurrect stale values.
- Operators can use every filter; no owner-only link is introduced.
- Empty states per tab; deleted/archived semantics documented.

**Open follow-ups**

- CardLinks has a pre-existing isolation flake. The full UI suite passes.
- Revisit checkbox groups versus listbox interaction for multi-value pickers.
- Revisit behavior when a requested page is out of range.
- Consolidate global card navigation helpers in a later change.

### 181.5 — Content lists (P2)

**Deliverables**

- Users: verified filter + period (`periods: true` + `where.createdAt =
  dateRange(query)`); verified uses the radio group from §6.3.
- Boards: accepted-ADMIN member filter via `members.some({role: ADMIN,
  acceptedAt: not null, userId})`; not the displayed first-admin label.
- Columns/labels/checklists: board/card filters exposed through the kit.
- Card links: type filter (static `CARD_LINK_TYPES`) + card/board.
- No new checklist-items tab; decision recorded in the spec/docs.
- Tests per entity, multi-admin seed and a browser sweep of the Boards hub.

**Acceptance**

- Each list shows only its supported filters; no no-op chip is possible.
- “Boards where user X is an accepted ADMIN” matches both of two ADMINs and
  excludes a MEMBER and a pending ADMIN; “cards in column Y” opens exact
  paginated lists.
- Users with unverified email are findable via the Verified/Unverified choice,
  and a period boundary returns an exact total.
- Card links filter by `blocks`/`relates_to`/`duplicates` and by card (either
  side).
- Existing 176.6 counter/column/label links still work and now show readable
  chips.

### 181.6 — Audit hub (P2)

**Deliverables**

- Audit: actor/master via `auditActor` (audit-visible id/email only), action,
  target type, target id; keep commandId.
- Commands: actor, type, card/column; keep board/period.
- Activity: actor, type; keep board/card/period.
- Read-only `auditActor` resolution for both roles; `type=admin` is not a
  lookup; owner-only Masters page/links remain owner-only.
- Distinct action/type options from the server. Chips show codes with readable
  context.
- Recheck the audit actor/action performance budget with the shipped queries
  and add measured indexes where needed. The 181.1 evidence records the
  earlier over-budget samples.

**Acceptance**

- A master can answer “what did this actor do to this board/card in 30 days?”
  with actor + target + period; totals are exact.
- Command type/actor filters combine with board/card and pagination; the 176.10
  command↔audit link still opens the same row.
- Activity type separates membership changes from comments; actor filter works.
- OPERATOR can use the actor filter and sees text, not a 403 link to Masters;
  e2e proves OPERATOR cannot enumerate the master roster/roles/disabled state
  and `filter-options?type=admin` is rejected.
- Null-admin login attempts remain findable through search (documented edge).

### 181.7 — Docs, acceptance and rollout (P2)

**Deliverables**

- Update EN/RU admin docs: `site/src/content/docs/{docs,ru/docs}/admin/content.md`,
  `monitoring.md`, `people.md`, `redesign.md` (filter bar, allowlist, URL
  examples, mobile/keyboard behavior).
- CHANGELOG entry.
- Final browser matrix and screenshots 1440/1024/390, RU + EN.
- Perf evidence from `npm run perf:admin-filters` (5k PR gate + full 25k manual
  run) and any index migration notes.
- A short “what is intentionally not filterable” section in the docs.

**Acceptance**

- Docs match the shipped UI; no dead links; EN/RU parity.
- `npm run format:check`, lint, typecheck, unit/shared/backend/e2e/browser suites
  green; no test expectations weakened.
- 390 has no horizontal overflow; keyboard-only flow works; axe/manual a11y
  checklist has no new violations.
- No regressions in existing admin URLs, global search, bulk actions or
  `returnTo`.

## 10. Test plan

### Unit / shared

- URL parser/writer: arrays, booleans, enums, defaults, canonical ordering,
  duplicates, cap, unsupported keys, crafted values, `returnTo` preservation;
  announcements `status=deleted` normalizes to `disabled` in read and write.
- Implemented/offered matrix: every entity's implemented set and offered set match
  §5.8; backend and UI lists agree (table-driven test).
- Semantics: priority null=medium, label any/all (including one `labels.some`
  per id), unassigned OR, due overdue/soon/none, MIME family mapping,
  hasAttachments/descriptionDetached, status/archived/deleted, period boundaries
  for cards/users/comments/attachments.
- Lookup DTO: type/query/ids/limit validation; `type=admin` rejected;
  `auditActor` returns only id/email; dependent options return parent
  `boardId`/`columnId`; enum/non-dependent responses return both null; no secret
  fields in serialized responses.
- `adminFiltersKey`/selection scope includes arrays, booleans and label-match
  mode.
- Board-change helper clears dependents; conflicting deep link keeps them and
  exposes removals.

### Component

- `AdminFilterBar`: open/close, badge count, chip add/remove, Clear search and
  filters, loading/error/fallback labels, max-values hint.
- Pickers: debounce, stale-response abort, keyboard arrows/Home/End/Enter/Space/
  Escape, focus return, “Use id …”.
- Choice facets: `hasAttachments`, `verified`, `due`, `mime`, `transcode`
  assert control type, exact chip text, URL add/remove, aria-label and EN/RU
  copy; select/Any/Escape applies immediately. Draft pickers cover Add → Apply,
  Add → Cancel, Add → Escape for `Unassigned` and label Any/All.
- Labels: Any/All segmented control, mode chip add/remove, reset when labels
  drop below two, keyboard; Add → Apply/Cancel/Escape.
- Clear search and filters produces one history entry and resets
  search/status/period/advanced filters; remove chip is also one entry.
- Parent conflict: same-title boards with a mismatched dependent filter show the
  banner; a hard-deleted id shows Unknown (no banner); a matching parent with
  `total:0` shows the normal empty state.
- Empty state: no data vs filtered vs lookup error; no fabricated count.
- `unsupported_filter` error shows the offending filter, Remove clears the
  chip/param and retries; no active chip remains over an unfiltered list.
- Attachment row badges show the exact `Inline`/`Detached` text; inline-only
  counter reconciliation is covered.
- `FilterChip` long-title unit: title span ellipsizes, `title`/aria keep full
  text, own/parent ids remain visible, remove is a focusable button with the
  full accessible name.
- Selection reset on filter change; preserved on paging.
- EN/RU rendering with long labels/emails; no clipping in jsdom snapshot.

### Backend e2e

- Seed two boards with identical titles, two labels with identical names, cards
  with/without labels, null/medium priorities, due dates around now, assignees/
  unassigned, attachments of each MIME/transcode and descriptionDetached state,
  comments of each kind/author, commands/activity/audit with different
  actors/actions/targets.
- `status=all` and an omitted status are accepted on every surface, including
  sessions, shares, audit, commands, activity and boardMembers; a non-`all`
  status outside that entity's allowlist is 400. Test both route families.
- `GET /admin/entities/announcements?status=deleted` returns the inactive rows
  with 200 (legacy alias), same as `status=disabled`; it is not a 400.
- Table-driven legacy matrix: every entity/pair in §5.8 returns exactly the old
  rows and never 400; only keys outside `implemented` are 400. Sessions/tokens
  keep their existing period tabs and `from`/`to` behavior.
- Each new facet returns only matching rows; combinations are AND; arrays are
  OR; totals exact; pagination exact.
- Exact totals + `Page X of Y` after each filter change; `offset >= total`
  falls back to page 1 (or explicit page-gone state), never a stale page counter.
- Label `all` returns only cards carrying every selected label, including a card
  with selected+extra labels and excluding a card missing one; never `every`.
- `transcode=none` returns non-video rows and videos with transcoding disabled;
  the flag-off fixture is seeded and asserted.
- Period exact totals for cards/comments/attachments/users across a seeded
  boundary; cards/users/attachments use the new `from` predicate.
- Cross-board/column/label mismatch returns zero (no union).
- Parent-context conflict: an existing dependent id with a different parent is
  returned unscoped and classified as conflict; a hard-deleted id is `missing`
  and renders Unknown, not conflict; a valid same-parent combination with zero
  rows is a normal empty result. Same-title boards are covered. With no active
  board, a cross-parent label+card pair yields the normal empty state.
- Picker `q` scoping vs `ids` resolution: board-scoped `q` narrows suggestions;
  `ids` stays unscoped and returns real parents.
- `hasAttachments`/counter: plain live file, inline-only, description-referenced
  (`descriptionDetached=false`) and detached/hidden (`true`); admin delete and
  bulk delete recount with both description states.
- Attachments tab includes inline and detached rows with badges; an inline-only
  card appears in the tab while a `No card attachments` filter still matches it
  for the card-face count (documented reconciliation test).
- `unsupported_filter` response includes the offending `filter` and the UI
  Remove action clears it and retries.
- Multi-admin board seed: both accepted ADMINs match; MEMBER and pending ADMIN
  do not.
- Status semantics and deleted/archived inclusion documented and tested.
- Invalid/oversized/unknown values → 400; unsupported filter outside `implemented`
  → 400; status value outside the per-entity allowlist → 400; empty single
  filter behavior unchanged. Test both `/admin/entities/:entity` and the
  specialized list routes.
- Operator: `GET /admin/admins` 403; `filter-options?type=admin` rejected;
  `auditActor` returns only audit-visible id/email, no role/disabled; no master
  roster enumeration.
- Row-DTO producers: `kind` on comments in generic/user-detail/card-detail/
  global-search; real `boardTitle` and `isInline`/`descriptionDetached` on
  attachments in all three producers (no hard-coded `—`); UI assertions cover
  the exact `Inline`/`Detached` badge text and row-DTO mapping.
- Lookup `ids`/`missing`/`hasMore`: soft-deleted rows return `state:"deleted"`
  (not missing), hard-deleted rows return `missing`, deleted/archived/disabled
  states carry no secrets.

### Browser (Playwright admin suite)

- 1440/1024/390: add board/column/label via picker, chip text is a name plus
  visible own/parent short ids, remove, Clear search and filters, reload,
  back/forward, `returnTo`; no horizontal overflow. At 390 assert each
  tab/chip/sheet control has a bounding box inside the viewport and is
  visible/reachable, not only `scrollWidth <= innerWidth`. The long-title
  fixture from §6.8 (100-char board/column + near-limit card title + 50-char
  label + 100-char checklist + several filters, one archived/deleted entity)
  asserts per-chip width is ≤ min(20rem, viewport − 2rem), ellipsis + full
  `title`/accessible name, visible own/parent ids, visible archived/deleted
  suffix and keyboard removal; assert each remove button’s bounding box is
  ≥24×24 px.
- Cards: assignee/priority/due/attachments/label-all; period tab; exact total
  matches seeded count; empty state.
- Board change clears dependent filters with announcement; conflicting deep link
  shows the conflict banner and Remove actions. Same-title boards render
  distinguishable dependent chips; duplicate column titles, duplicate label
  names, duplicate card titles in one column and duplicate checklist titles on
  one card show distinct **own** short ids (also at 390 with no tooltip); the
  remove aria-name includes the own short id. A valid parent combination with
  zero rows shows the normal empty state, not the conflict banner.
- Moderation: comment author/kind; attachment uploader/MIME; period tabs; board
  preserved across tabs.
- Communications history: `/admin/communications?tab=history&status=deleted`
  selects Disabled, rewrites the URL to `status=disabled` and requests inactive
  rows; the direct API `status=deleted` e2e remains 200.
- Audit: actor/action/target/period; command 176.10 deep link; OPERATOR actor
  filter uses text and cannot open Masters.
- Keyboard-only full flow; Escape focus return; RU locale flow.
- Existing `e2e/tests/admin/content-browsers.spec.ts`, `boards.spec.ts`,
  `users.spec.ts`, `audit.spec.ts` extended without weakening current asserts.

### Manual a11y/visual checklist

- Focus visible on every control; no keyboard trap; popover Escape closes only
  the popover; focus returns to the Filters button.
- Chip remove buttons have facet+value names; live region announces the exact
  result count after load.
- Light/dark contrast for chips, placeholders, section headings, label dots.
- 390 touch targets and bottom-sheet scroll; 1024 wrap; 1440 density.

## 11. Rollout

1. Merge **181.1** first. The initial implemented set in §5.8 preserves legacy
   deep links. The UI omits deferred inputs from requests and direct API calls
   return 400 `unsupported_filter`. The offered set records the planned UI.
2. Merge **181.2** (cards picker, lookup client and cache) and **181.3**
   (cards facets, multi-label and label matching). Each wave enables the
   corresponding implemented entries alongside the predicates and tests.
3. Merge **181.4–181.6** independently after 181.2. Each hub wave promotes
   its entries with the corresponding predicates and measured performance
   evidence. 181.4 owns the comments and attachments entries and their
   [5k gate measurements](./TASK-181.4-moderation-perf.md). The full 25k
   qualification remains part of rollout.
4. Merge **181.7** docs/acceptance last.
5. The admin UI and API ship atomically from the same image. Starting with
   the filter bar in 181.2, an unexpected `unsupported_filter` response for an
   active chip shows a blocking error with a Remove action.
6. **Merge order / file ownership:**
   - TASK-180.9 (admin mobile/nav/breadcrumbs/i18n) lands **before 181.2** when
     possible; otherwise 181.2 rebases after it and re-runs the 390 tests.
   - TASK-176.10 lands **before 181.6** for the `commandId` chip; if not, 181.6
     ships without it and adds it in a follow-up.
   - 181.1 owns `shared/src/admin.ts`, `admin-list-query.ts`,
     `use-admin-list*.ts`, the list DTO and `admin.controller.ts` for the
     filter-options endpoint; 181.2 owns `EntityPage.tsx`, the new `filters/`
     directory, `HubTabs` board propagation and the base `admin-i18n` keys;
     181.3 owns `listCards` in `admin.service.ts`; 181.4 owns `listComments`
     there plus `listAttachments` in `admin-entities.service.ts`; 181.5 owns
     `listUsers`/`listBoards` plus the content lists in `admin-entities`;
     181.6 owns `listCommands`/`listAudit` plus `listActivity`; 181.4 adds the
     `AdminCommentRowDto.kind` producer change after 181.1. Each wave updates
     its own entries and evidence. 181.7 owns the final docs and acceptance.
     Serialize edits to `admin.service.ts`/`admin-entities.service.ts` by wave
     and rebase each subtask; do not edit `EntityPage.tsx`/`HubTabs.tsx` in
     parallel.
7. Index migration (if any) is separate, measured, and documented for
   self-hosters. No data backfill.
8. Rollback: revert the UI/endpoint; the supported matrix keeps old URLs valid,
   the new strict 400 behavior disappears if 181.1 is reverted, and no schema/
   data change is required beyond optional indexes.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Silent no-op filters (the current bug) | Implemented/offered matrix in UI + 400 outside `implemented`; atomic deployment; explicit `unsupported_filter` state; table-driven parity test |
| Raw ids reappear on new surfaces | One `FilterChip` + server resolver; tests assert human labels for every entity filter |
| Lookup latency/N+1 | Parallel resolve, 30–60 s cache, 250 ms debounce, abort stale requests, limit 20 |
| Extra indexes lock a large table | Measure first; separate migration; document lock window; add only proven composites |
| Ambiguous names (same board/label) | Store ids; board and dependent chips show a visible board short-id; labels carry board context; exact filters; test duplicates |
| Deleted/archived semantics confuse counts | Document per entity; test `All` vs `Active`; show suffix in chips |
| Mobile overflow/regression | Bottom sheet, wrapping chips, 390 overflow assertion, status tab scroll fix |
| Operator privacy/403 regression | `auditActor` returns audit-visible id/email only; no master roster/roles/disabled; owner-only links stay text; e2e |
| Stale board-dependent filters | Interactive board change clears column/label/card/checklist with announcement; conflicting deep link shows Remove banner |
| History spam from multi-select | Draft + Apply for multi facets; one push per facet |
| Scope creep into shares/details/sessions | Explicit out-of-scope table; follow-up triggers recorded |
| Existing tests weakened | Extend 176.5/6 tests; no assertion deletions; code review checklist |

## 13. Out of scope

- The user-facing board filter, saved board views, filter-driven drag/drop.
- Shares list pagination/filters (TASK-177.5).
- Session/token list truthfulness beyond the filters listed in §5.6.
- Security event log UI (TASK-161/168 if reopened).
- Checklist-items top-level tab (TASK-176.12), card-label join browser, board
  member filters.
- Detail-page filter panels, dashboard filters, announcement period/locale.
- Per-user saved filter sets, localStorage auto-restore, filter presets by role.
- Duplicate-only chip compaction (show own ids only for duplicate names) is a
  follow-up backlog item, not part of 181.7.
- Filter-option match counts, CSV export of filtered lists, analytics.
- MCP/public API exposure, master-authored edits, agent control (TASK-176.11).
- Changes to global search ranking/caps (TASK-177.10 owns the user-facing cap).

## 14. Open product questions

**Resolved in this revision:** period is a header tab (not a chip); label match
is a visible Any/All control plus a mode chip; the five choice radios
(`hasAttachments`, `verified`, `due`, `mime`, `transcode`) apply immediately,
while `Unassigned`/label-match draft controls commit with Apply; inline
attachments stay visible with an `Inline` badge (and do not affect
`hasAttachments`); OPERATOR actor resolution uses only audit-visible actors,
never a general master directory; the board facet is “accepted ADMIN member”,
not the first-admin owner label; the no-op/old-server promise is replaced by
atomic deployment plus an explicit `unsupported_filter` state; board changes
clear dependents interactively and show conflicts on deep links; hub context
preserves only `boardId`; existing out-of-scope parents are conflicts, hard-
deleted ids are Unknown (not conflicts); deleted entities keep the name +
suffix; the Clear copy is “Clear search and filters”; v1 shows no filter-option
counts; sessions/tokens keep their existing period tabs and add no new
user/status filters; `status=all` is universal and `announcements?status=deleted`
is a supported API alias that the UI normalizes to `status=disabled`; `priority=medium`
includes unset cards, with no separate Unset option in v1.

1. **Checklist items:** keep TASK-176.12 deferred (recommended) or add a tab
   with board/card/checklist/done? Requires support evidence.
2. **Board period filter:** add a created/updated period for boards now or defer
   until support asks?

## 15. Definition of Done

- The confirmed filter inventory in §5.7 is implemented for cards, comments,
  attachments, audit, commands, activity, users, boards (accepted ADMIN
  member), columns, labels, checklists and card links; speculative facets are
  not silently added.
- Every ID/name filter chip is human-readable via the lookup endpoint; board
  and dependent chips include visible own short ids (plus parent board/column
  context), so same-board duplicate titles are distinguishable; missing/deleted
  values have an explicit fallback; no raw-id chip remains where a name exists.
- Parent-context conflicts are distinguished from legitimate zero-result lists
  in the UI and tested for same-title boards; hard-deleted/unknown ids render
  `Unknown …` and are not classified as conflicts.
- `FilterChip` max width/truncation policy holds at 390 with 100-char
  board/column and near-limit card titles: chips stay inside the viewport, title
  ellipsizes with full `title`/accessible text, own/parent ids stay visible and
  keyboard removal works.
- The implemented/offered matrix in §5.8 is enforced in UI and API: every legacy
  176.5/6 pair still works, 400 only outside `implemented`, and no old-server
  mixed-version promise remains. Announcements `status=deleted` remains an API
  alias and normalizes to Disabled in the UI URL/request. Board changes clear
  dependents with an announcement; conflicting deep links show a Remove
  conflict.
- Period is a header tab on cards/users/comments/attachments (with `from`/`to`
  predicates where missing), never a chip; choice facets and label-match mode
  have exact controls, chips, aria-labels and tests. Sessions/tokens keep their
  existing period tabs.
- Attachments show `Inline`/`Detached` badges; `attachmentCount` and
  `recountCardAttachments` use `descriptionDetached=false`; admin delete/bulk
  and inline-only reconciliation tests pass.
- Per-entity status allowlists and `unsupported_filter` (with the offending
  filter) are enforced by the shared guard on generic and specialized routes;
  `all` is universal, and the UI Remove action is tested.
- URL round-trip, deep links, `returnTo`, pagination and bulk selection remain
  truthful; filter changes reset the page and clear selection; totals are exact.
- Multi-value/boolean/enum validation is strict; errors are actionable; no
  truncation or silent narrowing.
- Lookup endpoint is read-only, operator-safe (audit-visible actor fields only,
  no master roster/roles/disabled state), cached/debounced and covered by tests.
- Performance evidence exists for each new facet; indexes are justified by
  query plans; no regression beyond the agreed budget.
- EN/RU strings are complete; 1440/1024/390 browser tests and keyboard/focus/
  screen-reader checks pass; no horizontal overflow at 390.
- Docs (`content.md`, `monitoring.md`, `people.md`, `redesign.md` EN/RU),
  CHANGELOG and this spec are updated; `format:check`, lint, typecheck, unit,
  shared, backend e2e and browser suites are green with no weakened tests.
- No production code belongs in this planning ticket; the follow-up PRs implement
  it under `feat/TASK-181.x-*` with one PR per subtask.
