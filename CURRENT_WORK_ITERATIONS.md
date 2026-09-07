# Журнал итераций — Janosik

> **Назначение.** Файл для восстановления контекста после `/compact`: каждый
> шаг работы записывается здесь как итерация со своей целью, задачами,
> выводами (решениями) и результатом. Агент после /compact должен начать
> с чтения этого файла, а не с предположений.
>
> **Правила ведения.** После каждой итерации (по AGENT.md) вносится запись:
> цель → задачи → выводы → что проверено → что дальше. Затем агент
> останавливается и ждёт команду пользователя.

---

## 0. Быстрая справка (факты, которые всегда актуальны)

| Что | Значение |
| --- | --- |
| Стек | React 18, TS strict, Tailwind v4 (CSS-first, `@theme inline`), Vite, shadcn/ui, lucide-react, dnd-kit, i18next, date-fns, react-day-picker |
| Хранилище | localStorage (ключи `janosik-*`; миграция из `vortex-*` только в migrate/тестах миграции) |
| Бренд | Janosik: Space Grotesk (self-hosted, Fontsource), перо «Яношика», живые иконки шапки |
| Дизайн-токены | тёмная `#0a0a0f/#14141e/#1e1e2e/#e8e8f0/#8888a0/#7c3aed/...`; светлая `#f4f5f6/#ffffff/#eaecee/#1a1a24/#5c5c70/#6d28d9/...` |
| Dev-сервер | **порт 5199 строго**: `npx vite --port 5199 --strictPort`. `npm run dev` = 5173 (legacy, не использовать) |
| Проверки | `npm test` (68 тестов), `npx tsc -b --force; echo "TSC_EXIT=$?"` (без пайпа), `npm run build` |
| Тестирование | Vitest + React Testing Library (unit/integration) только. **E2E (Playwright/Cypress) исключено везде** — не планируется, не пишется |
| Git remote | **HTTPS** `https://github.com/VitalyTolstik/janosik.git` (SSH-ключ не зарегистрирован в GitHub — push только HTTPS). Первый коммит: `ec6a5cc` |
| Документы | `AGENT.md` (спека), `ARCHITECTURE_REVIEW.md` (обзор/план), `FEATURES_BACKLOG.md` (бэклог фич) |

---

## 1. Текущее состояние (снимок для восстановления)

- **Все предыдущие итерации (функционал, ребрендинг, иконки, обзоры) завершены** — см. раздел 2, Ит. 0.
- **Сейчас выполняется спринт по фронтенд-части `ARCHITECTURE_REVIEW.md` §6: Шаг 0 («Заземления») → Шаг 1.1 (описание карточки). Бэкенд не планируется, не включается в задачи.**
- Приоритет работ и порядок зафиксированы в `ARCHITECTURE_REVIEW.md` §6 (заземления → фронт по критичности → бэкенд «последним»).

### Открытые todo (все номера в порядке спринта)

| # | Задача | Статус |
| --- | --- | --- |
| 105 | Шаг 0.1: слой персистентности `BoardPersistence` + дебаунс сохранения | ⏳ следующая |
| 106 | Шаг 0.2: undo/redo (HistoryManager, коалесцинг титулов, ⌘/Ctrl+Z, кнопки шапки) | pending |
| 107 | Шаг 0.3: экспорт/импорт JSON + авто-бэкап (IndexedDB) | pending |
| 108 | Шаг 0.4: ErrorBoundary + система тостов | pending |
| 109 | Шаг 1.1: описание карточки (`description?`, patch-update, превью) | pending |
| 110 | i18n: новые ключи en/ru для всех фич спринта | pending |
| 111 | Прогон: тесты, tsc, build, дизайн-проверка, dev-smoke 5199 | pending |
| 112 | **Отложено:** мультидоски + роутер (Шаг 1.2 обзора) | — |
| 113 | **Отложено:** архив + редактирование названия доски (Шаг 1.3) | — |
| 114 | **Отложено:** сроки + чек-листы (Шаг 1.4) | — |

### Карта завершённых компонентов и точек интеграции (для следующих правок)

- **Состояние**: `src/store/BoardContext.tsx` (useReducer, `state[0]`, save после каждого изменения), `src/store/board-reducer.ts` (14 экшенов, чистый), `src/store/migrate.ts` (`normalizeBoards` v1→v2), `src/store/seed-data.ts` (демо-доска).
- **Хранение**: `src/utils/storage.ts` (`loadJSON/saveJSON/migrateStorageKey`, тихий catch → false).
- **Типы**: `src/types/kanban.ts` (`Board`/`Column`/`Card{title,labelIds,createdAt,updatedAt}`/`Label`, `LABEL_COLOR_CHIP/DOT`).
- **UI шапки**: `src/components/Header.tsx` (бренд + фон/язык/тема), `BackgroundSwitcher.tsx`, `LanguageSwitcher.tsx` — сюда же войдут кнопки undo/redo (0.2) и меню данных (0.3).
- **Доска**: `BoardSection.tsx` (заголовок + FilterBar + DndBoard), `board/CardDialog.tsx` (редактирование — сюда поле описания), `board/CardItem.tsx` (превью описания).
- **i18n**: `src/i18n/i18n.ts` (типизация по EN-каталогу), `src/locales/{en,ru}/translation.json`.

---

## 2. Журнал итераций

### Ит. 0 · «База» (закрыто до начала журнала)

- **Цель:** собрать приложение целиком (итерации 1–7 AGENT.md и полировка), провести ребрендинг, добавить живые иконки, выполнить обзор архитектуры, создать бэклог фич, сделать первый коммит.
- **Результат:** 68/68 тестов, tsc 0, build зеленый, dev 200 на 5199. Документы `ARCHITECTURE_REVIEW.md` и `FEATURES_BACKLOG.md` созданы. Коммит `ec6a5cc` запушен на GitHub (HTTPS).
- **Ключевые выводы (зафиксированы):**
  1. **Порядок работ** — сначала «заземления» и фронт, бэкенд после того, как модель устоится. «Сначала бэк» — ловушка: страховка данных дешевле бэкенда; схема без устоявшегося payload выстрелит в молоко; фронт всё равно не мигрирует (слой `fetch` поверх reducer). (см. `ARCHITECTURE_REVIEW.md` §6)
  2. **Embed-снапшот** — только статичная HTML+CSS страница **без React и без JS** (легковесность), iframe + публичная ссылка из БД. (см. `FEATURES_BACKLOG.md` §2)
  3. **Экспорт/импорт JSON + авто-бэкап** — страховка до бэкенда, формат экспорта = будущий seed сервера. (см. `FEATURES_BACKLOG.md` §3)

---

### Ит. 1 · Шаг 0 «Заземления» — планирование (текущая итерация)

- **Цель:** реализовать 4 «заземления» из §6 (пункты Шага 0), затем Шаг 1.1 (описание карточки). Без новых фич сверх списка. Премиальный дизайн сохраняется.
- **Задачи:** todo #105 → #106 → #107 → #108 → #109 → #110 → #111 (в таком порядке; 0.1 — фундамент, 1.1 — видимая победа).
- **Выводы (решения, принятые при планировании):**
  1. **0.1 Персистентность:** ввести интерфейс `BoardPersistence { load/queueFlush }` + адаптер localStorage; дебаунс сохранения 400 мс с гарантированным flush на `beforeunload`; прогон всех мутаций через очередь, а не запись в каждый useEffect. Бэкенд позже = второй адаптер `fetch` к `/api` без изменения reducer/UI.
  2. **0.2 Undo/redo:** менеджер истории `HistoryManager` (past/future, лимит ~50 шагов) поверх чистого reducer; **коалесцинг** подряд идущих `UPDATE_CARD` для одной карточки (чтобы печать не плодила шаги истории); хоткеи ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z (и Ctrl+Y); две кнопки `Undo2`/`Redo2` в шапке справа (тот же стиль, тултипы).
  3. **0.3 Экспорт/импорт + авто-бэкап:** чистые `serializeExport/parseExport` с валидацией и `schemaVersion`; формат = будущий формат seed сервера; авто-бэкап в **IndexedDB** (троттлинг ~60 с, ротация до ~20 снапшотов) + ручные «сохранить копию»; UI — меню «Данные» (DataMenu) справа в шапке.
  4. **0.4 ErrorBoundary + тосты:** ErrorBoundary на уровне App (fallback с логотипом, кнопки Reload/Reset данных), лёгкий ToastProvider (stek, анимации, aria-live); тост при неудачном сохранении (сейчас `saveJSON` молча возвращает false).
  5. **1.1 Описание карточки:** `Card.description?: string` (опционально, не ломает существующие данные); действие `UPDATE_CARD` меняем на **patch** `{title?, description?}` (тесты существующих на title остаются); поле-текст в `CardDialog` + превью в `CardItem`; семпл-описания в seed.
  6. **i18n:** все новые строки — в `src/locales/{en,ru}/translation.json` синхронно (типы выводятся из EN; `tsc` поймает рассинхрон).

### Ит. 1 · Шаг 0 «Заземления» + описание карточки — ВЫПОЛНЕНО

- **Статус:** ✅ завершено (todo #105–#111 все completed).
- **Что сделано:**
  1. **0.1 Персистентность (#105)** — `src/utils/persistence.ts`: интерфейс `DebouncedPersistence<T>` + `createDebouncedLocalStoragePersistence` (debounce 400 мс, `flush()` на beforeunload/pagehide/unmount, error-handler). `BoardContext.tsx` переписан: сохранение через адаптер, а не каждый useEffect.
  2. **0.2 Undo/redo (#106)** — `src/store/history.ts`: `BoardHistory` (лимит 50, коалесцинг подряд идущих `UPDATE_CARD` одного cardId, сброс redo на новое действие). В контексте: обёртка dispatch → history, экшены `RESTORE_BOARD`/`IMPORT_BOARDS` в reducer, хоткеи ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z и Ctrl+Y (пропускаются в input/textarea), кнопки Undo2/Redo2 в `Header.tsx` с disabled-состоянием.
  3. **0.3 Экспорт/импорт + авто-бэкап (#107)** — `src/utils/board-serialization.ts`: стабильный формат-конверт `{app:"janosik", schemaVersion:1, exportedAt, boards}` (будущий seed сервера), валидация + нормализация legacy. `src/utils/backup.ts`: IndexedDB-бэкапы (ротация до 20, метаданные size/createdAt). `src/components/DataMenu.tsx`: меню Данные в шапке (экспорт/импорт JSON + «сохранить копию сейчас» + список бэкапов с restore/delete). Авто-бэкап в контексте (троттлинг 60 с).
  4. **0.4 ErrorBoundary + тосты (#108)** — `src/components/ErrorBoundary.tsx` (fallback с логотипом, кнопки Reload/Reset), `src/components/Toast.tsx` (ToastProvider + useToast c null-safe no-op, анимация в CSS). Тосты при ошибке сохранения/экспорта/импорта/бэкапов. App обёрнут.
  5. **1.1 Описание карточки (#109)** — `Card.description?` в типах; `UPDATE_CARD` → patch `{title?, description?}` (пустая строка = удалить описание); поле в `CardDialog.tsx`; превью с `line-clamp-2` в `CardItem.tsx`; семпл-описания в seed.
  6. **i18n (#110)** — новые ключи en/ru: error.*, undo.*, redo.*, data.*, toast.saveError, card.description*.
- **Проверки:** тесты 68 → **103** (11 файлов; новые: persistence, history, board-serialization, backup с fake-indexeddb, ± reducer RESTORE/patch); `tsc -b --force` = 0; `npm run build` зелёный; dev-server перезапущен на 5199, HTTP 200; pi-lens: блокеров нет, warnings только advisory (`unknown` в type-guard'ах сериализации — осознанно; `history.ts` «large class» на 15 строк — порог занижен). Установлен devDependency `fake-indexeddb`.
- **Баги, найденные и устранённые:** утечка промисов в backup.ts (oncomplete вешался после await → зависание; теперь до запроса); seed-карточка card-1 теперь имеет описание → тест на undefined исправлен на card-2; DataMenu: warning «ref on function component» (Tooltip оборачивал DropdownMenu) → Tooltip перенесён внутрь, оборачивает только Trigger.

---

### Ит. 2 · Шаг 0 «Заземления» — выполнение (дальше)
> ⚠️ Устаревшее содержимое заменено: весь Шаг 0 + 1.1 выполнен в Ит. 1. Дальше спринт продолжается по оставшимся задачам (см. раздел 1).
