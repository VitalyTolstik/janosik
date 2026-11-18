# TASK-182 — Admin card label UX and calendar resilience

**Status:** proposed (docs-only, 2026-11-19). This ticket contains no production
code and does not require running the test suites.
**Priority:** P1 for the calendar blast radius; P2 for the label UX polish.
**Delivery:** two independent PRs. Phase 1 is the small label PR (P2); phase 2
is the higher-priority calendar PR (P1). The phase numbers describe delivery
order, not severity.
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
   fallback. The runtime trigger was a dev-server prebundle/cache collision, but
   the product bug is broader: the field panel boundary is scoped to the whole
   panel, so one nested lazy calendar failure hides title, assignee, due,
   priority, cover and labels. There is no card-local retry.

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
- Keep `SET_CARD_LABEL` behavior exactly as it is: one real command per actual
  change, cap/no-op guards unchanged.
- Isolate a due-date calendar chunk/render failure to the due-date editor in
  `CardFieldsPanel`: the rest of the Properties panel stays editable.
- Give the card's due-date editor a clear localized error, a retry that can
  restore the calendar, and a graceful fallback if the calendar cannot load.
- Leave `DateTimeField`, `calendar-lazy`, announcement scheduling and board
  calendar consumers behaviourally unchanged.
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
| `ui/src/admin/CardFieldsPanel.tsx` | Labels section, `toggleLabel()`, `send()`, due-date section; host of the card-local due-date wrapper. |
| `ui/src/admin/CardCalendar.tsx` (new, or a local component) | Card-local retryable calendar + `CardCalendarBoundary`; injected only into the admin card due editor. |
| `ui/src/admin/ui.tsx` | `Field` label rendering; add an optional label/action slot so the Labels help button is not nested in a `<label>` (phase 1 only). |
| `ui/src/components/Toast.tsx` | `ToastProvider`, append-only `push()`, 4.5 s timers, `ToastApi`; add opt-in keys/clear for label success (phase 1). |
| `ui/src/admin/CardDetailPage.tsx` | Lazy `CardFieldsPanel` and the outer `CardFieldsChunkBoundary`; outer boundary stays for panel-level failures (phase 2 tests). |
| `ui/src/admin/announcements/DateTimeField.tsx` | Generic due/scheduling picker. Add an optional calendar-component seam with the current `Calendar` as default; default behavior unchanged. |
| `ui/src/components/ui/calendar-lazy.tsx` | Existing lazy calendar used by other consumers. Expose a `createCalendar(loader?)` factory (or equivalent) for the card-local retry; the existing `Calendar` export and behavior stay unchanged. |
| `ui/src/admin/announcements/AnnouncementEditorDialog.tsx` | `DateTimeField` consumer; **intentionally untouched**, keeps default calendar behavior and copy. |
| `ui/src/components/board/CardDialog.tsx`, `CalendarView.tsx`, `calendar-parts.tsx` | Board calendar consumers; **intentionally untouched**, keep default calendar behavior and copy. |
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
3. When the command **succeeds**, add the keyed success toast. Because the old
   one was cleared at start, the toast is a fresh live-region insertion and its
   timer resets.
4. On card change/unmount, clear the keyed toast for the card being left. A
   toast from card A must not remain visible on card B.

Errors stay unkeyed and additive. Two identical failures still produce two
visible error toasts. Unkeyed successes from unrelated actions remain additive
as well; only the label success path opts into replacement.

### 5.3 Calendar containment

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Card-local due-date boundary + injectable retryable calendar seam + graceful fallback** | A calendar failure is contained to the card's due-date editor; other fields remain mounted; specific card copy; retry; no announcement/board changes | Needs a small optional seam in `DateTimeField` and careful retry/focus handling | **Recommended core** |
| Put the boundary inside shared `DateTimeField` | Fewer card-local files | Changes the blast radius and copy for announcements/board consumers; reviewers correctly rejected this as card-only scope | No |
| Preload/retry the calendar chunk on popover intent | Can avoid the first-open failure and recover from transient network errors | Does not contain a failure if the retry also fails; does not fix the misleading whole-panel fallback by itself | Complementary, not sufficient |
| Native date input or read-only due display fallback | Due date remains usable/visible even if the chunk never loads; robust | Design inconsistency; native control follows OS locale/theme; extra formatting/timezone tests | **Recommended fallback layer** |
| Eagerly import the calendar / remove the lazy boundary | No lazy failure | Adds `react-day-picker`/`date-fns` to the critical path and breaks the size budget | No |
| Keep the whole-panel boundary and only improve the message | Small copy change | Still hides all healthy fields; no field-level retry | No |

Recommended minimal robust design: keep `CardFieldsChunkBoundary` as the outer
guard for the whole `CardFieldsPanel` chunk, but add a **card-local
`CardCalendar` component** for `/admin/cards/:id` and inject it into the due
editor through an optional `calendarComponent` prop on `DateTimeField`. The
component owns its own boundary around the lazy calendar; shared behavior stays
unchanged. Its fallback renders inside the due popover (or directly in place of
the calendar), so the due trigger, Save/Remove controls and the rest of the
Properties panel stay mounted:

- an inline `role="alert"` message: “The calendar could not load. Other fields
  are still editable.” / “Календарь не загрузился. Остальные поля остаются
  доступными.”;
- a “Retry” / “Повторить” button that remounts a **fresh** lazy calendar
  attempt, not just a boundary state reset;
- if the retry cannot restore the calendar, a native `<input type="datetime-local">`
  fallback (same `value`/`onChange` contract, Save/Remove buttons unchanged) or,
  if the team rejects native UI, a read-only due display plus Retry;
- the due trigger and popover remain available; only the calendar subtree is
  replaced, never the whole field panel.

The retry must be honest. `React.lazy()` caches a rejected import per lazy
component instance, so resetting `failed` alone will usually re-render the same
rejected promise. The card-local wrapper must create a new lazy instance (or
retry the import through an injectable loader) per attempt. If the browser has
cached a deployment-level rejection, the native fallback is the reliable
recovery; a page reload remains the last resort for the whole-panel chunk case.

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
   one toast per key: replace/update the existing item and reset its timer;
   unkeyed calls remain append-only. Clear keyed timers on dismiss and unmount.
5. Use `admin.card.labels:${card.id}` as the key. Clear it when a label command
   starts, clear it defensively on failure, and clear it on card change/unmount.
   Do not key `toast.error`; do not change `showFailure` or any other caller.
   A failed label command still lands in the inline `errors.labels` message; a
   real command error is never swallowed and no stale success remains.
6. Keep `SET_CARD_LABEL`, the cap guard and the `busy` serialization unchanged.
7. Accessibility note: because the keyed toast is cleared at command start and
   re-added on success, the live region sees a fresh node and should announce
   the confirmation even when the text is identical. Do not rely on updating
   identical text in place, which `aria-live` may not re-announce. Test the
   success→failure→success sequence with a status-region assertion.

### Phase 2 — Calendar resilience (P1, independent PR)

1. Add a card-local `CardCalendar` component (new file or local to
   `CardFieldsPanel.tsx`). It owns the retry attempt and the field-specific
   fallback, and wraps only the lazy calendar in a small `CardCalendarBoundary`.
   Use a fresh calendar component from the shared `createCalendar(loader)`
   factory (which keeps the existing locale handling) for each attempt. Inject
   it into the due editor through the optional `calendarComponent` prop; do not
   wrap the whole `DateTimeField` or the panel.
2. Add an optional `calendarComponent` (or `renderCalendar`) prop to
   `DateTimeField`. Its default is the current `Calendar` from
   `calendar-lazy`; announcement scheduling and board consumers keep using that
   default and are not edited. The card-local wrapper passes its retryable
   component only for `/admin/cards/:id`.
3. Add an injectable loader seam for tests and retries, for example
   `calendarLoader?: () => Promise<{ Calendar: CalendarComponent }>` with the
   real module import as the production default. A retry creates a fresh lazy
   component/attempt from that loader through `createCalendar`; do not mutate
   the module-level lazy component used by other consumers.
4. On failure, render the card-local alert and Retry inside the due editor. If
   the loader succeeds on retry, the calendar opens in the same popover. If it
   fails again, show the native `datetime-local` fallback or a read-only due
   value. The rest of the Properties panel must stay mounted and editable
   throughout.
5. Keep focus and announcements intentional: `role="alert"` for the failure,
   an accessible Retry name, and no focus loss into nowhere when the calendar
   subtree is replaced. If the popover closes, return focus to the due trigger
   or the Retry button.
6. Add EN/RU keys for the card-local error, Retry and, if chosen, native
   fallback. Do not reuse the whole-panel `admin.cards.fields.loadFailed` copy
   for a calendar-only failure, and do not add announcement/board copy.
7. Add the dev-only cache note/fix from §5.4 separately; do not make product
   acceptance depend on a clean dev cache.
8. Verify the outer boundary still handles a panel-level failure and that a
   card-local calendar failure no longer reaches it. Do not promise more than a
   generic boundary can distinguish.

### Proposed copy summary

| Key | EN | RU |
| --- | --- | --- |
| `admin.cards.fields.labelsHelp` | About labels | О метках |
| `admin.cards.fields.labelsHelpBody` | Labels save immediately — there is no separate Save button. Click a label to attach it, click it again to detach it. Every change is recorded in the board history. | Метки сохраняются сразу — отдельной кнопки «Сохранить» нет. Нажмите на метку, чтобы прикрепить её, и ещё раз — чтобы открепить. Каждое изменение попадает в историю доски. |
| `admin.cards.fields.calendarFailed` | The calendar could not load. Other fields are still editable. | Календарь не загрузился. Остальные поля остаются доступными. |
| `admin.cards.fields.calendarRetry` | Retry calendar | Повторить загрузку календаря |
| `admin.cards.fields.calendarUseNative` (if used) | Use date input | Использовать поле даты |

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
- Unkeyed success toasts remain additive, and repeated identical error toasts
  remain additive; label command errors remain visible inline.
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
- When the calendar import succeeds on retry, the calendar opens and the date
  can be selected and saved. When it cannot succeed, the native/read-only
  fallback keeps the current due value visible and does not require a page
  reload.
- `DateTimeField`, `calendar-lazy`, announcement scheduling and board calendar
  consumers keep their existing behavior and copy; only the card-local wrapper
  opts into the retryable calendar.
- The failure is announced (`role="alert"`), Retry has an accessible name, and
  focus goes somewhere sensible when the calendar subtree is replaced.
- EN/RU copy exists for the card-local error, Retry and fallback.
- 1440/1024/390 layouts remain usable, verified in a browser; dev-vs-production
  behavior is documented. A clean dev cache is an environment check, not a
  product acceptance criterion.
- The existing whole-panel chunk-failure test still passes, and a new
  calendar-containment test proves the fields stay editable.

## 8. Test and verification plan (for implementation)

### Labels

- **Help component test:** open the page, find the button by accessible name,
  open/close via mouse and keyboard, assert Escape/outside-click and focus
  return, assert the three facts are present and localized.
- **Toast keyed refresh test:** toggle two labels in sequence; assert two
  commands, correct state, and exactly one “Label updated” status. Assert the
  timer is reset rather than stacked.
- **Success→failure test:** first toggle succeeds and shows the toast; second
  toggle fails (fake server 409/404); assert the toast is gone, the inline error
  is visible and no stale success remains.
- **Navigation test:** card A success toast is cleared when navigating to card
  B; card B uses a different `admin.card.labels:${card.id}` key.
- **Unkeyed behavior tests:** two unkeyed success calls produce two toasts; two
  identical unkeyed error calls produce two toasts. This proves the key did not
  weaken global behavior.
- **A11y note:** because the key is cleared before each command and re-added on
  success, the live region gets a fresh insertion even for identical text. Test
  the status region; do not rely on in-place identical text updates.

### Calendar

- **Mount the real lazy calendar first.** Render the card field editor with a
  fake server and a test `calendarLoader`; click `admin-card-due-input` to open
  the popover and actually mount the lazy calendar. Do not assert on a calendar
  that was never rendered.
- **Reject-once seam:** configure the loader to reject on the first attempt and
  resolve on the second. Assert the card-local alert appears, the other fields
  remain mounted, and a **real command still succeeds while the calendar is
  broken** (change priority and await `SET_CARD_PRIORITY`, or edit/save the
  title and await `UPDATE_CARD`). Presence alone is not enough.
- **Retry success:** click Retry, let the loader resolve, assert the calendar
  grid opens in the same due popover; select a date and Save, then assert
  `SET_CARD_DUE_DATE` (or the actual due command) was sent.
- **Persistent failure:** make the loader reject every attempt; after Retry,
  assert the native input/read-only fallback is available and the due value is
  still usable or visible; assert another real field command still succeeds.
- **Outer boundary regression:** keep the existing whole-panel
  `CardFieldsFallback` test; add a test that a calendar failure does not render
  `admin-card-fields-error` and does not hide sibling fields.
- **Browser matrix (required):** open the Properties panel at 1440/1024/390,
  open the help popover and the due calendar, trigger the field fallback if the
  test harness allows it, and verify no horizontal overflow or clipped controls.
  Use an isolated stack; do not restart the shared demo stack.
- **Dev/prod distinction:** document the dev cache workaround and verify the
  calendar opens in a clean dev server and in a production build. The clean
  cache is an environment check, not a product fix.

### Repo gates (implementation PR)

- `npm test -w ui`
- `npx tsc -b --force`
- `npm run build -w ui`
- UI lint/Prettier and `git diff --check`
- CHANGELOG and user-facing docs updates where applicable.

## 9. Out of scope

- Backend commands, audit records, label CRUD or board-history data changes.
- Editing labels themselves, board-label management, or per-chip help.
- Changes to `DateTimeField` default behavior, `calendar-lazy` default behavior,
  announcement scheduling, or board card/calendar surfaces and their copy/tests.
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
- **Calendar fallback:** native `<input type="datetime-local">` (fully usable,
  OS-styled) or read-only due display (consistent, but not editable)? Recommend
  native fallback as the resilience layer, with the existing Save/Remove
  controls unchanged.
- **Integration target:** the known feature tip is `7bb2848b`; the
  implementation must name and rebase on the final TASK-176.9 branch tip or
  merge commit. If that branch changes `CardFieldsPanel` again, re-check the
  code map and tests.
- **Cache fix ownership:** if a per-worktree `cacheDir` change touches shared
  Vite config, is it part of this implementation or a separate dev-tooling
  change? Recommended: separate small change/runbook update, so the product
  boundary fix stays reviewable on its own.
- **Reserved numbering:** TASK-181/§7.30/row 112 remain reserved for the
  parallel admin-filters ticket. The ROADMAP placeholder row 112 exists only to
  keep the GFM table valid; it is not TASK-182 scope.
