# TASK-182 — Admin card label UX and calendar resilience

**Status:** proposed (docs-only, 2026-11-19). This ticket contains no production
code and does not require running the test suites.
**Priority:** P1 for the calendar blast radius; P2 for the label UX polish.
**Baseline:** behavior observed on `feat/TASK-176.9-admin-card-relations` @
`7bb2848b` (TASK-176.9 B1 fields + B2 relations). This proposal branch starts
from `origin/main` @ `002a31ec`, where the field editor is not merged yet.
**Scope:** `/admin/cards/:id` → Properties panel only. Phase 1 fixes the label
control; phase 2 contains the due-date/calendar failure. No backend changes.
**Related:** TASK-176.9 (the admin card field editor), TASK-181/§7.30 (parallel
admin-list-filters ticket; reserved and not part of this diff).

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
   fallback. The trigger was a dev-server prebundle/cache collision, but the
   product bug is broader: the error boundary is scoped to the whole field
   panel, so one nested lazy calendar failure hides title, assignee, due,
   priority, cover and labels. There is no field-level retry.

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
  callers cannot say “replace my previous confirmation”.

The generic hint `admin.cards.fields.hint` and the label strings live in
`ui/src/admin/admin-i18n.ts` (EN/RU dictionaries). The labels toast key is
`admin.cards.toast.labelSaved` (“Label updated” / “Метка обновлена”).

### 2.2 Due-date calendar

The live-demo investigation recorded this failure path:

1. In `/admin/cards/:id` → Properties, click the due-date control.
2. The whole Properties panel is replaced with “Could not load the card field
   editor. Reload the page to try again.”
3. The rest of the card page stays usable, but all field editors are gone.

Two independent causes were found.

**(a) Dev-environment trigger: shared Vite prebundle cache.** The UI runs with
parallel worktrees whose `node_modules` is shared through a symlink (the comment
in `ui/vite.config.ts` already acknowledges this). Vite’s default `cacheDir` is
`node_modules/.vite`, so all dev servers can share one dependency cache. The
demo server served mismatched prebundles: `react-day-picker` and a second React
copy (or stale React prebundle) ended up in the lazy calendar graph. This is a
development cache collision, not a production bundle problem: the production
build worked. The exact observed symptom is a render-time failure when the lazy
calendar mounts, not a missing backend route.

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
  cache mismatch can still reject the calendar import;
- the current boundary would still hide every field;
- the current message would still blame the whole field editor.

The dev cache collision should therefore be documented and prevented separately
(per-checkout `cacheDir` or a documented `--force`/cache-clear step). The
product fix is the field-level containment and fallback described below.

## 3. Goals and non-goals

### Goals

- Add an accessible, visible info/help button next to the Labels heading. It
  explains immediate save, click to attach/detach, and board-history visibility.
- Make repeated label toggles produce **one refreshed confirmation**, not a
  growing stack of identical “Label updated” toasts, without changing global
  toast semantics for unrelated actions and without suppressing errors.
- Keep `SET_CARD_LABEL` behavior exactly as it is: one real command per actual
  change, cap/no-op guards unchanged.
- Isolate a due-date calendar chunk/render failure to the due-date field: the
  rest of the Properties panel stays editable.
- Give the due-date field a clear localized error, a retry that can restore the
  calendar, and a graceful fallback if the calendar cannot load.
- Document the dev-only Vite cache trigger and the production/dev distinction.

### Non-goals

- No backend change, new API, new command or audit contract.
- No full card editor redesign; no new board interaction model.
- No global toast dedupe that changes unrelated success/error behavior.
- No new date-picker library and no eager import of the calendar (that would
  violate the existing lazy-chunk size budget).
- No attempt to hide or downgrade real command errors: label errors remain
  inline, and global command errors keep their existing toast path.
- No browser/PWA “reload the whole app” as the primary UX for a calendar
  failure.

## 4. Code map (feature tip `7bb2848b`)

| File | Relevance |
| --- | --- |
| `ui/src/admin/CardFieldsPanel.tsx` | Labels section, `toggleLabel()`, `send()`, due-date section and `DateTimeField` usage. |
| `ui/src/components/Toast.tsx` | `ToastProvider`, append-only `push()`, 4.5 s timers, `ToastApi`. |
| `ui/src/admin/CardDetailPage.tsx` | Lazy `CardFieldsPanel`, `CardFieldsChunkBoundary` class and its use around the whole panel. |
| `ui/src/admin/announcements/DateTimeField.tsx` | Due-date trigger/popover and the lazy `Calendar` mount. |
| `ui/src/components/ui/calendar-lazy.tsx` | `React.lazy()` calendar import, Suspense skeleton, no error boundary. |
| `ui/src/components/ui/popover.tsx` | Existing Radix popover primitive used by the same panel (cover picker). |
| `ui/src/admin/admin-i18n.ts` | EN/RU strings; `AdminMessageKey` type catches missing translations. |
| `ui/src/admin/CardDetailPage.test.tsx` | Existing whole-panel chunk fallback test and label toggle tests. |
| `ui/src/components/Toast.test.tsx` | Toast append, auto-dismiss and close tests; natural home for keyed-refresh coverage. |
| `ui/vite.config.ts` | Dev server config; no `cacheDir` today, while worktrees share `node_modules`. |

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

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Keyed, opt-in toast refresh** (`toast.success(message, { key })`) | One toast that updates in place and resets its timer; only the label call site opts in; unkeyed toasts remain additive; errors are untouched; reusable for future repeated actions | Requires a small `ToastApi`/timer bookkeeping change and tests; a key must be scoped so unrelated actions do not share it | **Recommended** |
| Label-local inline status (`role="status"` under the group), no label success toast | No provider change; contextual confirmation; naturally replaced by the next toggle | New label-specific state/markup; less visible than the global toast; must not collide with the inline error; removes existing success feedback | Viable alternative |
| Global dedupe by message + variant | One change fixes every repeated toast | Changes semantics for unrelated actions; identical errors would collapse or need an error special-case, which can hide a second distinct failure; violates the “do not weaken global behavior” constraint | No |
| Suppress label success toasts entirely | Trivial | No confirmation that a click was accepted; user may repeat the action; does not meet the “one refreshed toast or inline confirmation” bar | No |

The keyed approach is deliberately narrower than global dedupe. Error calls stay
unkeyed and additive, so two identical failures still produce two visible error
toasts. Only the label success path asks for replacement. If the team does not
want to touch the shared Toast API, the inline-status alternative satisfies the
same acceptance criteria; the choice should be made before implementation.

### 5.3 Calendar containment

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Inner calendar/field error boundary + Retry + graceful fallback** | A calendar failure is contained to the due-date field; other fields remain mounted; specific copy; field-level recovery | Needs a retryable lazy component (a boundary reset alone usually rethrows the cached rejection); needs a fallback decision and focus handling | **Recommended core** |
| Preload/retry the calendar chunk on popover intent | Can avoid the first-open failure and recover from transient network errors | Does not contain a failure if the retry also fails; does not fix the misleading whole-panel fallback by itself; adds preload logic | Complementary, not sufficient |
| Native date input or read-only due display fallback | Due date remains usable/visible even if the chunk never loads; robust | Design inconsistency; native control follows OS locale/theme; extra formatting/timezone tests | **Recommended fallback layer** |
| Eagerly import the calendar / remove the lazy boundary | No lazy failure | Adds `react-day-picker`/`date-fns` to the critical path and breaks the size budget | No |
| Keep the whole-panel boundary and only improve the message | Small copy change | Still hides all healthy fields; no field-level retry | No |

Recommended minimal robust design: keep `CardFieldsChunkBoundary` for the
whole `CardFieldsPanel` chunk (that failure genuinely means the editor code is
unavailable), but add a **small boundary around the lazy `Calendar` inside
`DateTimeField`**. Its fallback is field-specific:

- an inline `role="alert"` message: “The calendar could not load. Other fields
  are still editable.” / “Календарь не загрузился. Остальные поля остаются
  доступными.”;
- a “Retry” / “Повторить” button that remounts a **fresh** lazy calendar (new
  import attempt), not just a boundary state reset;
- if the retry cannot restore the calendar, a native `<input type="datetime-local">`
  fallback (same `value`/`onChange` contract, Save/Remove buttons unchanged) or,
  if the team rejects native UI, a read-only due display plus Retry;
- the due-date trigger, Save and Remove controls stay mounted; the popover and
  focus should not disappear with the rest of the panel.

The retry must be honest. `React.lazy()` caches a rejected import per component
instance, so resetting `failed` alone will usually re-render the same rejected
promise. The implementation should keep a retryable loader (a new `lazy()`
instance/attempt, or an import wrapper that can retry) and test the
reject-once-then-resolve case. If the browser has cached a deployment-level
rejection, the native fallback is the reliable recovery; a page reload remains
the last resort for the whole-panel chunk case.

### 5.4 Dev cache collision (environment-only)

The dev trigger should be documented and prevented without becoming the product
fix:

- set a checkout-local Vite `cacheDir` (for example `ui/.vite` or a path under
  the worktree) instead of sharing `node_modules/.vite` between worktrees; or
- document `rm -rf node_modules/.vite` / restart with `--force` after dependency
  or worktree changes.

This is a developer-experience fix and can be a separate small change or a
documented runbook step. It must not be presented as making the calendar
failure impossible: production, offline, half-deployed and transient chunk
failures still need the local boundary.

## 6. Recommended implementation

### Phase 1 — Labels UX (small, independent)

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
4. Extend the toast API with an opt-in key, for example
   `toast.success(message, { key: "admin.card.labels" })`. The provider keeps
   one toast per key: replace/update the existing item and reset its timer;
   unkeyed calls remain append-only. Clear keyed timers on dismiss and unmount.
5. Pass the key only from `toggleLabel()` (or from the label-specific success
   branch). Do not key `toast.error`; do not change `showFailure` or any other
   caller. A failed label command still lands in the inline `errors.labels`
   message; a real command error is never swallowed.
6. Keep `SET_CARD_LABEL`, the cap guard and the `busy` serialization unchanged.

### Phase 2 — Calendar resilience

1. Add a dedicated boundary around the lazy `Calendar` in `DateTimeField` (or
   around the due-date editor if the popover/trigger needs to be replaced as a
   unit). Keep `CardFieldsChunkBoundary` as the outer guard for the panel chunk.
2. On failure, render field-specific copy and a Retry button. The retry creates
   a fresh lazy calendar attempt; if it succeeds, the calendar opens normally.
   If it fails again, show the native `datetime-local` fallback or a read-only
   due value. The rest of the Properties panel must stay mounted and editable
   throughout.
3. Keep focus and announcements intentional: `role="alert"` for the failure,
   an accessible Retry name, and no focus loss into nowhere when the calendar
   subtree is replaced. If the popover closes, return focus to the due trigger
   or the Retry button.
4. Add EN/RU keys for the field-specific error, Retry and, if chosen, native
   fallback. Do not reuse the whole-panel `admin.cards.fields.loadFailed` copy
   for a calendar-only failure.
5. Add the dev-only cache note/fix from §5.4 separately; do not make the product
   fix depend on a clean dev cache.
6. Verify the outer boundary still handles a failure of the whole
   `CardFieldsPanel` chunk, and that a calendar failure no longer reaches it.

### Proposed copy summary

| Key | EN | RU |
| --- | --- | --- |
| `admin.cards.fields.labelsHelp` | About labels | О метках |
| `admin.cards.fields.labelsHelpBody` | Labels save immediately — there is no separate Save button. Click a label to attach it, click it again to detach it. Every change is recorded in the board history. | Метки сохраняются сразу — отдельной кнопки «Сохранить» нет. Нажмите на метку, чтобы прикрепить её, и ещё раз — чтобы открепить. Каждое изменение попадает в историю доски. |
| `admin.cards.fields.calendarFailed` | The calendar could not load. Other fields are still editable. | Календарь не загрузился. Остальные поля остаются доступными. |
| `admin.cards.fields.calendarRetry` | Retry calendar | Повторить загрузку календаря |
| `admin.cards.fields.calendarUseNative` (if used) | Use date input | Использовать поле даты |

The existing `admin.cards.toast.labelSaved` stays “Label updated” / “Метка
обновлена”; only its toast lifetime/identity changes.

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
  timer refreshes instead of stacking. Distinct success toasts for unrelated
  actions are unchanged. Repeated identical error toasts are still additive;
  label command errors remain visible inline.
- Each actual click still sends exactly one `SET_CARD_LABEL` with the right
  `labelId` and `on`; cap/no-op/disabled behavior is unchanged.
- The heading, help button and popover fit at 1440, 1024 and 390 px with no
  horizontal overflow or clipped control.

### Phase 2 — Calendar

- A rejected lazy import or render error in the calendar is contained to the
  due-date field. Title, assignee, priority, cover, labels and Save controls
  remain mounted and editable.
- The due-date field shows a clear localized error and a field-level Retry; the
  generic “card field editor” fallback appears only when the whole panel chunk
  fails.
- When the calendar import succeeds on retry, the calendar opens and the date
  can be selected and saved. When it cannot succeed, the native/read-only
  fallback keeps the current due value visible and does not require a page
  reload.
- The failure is announced (`role="alert"`), Retry has an accessible name, and
  focus goes somewhere sensible when the calendar subtree is replaced.
- EN/RU copy exists for the field-level error, Retry and fallback.
- 1440/1024/390 layouts remain usable; the fixed dev cache is documented and
  production is verified independently of the dev cache.
- The existing whole-panel chunk-failure test still passes, and a new nested
  calendar-failure test proves the fields stay editable.

## 8. Test and verification plan (for implementation)

- **Labels component test:** open the page, find the button by accessible name,
  open/close via mouse and keyboard, assert Escape/outside-click and focus
  return, assert the three facts are present and localized.
- **Toast behavior test:** toggle two labels in sequence; assert two commands,
  correct state, and exactly one “Label updated” status. Add a Toast unit test
  for keyed replacement/timer reset. Add an unkeyed `toast.error` test showing
  two identical errors remain two nodes, proving no global error suppression.
- **Calendar failure test:** mock the lazy calendar import to throw once, render
  the Properties panel, assert title/assignee/labels are still present, the
  calendar-specific alert appears and the due Save/Remove controls remain. Then
  let the mocked import resolve and click Retry; assert the calendar mounts.
  Add a persistent-failure case for the native/read-only fallback.
- **Existing tests:** keep the label toggle command/state tests and the
  whole-panel `CardFieldsFallback` test; extend them rather than weakening.
- **Gates (implementation PR):** focused Vitest for the affected admin/Toast
  tests, `npx tsc -b` in `ui`, UI lint/prettier and `git diff --check`.
  A targeted browser pass at 1440/1024/390 is optional if an isolated stack is
  available; do not restart the shared demo stack.
- **Environment check:** document how to clear/recreate the dev Vite cache and
  verify the calendar opens in a clean dev server and in a production build.

## 9. Out of scope

- Backend commands, audit records, label CRUD or board-history data changes.
- Editing labels themselves, board-label management, or per-chip help.
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
  generic “Label updated”? It is clearer and gives screen readers a changed
  announcement, but adds copy and interpolation. Recommended first pass: keep
  the generic message and the keyed refresh; revisit if users still miss the
  feedback.
- **Calendar fallback:** native `<input type="datetime-local">` (fully usable,
  OS-styled) or read-only due display (consistent, but not editable)? Recommend
  native fallback as the resilience layer, with the existing Save/Remove
  controls unchanged.
- **Integration order:** TASK-176.9 B1/B2 are not on `main` at this proposal’s
  baseline. The implementation must rebase on the final TASK-176.9 branch (or
  the merge commit) before touching `CardFieldsPanel.tsx`. TASK-181/§7.30 are
  reserved for a parallel admin-filters ticket; keep the ROADMAP numbering and
  merge order coordinated.
- **Cache fix ownership:** if a per-worktree `cacheDir` change touches shared
  Vite config, is it part of this implementation or a separate dev-tooling
  change? Recommended: separate small change/runbook update, so the product
  boundary fix stays reviewable on its own.
