# TASK-180.9 — Navigation, i18n and accessibility

Scope follows [remediation §180.9](TASK-180-bug-research-remediation.md#1809--navigation-i18n-and-accessibility) and the [research report](TASK-180-bug-research-report.md). The starting commit is `d8f26007`.

| ID | Implementation | Evidence |
| --- | --- | --- |
| H15 | Header scopes the Settings session to one board. Switching boards closes the dialog immediately and reopening starts a fresh draft. The workflow action carries the board ID and checks it against the active board before dispatch. | [Settings scope in Chrome](../e2e/tests/app/navigation/settings-scope.spec.ts) creates a valid draft on A, uses the palette to open B, verifies B's disabled Save and unchanged API snapshot, then goes Back and checks A starts clean. |
| M1 | OAuth start carries the app URL. The callback accepts allowlisted user routes under the configured app base, checks them against the OAuth round trip and restores query and hash. The return cookie is bounded after encoding. The error screen removes only the OAuth error marker. | [Backend OAuth e2e](../backend/test/oauth.e2e-spec.ts) covers success, provider denial, invalid state, invalid destinations and Cyrillic URLs both within and over the encoded cookie limit at `/` and `/app/`. [Auth navigation in Chrome](../e2e/tests/app/auth/navigation.spec.ts) checks the start link, error cleanup and canonicalization of a directly served bare app entry. |
| M2 | The auth gate uses a minimum viewport height and document scrolling. The login content reserves space for the site link. | [Auth navigation in Chrome](../e2e/tests/app/auth/navigation.spec.ts) uses wheel input at 568×320 and checks that the OAuth button starts below the viewport and scrolls into view, and that registration, recovery and verification controls are reachable. |
| M38 | Letter shortcuts use Latin `KeyboardEvent.key` when available and fall back to physical `code` for layouts such as Russian. Help opens when the key produces `?`. | [Board shortcut tests](../ui/src/components/ShortcutsDialog.test.tsx), [app palette tests](../ui/src/components/GlobalSearch.test.tsx), [history tests](../ui/src/store/use-undo-history.test.ts) and [admin Chrome navigation](../e2e/tests/admin/navigation.spec.ts) exercise Cyrillic values with physical codes. The board and history tests also cover key-only, code-only and remapped Latin input. |
| M39 | The admin workflow editor uses a router blocker shared by Back, sidebar, palette and browser navigation. Its discard dialog covers path, query and fragment changes and can keep the draft or proceed. Document exits use the browser's unload confirmation. | [Admin workflow in Chrome](../e2e/tests/admin/workflow.spec.ts) cancels Back, checks the draft still exists, and accepts discard from a sidebar link. Existing OWNER and OPERATOR save paths pass. |
| M40 | Each debounced admin query owns an abort controller. Each query change or retry advances a generation, and only its response is rendered. Closing the palette unmounts the search and aborts pending work. | [Admin palette tests](../ui/src/admin/GlobalSearch.test.tsx) resolve an aborted query after a newer reply, revisit a previous query while it reloads, and resolve a pending request after close and reopen. |
| M41 | The app palette controls one grouped listbox. The board switcher controls a grid so its per-row actions have their own cells. Both expose the highlighted result through `aria-activedescendant`. The switcher popover, admin search and Board Settings have accessible names. The switcher announces background loading in a busy status outside the grid. | The [app palette](../ui/src/components/GlobalSearch.test.tsx), [switcher](../ui/src/components/board/BoardSwitcher.test.tsx), [admin palette](../ui/src/admin/GlobalSearch.test.tsx), [Chrome navigation](../e2e/tests/app/navigation/sections.spec.ts) and [Settings](../e2e/tests/app/navigation/settings-scope.spec.ts) check roles, accessible names, focus and ID linkage. The [skeleton unit tests](../ui/src/components/board/BoardSkeleton.test.tsx) and [Chrome hydration test](../e2e/tests/app/navigation/skeleton.spec.ts) verify the busy status has no option role or selection state. |
| L1 | The register hint controls the anonymous form. Authentication consumes `mode` before the verification gate or board shell mounts, preserving the remaining URL. | [Auth navigation in Chrome](../e2e/tests/app/auth/navigation.spec.ts) starts in register mode, checks query and fragment after submission, signs out and checks the sign-in form. |
| L2 | Failed invitation fetches show an announced error and a retry button. Previously fetched invitations remain usable. | [Bell tests](../ui/src/components/NotificationsBell.test.tsx) check the initial 503, the end of the loading state and recovery through Retry. |
| L6 | Login explains disabled accounts and service outages. Registration explains closed or unavailable sign-up. | [Login tests](../ui/src/components/auth/LoginPage.test.tsx) cover 403 and 503 for both modes. |
| L27 | Explicit language selection consumes `lng` with a replace navigation and keeps the path, other params and hash. Signed-in board users persist locale on their account. The master panel persists it in the browser’s `janosik-lang` localStorage entry. | [Admin navigation in Chrome](../e2e/tests/admin/navigation.spec.ts) opens a Russian handoff, chooses English and checks localStorage and reload while the tab and hash stay in place. |
| L28 | Recent admin destinations resolve hub, tab or detail metadata and use the matching localized name and icon. | [Admin palette tests](../ui/src/admin/GlobalSearch.test.tsx) cover a workflow detail, the Cards tab and Overview, including their distinct icons. |
| L29 | Named board creation from search uses `LIMITS.boardTitle` (100). Search still accepts `LIMITS.query`. An overlong candidate disables creation and displays the limit. | [Switcher tests](../ui/src/components/board/BoardSwitcher.test.tsx) check 100 and 101 characters. [Chrome board creation](../e2e/tests/app/boards/create-limit.spec.ts) verifies that the 101-character attempt sends no POST and the 100-character attempt succeeds. |
| L30 | Admin breadcrumbs link to hub and tab URLs and mark the current crumb. Detail pages reuse the same route metadata as the palette. | [Breadcrumb tests](../ui/src/admin/layout/AdminBreadcrumbs.test.tsx) check both destinations and `aria-current`. |
| L31 | Board undo and redo hotkeys yield to the shared overlay guard and to native editing shortcuts inside inputs. | [History tests](../ui/src/store/use-undo-history.test.ts) and [Chrome board history](../e2e/tests/app/history/controls.spec.ts) verify undo and redo leave history intact while Settings is open and replay after it closes. |
| L32 | Selecting an All destinations item closes its dialog and mobile navigation. Same-hub tab navigation also dismisses the sheet. | [Admin navigation in Chrome](../e2e/tests/admin/navigation.spec.ts) checks All destinations at 390 px and separately verifies browser Back between tabs dismisses an open sidebar. |
| L33 | Help reads the same board-view preference as the view renderer. The filter shortcut appears when the toolbar mounts, Kanban keys appear in Board view, and mutations require edit access. | [Board shortcut tests](../ui/src/components/ShortcutsDialog.test.tsx) exercise the cheat sheet in Board and Table and verify the filter handler. [Chrome viewer access](../e2e/tests/app/views/read-only.spec.ts) verifies that navigation still works while composer shortcuts and editing help are unavailable. |
| L34 | All destinations uses translated title and description in the admin catalog. User-facing translations and behavior guides are updated in EN and RU. | [Admin navigation in Chrome](../e2e/tests/admin/navigation.spec.ts) asserts the Russian dialog name and description. UI catalog parity and typed admin catalog parity pass. |

## Reviewer follow-up

- Wrapped the Preferences and Account Dialog test renderers in a memory router so their language switcher follows the production navigation contract.
- Audited synthetic key events in the UI and browser suites. The virtualization test supplies the physical code, the layout tests exercise each input independently, and the browser Help test sends the literal question mark.
- Updated the shared browser data helpers used by export, import and round-trip scenarios. They locate exact board titles in the switcher grid and check that Escape dismisses it.

## Verification

| Command | Result |
| --- | --- |
| `npm test -w ui` | **1,849 passed in 198 files, 0 failures.** |
| `npm run test:coverage -w ui` | **1,849 passed in 198 files, 0 failures.** All thresholds passed. Statements 91.78%, branches 83.25%, functions 91.46%, lines 93.95%. |
| `UI_BASE=/ npm run test:e2e -w backend -- test/oauth.e2e-spec.ts test/auth.e2e-spec.ts` | **25 passed.** |
| `UI_BASE=/app/ npm run test:e2e -w backend -- test/oauth.e2e-spec.ts` | **15 passed.** |
| `npx tsc -b ui shared`, `npm run typecheck -w backend`, `npm run typecheck -w e2e` | Passed. |
| `npm run build:backend`, `UI_BASE=/app/ npm run build -w ui`, `npm run size -w ui` | Built the API and prefixed UI. All seven bundle budgets passed. |
| `npm run lint`, `npm run format:check`, `git diff --check` | Lint reported warnings and zero errors. Formatting and whitespace checks passed. |

The focused UI command covered both account panels, virtualization, switcher roles, keyboard behavior and stale search responses. **85 tests passed in 9 files.**

```sh
npm test -w ui -- src/components/account/PreferencesSection.test.tsx \
  src/components/account/AccountDialog.test.tsx \
  src/components/board/ColumnView.virtualization.test.tsx \
  src/components/board/BoardSkeleton.test.tsx \
  src/components/board/BoardSwitcher.test.tsx src/components/ShortcutsDialog.test.tsx \
  src/admin/GlobalSearch.test.tsx src/components/GlobalSearch.test.tsx \
  src/store/use-undo-history.test.ts
```

Chrome ran against the production UI served by the local API at `/app/`.
The browser and backend suites used separate disposable PostgreSQL databases.
The commands below use the local stack’s `E2E_MASTER_EMAIL` and
`E2E_MASTER_PASSWORD` fixture credentials. The data and workflow-data run
passed **25** tests, the targeted app run passed **80**, and the targeted
admin run passed **11**. All three runs had zero failures.

```sh
export E2E_SITE_URL=http://127.0.0.1:41809/

PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/task1809-remediation-data-report \
  npm test -w e2e -- --output=/tmp/task1809-remediation-data-results \
  --workers=3 tests/app/data tests/app/workflow/data.spec.ts

PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/task1809-remediation-app-report \
  npm test -w e2e -- --output=/tmp/task1809-remediation-app-results \
  --workers=2 tests/app/auth/navigation.spec.ts tests/app/navigation \
  tests/app/boards/create-limit.spec.ts tests/app/history/controls.spec.ts \
  tests/app/views/read-only.spec.ts tests/app/account/preferences.spec.ts \
  tests/app/search/global-search.spec.ts

E2E_ADMIN_TEST=1 PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/task1809-remediation-admin-report \
  npm test -w e2e -- --output=/tmp/task1809-remediation-admin-results \
  --workers=2 tests/admin/navigation.spec.ts tests/admin/workflow.spec.ts
```

The first coverage run timed out waiting for an admin page while Chrome and
other checks were running. Coverage passed when rerun without that load.
The first app/data browser launch lacked fixture credentials. A subsequent app
run exposed the trailing-slash regression and stale synthetic Help input.
The final commands above used fixture credentials, preserved the canonical
app URL and sent the literal question mark.

## Residual coverage

- ARIA roles, names, focus, active descendants and tab/panel links were verified in automated tests. Announcement behavior in NVDA, JAWS, VoiceOver and TalkBack remains unverified.
- The OAuth HTTP e2e uses provider stubs, and the short-screen verification test supplies an unverified registration response over a real local session. Live-provider callbacks and mail delivery were outside the verification run.
- Russian-layout tests inject the physical key code with the corresponding Cyrillic value. Short and mobile viewports were exercised in Chrome. OS input methods and physical devices were outside the run.
- OAuth returns to the app root for rejected or expired destinations. The allowlist covers the root, boards and agents. The impersonation entry handles a support token and falls back to the app root if supplied as an OAuth return destination.
- Switching boards immediately discards the previous board’s open Settings draft. The discard confirmation and gear focus restoration apply to the normal Settings close flow. The master-panel workflow editor confirms navigation away from a dirty draft.
