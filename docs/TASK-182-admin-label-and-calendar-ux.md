# TASK-182 — Admin card label UX and calendar resilience

**Status:** proposed (docs-only, 2026-11-19). This ticket contains no production
code and does not require running the test suites.
**Priority:** P1 for the calendar blast radius; P2 for the label UX polish.
**Delivery:** two independent PRs. Phase 1 is the small label PR (P2); phase 2
is the higher-priority calendar PR (P1). The phase numbers describe delivery
order, not severity. Labels go first because that PR is tiny, isolated and can
land while the larger calendar seam/test harness is written; the calendar is
P1 and should not wait behind unrelated work. If strict priority order is
preferred, swap the two PRs without changing either scope.
Both phases touch `ui/src/admin/CardFieldsPanel.tsx` and
`ui/src/admin/admin-i18n.ts`; if they run in parallel, phase 2 rebases on phase
1 (or the shared changes are extracted first).
**Baseline:** behavior observed on `feat/TASK-176.9-admin-card-relations` @
`7bb2848b` (TASK-176.9 B1 fields + B2 relations). That is the exact known
feature tip at proposal time; implementation must rebase on the final
TASK-176.9 branch tip or merge commit and re-check the cited lines.
**Scope:** `/admin/cards/:id` → Properties panel only. Phase 1 fixes the label
control; phase 2 contains the due-date/calendar failure. Shared
`DateTimeField`, `calendar-lazy`, announcement scheduling and board calendar
surfaces keep their current behavior. No backend changes.
**Related:** TASK-176.9 (the admin card field editor); TASK-181/§7.30/row 112
(parallel admin-list-filters ticket; reserved and not part of this diff).

---

## 1. Why

The new admin card editor is useful but has two rough edges that make the
Properties panel feel less trustworthy than the rest of the admin console:

1. **Labels give no explanation and repeat the same toast.** Every label click
   sends a real `SET_CARD_LABEL` command and paints a new “Label updated” toast.
   Rapid toggles stack identical 4.5-second toasts. Nothing next to the Labels
   control explains that labels save immediately, that a click attaches or
   detaches, or that the change appears in board history.
2. **A calendar chunk failure takes down every field.** Opening the due-date
   calendar in the live demo could replace the entire Properties panel with the
   generic “Could not load the card field editor. Reload the page to try again.”
   fallback. The investigation attributed the runtime trigger to a dev-server
   prebundle/cache collision, but the product bug is broader: the field panel
   boundary is scoped to the whole panel, so one nested lazy calendar failure
   hides title, assignee, due, priority, cover and labels. There is no
   card-local retry.

Both issues are small enough to fix without turning `/admin` into a second
board client. They are kept in one ticket because they touch the same panel and
share the same acceptance surface: a Properties panel whose controls explain
themselves and degrade locally instead of disappearing.

## 2. Evidence and current behaviour

### 2.1 Labels

At `7bb2848b`, `ui/src/admin/CardFieldsPanel.tsx`:

- `toggleLabel()` computes `on = !selectedLabelIds.has(labelId)`, returns early
  when the per-card cap would be exceeded, and calls:
  `send("labels", { type: "SET_CARD_LABEL", labelId, on }, "admin.cards.toast.labelSaved")`.
- `send()` creates a fresh `commandId`, posts the command, and on success calls
  `toast.success(t(successKey))` followed by `onSaved()`.
- The Labels group disables its buttons while `busy !== null`, so commands are
  serialized; every completed toggle still produces a separate success toast.
- Errors are caught by `send()` and written to the inline `errors.labels`
  message. Label failures do not use toasts.
- The Labels field has no help affordance. The only nearby hint is the generic
  panel-level “Each field is its own board command.” It does not explain the
  immediate-save/click-to-toggle/board-history model.

`ui/src/components/Toast.tsx` explains the stacking:

- `push()` increments `nextIdRef` for every call, appends a `ToastItem`, and
  starts a fresh `DISMISS_AFTER_MS = 4500` timer.
- There is no dedupe by message, variant or key. Identical success and error
  messages are always appended.
- `ToastApi` exposes only `success(message)`, `error(message)` and `info(message)`;
  callers cannot clear or replace their previous confirmation.

The generic hint `admin.cards.fields.hint` and the label strings live in
`ui/src/admin/admin-i18n.ts` (EN/RU dictionaries). The labels toast key is
`admin.cards.toast.labelSaved` (“Label updated” / “Метка обновлена”).

### 2.2 Due-date calendar

The live-demo investigation recorded this failure path:

1. In `/admin/cards/:id` → Properties, click the due-date control.
2. The whole Properties panel is replaced with “Could not load the card field
   editor. Reload the page to try again.”
3. The rest of the card page stays usable, but all field editors are gone.

Two separate layers explain it.

**(a) Dev-environment trigger (working hypothesis, not a CI reproduction).**
The investigation supplied with the review found that the demo dev server
served mismatched Vite prebundles: `react-day-picker` and a second React copy
(or stale React prebundle) reached the lazy calendar graph. The UI runs with
parallel worktrees whose `node_modules` is shared through a symlink (the comment
in `ui/vite.config.ts` already acknowledges this). Vite’s default `cacheDir` is
`node_modules/.vite`, so all dev servers can share one dependency cache. The
production build worked, which points to a development cache collision rather
than a missing backend route or a broken production import.

This root cause was not independently reproduced in CI for this proposal. No
standalone artifact is linked; the notes were supplied with the 2026-11-19
review. The document therefore treats it as an environment trigger to document
and prevent, not as the product fix. The exact prebundle state may have been
local to the demo checkout.

**(b) Product bug: the error boundary is too broad.** In
`ui/src/admin/CardDetailPage.tsx` (feature tip), `CardFieldsChunkBoundary`
wraps the entire lazy `CardFieldsPanel`:

```tsx
<CardFieldsChunkBoundary fallback={<CardFieldsFallback />}>
  <Suspense fallback={...}>
    <CardFieldsPanel card={card} cardLabels={detail.labels} onSaved={reload} />
  </Suspense>
</CardFieldsChunkBoundary>
```

`ui/src/components/ui/calendar-lazy.tsx` has a `React.lazy()` import wrapped
only in `Suspense` (a skeleton while pending). It has no error boundary of its
own. When the calendar import rejects, React finds the nearest boundary — the
outer `CardFieldsChunkBoundary` — and replaces the whole panel. The fallback
copy says the card field editor could not load and offers only a full page
reload. That is misleading for a calendar-only failure and destroys access to
unrelated, healthy fields.

Existing coverage only proves the whole-panel failure path:
`CardDetailPage.test.tsx` throws inside `CardFieldsChunkBoundary` and asserts
`admin-card-fields-error`. There is no test where the nested calendar fails
while title/assignee/priority/cover/labels remain mounted, and no field-level
retry path.

### 2.3 Environment fix vs product fix

Clearing `node_modules/.vite` or restarting the dev server may make the demo
work again, but it does not make the product resilient:

- a transient chunk load failure, a half-deployed server, an offline tab or a
  stale prebundle can still reject the calendar import;
- the current boundary would still hide every field;
- the current message would still blame the whole field editor.

The dev cache collision should therefore be documented and prevented separately
(per-checkout `cacheDir` or a documented `--force`/cache-clear step). It is an
environment/runbook concern, not a product acceptance criterion.

## 3. Goals and non-goals

### Goals

- Add an accessible, visible info/help button next to the Labels heading. It
  explains immediate save, click to attach/detach, and board-history visibility.
- Make repeated label toggles produce **one refreshed confirmation**, not a
  growing stack of identical “Label updated” toasts, and make sure a stale
  success cannot outlive a later failed label command.
- Keep label command completion card-scoped: a late success, failure or busy
  reset from card A must not toast, set an inline error or disable controls on
  card B after navigation.
- Keep `SET_CARD_LABEL` behavior exactly as it is: one real command per actual
  change, cap/no-op guards unchanged; a same-label double-click must not queue
  two commands.
- Isolate a due-date calendar chunk/render failure to the due-date calendar in
  `CardFieldsPanel`: the rest of the Properties panel stays editable.
- Define a field-level calendar fallback contract that can replace the
  calendar+time pair with an accessible native `datetime-local` input, so the
  fallback does not duplicate or ignore the time value.
- Leave `DateTimeField`, `calendar-lazy`, announcement scheduling and board
  calendar consumers behaviourally unchanged when the card-local fallback is
  not requested.
- Handle a rejected `react-day-picker/locale` import without an unhandled
  effect rejection; fall back to the default locale or the field fallback.
- Document the dev-only Vite cache trigger and the production/dev distinction.

### Non-goals

- No backend change, new API, new command or audit contract.
- No full card editor redesign; no new board interaction model.
- No global toast dedupe that changes unrelated success/error behavior.
- No new date-picker library and no eager import of the calendar (that would
  violate the existing lazy-chunk size budget).
- No changes to announcement scheduling or board card/calendar surfaces, their
  copy or their tests. This ticket is card-local.
- No attempt to hide or downgrade real command errors: label errors remain
  inline, and global command errors keep their existing toast path.
- No browser/PWA “reload the whole app” as the primary UX for a calendar
  failure.

## 4. Code map (feature tip `7bb2848b`)

| File | Scope for TASK-182 |
| --- | --- |
| `ui/src/admin/CardFieldsPanel.tsx` | Labels section, `toggleLabel()`, `send()`, due-date section; keep `onSaved: () => void`, add `optimisticLabelIds` (intersected with live board labels), guard-before-mutation ordering, per-card in-flight guard, ambiguous-resync pending guard, label command start/end callbacks; optional `calendarLoader` test seam and internal `CardCalendarFallback`. |
| `ui/src/admin/CardCalendarFallback.tsx` (new, or a local component) | Card-local accessible native `datetime-local` fallback + Retry; replaces the calendar+time row when the calendar fails. |
| `ui/src/admin/ui.tsx` | `Field` label rendering; add an optional label/action slot so the Labels help button is not nested in a `<label>` (phase 1 only). |
| `ui/src/components/Toast.tsx` | `ToastProvider`, append-only `push()`, 4.5 s timers, `ToastApi`; add opt-in keys/clear, fresh append after clear, and dismissal map cleanup (phase 1). |
| `ui/src/admin/CardDetailPage.tsx` | Lazy `CardFieldsPanel` and the outer `CardFieldsChunkBoundary`; monotonic `detailRequestSeq` + `AbortController` so only the latest request may `setDetail`/`setError`; track in-flight label commands; retry clears `detail`/shows skeleton and waits for pending labels before a fresh request; key `CardFieldsPanel` by `card.id`. |
| `ui/src/admin/admin-client.ts` | Optional `AbortSignal`/timeout support for `sendBoardCommand` (label command timeout); preserve existing callers when omitted. |
| `ui/src/admin/announcements/DateTimeField.tsx` | Optional `calendarLoader`, `calendarFallback: ComponentType<CalendarFallbackState>` rendered as a component, and calendar-error handling; export/share `CalendarFallbackState`; default behavior unchanged when the card-local props are omitted. |
| `ui/src/components/ui/calendar-lazy.tsx` | Existing lazy calendar used by other consumers. Expose a `createCalendar(loader?)` factory (or equivalent) for retries and share/export `CalendarProps`; catch locale-import rejection; the existing `Calendar` export and default behavior stay unchanged. |
| `ui/src/admin/announcements/AnnouncementEditorDialog.tsx` | `DateTimeField` consumer; **intentionally untouched**, keeps default calendar behavior and copy. |
| `ui/src/components/board/CardDueDate.tsx`, `FilterBar.tsx`, `BoardMembersDialog.tsx` | Actual board `calendar-lazy` consumers; **intentionally untouched**, keep default calendar behavior and copy. `CardDialog` reaches the calendar indirectly through `CardDueDate`; `CalendarView`/`calendar-parts` do not import `calendar-lazy`. |
| `ui/src/components/ui/popover.tsx` | Existing Radix popover primitive used by the same panel (cover picker). |
| `ui/src/admin/admin-i18n.ts` | EN/RU strings; `AdminMessageKey` type catches missing translations. |
| `ui/src/admin/CardDetailPage.test.tsx` | Existing whole-panel chunk fallback test and label toggle tests. |
| `ui/src/components/Toast.test.tsx` | Toast append, auto-dismiss and close tests; keyed refresh/clear coverage. |
| `ui/vite.config.ts` | Dev server config; no `cacheDir` today while worktrees share `node_modules`. Environment-only note. |

## 5. Options and trade-offs

### 5.1 Label help affordance

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Popover anchored to an info icon button** | Click and keyboard activation; multi-line explanation; Escape/outside-click close; focus return; the same Radix `Popover` primitive is already used in this panel for Cover | Slightly heavier than a tooltip; needs focus and responsive tests | **Recommended** |
| Tooltip on an info icon | Smallest markup; familiar desktop pattern | Hover-first, unreliable on touch; long copy is cramped; not a good place for “click to toggle” instructions; keyboard/touch discoverability is weaker | No |
| Always-visible inline hint under the heading | No interaction needed | Adds permanent vertical noise to every card; does not provide the requested button; the panel already has a generic hint above | No |
| Dialog | Maximum room | Overkill for two sentences; modal focus trap for a passive explanation | No |

The button should live in the Labels heading row, not on each label chip. Its
accessible name is the affordance (“About labels” / “О метках”), the icon is
`aria-hidden`, and the visible text in the popover is the explanation. This
keeps the label chips uncluttered and avoids giving every label two hit targets.

### 5.2 Label success toast

**Chosen: keyed, opt-in toast refresh scoped per card.** The inline-status
alternative was considered but is not selected; the keyed approach keeps the
existing global confirmation location and has a narrow blast radius.

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Keyed refresh + clear-on-start/failure** (`toast.success(message, { key })`, `toast.clear(key)`) | One visible label toast; timer resets; a later failure cannot leave a stale success; unkeyed toasts stay additive; errors are untouched | Requires a small `ToastApi`/timer bookkeeping change and tests; key must include the card id | **Chosen** |
| Label-local inline status (`role="status"` under the group), no label success toast | No provider change; contextual confirmation | New label-specific state/markup; less visible; removes existing success feedback | Not selected |
| Global dedupe by message + variant | One change fixes every repeated toast | Changes semantics for unrelated actions; identical errors would collapse or need an error special-case, which can hide a second distinct failure | No |
| Suppress label success toasts entirely | Trivial | No confirmation that a click was accepted; user may repeat the action | No |

The key must be per card, for example
`admin.card.labels:${card.id}`, not a single global `admin.card.labels`.
Otherwise a success toast from card A can survive navigation and look like a
confirmation on card B.

The lifecycle is part of the fix:

1. When a label command **starts**, clear the current card's keyed toast. This
   removes any previous success before the new outcome is known.
2. When the command **fails**, clear the key again (defensive) and keep the
   existing inline `errors.labels` message. No success toast may remain.
3. When the command succeeds, append the fresh keyed success toast immediately
   (command success, not reload success). Because the old item was cleared at
   start, the new one is a fresh live-region insertion and its timer starts
   from zero. A failed command never shows a success toast.
4. On card change/unmount, clear the keyed toast for the card being left. A
   toast from card A must not remain visible on card B.

Errors stay unkeyed and additive. Two identical failures still produce two
visible error toasts. Unkeyed successes from unrelated actions remain additive
as well; only the label success path opts into replacement.

`toast.clear(key)` must cancel the keyed toast's timer as well as remove its
item. Otherwise an old 4.5-second timer can dismiss a newer toast that reuses
the key. Cover clear→success with fake timers.

The provider's key→toast/timer map must delete the entry on every dismissal:
manual close button, 4.5-second auto-dismiss, key clear and unmount. A stale
mapping makes a later re-add of the same key target a dead item. Add
close→re-add and auto-dismiss→re-add tests.

A keyed success **appends a fresh item after the start-of-command clear**; it
must not update the old item in place. That gives `aria-live` a removal and a
new insertion, so an identical “Label updated” message is announced again.

**Chosen design: optimistic label state + background refresh.** Keep
`onSaved: () => void` unchanged for every field. The label state is local
optimistic state plus a small ambiguous-resync guard, not a label reload
lifecycle.

- `CardFieldsPanel` keeps `optimisticLabelIds`, intersected with the live
  `boardLabels` ids (preserve the existing deleted-label filter and cap
  behaviour); selected chips derive from that set.
- A click first checks `busy`, the label cap and the per-card in-flight ref,
  **before** computing or applying anything. A blocked click is a pure no-op:
  no optimistic mutation, no toast, no inline error, no command. Only after
  those guards pass: capture the previous set, compute the next `on` from the
  optimistic set, apply it, clear the keyed toast, notify the page that a label
  command started, and send `SET_CARD_LABEL`.
- One per-card in-flight ref blocks a second label command while the first is
  pending, including the other half of a fast double-click and a click on a
  different label. If the send path cannot start (`send === false`), do not
  apply or revert anything; the click was a no-op.
- The label command gets a bounded timeout and optional `AbortSignal` through
  `adminApi.sendBoardCommand`. Extend the admin client with an optional
  signal/timeout option; if that is too broad for the client, a
  `Promise.race` timeout is the fallback baseline, but the request may still
  have applied server-side, so timeout is always treated as ambiguous.
- Success: keep the optimistic set, show the keyed toast immediately (command
  success, not reload success), call the existing void `onSaved()`, and release
  the in-flight guard. The next click before the background reload uses the
  optimistic set and computes the correct new `on`.
- **Definitive 4xx failure** (400/404/409): restore the previous optimistic set,
  clear the toast, show the existing inline error, release the guard, and do not
  resync unless the conflict copy requires it. No success toast.
- **Ambiguous failure** (transport error, timeout/abort, 5xx): restore the
  previous optimistic set, clear the toast, show an inline error, set
  `labelResyncPending`, call `onSaved()` for resync, and keep label controls
  disabled until that resync commits. Release the per-card command guard, but
  keep the resync guard separate: a new label click is not allowed while the
  server state is unknown.
- Reconcile `optimisticLabelIds` from `cardLabels` only when the prop came from
  a detail request **started after the label command settled**. `CardDetailPage`
  bumps a monotonic `detailRequestSeq` at label command start and on every
  reload; `CardFieldsPanel` records the settle sequence and ignores prop changes
  from older requests. This prevents a sibling reload that commits old labels
  during the pending window from being adopted after the guard clears. On
  ambiguous failure, adopt only a request started after the failure settle
  before clearing `labelResyncPending`.
- Key `<CardFieldsPanel key={card.id} …>` in `CardDetailPage` so A→B resets
  local state. The per-card generation/mounted guard ignores a late A
  success/failure: it cannot toast, set an inline error, update optimistic
  state or disable controls on B. Generation is card identity only; a same-card
  detail/relations reload does not invalidate an in-flight command.

**Parent reload serialization and page errors.** All `CardDetailPage` detail
reloads — initial/page load, relations `onSaved`, field `onSaved` — go through
one monotonically increasing request sequence plus `AbortController`; only the
latest request may `setDetail`. `setError` is guarded by the same request token,
so a rejected stale sibling cannot put the page into `ErrorState`.

The page tracks in-flight label commands through start/end callbacks from
`CardFieldsPanel`. If a page error/retry happens while a label command is
pending, clear `detail` and show the skeleton (or keep the panel unmounted) and
wait for the pending label command to settle before starting a new detail
request. The retry starts a fresh sequence after that settle, and only then
remounts `CardFieldsPanel` with fresh labels. A late label response from an
unmounted panel is ignored by the mounted/card guard. There is no label-specific
page error path.

The keyed toast lifecycle stays as described above: clear at command start,
clear on failure/navigation, and show the success toast only after the command
resolves — never before it. The toast timer/key map cleanup remains unchanged.

### 5.3 Calendar containment

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Card-local due-date boundary + injectable retryable calendar seam + graceful fallback** | A calendar failure is contained to the card's due-date editor; other fields remain mounted; specific card copy; retry; no announcement/board changes | Needs a small optional seam in `DateTimeField` and careful retry/focus handling | **Recommended core** |
| Put a card-specific boundary/copy unconditionally inside shared `DateTimeField` | Fewer card-local files | Would change the blast radius and copy for announcements (the other `DateTimeField` consumer) and board `calendar-lazy` consumers; rejected. The optional, inactive-by-default fallback contract below is different: only the card passes it. | No |
| Preload/retry the calendar chunk on popover intent | Can avoid the first-open failure and recover from transient network errors | Does not contain a failure if the retry also fails; does not fix the misleading whole-panel fallback by itself | Complementary, not sufficient |
| Native `datetime-local` fallback (chosen) vs read-only due display | Native keeps the due value editable; read-only is visually consistent but cannot recover the due edit | Native follows OS locale/theme and needs formatting/timezone tests; read-only would require a different contract/copy | **Native chosen** |
| Eagerly import the calendar / remove the lazy boundary | No lazy failure | Adds `react-day-picker`/`date-fns` to the critical path and breaks the size budget | No |
| Keep the whole-panel boundary and only improve the message | Small copy change | Still hides all healthy fields; no field-level retry | No |

Recommended minimal robust design: keep `CardFieldsChunkBoundary` as the outer
guard for the whole `CardFieldsPanel` chunk, and give `DateTimeField` an
optional **field-level fallback contract** used only by the admin card:

- `calendarLoader?: () => Promise<{ Calendar: CalendarComponent }>` — fresh
  lazy import attempts; production default is the existing module import.
- `calendarFallback?: ComponentType<CalendarFallbackState>` — a component, not
  a plain render callback; `DateTimeField` renders it as
  `<CalendarFallback {...state} />`/`createElement`, so it may use hooks. State:
  `{ value: string; onChange: (value: string) => void; time: string;
  calendarProps: { mode: "single"; localeTag?: string; selected?: Date;
  onSelect: (date: Date | undefined) => void }; retry: () => void }`.
  It receives the draft value, time and calendar props, so it can render a
  native `<input type="datetime-local">` that replaces the whole **calendar +
  time row**. It must not render a date-only control next to the existing
  `TimePickerPanel`; that would duplicate or ignore the time.
- When `calendarFallback` is omitted, `DateTimeField` keeps its current
  behavior and does **not** install the card-local calendar-error boundary.
  When it is provided, a calendar error switches the due editor body to the
  fallback while the trigger, Save/Remove controls and the rest of the
  Properties panel stay mounted.
- `CardFieldsPanel` passes a card-local `CardCalendarFallback` component and an
  optional `calendarLoader` test seam; production omits the loader and uses the
  real calendar import.

The card-local fallback contains:

- an inline `role="alert"` message: “The calendar could not load. Other fields
  are still editable.” / “Календарь не загрузился. Остальные поля остаются
  доступными.”;
- a “Retry” / “Повторить” button that remounts a **fresh** lazy calendar
  attempt, not just a boundary state reset;
- if the retry cannot restore the calendar, the accessible native
  `<input type="datetime-local">` bound to `value`/`onChange`; the existing
  due Save/Remove buttons remain outside and save this draft normally;
- a full-width fallback layout inside the due popover, with an explicit label
  (for example “Due date and time” / “Срок и время”), no horizontal overflow at
  390 px and no duplicate time control.

The retry must be honest. `React.lazy()` caches a rejected import per lazy
component instance, so resetting `failed` alone will usually re-render the same
rejected promise. The optional loader must create a new lazy instance (or retry
the import) per attempt. If the browser has cached a deployment-level rejection,
the native fallback is the reliable recovery; a page reload remains the last
resort for the whole-panel chunk case.

`calendar-lazy`'s `useRdpLocale` currently starts
`import("react-day-picker/locale").then(...)` with no rejection handler. A
failed locale chunk must not become an unhandled effect rejection or take down
the calendar: catch it and keep the default locale (the field fallback remains
available for the calendar chunk itself). Add a regression test that rejects the
locale import and still renders/uses the calendar or its fallback.

**False-acceptance guard.** A generic React error boundary cannot tell whether
an error came from the calendar or from unrelated panel code. The correct
statement is: *the generic panel fallback remains for panel-level failures
(panel chunk failure or an uncaught non-calendar render error); a calendar
failure must no longer reach it.* The implementation must not claim that the
generic fallback can appear “only” for the panel chunk.

### 5.4 Dev cache collision (environment-only)

The dev trigger should be documented and prevented without becoming a product
acceptance item:

- set a checkout-local Vite `cacheDir` (for example `ui/.vite` or a path under
  the worktree) instead of sharing `node_modules/.vite` between worktrees; or
- document `rm -rf node_modules/.vite` / restart with `--force` after dependency
  or worktree changes.

This is a developer-experience fix and can be a separate small change or a
runbook step. It must not be presented as making the calendar failure
impossible: production, offline, half-deployed and transient chunk failures
still need the local boundary. The root-cause claim is a working hypothesis from
the live demo, not a CI reproduction; the ticket keeps it explicitly provisional.

## 6. Recommended implementation

### Phase 1 — Labels UX (P2, small, independent PR)

1. Add an info icon button next to the Labels heading. Compose the heading row
   so the button is **not nested inside a `<label>`** (use a flex heading row or
   an optional `labelAction` slot in the shared `Field` component). The button
   is `type="button"`, has a visible focus ring, at least a 24×24 px target and
   the accessible name “About labels” / “О метках”.
2. Open a Radix `Popover` on click/Enter/Space. Content: a heading plus the
   explanation; width `w-72` with `max-w-[calc(100vw-2rem)]`; `align="start"` so
   it does not overflow the viewport. Radix handles Escape/outside-click and
   returns focus to the trigger; verify this with a test rather than assuming it.
3. Add EN/RU strings. Proposed keys:
   - `admin.cards.fields.labelsHelp`: “About labels” / “О метках”
   - `admin.cards.fields.labelsHelpBody`: “Labels save immediately — there is
     no separate Save button. Click a label to attach it, click it again to
     detach it. Every change is recorded in the board history.” / “Метки
     сохраняются сразу — отдельной кнопки «Сохранить» нет. Нажмите на метку,
     чтобы прикрепить её, и ещё раз — чтобы открепить. Каждое изменение
     попадает в историю доски.”
4. Extend the toast API with an opt-in key and key clear, for example
   `toast.success(message, { key })` and `toast.clear(key)`. The provider keeps
   one toast per key: a keyed success appends a fresh item after the clear (not
   an in-place update), so `aria-live` sees a removal/insertion and re-announces
   identical text. `clear(key)` must remove the item, cancel its timer and
   delete the key→toast map entry; manual close and auto-dismiss must delete the
   same map entry. Test clear→success, clear→timer, close→re-add and
   auto-dismiss→re-add with fake timers.
5. Use `admin.card.labels:${card.id}` as the key. Clear it when a label command
   starts, clear it defensively on failure, and clear it on card change/unmount.
   Do not key `toast.error`; do not change `showFailure` or any other caller.
   A failed label command still lands in the inline `errors.labels` message; a
   real command error is never swallowed and no stale success remains.
6. Make command completion card-scoped. Capture `card.id`, a card/generation
   token and a mounted flag at command start. Increment the generation **only
   when `card.id` changes**, never on a same-card detail/relations reload. After
   `await`, only call `toast.success`, `onSaved`, `setErrors` or `setBusy(null)`
   when the captured card is still current and the component is mounted. Key
   `<CardFieldsPanel key={card.id} …>` in `CardDetailPage` and reset
   busy/errors on card change. A late A success/failure must not toast, set an
   inline error, disable controls or reload card B.
7. Add `optimisticLabelIds` intersected with live `boardLabels`; derive selected
   chips from it. A click must first check `busy`, the label cap and the
   per-card in-flight ref, **before** computing/applying any optimistic change.
   A blocked click is a pure no-op (no mutation, toast or error). Only then
   capture the previous set, compute the next `on`, apply it, clear the toast,
   notify the page that a label command started, and send `SET_CARD_LABEL`.
   A second click while pending is blocked; after success it uses the optimistic
   set and sends the correct new `on`. If `send` cannot start, do not apply or
   revert.
8. Add a bounded label-command timeout/`AbortSignal` through
   `adminApi.sendBoardCommand` (optional client option). On timeout/abort treat
   the outcome as ambiguous. Classify failures:
   - definitive 4xx (400/404/409): revert the optimistic set, clear the toast,
     show the inline error, release the guard, no resync unless the conflict
     copy needs it;
   - transport/timeout/5xx: ambiguous — revert, clear the toast, show an inline
     error, set `labelResyncPending`, call the void `onSaved()` for resync, and
     keep label controls disabled until the resync commits. Release the command
     guard but keep the resync guard.
   On success keep the optimistic set, show the keyed toast immediately (command
   success, not reload success), call void `onSaved()`, and release the guard.
9. Reconcile from `cardLabels` only when the prop came from a detail request
   started after the label command settled. `CardDetailPage` passes a monotonic
   `detailRequestSeq`; bump it at label command start and every reload. Ignore
   prop changes from older requests so a sibling reload that commits old labels
   during pending cannot be adopted after the guard clears. On ambiguous
   failure, adopt only a request started after that failure settle before
   clearing `labelResyncPending`.
10. Serialize parent detail reloads and page errors. All `CardDetailPage`
    reloads use one `detailRequestSeq` + `AbortController`; only the latest may
    `setDetail`/`setError`. Track in-flight label commands at page level. Page
    error/retry clears `detail` and shows the skeleton (or keeps the panel
    unmounted); if a label command is pending, wait for it to settle before
    starting the fresh detail request/sequence, then remount with fresh labels.
    A late label response from an unmounted panel is ignored by the
    mounted/card guard. No label-specific page error path.
11. Add the required tests: same-label double-click while pending (one command,
    optimistic/aria-pressed unchanged by second); different-label click while
    pending (pure no-op); click while busy/`send === false` (no optimistic
    mutation); optimistic second click after success; definitive failure revert;
    hung command timeout recovery; applied-then-rejected ambiguous failure with
    resync showing server state; A→B late response isolation; stale sibling
    reload/prop during pending ignored; relation-reload rejection while label
    in flight; page retry with held fetch/late label success; rejected stale
    sibling does not set page error; no toast before command resolves; keyed
    timer/map cleanup. Keep `SET_CARD_LABEL`, cap guard and busy serialization
    otherwise unchanged.
12. Accessibility note: the keyed toast is cleared at command start and re-added
    only after the command resolves; the live region sees a fresh node, so an
    identical “Label updated” is announced again. Do not rely on an in-place
    identical update.

### Phase 2 — Calendar resilience (P1, independent PR)

1. Add an optional field-level fallback contract to `DateTimeField`:
   `calendarLoader?: () => Promise<{ Calendar: CalendarComponent }>` and
   `calendarFallback?: ComponentType<CalendarFallbackState>`, where
   `CalendarFallbackState = { value: string; onChange: (value: string) => void;
   time: string; calendarProps: CalendarProps; retry: () => void }`. Export
   `CalendarFallbackState` (and share/export `CalendarProps` from
   `calendar-lazy` or the date-time module) so `CardCalendarFallback` and tests
   use the same contract. Render the fallback as a component
   (`<CalendarFallback {...state} />` or `createElement`), never call it as a
   plain function; it may use hooks. The fallback receives the draft value, time
   and calendar props so it can replace the **calendar + time pair** with a
   native `datetime-local` input. When `calendarFallback` is omitted,
   `DateTimeField` keeps its current behavior; announcement scheduling and board
   consumers are untouched.
2. Add an optional `calendarLoader` prop to `CardFieldsPanel` and forward it to
   `DateTimeField`; production omits it. Pass a card-local
   `CardCalendarFallback` component (stable module-level definition, not inline
   in render) as `calendarFallback`. The real page passes only card props; tests
   render `CardFieldsPanel` directly with the loader (or use the documented
   harness). Add these props to the code map and tests; no page-level API change
   is needed.
3. Use a fresh `createCalendar(loader)` component/attempt on Retry; do not
   mutate the module-level lazy component. Catch a rejected
   `react-day-picker/locale` import in `calendar-lazy`, keep the default locale
   and never leave an unhandled effect rejection.
4. On calendar failure, render the card-local alert and Retry **in place of the
   calendar + time row**, not beside the existing `TimePickerPanel`. If Retry
   succeeds, the normal calendar+time row returns in the same popover. If it
   fails again, keep the native `datetime-local` fallback with an explicit
   accessible label; the existing due Save/Remove controls save the draft
   normally. The rest of the Properties panel must stay mounted and editable.
5. Keep focus and announcements intentional: `role="alert"` for the failure,
   an accessible Retry name, and no focus loss into nowhere when the picker
   body is replaced. If the popover closes, return focus to the due trigger or
   the Retry button.
6. Add EN/RU keys for the card-local error, Retry, fallback label and native
   fallback. Do not reuse the whole-panel `admin.cards.fields.loadFailed` copy
   for a calendar-only failure, and do not add announcement/board copy.
7. Add the dev-only cache note/fix from §5.4 separately; do not make product
   acceptance depend on a clean dev cache.
8. Verify the outer boundary still handles a panel-level failure and that a
   card-local calendar failure no longer reaches it. Do not promise more than a
   generic boundary can distinguish.
9. Size plan: run `npm run size -w ui`; keep the admin card page within the
   feature branch's 113 KB gzip budget (`AdminApp` + `CardFieldsPanel` +
   `CardRelationsPanel` + shared admin UI). `CardCalendarFallback` and its
   copy are small; if the budget is exceeded, move/split the fallback within
   the existing lazy panel rather than silently raising the limit.

### Proposed copy summary

| Key | EN | RU |
| --- | --- | --- |
| `admin.cards.fields.labelsHelp` | About labels | О метках |
| `admin.cards.fields.labelsHelpBody` | Labels save immediately — there is no separate Save button. Click a label to attach it, click it again to detach it. Every change is recorded in the board history. | Метки сохраняются сразу — отдельной кнопки «Сохранить» нет. Нажмите на метку, чтобы прикрепить её, и ещё раз — чтобы открепить. Каждое изменение попадает в историю доски. |
| `admin.cards.fields.calendarFailed` | The calendar could not load. Other fields are still editable. | Календарь не загрузился. Остальные поля остаются доступными. |
| `admin.cards.fields.calendarRetry` | Retry calendar | Повторить загрузку календаря |
| `admin.cards.fields.calendarFallbackLabel` | Due date and time | Срок и время |

The existing `admin.cards.toast.labelSaved` stays “Label updated” / “Метка
обновлена”; only its toast identity/lifetime changes.

## 7. Acceptance criteria

### Phase 1 — Labels

- A visible info/help button with an accessible name (EN “About labels”, RU
  “О метках”) sits next to the Labels heading, not on individual chips.
- Mouse click and keyboard activation (Tab + Enter/Space) open the explanation.
  Escape and outside click close it; focus returns to the trigger; the content
  is exposed with a heading/accessible description rather than only visually.
- The copy covers all three facts: immediate save, click attaches/detaches,
  changes appear in board history. EN and RU are both present; no raw keys.
- Rapid successful label toggles leave at most one “Label updated” toast; its
  timer refreshes instead of stacking.
- A success followed by a failed label command removes the success toast and
  shows the inline error; no stale “Label updated” remains. Navigating to
  another card clears the previous card's keyed toast.
- A label click acquires the busy/cap/in-flight guard before any optimistic
  mutation. A blocked click is a pure no-op: no optimistic change, no toast, no
  error. Same-label double-click, a different-label click while pending, and a
  click while busy/`send === false` all leave `aria-pressed`/the optimistic set
  unchanged.
- `optimisticLabelIds` is intersected with live board labels, preserving the
  existing deleted-label filter and cap behaviour.
- Label clicks update the optimistic set only after the guard passes; on
  command success the optimistic state stays and the keyed toast is shown; on
  definitive 4xx failure the optimistic set reverts, the inline error appears
  and no success toast is shown.
- A second click after success but before any reload uses the optimistic state
  and sends the correct new `on`.
- A hung label POST times out/aborts; the optimistic set reverts, the toast and
  guard are cleared, an inline error appears and a resync is started. On
  transport/timeout/5xx ambiguity, label controls stay disabled until the
  resync commits and then reflect the server state (including an
  apply-then-reject case); on definitive 4xx they recover immediately without
  resync (unless the conflict copy requires it).
- An in-flight label success from card A does not toast, set an error, update
  optimistic labels or leave a stale busy state on card B after navigation. An
  in-flight failure from A does not write its inline error on B.
- A stale sibling detail reload started before label success cannot overwrite
  the fresh labels; a prop change from a request started before the label
  command settled is ignored via `detailRequestSeq`.
- A relation reload rejection while a label command is in flight does not
  unmount the panel with stale labels; page retry clears `detail`/shows the
  skeleton, waits for the pending label command, then starts a fresh detail
  request before remounting. A rejected stale sibling does not set page error.
- On page error/retry with a held fetch, no stale label click can send a
  command; after retry the panel mounts with fresh labels.
- No success toast appears before the label command resolves; the keyed toast is
  cleared at command start and on failure, and its timer/map cleanup still
  works.
- Unkeyed success toasts remain additive, and repeated identical error toasts
  remain additive; label command errors remain visible inline. Keyed toast map
  entries are removed on manual close and auto-dismiss, so a later re-add of the
  same key works.
- Each actual click still sends exactly one `SET_CARD_LABEL` with the right
  `labelId` and `on`; cap/no-op/disabled behavior is unchanged.
- The heading, help button and popover fit at 1440, 1024 and 390 px with no
  horizontal overflow or clipped control, verified in a browser.

### Phase 2 — Calendar

- A rejected lazy import or render error in the card's due-date calendar is
  contained to that due-date calendar. The due trigger and popover remain
  available; title, assignee, priority, cover, labels and Save controls remain
  mounted and editable.
- The due-date field shows a clear localized error and a field-level Retry.
  The generic panel fallback remains for panel-level failures (panel chunk
  failure or an uncaught non-calendar render error); a calendar failure must no
  longer reach it. Do not claim it appears “only” for a panel chunk.
- When the calendar import succeeds on retry, the normal calendar+time row
  returns in the same popover and the date can be selected and saved. When it
  cannot succeed, the accessible native `datetime-local` fallback replaces the
  calendar+time pair (no duplicate/ignored time control), and the existing due
  Save/Remove controls save the draft without a page reload.
- `DateTimeField`, `calendar-lazy`, announcement scheduling and board calendar
  consumers keep their existing behavior and copy when the card-local props are
  omitted; only the admin card opts into the loader/fallback contract. A
  rejected `react-day-picker/locale` import is caught and does not produce an
  unhandled rejection.
- The failure is announced (`role="alert"`), Retry has an accessible name, the
  native fallback has an explicit accessible label, and focus goes somewhere
  sensible when the picker body is replaced.
- EN/RU copy exists for the card-local error, Retry and fallback label.
- 1440/1024/390 layouts remain usable, including the native fallback layout,
  verified in a browser; dev-vs-production behavior is documented. A clean dev
  cache is an environment check, not a product acceptance criterion.
- The existing whole-panel chunk-failure test still passes, and a new
  calendar-containment test proves the fields stay editable. The admin card
  page size gate (`npm run size -w ui`) stays within its 113 KB gzip budget.

## 8. Test and verification plan (for implementation)

### Labels

- **Help component test:** open the page, find the button by accessible name,
  open/close via mouse and keyboard, assert Escape/outside-click and focus
  return, assert the three facts are present and localized.
- **Toast keyed refresh test:** toggle two labels in sequence; assert two
  commands, correct state, and exactly one “Label updated” status. Assert the
  fresh item gets a full 4.5 s timer rather than stacking.
- **Clear/timer fake-timer test:** `clear(key)` removes the item, cancels its
  timer and deletes the key map entry; a later success with the same key gets a
  fresh full 4.5 s lifetime and appends a new node.
- **Dismiss→re-add test:** `ToastProvider.dismiss(id)` must resolve the key and
  delete the key map entry; exercise both manual close and auto-dismiss, then
  re-add the same key and assert it works without targeting a stale item.
- **Success→failure test:** first toggle succeeds and shows the toast; second
  toggle fails (fake server 409/404); assert the toast is gone, the inline error
  is visible and no stale success remains.
- **Guard-before-mutation test (required 1):** assert `aria-pressed`/the
  optimistic set does not change for a same-label double-click while pending, a
  different-label click while pending, or a click while busy / `send === false`;
  only the first accepted click sends a command.
- **Optimistic second click test (required 2):** let the first toggle succeed
  but hold any reload; click the same label again before reload and assert the
  second command uses the correct new `on` derived from the optimistic set.
- **Definitive-failure revert test (required 3):** reject with 400/404/409;
  assert the optimistic set reverts, inline error appears, no success toast and
  no resync is started unless the conflict copy requires it.
- **Hung-command test (required 4):** hold the label POST past the bounded
  timeout/abort; assert the optimistic set reverts, toast clears, inline error
  appears, the guard is released, and the resync path starts. Controls stay
  disabled while the resync is pending and recover only after it commits.
- **Applied-then-rejected test (required 5):** fake server applies the label
  server-side, then rejects as transport/5xx; assert the resync eventually
  shows the server state (the server wins) instead of keeping a lost toggle.
- **A→B navigation test (required 6):** hold the label command, navigate away,
  then resolve/reject it; assert no toast, inline error, optimistic update or
  busy state affects card B.
- **Stale sibling/prop test (required 7):** start a detail/relations reload
  before label success and let a prop change land during pending; assert
  `detailRequestSeq` ignores it, and a stale sibling resolving after the label
  command does not overwrite labels.
- **Page-error-with-in-flight-label test (required 8):** reject a relations
  reload while a label command is pending; assert the page does not remount
  with stale labels. Page retry holds the fetch, waits for the late label
  success/failure to settle, then starts a fresh request and remounts fresh. A
  rejected stale sibling must not set page error.
- **Toast timing/cleanup test (required 9):** assert no success toast before the
  label command resolves; after success the keyed toast appears, and its timer,
  manual close/auto-dismiss map cleanup and re-add still work.
- **Unkeyed behavior tests:** two unkeyed success calls produce two toasts; two
  identical unkeyed error calls produce two toasts. This proves the key did not
  weaken global behavior.
- **A11y note:** because the key is cleared before each command and re-added on
  success, the live region gets a fresh insertion even for identical text. Test
  the status region; do not rely on in-place identical text updates.

### Calendar

- **Normal path (separate test):** render the card field editor with a
  resolving `calendarLoader` directly on `CardFieldsPanel`; click
  `admin-card-due-input`, assert the popover opens and the real lazy calendar
  mounts, select a date and save. This test must not inject a rejection.
- **Reject-once seam (separate test):** configure the loader to reject on the
  first attempt and resolve on the second. Click `admin-card-due-input` to open
  the popover and attempt the mount. Assert the card-local alert/fallback
  replaces the calendar+time row, the trigger and other fields remain mounted,
  and a **real command still succeeds while the calendar is broken** (change
  priority and await `SET_CARD_PRIORITY`, or edit/save the title and await
  `UPDATE_CARD`). Presence alone is not enough.
- **Retry success:** click Retry, let the loader resolve, assert the normal
  calendar+time row returns in the same due popover; select a date and Save,
  then assert `SET_CARD_DUE_DATE` (or the actual due command) was sent.
- **Persistent failure + native fallback:** make the loader reject every
  attempt; after Retry, assert the native `datetime-local` input is present with
  an accessible label, no duplicate time control is rendered, the due value can
  be changed, and the existing due Save sends the command. Assert another real
  field command still succeeds.
- **Locale rejection:** mock a rejected `react-day-picker/locale` import;
  assert there is no unhandled rejection and the calendar (or its field
  fallback) still works with the default locale.
- **Outer boundary regression:** keep the existing whole-panel
  `CardFieldsFallback` test. Render the panel inside
  `CardFieldsChunkBoundary`/`CardFieldsFallback` and assert that a calendar
  failure does **not** render `admin-card-fields-error` and does not hide
  sibling fields.
- **Browser matrix (required):** open the Properties panel at 1440/1024/390,
  open the help popover and the due calendar, and force the native fallback in
  the isolated test stack (Playwright route interception for the calendar chunk
  or the test-only loader seam). Verify no horizontal overflow, no clipped
  Retry/input, and no duplicate time control. Use an isolated stack; do not
  restart the shared demo stack.
- **Dev/prod distinction:** document the dev cache workaround and verify the
  calendar opens in a clean dev server and in a production build. The clean
  cache is an environment check, not a product fix.
- **Size:** run `npm run size -w ui`; keep the admin card page within the 113 KB
  gzip budget. If `CardCalendarFallback`/copy push it over, split or move the
  fallback inside the existing lazy panel rather than raising the limit without
  evidence.

### Repo gates (implementation PR)

- `npm test -w ui`
- `npx tsc -b ui/tsconfig.json --force` (or rely on `npm run build -w ui`)
- `npm run build -w ui`
- `npm run size -w ui`
- UI lint/Prettier and `git diff --check`
- CHANGELOG and user-facing docs updates where applicable.

## 9. Out of scope

- Backend commands, audit records, label CRUD or board-history data changes.
- Editing labels themselves, board-label management, or per-chip help.
- Changes to `DateTimeField` default behavior, `calendar-lazy` default behavior,
  announcement scheduling, or board calendar surfaces and their copy/tests:
  `AnnouncementEditorDialog`, `CardDueDate`, `FilterBar`, `BoardMembersDialog`.
  `CardDialog` reaches the calendar indirectly through `CardDueDate`;
  `CalendarView`/`calendar-parts` do not import `calendar-lazy`.
- Reworking the normal board card dialog’s due-date UX.
- Global toast redesign, notification center changes, or deduping unrelated
  admin actions.
- Replacing `react-day-picker`, removing lazy loading, or adding a new date
  dependency.
- Fixing every Vite worktree/cache issue in this ticket; only the calendar
  trigger is documented and, if accepted, prevented locally.

## 10. Open questions and rollout

- **Toast specificity:** should the refreshed message name the label and
  direction (“Red label attached” / “Red label detached”) instead of the
  generic “Label updated”? It is clearer, but adds copy and interpolation. The
  chosen first pass keeps the generic message and relies on clear-then-add for
  the live-region announcement.
- **Calendar fallback:** the native `<input type="datetime-local">` is the
  chosen resilience layer; open only its visual/format treatment (locale,
  width, timezone display), not whether a fallback exists. If the team rejects
  native UI, the fallback contract, copy and tests must switch to a read-only
  display before implementation.
- **Integration target:** the known feature tip is `7bb2848b`; the
  implementation must name and rebase on the final TASK-176.9 branch tip or
  merge commit. If that branch changes `CardFieldsPanel` again, re-check the
  code map and tests.
- **Cache fix ownership:** if a per-worktree `cacheDir` change touches shared
  Vite config, is it part of this implementation or a separate dev-tooling
  change? Recommended: separate small change/runbook update, so the product
  boundary fix stays reviewable on its own.
- **Reserved numbering:** TASK-181/§7.30/row 112 remain reserved for the
  parallel admin-filters ticket. The placeholder row 112 reserves the row
  number and makes the reservation visible; it is not required for GFM table
  validity (row 113 after 111 would parse), and it is not TASK-182 scope.
