# TASK-181 — Admin list filters and discoverable filter UX

**Status:** planned

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
| `entity-configs.tsx` | Per-entity status tabs and `periods`; no facet metadata | The page cannot know which filters an entity supports |
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
services apply some combinations:

- cards: `boardId`, `columnId`, `labelId`, `cardId`, `status`, `from`/`to`;
- comments: `boardId`, `columnId`, `labelId`, `cardId`, `status`, `from`/`to`;
- attachments: `boardId`, `cardId`, `columnId`, `labelId`, `status`;
- columns/labels/checklists/checklist items/card links: board/card/label
  scopes where they make sense;
- commands: `boardId`, `commandId`, `cardId`/`columnId` through `touches`;
- audit: `commandId` only (TASK-176.10);
- activity: `boardId`, `cardId`.

There is no server-side filter for card priority, assignee, due date,
attachments, comment kind, command type/actor, audit action/actor/target type,
or attachment MIME type. `AdminPage.total` is the exact server count (TASK-176.3)
and must stay the only source of result counts.

### 2.3 What is already good and must survive

- URL round-trip, browser back/forward and `returnTo` (TASK-176.5).
- Exact structural filters, including same-name boards (TASK-176.6 e2e).
- Bulk selection: survives pagination, cleared by a result-set change
  (TASK-176.1). New filters must join its scope key.
- Honest `N of M` totals and `Load more` windows (TASK-176.3).
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
4. **Additive first.** Old URLs keep working. New params are ignored by an old
   server and degrade to short-id chips if lookup is unavailable.
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
| Period | `period=24h\|7d\|30d` over `createdAt` | Find recent registrations, abuse clusters, onboarding issues | 181.5 |

Omitted: board/column/label, assignee, priority, due, author, actor, action,
attachments. A user is not a board row; membership is already a tab on
`/admin/users/:id` and a table on board detail. Filtering users by board would
duplicate a narrower, already-scoped surface.

### 5.2 Boards

Route: `/admin/boards?tab=boards`.

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Status | `status=active\|archived\|deleted` | Existing; recovery and audit | existing |
| Owner | `ownerId=<user id>` | Exact "boards owned by this user"; user detail links and support escalations | 181.5 |

Omitted: column/label/card/assignee/priority/due/attachments. Boards are
containers; filtering them by content facets is indirect and slow, and the
board detail page already links to the exact content lists. A creation-period
filter is cheap but low value; defer until support asks.

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
| Attachments | `hasAttachments=true\|false` | Find cards with evidence or missing evidence | 181.3 |
| Status | `status=active\|archived\|deleted` | Existing primary axis | existing |
| Period | `period=24h\|7d\|30d` over `createdAt` | Recent work / incident window | 181.3 |
| Card id | `cardId` (advanced, paste/URL) | Exact deep link, including from global search | existing |

Omitted: author (cards do not store one; the command log does), actor/action/type
(command surface), `hasLinks`/`blocked` (the board UI has these; no support
workflow has asked for them on `/admin`), comment counts, column title.

#### Columns (`tab=columns`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Exact board scope; existing server support | 181.5 |
| Status | `status=active\|deleted` | Existing | existing |

Omitted: label/assignee/priority/due/card. A column row is already a structural
object; its card count links to the exact cards list.

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
| Author | `authorId` (repeated) | Find one user's comments across cards | 181.4 |
| Kind | `kind` (repeated: note/status/question/blocker/evidence/handoff) | Triage blockers/questions; TASK-177.11 uses the same enum in the board UI | 181.4 |
| Status | `status=active\|deleted` | Existing | existing |
| Period | `period` over `createdAt` | Recent moderation window | 181.4 |

Not offered: column/label (indirect; board/card already narrow enough; the
176.6 server scopes stay supported for old links), priority, due, attachments,
assignee. Adding indirect facets to comments would join through cards for little
support value.

#### Attachments (`/admin/moderation?tab=attachments`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Board | `boardId` (single) | Existing; board counter link | 181.4 |
| Card | `cardId` (single) | Exact card files | 181.4 |
| Uploader | `uploadedById` (repeated) | Find one user's uploads; abuse/investigation | 181.4 |
| Type | `mime=image\|video\|audio\|pdf\|document\|other` | Support for file classes; type is visible in the row | 181.4 |
| Status | `status=active\|deleted` | Existing | existing |
| Period | `period` over `createdAt` | Recent uploads / retention window | 181.4 |
| Transcode | `transcode=pending\|failed\|done\|none` | Find stuck/failed video encodes | 181.4 |

Not offered: column/label (indirect; existing server scopes stay for old links),
inline filter in v1. Inline attachments are currently included in the admin
list; add an `inline` badge/filter only after the list clearly separates them
(§14, Q5).

### 5.5 Audit & activity hub

Current structure: **Audit trail**, **Command log**, **Activity**.

#### Audit (`/admin/audit?tab=audit`)

| Filter | Param / values | Why | Phase |
| --- | --- | --- | --- |
| Actor / master | `adminId` (repeated) | Exact accountability query; unknown-email login rows stay reachable by search | 181.6 |
| Action | `action` (repeated, exact code with typeahead) | `user.create`, `board.command`, `admin.login_failed`, … | 181.6 |
| Target type | `targetType` (repeated) | Exact stored type; options come from the server (user/board/card/session/… as present) | 181.6 |
| Target id | `targetId` (single, exact) | Reconstruct one object's full audit trail | 181.6 |
| Command id | `commandId` (single, advanced) | Existing TASK-176.10 correlation (only after that review branch merges) | existing/176.10 |
| Period | `period` over `createdAt` | Existing | existing |

Omitted: board/column/label direct filters (target type + id covers the reliable
fields), status. Audit details are free JSON; do not invent filters over
unvalidated detail keys.

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

Omitted: column/label, status, priority, due. Activity is a mixed event feed;
the event type is the useful split, but do not hard-code a four-value list —
`ACTIVITY_EVENT_TYPES` also contains invite accept/decline, expiry changes,
comment edits/deletes and agent-control events.

### 5.6 Access, communications and detail surfaces

These are **not** filter targets in v1. They remain in the inventory so the
decision is explicit and does not get reinvented later.

| Surface | Decision | Reason / owner |
| --- | --- | --- |
| Sessions (`/admin/access?tab=sessions`) | Defer user/period; no status filter | The list hard-codes live sessions (`revokedAt: null`, future expiry). A status filter would imply revoked/expired rows exist in the list; make the list truthful first (separate truthfulness task). |
| Tokens (`/admin/access?tab=tokens`) | Defer user/status/period | Backend supports status; the page currently has no status tabs. A small follow-up can reuse the same filter kit after cards prove it. |
| Masters (`/admin/access?tab=masters`) | No filters | Owner-only, small roster; search would be more useful than filters. |
| Shares (`/admin/communications?tab=shares`) | Defer to TASK-177.5 | TASK-177.5 owns truthful pagination/expiry. Adding filters before the list is honest would compound the problem. A later pass can add board/mode/status/creator. |
| Announcements history | Keep status only | Small list; status already exists. Period/locale/level filters are speculative. |
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
- boards: status, owner;
- columns: board, status;
- labels: board, status;
- checklists: board, card, status;
- card links: board, card, type, status.

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

## 6. UX specification

### 6.1 Anatomy

```
Cards                                             [Search…] [All][Active][Archived][Deleted]
[ Filters (2) ]  [Board: Design system ×] [Label: urgent ×] [Clear all]
13 total · Page 1 of 1
```

- Keep the existing **Search**, **status tabs** and **period tabs** in the page
  header. They are primary segmentation and are already understood.
- Add a **Filters** button next to them with a filter icon and a badge showing
  the number of active advanced facets (not the number of values). Search,
  status and period are visible already and do not increment the badge.
- Put active advanced filters on their own row below the header. Each value is
  a removable chip. The row wraps; it never scrolls horizontally.
- Show a **Clear all** text button at the end of the chip row. It clears search,
  status, period and every advanced filter (same as today's
  `clearAllFilters`), with one history entry.
- Keep the existing exact total footer (`13 total`, page size, prev/next). Do
  not add filter-option counts.

### 6.2 Add-filter popover

- Clicking **Filters** opens a popover anchored to the button (desktop) or a
  full-width bottom sheet/dialog on `<640 px`.
- The popover lists only the facets supported by the surface, grouped in the
  order defined by the config: scope (board/column/card), people (assignee/
  author/uploader/actor), properties (label/priority/due/attachments/kind/type/
  action/target), status/period are already visible.
- Each facet opens a searchable picker:
  - single-value: board, column, card, checklist, target id, owner;
  - multi-value: labels, assignees, authors, uploaders, actors, types, actions,
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
- If lookup fails, keep existing chips and the list; show an inline retry. Do
  not silently remove a filter or show an empty list as if it matched.

### 6.3 Chip labels and resolution

Every filter that references an entity is resolved server-side; the UI never
uses a raw id as the visible label unless the object is missing or the value is
inherently an id.

| Filter | Visible chip | Secondary text |
| --- | --- | --- |
| Board | board title | short id in tooltip/aria-label; `(archived)`/`(deleted)` suffix |
| Column | column title | board title + short id in tooltip |
| Label | color dot + label name | board title; `(deleted)` suffix |
| Card | card title | board/column + short id in tooltip |
| User (assignee/author/uploader/actor) | display name, else email | email when name is shown; `(disabled)` suffix |
| Checklist | checklist title | card title + board |
| Command id | `Command 7f3a…` | full id in tooltip; copy action |
| Enum (`kind`, `type`, `action`, `targetType`, `priority`, `due`) | localized label where the catalog owns it; otherwise the canonical code | no id |
| Target id | target type + short id | full id in tooltip; link to detail only when it exists and the operator may open it |

- Resolution uses
  `GET /admin/filter-options?type=…&ids=…` (or repeated `ids`) in parallel for
  active filters. The endpoint is described in §7.4.
- While resolving, show a skeleton chip (`Board: …`) — never a raw id flash.
- If an id is missing (hard-deleted user, purged board), show
  `Unknown board · 7f3a` with the full id in the tooltip; keep the filter active
  and the result empty/consistent. Do not drop the chip silently.
- If an entity is archived/deleted, still show its name with a suffix. The chip
  is removable; it is not an error.
- The remove button has an accessible name that includes the human label:
  `Remove filter: Board “Design system”`. The chip text itself is not the
  accessible name of the button.
- Label color is never the only signal: the name is always present.

### 6.4 Clear, empty and error states

- **Clear all** resets search, status, period and advanced filters; it does not
  clear the page size (existing behavior) and does not navigate away.
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

### 6.5 URL, history and deep links

- URL remains the source of truth (TASK-176.5): reload, back/forward, shared
  links and `returnTo` restore the exact list.
- Search still replaces the current history entry per committed search; filter
  add/remove/apply pushes one entry per committed change. Multi-select Apply
  pushes once for the facet, not once per checkbox.
- Page size and offset changes keep the existing behavior (new entry; selection
  cleared on limit, preserved on offset).
- Hub tab switches:
  - preserve `boardId` (and only `boardId`) across tabs that support it
    (Boards hub content tabs, moderation Comments↔Attachments);
  - drop search/status/period/columnId/labelId/cardId on a tab switch unless
    the target explicitly supports them;
  - preserve unrelated `returnTo`.
  This keeps “I am inspecting board X” across content/moderation while avoiding
  a stale search silently hiding rows on another surface.
- Canonical URL: sort repeated values lexicographically, dedupe, omit defaults
  (`status=all`, `period=any`, default `limit`, `offset=0`), and preserve
  unknown hub/detail keys (`tab`, `comment`, `attachment`, `returnTo`).
- Example deep links:
  - `/admin/boards?tab=cards&boardId=b1&labelId=l1&labelId=l2&labelMatch=all&assigneeId=u1&priority=blocker&due=overdue&status=active`
  - `/admin/moderation?tab=comments&authorId=u1&kind=blocker&kind=question&period=7d`
  - `/admin/audit?tab=audit&adminId=a1&action=board.command&period=30d`
- Never put tokens, passwords, emails as filter values, or transient secrets in
  URLs. Member ids and entity ids only.

### 6.6 Pagination, counts and selection

- `AdminPage.total` is the only result count. Never derive “13 cards” from the
  loaded page.
- Every filter change resets `offset` to 0; a deep link may carry an offset and
  must be restored as-is.
- Filter changes clear bulk selection (the existing 176.1 contract); offset
  changes preserve it. Extend `adminFiltersKey`/`selectionScopeKey` to all new
  filters, including multi-values and booleans.
- “N selected” is the saved selection count; “M on this page” is the visible
  subset. Both are exact.
- Do not show counts next to filter options in v1. If a count is added later,
  it must be an exact server aggregate for the current scope, never the number
  of loaded rows.
- If the current page is beyond the filtered total after a change, reset to the
  first page rather than showing an empty page.

### 6.7 Responsive behavior (1440 / 1024 / 390)

- 1440: header controls in one row where they fit; chip row below.
- 1024: header controls may wrap to two rows; filter popover width ≤ 20rem with
  internal scrolling; table remains its existing sticky-header viewport.
- 390: filters open as a bottom sheet or full-width popover with max height
  `70dvh`, internal scroll and a sticky Apply/Close footer; chips wrap and long
  emails truncate with `title`/accessible full text. The status/period
  `FilterTabs` strip becomes horizontally scrollable with visible edges (fixes
  the current clipped tabs); no page-level horizontal overflow
  (`scrollWidth <= innerWidth`).
- Touch targets: at least 32×32 px in the dense desktop panel; at least 44 px
  rows/buttons inside the mobile sheet (TASK-179.9 precedent). The remove `X`
  on a chip must be at least 24×24 px and have a larger hit area.
- No hover-only affordances; the picker and chips are usable by touch.

### 6.8 Keyboard and screen reader

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
  status announces “Filters applied · N results” using the server total after
  the response. Do not announce a speculative count before it arrives.
- Chip remove buttons are reachable in DOM order; removing a chip keeps focus
  on the next chip or the Filters button if none remain.
- Table rows/links keep their existing keyboard behavior; filters must not
  steal row clicks (the 176.5 cell-link guard stays).
- Color contrast: chips/inputs/section headings meet AA in light/dark; the label
  color dot is decorative; focus ring contrast is visible.

### 6.9 i18n (EN/RU)

- Add both dictionaries in `ui/src/admin/admin-i18n.ts`; `AdminMessageKey`
  stays type-safe. No raw English fallback in the RU UI.
- New keys (indicative): `admin.filters.open`, `admin.filters.title`,
  `admin.filters.active`, `admin.filters.clearAll`, `admin.filters.apply`,
  `admin.filters.cancel`, `admin.filters.remove`, `admin.filters.search`,
  `admin.filters.noOptions`, `admin.filters.useId`, `admin.filters.loading`,
  `admin.filters.resolveError`, `admin.filters.maxValues`,
  `admin.filters.unknown`, `admin.filters.state.archived/deleted/disabled`,
  plus per-facet labels and enum values.
- Domain data (board titles, names, emails) is not translated. Dates use the
  existing locale/hour12 helpers. Avoid plural-sensitive strings; use
  “Shown {shown} of {total}” / “Показано {shown} из {total}” patterns like the
  existing dictionary.
- RU copy must be reviewed in the 390/1024 screenshots; long words like
  “Исполнитель” must not clip the chip.

## 7. API and data contract

### 7.1 Query parameters

All params are optional and combine with the surface allowlist. Repeated params
are canonical for multi-value facets; comma-separated values are not part of the
new contract.

| Param | Shape | Surfaces | Semantics |
| --- | --- | --- | --- |
| `search` | string ≤200 | all | Existing substring search; unchanged |
| `status` | single enum | per entity | Existing tabs; `all` omitted from URL |
| `period` | `24h\|7d\|30d` | lists with period | UI preset → `from` timestamp; unchanged |
| `limit`, `offset` | ints | all | Existing bounds/caps |
| `boardId` | single id | cards, columns, labels, checklists, checklist items, links, comments, attachments, commands, activity, boards, shares (later) | Exact board; mismatch with `columnId` yields empty, never widened |
| `columnId` | single id | cards, comments, attachments, commands, activity | Exact column; commands use `touches` |
| `labelId` | repeated id (max 20) | cards (offered); other lists that already support it in 176.6 keep server support for old links, but do not offer it | OR by default; `labelMatch=all` requires every selected label |
| `labelMatch` | `any\|all` | cards | Default `any`; only meaningful with `labelId` |
| `cardId` | single id | cards, comments, attachments, checklists, checklist items, links, commands, activity | Exact card; links match either side |
| `checklistId` | single id | checklist items only (later tab) | Exact checklist |
| `assigneeId` | repeated user id (max 20) | cards | OR; combined with `unassigned` |
| `unassigned` | `true\|false` | cards | OR with `assigneeId`; omitted when false |
| `priority` | repeated enum (max 6) | cards | OR; `medium` also matches `null` (default priority) |
| `due` | `overdue\|soon\|none` | cards | Server `now`; `soon` = next 24 h; no timezone day buckets |
| `hasAttachments` | `true\|false` | cards | Live non-inline `attachmentCount` > 0 / = 0 |
| `ownerId` | single user id | boards | First accepted ADMIN membership |
| `verified` | `true\|false` | users | `emailVerifiedAt` null/not |
| `authorId` | repeated user id (max 20) | comments | OR |
| `kind` | repeated enum (max 6) | comments | note/status/question/blocker/evidence/handoff |
| `uploadedById` | repeated user id (max 20) | attachments | OR |
| `mime` | single enum | attachments | image/video/audio/pdf/document/other |
| `transcode` | single enum | attachments | none/pending/done/failed |
| `actorId` | repeated user id (max 20) | commands, activity | OR |
| `type` | repeated exact code (max 20) | commands, activity, card links | OR; options from server distinct values (card-link values are the link types) |
| `action` | repeated exact code (max 20) | audit | OR; options from server distinct values |
| `adminId` | repeated master id (max 20) | audit | OR; null-actor login rows remain search-only |
| `targetType` | repeated exact code (max 20) | audit | OR; distinct values from server |
| `targetId` | single string ≤100 | audit | Exact; may be `singleton` for settings |
| `commandId` | single id | commands, audit | Existing 176.10 correlation (only after that branch merges) |

`labelId`, `assigneeId`, `authorId`, `uploadedById`, `actorId`, `adminId`,
`type`, `action`, `targetType` and `kind` are arrays on the wire. A single value
is accepted and normalized to a one-element array. Structural params (`boardId`,
`columnId`, `cardId`, `checklistId`, `commandId`, `targetId`) stay single-valued;
a repeated value is a validation error rather than first-value-wins.

### 7.2 Combination semantics

- Different facets combine with **AND** (`boardId` + `priority` + `due`).
- Values inside a multi-value facet combine with **OR** (`labelId=a` OR `b`).
- `labelMatch=all` changes only the label facet to **AND across labels**; other
  facets keep their own semantics.
- `unassigned=true` is OR-ed with `assigneeId` values, matching the board
  filter. `unassigned=false` is a no-op and should not be written to the URL.
- `priority=medium` matches `priority = "medium"` **or `priority IS NULL`**
  because the product treats unset as medium (`DEFAULT_CARD_PRIORITY`). This is
  deliberate and tested; do not make “Medium” and “Not set” disagree.
- `due=soon` uses the same 24-hour window as `dueStatus` on the board; `overdue`
  is `< now`; `none` is `IS NULL`. Archived/deleted rows are included according
  to `status`, not because of the due facet.
- `hasAttachments=true` means at least one live, non-inline attachment
  (`attachmentCount > 0`); `false` means zero. Inline files are not part of the
  card-face count and must be documented in the chip tooltip/help.
- Status semantics stay per entity: cards `active` excludes archived/deleted,
  `archived` excludes deleted, `deleted` is any soft-deleted row (including a
  formerly archived one). The default `All` continues to include
  archived/deleted rows — filters do not silently change that.
- Period is a `createdAt` window (`from` inclusive), matching existing lists.

### 7.3 Validation rules

- Ids: existing `ADMIN_ID_PATTERN` (`[A-Za-z0-9_-]{1,64}`), trimmed; empty
  single filters are treated as absent (existing behavior), except `commandId`
  and `targetId` which reject an empty value.
- Arrays: `ArrayMaxSize(20)`; enum facets use their own size (priority and
  kind are 6). Each element matches the id pattern or the enum; dedupe in a
  transform. Reject the whole request with 400 if exceeded; do not truncate
  silently.
- Enums: exact lowercase values; unknown value → 400. The URL parser is more
  forgiving (unknown values are dropped) so a hand-edited link cannot break the
  page; the API remains strict.
- Booleans: only `true` and `false`; `1`/`0`/`yes` → 400.
- `targetId`: string 1–100 chars, letters/digits/`_:-`; no free-text SQL or
  path fragments.
- `action`/`type`/`targetType`: exact code strings ≤100 chars, safe alphabet;
  never `contains` for these filters (use `search` for text).
- Unsupported filter (a key the endpoint would ignore): the UI parser drops it;
  the backend returns 400 `unsupported_filter` for direct API calls. A
  supported-but-not-offered filter from an old URL is still applied and shown
  as a chip, but does not appear in the Add filter menu. This keeps 176.6 links
  working without advertising every legacy combination.
- Combined query length: cap at 32 values or 2 KB of filter state; the UI shows
  a readable “too many filters” message before navigation.

### 7.4 Filter option lookup

New read-only endpoint:

```http
GET /api/v1/admin/filter-options?type=board&q=design&limit=20
GET /api/v1/admin/filter-options?type=user&ids=u1&ids=u2
```

Types: `board`, `column`, `label`, `user`, `card`, `checklist`, `admin`,
`action`, `commandType`, `activityType`, `targetType`.

Response:

```ts
interface AdminFilterOptionDto {
  id: string;
  label: string;
  /** Board title, owner email, card context, role, etc. */
  sublabel: string | null;
  /** active | archived | deleted | disabled | revoked | null */
  state: string | null;
  /** Label palette key only for labels. */
  color?: string;
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
- `ids` resolves chips; it never returns unrelated rows. `missing` lists
  hard-deleted ids so the UI can render an explicit fallback.
- `limit` default 20, max 50. No total count; `hasMore` is a boolean.
- `boardId` narrows columns/labels/cards/checklists where provided. `cardId`
  narrows checklists.
- `action`, `commandType`, `activityType`, `targetType` return distinct stored
  values (limit 50) from the corresponding table; no invented enum list that
  drifts from data.
- Both OWNER and OPERATOR may call it. `admin` returns only `id`, `email`,
  `displayName`, `role`, `disabledAt`; never password hashes, TOTP secrets or
  allowlists. `user` returns `id`, `email`, `displayName`, `disabledAt`.
- The endpoint is read-only, audited only if existing admin read auditing says
  so (none today); it must not expose data a list row would not show.

### 7.5 Permissions and scoping

- All list surfaces are already behind `AdminJwtAuthGuard`; both master roles
  can read them. New filters follow the same rule.
- Filters never widen scope: `boardId` + `columnId` from different boards
  returns zero, not the union. All joins go through the row's actual relations.
- Operator restrictions:
  - Masters management remains owner-only. The audit actor filter may show a
    master's name/email because audit rows already do; do not link an OPERATOR
    to `/admin/access?tab=masters` (176.4 behavior).
  - No filter option may expose a field hidden from the corresponding list
    row (no secrets, no full session tokens, no password state).
- A direct 403 keeps the existing `ForbiddenState`; no client-side “filter
  around” fallback.

### 7.6 Performance and indexes

- Use equality/`IN` for ids and enums, range predicates for dates. Do not use
  `contains` for id/action/type filters.
- Measure with the existing 25k-card workload (`docs/PERF-25K-UX.md`):
  record p50/p95 for the unfiltered list and each new facet; target no more
  than +20% p95 for a single facet and no sequential scan over 10k+ rows.
- Candidate indexes (add only when the query plan proves a need; do not add a
  blanket index for every low-cardinality facet):
  - `Command @@index([actorId, createdAt])` for actor + period;
  - `Activity @@index([actorId, createdAt])`;
  - `AdminAuditLog @@index([action, createdAt])` for action + period;
  - `AdminAuditLog @@index([targetType, targetId, createdAt])` if target type
    is filtered together with period (the existing `[targetType, targetId]`
    covers the equality pair);
  - `Comment @@index([authorId, createdAt])` and `Comment @@index([kind, createdAt])`
    for moderation;
  - `Attachment @@index([uploadedById, createdAt])` for uploader;
  - `Card @@index([attachmentCount])` only if the anti-join for
    `hasAttachments=false` proves slow;
  - `CardLink @@index([boardId, type, createdAt])` if type + board is slow.
- Existing `Card @@index([assigneeId])` and `@@index([dueDate])` cover the
  common single-facet paths; combined board/column+assignee may need a
  composite measured against the actual query.
- Add indexes in a separate migration only after the plan is recorded; note the
  lock window for self-hosters in the PR. No data backfill.
- Lookup requests are parallel, debounced and cached in memory per admin
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

Replace the global accepted-everything parser with a registry, for example:

```ts
const ENTITY_FILTERS: Record<
  AdminEntity,
  { offered: readonly AdminFilterKey[]; supported: readonly AdminFilterKey[] }
> = {
  cards: {
    offered: [
      "boardId", "columnId", "labelId", "labelMatch", "assigneeId",
      "unassigned", "priority", "due", "hasAttachments", "cardId",
    ],
    supported: [
      "boardId", "columnId", "labelId", "labelMatch", "assigneeId",
      "unassigned", "priority", "due", "hasAttachments", "cardId",
    ],
  },
  comments: {
    // The picker offers the useful queue facets; 176.6's column/label scopes
    // remain supported for old links but are not advertised.
    offered: ["boardId", "cardId", "authorId", "kind"],
    supported: ["boardId", "columnId", "labelId", "cardId", "authorId", "kind"],
  },
  // ...
};
```

- `readAdminListQuery` receives `supported` and parses only those;
  `EntityPage` renders a chip for every active supported filter, even if it is
  not in `offered`.
- `writeAdminListQuery` removes only the keys it owns and never writes a key
  that is not supported.
- The filter picker receives `offered`; it cannot add a legacy-only facet.
- `useAdminList` builds the request from the parsed object, so unsupported
  facets cannot reach the server.
- The backend mirrors `supported` in `AdminEntitiesService.listEntity` (and the
  specialized list methods) with an explicit `unsupported_filter` 400.
- Add one shared `ADMIN_FILTER_MAX_VALUES = 20` and canonicalization helpers
  (trim, dedupe, sort, boolean/enum parsing) so client and server agree.

### 8.2 URL state

- Extend `AdminListFilters` to typed values:
  `string | null`, `string[]`, `boolean | null`, enum unions.
- `adminFiltersKey` must be stable and include every value/order (sorted) so
  selection scope and effect keys do not loop.
- `writeAdminListQuery` serializes repeated values with `append`, sorts and
  dedupes, and omits inactive/default values.
- Preserve `tab`, `comment`, `attachment`, `returnTo` exactly (existing).
- Extend `admin-navigation.ts`:
  - `adminCardsHref` accepts arrays and all card filters;
  - `adminCommentsHref`/`adminAttachmentsHref` accept author/uploader/kind/type
    where relevant;
  - `adminCommandsHref`/`adminActivityHref` accept actor/type;
  - add `adminAuditHref` for actor/action/target/period.
- `HubTabs` should copy `boardId` to the target tab when supported; add a
  per-tab `preserves` list rather than hard-coding every link.

### 8.3 Components

New files under `ui/src/admin/filters/`:

- `AdminFilterBar.tsx` — button, badge, chip row, clear all, live region.
- `AdminFilterPopover.tsx` — dialog/sheet shell, sections, Apply/Cancel.
- `FilterFacetPicker.tsx` — single/multi listbox or checkbox list, search,
  pinned selected rows, “Use id …”.
- `FilterChip.tsx` — icon, label, context, suffix, remove button.
- `use-filter-options.ts` — debounce, abort/generation, in-memory cache,
  resolve-by-id.
- `filter-registry.ts` — `AdminFilterKey`, per-entity definitions, labels,
  value parsers/serializers.

Reuse `Popover`, `Dialog`, `useCombobox`, `Button`, `Badge`, `Checkbox` and
tokens; do not fork the board `FilterBar` component. The board component is the
UX reference for chips and sections, not a shared dependency (it is
board-store-specific).

### 8.4 Row DTO changes

Minimal, additive:

- `AdminCommentRowDto.kind` (and select it in `listComments`), so the filter is
  visible and testable.
- `AdminAttachmentRowDto` needs a readable board label for chips/rows; either
  join the board title in `listAttachments` or resolve it through
  `filter-options`. Prefer the lookup for chips; add a board column only if the
  table needs it. Do not leave a hard-coded `—` where a filter depends on it.
- `AdminCardRowDto.attachmentCount` is optional; the filter works without it.
  Add it only if the row should show “N files”.
- No schema migration for filter values except optional indexes. `Comment.kind`
  already exists.

### 8.5 Selection and bulk actions

- `selectionScopeKey` includes all filter values (sorted arrays, booleans).
- Any filter add/remove/apply (including a chip `X` or Clear all) clears the
  selection; page/offset changes preserve it; limit changes clear it.
- The bulk contract from TASK-176.1 is unchanged: count, confirm and request use
  the same saved ids; new filters must not create a hidden selection.
- Test browser back to a previous filter state: the selection is empty because
  the result set changed.

### 8.6 Backend query construction

- Build an `AND` array, not ad-hoc `where` key assignment, so facets cannot
  overwrite each other (for example `where.OR` for search plus `where.OR` for
  priority). Keep search in its own `AND` branch.
- Use `in` for multi-values; for `labelMatch=all`, add one `labels.some` per id
  (or an `every` with the same predicate) and test the empty-list case.
- `priority=medium`: `OR: [{ priority: "medium" }, { priority: null }]`.
- `hasAttachments`: `attachmentCount: { gt: 0 }` / `{ equals: 0 }`; document
  that it excludes inline/deleted.
- `mime`:
  - image: `startsWith("image/")`
  - video: `startsWith("video/")`
  - audio: `startsWith("audio/")`
  - pdf: `application/pdf`
  - document: `text/*` plus office/CSV/JSON types
  - other: none of the above
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
| 181.1 | Filter contract: per-surface registry, URL parser/writer, DTO arrays/booleans/enums, `filter-options` endpoint, shared client | P1 | M | 1 | TASK-176.5/6 in main |
| 181.2 | Filter bar/popover/chips/resolution on cards: board, column, label; mobile/keyboard/EN-RU | P1 | L | 1 | 181.1 |
| 181.3 | Cards full facets: assignee/unassigned, priority, due, hasAttachments, labelMatch, period | P1 | M | 1 | 181.2 |
| 181.4 | Moderation hub: comments (author/kind) and attachments (uploader/MIME/transcode); preserve board context across tabs | P2 | M | 2 | 181.2 |
| 181.5 | Content lists: users verified/period, boards owner, columns/labels/checklists/links filters | P2 | M | 2 | 181.2 |
| 181.6 | Audit hub: audit actor/action/target, commands actor/type, activity actor/type; operator-safe actor lookup | P2 | M | 2 | 181.2; 176.10 for `commandId` |
| 181.7 | Docs, CHANGELOG, EN/RU admin guide, visual/a11y/perf acceptance, final URL/regression sweep | P2 | S/M | 3 | 181.3–181.6 |

### 181.1 — Filter contract and lookup (P1)

**Deliverables**

- Shared types/constants: `AdminFilterKey`, per-entity allowlist, max values,
  lookup DTOs, canonicalization helpers.
- `admin-list-query.ts`: arrays, booleans, enums, per-surface parsing, sorted
  serialization, stable key.
- `use-admin-list.ts`/`use-admin-list-query.ts`: send only supported filters;
  no behavior change to search/back/forward.
- `AdminListQueryDto`: new optional fields with strict validation; repeated
  single params rejected; 400 for unsupported filters on a surface.
- `GET /admin/filter-options` with both roles, minimal fields, distinct-value
  modes, `missing`/`hasMore`.
- Backend e2e for validation/lookup; unit tests for round-trip and allowlist.

**Acceptance**

- A URL with `?assigneeId=…` on `/admin/users` renders no chip and sends no
  filter; direct `GET /admin/entities/users?assigneeId=…` returns 400.
- A multi-label URL round-trips exactly; order is canonical; duplicates are
  removed; >20 values is a readable 400/UI error.
- Lookup resolves board/column/label/user/card/admin by id and by search, never
  returns secrets, and reports missing ids.
- Existing 176.5/176.6 tests pass unchanged (or only extend, never weaken).

### 181.2 — Filter bar and cards pilot (P1)

**Deliverables**

- `AdminFilterBar` + popover + chips + resolution cache on cards.
- Board/column/label pickers (label stays single-value in this slice; multi-label
  and `labelMatch` arrive in 181.3), add/remove/clear, human labels, unknown
  fallback.
- Mobile sheet and keyboard model; EN/RU strings; live result announcement.
- `EntityPage` uses the registry and the new bar for cards; other lists keep
  their existing header until their subtask.
- Component tests with fake lookup; browser test 1440/1024/390 for cards.

**Acceptance**

- A master can add “Board: Design system”, “Column: In progress”, “Label:
  urgent” without editing the URL; chips show names/colors, not raw ids.
- Removing a chip/clear all updates the URL and the list; reload/back/forward
  restore the exact filtered view; `returnTo` still works.
- An unknown/deleted id shows an explicit short-id fallback, not a blank chip or
  a silent unfiltered list.
- Empty state distinguishes “no data” from “no matches”; total is the server
  total.
- 390: no horizontal page overflow; status/period tabs are reachable; sheet
  controls are at least 44 px; Escape closes and focus returns.
- Keyboard-only add/remove works; screen reader labels name the facet + value.

### 181.3 — Cards full facets (P1)

**Deliverables**

- Assignee multi + unassigned, multi-label + `labelMatch` any/all, priority multi
  (null=medium), due overdue/soon/none, hasAttachments, period.
- Backend service mapping, DTO validation, query-plan evidence, indexes only if
  measured.
- Chips for each value; picker sections; EN/RU; tests.

**Acceptance**

- Combining facets is AND; multi-values are OR; label `all` requires every
  selected label; `unassigned` ORs with assignee ids.
- `priority=medium` returns both `medium` and unset cards; the count matches a
  seeded fixture; this is documented in the chip/help.
- `due=soon` uses the 24-hour window; `overdue`/`none` are exact; archived/
  deleted inclusion follows status.
- `hasAttachments=true/false` agree with live non-inline attachments; inline
  files are documented as excluded.
- Filter changes reset the page and clear bulk selection; offset changes keep
  selection.
- No regression >20% p95 on the measured dataset; EXPLAIN evidence attached.

### 181.4 — Moderation hub (P2)

**Deliverables**

- Comments: author/kind filters, kind visible in the row; board/card/period.
- Attachments: uploader/MIME/transcode filters; board/card/period; readable
  board context.
- Preserve `boardId` across Comments↔Attachments; reset incompatible params.
- EN/RU; component/e2e/browser tests.

**Acceptance**

- Comments can be narrowed to one author or to blocker/question kinds; the row
  shows the kind badge and the total is exact.
- Attachments can be narrowed to one uploader, one MIME family, or failed
  transcodes; image/video/pdf/document/other tests cover each branch.
- Switching Comments→Attachments keeps the board filter and drops the comment
  author/kind; switching back does not resurrect stale values.
- Operators can use every filter; no owner-only link is introduced.
- Empty states per tab; deleted/archived semantics documented.

### 181.5 — Content lists (P2)

**Deliverables**

- Users: verified filter + period; status unchanged.
- Boards: owner filter; status unchanged.
- Columns/labels/checklists: board/card filters exposed through the kit.
- Card links: type filter + card/board.
- No new checklist-items tab; decision recorded in the spec/docs.
- Tests per entity and a browser sweep of the Boards hub.

**Acceptance**

- Each list shows only its supported filters; no no-op chip is possible.
- “Boards owned by user X” and “cards in column Y” open exact paginated lists.
- Card links filter by `blocks`/`relates_to`/`duplicates` and by card (either
  side).
- Users with unverified email are findable without showing a false total.
- Existing 176.6 counter/column/label links still work and now show readable
  chips.

### 181.6 — Audit hub (P2)

**Deliverables**

- Audit: actor/master, action, target type, target id; keep commandId.
- Commands: actor, type, card/column; keep board/period.
- Activity: actor, type; keep board/card/period.
- Read-only actor lookup for both roles; owner-only links remain owner-only.
- Distinct action/type options from the server; chips show codes with readable
  context.

**Acceptance**

- A master can answer “what did this master do to this board/card in 30 days?”
  with actor + target + period; totals are exact.
- Command type/actor filters combine with board/card and pagination; the 176.10
  command↔audit link still opens the same row.
- Activity type separates membership changes from comments; actor filter works.
- OPERATOR can use the actor filter and sees text, not a 403 link to Masters.
- Null-admin login attempts remain findable through search (documented edge).

### 181.7 — Docs, acceptance and rollout (P2)

**Deliverables**

- Update EN/RU admin docs: `site/src/content/docs/{docs,ru/docs}/admin/content.md`,
  `monitoring.md`, `people.md`, `redesign.md` (filter bar, allowlist, URL
  examples, mobile/keyboard behavior).
- CHANGELOG entry.
- Final browser matrix and screenshots 1440/1024/390, RU + EN.
- Perf evidence and any index migration notes.
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
  duplicates, cap, unsupported keys, crafted values, `returnTo` preservation.
- Per-surface registry: every entity only exposes its allowed keys; backend and
  UI lists agree (table-driven test).
- Semantics: priority null=medium, label any/all, unassigned OR, due
  overdue/soon/none, MIME family mapping, status/archived/deleted.
- Lookup DTO: type/query/ids/limit validation; no secret fields in serialized
  responses.
- `adminFiltersKey`/selection scope includes arrays and booleans.

### Component

- `AdminFilterBar`: open/close, badge count, chip add/remove, clear all,
  loading/error/fallback labels, max-values hint.
- Pickers: debounce, stale-response abort, keyboard arrows/Home/End/Enter/Space/
  Escape, focus return, “Use id …”.
- Empty state: no data vs filtered vs lookup error; no fabricated count.
- Selection reset on filter change; preserved on paging.
- EN/RU rendering with long labels/emails; no clipping in jsdom snapshot.

### Backend e2e

- Seed two boards with identical titles, two labels with identical names, cards
  with/without labels, null/medium priorities, due dates around now, assignees/
  unassigned, attachments of each MIME and transcode state, comments of each
  kind/author, commands/activity/audit with different actors/actions/targets.
- Each facet returns only matching rows; combinations are AND; arrays are OR;
  totals exact; pagination exact.
- Cross-board/column/label mismatch returns zero (no union).
- Status semantics and deleted/archived inclusion documented and tested.
- Invalid/oversized/unknown values → 400; unsupported filter per surface → 400;
  empty single filter behavior unchanged.
- Operator vs owner: lookup/read works; management/owner-only links do not.
- Lookup `ids`/`missing`/`hasMore`, deleted/archived/disabled states, no secrets.

### Browser (Playwright admin suite)

- 1440/1024/390: add board/column/label via picker, chip text is a name, remove,
  clear all, reload, back/forward, `returnTo`; no horizontal overflow.
- Cards: assignee/priority/due/attachments/label-all; exact total matches seeded
  count; empty state.
- Moderation: comment author/kind; attachment uploader/MIME; board preserved
  across tabs.
- Audit: actor/action/target/period; command 176.10 deep link.
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

1. Merge 181.1 (contract + lookup) with no UI change; old URLs and lists behave
   exactly as before.
2. Merge 181.2 (cards pilot) and 181.3 (cards facets); this is the highest-value
   slice and validates the lookup/performance assumptions.
3. Merge 181.4–181.6 independently after 181.2; each is one PR with its own
   tests. Do not combine hubs in one PR.
4. Merge 181.7 docs/acceptance last.
5. No feature flag: the admin panel is internal and the change is additive. If
   the lookup endpoint is unavailable (older backend), chips fall back to
   short ids and retry; no data is lost.
6. Index migration (if any) is separate, measured, and documented for
   self-hosters. No data backfill.
7. Rollback: revert the UI/endpoint; filter params remain harmless, old links
   still work, and no schema/data change is required beyond optional indexes.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Silent no-op filters (the current bug) | Per-surface allowlist in UI + 400 on backend; table-driven parity test |
| Raw ids reappear on new surfaces | One `FilterChip` + server resolver; tests assert human labels for every entity filter |
| Lookup latency/N+1 | Parallel resolve, 30–60 s cache, 250 ms debounce, abort stale requests, limit 20 |
| Extra indexes lock a large table | Measure first; separate migration; document lock window; add only proven composites |
| Ambiguous names (same board/label) | Store ids; show context and short id in tooltip; exact filters; test duplicates |
| Deleted/archived semantics confuse counts | Document per entity; test `All` vs `Active`; show suffix in chips |
| Mobile overflow/regression | Bottom sheet, wrapping chips, 390 overflow assertion, status tab scroll fix |
| Operator privacy/403 regression | Minimal lookup fields; owner-only links stay text for operators; e2e matrix |
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
- Filter-option match counts, CSV export of filtered lists, analytics.
- MCP/public API exposure, master-authored edits, agent control (TASK-176.11).
- Changes to global search ranking/caps (TASK-177.10 owns the user-facing cap).

## 14. Open product questions

1. **Hub context:** preserve only `boardId` across tabs (recommended) or reset
   everything? If preserving, should search/status also follow?
2. **Apply model:** draft + Apply for multi-select (recommended) or immediate
   apply per checkbox? Immediate apply is faster but creates history spam.
3. **Priority null:** should “Medium” include unset cards (recommended, matches
   `DEFAULT_CARD_PRIORITY`) or should “Unset” be a separate visible option?
4. **Label match:** expose any/all in the picker (recommended for cards) or keep
   any-only and defer all?
5. **Inline attachments:** keep them in the admin list with a badge, hide them by
   default, or add an `inline` facet in a follow-up? Do not let them silently
   change `hasAttachments` counts.
6. **Checklist items:** keep TASK-176.12 deferred (recommended) or add a tab
   with board/card/checklist/done? Requires support evidence.
7. **Sessions/tokens:** is a truthful status filter worth a separate subtask, or
   should Access remain search/period-only in this task?
8. **Actor directory:** is a read-only master directory for OPERATOR acceptable
   (needed for a searchable actor picker), or should operators type an email and
   rely on text?
9. **Deleted entities:** show the name with a `(deleted)` suffix and an active
   empty result (recommended), or resolve to “unknown” immediately?
10. **Clear all copy:** “Clear search and filters” (recommended, because it
    resets search/status/period) or keep “Clear filters” and leave search?
11. **Filter option counts:** confirm that v1 shows none (recommended) to avoid
    expensive/fabricated aggregates.
12. **Board period filter:** add a created/updated period for boards now or defer
    until support asks?

## 15. Definition of Done

- The confirmed filter inventory in §5.7 is implemented for cards, comments,
  attachments, audit, commands, activity, users, boards, columns, labels,
  checklists and card links; speculative facets are not silently added.
- Every ID/name filter chip is human-readable via the lookup endpoint; missing/
  deleted values have an explicit fallback; no raw-id chip remains where a name
  exists.
- The per-surface allowlist prevents no-op filters in the UI and on the API;
  old 176.5/176.6 URLs keep working.
- URL round-trip, deep links, `returnTo`, pagination and bulk selection remain
  truthful; filter changes reset the page and clear selection; totals are exact.
- Multi-value/boolean/enum validation is strict; errors are actionable; no
  truncation or silent narrowing.
- Lookup endpoint is read-only, operator-safe, cached/debounced and covered by
  tests; no secret fields leak.
- Performance evidence exists for each new facet; indexes are justified by
  query plans; no regression beyond the agreed budget.
- EN/RU strings are complete; 1440/1024/390 browser tests and keyboard/focus/
  screen-reader checks pass; no horizontal overflow at 390.
- Docs (`content.md`, `monitoring.md`, `people.md`, `redesign.md` EN/RU),
  CHANGELOG and this spec are updated; `format:check`, lint, typecheck, unit,
  shared, backend e2e and browser suites are green with no weakened tests.
- No production code belongs in this planning ticket; the follow-up PRs implement
  it under `feat/TASK-181.x-*` with one PR per subtask.
