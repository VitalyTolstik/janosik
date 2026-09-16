# TASK-22 `monorepo-restructure` — report

Final commit: `076361e868693b4747233810e3a6e9f3784d19e6` (branch `VitalyTolstik/dev-task-22`, not pushed/merged).

## Layout after the restructure

- **root** — npm workspaces `["ui", "shared"]`; keeps `.github/`, `deploy/`,
  `.prettierrc`, `.prettierignore`, `.gitignore`, `LICENSE`, `AGENT.md`,
  `README.md`, `ROADMAP*.md`; new `package.json` (private, delegate scripts)
  and regenerated `package-lock.json`.
- **ui/** — the former root frontend: `src/`, `public/`, `index.html`,
  `vite/` (`sw-plugin.ts`, a dependency of `vite.config.ts`), `vite.config.ts`,
  `vitest.config.ts`, `tsconfig*.json`, `eslint.config.js`, `components.json`,
  `package.json` (old deps + size-limit budgets, name `@janosik/ui`).
- **shared/** (`@janosik/shared`, no build step) — `src/types/kanban.ts`,
  `src/store/{board-reducer,invert,seed-data,migrate}.ts`,
  `src/utils/{text,column-limits,board-serialization,storage-keys}.ts`,
  **new** `src/api.ts` (CommandRequest / CommandResponse / ConflictError /
  SSE `command|presence|activity`), `src/index.ts` barrel; the 5 tests moved
  with their code (board-reducer, invert, migrate, board-serialization,
  column-limits). Relative imports only, no `@/`.
- **ui aliases** — `@` → `ui/src`, `@janosik/shared` → `../shared/src` in
  vite, vitest and tsconfig; `SAVE_DEBOUNCE_MS` moved to
  `ui/src/store/constants.ts`.

## Verification (all from repo root unless noted)

| Gate | Command | Result |
| --- | --- | --- |
| tests | `npm test` | 627 passed (ui 397/55 files + shared 230/5 files) |
| coverage | `npm run test:coverage` | ui 94.98/87.84/91.41/96.96; shared 90.48/86.86/99.11/97.69 (thresholds 88/83/91/93) |
| build/tsc | `npm run build -w ui` | green (`tsc -b` also type-checks `shared/`) |
| shared tsc | `npm run typecheck -w shared` | 0 errors |
| lint | `npm run lint` | 0 errors / 9 warnings (shared: 0) |
| format | `npm run format:check` | clean |
| size | `npm run size -w ui` | 198.72/210, 49.41/55, 21.55/27, 14.3/18 KB gzip — 4/4 pass |

Also verified the gates run from inside packages (`ui/` lint, build,
`format:check`; `shared/` test, lint).

## Deviations from the spec (with reasons)

1. **ESLint config placement.** `eslint.config.js` moved to `ui/` as specced;
   to also lint `shared/` without duplicating rules, `shared/eslint.config.js`
   re-exports the UI flat config (single source of rules).
2. **Extra files in `shared/`.** `store/migrate.ts`, `store/seed-data.ts` and
   `utils/text.ts` moved too: the export envelope needs `normalizeBoards`, the
   reducer needs `createSeedBoard`, and all three need `clamp`/`clampText`.
   `shared/` cannot import from `ui/`, so these are hard dependencies of the
   listed modules.
3. **`atWipLimit`.** §7.4 names it as the shared WIP-refusal predicate, but it
   lived privately in the reducer. It now lives (exported) in
   `shared/src/utils/column-limits.ts` next to `isColumnFull`, and the reducer
   imports it — no logic change.
4. **`vite/` moved** (`vite/sw-plugin.ts`) because `vite.config.ts` imports it.
5. **UI format scripts** take `--ignore-path ../.prettierignore` so
   `format:check` also works from `ui/` (root `.prettierignore` keeps the new
   layout paths).
6. **AGENT.md** had no command block; only a new `## Команды (monorepo…)`
   section was appended, nothing else changed.
7. **Test flakiness note.** Timing-sensitive UI tests (`lazy-animated-icon`,
   `FilterBar` calendar, `render-isolation`) flaked once while heavy
   `build`/`size` commands ran concurrently; isolated re-runs (twice) and the
   final isolated coverage run were fully green. Pre-existing timing
   sensitivity, not layout-related.
