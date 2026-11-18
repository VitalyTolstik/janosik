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
| `ui/src/admin/CardFieldsPanel.tsx` | Labels section, `toggleLabel()`, `send()`, due-date section; change `onSaved` to `() => Promise<void>`, add one `labelSync` state machine, optional `calendarLoader` test seam and an internal `CardCalendarFallback` forwarded to `DateTimeField`; key panel by `card.id` from the page or reset state on card change. |
| `ui/src/admin/CardCalendarFallback.tsx` (new, or a local component) | Card-local accessible native `datetime-local` fallback + Retry; replaces the calendar+time row when the calendar fails. |
| `ui/src/admin/ui.tsx` | `Field` label rendering; add an optional label/action slot so the Labels help button is not nested in a `<label>` (phase 1 only). |
| `ui/src/components/Toast.tsx` | `ToastProvider`, append-only `push()`, 4.5 s timers, `ToastApi`; add opt-in keys/clear, fresh append after clear, and dismissal map cleanup (phase 1). |
| `ui/src/admin/CardDetailPage.tsx` | Lazy `CardFieldsPanel` and the outer `CardFieldsChunkBoundary`; provide a field-specific promise reload that resolves after the detail/labels commit and does not set the page `ErrorState` for a label reload; key `CardFieldsPanel` by `card.id`; outer boundary stays for panel-level failures (phase 2 tests). |
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
3. When the command succeeds, keep the keyed toast cleared until the label
   reload syncs (`cardLabels` changes). Then append a fresh success toast; if
   the reload rejects or times out, no success toast is shown. Because the old
   item was cleared at start, the new one is a fresh live-region insertion and
   its timer starts from zero.
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

**In-flight completion is card-scoped.** `send()` currently awaits the POST and
then unconditionally calls `toast.success`, `onSaved`, `setErrors` and
`setBusy`; `CardFieldsPanel` is not keyed by card id. Navigate A→B while a label
toggle is in flight and a late A success can toast on B, a late A failure can
write A's inline error on B, and a stale busy reset can disable B's controls.
The fix has two layers:

1. Capture `card.id`, a card/generation token and a mounted flag when the
   command starts. After `await`, only toast, call `onSaved`, set errors or
   clear busy when the captured card is still current and the component is
   still mounted.
2. Key `<CardFieldsPanel key={card.id} …>` in `CardDetailPage` (as
   `CardRelationsPanel` already is) and reset busy/errors on a card change.
   Keying resets local state; the post-await guard is still mandatory because
   the promise itself is not cancelled.

**Same-label double-click.** `selectedLabelIds` stays stale until the async
reload, so a second click before the UI disables could try to flip the same
label again. Keep the buttons disabled while busy, and add a synchronous
in-flight ref so two click events in one frame cannot both pass the guard.
Do not optimistically change `aria-pressed` unless the rollback path is also
implemented and tested.

**Chosen lifecycle: promise-based `onSaved` plus one `labelSync` state machine.**
A successful toggle calls `onSaved()` and then `finally { setBusy(null) }`; the
current `onSaved` only increments `reloadKey`, the `cardDetail` fetch is async,
and a same-card reload does not remount `CardFieldsPanel` because it is keyed by
`card.id`. Clearing `busy` therefore re-enables the buttons while
`selectedLabelIds` still holds the old value, and a delayed half of a
double-click (or a fast second click) sends another `SET_CARD_LABEL` with the
old `on`. The synchronous in-flight ref only covers the request, not the reload
window. A page-level `ErrorState` after a rejected reload makes it worse: it
unmounts the panel, drops the pending state, and the retry can remount stale
`cardLabels` with a fresh state.

Use the simpler robust contract:

- Change `CardFieldsPanel.onSaved` to `() => Promise<void>`. `CardDetailPage`
  passes a field-specific reload that awaits `adminApi.cardDetail`, commits
  `setDetail`, and resolves only after the updated `cardLabels` prop is
  committed. This label path must **not** set the page-level `error`/unmount the
  panel; it rejects to the field instead. `CardRelationsPanel` can keep its
  existing void reload.
- Replace boolean syncing flags with **one** `labelSync` state:
  `"idle" | "command" | "awaiting-labels" | "error"`. `busy` still covers the
  command request; `labelSync` covers the reload window. Label buttons are
  disabled whenever `labelSync !== "idle"` (and while `busy`); the group exposes
  `aria-busy` and an “Updating labels…” live status while `command`/`awaiting`.
- Set `labelSync = "command"` only after the busy/cap guards pass; if `send`
  returns false or the command rejects, return to `"idle"` with the inline
  error. Do not enter syncing for a no-op, cap rejection or blocked click.
- On command success, snapshot `cardLabels`, set `labelSync =
  "awaiting-labels"`, and call/await the `onSaved` promise with a bounded
  timeout (for example 10 s). Resolve the promise only after the parent detail
  commit. Show the success toast only after the labels sync; do not show a
  stale success while the reload is still pending.
- Clear `awaiting-labels` only when **the label's own reload promise has
  resolved and a later `cardLabels` prop differs from the success snapshot**.
  Use a request token so a pre-success same-card relations/detail reload that
  lands after the label succeeds cannot clear the state; only the label's
  reload can complete the transition. On success, go to `"idle"`, clear the
  sync error and show the toast.
- On reload rejection or timeout, go to `"error"`, keep the label controls
  disabled, and show a field-level retry (“Updating labels…”/retry copy). A late
  resolution from an abandoned attempt is ignored via the token. Retry goes
  back through `onSaved` and `awaiting-labels`; it never re-enables stale
  buttons.
- On card change/unmount, reset `labelSync` and the token; generation remains
  card identity only. The page may keep the panel mounted on a label reload
  failure; if a page-level error unmounts it for another reason, no label
  command is in flight, so there is no pending state to carry across cards.

The generation token is **card identity only**. Increment it when `card.id`
changes, not on every `card` prop/detail update; otherwise a same-card
relations reload can mark an in-flight label command stale, skip the guarded
`setBusy(null)` and leave the panel stuck. Add a same-card reload test with a
label command in flight.

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
7. Add a synchronous in-flight ref for label toggles so a same-label
   double-click cannot pass the guard before React disables the buttons. Keep
   the existing disabled state; do not optimistically flip `aria-pressed`
   unless rollback is implemented and tested. Assert one `SET_CARD_LABEL` per
   double-click.
8. Change `CardFieldsPanel.onSaved` to `() => Promise<void>` and add one
   `labelSync` state machine: `"idle" | "command" | "awaiting-labels" |
   "error"` (no separate syncing booleans). `CardDetailPage` supplies a
   field-specific reload that awaits `adminApi.cardDetail`, commits the detail
   and resolves after the updated `cardLabels` prop; this path must keep the
   panel mounted and reject to the field instead of setting the page
   `ErrorState`. Keep `CardRelationsPanel` on its existing void reload.
9. Lifecycle: enter `"command"` only after the busy/cap guards pass; command
   failure/`send === false` returns to `"idle"` with the inline error. On
   success snapshot `cardLabels`, enter `"awaiting-labels"`, await the
   `onSaved` promise with a bounded timeout (for example 10 s), and show the
   success toast only after sync. Clear to `"idle"` only when the label's own
   reload token resolves **and** a later `cardLabels` prop differs from the
   success snapshot. Rejection/timeout enters `"error"` with controls still
   disabled, `aria-busy`/“Updating labels…” and a field-level Retry; a late
   abandoned attempt is ignored by token. Retry re-enters `"awaiting-labels"`
   and never re-enables stale labels.
10. Add the required lifecycle tests: reload reject → held field/page retry →
    click same label → zero additional `SET_CARD_LABEL`; resolve → labels sync
    and buttons re-enable. Slow/hung reload → visible `aria-busy`/“Updating
    labels…” + Retry, never silently re-enabled. Pre-success same-card reload
    resolving after label success while the label reload is pending → state
    remains awaiting. Same-card reload during an in-flight command → `busy` and
    label sync both settle. Effect timing: snapshot `cardLabels` at success and
    clear only on a later change. `send === false`/cap/no-op → state stays
    `"idle"`.
11. Keep `SET_CARD_LABEL`, the cap guard and the `busy` serialization unchanged.
12. Accessibility note: because the keyed toast is cleared at command start and
    re-added after sync, the live region sees a fresh node and should announce
    the confirmation even when the text is identical. Do not rely on updating
    identical text in place, which `aria-live` may not re-announce. Test the
    success→failure→success sequence with a status-region assertion.

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
   `CardCalendarFallback` component as `calendarFallback`. The real page passes
   only card props; tests render `CardFieldsPanel` directly with the loader (or
   use the documented harness). Add these props to the code map and tests; no
   page-level API change is needed.
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
| `admin.cards.fields.labelsUpdating` | Updating labels… | Обновление меток… |
| `admin.cards.fields.labelsSyncFailed` | Labels saved, but the card could not refresh. Retry. | Метки сохранены, но карточку не удалось обновить. Повторите. |
| `admin.cards.fields.labelsSyncRetry` | Retry labels | Повторить обновление меток |
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
- After a successful toggle, label controls stay disabled until the label's
  own detail reload updates `cardLabels`; a second click before that resolves
  sends no additional `SET_CARD_LABEL`. Once labels sync, controls re-enable
  and the next toggle uses the new state.
- A rejected or timed-out label reload keeps the panel mounted, keeps controls
  disabled, and shows `aria-busy`/“Updating labels…” plus a field-level retry.
  Retry with the fetch still held sends zero additional `SET_CARD_LABEL`; when
  it resolves, labels sync and buttons re-enable.
- A pre-success same-card relations/detail reload that lands after the label
  success but before the label's own reload does not clear the pending state.
  Only the label's reload token plus a later `cardLabels` change completes it.
- A same-card detail/relations reload during an in-flight label command does
  not mark it stale or leave busy stuck; the generation token changes only with
  `card.id`.
- A label command that never starts (`send` returned false, cap/no-op/blocked
  click) stays `"idle"` and does not show a sync state or success toast.
- The success toast appears only after labels sync, not while the reload is
  pending.
- An in-flight label success from card A does not toast, set an error, call
  `onSaved`, or leave a stale busy state on card B after navigation. An
  in-flight failure from A does not write its inline error on B.
- A same-label double-click sends at most one `SET_CARD_LABEL`; the second click
  is blocked by the synchronous in-flight guard and disabled state.
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
- **Reload-rejection + retry test (required 1):** hold the label's detail reload
  and reject it; assert the panel stays mounted, controls remain disabled with
  an error/retry, and clicking the same label sends zero additional
  `SET_CARD_LABEL`. Hold the retry fetch, click again, assert still zero; resolve
  the retry and assert labels sync and buttons re-enable.
- **Slow/hung reload test (required 2):** leave the label reload unresolved until
  the bounded timeout; assert visible `aria-busy`/“Updating labels…” and a Retry,
  and that controls are never silently re-enabled. Retry with a held fetch still
  sends no duplicate label command.
- **Pre-success stale-reload test (required 3):** start a same-card
  relations/detail reload before the label command succeeds, then let the label
  succeed while its own reload is still pending; resolve the earlier reload
  after the success and assert the label sync state stays awaiting (it does not
  clear on that unrelated `cardLabels` change).
- **Same-card in-flight test (required 4):** trigger a relations/detail reload
  during an in-flight label command; assert the generation token does not
  change and both `busy` and label sync settle without sticking.
- **Effect-timing test (required 5):** snapshot `cardLabels` at success; after
  the `onSaved` promise resolves but before the later prop change, assert
  controls stay disabled; then change `cardLabels` and assert they re-enable.
- **Guard test (required 6):** click while busy, at the label cap, or otherwise
  blocked; assert `labelSync` stays `"idle"`, no “Updating labels…” appears and
  no sync/retry state is created if `send` returns false.
- **Deferred navigation tests:** add a deferred-command hook to
  `FakeAdminServer` (or spy on `adminApi.sendBoardCommand`) so the test can hold
  the POST. Navigate A→B while the label command is in flight, then:
  - resolve success — B shows no “Label updated” toast, no `onSaved` refresh,
    no stale busy state; B's label buttons stay enabled;
  - reject failure — B shows no A inline error and no stale busy state.
  Also assert card A's keyed toast is cleared when leaving A.
- **Same-label double-click test:** fire two clicks on one label in the same
  frame; assert exactly one `SET_CARD_LABEL` and a disabled button while busy.
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
