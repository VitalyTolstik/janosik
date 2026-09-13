# Janosik — Роадмап и план итераций

> **Единый источник правды по развитию приложения.** Этот файл заменяет
> прежние `ARCHITECTURE_REVIEW.md`, `FEATURES_BACKLOG.md` и
> `CURRENT_WORK_ITERATIONS.md` (они удалены). Любой ИИ-агент начинает работу
> с чтения этого файла и `AGENT.md`.
>
> **Текущий фокус:** фронтенд-функциональность закрыта полностью; активная
> фаза — укрепление фундамента перед бэкендом (§6.0.1, TASK-21.1…21.10),
> затем бэкенд (§7, TASK-22…30). Обновлено: 2026-09.

---

## 0. Как работать с этим файлом (для ИИ-агентов)

1. **Одна задача = одна ветка = один пулл-реквест.** Перед началом итерации
   создай ветку `feature/TASK-{номер}-{slug}`. Пушишь — человек делает ревью
   и мержит сам. **Не мержить свою работу самостоятельно.**
2. **Иди строго по порядку:** порядок фиксирует таблица §6.0 (фронт —
   TASK-21.1…21.10, затем бэк — §7.7, TASK-22…30). Не прыгай через задачи,
   если явно не сказано обратное. Закрытые задачи — в `ROADMAP-DONE.md`
   (справочно, обязательного чтения не требует).
3. **После мержа** — отметь задачу в §6 (включая §6.0.1) как `✅` и при
   необходимости обнови §1 (что сделано). Не переписывай весь файл.
4. **Правила, которые нельзя нарушать:**
   - Репозиторий — monorepo (см. §7.0): `ui/` (фронт), `backend/`,
     `shared/` (общий контракт). Фронтенд-правила действуют для `ui/`.
   - Бэкенд-стек зафиксирован (§7.1): NestJS/Prisma/PostgreSQL/JWT —
     не менять без явного решения пользователя.
   - E2E-тесты (Playwright/Cypress) **исключены** — только Vitest + React Testing Library.
   - Каждая новая строка UI добавляется **синхронно** в `src/locales/en` и `src/locales/ru`.
   - Данные (названия карточек, колонок, досок) **не переводятся** — только UI-хром.
   - Дизайн-токены: не хардкодить цвета — только переменные из `src/index.css`.

---

## 1. Текущее состояние (что уже сделано)

### 1.1. Функции (✅ = реализовано)

| Группа | Возможности |
| --- | --- |
| Доска | одна доска (заголовок отображается, пока не редактируется), горизонтальная лента колонок |
| Колонки | добавление, переименование (двойной клик), удаление с каскадом карточек, drag-перестановка |
| Карточки | inline-композер, живое редактирование заголовка, удаление с подтверждением, перенос drag&drop внутри/между колонками, перенос через меню в диалоге |
| Описание карточки | WYSIWYG MDX-редактор (MDXEditor) в диалоге, живое Markdown-превью на карточке (`line-clamp` + fade) |
| Чек-листы | подзадачи в диалоге карточки (добавление/галочки/переименование/удаление), прогресс-бар и бейдж «2/5» на карточке |
| Сроки | дата+время в диалоге (календарь + вил-пикер часов/минут), бейдж на карточке с датой и временем: просрочено (красный), скоро ≤24 ч (жёлтый); формат времени по локали (ru — 24h, en — 12h AM/PM) |
| Метки | 14 цветов, мульти-выбор, создание/переименование/перекраска/удаление (каскад со всех карточек) |
| Фильтр | поиск по названию, метки (ANY + «без метки»), срок (просрочено/скоро ≤24 ч/без срока), дата создания (сегодня/7/30 дней/точный день); фасеты за кнопкой «Фильтры» с бейджем, хоткеи `/` и `Ctrl/Cmd+K`, счётчик совпадений, DnD выключен при активном фильтре |
| Undo/redo | история 50 шагов с коалесцингом, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, кнопки в шапке |
| Данные | дебаунс-сохранение (400 мс) + flush при закрытии, экспорт/импорт JSON, авто-бэкапы в IndexedDB (ротация 20), ручное «сохранить копию», восстановление/удаление бэкапов |
| Устойчивость | ErrorBoundary (Reload / Reset), toast-уведомления об ошибках сохранения/импорта |
| Оформление | тёмная/светлая темы с префлайтом (без мигания), 4 фона доски (solid/paper/dots/grid), `prefers-reduced-motion`, кастомные скроллбары |
| i18n | en/ru, типобезопасные ключи, плюрализация |
| Бренд | Space Grotesk (self-hosted), анимированный логотип «Перо Яношика», живые иконки шапки |
| Мультидоски | свитчер/создание/переименование/архив/удаление, deep-links `/board/:id`, роутер |
| Активность карточки | лента 8 типов событий, «Активность (n)», лимит 50/карточку (снимет БД — §7.3) |
| Лимиты ввода | `LIMITS` на 14 полях + коллекциях, счётчики «осталось N», тултипы/тосты гвардов |

### 1.2. Архитектура (кратко)

- **Модель** — `Board { columns[], cards: Record<string,Card>, labels[] }`,
  `Card { id, title, description?, checklists?, labelIds[], dueDate?, cover?,
  archivedAt?, createdAt, updatedAt }` (`Checklist { id, title, items:
  [{id, text, done}] }`). Архивная карточка (TASK-18.1) остаётся в `cards`
  с `archivedAt`, но вынимается из `column.cardIds` — восстановление
  возвращает её в конец выбранной колонки с учётом WIP-лимита.
  Нормализовано: перестановка = перестановка id-массивов. `Board[]` на
  верхнем уровне — мультидоски (свитчер, `/board/:id`).
  Активность карточки — 10 типов событий (включая `archived`/`unarchived`),
  лимит 50/карточку снимет БД (§7.3).
- **Состояние** — чистый `boardReducer` (35+ экшенов) + `BoardContext` (дебаунс-персистентность, история, хоткеи, авто-бэкап). Компоненты вызывают типизированные удобные экшены.
- **Персистентность** — интерфейс `DebouncedPersistence` поверх `localStorage`; позже бэкенд = второй адаптер `fetch` **без изменения reducer и UI**.
- **UI** — shadcn/ui + Radix (dialog/dropdown/popover/tooltip/slot), dnd-kit, react-day-picker, MDXEditor (описание карточки); виды доски: канбан / календарь / таблица (TASK-14/14.1).
- **Тесты** — 362 теста в 29 файлах (reducer, history, persistence, serialization, backup, backup-timestamp, dnd, filter, storage, migrate, i18n, pwa, editor-import, интеграционные BoardSection + CardDialog + свитчер).

### 1.3. Ключи и точки интеграции

- Состояние/редьюсер: `src/store/BoardContext.tsx`, `src/store/board-reducer.ts`, `src/store/history.ts`.
- Модель: `src/types/kanban.ts` (туда добавлять новые поля карточки).
- Персистентность/данные: `src/utils/persistence.ts`, `src/utils/backup.ts`, `src/utils/board-serialization.ts`, `src/utils/storage.ts`.
- Миграции/сид: `src/store/migrate.ts`, `src/store/seed-data.ts`.
- Карточка UI: `src/components/board/CardItem.tsx`, `CardDialog.tsx`, `CardComposer.tsx`.
- Описание карточки (MDXEditor): `src/components/editor/DescriptionEditor.tsx`,
  `plugins.tsx`, `janosik-icons.tsx`, `editor-i18n.ts`.
- Шапка: `src/components/Header.tsx` (+ `DataMenu.tsx`, `BackgroundSwitcher.tsx`, `LanguageSwitcher.tsx`).
- i18n: `src/locales/{en,ru}/translation.json`, типы из EN в `src/i18n/i18n.ts`.
- Токены: `src/index.css` (`:root`/`.light`, `@theme inline`).

---

## 4. Идеи и приоритеты (бэклог)

Легенда: 🔴 критично · 🟠 высокий · 🟡 средний · 🟢 низкий · ⚪ на будущее.

**🔴 Запрошено пользователем (приоритет №1):**

1. **Rich-редактор карточки** — реализовано: WYSIWYG-редактор MDXEditor с тулбаром вместо ручного Markdown (TASK-1 + TASK-2).
2. **Чек-листы (todo-списки)** — реализовано: подзадачи с прогрессом «2/5» на карточке. (TASK-3)

**🟠 Классика канбана (быстрые победы):**

1. **Сроки (due dates)** — дата/время, подсветка просроченного (красный) и «скоро» (жёлтый). (TASK-4)
2. **Обложка/цвет карточки** — визуальное различие карточек. (TASK-5)
3. **Дублирование карточки/колонки**. (TASK-6)

**🟡 Управление досками:**

1. **Мультидоски + роутер** — реализовано: список/создание/переключение/удаление досок, deep-links `/board/:id`, back/forward; единый заголовок в хедере. (TASK-7)
2. **Переименование + архив доски** — реализовано: rename в TASK-7, архив с восстановлением (Trello close-board). (TASK-8)

**🟢 Power-user / полировка:**

1. ~~Сортировка внутри колонки~~ — реализовано (TASK-9) · ~~расширенный поиск~~ — реализовано (TASK-10) · ~~палитра хоткеев~~ — реализовано (TASK-11) · ~~лента активности~~ — реализовано (TASK-12) · ~~WIP-лимиты~~ — реализовано (TASK-13) · ~~календарный вид~~ — реализовано (TASK-14: календарь + таблица) · ~~PWA/офлайн~~ — реализовано (TASK-15).
2. ~~Полировка и производительность~~ — реализовано: фильтр меток ANY/ALL (TASK-16) · тумблер 12h/24h (TASK-17) · тихий `updatedAt` (TASK-18) · код-сплит бандла (TASK-19) · лимиты полей ввода и коллекций (TASK-20). Порядок всей добивки и старта бэкенда зафиксирован в **§6.0**.

**⚪ На будущее (разблокируется бэкендом, §7.6):** автоматизации, уведомления, вложения, встраиваемый снапшот доски (embed), рабочие пространства.

---

## 5. Нумерация задач и веток

Формат ветки: **`feature/TASK-{номер}-{slug}`**. Номер и slug берутся из §6.
Пример: `feature/TASK-3-card-checklists`.

---

## 6. План итераций (мелкие шаги, по порядку)

Каждая задача — отдельная ветка и отдельный PR. Внутри блока: цель, что трогаем,
критерий готовности (DoD), зависимости.

### 6.0. Порядок выполнения (актуально)

Номера задач **не перенумеровываем** (ветки/история ссылаются на них);
порядок добивки перед бэкендом:

| Шаг | TASK | Почему здесь |
| --- | --- | --- |
| 1 | TASK-21 `editor-import-bug` | ✅ реализовано — баг данных: описание сид-карточки не сохранялось вообще |
| 2 | TASK-13 `wip-limits` | ✅ реализовано — лимит, счётчик, блокировки, тост |
| 3 | TASK-14 `views` (календарь + таблица) | ✅ реализовано, PR #25 смержен — переключатель, оба вида, диалог из любого вида |
| 4 | TASK-16 `label-filter-any-all` | мелкая добивка фильтра |
| 5 | TASK-17 `time-format-toggle` | мелкая |
| 6 | TASK-18 `quiet-updated-at` | мелкая; чистит timestamps перед бэкенд-миграцией |
| 7 | TASK-14.1 `views-v2` | ✅ реализовано, PR #26 смержен — интерактивные календарь (drag-сроки, «Без срока», неделя/месяц, панель дня) и таблица (сортировка, инлайн-редактирование, настройки колонок) |
| 8 | TASK-19 `bundle-split` | ✅ реализовано, PR #34 смержен — критический путь 1539→503 KB raw, FCP 344→212 мс |
| 9 | TASK-15 `pwa-offline` | ✅ реализовано, PR #35 смержен — манифест, иконки, SW поверх финального бандла |
| 10 | TASK-33 `undo-history-fix` | ✅ реализовано, PR #36 — точные снапшоты истории при нескольких dispatch в одном тике |
| 11 | TASK-34 `lazy-views` | ✅ реализовано, PR #37 — календарь/таблица снова lazy, motion-чанк; критический путь ~932→~654 KB raw (фактически ~768 — motion-иконки шапки остались на критическом пути, снимает TASK-21.6/21.9) |
| 12 | TASK-21.1 `ci-lint` | укрепление фундамента — см. §6.0.1 |
| 13 | TASK-21.2 `data-safety` | защита данных от потери — см. §6.0.1 |
| 14 | TASK-21.3 `sw-fixes` | две строки в service worker — см. §6.0.1 |
| 15 | TASK-21.4 `context-split` | рендер-производительность — см. §6.0.1 |
| 16 | TASK-21.5 `limits-rebalance` | честные лимиты localStorage — см. §6.0.1 |
| 17 | TASK-21.6 `i18n-lazy` | ленивые локали — см. §6.0.1 |
| 18 | TASK-21.7a `deterministic-actions` | детерминизм редьюсера: `createId()`/`Date.now()` → в payload экшена (корень всех инверсий) — см. §6.0.1 |
| 19 | TASK-21.7b `invertible-actions` | 8 структурных правок обратимости экшенов (id в `ADD_*`, `TOGGLE_*`→`SET_*`, `fromIndex`, порядок колонки) — см. §6.0.1 |
| 20 | TASK-21.7c `restore-actions` | `RESTORE_*` для разрушающих экшенов — см. §6.0.1 |
| 21 | TASK-21.7d `inverse-history` | `invert()` + property-тест + `BoardHistory` на парах `{do, undo}` — см. §6.0.1 |
| 22 | TASK-21.8 `browser-router` | HashRouter → BrowserRouter до лендинга — см. §6.0.1 |
| 23 | TASK-21.9 `motion-lazy` | анимированные иконки шапки — лениво после загрузки (решено: вариант Б) — см. §6.0.1 |
| 24 | TASK-21.10 `touch-dnd` | тач-DnD доски: TouchSensor dnd-kit (переехал из TASK-31; тач-слой календаря/таблицы остаётся в TASK-31) — см. §6.0.1 |
| — | TASK-22…30 | бэкенд (§7.7) — старт после TASK-21.10 |
| — | TASK-31 `mobile-ux` | мобильная адаптация: **тач-слой для календаря/таблицы** (нативный HTML5 DnD на тачах не работает; тач-DnD доски — TASK-21.10), адаптив шапки/фильтров/диалогов; после бэкенда |
| — | TASK-32 `landing-intro` | презентационная страница для неавторизованных + маршрут «войти/создать аккаунт»; после TASK-29/30 (нужен auth) |

### 6.0.1. Укрепление фундамента перед бэкендом (TASK-21.1…21.10)

Одна задача = одна ветка = один PR, порядок — как в таблице §6.0.

#### TASK-21.1 — `ci-lint` · CI + ESLint + Prettier + бюджет бандла

- **Что:** GitHub Actions (`npm ci`, `tsc -b --force`, `npm test`, `npm run build`,
  `size-limit` с бюджетом на критический путь ≤260 KB gzip); ESLint +
  `typescript-eslint` + `eslint-plugin-react-hooks` (поймает `exhaustive-deps` —
  их в проекте 5 `eslint-disable`-комментариев при отсутствии самого линтера);
  Prettier (форматирование дрейфует: в `storage.ts` отступ 3 пробела, везде 2);
  `pool: 'vmThreads'` в `vitest.config.ts` — jsdom поднимается 1 раз вместо 30.
- **Почему до TASK-22:** в монорепе с двумя пакетами и разными tsconfig
  настраивать вдвое дороже; CI страхует все следующие PR.
- **DoD:** CI зелёный на main; lint проходит (или все нарушения закрыты);
  прогон тестов ускорился.

#### TASK-21.2 — `data-safety` · Защита от потери данных

- **Что:**
  - переполнение квоты: вместо исчезающего тоста — незакрываемый баннер
    «Данные не сохраняются» + кнопка «Скачать резервную копию» (экспорт уже
    есть в `DataMenu`/`backup.ts`);
  - битый JSON в localStorage: различать «ключа нет» и «ключ не парсится» —
    карантин (`janosik-boards.corrupt.<ts>`) + тост «копия сохранена», дебаунс-сейв
    не затирает данные сидом;
  - «Сбросить» в `ErrorBoundary`: ConfirmDialog + автоэкспорт JSON перед
    сбросом; текст fallback захардкоден на EN (если упал i18n — fallback
    не должен падать вместе с ним);
  - связка сценария: проблема с данными → баннер → «восстановить из копии».
- **DoD:** провальную запись / битый JSON / крэш-сценарий невозможно потерять
  данные молча; тесты на карантин и баннер.

#### TASK-21.3 — `sw-fixes` · Две строки в service worker

- **Что:** `response.ok` перед `cache.put` app shell (сейчас 500/404 кэшируются
  как app shell навсегда); `CACHE_VERSION` от хеша сборки (плагин Vite) — иначе
  `activate` никогда не чистит `/assets/*` прошлых деплоев.
- **DoD:** офлайн-загрузка не попадает в ошибочный ответ; старые кэши
  удаляются после деплоя.

#### TASK-21.4 — `context-split` · Рендер-производительность

- **Что:**
  - `BoardContext` → два контекста: `BoardStateContext` (стейт) и
    `BoardActionsContext` (`dispatch` + ~30 экшенов, собранных один раз в
    `useMemo(..., [])` — стабильны навсегда); `Header` подписывается только
    на actions + узкий селектор `canUndo/canRedo`;
  - `memo` на `CardItem`/`SortableCard` (стабилизировать `labels` — сейчас
    `.map()` даёт новый массив на каждый рендер — и `onCardClick`);
  - ротация бэкапов через `getAllKeys()` вместо `getAll()` (не материализовать
    все снапшоты ради удаления старых) + trailing-вызов троттла авто-бэкапа.
- **Почему сейчас:** без memo каждое нажатие клавиши перерисовывает всю доску
  (O(n) гарантированно, бенчмарк не нужен); монорепа и sync-слой будут
  разносить именно эту структуру контекста. Виртуализация — только при
  доказанной боли (конфликтует с dnd-kit).
- **DoD:** правка текста карточки не перерисовывает шапку и чужие карточки
  (проверка React Profiler-ом); тесты зелёные.

#### TASK-21.5 — `limits-rebalance` · Калибровка LIMITS

- **Что:** текущие лимиты допускают 10 000 карточек/доску (~10–106 MB JSON)
  при квоте localStorage ~5 MB. Калибровка: `cardsPerColumn 500→200`,
  `description 10000→5000`, `boardsCount 50→10` (цифры согласовать) +
  превентивное предупреждение при >80 % квоты (замер `JSON.stringify` перед
  записью).
- **DoD:** максимальные данные по LIMITS помещаются в квоту; предупреждение
  срабатывает заранее.

#### TASK-21.6 — `i18n-lazy` · Ленивые локали

- **Что:** динамический импорт каталога `./locales/${lang}/translation.json`
  вместо статических en+ru в бандле; типобезопасность ключей сохраняется
  (`import type` от EN-каталога, рантайм — динамический).
- **Эффект:** −10–15 KB gzip с критического пути, дальше — на каждый новый язык.
- **DoD:** переключение языков работает (в т.ч. оффлайн-первая загрузка —
  дефолтная локаль в бандле); тесты i18n зелёные.

#### TASK-21.7 — `history-inverse` · Undo на инверсных экшенах — разбита на 4 PR

Одним PR это неревьюабельный ком: рефакторинг ~25 мест редьюсера + смена
сигнатур 8 экшенов + 5 новых экшенов + переписывание `history.ts` + 135 строк
`history.test.ts`. Разбивка по зависимостям (полный разбор — в `WARNING.md`).

#### TASK-21.7a — `deterministic-actions` · Детерминизм редьюсера (корень)

- **Зачем:** сейчас `createId()` вызывается внутри редьюсера 9 раз и
  `Date.now()` — 16 раз (включая `appendActivity`/`createdActivity` —
  недетерминированы **все** экшены, даже `RENAME_COLUMN`). Из этого следует:
  инверсию вычислить нельзя (`ADD_CARD` не несёт `cardId`), ретрай порождает
  дубликат, сервер не может воспроизвести операцию тем же редьюсером,
  property-тест обратимости невозможен. Это предусловие §7.0 «id генерирует
  клиент» — код сейчас его не обеспечивает.
- **Что:** `id` и время генерирует **вызывающая сторона** (action creator в
  `createBoardActions`) и кладёт в payload: `cardId`, `activityId`, `at` и т.д.
  Для `DUPLICATE_COLUMN` — пачка `newColumnId` + `newCardIds[]`.
- **Трогаем:** `board-reducer.ts` (9+16 мест), `BoardContext.tsx`, тесты
  редьюсера (правка ожиданий — да, логики — нет).
- **DoD:** `grep -c "createId()\|Date.now()" src/store/board-reducer.ts` → **0**;
  все id/timestamps в payload, включая id событий активности; тесты зелёные;
  правило детерминизма записано в `AGENT.md` («экшен полностью сериализуем;
  редьюсер не вызывает `createId()`/`Date.now()`/`Math.random()` и не читает
  `localStorage`»).
- **Зависимости:** нет. Начинать отсюда.

#### TASK-21.7b — `invertible-actions` · Обратимость структурой экшена

- **Зачем:** 8 экшенов структурно необратимы: `ADD_*` не несут id создаваемого;
  `TOGGLE_CARD_LABEL`/`TOGGLE_CHECKLIST_ITEM` относительны — toggle
  самообратен только пока никто не влез (вдвоём — гонка); `MOVE_CARD` несёт
  `fromColumnId`, но не `fromIndex`; `SORT_COLUMN` необратим по природе.
- **Что (8 правок):** `ADD_COLUMN`/`ADD_CARD`/`ADD_CHECKLIST`/
  `ADD_CHECKLIST_ITEM` + id в payload; `DUPLICATE_*` + id копий;
  `TOGGLE_CARD_LABEL` → `SET_CARD_LABEL {on}` (абсолютное значение);
  `TOGGLE_CHECKLIST_ITEM` → `SET_CHECKLIST_ITEM_DONE {done}`;
  `MOVE_CARD` + `fromIndex`; новый `SET_COLUMN_CARD_ORDER {columnId, cardIds}`
  (инверсия `SORT_COLUMN`). Попутно лечится скрытый баг §3.2 WARNING:
  `UNARCHIVE_CARD` кладёт карточку в конец колонки — после перехода на
  инверсии терялась бы позиция → `UNARCHIVE_CARD` умеет `index`.
- **Трогаем:** `board-reducer.ts`, `BoardContext.tsx`, `types/kanban.ts`,
  UI-вызовы экшенов, тесты.
- **DoD:** все 8 правок сделаны; тесты зелёные.
- **Зависимости:** TASK-21.7a.

#### TASK-21.7c — `restore-actions` · Обратимость разрушающих операций

- **Зачем:** `DELETE_CARD/COLUMN/LABEL/CHECKLIST/CHECKLIST_ITEM` необратимы
  без захвата удаляемых данных (до 500 карточек в инверсии колонки).
- **Что:** экшены `RESTORE_CARD`, `RESTORE_COLUMN`, `RESTORE_LABEL`,
  `RESTORE_CHECKLIST`, `RESTORE_CHECKLIST_ITEM` — с полным payload и позицией
  (это фронтовый фундамент; на сервере то же накроется soft-delete §7.3 —
  инверсия выродится в снятие `deletedAt`).
- **DoD:** удаление → восстановление возвращает доску в прежнее состояние
  (включая позиции); восстановление уважает `LIMITS` и WIP; тесты зелёные.
- **Зависимости:** TASK-21.7b.

#### TASK-21.7d — `inverse-history` · История на инверсиях (+ хук)

- **Зачем:** `BoardHistory` хранит `past: Board[]` — до 50 полных снапшотов
  (~23 MB/доску в памяти) — и undo делает `RESTORE_BOARD` целой доски:
  в совместном режиме это затирает чужие правки (Аня откатывает свою правку —
  исчезает правка Бориса). Undo должен быть **компенсацией** (selective undo,
  как в Figma/Linear), а не перемоткой состояния.
- **Что:** новый `src/store/invert.ts` — `invert(before, action): BoardAction | null`
  (инверсия считается в момент dispatch, `never`-проверка полноты union'а —
  новый экшен без инверсии не компилируется); `history.ts` на парах
  `{do, undo}`; undo-стек содержит **только собственные** команды (чужие SSE —
  никогда; пометка `dead` при чужом изменении затронутой сущности — задел,
  полная семантика в TASK-29/30); коалесцинг сохраняется (склейка
  `UPDATE_CARD` держит самое старое «до» и самое свежее «после»); сюда же —
  извлечение истории в хук из `BoardContext` (§7.5 «Подготовка» — один проход
  по одному файлу, разными PR делать двойную работу).
- **DoD:** property-тест обратимости зелёный для **каждого** экшена
  (`boardReducer(boardReducer(before, a), invert(before, a)) === before` —
  возможен только благодаря 21.7a); `BoardHistory` не хранит ни одного
  объекта `Board`; `RESTORE_BOARD` убран из пути undo (остаётся только в
  `BackupDialog` — явное действие пользователя); коалесцинг работает;
  потребление памяти историей — килобайты; тесты истории переписаны и
  зелёные.
- **Зависимости:** TASK-21.7c.
- **⚠️ Не входит сюда:** политика конфликтов undo («чужая правка текста →
  отказ с тостом») требует `version`/SSE с сервера — реализуется в TASK-29/30.

#### TASK-21.10 — `touch-dnd` · Тач-DnD доски

- **Зачем:** приложение приглашает установить себя на телефон (PWA-манифест,
  TASK-15), а перетаскивание на тачах не работает вовсе. Это сломанная фича,
  а не адаптация.
- **Что:** `TouchSensor` (или `PointerSensor`) от dnd-kit для доски — часы
  работы. Тач-слой для календаря/таблицы остаётся в TASK-31 (после бэкенда).
- **DoD:** перетаскивание карточек/колонок работает на тач-эмуляторе;
  фоллбэк мышью не сломан.

#### TASK-21.8 — `browser-router` · HashRouter → BrowserRouter

- **Что:** замена роутера (SW уже делает SPA-fallback network-first на `/` —
  переход почти бесплатный, нужен только конфиг хостинга) + мелочи:
  `navigator.platform` → `userAgentData?.platform` fallback.
- **Почему до TASK-32:** хеш-URL мешают лендингу, OAuth-редиректам бэкенда,
  аналитике и embed-снапшоту.
- **DoD:** deep-links `/board/:id` и `?card=` работают после прямого захода
  по URL; деплой-конфиг обновлён.

#### TASK-21.9 — `motion-lazy` · Анимированные иконки вне критического пути (решено)

- **Решение пользователя:** вариант Б — motion остаётся, анимированные иконки
  шапки грузятся лениво после `requestIdleCallback`; статичные `lucide-react`
  иконки на первом рендере.
- **Что:** обёртка `LazyAnimatedIcon` (React.lazy + Suspense со статичной
  иконкой как fallback), хедер импортирует только её; motion-чанк исключается
  из `modulepreload`.
- **Эффект:** −40 KB gzip с критического пути (~768→~643 KB raw); бренд без
  изменений; минус — короткая подмена иконки при первом рендере.
- **DoD:** motion-чанка нет в `modulepreload` `dist/index.html`; иконки
  анимируются после idle; size-limit бюджет обновлён.

#### Решённые вопросы

1. **API: командный лог (вариант Б) — решено пользователем 2026-09.**
   Мутации — `POST /boards/:id/commands {commandId, action, ifMatch?}`,
   сервер применяет тот же `boardReducer` из `shared/` (3 мутационных
   endpoint'а вместо ~35); порядок через `seq`, идемпотентность через
   `commandId`, SSE шлёт те же экшены, undo = инверсная команда, лог команд
   = активность. Для PAT (§7.6) позже тонкий REST-фасад. §7.0/§7.2/§7.4/§7.5/
   §7.7 переписаны под это решение. Дедлайн «до TASK-23» выполнен с запасом.

### 6.0.2. Закрытые задачи — архив в `ROADMAP-DONE.md`

Полные описания реализованных задач TASK-1…21 (Фазы A/B/C+: редактор,
чек-листы, сроки, обложки, дублирование, мультидоски, сортировка, поиск,
хоткеи, активность, WIP, виды, PWA, добивка, лимиты ввода) вынесены в
**`ROADMAP-DONE.md`** — с решениями, «что сделано» и уроками. Статус и
порядок — в таблице §6.0. Номера задач не переиспользуются.

---

## 7. Бэкенд — полный план (фаза активна)

> Решение пользователя: **совместные доски** (много юзеров, логины, шаринг,
> видно кто что сделал) → бэкенд проектируется **нормализованным**: сущности
> в таблицах, мутации — командным логом (§7.0, решено 2026-09 — вариант Б),
> фронт работает optimistic поверх редьюсера.
> Старт бэкенда — **после** TASK-21.1…21.10 (порядок §6.0). Далее §7.7:
> TASK-22 → 30.

### 7.0. Ключевые решения (зафиксированы, не пересматривать без явной причины)

- **Monorepo, npm workspaces**: `ui/` (фронт), `backend/` (NestJS),
  `shared/` (`@janosik/shared` без build-степа): модель, `LIMITS`, envelope
  экспорта, `STORAGE_KEYS`, **DTO-типы API** (контракт фронт↔бэк).
- **Нормализованная схема** — «полный канбан на бэке»: колонки/карточки/
  метки/чеклисты/активность/комментарии — SQL-таблицы (§7.3), не Json-документ.
  Позиции — целочисленные `position` (drag → `reorder` endpoint с перенумерацией
  при необходимости).
- **API — командный лог (решение пользователя 2026-09 — вариант Б, §6.0.1):**
  мутации едут одним транспортом — `POST /boards/:id/commands
  {commandId, action, ifMatch?}`; сервер применяет **тот же `boardReducer`
  из `shared/`** и пишет команду в лог (Command, §7.3). `commandId`
  (клиентский uuid) — первичный ключ → идемпотентные ретраи; `seq`
  (монотонный) — порядок операций и версия доски; несовпадение `ifMatch` →
  `409 {conflict, currentVersion}`. Чтение — обычный REST (§7.4): агрегат,
  members, activity-ленты, import/export. SSE шлёт те же
  `{seq, action, actorId}` — чужие изменения применяются тем же редьюсером
  (TASK-30). Undo — инверсная команда из стора (TASK-21.7d); сервер не
  знает, что это отмена. Для PAT/интеграций (§7.6) позже тонкий REST-фасад
  поверх тех же команд.
- **Фронт — optimistic без переписывания UI**: редьюсер остаётся
  единственным источником UI-состояния (мгновенный отклик, undo/redo
  работают). Адаптер шлёт команду асинхронно и **reconcile**-ит canonical
  ответ (позиции, версии). Провал вызова → откат экшена (инверсия) + тост.
  **id генерирует клиент** (TASK-21.7a) и едет в команде → идемпотентные
  ретраи, undo создания = инверсная команда с тем же id.
  **Предусловие — TASK-21.7a/b:** сейчас id/время генерируются **внутри**
  редьюсера (9× `createId()`, 16× `Date.now()`) и экшен id не несёт; до
  бэкенда редьюсер делается детерминированным, id создаваемых сущностей —
  в payload.
- **Доступ — membership с ролями (решение пользователя 2026-09):**
  `BoardMember {board, user, role: ADMIN|MEMBER|VIEWER, expiresAt?}`.
  Создатель доски — первый ADMIN. **ADMIN** — управление доской (роли
  участников, архив/удаление, invite); **MEMBER** («клиент») — создавать/
  редактировать/архивировать карточки; **VIEWER** — только чтение,
  опционально **с ограничением по времени** (`expiresAt` — протух → guard
  отдаёт 403, запись чистится лениво). Отдельно **супер-админ системы**
  (`User.isSuperAdmin`, первый зарегистрированный): видит и управляет
  всеми досками/юзерами. Guard проверяет роль на каждом board-scoped
  endpoint; `actorId` во всей активности — реальный юзер.
- **API-токены (после ядра, §7.6):** персональные токены «вместо пароля»
  для скриптов/интеграций — действуют от имени своего юзера (его роли),
  в БД только hash, показ один раз, ревокация и `lastUsedAt`; супер-админ
  может выпускать/отзывать токены юзеров.
- **Синхронизация мульти-юзеров:** MVP — refetch агрегата доски при focus
  окна; затем **SSE** (`GET /boards/:id/events`) в TASK-30 — живые изменения
  чужих курсоров/карточек. WebRTC/CRDT не нужны (разрешение конфликтов —
  last-write-wins на уровне сущности + активность).
  **Исключение из LWW — undo:** undo текстовых полей (`title`, `description`,
  `name`) при чужой правке после моей — **отказ с тостом** «изменил другой
  участник» (undo, молча затирающий чужой текст, хуже отсутствия undo);
  позиционные изменения (`MOVE_*`, `SORT_*`, порядок) — применяются (LWW).
  Политика конфликтов undo реализуется в TASK-29/30.
- **Auth:** JWT access (15 мин, память SPA) + refresh (30 дней, httpOnly
  Secure SameSite=Strict, ротация с детектом реюза). Пароли — argon2id.
  На auth-роутах — rate-limit (brute force), helmet, CORS-allowlist.
- **Архив карточек (TASK-18.1) — часть контракта:** `GET /boards/:id`
  отдаёт колонки с **только активными** `cardIds`; архивная карточка живёт
  в cards-мапе агрегата с `archivedAt` (фронт уже так хранит). Архив /
  unarchive (с выбором колонки и WIP-проверкой) и массовый архив колонки —
  команды редьюсера (`ARCHIVE_CARD`, `UNARCHIVE_CARD`, `ARCHIVE_COLUMN_CARDS`).
- **Undo/redo остаётся клиентским** — инверсии экшенов считаются во
  **фронтовом сторе** (`src/store/invert.ts`, TASK-21.7d), а не в адаптере:
  адаптер только отправляет инверсную команду как обычный вызов. Серверные
  генерации id нет: дубликат карточки/колонки получает **клиентский id
  копии** в POST — идемпотентно и undo-совместимо. Сервер не знает и не
  должен знать, что вызов был отменой.
- **SSE-auth:** `EventSource` не умеет заголовки → SSE-подключение по
  **одноразовому ticket** (`POST /boards/:id/events-ticket` → short-lived
  token в query) или по refresh-cookie; access-token в query не светим.
- **Масштабирование:** MVP — одна нода, in-memory fan-out SSE. Redis
  pub/sub — при второй ноде (за пределами MVP, точка подключения —
  интерфейс event-броадкаста в TASK-30).
- **Валидация — `LIMITS`** (TASK-20) на DTO + серверный normalize — тот же
  код, что `migrate.ts`. Импорт клампит всё, что пришло мимо UI.
  **Нюанс:** `migrate.ts` клампит молча — на API так нельзя. Два режима
  одной функции из shared: `normalize()` (импорт/миграции, снисходительный)
  и `validate()` (API, строгий — не режет, а отклоняет `400` с полем).
- **Ошибки:** дефолтный envelope NestJS; `403` — нет membership, `409` —
  конфликт позиций/версии, `404` — чужая сущность (не раскрываем существование).
- **Удаления — мягкие (`deletedAt`) и с версиями (до TASK-25):** все
  сущности удаляются проставлением `deletedAt` (каскад — флаг у детей, не
  физическое `onDelete: Cascade`); физическая чистка — отложенным job'ом
  через N дней. Это же делает undo разрушающих операций дешёвым (инверсия —
  снятие флага, §6.0.1 TASK-21.7c) и даёт «Корзину» как задел. На
  `Card`/`Column`/`Label` — `version Int` (инкремент при записи), проверка
  `ifMatch` → `409` — основа политики конфликтов undo (§7.0 выше).
  Вносится в схему §7.3 и миграции **TASK-25 сразу** — иначе отдельная
  миграция и переписывание всех каскадов.

### 7.1. Стек

| Слой | Выбор | Почему |
| --- | --- | --- |
| Framework | NestJS 11 | DI, модули, ValidationPipe, Jest+supertest из коробки |
| БД / ORM | PostgreSQL 16 + Prisma | реляционные сущности + миграции; каскады на уровне БД |
| Realtime | SSE (нативно в Nest) | однонаправленный поток достаточен; WebSocket — только если появится присутствие |
| Auth | @nestjs/jwt + argon2 | access + refresh с ротацией |
| Валидация | class-validator | DTO едят `LIMITS`/DTO-типы из shared |
| Тесты | Jest + supertest (тестовая БД) | e2e на каждый endpoint |

### 7.2. Структура `backend/`

```
backend/
├── prisma/                  # schema.prisma + migrations/
├── src/
│   ├── main.ts / app.module.ts
│   ├── auth/                # register/login/refresh/logout/me, jwt-strategy, guards
│   ├── users/               # профиль
│   ├── boards/              # CRUD + members (invite/role) + агрегат + import/export
│   ├── commands/            # POST /commands: validate → boardReducer(shared) → лог+таблицы; догон ?since=
│   ├── activity/            # ленты (доска/карточка) поверх Command-лога, курсорная пагинация
│   ├── comments/            # комментарии
│   └── common/              # MembershipGuard, exception-фильтры, normalize/validate (shared)
├── test/                    # e2e supertest
└── docker-compose.yml       # postgres:16
```

### 7.3. База данных (Prisma)

```prisma
model User {
  id            String         @id @default(cuid())
  email         String         @unique
  passwordHash  String
  displayName   String?
  isSuperAdmin  Boolean        @default(false)   // первый юзер; управление системой
  createdAt     DateTime       @default(now())
  memberships   BoardMember[]
  activity      Activity[]
  comments      Comment[]
  apiTokens     ApiToken[]
  commands      Command[]
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id        String    @id @default(cuid())
  tokenHash String    @unique
  user      User      @relation(fields: [userId], references: [id])
  userId    String
  expiresAt DateTime
  revokedAt DateTime?              // ротация; реюз revoked → отзыв всех сессий
}

model Board {
  id         String       @id @default(cuid())
  title      String       @db.VarChar(100)   // LIMITS.boardTitle
  archivedAt DateTime?
  deletedAt  DateTime?                       // soft-delete (§7.0)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
  members    BoardMember[]
  columns    Column[]
  cards      Card[]
  labels     Label[]
  activity   Activity[]
  commands   Command[]
}

model BoardMember {
  id        String    @id @default(cuid())
  board     Board     @relation(fields: [boardId], references: [id])
  boardId   String
  user      User      @relation(fields: [userId], references: [id])
  userId    String
  role      Role      @default(MEMBER)    // ADMIN | MEMBER | VIEWER
  expiresAt DateTime?                     // VIEWER на срок; протух → 403
  createdAt DateTime  @default(now())
  @@unique([boardId, userId])
  @@index([userId])                       // «мои доски»
}

enum Role { ADMIN MEMBER VIEWER }

model ApiToken {                          // после ядра (§7.6), схема сразу
  id          String    @id @default(cuid())
  user        User      @relation(fields: [userId], references: [id])
  userId      String
  name        String                          // «CI», «интеграция …»
  tokenHash   String    @unique               // показ один раз, храним hash
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  @@index([userId])
}

model Command {                           // командный лог (§7.0, решение 2026-09)
  id        String   @id                 // = клиентский commandId → идемпотентность
  board     Board    @relation(fields: [boardId], references: [id])
  boardId   String
  actor     User     @relation(fields: [actorId], references: [id])
  actorId   String
  seq       BigInt   @default(autoincrement()) // монотонная версия доски; догон ?since=
  type      String                         // тип BoardAction
  payload   Json                           // экшен целиком (детерминирован — TASK-21.7a)
  createdAt DateTime @default(now())
  @@index([boardId, seq])
}

model Column {
  id        String   @id               // id от клиента
  board     Board    @relation(fields: [boardId], references: [id])
  boardId   String
  title     String   @db.VarChar(100)
  wipLimit  Int?                           // TASK-13
  position  Int
  deletedAt DateTime?                      // soft-delete (§7.0)
  version   Int      @default(0)           // ifMatch → 409 (§7.0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  cards     Card[]
  @@index([boardId, position])
}

model Card {
  id          String    @id
  column      Column    @relation(fields: [columnId], references: [id])
  columnId    String
  title       String    @db.VarChar(300) // LIMITS.cardTitle
  description String?   @db.Text         // markdown, LIMITS.description
  coverType   String?                    // color | gradient
  coverValue  String?
  dueDate     DateTime?
  archivedAt  DateTime?                  // TASK-18.1: архив карточки
  deletedAt   DateTime?                  // soft-delete (§7.0)
  version     Int       @default(0)      // ifMatch → 409 (§7.0)
  position    Int
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  labels      CardLabel[]
  checklists  Checklist[]
  activity    Activity[]
  comments    Comment[]
  @@index([columnId, position])
}

model Label {
  id        String  @id
  board     Board   @relation(fields: [boardId], references: [id])
  boardId   String
  name      String  @db.VarChar(50)        // LIMITS.labelName
  color     String                          // из палитры 14
  deletedAt DateTime?                       // soft-delete (§7.0)
  version   Int     @default(0)             // ifMatch → 409 (§7.0)
  cards     CardLabel[]
  @@index([boardId])
}

model CardLabel {                         // m2m, порядок сохраняем
  card     Card    @relation(fields: [cardId], references: [id])
  cardId   String
  label    Label   @relation(fields: [labelId], references: [id])
  labelId  String
  position Int     @default(0)
  @@id([cardId, labelId])
  @@index([labelId])                      // каскад-удаление метки
}

model Checklist {
  id     String           @id
  card   Card             @relation(fields: [cardId], references: [id])
  cardId String
  title  String           @db.VarChar(100)
  position Int
  deletedAt DateTime?                     // soft-delete (§7.0)
  items  ChecklistItem[]
  @@index([cardId, position])
}

model ChecklistItem {
  id          String    @id
  checklist   Checklist @relation(fields: [checklistId], references: [id])
  checklistId String
  text        String    @db.VarChar(200)
  done        Boolean   @default(false)
  position    Int
  deletedAt   DateTime?                 // soft-delete (§7.0)
  @@index([checklistId, position])
}

model Activity {                          // member/comment/системные; мутирующие
  id        String   @id @default(cuid()) // события карточек — из Command-лога (§7.4)
  board     Board    @relation(fields: [boardId], references: [id])
  boardId   String
  card      Card?    @relation(fields: [cardId], references: [id])
  cardId    String?
  type      String                        // 10 типов TASK-12/18.1 + member/comment
  actor     User     @relation(fields: [actorId], references: [id])
  actorId   String                         // теперь реальный юзер
  details   Json?                          // снапшот-детали
  createdAt DateTime @default(now())
  @@index([boardId, createdAt])
  @@index([cardId, createdAt])
}

model Comment {
  id        String   @id @default(cuid())
  card      Card     @relation(fields: [cardId], references: [id])
  cardId    String
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  text      String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([cardId, createdAt])
}
```

`LIMITS` (лимиты коллекций TASK-20) гвардят на DTO: `@ArrayMaxSize` для
меток/чеклистов при импорте, счётчики перед insert (чеклистов ≤ 20/карточка,
пунктов ≤ 100, меток ≤ 20 на карточке, ≤ 50 на доске, колонок ≤ 20,
карточек ≤ 500 в колонке, досок ≤ 50 на юзера).

**Soft-delete — семантика (§7.0):** все `DELETE`-endpoint'ы проставляют
`deletedAt` у сущности **и её детей** (каскад — кодом сервиса или
Prisma-миграцией, не `onDelete: Cascade`); выборки фильтруют
`deletedAt: null`; физическая чистка — отложенный job (N дней, период
зафиксировать в TASK-25). `GET /boards/:id` агрегат включает карточки
с `archivedAt`, но **не включает** `deletedAt` — удалённое из агрегата
не возвращается и в «Корзину» (§7.6, по запросу) отдаётся отдельным
endpoint'ом.

### 7.4. API — командный лог + чтение (`/api/v1`) (решение 2026-09: вариант Б)

**Мутации — один транспорт для всех действий редьюсера:**

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/boards/:id/commands` | `{commandId, action, ifMatch?}` → `200 {seq, versions}` · `400` (validate) · `409 {conflict, currentVersion}` |
| GET | `/boards/:id/commands?since=<seq>` | дельта-догон после обрыва SSE (вместо перезапроса агрегата) |

Сервер: `validate()` (строгий, §7.0) → `boardReducer(board, action)` из
`shared/` → транзакция (Command-лог + нормализованные таблицы §7.3).
Идемпотентность: повтор с тем же `commandId` возвращает закешированный
ответ, а не вторую сущность. Отказы редьюсера (WIP `atWipLimit`, лимиты)
→ `409 {conflict: "wip"}` — предикат общий с фронтом. Лог команд = активность
+ аудит (каждая команда несёт `actorId` и затронутые сущности).

**Auth (без guard):** `POST /auth/register` · `POST /auth/login` ·
`POST /auth/refresh` (ротация) · `POST /auth/logout` · `GET /auth/me`.

**Доски и участники (JwtGuard + MembershipGuard):**

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/boards` | мои доски (по membership): title, archivedAt, счётчики |
| POST | `/boards` | создать (автоматически OWNER-membership) |
| GET | `/boards/:id` | **агрегат доски** — колонки (только активные `cardIds`) + cards-мапа **включая архив** (`archivedAt`) + метки (+ чеклисты) одной выборкой — стартовое состояние UI |
| PATCH | `/boards/:id` | rename / archive |
| DELETE | `/boards/:id` | только ADMIN (последний ADMIN защищён) |
| GET | `/boards/:id/members` | участники (роль, expiresAt) |
| POST | `/boards/:id/members` | invite `{email, role, expiresAt?}` — только ADMIN |
| PATCH | `/boards/:id/members/:userId` | `{role?, expiresAt?}` — смена роли/срока VIEWER, только ADMIN |
| DELETE | `/boards/:id/members/:userId` | исключить — ADMIN; последний ADMIN защитён |

**Чтение (обычный REST, мутации — только через команды):**

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/cards/:id` | агрегат карточки: описание, чеклисты, метки, activity-страница (диалог) |

Создание/удаление/переименование/перемещение/дублирование/архив колонок,
карточек, меток и чек-листов, повес/снятие метки, галочка пункта, сортировка
— всё это уже есть в `BoardAction` и уезжает командами (`MOVE_CARD`,
`DUPLICATE_CARD`, `SET_COLUMN_CARD_ORDER`, `ARCHIVE_CARD`, …). WIP-лимит
и лимиты коллекций гвардятся тем же кодом, что на фронте (`atWipLimit`,
`LIMITS`): не «ещё одна валидация», а тот же редьюсер.

**Активность и комментарии:**

| GET | `/boards/:id/activity?cursor&limit` | лента доски |
| GET | `/cards/:id/activity?cursor&limit` | лента карточки — история целиком (лимит 50 снят) |
| POST | `/cards/:id/comments` | {text} (комментарии — не экшены редьюсера, обычный REST) |
| GET | `/cards/:id/comments?cursor` | |
| DELETE | `/comments/:id` | свой комментарий |

Ленты активности строятся **поверх Command-лога** (фильтр по затронутым
сущностям, курсор по `seq`); member/comment-события пишутся в тот же лог
отдельным типом. Лимит 50/карточку снят — история хранится целиком.

**Импорт/экспорт:**

| POST | `/boards/import` | envelope `parseExport` → создание доски целиком |
| GET | `/boards/:id/export` | envelope JSON — тот же формат, что UI-файл |

Round-trip-гарантия: cover, dueDate, `wipLimit`, `archivedAt` переносятся
в обе стороны без потерь (сериалайзер фронта их уже пишет — сверить
envelope в shared на TASK-22). Activity при импорте **не переносится** —
события сервер пишет сам с реальным actorId.

**Realtime (TASK-30):**

| GET | `/boards/:id/events` | SSE-поток: `{seq, action, actorId}` — те же экшены, что уходят командами |

Member/comment-события и снапшот-детали (`details` — имя метки/колонки, как
в TASK-12) пишет сервер при применении команды; чужие экшены фронт применяет
тем же `boardReducer` (TASK-30).

### 7.5. Фронтенд-адаптер (TASK-29)

- **Подготовка:** выполняется в TASK-21.4 (`context-split`) и TASK-21.7a–d
  (`deterministic-actions`…`inverse-history`, см. §6.0.1) — к TASK-29 контекст
  уже разделён, история уже на инверсиях с property-тестом. Здесь
  дополнительно готовить нечего. Хранилище как единый JSON-блоб не
  переписывать — снимается бэкендом.
- **Optimistic:** компоненты по-прежнему зовут экшены редьюсера; редьюсер —
  источник UI-состояния (отклик мгновенный, undo/redo без сети).
- **Sync-слой:** каждый экшен → `POST /boards/:id/commands {commandId,
  action, ifMatch}` → `200 {seq, versions}` / `409 {conflict}` → reconcile
  (позиции, версии). Провал/отказ → откат экшена (инверсия, TASK-21.7d) +
  тост. Команды в полёте (pending) при чужой команде по SSE → rebase через
  инверсии (механизм уже есть после TASK-21.7d); для MVP допустим LWW без
  rebase.
- **Undo = инверсная команда, обычная для сервера:** инверсии считаются
  во фронтовом сторе (`src/store/invert.ts`, TASK-21.7d) в момент dispatch;
  undo уезжает через тот же sync-слой — сервер не знает, что это отмена.
  Конфликт по `ifMatch`/`version` на текстовой сущности → `409` → тост
  «изменил другой участник»; позиционные изменения применяются (LWW).
  Политика конфликтов undo — §7.0, реализация здесь и в TASK-30.
  Дубликат при undo удаляется по клиентскому id копии — серверных сюрпризов
  в истории нет.
- **401-цикл:** access истёк → `POST /auth/refresh` → retry вызова один
  раз; refresh не удался (ротация/реюз) → сброс состояния → логин-экран.
  Параллельные 401 ждут одного общего refresh (single-flight).
- **id клиента едет в команде** (`commandId`, id создаваемых сущностей в
  payload) — идемпотентные ретраи; undo создания = `DELETE_CARD` с тем же id.
- **Старт:** `GET /boards/:id` → маппинг агрегата в текущую модель `Board[]`
  (формат ответа шейпится под редьюсер) → `REPLACE_STATE`. Компоненты/UI не
  меняются.
- **Первый логин:** локальный `janosik-boards` (если есть) →
  `POST /boards/import` (данные переезжают в БД) → localStorage очищается.
- **Чужие изменения:** refetch агрегата на window focus (MVP), с TASK-30 —
  SSE `{seq, action, actorId}` → чужой экшен применяется тем же
  `boardReducer`; обрыв — догон `?since=` дельтой.
- **Офлайн:** тост «нет сети, изменения не сохранены», очередь экшенов —
  с PWA (TASK-15).

### 7.6. Разблокированные фичи (после TASK-29, по запросу — не запланированы)

> Решение пользователя: UI в текущем виде конечен — авторы, комментарии и
> исполнители (assignee) в интерфейс добавляются **потом**. Бэкенд при этом
> готов: Comment — таблица и endpoints с TASK-28, `User.displayName` — с
> TASK-24; для assignee в TASK-26 достаточно будет миграции
> `Card.assigneeId?` + колонки таблицы вида (слот в настройках колонок уже
> зарезервирован, TASK-14.1 п.11).

- Уведомления (email/in-app: mention, дедлайны).
- Вложения (multipart, файловое хранилище).
- **API-токены** — `POST /auth/tokens` {name, expiresAt?} (токен показывается
  один раз), `GET /auth/tokens`, `DELETE /auth/tokens/:id`; JwtStrategy
  принимает и PAT (hash-lookup, `lastUsedAt` тикает); супер-админ выпускает/
  отзывает токены юзеров (`POST /admin/users/:id/tokens`). Схема
  `ApiToken` уже в §7.3.
- **Супер-админ** — `SuperAdminGuard` (`User.isSuperAdmin`): список юзеров и
  досок, блокировка юзера, доступ к любой доске без membership, выдача
  ролей системы. Минимум UI — годится отдельная простая страница.
- **Исполнители (assignee)** — `Card.assigneeId?`, колонка таблицы и бейдж
  на карточке; membership-проверка, что юзер состоит в доске.
- **Embed-снапшот доски** — `GET /embed/:token`, публичный read-only SSR HTML.
- Рабочие пространства (`Workspace`/`Team` над досками), VIEWER-роль.
- Присутствие (who's viewing) поверх SSE/WebSocket.

### 7.7. Порядок итераций (строго по порядку)

| # | TASK | Ветка | Суть | DoD (кратко) |
| --- | --- | --- | --- | --- |
| 1 | TASK-22 `monorepo-restructure` | `feature/TASK-22-monorepo` | `git mv` фронта в `ui/`, workspaces, `@janosik/shared` (модель+LIMITS+envelope+STORAGE_KEYS+**DTO-типы API и `BoardAction` — контракт фронт↔бэк, форма экшенов к этому моменту финализирована TASK-21.7a/b**; envelope сверить с сериалайзером архива/обложек/сроков — round-trip §7.4), `SAVE_DEBOUNCE_MS` в константы, алиасы vite/tsconfig/vitest | 362 теста зелёные в новом layout; tsc/build зелёные |
| 2 | TASK-23 `backend-scaffold` | `feature/TASK-23-backend-scaffold` | NestJS + Prisma + docker-compose(postgres:16), `/health`, модули-заглушки, общий tsconfig/ESLint, helmet + rate-limit на auth-роутах сразу | `/health` 200; e2e-пайплайн работает; backend-команды DoD в AGENT.md |
| 3 | TASK-24 `backend-auth` | `feature/TASK-24-backend-auth` | register/login/refresh/logout/me, argon2id, `displayName`, `isSuperAdmin` (первый юзер), ротация refresh + детект реюза, JwtGuard | e2e: полный цикл auth + реюз revoked → отзыв сессий; guard-роуты 401; rate-limit на /auth/login |
| 4 | TASK-25 `boards-members` | `feature/TASK-25-boards-members` | Полная схема §7.3 + миграции **включая soft-delete (`deletedAt`) и `version` — с первого дня, каскады проставлением флага** (§7.0); boards CRUD, membership с ролями ADMIN/MEMBER/VIEWER + `expiresAt` (invite/смена роли — только ADMIN, протухший VIEWER → 403), `GET /boards/:id` агрегат (активные cardIds + cards с archivedAt), import/export с round-trip cover/due/wip/archived | e2e: CRUD, роли (VIEWER-мутация → 403, expiresAt → 403), 403 чужой доске; aggregate shape = модель фронта (включая архив); soft-delete: DELETE прячет сущность, выборки фильтруют `deletedAt` |
| 5 | TASK-26 `columns-cards` | `feature/TASK-26-columns-cards` | Команды колонок/карточек (CRUD, move/reorder с позициями, duplicate — id копии от клиента, archive/unarchive/mass-archive, TOGGLE→SET, SET_COLUMN_CARD_ORDER) поверх командного лога; WIP — отказ команды общим `atWipLimit`; каскады — soft-delete §7.3 | e2e: команды apply/reject; повтор `commandId` не создаёт дубль; позиции стабильны; archive round-trip; WIP 409; каскад колонки; `ifMatch` 409 |
| 6 | TASK-27 `labels-checklists` | `feature/TASK-27-labels-checklists` | Команды меток (доска+карточка, m2m с позицией) и чек-листов + пунктов (включая `SET_CHECKLIST_ITEM_DONE`, RESTORE_*) | e2e: m2m round-trip, каскад метки (soft-delete), лимиты коллекций, restore-команды возвращают состояние |
| 7 | TASK-28 `activity-comments` | `feature/TASK-28-activity-comments` | Ленты активности поверх Command-лога (курсор по `seq`, фильтр по сущностям), member/comment-события в логе, комментарии (REST; UI позже — §7.6) | e2e: каждая мутирующая команда видна в лентах, actorId верный, пагинация, догон `?since=` отдаёт дельту без перезапроса агрегата |
| 8 | TASK-29 `optimistic-adapter` | `feature/TASK-29-optimistic-adapter` | Sync-слой: экшен→`POST /commands {commandId, action, ifMatch}`→`{seq, versions}`/`409`, undo=инверсная команда из стора (TASK-21.7d) с политикой конфликтов §7.0 (текст → отказ с тостом, позиции → LWW), 401/refresh single-flight, откаты, старт-агрегат → REPLACE_STATE, login-экран, миграция localStorage (включая архивные карточки) | UI полностью живёт с сервера; undo/redo и офлайн-тосты работают; undo при чужой правке текста отказывается с тостом, правка другого участника не теряется; 362+ фронт-тестов зелёные |
| 9 | TASK-30 `realtime-sse` | `feature/TASK-30-realtime-sse` | SSE `{seq, action, actorId}` + применение чужих экшенов тем же `boardReducer`, refetch-on-focus остаётся fallback; в идеале — rebase pending-команд через инверсии | два браузера видят изменения друг друга без перезагрузки; обрыв SSE догоняет `?since=` дельтой |

После TASK-29 ядро готово (TASK-30 — realtime поверх). §7.6 открывается
по запросу.

---

## 8. Definition of Done (для каждой задачи)

Перед пушем ветки обязательны, иначе PR не готов. После TASK-22
(monorepo, §7.0) команды выполняются в пакете через `-w`:

```bash
# фронтенд (ui/)
npm test -w ui              # все тесты зелёные
npx tsc -b --force          # 0 ошибок (команда без пайпа!)
npm run build -w ui         # сборка зелёная

# бэкенд (backend/, с TASK-23)
npm test -w backend         # unit + e2e (supertest, тестовая БД)
npx tsc -b --force          # 0 ошибок
```

Плюс:

- новые строки UI есть и в `en`, и в `ru`;
- типы ключей не сломаны (`tsc` ловит рассинхрон);
- токены/цвета — только из `src/index.css`, без хардкода;
- `prefers-reduced-motion` учтён для новых анимаций;
- dev-сервер поднимается на `http://localhost:5199/` (HTTP 200);
- backend-задачи: `npx prisma migrate dev` применяется чисто, e2e против
  тестовой БД из docker-compose, секреты — только в `.env` (в git не попадает).
