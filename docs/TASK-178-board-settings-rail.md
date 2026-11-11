# TASK-178 — Board settings workflow rail (`Рельс доски`)

**Status:** done  
**Branch:** `feat/board-settings-rail-redesign` (merged in PR #242, `360938b`)  
**Base:** `main` = `360938b`  
**Design source:** [`design/board-settings-redesign/REPORT.md`](../design/board-settings-redesign/REPORT.md), direction **01 «Рельс доски»**  
**Prototype:** `design/board-settings-redesign/index.html` and `screenshots/` are local artifacts (not tracked); the markdown report is tracked.

## 1. Goal

Replace the current Board Settings dialog with the approved **variant 01 “Рельс доски”**:

- board columns become a horizontal workflow rail;
- one source column’s rules are shown as a list;
- the selected transition opens a 316 px context inspector;
- the full matrix remains a secondary tab;
- global transitions and start/done become two compact rows;
- the dialog feels like one Janosik surface, not a separate app.

This is a UI/UX refactor only. The `BoardWorkflow` model, commands, permissions and server contracts do not change.

## 2. Scope

### Include

- Dialog shell: one surface, sticky header/footer, single scroll body, `max-w-[1040px]`, dirty-close confirmation.
- Header: «Настройки доски», subtitle, «По колонкам / Матрица» tabs, «Контроль включён», close; template/reset in a compact `…` menu.
- Column rail: `tablist`, roving tabindex, arrows/Home/End, column accent, card count, rule count, horizontal snap on mobile.
- Transition list: «Разрешено из «…»», direction, roles/conditions summary, switch, «Разрешить», disabled/locked state.
- Inspector: roles, conditions, reverse transition, live card preview, delete; only rendered when a rule is selected.
- Global transitions: one compact row with add.
- Start/done: one compact row, no separate card.
- Matrix tab: preserve the existing matrix, conditional/enabled/disabled states and keyboard model.
- Footer: status (`Сохранено` / `Не сохранено` / `Сохраняем…` / `Ошибка`), hint, «Вернуть», «Сохранить»; reset/template in the `…` menu.
- Responsive: ≥1024 rail + content + 316 px inspector; 768–1023 inspector below; <768 full-screen, snap rail, inspector accordion, sticky footer with safe-area.
- Accessibility: visible focus, roving tabindex, `aria-live` status, reduced motion, no 25-cell Tab trap.
- Master panel: `BoardWorkflowPage` reuses the same body embedded, without the dialog shell.
- Tests and EN/RU docs.

### Exclude

- Changes to `BoardWorkflow` schema, command names, server validation or permissions.
- New workflow features (post-functions, graph editor, platform templates) — TASK-165 phase 2 owns them.
- Board settings content unrelated to workflow (members, sharing, archive) — separate tasks.
- Replacing the design with a different direction; variant 01 is fixed.

## 3. Visual source of truth

The implementation must be visually 1:1 with the prototype:

- desktop: 1440×900, dialog 1040 px, rail + list + 316 px inspector;
- tablet: 1024×768, inspector stacks below;
- mobile: 390×844, full-screen dialog, horizontal snap rail, inspector accordion;
- dark theme default; light theme uses the same structure;
- no nested rounded cards, no 10 px uppercase, hairline dividers, one surface.

The report contains the audit, the 10 directions and the implementation checklist. Screenshots and the HTML prototype are local evidence; if they are not tracked, do not link them from user-facing docs.

## 4. Implementation phases

| Phase | Content | Status |
| --- | --- | --- |
| 1. Shell | one surface, sticky header/footer, single scroll body, dirty close | ✅ in branch |
| 2. Rail and list | tablist, roving tabindex, counters, «Разрешить», disabled/locked | ✅ in branch |
| 3. Inspector | roles, conditions, reverse edge, card check, delete | ✅ in branch |
| 4. Matrix and responsive | «Матрица» tab, 316 px / stacked / full-screen, snap rail | ✅ in branch |
| 5. Tests and docs | unit + browser + mobile, EN/RU user guide, CHANGELOG | ✅ in branch |

The branch also adds its own implementation section at the top of `ROADMAP.md`. Keep that section as the detailed log; this task is the formal tracking entry.

## 5. Acceptance criteria

- All existing workflow capabilities work: enable/disable, edge enable, roles, conditions, reverse edge, global transitions, initial/done, template, reset, preview, invalid stored config, foreign-change banner, master mode.
- Existing `workflow-*` test ids are preserved; new rail/list/inspector ids are added.
- The matrix is a tab but all its old interactions and keyboard support remain.
- 390 px has no horizontal page overflow; dialogs fit; touch actions are visible.
- The real dialog is compared side-by-side with the prototype at 1440/1024/390; deviations are documented.
- `WorkflowEditor` remains compatible with `BoardWorkflowPage` (`masterMode`, `testIdPrefix`, `onSave`, `onCancel`, `onDirtyChange`).
- Unit, browser and workflow E2E suites pass; no weakened expectations.
- EN/RU user guide updated; `CHANGELOG.md` entry; ROADMAP status.
- No unrelated refactors; no changes to board workflow model or API.

## 6. Known risks

- The branch is based on `a858c75`; rebase on current `main` before opening/updating the PR.
- The prototype uses demonstration data; real boards may have 8–12 columns and long names. The rail must scroll and the inspector must reflow.
- The matrix tab is still a dense grid; keep the roving-tabindex keyboard model and test it.
- The branch’s ROADMAP section and this task must not diverge; update both when scope changes.

## 7. Definition of done

- Design report followed, variant 01 only.
- Visual comparison done at desktop/tablet/mobile; no “separate app” feel.
- Tests, docs EN/RU, CHANGELOG, ROADMAP status.
- PR opened against `main`; review and merge only after the gates are green.
