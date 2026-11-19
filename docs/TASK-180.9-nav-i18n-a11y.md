# TASK-180.9 — Navigation, i18n and accessibility

Scope follows [remediation §180.9](TASK-180-bug-research-remediation.md#1809--navigation-i18n-and-accessibility) and the [research report](TASK-180-bug-research-report.md). The starting commit is `d8f26007`.

| ID | Implementation | Evidence |
| --- | --- | --- |
| H15 | Header scopes the Settings session to one board. Switching boards closes the dialog immediately and reopening starts a fresh draft; focus moves to the new board's gear when it is actually visible, otherwise to the title/main so a phone never drops focus on BODY. Visibility uses `checkVisibility()` when available and a `getClientRects()` fallback, so hidden mobile chrome is never chosen. The workflow action carries the board ID and checks it against the active board before dispatch. | [Settings scope in Chrome](../e2e/tests/app/navigation/settings-scope.spec.ts) creates a valid draft on A, uses the palette to open B, verifies B's disabled Save and unchanged API snapshot, checks the new gear holds focus on desktop and the title at 390 px, then goes Back and checks A starts clean. [Header unit tests](../ui/src/components/Header.agents.test.tsx) and [Settings tests](../ui/src/components/board/BoardSettingsDialog.test.tsx) cover the forced-switch and hidden-gear fallback. |
| M1 | OAuth start carries the app URL. The callback accepts allowlisted user routes under the configured app base, checks them against the OAuth round trip and restores query and hash. The return cookie is bounded after encoding. The error screen removes only the OAuth error marker. | [Backend OAuth e2e](../backend/test/oauth.e2e-spec.ts) covers success, provider denial, invalid state, invalid destinations and Cyrillic URLs both within and over the encoded cookie limit at `/` and `/app/`. [Auth navigation in Chrome](../e2e/tests/app/auth/navigation.spec.ts) checks the start link, error cleanup and canonicalization of a directly served bare app entry. |
| M2 | The auth gate uses a minimum viewport height and document scrolling. The login content reserves space for the site link. | [Auth navigation in Chrome](../e2e/tests/app/auth/navigation.spec.ts) uses wheel input at 568×320 and checks that the OAuth button starts below the viewport and scrolls into view, and that registration, recovery and verification controls are reachable. |
| M38 | Letter shortcuts use Latin `KeyboardEvent.key` when available and fall back to physical `code` for layouts such as Russian. The board-filter `/` shortcut follows only the typed character: RU, QWERTZ and AZERTY layouts put `.`, `-` or `:` on the physical Slash key and those keys stay inert. Help opens when the key produces `?`. | [Board shortcut tests](../ui/src/components/ShortcutsDialog.test.tsx), [filter tests](../ui/src/components/board/FilterBar.test.tsx), [app palette tests](../ui/src/components/GlobalSearch.test.tsx), [history tests](../ui/src/store/use-undo-history.test.ts) and [admin Chrome navigation](../e2e/tests/admin/navigation.spec.ts) exercise Cyrillic values with physical codes. The board, history and filter tests also cover key-only, code-only and remapped Latin input, including a mismatched physical Slash key. |
| M39 | The admin workflow editor uses a router blocker shared by Back, sidebar, palette and browser navigation. Its discard dialog covers path, query and fragment changes and can keep the draft or proceed; an `lng`-only search change is ignored because the language handoff consumes it with a router `navigate(..., { replace: true })`. Document exits use the browser's unload confirmation. | [Admin workflow in Chrome](../e2e/tests/admin/workflow.spec.ts) cancels Back, checks the draft still exists, accepts discard from a sidebar link and cancels browser Back. [Workflow page tests](../ui/src/admin/BoardWorkflowPage.test.tsx) cover browser Back, query/hash changes and the `lng`-only exemption. Existing OWNER and OPERATOR save paths pass. |
| M40 | Each debounced admin query owns an abort controller. Each query change or retry advances a generation, and only its response is rendered. Closing the palette unmounts the search and aborts pending work. | [Admin palette tests](../ui/src/admin/GlobalSearch.test.tsx) resolve an aborted query after a newer reply, revisit a previous query while it reloads, and resolve a pending request after close and reopen. |
| M41 | The app palette controls one grouped listbox. The board switcher controls a grid so its per-row actions have their own cells; its search combobox reports the popover's actual open state in `aria-expanded`, and the “My boards” / “Shared with me” headings are full-width grid rows with gridcells instead of hidden text. The grid stays mounted (empty) when no board matches, so `aria-expanded=true` never points at hidden content. Both expose the highlighted result through `aria-activedescendant`. The switcher popover, admin search and Board Settings have accessible names. The switcher announces background loading in a busy status outside the grid. | The [app palette](../ui/src/components/GlobalSearch.test.tsx), [switcher](../ui/src/components/board/BoardSwitcher.test.tsx), [admin palette](../ui/src/admin/GlobalSearch.test.tsx), [Chrome navigation](../e2e/tests/app/navigation/sections.spec.ts) and [Settings](../e2e/tests/app/navigation/settings-scope.spec.ts) check roles, accessible names, focus and ID linkage. The [skeleton unit tests](../ui/src/components/board/BoardSkeleton.test.tsx) and [Chrome hydration test](../e2e/tests/app/navigation/skeleton.spec.ts) verify the busy status has no option role or selection state. [Admin shell Chrome](../e2e/tests/admin/shell.spec.ts) waits for the debounced result and checks `aria-activedescendant` before opening a card with Enter. |
| L1 | The register hint controls the anonymous form. Authentication consumes `mode` before the verification gate or board shell mounts, preserving the remaining URL. | [Auth navigation in Chrome](../e2e/tests/app/auth/navigation.spec.ts) starts in register mode, checks query and fragment after submission, signs out and checks the sign-in form. |
| L2 | Failed invitation fetches show an announced error and a retry button. Previously fetched invitations remain usable. | [Bell tests](../ui/src/components/NotificationsBell.test.tsx) check the initial 503, the end of the loading state and recovery through Retry. |
| L6 | Login explains disabled accounts and service outages. Registration explains closed or unavailable sign-up. | [Login tests](../ui/src/components/auth/LoginPage.test.tsx) cover 403 and 503 for both modes. |
| L27 | Explicit language selection consumes `lng` with a router `navigate(..., { replace: true })` only after the lazy catalog is ready, keeping the path, other params and hash and updating `useLocation`/`useSearchParams`; later board filters, card deep links and admin list writes therefore cannot reintroduce it. The cleanup reads the live `window.location` at resolve time (stripping the deploy basename), so changing boards, opening a card or editing a filter — even after the switcher unmounts — keeps the newer route instead of restoring the click-time URL. A failed load keeps `lng` for a reload retry. The M39 workflow blocker ignores only that `lng`-only change. Signed-in board users persist locale on their account. The master panel persists it in the browser’s `janosik-lang` localStorage entry. | [Language switcher tests](../ui/src/components/LanguageSwitcher.test.tsx) render a `BrowserRouter` and cover the signed-in `updateProfile({ locale })` path, query/hash preservation, a later filter write staying `lng`-free, a deferred catalog where the switcher unmounts and filter+board navigation happen before resolution, and the failed-load case. [Chrome preferences](../e2e/tests/app/account/preferences.spec.ts) start on `?lng=ru`, switch to English, apply a board filter, reload and check English plus the filtered URL. [Admin navigation in Chrome](../e2e/tests/admin/navigation.spec.ts) also checks the tab/hash handoff and reload. |
| L28 | Recent admin destinations resolve hub, tab or detail metadata and use the matching localized name and icon. | [Admin palette tests](../ui/src/admin/GlobalSearch.test.tsx) cover a workflow detail, the Cards tab and Overview, including their distinct icons. |
| L29 | Named board creation from search uses `LIMITS.boardTitle` (100). Search still accepts `LIMITS.query`. An overlong candidate disables creation and displays the limit. | [Switcher tests](../ui/src/components/board/BoardSwitcher.test.tsx) check 100 and 101 characters. [Chrome board creation](../e2e/tests/app/boards/create-limit.spec.ts) verifies that the 101-character attempt sends no POST and the 100-character attempt succeeds. |
| L30 | Admin breadcrumbs link to hub and tab URLs and mark the current crumb. Detail pages reuse the same route metadata as the palette. | [Breadcrumb tests](../ui/src/admin/layout/AdminBreadcrumbs.test.tsx) check both destinations and `aria-current`. |
| L31 | Board undo and redo hotkeys yield to the shared overlay guard and to native editing shortcuts inside inputs. Surfaces animating out with `data-state="closed"` no longer count as open, including nested role-bearing content such as the app palette's listbox, so the first Ctrl+Z or `?` after closing a dialog or popover works. | [History tests](../ui/src/store/use-undo-history.test.ts), [overlay tests](../ui/src/utils/overlay.test.ts) and [shortcut tests](../ui/src/components/ShortcutsDialog.test.tsx) verify open overlays still block, closed parents with nested listboxes do not, and undo/help replay immediately after a close. [Chrome board history](../e2e/tests/app/history/controls.spec.ts) adds Ctrl+Z immediately after the app palette closes; [global search Chrome](../e2e/tests/app/search/global-search.spec.ts) opens help immediately after Escape. |
| L32 | Selecting an All destinations item closes its dialog and mobile navigation. Same-hub tab navigation also dismisses the sheet. | [Admin navigation in Chrome](../e2e/tests/admin/navigation.spec.ts) checks All destinations at 390 px and separately verifies browser Back between tabs dismisses an open sidebar. |
| L33 | Help reads the same board-view preference as the view renderer. The filter shortcut appears when the toolbar mounts, Kanban keys appear in Board view, and mutations require edit access. | [Board shortcut tests](../ui/src/components/ShortcutsDialog.test.tsx) exercise the cheat sheet in Board and Table and verify the filter handler. [Chrome viewer access](../e2e/tests/app/views/read-only.spec.ts) verifies that navigation still works while composer shortcuts and editing help are unavailable. |
| L34 | All destinations uses translated title and description in the admin catalog. User-facing translations and behavior guides are updated in EN and RU. | [Admin navigation in Chrome](../e2e/tests/admin/navigation.spec.ts) asserts the Russian dialog name and description. UI catalog parity and typed admin catalog parity pass. |

## Reviewer follow-up

- Wrapped the Preferences and Account Dialog test renderers in a memory router so their language switcher follows the production navigation contract.
- Audited synthetic key events in the UI and browser suites. The virtualization test supplies the physical code, the layout tests exercise each input independently, and the browser Help test sends the literal question mark.
- Updated the shared browser data helpers used by export, import and round-trip scenarios. They locate exact board titles in the switcher grid and check that Escape dismisses it.

## Final review fixes

- **M38 — `/` is a character shortcut.** The filter handler now matches
  `event.key === "/"` only. The physical `Slash` code no longer focuses the
  filter on RU/QWERTZ/AZERTY layouts where it types `.`/`-`/`:`; letter
  shortcuts (`j`/`k`/undo/redo) keep their Latin-key/physical-code fallback.
  The help sheet continues to show `/`, and unit/browser tests cover a
  mismatched physical Slash key plus a character slash on another key.
- **M39 + L27 — dirty admin workflow language switch.** `LanguageSwitcher`
  removes the one-shot `?lng=` with a router
  `navigate(..., { replace: true })` only after `ensureLocale` succeeds, so
  `useLocation`/`useSearchParams` are in sync and later board-filter, card or
  admin-list URL rebuilds cannot carry the stale language parameter forward.
  The workflow blocker ignores only an `lng`-only query change while still
  blocking every other path, query or hash change. A failed catalog load
  keeps `lng` for a reload retry.
- **L31 — overlays animating out.** `isOverlayOpen()` resolves the nearest
  `[data-state]` ancestor, so a closed dialog also discounts nested
  role-bearing content (the app palette's listbox during its exit animation).
  The first Ctrl+Z / `?` immediately after a close is no longer swallowed.
- **H15 — forced board switch.** A board switch still discards the old
  Settings draft silently (never saves A into B), but focus now moves to the
  new board's gear only when it is visible/focusable, otherwise to the title
  or main region. This keeps focus off BODY at ≤720 px where the gear is
  `display:none`. A save resolving after the dialog unmounted can no longer
  close a reopened B dialog or steal its focus.
- **M41 — switcher semantics.** The search combobox derives `aria-expanded`
  from the popover's actual open state, not the result count, and the
  referenced grid stays mounted empty when no board matches instead of being
  hidden. “My boards” and “Shared with me” are real full-width grid
  rows/gridcells with accessible names.
- **M6 — dead guard removed.** `BoardSettingsDialog` no longer checks the
  always-mounted workflow panel ref before closing after a successful save.
- **RU docs.** The collaboration shortcut table now says “Поиск по доскам”,
  matching the EN “Search across boards”.

### Old-head CI failures

| Job | Root cause | Fix |
| --- | --- | --- |
| `browser-e2e-admin` / NAV-5 | The test pressed Enter while the 200 ms debounced refresh for `Card <token>` was still pending. Results for that generation were intentionally hidden, so there was no active option and Enter did nothing; the later screenshot shows the card selected but the URL still `/admin`. | [Admin shell Chrome](../e2e/tests/admin/shell.spec.ts) now waits for the card result and its `aria-activedescendant` link before pressing Enter. |
| `browser-e2e` / foreign label rename | The test pressed Ctrl+Z while the card dialog and its label popover were open. L31 correctly makes global undo yield to overlays, so the skip toast never ran. | [Foreign-dead-steps Chrome](../e2e/tests/app/history/foreign-dead-steps.spec.ts) closes the card before keyboard undo, then reopens it to check the foreign rename survived. |
| `browser-e2e` / calendar auto-scroll | `touchDragToOffscreen` released 40 px from the day cell's top. For a 128 px cell that point stayed inside the 48 px auto-scroll band; the extra 60 ms scrolled another week under the finger, so a Nov 29 target dropped on Dec 6. | [Touch helper](../e2e/helpers/touch.ts) now releases at the target's true centre, outside the auto-scroll band. The assertion still compares the exact target day. |

### Second review round

| Finding | Root cause | Fix and evidence |
| --- | --- | --- |
| L27 router-state desync | Raw `history.replaceState` cleaned the address bar but left `?lng=ru` in React Router. A later board filter/card/admin-list write rebuilt the URL from stale `useSearchParams`. Follow-up reviews found the router cleanup itself used a click-time/component-local location, so navigating or unmounting the switcher while the lazy catalog loaded could send the user back. | `LanguageSwitcher` navigates with the router after the catalog loads and reads the live `window.location` at callback time (stripping the deploy basename for router-relative coordinates), so it strips `lng` from the current route even after the component unmounts. [BrowserRouter tests](../ui/src/components/LanguageSwitcher.test.tsx) cover the filter write and a deferred catalog where the switcher unmounts, a filter is applied and another board/card is opened before resolution; [Chrome preferences](../e2e/tests/app/account/preferences.spec.ts) reload and check English plus the filtered URL. |
| L31 nested closed overlays | `isOverlayOpen()` tested only the matched element. The app palette's `role="listbox"` has no `data-state` and stayed “open” inside a closing dialog. | The guard resolves the nearest `[data-state]` ancestor. [Overlay tests](../ui/src/utils/overlay.test.ts) cover the nested closed listbox; [shortcut tests](../ui/src/components/ShortcutsDialog.test.tsx) and Chrome open help/undo immediately after Escape closes the palette. |
| H15 mobile focus | The focus helper always chose the gear, which is `display:none` at ≤720 px, so `.focus()` left focus on BODY. | Candidate order is gear → title → main, filtered by `checkVisibility()` when available and `getClientRects().length` otherwise. A jsdom hidden-gear test and [390 px Chrome test](../e2e/tests/app/navigation/settings-scope.spec.ts) verify the title fallback. |
| H15 stale save race | A pending save resolving after unmount still called `onOpenChange(false)` and the focus helper, stealing focus from a reopened B dialog. | A mounted ref gates close/focus side effects. [Settings tests](../ui/src/components/board/BoardSettingsDialog.test.tsx) resolve the save after unmount and assert no close or focus change. |
| M41 empty grid | `aria-expanded=true` pointed at a grid with `hidden` when no board matched. | The grid stays mounted empty under the no-match message; the switcher test asserts it stays visible while expanded. |

## Verification

| Command | Result |
| --- | --- |
| `npm test -w ui` | **1,865 passed in 200 files, 0 failures.** |
| `npm run test:coverage -w ui` | **1,865 passed in 200 files, 0 failures.** All thresholds passed. Statements 91.78%, branches 83.2%, functions 91.47%, lines 93.95%. |
| `UI_BASE=/ npm run test:e2e -w backend -- test/oauth.e2e-spec.ts test/auth.e2e-spec.ts` | **25 passed.** |
| `UI_BASE=/app/ npm run test:e2e -w backend -- test/oauth.e2e-spec.ts` | **15 passed.** |
| `npx tsc -b ui shared`, `npm run typecheck -w backend`, `npm run typecheck -w e2e` | Passed. |
| `npm run build:backend`, `UI_BASE=/app/ npm run build -w ui`, `npm run size -w ui` | Built the API and prefixed UI. All seven bundle budgets passed. |
| `npm run lint`, `npx prettier --check …`, `git diff --check` | Lint reported warnings and zero errors. Formatting and whitespace checks passed. |

The focused UI command covered the new M38/M39/L27/L31/H15/M41 tests and the adjacent board, history and settings suites. **117 tests passed in 9 files.**

```sh
npm test -w ui -- src/admin/BoardWorkflowPage.test.tsx \
  src/components/LanguageSwitcher.test.tsx \
  src/components/board/FilterBar.test.tsx \
  src/components/board/BoardSwitcher.test.tsx \
  src/components/Header.agents.test.tsx \
  src/components/ShortcutsDialog.test.tsx \
  src/store/use-undo-history.test.ts src/utils/overlay.test.ts \
  src/components/board/BoardSettingsDialog.test.tsx
```

Chrome ran against the production UI served by the local API at `/app/` on a
disposable Docker stack (`npm run test:docker -w e2e`). The targeted
language/filter/settings run passed **17** tests with zero failures.

```sh
npm run test:docker -w e2e -- \
  tests/app/account/preferences.spec.ts \
  tests/app/filters/search.spec.ts \
  tests/app/navigation/settings-scope.spec.ts
```

The run covers the `?lng=ru` → English → board-filter → reload path, the
character-only `/` shortcut, and desktop/390 px focus after a forced board
switch. The previous round's app/admin targeted runs (51 + 28) remain
recorded in the earlier commit.

## Residual coverage

- ARIA roles, names, focus, active descendants and tab/panel links were verified in automated tests. Announcement behavior in NVDA, JAWS, VoiceOver and TalkBack remains unverified.
- The OAuth HTTP e2e uses provider stubs, and the short-screen verification test supplies an unverified registration response over a real local session. Live-provider callbacks and mail delivery were outside the verification run.
- Russian-layout tests inject the physical key code with the corresponding Cyrillic value. Short and mobile viewports were exercised in Chrome. OS input methods and physical devices were outside the run.
- OAuth returns to the app root for rejected or expired destinations. The allowlist covers the root, boards and agents. The impersonation entry handles a support token and falls back to the app root if supplied as an OAuth return destination.
- Switching boards immediately discards the previous board’s open Settings draft and now restores focus to the new board’s gear/title. The master-panel workflow editor confirms client-side navigation away from a dirty draft; a full document unload still uses the browser’s own confirmation.
- The deferred-catalog L27 test uses a `BrowserRouter`, a controlled promise and an unmounted switcher; a genuinely slow network chunk in Chrome was not throttled.
- H15 visibility checks use `checkVisibility()`/`getClientRects()`. jsdom has no layout, so unit tests stub geometry; the real hidden-gear path is covered at a 390 px Chrome viewport.
