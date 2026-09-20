# Janosik — Роадмап и план итераций

> **Единый источник правды по развитию приложения.** Этот файл заменяет
> прежние `ARCHITECTURE_REVIEW.md`, `FEATURES_BACKLOG.md` и
> `CURRENT_WORK_ITERATIONS.md` (они удалены). Любой ИИ-агент начинает работу
> с чтения этого файла и `AGENT.md`.
>
> **Текущий фокус:** фундамент перед бэкендом закрыт полностью (§6.0.1,
> TASK-21.1…21.11 ✅); активная фаза — бэкенд, совместный UI и релиз
> (§7, TASK-22…32 и 35…41 — порядок в §7.7). **Форма поставки —
> самохостимый опенсорс** (MIT, `docker compose`, публичное демо):
> §7.8. Обновлено: 2026-09.

---

## 0. Как работать с этим файлом (для ИИ-агентов)

1. **Одна задача = одна ветка = один пулл-реквест.** Перед началом итерации
   создай ветку `feature/TASK-{номер}-{slug}`. Пушишь — человек делает ревью
   и мержит сам. **Не мержить свою работу самостоятельно: PR открывай,
   CI дождись и доложи, но мерж — только по явной команде пользователя
   («мержи», «мерж» и т.п.); «стартуй задачу» такой команды не даёт.**
   Для GitHub-операций (PR, мерж, CI, issues) используй `gh` CLI —
   он установлен и залогинен (аккаунт VitalyTolstik, scopes `repo`,
   `read:org`): `gh pr create`, `gh pr checks`, `gh pr merge`,
   `gh run list`. Сырой REST через curl и `git credential fill` —
   только как запасной путь, если `gh` недоступен.
2. **Иди строго по порядку:** порядок фиксирует таблица §6.0 (фронт —
   TASK-21.1…21.11, затем §7.7 — TASK-22…32 и 35…41, 19 шагов). Не прыгай
   через задачи, если явно не сказано обратное. Закрытые задачи — в
   `ROADMAP-DONE.md` (справочно, обязательного чтения не требует).
3. **После мержа — обнови ровно эти четыре места и ничего больше:**
   1. статус задачи в таблице §6.0 → `✅` + номер PR и одна строка «что вышло»;
   2. её блок в §6.0.1 → `✅` (а полное описание перенеси в `ROADMAP-DONE.md`);
   3. §1.1 «Функции» — если фича видна пользователю, у неё должна быть строка
      (или правка существующей). **Это единственная витрина состояния: именно
      она разъезжается первой, если её пропустить;**
   4. §1.2 «Тесты» — число из `npx vitest run`, не по памяти.

   Не переписывай весь файл. Если факт описан в двух местах — удали один,
   а не синхронизируй оба (по этой причине удалены §2–§4).
4. **Правила, которые нельзя нарушать:**
   - Репозиторий — monorepo (см. §7.0): `ui/` (фронт), `backend/`,
     `shared/` (общий контракт). Фронтенд-правила действуют для `ui/`.
   - Бэкенд-стек зафиксирован (§7.1): NestJS/Prisma/PostgreSQL/JWT —
     не менять без явного решения пользователя.
   - E2E-тесты (Playwright/Cypress) для **однопользовательского** UI
     **исключены** — только Vitest + React Testing Library. Единственное
     исключение — **многопользовательские** сценарии, которые Vitest физически
     не воспроизводит (два браузера): ровно шесть сценариев в TASK-41, §7.8.
     Не расширять этот список без явного решения.
   - Каждая новая строка UI добавляется **синхронно** в `src/locales/en` и `src/locales/ru`.
   - Данные (названия карточек, колонок, досок) **не переводятся** — только UI-хром.
   - Дизайн-токены: не хардкодить цвета — только переменные из `src/index.css`.

### 0.1. Оркестрация субагентов (Orca) — шпаргалка

Параллельная работа нескольких агентов по кластерам задач (обкатано на
аудите 2026-09): координатор — главный агент в терминале main-worktree,
субагенты — opencode в worktree Orca. **Приоритет правил:** при расхождении
этого файла с CLI-гайдами (`orca skills get …`) действуют правила этого
файла: recovery-механика CLI (`--task` + `--retry-of`, `worker-abandon`)
здесь НЕ применяется (наступали 2026-09-16 — уводила из пайплайна к
`--agent claude` и замороженной спеке); сбойный воркер заменяется новым
`worker-start` с `--spec` (п.9).

- **CLI:** полный путь `/Applications/Orca.app/Contents/Resources/bin/orca`
  (симлинк `/usr/local/bin/orca` бывает битым).
- **⚠️ Неймспейс (не путать):** команды оркестрации — только под
  `orca orchestration …`: `run-create`, `run-use`, `run-current`,
  `run-show`, `check`, `send`, `reply`, `inbox`, `worker-start`,
  `worker-show`, `worker-read`, `worker-stop`, `worker-retain`,
  `worker-release`, `worker-list`. Голых `orca run-current` /
  `orca run …` НЕ существует — «Unknown command» значит «забыл неймспейс»,
  а не «CLI сломался» (наступали 2026-09-16). Верхнеуровневые команды —
  `worktree`, `terminal`, `repo`: `worktree create|list|show|set|rm`,
  `terminal list|create|read|send|wait|close`, `repo list|show`.
  Свежая шпаргалка по CLI — `orca skills get orca-cli` (гайд
  версионируется с бинарем; при расхождении с этим файлом — править
  сюда).
- **Селекторы (проверено 2026-09-16, после обновления CLI):** `--repo`
  принимает и `path:/Users/vitaltol/Dev/janosik`, и `id:<repoId>`;
  worktree-селекторы — `id:<repoId>::<abs path>` (полный id из
  `create`/`list`), `path:<abs>`, `name:<display>`, `branch:<ветка>`.
  Прежняя заметка «`id:` в `worktree create` отвечает
  `repo_not_found`» устарела: форма `id:` рабочая (проверено
  create+show+rm пробного worktree).
1. **Worktree под каждого субагента** (ветка = имя):
   `orca worktree create --repo path:… --name <slug> --setup run --json`
   → `/Users/vitaltol/orca/workspaces/janosik/<slug>`, `node_modules`
   ставится setup-хууком. До `worker-start`: (а) дождаться setup-хуука —
   `ls <worktree>/node_modules/.bin` непуст; (б) скопировать секреты
   координатором: `cp /Users/vitaltol/Dev/janosik/backend/.env <worktree>/backend/.env` —
   воркер не должен ходить в пути вне своего worktree (чужой каталог =
   permission-промпт «Access external directory» и пауза; проверено
   2026-09-16).
2. **Модель субагента** — НЕ через `worker-start --model` (работает только
   для Claude/Codex/Cursor). Пишется `<worktree>/opencode.json`:
   `{"$schema":"https://opencode.ai/config.json","model":"openrouter/deepseek/deepseek-v4.1-flash","permission":{"edit":"allow","bash":"allow","webfetch":"allow"}}`
   — блок `permission` обязателен, иначе воркер спрашивает разрешения
   (решено пользователем 2026-09-16; то же в глобальном
   `~/.config/opencode/opencode.jsonc` — действует на все сессии).
   Файл скрыт через общий `.git/info/exclude` главного репозитория
   (per-worktree `info/exclude` git не читает).
3. **Ран:** `orca orchestration run-create --objective … --json`.
   Если `worker-start` отвечает `consumer_fenced` — из координаторского
   терминала выполнить `orca orchestration run-use --id <run_id> --json`
   и повторить; привязку показывает `run-current`.
4. **Старт воркера:** `orca orchestration worker-start --run <run>
   --worktree name:<slug> --agent opencode --task-title "…" --spec "<ТЗ>" --json`
   → возвращает `taskId`/`dispatchId` (записывать). Спека — самодостаточный
   текст: контекст и база (тесты/линт), список находок, **граница файлов**,
   запреты (не пушить/не мержить/не трогать общие файлы), формат отчёта.
   Длинную спеку писать в файл и подставлять `--spec "$(cat <file>)"`.
   Нюансы (проверено 2026-09-16): `--task` и `--spec` взаимоисключающие,
   спека созданной таски заморожена — перезапуск всегда НОВЫМ
   `worker-start` с `--spec`; placement — только `--worktree name:<slug>`
   из п.1 (не `new-child`/`current` — они создают worktree без setup-хуука
   и без opencode.json); воркер коммитит в ветку worktree
   `VitalyTolstik/<slug>`, feature/TASK-…-ветки не создаёт.
5. **Мониторинг:** `orca orchestration check --run <run> [--wait]`.
   Доставка FIFO: недоставленное реплеится, поэтому **акать сразу** —
   `orca orchestration check --run <run> --ack <deliveryId>`; акается батч
   целиком, id — из поля `deliveryId` ответа (`delivery_…`; `msg_…` даёт
   `stale_delivery`). `--json` пишет keepalive-строки в stderr — парсить
   stdout. `--wait` гонять циклом с таймаутом 10–15 мин: работающий
   воркер может молчать десятки минут (heartbeat'ы «alive» — норма).
   Ответить воркеру: `orca orchestration send` / `reply`.
   **Правило координатора (решение пользователя 2026-09-16):** пока
   хотя бы один воркер работает, координатор занят — ждёт и слушает
   (`check --wait` циклично): акает heartbeat'ы, отвечает на вопросы,
   снимает permission-промпты (стрелка вниз + Enter = «Allow always»),
   и лишь когда все воркеры завершены — переходит к интеграции или
   другим делам.
6. **Жизненный цикл (решение пользователя 2026-09-16):** воркер сдал
   задачу → ревью координатора → `worker-release --dispatch <id>`
   (снимает терминал; **worktree релизом НЕ удаляется** — отдельно:
   `orca worktree rm --worktree path:<wt> [--force]`). **Новая задача =
   всегда НОВЫЙ воркер с чистым контекстом в новом worktree** —
   освободившихся не переиспользуем, `worker-retain`/follow-up только
   для мелких правок текущей задачи того же воркера. ⚠️ `worker-release`
   НЕ убирает шелл-терминалы из UI — после релиза чистить явно:
   `orca terminal close --worktree path:<released-worktree> --all`
   (иначе «висят»), сверяться: `orca terminal list`. `worker-release`
   работает только по settled-диспатчу (succeeded/failed): на живом
   вернёт `retained` — тогда послать воркеру «принято, освобождаю»,
   дождаться exit его терминала (`terminal read` → `status: exited`) и
   повторить; `retained` при уже мёртвом терминале безвреден, остаточные
   записи диспатчей в `worker-list` не мешают.
7. **Практика параллелизации:** резать работу по **файлам**, не по
   категориям находок; cross-cutting правки (общие утилиты, каталоги i18n)
   — отдельной волной после вливания первой; общие файлы (`README.md`,
   `ROADMAP.md`) правит только координатор; перед
   стартом сверять базу воркера: `git -C <worktree> log --oneline -1`.
8. **Пайплайн `dev → qa` (решение пользователя 2026-09-16).** Все
   субагенты — DeepSeek V4.1 Flash (модель в `opencode.json` worktree,
   п.2). Роли и цикл:
   - **dev** (воркер `dev-<slug>`, worktree `dev-<slug>`) — пишет код
     и тесты, правит что считает нужным, к пушу/мержу доступа не имеет.
     Закончив, **сначала коммитит работу в ветку worktree** (qa-worktree
     создаётся от ветки — незакоммиченное состояние туда не попадёт;
     повторено после dev-touch-dnd 2026-09-16), затем шлёт координатору
     «готово» с описанием изменений, хешем коммита и как проверить.
   - **qa** (воркер `qa-<slug>`, worktree `qa-<slug>`, создаётся от main
     по п.1) — **код не пишет**. Обновляет проверяемое состояние
     форвард-мержем ветки dev (`git merge --ff-only <dev-branch>`, затем
     `npm install` + `npx prisma generate`, если менялись
     зависимости/схема). Проверки по типу задачи: UI — `npm test`
     (+ `--coverage`), `npm run build -w ui` (внутри `tsc -b`; голый
     `tsc -b` от корня не работает — нет корневого tsconfig, qa поймал
     2026-09-16), `npm run lint`, `npm run format:check`,
     `npm run size -w ui`, браузерный смоук (`npm run preview`);
     backend — `npm test -w backend`, `npm run build:backend`; общие —
     lint/format:check.
   - **Цикл до принятия:** qa нашёл ошибку → вердикт координатору → тот
     пересылает dev'у (dev жив: retain, не release) → dev правит → qa
     перепроверяет → … пока qa не примет.
   - **Координатор после принятия:** дифф ревьюит **на логику, тесты сам
     не гоняет** (qa уже прогнал, факт прогонов — в вердикте qa);
     обновляет доки (ROADMAP/README), пушит ветку dev, открывает PR,
     ждёт CI и **докладывает — мерж только по явной команде
     пользователя** («мержи», §0 п.1); после мержа — docs-коммит,
     release dev и qa + чистка терминалов/worktree (п.6).
   - Правило чистого контекста (п.6) действует на обе роли: новая
     задача = новые `dev-<slug>` и `qa-<slug>`, освободившихся не
     переиспользуем.
   - **Диспатч и done (решение пользователя 2026-09-16):** роли
     завершаются по-разному. **dev:** «готово» — обычное
     orchestration-сообщение в ран (`to: run:<run_id>`), **финальный
     done НЕ отправлять** — диспатч остаётся открытым, чтобы
     координатор слал правки из qa-цикла в его ящик (`send --to
     dispatch:<id>`); освобождает dev сам координатор
     (`worker-release`) после мержа. **qa:** вердикт
     «принято»/«ошибка» — сообщением в ран, затем **сразу финальный
      done, без ожидания подтверждения координатора** — работа qa на
      этом закончена; повторная проверка после правок dev — координатор
      через `worker-retain --dispatch <id>` + `terminal send --terminal
      <handle>` (handle из `worker-show`). Финальный done закрывает
      диспатч навсегда (`send --to dispatch:<id>` отвечает
      `dispatch_inactive` — это не поломка CLI); сообщения воркера в
      ран работают и после закрытия. Спеки обеих ролей включают эти
      правила явным текстом — воркер не догадается сам.

9. **Сбойный старт воркера (2026-09-16):** `failed` в `agent_readiness`
   (trust/permission-промпт), `outcome_unknown` (`turn_start_unobserved`)
   или молчащий агент — сначала инспекция, а не cleanup:
   `worker-list --run <run>` (liveness + `nextAction`) и `terminal read`;
   `unverifiable` ≠ «мёртв» (это отсутствие доказательств — ждать или
   инспектировать). Видимый промпт в терминале — снять (п.5). Только
   позитивное доказательство exit (`status: exited`, пустой шелл-промпт)
   разрешает: `worker-stop`/`worker-release`, затем
   `worktree rm --worktree path:<wt> --force` и старт нового воркера
   по п.1–4 с той же спекой. Хвосты неудавшегося `worker-start`
   (терминалы, worktree без setup) чистить руками — список в
   `residualResources` у `worker-show`.

---

## 1. Текущее состояние (что уже сделано)

### 1.1. Функции (✅ = реализовано)

| Группа | Возможности | TASK |
| --- | --- | --- |
| Доска | заголовок редактируется инлайн в шапке, горизонтальная лента колонок, 4 фона, настраиваемое «стекло» колонок | 7, 8 |
| Мультидоски | свитчер, создание/переименование/архив/восстановление/удаление, deep-links `/board/:id`, пустое состояние с CTA | 7, 8 |
| Виды доски | канбан / **календарь** (drag сроков, панель «Без срока», неделя-месяц, панель дня) / **таблица** (сортировка, инлайн-редактирование, настройки колонок); выбор вида сохраняется между сессиями | 14, 14.1 |
| Колонки | добавление, переименование (двойной клик), удаление с каскадом, drag-перестановка, дублирование, сортировка карточек (создание/срок/название) | 6, 9 |
| Карточки | inline-композер (в т.ч. hover-зоны между карточками), живое редактирование заголовка, удаление с подтверждением, drag&drop внутри/между колонками и на тачах (long-press), перенос через меню, дублирование | 6, 21.10 |
| Описание карточки | WYSIWYG MDX-редактор (MDXEditor) в диалоге, бейдж «есть описание» на карточке, санитизация сырого HTML при импорте | 2, 21 |
| Чек-листы | подзадачи в диалоге (добавление/галочки/переименование/удаление), прогресс-бар и бейдж «2/5» на карточке | 3 |
| Сроки | дата+время в диалоге (календарь + вил-пикер), бейдж на карточке: просрочено (красный), скоро ≤24 ч (жёлтый) | 4 |
| Обложки | 12 цветов + 6 градиентов на токенах, полоса сверху карточки | 5 |
| Метки | 14 цветов, мульти-выбор, создание/переименование/перекраска/удаление (каскад со всех карточек) | — |
| Архив карточек | `archivedAt`, архив с карточки/строки таблицы/диалога, массовый архив колонки, модалка «Архив (N)» с поиском и восстановлением в выбранную колонку | 18.1 |
| WIP-лимиты | лимит на колонку (1…99), счётчик `N/M`, блокировка композера и drag'а, тост | 13 |
| Фильтр | поиск по названию и описанию, метки (**ANY/ALL** + «без метки»), срок, дата создания; фасеты с бейджем, `/` для фокуса, счётчик совпадений, DnD выключен при активном фильтре | 10, 16 |
| Глобальный поиск | `Ctrl/Cmd+K` — по всем доскам, по названию/описанию/меткам, крошка «Доска › Колонка», сниппет, бейдж «В архиве», клик открывает карточку (`?card=`) | 10 |
| Хоткеи | палитра по `?`, `j/k` курсор, `e`/Enter открыть, `n`/`c` композеры, `Esc` | 11 |
| Undo/redo | история 50 шагов с коалесцингом, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, кнопки в шапке. **На инверсных командах** (`{do, undo}`, селективный undo — не откат снапшота) | 33, 21.7 |
| Активность карточки | лента **10 типов** событий (включая `archived`/`unarchived`), «Активность (n)», лимит 50/карточку (снимет БД — §7.3) | 12, 18.1 |
| Данные | дебаунс-сохранение (400 мс) + flush при закрытии, экспорт/импорт JSON, авто-бэкапы в IndexedDB (троттл 60 с с trailing-снимком, ротация 20), ручное «сохранить копию», восстановление/удаление бэкапов | —, 21.4 |
| Устойчивость | ErrorBoundary (Reload / Reset с подтверждением и автоэкспортом, EN-fallback без i18n), баннер «Данные не сохраняются», карантин битого JSON (`janosik-boards.corrupt.<ts>`) | 21.2 |
| PWA / офлайн | манифест, иконки 192/512/maskable, service worker (app-shell network-first, `/assets/*` cache-first, кэшируются только успешные ответы, `CACHE_VERSION` = хеш сборки → старые кэши чистятся после деплоя) | 15, 21.3 |
| Оформление | тёмная/светлая темы с префлайтом (без мигания), 4 фона доски, `prefers-reduced-motion`, кастомные скроллбары | — |
| i18n | en/ru, типобезопасные ключи, плюрализация, тумблер формата времени «Авто/12ч/24ч» | 17 |
| Бренд | Space Grotesk (self-hosted), анимированный логотип «Перо Яношика», живые иконки шапки | — |
| Лимиты ввода | `LIMITS` на 14 полях + коллекциях, счётчики «осталось N», тултипы/тосты гвардов. **Калибруются в TASK-21.5** | 20 |

> **Чего ещё нет (упирается в бэкенд, §7):** аккаунты и шаринг, комментарии,
> исполнители, уведомления, вложения. Из фронтового — тач-слой календаря/
> таблицы (TASK-31) и дублирование доски.

### 1.2. Архитектура (кратко)

> **Layout (TASK-22):** monorepo npm workspaces — фронт в `ui/`
> (бывший корень: `ui/src/…`), общий домен и контракт API в `shared/`
> (`@janosik/shared`, source-only): модель+LIMITS, детерминированный
> `board-reducer`, `invert`, migrate/seed, `column-limits` (atWipLimit),
> envelope экспорта, storage-keys, DTO/SSE-контракт `api.ts`.
> Пути ниже читаются как `ui/<путь>`.

- **Модель** — `Board { columns[], cards: Record<string,Card>, labels[] }`,
  `Card { id, title, description?, checklists?, labelIds[], dueDate?, cover?,
  archivedAt?, createdAt, updatedAt }` (`Checklist { id, title, items:
  [{id, text, done}] }`). Архивная карточка (TASK-18.1) остаётся в `cards`
  с `archivedAt`, но вынимается из `column.cardIds` — восстановление
  возвращает её в конец выбранной колонки с учётом WIP-лимита.
  Нормализовано: перестановка = перестановка id-массивов. `Board[]` на
  верхнем уровне — мультидоски (свитчер, `/board/:id`).
  Активность карточки — 10 типов событий (включая `archived`/`unarchived`),
  лимит 50/карточку снимет БД (§7.3). Undo архива возвращает карточку **на
  прежнее место** (`UNARCHIVE_CARD.index`), а не в конец колонки.
- **Состояние** — `boardReducer` (44 экшена) + `BoardContext`
  (дебаунс-персистентность, хоткеи, авто-бэкап; история — в хуке
  `useUndoHistory`). Компоненты вызывают
  типизированные удобные экшены. Провайдер раздаёт **три контекста**
  (TASK-21.4): `BoardStateContext` (доска), `BoardActionsContext` (собран один
  раз — его подписчики не перерисовываются от чужих правок) и
  `BoardHistoryContext` (`canUndo`/`canRedo`); `useBoard()` — объединяющий хук
  для тех, кто и так рендерит доску, `useBoardActions()`/`useBoardHistory()` —
  для пишущих компонентов (шапка, пикеры).
  **Редьюсер детерминирован (TASK-21.7a):** ни `createId()`, ни
  `Date.now()` внутри — время (`at`) и id создаваемых сущностей
  (`newCardId`, `newColumnId`, `newChecklistId`, `newItemId`,
  `newCardIds[]`, `activityIds[]`) приходят в payload от вызывающей
  стороны; экшены абсолютны (`SET_CARD_LABEL {on}`, а не `TOGGLE_*`).
  Третий аргумент `options?: { withActivity?: boolean }` отключает ленту
  активности (сервер зовёт с `false`, §7.4.1). Правило — в `AGENT.md`.
- **Undo/redo — компенсация, а не перемотка (TASK-21.7d):**
  `src/store/invert.ts` считает инверсию команды в момент dispatch (пока
  ещё известно состояние «до»), `BoardHistory` хранит пары `{do, undo}`
  (**ни одного объекта `Board`** — 167 KB в худшем случае вместо десятков
  мегабайт), `useUndoHistory` держит по стеку на доску, флаги
  `canUndo`/`canRedo` и хоткеи. Redo пересылает исходную команду с **новым
  `commandId`**; чужая команда (SSE, TASK-29/30) в стек не попадает, redo
  не чистит и помечает пересечённые шаги `dead`. Инвариант
  `reduce(reduce(before, a), invert(before, a)) === before` — property-тест
  `invert.test.ts` (каждый экшен + 5 случайных сессий по 40 команд,
  в обоих режимах `withActivity`).
  **Три правила undo без исключений** (подробно — `AGENT.md`): возврат
  побайтовый, включая ленту активности (`cardActivity`); undo **нельзя
  отклонить** — коллекционные гварды (`LIMITS`, WIP) не применяются к
  командам с `inverse: true`; каждое нажатие что-то меняет — пустой шаг
  выбрасывается, а не съедает нажатие.
- **Персистентность** — интерфейс `DebouncedPersistence` поверх `localStorage`; позже бэкенд = второй адаптер `fetch` **без изменения reducer и UI**.
- **UI** — shadcn/ui + Radix (dialog/dropdown/popover/tooltip/slot), dnd-kit, react-day-picker, MDXEditor (описание карточки); виды доски: канбан / календарь / таблица (TASK-14/14.1).
- **Рендер-изоляция** (TASK-21.4/21.4.1) — четыре контекста провайдера
  (стейт / actions / `canUndo`-`canRedo` / `{id,title}` активной доски —
  последний нужен, чтобы заголовок в шапке не перерисовывался от правок
  карточек), `memo` на `ColumnView`,
  `SortableCard`/`CardItem`, `AddCardZone` и `TableRow`; данные им приходят
  **пропсами** через резолверы `useCardList`/`useCardLabels`, которые
  возвращают тот же массив, пока не изменились сами карточки/метки. Правка
  карточки перерисовывает только её колонку (или строку таблицы).
  **Любое значение, уходящее в dnd-kit, обязано быть стабильным:** и массив
  в `SortableContext items`, и каждый проп `DndContext` (`sensors`,
  `measuring`) — новый массив/объект меняет контекст dnd-kit и
  перерисовывает всех подписчиков `useSortable`/`useDroppable` в обход
  `memo` (наступали трижды, каждый раз находилось только замером).
- **Тесты** — **892 теста: ui 558 (72 файла) + shared 334 (7 файлов)** (reducer, history, persistence, serialization, backup, backup-timestamp, dnd, filter, storage, migrate, i18n, pwa, editor-import, интеграционные BoardSection + CardDialog + свитчер; изоляция рендеров и троттл бэкапа — TASK-21.4/21.4.1; поведение service worker'а — TASK-21.3; обратимость экшенов — `invert.test.ts`, TASK-21.7d; платформа и BrowserRouter deep-links — TASK-21.8; ленивые иконки шапки — `lazy-animated-icon.test.tsx`, TASK-21.9; конфигурация сенсоров тач-DnD — `DndBoard.sensors.test.tsx`, TASK-21.10; сброс диалогов и двойной тап — `ColumnView.double-tap.test.tsx`, TASK-21.11; строгий валидатор команд (включая метки/чек-листы и board-level) — `shared/src/store/validate.test.ts`, TASK-26/27/29; серверный режим — `api/client.test.ts`, `store/server-sync.test.ts`, `store/board-diff.test.ts`, `store/BoardContext.server.test.tsx` (fake-сервер на общем редьюсере), `components/auth/LoginPage.test.tsx`, TASK-29; мастер-панель — `admin/admin-client.test.ts`, `admin/admin-i18n.test.ts`, `admin/AdminApp.test.tsx` (fake admin-API), TASK-43; участники и read-only — `components/ui/user-avatar.test.tsx`, `components/board/BoardMembersDialog.test.tsx`, `components/board/read-only.test.tsx`, `components/BoardSection.roles.test.tsx` (fake-сервер с ролью VIEWER), TASK-35; realtime — `store/realtime.test.ts` (SSE-парсер, reconnect/backoff, `touchedEntityIds`) и кейсы в `store/BoardContext.server.test.tsx` (чужая команда, догон `?since=`, другой таб, foreign-пометка undo по `touches` без рефетча, own-echo не убивает undo, deferred-очередь при in-flight, успешный undo/redo через лог), TASK-30/30.1/30.2; присутствие и атрибуция — `store/board-live.test.tsx` (сторы presence/attribution/members, command→card-ids), `components/board/PresenceStack.test.tsx` (fake-сервер: ростер, «+N», join/leave), кейсы presence/кольца/ленты/таблицы в `realtime.test.ts`, `BoardContext.server.test.tsx`, `CardItem.test.tsx`, `CardActivityFeed.test.tsx`, TASK-36). Цифру сверять командой `npx vitest run`, а не переписывать по памяти.

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

## 2–4. *(удалены)*

Разделы «Недочёты», «Сравнение с конкурентами» и «Идеи и приоритеты» убраны:
они дублировали §6/§7 и `ROADMAP-DONE.md`, но не управляли ни одной задачей —
и потому единственные разошлись с кодом. Номера **2, 3, 4 не
переиспользуются** (как и номера задач), чтобы старые ссылки не начали
указывать на другое содержимое.

Где искать то, что там было:

| Было | Стало |
| --- | --- |
| §2 «Недочёты» | живые пункты — §6.0.1 (TASK-21.1…21.11), закрытые — `ROADMAP-DONE.md` |
| §3 «Сравнение с конкурентами» | `README.md` (обновляется вместе с бейджами) |
| §4 «Идеи и приоритеты» | сделанное — `ROADMAP-DONE.md`; «на будущее» — §7.6 |

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
| 4 | TASK-16 `label-filter-any-all` | ✅ реализовано, PR #29 смержен — `CardFilter.labelMatch` any/all, сегмент «Любая/Все» в фильтре меток |
| 5 | TASK-17 `time-format-toggle` | ✅ реализовано, PR #30 смержен — «Авто/12ч/24ч» в шапке, `useHour12` во всех поверхностях со временем |
| 6 | TASK-18 `quiet-updated-at` | ✅ реализовано, PR #31 смержен — `quiet: true` + `TOUCH_CARD`, один штамп на сеанс правок |
| 6.1 | TASK-18.1 `card-archive` | ✅ реализовано, PR #32 смержен — `Card.archivedAt`, архив/восстановление с WIP, массовый архив колонки |
| 7 | TASK-14.1 `views-v2` | ✅ реализовано, PR #26 смержен — интерактивные календарь (drag-сроки, «Без срока», неделя/месяц, панель дня) и таблица (сортировка, инлайн-редактирование, настройки колонок) |
| 8 | TASK-19 `bundle-split` | ✅ реализовано, PR #34 смержен — критический путь 1539→503 KB raw, FCP 344→212 мс |
| 9 | TASK-15 `pwa-offline` | ✅ реализовано, PR #35 смержен — манифест, иконки, SW поверх финального бандла |
| 10 | TASK-33 `undo-history-fix` | ✅ реализовано, PR #36 — точные снапшоты истории при нескольких dispatch в одном тике |
| 11 | TASK-34 `lazy-views` | ✅ реализовано, PR #37 — календарь/таблица снова lazy, motion-чанк; критический путь ~932→~654 KB raw (фактически ~768 — motion-иконки шапки оставались на критическом пути; снято в TASK-21.9) |
| 12 | TASK-21.1 `ci-lint` | ✅ реализовано, PR #38 смержен — CI (tsc/test/build/lint/format/size-limit), ESLint+Prettier, бюджет 237.7/260 KB gzip; пойманы 2 реальных бага (условный hook в DndBoard, ref-запись в рендере CardDialog) |
| 13 | TASK-42 `dnd-spacing-jump` | ✅ реализовано, PR #39 — прыжок колонки на 8px при старте драга/фильтра (зоны вставки = спейсеры всегда); в коммите ошибочно назван TASK-35 — см. запись в `ROADMAP-DONE.md` |
| 13 | TASK-21.2 `data-safety` | ✅ реализовано, ветка `feature/TASK-21.2-data-safety` — баннер вместо тоста, карантин битого JSON, подтверждение+автоэкспорт в ErrorBoundary |
| 14 | TASK-21.3 `sw-fixes` | ✅ реализовано, ветка `feature/TASK-21.3-21.4-sw-fixes-context-split` — ошибочные ответы больше не кэшируются как app shell, `CACHE_VERSION` = хеш сборки (плагин Vite, `sw.js` переехал из `public/` в `src/pwa/`) |
| 15 | TASK-21.4 `context-split` | ✅ реализовано, та же ветка — три контекста (стейт / actions / canUndo-canRedo), `memo` на карточках, общий резолвер меток, ротация бэкапов по ключам + trailing-снимок; замер: 5 нажатий в заголовке карточки — шапка 5→1 рендер, чужие карточки 5→0 |
| 15 | TASK-21.4.1 `memo-columns` | ✅ реализовано, та же ветка — `memo` на колонке, зоне вставки и строке таблицы; правка карточки перерисовывает только свою колонку/строку, рендеров на нажатие 86 → 37 и больше не растёт с числом карточек |
| 16 | TASK-21.5 `limits-rebalance` | ✅ реализовано — LIMITS: карточек/колонку 200, колонок/доску 12, досок 10; предупреждение >80 % квоты — см. §6.0.1 |
| 17 | TASK-21.6 `i18n-lazy` | ✅ реализовано — ru-каталог ленивым чанком (−6 KB gzip с критического пути), en остаётся в бандле для оффлайн-первой загрузки |
| 18 | TASK-21.7a `deterministic-actions` | ✅ реализовано, ветка `feature/TASK-21.7-history-inverse` — `grep -c "createId()\|Date.now()" src/store/board-reducer.ts` → 0, третий аргумент `withActivity` |
| 19 | TASK-21.7b `invertible-actions` | ✅ реализовано, та же ветка — id в `ADD_*`/`DUPLICATE_*`, `TOGGLE_*`→`SET_*{on,done}`, `MOVE_CARD.fromIndex`, `UNARCHIVE_CARD.index`, `SET_COLUMN_CARD_ORDER` |
| 20 | TASK-21.7c `restore-actions` | ✅ реализовано, та же ветка — `RESTORE_CARD/COLUMN/LABEL/CHECKLIST/CHECKLIST_ITEM` + `RESTORE_COLUMN_CARDS` (инверсия массового архива) |
| 21 | TASK-21.7d `inverse-history` | ✅ реализовано, та же ветка — `invert.ts` + property-тест, `BoardHistory` на парах `{do, undo}`, история вынесена в `useUndoHistory` |
| 22 | TASK-21.8 `browser-router` | ✅ реализовано, ветка `feature/TASK-21.8-browser-router` — BrowserRouter (`/board/:id`, `?card=`), контракт SPA-fallback — `deploy/nginx.conf`; `navigator.platform` → UA-CH с фоллбаком |
| 23 | TASK-21.9 `motion-lazy` | ✅ реализовано, ветка `task-21-9` — motion-чанк вне критического пути: иконки шапки грузятся после idle (вариант Б), критический путь ~786→~653 KB raw / 239.2→197.9 KB gzip, отдельный size-бюджет на ленивый чанк — см. §6.0.1 |
| 24 | TASK-21.10 `touch-dnd` | ✅ реализовано, PR #62 смержен — тач-DnD доски (Mouse+Touch+Keyboard сенсоры dnd-kit); тач-слой календаря/таблицы остаётся в TASK-31 |
| 25 | TASK-21.11 `dialog-reset-touch-dbltap` | ✅ реализовано, PR #64 смержен — сброс диалогов единым ремоунтом (+ правило в AGENT.md), двойной тач-тап по заголовку колонки открывает переименование (`use-double-tap`) |
| — | touch-хотфиксы | ✅ PR #65/#66 смержены — ховер-кнопки не «невидимо тапабельны» на таче (вариант `no-hover`); создание карточки на таче через концевую зону (`touchVisible`) |
| 26 | TASK-22 `monorepo-restructure` | ✅ реализовано, PR #67 смержен — npm workspaces: `ui/` + `shared/` (`@janosik/shared`: модель, редьюсер, invert, envelope, storage-keys, DTO/SSE-контракт `api.ts`), алиасы vite/tsconfig/vitest, CI с `-w ui`; гейты без изменений — 627 тестов (ui 397 + shared 230) |
| 27 | TASK-23 `backend-scaffold` | ✅ реализовано — NestJS 11 + Prisma в `backend/` (workspaces, см. §7.2): `/api/v1/health` с пингом БД, модули-заглушки (auth c 501 и rate-limit 5/мин), helmet + ValidationPipe, prisma-миграция User, docker-compose postgres:16 (5433, БД `janosik`+`janosik_test`), CI — postgres-сервис + e2e; команда DoD в AGENT.md |
| 28 | TASK-24 `backend-auth` | ✅ реализовано (dev+qa сабагенты, merge `6a0e215`) — POST /auth/register·login·refresh·logout + GET /auth/me (prefix api/v1): argon2id, JWT access 15 м (payload sub) + refresh 30 д как opaque-токен (sha256-hash в `RefreshToken`, сырьё только в httpOnly-куке SameSite=Strict, Path=/api/v1/auth), ротация + **детект реюза revoked → отзыв всех сессий юзера**, первый зарегистрированный → `isSuperAdmin`, JwtStrategy перечитывает юзера из БД, регистрация/логин 5/мин (429 в e2e), регистрация дубликата → 409, fail-fast: `JWT_SECRET` обязателен (envalid, ≥32 симв.) | гейты: backend 16 unit + 15 e2e (полный цикл, реюз, guard-роуты 401, 429, детерминизм ×2 прогона), ui 397 + shared 230 не тронуты; CI получил `JWT_SECRET`; миграция `20260916000001_add_refresh_token` |
| 29 | TASK-25 `boards-members` | ✅ реализовано (Orca dev+qa, PR #69 смержен, merge `679aa1f`) — полная схема §7.3 (Board, BoardMember ADMIN/MEMBER/VIEWER + `expiresAt`, Column, Card, Label m2m, Checklist, ChecklistItem, Activity, Comment, Command, ApiToken): soft-delete `deletedAt` на всех удаляемых сущностях + `version` на редактируемых, FK RESTRICT (каскады — флаги на уровне приложения); boards CRUD + membership (invite/PATCH/DELETE — ADMIN, протухший VIEWER → 403 с ленивой чисткой строки, last-ADMIN защищён при demote и remove), MembershipGuard (порядок 401→404→403→роль), агрегат `GET /boards/:id` = модель фронта (архив в cards map), import/export через shared envelope с round-trip (cover/due/wip/archived; id ремапятся — документированное отклонение); `@janosik/shared` подключён в backend без build-степа shared | гейты (независимый qa-воркер): backend 21 unit + 31 e2e, build/lint/format, ui 397 + shared 230, tsc, runtime-смоук (2 юзера, инвайт, агрегат, экспорт); миграция `20260916153804_full_schema` |
| 30 | TASK-26 `columns-cards` | ✅ реализовано (PR #70 смержен, merge `25d0448`) — командный лог колонок/карточек §7.4: `POST /boards/:id/commands` (идемпотентность по `commandId`, строгий validate → `400 {field}`, WIP/лимиты → `409 {conflict:"wip"}`, `ifMatch` → `409 {conflict:"version"}` + FOR UPDATE-сериализация доски), `GET ?since=<seq>` — дельта, per-action writers §7.4.1 вариант В, контрактный e2e «агрегат == boardReducer» | гейты: backend 21 unit + 46 e2e, build/lint/format, shared 292, ui 397; live-смоук на dev-БД |
| 31 | TASK-27 `labels-checklists` | ✅ реализовано — команды меток (`ADD_LABEL`, `RENAME_LABEL`, `SET_LABEL_COLOR`, `DELETE_LABEL`, `RESTORE_LABEL` с `assignments`) и чек-листов с пунктами (`ADD/RENAME/DELETE_CHECKLIST`, `ADD/SET_CHECKLIST_ITEM_DONE/RENAME/DELETE_CHECKLIST_ITEM`); m2m `CardLabel.position`, каскад метки soft-delete, лимиты коллекций → `409 {conflict:"wip"}`, инверсии не отклоняются; контрактный e2e + `Label.position` (миграция) | гейты: backend 21 unit + 65 e2e, build/lint/format, shared 317, ui 397; live-смоук 41/41 |
| 32 | TASK-28 `activity-comments` | ✅ реализовано — ленты `GET /boards/:id/activity` и `GET /cards/:id/activity` (слияние Command + Activity по времени, составной курсор, `?limit=`), member-события (invited/role/expiry/removed) со снапшот-`details`, комментарии REST (`POST`/`GET /cards/:id/comments`, `DELETE /comments/:id` — только автор, `LIMITS.comment`), `CardAccessGuard` для card/comment-роутов | гейты: backend 21 unit + 65 e2e, build/lint/format, shared 317, ui 397; live-смоук 41/41 |
| 33 | TASK-29 `optimistic-adapter` | ✅ реализовано — серверный режим UI: адаптер команд (`POST /boards/:id/commands`, FIFO-очередь на доску, коалесинг quiet-правок), `ifMatchVersions` (undo текста не затирает чужую правку → `409 {conflict:"version"}`), старт-гидратация `GET /boards` + агрегаты, login/register-экран, миграция localStorage через `POST /boards/import` (архивные карточки включительно), refetch на focus с пометкой чужих сущностей dead, откаты с тостами; + board-level команды `RENAME_BOARD`/`ARCHIVE_BOARD`/`UNARCHIVE_BOARD` (archive/unarchive — ADMIN в сервисе) и `role` в `GET /boards` | гейты: ui 451 (397+54, покрытие 95.3/87.8/93.4/97.7), shared 322, backend 21 unit + 72 e2e, build/lint/format, size 204.07/210 KB; live-смоук: Orca-браузер (register → миграция → команда «Done» → reload), API 12/12 |
| 34 | TASK-43 `master-admin-panel` | ✅ реализовано вне очереди по запросу — мастер-контур (§7.0/§7.4): `AdminUser` (OWNER/OPERATOR, отдельные cookie/JWT-аудиенция/refresh-таблица), `/admin/auth/*` + `/admin/*` (метрики с runtime, юзеры, доски, **карточки, комментарии, сессии, API-токены**, журнал команд, аудит), **редактор контента доски через командный лог от имени владельца**, модерация (блок юзера + ревок сессий/токенов по одной, архив/soft-delete доски и карточки, удаление комментария), управление мастерами только у OWNER, CLI `admin:create/passwd/list`, аудит каждого действия, lockout и anti-timing логина, ID всех сущностей с копированием, поиск по ID, удаление `User.isSuperAdmin`; **таблицы schema-first** (`Board.id`/`BoardMember.userId`/`Card.columnId`/`Comment.authorId`/…, FK-айди как значения, поиск по айди, без счётчиков, скролл-вьюпорт со sticky-шапкой) | гейты: ui 483, shared 325, backend 22 unit + 100 e2e, build/lint/format, size 204.66/210 KB + ленивый admin-чанк 20.7/30 KB; live-смоук: CLI → браузер (вход мастера, создание мастера из панели, блок юзера, Playwright-смоук) |
| 35 | TASK-35 `board-members-ui` | ✅ реализовано, PR #74 — участники доски из UI (§7.6.1): модалка «Участники (N)» из шапки (`BoardMembersDialog` + `UserAvatar`), инвайт по email, смена роли, `expiresAt` для VIEWER с бейджем «доступ истёк», исключение с инлайн-подтверждением, последний ADMIN защищён (disabled + тултип-причина), ошибки API → тосты; **VIEWER получает read-only UI** (нет drag/композеров/меню/инлайн-редакторов, диалог карточки только для чтения, `roleOf` → `readOnly` через BoardSection); `GET /boards/:id/members` уже отдавал `userId`/`displayName`/`email` — бэкенд не менялся | гейты: ui 512 (485+27, покрытие выше порогов), shared 325, backend 22 unit + 100 e2e не тронуты, build/lint/format; live-смоук |
| 30 | TASK-30 `realtime-sse` | ✅ реализовано, ветка `feature/TASK-30-realtime-sse`; доборы — TASK-30.1 ✅ (`touches` в событии + бюджет ленивого чанка) и TASK-30.2 ✅ (audit hardening) — §7.5 — SSE `GET /boards/:id/events` (`{type:"command", seq, action, actorId}`) + догон `?since=`; `X-Board-Seq` на агрегате; UI-мост в ленивом чанке (`fetch`-ридер с Authorization вместо EventSource+ticket), чужие экшены через тот же `boardReducer`, дедуп по seq, defer при in-flight командах, focus refetch остался fallback | два браузера видят правки без перезагрузки; обрыв догоняется дельтой (live-смоук 8/8, включая `setOffline`) |
| — | TASK-36…41 | совместный UI, релиз и полировка — **порядок и DoD в §7.7** (TASK-22…29, TASK-35 и TASK-43 сделаны); детали: совместный UI — §7.6.1, релиз и E2E — §7.8. Следующий — TASK-36 `presence-attribution` |

### 6.0.1. Укрепление фундамента перед бэкендом (TASK-21.1…21.11)

Одна задача = одна ветка = один PR, порядок — как в таблице §6.0.

#### TASK-21.1 — `ci-lint` · CI + ESLint + Prettier + бюджет бандла ✅

- **Статус:** ✅ реализовано, PR #38 смержен — полное описание в
  `ROADMAP-DONE.md`. Next: TASK-21.2.

#### TASK-21.2 — `data-safety` · Защита от потери данных ✅

- **Статус:** ✅ реализовано, PR #40 смержен — полное описание в
  `ROADMAP-DONE.md`. Next: TASK-21.3.

#### TASK-21.3 — `sw-fixes` · Две правки в service worker ✅

- **Статус:** ✅ реализовано, ветка `feature/TASK-21.3-21.4-sw-fixes-context-split`
  — полное описание в `ROADMAP-DONE.md`. Next: TASK-21.5.

#### TASK-21.4 — `context-split` · Рендер-производительность ✅

- **Статус:** ✅ реализовано, ветка `feature/TASK-21.3-21.4-sw-fixes-context-split`
  — полное описание в `ROADMAP-DONE.md`. Next: TASK-21.5.

#### TASK-21.4.1 — `memo-columns` · Мемоизация колонок, зон и строк таблицы ✅

- **Статус:** ✅ реализовано, ветка `feature/TASK-21.3-21.4-sw-fixes-context-split`
  — полное описание в `ROADMAP-DONE.md`. Next: TASK-21.5.

#### TASK-21.5 — `limits-rebalance` · Калибровка LIMITS ✅

- **Статус:** ✅ реализовано, ветка `feature/TASK-21.5-limits-rebalance`
  — полное описание в `ROADMAP-DONE.md`. Next: TASK-21.6.
- **Что:** текущие лимиты допускают 10 000 карточек/доску (~10–106 MB JSON)
  при квоте localStorage ~5 MB. Цифры зафиксированы (§6.0.1, «Решённые
  вопросы» п.4): `cardsPerColumn 500→200`, `columnsPerBoard 20→12`,
  `boardsCount 50→10`; **`description` остаётся 10000** — понижение обрежет
  существующие описания через `clampText` в `migrate.ts`. Плюс превентивное
  предупреждение при >80 % квоты (замер `JSON.stringify` перед записью).
- **DoD:** максимальные данные по LIMITS помещаются в квоту; предупреждение
  срабатывает заранее; **цифры в §7.3 (абзац «`LIMITS` гвардят на DTO») и
  `@db.VarChar` в схеме обновлены под новые значения** — иначе бэкенд
  унаследует старые лимиты.

#### TASK-21.6 — `i18n-lazy` · Ленивые локали ✅

- **Статус:** ✅ реализовано, PR #48 смержен — полное описание в
  `ROADMAP-DONE.md`. Next: TASK-21.7.

- **Что:** динамический импорт каталога `./locales/${lang}/translation.json`
  вместо статических en+ru в бандле; типобезопасность ключей сохраняется
  (`import type` от EN-каталога, рантайм — динамический).
- **Эффект:** −10–15 KB gzip с критического пути, дальше — на каждый новый язык.
- **DoD:** переключение языков работает (в т.ч. оффлайн-первая загрузка —
  дефолтная локаль в бандле); тесты i18n зелёные.

#### TASK-21.7 — `history-inverse` · Undo на инверсных экшенах ✅

- **Статус:** ✅ реализовано (21.7a+b+c+d), ветка
  `feature/TASK-21.7-history-inverse` — по прямой просьбе пользователя все
  четыре шага сделаны одним PR (разбивка ниже сохранена как порядок
  коммитов). Полное описание — в `ROADMAP-DONE.md`. Next: TASK-21.9.

#### TASK-21.7a — `deterministic-actions` · Детерминизм редьюсера (корень) ✅

- **Статус:** ✅ реализовано, ветка `feature/TASK-21.7-history-inverse`
  — полное описание в `ROADMAP-DONE.md`.

#### TASK-21.7b — `invertible-actions` · Обратимость структурой экшена ✅

- **Статус:** ✅ реализовано, та же ветка — полное описание в
  `ROADMAP-DONE.md`.

#### TASK-21.7c — `restore-actions` · Обратимость разрушающих операций ✅

- **Статус:** ✅ реализовано, та же ветка — полное описание в
  `ROADMAP-DONE.md`.

#### TASK-21.7d — `inverse-history` · История на инверсиях (+ хук) ✅

- **Статус:** ✅ реализовано, та же ветка — полное описание в
  `ROADMAP-DONE.md`.
- **⚠️ Не входило сюда:** политика конфликтов undo («чужая правка текста →
  отказ с тостом») требует `version`/SSE с сервера — TASK-29/30. В коде
  есть задел: `BoardHistory.push(..., { foreign: true })` не пускает чужую
  команду в стек, не чистит redo и помечает пересечённые шаги `dead`.

#### TASK-21.8 — `browser-router` · HashRouter → BrowserRouter ✅

- **Статус:** ✅ реализовано, ветка `feature/TASK-21.8-browser-router` —
  роутер в App заменён на BrowserRouter; неизвестные пути по-прежнему
  работают как home (редирект на активную доску — поведение не менялось);
  контракт хостинга для deep-links закреплён в `deploy/nginx.conf`
  (`try_files … /index.html`; полный деплой-стек — в TASK-38);
  `navigator.platform` (deprecated, пустой на части Android) →
  `userAgentData?.platform` с фоллбаком, общий хелпер `isMacPlatform`
  для ShortcutsDialog и GlobalSearch. Next: TASK-21.9.

#### TASK-21.9 — `motion-lazy` · Анимированные иконки вне критического пути ✅

- **Статус:** ✅ реализовано, ветка `task-21-9` — обёртка
  `src/components/ui/lazy-animated-icon.tsx` (`React.lazy` + `Suspense`,
  статичный lucide-двойник как fallback) грузит motion-иконки после
  `requestIdleCallback` (фоллбэк — `setTimeout`); все потребители (шапка,
  свитчеры фона/языка/времени, поиск, архив, шорткаты, стекло колонок)
  переведены на неё. **Факты замера:** критический путь ~786→~653 KB raw
  (239.2→197.9 KB gzip), `motion-*.js` больше нет в `modulepreload`
  `dist/index.html`; 12 иконок уехали в отдельные чанки (~8.9 KB gzip) вместе
  с `motion` (40.9 KB gzip), грузятся после idle. `size-limit` разбит на два
  бюджета: критический **210 KB** (факт 197.9) и ленивые иконки **55 KB**
  (факт 49.4); второй — `running: false`, гоняется только по размеру.
  Next: TASK-21.10.
- **Решение пользователя:** вариант Б — motion остаётся, анимированные иконки
  шапки грузятся лениво после `requestIdleCallback`; статичные `lucide-react`
  иконки на первом рендере.
- **Что:** обёртка `LazyAnimatedIcon` (React.lazy + Suspense со статичной
  иконкой как fallback), хедер импортирует только её; motion-чанк исключается
  из `modulepreload`.
- **Эффект:** −41.4 KB gzip с критического пути (~786→~653 KB raw); бренд без
  изменений; минус — короткая подмена иконки при первом рендере.
- **DoD:** motion-чанка нет в `modulepreload` `dist/index.html`; иконки
  анимируются после idle; size-limit бюджет обновлён. ✅

#### TASK-21.10 — `touch-dnd` · Тач-DnD доски ✅

- **Статус:** ✅ реализовано, PR #62 смержен — полное описание в
  `ROADMAP-DONE.md`. Осталась TASK-21.11; дальше — §7.7 (TASK-22…).

#### TASK-21.11 — `dialog-reset-touch-dbltap` · Унификация сброса диалогов + фикс двойного тапа ✅

- **Статус:** ✅ реализовано, PR #64 смержен — полное описание в
  `ROADMAP-DONE.md`. Фундамент §6.0.1 закрыт; дальше — §7.7 (TASK-22…).

#### Открытые решения (за пользователем)

*(пусто — все вопросы закрыты, см. ниже)*

#### Решённые вопросы

1. **API: командный лог (вариант Б) — решено пользователем 2026-09.**
   Мутации — `POST /boards/:id/commands {commandId, action, ifMatch?}`,
   сервер применяет тот же `boardReducer` из `shared/` (3 мутационных
   endpoint'а вместо ~35); порядок через `seq`, идемпотентность через
   `commandId`, SSE шлёт те же экшены, undo = инверсная команда, лог команд
   = активность. Для PAT (§7.6) позже тонкий REST-фасад. §7.0/§7.2/§7.4/§7.5/
   §7.7 переписаны под это решение. Дедлайн «до TASK-23» выполнен с запасом.

2. **Запись результата редьюсера в таблицы — вариант В (per-action писатели),
   решено 2026-09.** Полный разбор трёх вариантов — §7.4.1. Коротко: редьюсер
   из `shared/` применяется для **валидации и формирования ответа**, а строки
   пишет маленький `writer(action, tx)` на тип экшена. Дифф агрегатов (А)
   отвергнут — дифферр по позициям и вложенности дороже 37 писателей и хуже
   отлаживается; запись агрегата целиком (Б) отвергнута — O(размер доски) на
   каждую команду и шум в `updatedAt` несвязанных строк.
   Расхождение писателей с редьюсером гасит **обязательный контрактный тест**
   на каждый экшен: применить команду через API → перечитать агрегат →
   сравнить с `boardReducer(before, action)`. «Редьюсер — источник правды»
   становится проверяемым инвариантом, а не соглашением.

3. **`activity` из результата редьюсера на сервер не пишется — решено
   2026-09.** События карточек выводятся из Command-лога (§7.3), колонки
   активности у `Card` нет. Реализация: `boardReducer` принимает третьим
   аргументом опции `{ withActivity?: boolean }` (по умолчанию `true` —
   клиент показывает событие оптимистично сразу); сервер зовёт с `false`.
   Контрактный тест (п.2) сравнивает агрегаты, посчитанные с `false` на обеих
   сторонах. Флаг **добавлен в TASK-21.7a**: `boardReducer(state, action,
   { withActivity: false })` — карточка создаётся вообще без поля `activity`.

4. **Калибровка `LIMITS` — цифры зафиксированы (TASK-21.5), решено 2026-09.**

   | Лимит | Было | Стало | Почему |
   | --- | ---: | ---: | --- |
   | `cardsPerColumn` | 500 | **200** | 500 нереальны для одной колонки и не рендерятся без виртуализации |
   | `columnsPerBoard` | 20 | **12** | 20 колонок не помещаются в экран ни на одном разрешении; 12 — уже щедро |
   | `boardsCount` | 50 | **10** | 50 досок × даже средний размер не влезают в квоту |
   | `description` | 10000 | **10000 (не трогаем)** | см. ниже — понижение стирает данные |

   Максимальная доска: 12 × 200 = 2400 карточек ≈ **2.6 МБ** (замер: ~1.07 КБ
   на карточку с чек-листом и активностью) — одна такая помещается в квоту
   ~5 МБ с запасом. Совокупность из 10 досок гарантированно не влезает, и это
   **осознанно**: жёстко гарантировать сумму невозможно без абсурдно низких
   лимитов, поэтому реальный страж — превентивное предупреждение при >80 %
   квоты и баннер (TASK-21.2), а `LIMITS` работают как защита от разгона.

   **`description` понижать нельзя.** `migrate.ts` клампит описание при
   загрузке (`clampText(rest.description, LIMITS.description)`), то есть
   уменьшение константы **молча обрежет уже написанные описания** при
   следующем открытии приложения. Это потеря данных, а не калибровка.
   Ранняя рекомендация «10000→5000» была выдана без учёта этого клампа —
   отменяется. Если когда-нибудь понадобится
   понизить: сначала развести «лимит ввода» (UI `maxLength`) и «лимит
   хранения» (миграция), иначе никак.

   Понижение `cardsPerColumn`/`columnsPerBoard` безопасно: редьюсер блокирует
   только **добавление** сверх лимита, существующие данные не режутся
   (та же семантика «мягкого лимита», что у WIP в TASK-13), а `normalizeBoard`
   колонки и карточки не слайсит.

5. **Период физической чистки soft-delete — 30 дней, решено 2026-09.**
   Конвенция индустрии (Notion/Jira trash — 30 дней). Джоб-чистильщик
   гоняется раз в сутки, удаляет сущности с `deletedAt < now() - 30d`
   вместе с детьми. До истечения срока запись видна в «Корзине» (§7.6) и
   восстановима. Константа — `PURGE_AFTER_DAYS` в `shared/`, чтобы UI мог
   честно писать «удалится через N дней».

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
> Старт бэкенда — **после** TASK-21.1…21.11 (порядок §6.0). Далее §7.7 —
> 19 шагов: TASK-22…29 (ядро) → TASK-35 → TASK-30 → TASK-36 → TASK-37
> (совместный UI, §7.6.1) → TASK-38a…41 (релиз, демо, наблюдаемость, E2E,
> §7.8) → TASK-31/32 (полировка).
> **Форма поставки — самохостимый опенсорс под MIT** (§7.8).

### 7.0. Ключевые решения (зафиксированы, не пересматривать без явной причины)

- **Monorepo, npm workspaces**: `ui/` (фронт), `backend/` (NestJS),
  `shared/` (`@janosik/shared` без build-степа): модель, `LIMITS`, envelope
  экспорта, `STORAGE_KEYS`, **DTO-типы API** (контракт фронт↔бэк).
- **Нормализованная схема** — «полный канбан на бэке»: колонки/карточки/
  метки/чеклисты/активность/комментарии — SQL-таблицы (§7.3), не Json-документ.
  Позиции — целочисленные `position` (порядок меняется командами
  `MOVE_COLUMN`/`MOVE_CARD`/`SET_COLUMN_CARD_ORDER`; перенумерация — сервер).
- **API — командный лог (решение пользователя 2026-09 — вариант Б, §6.0.1):**
  мутации едут одним транспортом — `POST /boards/:id/commands
  {commandId, action, ifMatch?}`; сервер применяет **тот же `boardReducer`
  из `shared/`** и пишет команду в лог (Command, §7.3). `commandId`
  (клиентский uuid) — первичный ключ → идемпотентные ретраи; `seq`
  (монотонный) — порядок операций и версия доски; несовпадение `ifMatch` →
  `409 {conflict, currentVersion}`. Чтение — обычный REST (§7.4): агрегат,
  members, activity-ленты, import/export. SSE шлёт типизированные события
  (`command` / `presence` / `activity`, §7.4); `command` несёт тот же экшен,
  и чужие изменения применяются тем же редьюсером (TASK-30). Undo —
  инверсная команда из стора (TASK-21.7d); сервер не
  знает, что это отмена. Для PAT/интеграций (§7.6) позже тонкий REST-фасад
  поверх тех же команд.
- **Фронт — optimistic без переписывания UI**: редьюсер остаётся
  единственным источником UI-состояния (мгновенный отклик, undo/redo
  работают). Адаптер шлёт команду асинхронно и **reconcile**-ит canonical
  ответ (позиции, версии). Провал вызова → откат экшена (инверсия) + тост.
  **id генерирует клиент** (TASK-21.7a) и едет в команде → идемпотентные
  ретраи, undo создания = инверсная команда с тем же id.
  **Предусловие выполнено (TASK-21.7a/b):** редьюсер детерминирован, id
  создаваемых сущностей и время — в payload, `commandId` едет в каждой
  команде (`BoardScopedAction.commandId`, пока клиентом не используется).
- **Доступ — membership с ролями (решение пользователя 2026-09):**
  `BoardMember {board, user, role: ADMIN|MEMBER|VIEWER, expiresAt?}`.
  Создатель доски — первый ADMIN. **ADMIN** — управление доской (роли
  участников, архив/удаление, invite); **MEMBER** («клиент») — создавать/
  редактировать/архивировать карточки; **VIEWER** — только чтение,
  опционально **с ограничением по времени** (`expiresAt` — протух → guard
  отдаёт 403, запись чистится лениво). Guard проверяет роль на каждом
  board-scoped endpoint; `actorId` во всей активности — реальный юзер.
  **Платформенные роли — только мастер-контур (TASK-43):** `AdminUser`
  живёт отдельно от `User` и не появляется в регистрации; вход — свой
  `/admin/auth/*`, отдельные cookie (`admin_refresh_token`,
  `path=/api/v1/admin/auth`) и JWT-аудиенция (`janosik-admin`), так что
  юзер-токен не проходит в `/admin`, а мастер-токен — в юзер-API. Два
  уровня: **OWNER** (создаётся только CLI; управляет мастерами из панели:
  создаёт/блокирует/ресетит пароли) и **OPERATOR** (полный доступ к данным,
  управления мастерами нет — украденная сессия оператора не эскалирует).
  Пароли — argon2id, lockout после 5 ошибок, каждое действие — в
  `AdminAuditLog`. Авто-выдача прав по «первому зарегистрированному»
  удалена: эскалация возможна только через CLI на сервере или owner-сессию.
- **API-токены (после ядра, §7.6):** персональные токены «вместо пароля»
  для скриптов/интеграций — действуют от имени своего юзера (его роли),
  в БД только hash, показ один раз, ревокация и `lastUsedAt`; мастер
  может выпускать/отзывать токены юзеров (TASK-43: ревок всех активных
  токенов юзера из панели).
- **Синхронизация мульти-юзеров:** MVP — refetch агрегата доски при focus
  окна; затем **SSE** (`GET /boards/:id/events`) в TASK-30 — живые чужие
  изменения, в TASK-36 к ним добавляется присутствие. Курсоров в реальном
  времени (Figma-стиль) **не делаем** — для канбана это шум, а не ценность;
  достаточно «кто сейчас на доске» и «кто изменил эту карточку».
  WebRTC/CRDT не нужны (разрешение конфликтов — last-write-wins на уровне
  сущности + активность).
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
  физическое `onDelete: Cascade`); физическая чистка — суточным job'ом
  **через 30 дней** (`PURGE_AFTER_DAYS` в `shared/`; §6.0.1 «Решённые
  вопросы» п.5). Это же делает undo разрушающих операций дешёвым (инверсия —
  снятие флага, §6.0.1 TASK-21.7c) и даёт «Корзину» как задел.
  `version Int` (инкремент при записи, проверка `ifMatch` → `409`) — на
  **каждой сущности, несущей редактируемое текстовое поле**, иначе политику
  конфликтов undo (выше) нечем исполнить: `Board.title`, `Column.title`,
  `Card.title`/`description`, `Label.name`, `Checklist.title`,
  `ChecklistItem.text` — то есть `Board`, `Column`, `Card`, `Label`,
  `Checklist`, `ChecklistItem`. `CardLabel` (m2m) версии не имеет —
  привязка метки булева и разрешается по LWW.
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
│   ├── admin/               # мастер-контур (§7.6): /admin/auth + /admin, owner-guard, аудит (TASK-43)
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
  disabledAt    DateTime?                        // блок мастером (TASK-43): вход/refresh → 403
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
  createdAt DateTime  @default(now()) // страница «Сессии» в панели (TASK-43)
  @@index([userId, createdAt])
}

model Board {
  id         String       @id @default(cuid())
  title      String       @db.VarChar(100)   // LIMITS.boardTitle
  archivedAt DateTime?
  deletedAt  DateTime?                       // soft-delete (§7.0)
  version    Int          @default(0)        // ifMatch → 409 (title редактируем)
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

enum AdminRole { OWNER OPERATOR }                // мастер-контур (TASK-43)

model AdminUser {                                // «мастер» — не User, отдельный контур входа
  id            String         @id @default(cuid())
  email         String         @unique
  passwordHash  String
  displayName   String?
  role          AdminRole      @default(OPERATOR) // OWNER управляет мастерами из панели
  failedLogins  Int            @default(0)        // lockout-счётчик
  lockedUntil   DateTime?                         // после 5 ошибок — 15 мин
  disabledAt    DateTime?
  lastLoginAt   DateTime?
  createdAt     DateTime       @default(now())
}

model AdminRefreshToken {                        // своя cookie/аудиенция, не пересекается с юзерской
  id        String    @id @default(cuid())
  tokenHash String    @unique
  admin     AdminUser @relation(fields: [adminId], references: [id])
  adminId   String
  expiresAt DateTime
  revokedAt DateTime?                            // ротация; реюз revoked → отзыв всех сессий мастера
  createdAt DateTime  @default(now())
  @@index([adminId])
}

model AdminAuditLog {                            // каждое действие мастера, включая логины
  id         String     @id @default(cuid())
  admin      AdminUser? @relation(fields: [adminId], references: [id])
  adminId    String?
  adminEmail String                                // снапшот (в т.ч. для неизвестного email)
  action     String                                // admin.login | user.create | board.archive | …
  targetType String?
  targetId   String?
  details    Json?
  createdAt  DateTime   @default(now())
  @@index([createdAt])
  @@index([adminId, createdAt])
  @@index([targetType, targetId])
}

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
  result    Json                           // ответ первого применения {seq, versions}
  touches   String[]                       // ["card:c1","column:col-2"] — затронутые сущности
  createdAt DateTime @default(now())
  @@index([boardId, seq])
  @@index([boardId, touches])              // ленты активности по сущности (§7.4)
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
  lastActorId String?                    // TASK-36: «кто изменил» на лице
                                         // карточки. Денормализация: пишет
                                         // writer команды (§7.4.1). Без
                                         // relation на User — иначе второй
                                         // именованный relation ради аватара,
                                         // а имя всё равно берётся из уже
                                         // загруженного списка участников
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
  position  Int     @default(0)             // TASK-27: порядок в board.labels
  deletedAt DateTime?                       // soft-delete (§7.0)
  version   Int     @default(0)             // ifMatch → 409 (§7.0)
  cards     CardLabel[]
  @@index([boardId, position])
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
  version   Int       @default(0)         // ifMatch → 409 (title редактируем)
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
  version     Int       @default(0)     // ifMatch → 409 (text редактируем)
  @@index([checklistId, position])
}

// Граница с Command-логом (решено вместе с вариантом Б):
//   Command  — ВСЁ, что является `BoardAction` (создание/правка/перемещение/
//              архив колонок, карточек, меток, чек-листов). 10 типов событий
//              карточки TASK-12/18.1 выводятся ИЗ НЕГО, дублировать сюда
//              нечего.
//   Activity — только то, что экшеном редьюсера НЕ является и потому не может
//              лежать в Command (`payload` там типизирован как BoardAction):
//              membership (invite / смена роли / исключение) и комментарии.
// Лента = слияние двух источников по `createdAt` (курсор — составной).
model Activity {
  id        String   @id @default(cuid())
  board     Board    @relation(fields: [boardId], references: [id])
  boardId   String
  card      Card?    @relation(fields: [cardId], references: [id])
  cardId    String?
  type      String                        // member_invited | member_role_changed
                                          // | member_removed | comment_added | …
  actor     User     @relation(fields: [actorId], references: [id])
  actorId   String                         // теперь реальный юзер
  details   Json?                          // снапшот-детали (email, роль, …)
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
  text      String   @db.VarChar(2000)   // LIMITS.comment — plain text,
                                         // не markdown (TASK-37, §7.6.1)
  deletedAt DateTime?                    // soft-delete (§7.0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([cardId, createdAt])
}
```

`LIMITS` (TASK-20) гвардят на DTO: `@ArrayMaxSize` для меток/чеклистов при
импорте, счётчики перед insert. **Числа не дублировать — брать из
`@janosik/shared` (`LIMITS`)**, включая `@db.VarChar(N)` в схеме выше:
TASK-21.5 (`limits-rebalance`) меняет `cardsPerColumn`, `description` и
`boardsCount`, и любой захардкоженный здесь дубль сразу разъедется.
Актуальные значения после калибровки (§6.0.1 «Решённые вопросы» п.4,
внедряет TASK-21.5): чеклистов ≤ 20/карточка, пунктов ≤ 100, меток ≤ 20 на
карточке и ≤ 50 на доске, **колонок ≤ 12, карточек ≤ 200 в колонке, досок
≤ 10 на юзера**, `description` ≤ 10000, `comment` ≤ 2000 (TASK-37).

**Soft-delete — семантика (§7.0):** все `DELETE`-endpoint'ы проставляют
`deletedAt` у сущности **и её детей** (каскад — кодом сервиса или
Prisma-миграцией, не `onDelete: Cascade`); выборки фильтруют
`deletedAt: null`; физическая чистка — суточный job, **30 дней**
(`PURGE_AFTER_DAYS`). `GET /boards/:id` агрегат включает карточки
с `archivedAt`, но **не включает** `deletedAt` — удалённое из агрегата
не возвращается и в «Корзину» (§7.6, по запросу) отдаётся отдельным
endpoint'ом.

### 7.4. API — командный лог + чтение (`/api/v1`) (решение 2026-09: вариант Б)

**Мутации — один транспорт для всех действий редьюсера:**

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/boards/:id/commands` | `{commandId, action, ifMatch?, ifMatchVersions?}` → `200 {seq, versions}` · `400` (validate) · `409 {conflict, currentVersion}`. `ifMatchVersions` (TASK-29) — позаписные предусловия (`card:<id>` → version) для undo текста: чужая правка → `409 {conflict:"version"}` |
| GET | `/boards/:id/commands?since=<seq>` | дельта-догон после обрыва SSE (вместо перезапроса агрегата) |

Сервер: `validate()` (строгий, §7.0) → `boardReducer(board, action)` из
`shared/` → транзакция (Command-лог + нормализованные таблицы §7.3).
Идемпотентность: повтор с тем же `commandId` возвращает сохранённый
`Command.result`, а не создаёт вторую сущность. Отказы редьюсера
(WIP `atWipLimit`, лимиты) → `409 {conflict: "wip"}` — предикат общий с
фронтом. `Command.touches` заполняет применяющий слой — по нему строятся
ленты активности и инвалидация undo-стека на клиенте.

#### 7.4.1. Как результат редьюсера попадает в таблицы — ✅ решено (вариант В)

**Решение 2026-09: вариант В (per-action писатели) + контрактный тест** —
см. §6.0.1 «Решённые вопросы» п.2–3. Ниже — разбор, на основании которого
выбирали; при пересмотре читать его, а не переигрывать заново.

Редьюсер возвращает **новый
агрегат `Board`**, а БД хранит нормализованные строки (§7.3). Между «→» в
строке выше спрятан слой, который должен понять, *что именно изменилось*.
Три варианта, и они дают три разных бэкенда:

| Вариант | Как | Плюсы | Минусы |
| --- | --- | --- | --- |
| **А. Дифф агрегатов** | загрузить агрегат → применить редьюсер → сравнить «до/после» → сгенерировать INSERT/UPDATE/DELETE | одна общая логика для всех 37 экшенов; редьюсер — единственный источник правды | нужен дифферр (позиции, вложенность, чеклисты); дифф широкий — легко переписать больше, чем изменилось |
| **Б. Писать агрегат целиком** | upsert всех строк доски в транзакции | тривиально реализуется | O(размер доски) на каждый чих; блокировки; `updatedAt` шумит на несвязанных строках — не годится |
| **В. Per-action писатели** (рекомендация) | редьюсер применяется **для валидации и для ответа**, а запись делает маленький `writer(action, tx)` на тип экшена | точечные запросы; понятная транзакция; версии/`touches` считаются явно | ~37 маленьких писателей; риск разъехаться с редьюсером — гасится e2e «команда → агрегат совпадает с результатом редьюсера» |

**Выбран В**, с обязательным контрактным тестом на каждый экшен: применить
команду через API, перечитать агрегат `GET /boards/:id` и сравнить с
`boardReducer(before, action, { withActivity: false })`. Тогда «редьюсер —
источник правды» сохраняется как **проверяемый инвариант**, а не как надежда.
Вариант А остаётся запасным, если писателей окажется слишком много.

**Активность (решено там же).** Редьюсер создаёт
`Card.activity[]` с `activityId` из payload, но в §7.3 у `Card` нет колонки
активности — события карточки выводятся из `Command`-лога. Поэтому
`boardReducer` принимает опции `{ withActivity?: boolean }` (по умолчанию
`true` — клиент показывает событие оптимистично сразу), а сервер зовёт его с
`false` и ничего про активность не пишет. Флаг **добавлен в TASK-21.7a**.

**Auth (без guard):** `POST /auth/register` · `POST /auth/login` ·
`POST /auth/refresh` (ротация) · `POST /auth/logout` · `GET /auth/me`.

**Доски и участники (JwtGuard + MembershipGuard):**

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/boards` | мои доски (по membership): title, archivedAt, счётчики, **`role` вызывающего (TASK-29 — ADMIN-only действия UI)** |
| POST | `/boards` | создать (REST, aggregate-level: доска + первый ADMIN-membership; не экшен редьюсера) |
| GET | `/boards/:id` | **агрегат доски** — колонки (только активные `cardIds`) + cards-мапа **включая архив** (`archivedAt`) + метки (+ чеклисты) одной выборкой — стартовое состояние UI |
| DELETE | `/boards/:id` | только ADMIN (последний ADMIN защищён); rename/archive доски — команды `RENAME_BOARD`/`ARCHIVE_BOARD` |
| GET | `/boards/:id/members` | участники: `userId`, `displayName`, `email`, роль, `expiresAt` (имя и почта нужны для аватаров и модалки — TASK-35) |
| GET | `/invitations` | **pending**-приглашения вызывающего (опциональные инвайты, TASK-35): борда, роль, `expiresAt`, кто пригласил |
| POST | `/invitations/:id/accept` | принять приглашение — строка становится membership (истёкший VIEWER-инвайт → 409, чужая/неизвестная → 404) |
| POST | `/invitations/:id/decline` | отклонить — pending-строка удаляется, доступ не выдаётся |
| POST | `/boards/:id/members` | invite `{email, role, expiresAt?}` — только ADMIN; создаёт **pending**-приглашение (TASK-35 addendum: доступ появляется только после accept) |
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

Ленты активности **сливают два источника** (граница — в комментарии к
`model Activity`, §7.3): `Command` (всё, что является `BoardAction` — фильтр
по `touches`, курсор по `seq`) и `Activity` (membership и комментарии — то,
что экшеном редьюсера не является). Курсор составной (`seq` + `createdAt`),
порядок — по времени. Лимит 50/карточку снят — история хранится целиком.

**Мастер-контур (TASK-43; отдельные аудиенция и cookie, guard `AdminJwtAuthGuard`):**

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/admin/auth/login` · `refresh` · `logout` · GET `me` | вход мастера; cookie `admin_refresh_token`, `Path=/api/v1/admin/auth`, ротация + детект реюза; логин 10/мин + lockout 5 ошибок/15 мин |
| GET | `/admin/metrics` | счётчики платформы + 14-дневные серии регистраций/команд + `runtime` (версия, uptime, латентность БД, env) |
| GET | `/admin/users?search&status&limit&offset` | все юзеры: счётчики досок/сессий/токенов, `disabledAt` |
| POST | `/admin/users` | создать юзера; без пароля — сгенерированный, показывается один раз |
| PATCH | `/admin/users/:id` | `{disabled?, displayName?}`; блок немедленно ревокает сессии |
| POST | `/admin/users/:id/sessions/revoke` · `/tokens/revoke` | ревок всех сессий / API-токенов |
| GET | `/admin/boards?search&status` | все доски: владелец, участники, счётчики, архив/soft-delete |
| GET | `/admin/boards/:id/content` | агрегат доски для редактора контента (та же модель, что у UI) |
| POST | `/admin/boards/:id/commands` | контент-команда `BoardAction` **от имени владельца доски** — через командный лог, а не прямыми записями; аудит `board.command` |
| GET | `/admin/cards?search&status` | все карточки: доска/колонка, счётчик комментариев, архив/soft-delete |
| POST | `/admin/cards/:id/archive` · `/unarchive` · DELETE | модерация карточки (soft-delete каскадом на чек-листы) |
| GET | `/admin/sessions?search` | активные refresh-сессии всех юзеров (кто/вход/истекает) |
| POST | `/admin/sessions/:id/revoke` | ревок **одной** сессии |
| GET | `/admin/tokens?search&status` | все персональные API-токены (`name`, `lastUsedAt`, `expiresAt`, revoked) |
| POST | `/admin/tokens/:id/revoke` | ревок одного токена |
| GET | `/admin/comments?search` | все комментарии (модерация), включая удалённые |
| DELETE | `/admin/comments/:id` | soft-delete любого комментария |
| POST | `/admin/boards` | создать доску для владельца (он становится ADMIN) |
| POST | `/admin/boards/:id/archive` · `/unarchive` · DELETE | модерация доски (soft-delete — тот же каскад, что у юзеров) |
| GET | `/admin/commands?search` | журнал команд по всем доскам |
| GET | `/admin/audit?search` | аудит действий мастеров |
| GET/POST/PATCH | `/admin/admins…` | **только OWNER**: список мастеров, создание (пароль один раз), блок/разблок, `POST /admin/admins/:id/password/reset`, `POST /admin/admins/:id/sessions/revoke`; себя заблокировать нельзя, последний активный OWNER защищён |

Всё содержимое панели отдаётся без секретов: `passwordHash`, `tokenHash` и
сырые refresh-токены не выбираются ни в одном запросе. Все мутации
мастер-контура пишут `AdminAuditLog` (кто, что, объект, детали); создание
мастеров вне CLI невозможно.

**Импорт/экспорт:**

| POST | `/boards/import` | envelope `parseExport` → создание доски целиком |
| GET | `/boards/:id/export` | envelope JSON — тот же формат, что UI-файл |

Round-trip-гарантия: cover, dueDate, `wipLimit`, `archivedAt` переносятся
в обе стороны без потерь (сериалайзер фронта их уже пишет — сверить
envelope в shared на TASK-22). Activity при импорте **не переносится** —
события сервер пишет сам с реальным actorId.

**Realtime (TASK-30):**

| GET | `/boards/:id/events` | SSE-поток. Событие всегда несёт `type`: `command` — `{type, seq, action, actorId, touches}` (TASK-30; `touches` добавлен TASK-30.1 — тот же список `card:<id>`/`column:<id>`/…, что сервер пишет в `Command.touches`), те же экшены, что уходят командами; `presence` — `{type, users: [{id, displayName}]}`, список подключённых, шлётся при подключении/отключении и heartbeat'ом раз в 30 с (TASK-36); `activity` — не-редьюсерные события из `model Activity`, прежде всего новый комментарий (TASK-37) |

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
  SSE `{type: "command", seq, action, actorId}` → чужой экшен применяется
  тем же `boardReducer`; обрыв — догон `?since=` дельтой.
- **Офлайн:** тост «нет сети, изменения не сохранены», очередь команд —
  с PWA (TASK-15).

**Реализация (TASK-29) — решения и отклонения:**

- **Серверный режим включается окружением:** `VITE_API_URL` (default
  `/api/v1`; dev-прокси Vite → `:3000`), в vitest режим выключен — прежние
  компонентные тесты остаются локальными, а серверный путь покрыт
  интеграционными тестами с fake-сервером на том же `boardReducer`.
- **Board-level команды:** `RENAME_BOARD`/`ARCHIVE_BOARD`/`UNARCHIVE_BOARD`
  добавлены в backend (по §7.4 они и должны были быть командами):
  archive/unarchive — ADMIN в сервисе (гвард не умеет роли по типу экшена),
  `role` отдаётся в `GET /boards` для ADMIN-only действий UI.
- **Позаписные предусловия вместо board-`ifMatch`:** `ifMatch` блокировал бы
  undo текста при любой чужой команде, а позиции — LWW (§7.0). Клиент шлёт
  `ifMatchVersions` только для текстовых сущностей в undo/redo; сервер
  отвечает `409 {conflict:"version"}`.
- **Гидратация тянет все агрегаты** (≤`LIMITS.boardsCount`): multi-board UI,
  глобальный поиск и экспорт работают без изменений; ленивая подгрузка —
  при росте числа досок.
- **localStorage в серверном режиме не пишется** (иначе доски одного
  аккаунта утекали бы в сессию другого на общем браузере); авто-бэкапы
  выключены, ручной бэкап/экспорт остаются локальной страховкой.
- **StrictMode:** гидратация одиночная (in-flight promise), `ServerSync`
  `revive()/dispose()` — двойной маунт dev-режима не дублирует импорт и не
  блокирует очередь.
- **Undo чужого текста:** focus-refetch сравнивает агрегат с локальной
  доской и помечает затронутые шаги dead — undo пропускает их с тостом
  `sync.foreignEdit`; незамеченная гонка ловится `ifMatchVersions`.

#### TASK-30.1 — `realtime-refinements` · Добор к SSE (TASK-30)

> **Откуда взялась.** TASK-30 закрыт по DoD, но в реализации осознанно
> остались два «хвоста», которые видны только на больших досках и в
> CI-бюджетах. Оба маленькие и локальные, поэтому идут отдельной задачей
> сразу после TASK-30 и до TASK-36: presence/атрибуция лягут на контракт
> событий, и переделывать его позже — дороже.

**Контекст, из которого растёт задача:**

- Ленивый чанк realtime (`ui/src/store/realtime.ts` →
  `dist/assets/realtime-*.js`) никем не стережётся: у критического пути,
  анимированных иконок, календаря, стилей и админки бюджеты есть, а у
  него — нет. Сегодня это 3.12 KB raw / 1.48 KB gzip, но «нет бюджета» =
  «можно незаметно утолстить».
- При каждой чужой команде мост (`createRealtimeBridge`) вызывает
  `changedEntityIds(before, after)` — полный JSON-дифф всей доски (все
  колонки, все карточки, метки; `stableStringify` по каждой сущности),
  чтобы пометить затронутые шаги undo чужими. Сервер уже знает точный
  список (`Command.touches`: `card:<id>`, `column:<id>`, `label:<id>`,
  `checklist:<id>`, `checklistItem:<id>`, `board:<id>`; пишется с
  TASK-26), но в событие не попадает — и клиент пересчитывает его сам. На
  доске 12×200 карточек это заметная работа на каждое чужое событие
  (коалесинг правок текста её смягчает, но не убирает), а сам дифф шире
  фактического `touches` (например, `TOUCH_CARD`/`updatedAt`), из-за чего
  undo может считаться чужим там, где содержательно ничего не менялось.

**Что входит (подзадачи, обе обязательны):**

1. **`touches` в SSE-контракте.** `CommandSseEvent` и `CommandDeltaEntry`
   (`shared/src/api.ts`) получают обязательное `touches: string[]` — ровно
   то, что записал сервер. `CommandsService.apply` кладёт посчитанный
   `touches` в публикуемое событие (у no-op-команд он пустой — и это
   корректно: помечать нечего); `listSince` добавляет колонку `touches` в
   select и в элементы дельты, поэтому догон `?since=` и живой поток несут
   один контракт. `EventsController` транслирует поле как есть. Обновить
   §7.4 (сделано), комментарии в `shared/src/api.ts`, fake-сервер
   (`ui/src/test/fake-server.ts`) и `realtime.mjs` при необходимости.
2. **Мост без диффа.** `createRealtimeBridge.applyForeign` берёт `touches`
   из события, срезает префикс (`card:` → id; `board:<id>` → сам
   `boardId`) и отдаёт id в `markForeign` — `changedEntityIds` из этого
   пути убирается. Неизвестный префикс пропускается (контракт
   расширяемый). Fallback на дифф **не делаем**: легаси-строки с пустым
   `touches` — это no-op-команды, а расширяемость закрыта обязательностью
   поля. Тест: чужая правка помечает шаг undo чужим **без focus-рефетча**,
   Ctrl+Z пропускает его с тостом `sync.foreignEdit` (сегодня это умеет
   только refetch — у diff-пути тот же результат, но по другому поводу).
3. **Бюджет на ленивый realtime-чанк** в `ui/package.json` → `size-limit`:
   запись `realtime (SSE-мост и ридер, gzip)` с limit `6 KB` и
   `running: false` (замер только по сборке, как у остальных ленивых
   чанков), CI печатает отдельную строку. Заодно зафиксировать в
   ROADMAP-DONE фактические цифры и оставить запас ≥3×: критический путь
   сейчас 209.81/210 KB — на пределе, и всё, что можно, должно уезжать в
   этот чанк.

**DoD:**

- Живое событие и элемент `?since=` несут `touches`; backend
  `events.e2e-spec.ts` проверяет поле в живом кадре и в догоне.
- `changedEntityIds` не вызывается на каждое чужое событие; тест на
  пропуск undo-шага от чужой правки без focus-рефетча зелёный.
- `npm run size -w ui` показывает отдельную строку бюджета realtime-чанка.
- Гейты: tsc/lint/format/build, backend unit+e2e, ui с порогами покрытия,
  live-смоук `realtime.mjs` 8/8 (контракт события изменился — проверить
  сквозь браузер).

**Что сюда сознательно не входит:**

- **Rebase pending-команд через инверсии** (§7.5, «в идеале») — пересчёт
  своих и чужих команд на общем порядке; отдельная большая задача со своим
  DoD. MVP-поведение (deferred-очередь + LWW) задокументировано в TASK-30
  и остаётся; кандидат в план после TASK-37, если расхождения при
  одновременном редактировании станут заметны пользователям.
- **Redis fan-out** для нескольких нод — по-прежнему точка расширения
  `RealtimeService` (§7.0), вне текущей фазы.
- **Буферизация SSE за nginx** — уже покрыта TASK-38a.

**Выполнено (2026-09-17), ветка `feature/TASK-30.1-30.2-realtime-hardening`:**
`touches` поехал в `CommandSseEvent`/`CommandDeltaEntry` (publish после коммита и
`listSince`), мост зовёт `touchedEntityIds(event.touches)` вместо
`changedEntityIds`, ленивый чанк получил запись в `size-limit` — 6 KB gzip при
фактических 1.59 KB. Подробности и цифры — `ROADMAP-DONE.md` (TASK-30.1).

#### TASK-30.2 — `hardening-followups` · Добор по итогам аудита покрытия

> **Откуда взялась.** После 30.1 прогнали аудит покрытия (команды ↔ e2e,
> покрытие UI, известные незакрытые места). Из находок выбраны четыре,
> которые дороже всего чинить позже и дешевле всего — сейчас. Все — про
> доверие к входным данным и про те места, где уже один раз выстрелило
> (redo create-команд, гонка refresh).

1. **Ownership entity id.** Все upsert'ы писателей матчат только глобальный
   `id`; id, совпавший с сущностью другой доски (баг клиента, злой умысел),
   молча переименовывает/перетаскивает/переподчиняет чужую строку. Перед
   записью команды сервер собирает client-supplied id из экшена (включая
   вложенные restore-снапшоты) и отвечает `409 {message, field}` «Entity id
   already used on another board», если хоть один принадлежит другой доске.
   Проверка — в той же транзакции, после replay-короткого пути; id, которых
   нет нигде, по-прежнему создаются (и неизвестные — no-op, как у редьюсера).
2. **Строгость payload.** Явный лимит на json-body (`MAX_IMPORT_BYTES` вместо
   неявных 100 KB Express — большие `RESTORE_*` сейчас молча ловят 413 от
   парсера) + `MAX_COMMAND_BYTES` на одну команду (413 с внятным телом).
   `validateCard` получает вложенную проверку restore-снапшотов:
   `description` по `LIMITS.description`, `dueDate`/`archivedAt`, `cover` через
   существующий валидатор, `checklists` по `LIMITS.checklistsPerCard`/
   `itemsPerChecklist`; у `validateChecklist` — кап на items, у
   `validateColumn` — на `cardIds`. Через `RESTORE_*` больше нельзя протащить
   текст/структуры в обход лимитов.
3. **Тесты моста (закрыть дыры покрытия TASK-30).** Фейк-сервер публикует
   собственные команды в поток (паритет с продом) — own-echo становится
   достижимым: тест фиксирует, что своё эхо (в т.ч. пришедшее до ack) не
   применяется как чужое и не убивает свой undo-шаг. Deferred-очередь: пока
   команда в полёте, чужое событие копится и применяется после ack, в
   порядке seq; успешный серверный undo/redo (`mergeVersions` + `settled`)
   тоже проверяется.
4. **e2e undo/redo через `invert`.** Ни один бэкенд-тест не импортирует
   `invert`, поэтому «точный undo» не зафиксирован ни для одной пары. Новый
   `commands-undo.e2e-spec.ts`: команда → инверсия → агрегат обязан
   deep-equal совпасть с состоянием до команды (RENAME_*, SET_*, MOVE_CARD/
   MOVE_COLUMN, SORT_COLUMN, ARCHIVE_*, TOUCH_CARD, SET_CARD_LABEL on/off).

**DoD:** 409 на чужой id (e2e, `command-ids.e2e-spec.ts`); вложенная
валидация и лимиты (+тесты shared); ui-тесты моста (own-echo, deferred,
серверный undo); `commands-undo.e2e-spec.ts` зелёный; гейты, покрытие,
size-limit и live-смоуки без регрессий.

**Выполнено (2026-09-17), ветка `feature/TASK-30.1-30.2-realtime-hardening`:**
`assertIdsBelongToBoard` + `referencedEntityIds` (409 на чужие id во всех
create-shaped действиях), `MAX_COMMAND_BYTES` 2 MB и явный json-лимит 5 MB,
вложенная валидация `RESTORE_*`; fake-сервер эхоит свои команды и умеет
`holdNextCommand` — own-echo/deferred/успешный undo покрыты; 17 пар
«команда → `invert`» возвращают агрегат deep-equal. Цифры и детали —
`ROADMAP-DONE.md` (TASK-30.2).

### 7.6. Разблокированные фичи (после TASK-29, по запросу — не запланированы)

> **Решение пользователя 2026-09 (пересмотр):** прежняя формулировка «UI в
> текущем виде конечен, авторы и комментарии — потом» **отменена**. Причина:
> она оставляла проект в странном финале — совместный бэкенд построен
> полностью (роли, membership, `actorId` в каждой команде, API комментариев),
> а в интерфейсе двое видят, как карточки двигаются сами, без единого
> признака, кто это делает. Это те ~20 % работы, в которых живёт вся
> воспринимаемая ценность остальных 80 %.
>
> Поэтому **участники, атрибуция и комментарии переведены в план** —
> §7.6.1, TASK-35…37. Ниже в §7.6 остаётся то, что действительно делается
> по запросу. Assignee по-прежнему отложен: в TASK-26 хватит миграции
> `Card.assigneeId?` + колонки таблицы (слот зарезервирован, TASK-14.1 п.11).

- Автоматизации («карточка в Done → снять срок», правила по меткам —
  Trello Butler): ложатся поверх командного лога естественно — триггер
  на тип команды, действие — ещё одна команда от системного actor'а.
- Уведомления (email/in-app: mention, дедлайны).
- Вложения (multipart, файловое хранилище).
- **API-токены** — `POST /auth/tokens` {name, expiresAt?} (токен показывается
  один раз), `GET /auth/tokens`, `DELETE /auth/tokens/:id`; JwtStrategy
  принимает и PAT (hash-lookup, `lastUsedAt` тикает); супер-админ выпускает/
  отзывает токены юзеров (`POST /admin/users/:id/tokens`). Схема
  `ApiToken` уже в §7.3.
- **Мастер-панель** — ✅ сделано вне очереди по запросу: TASK-43
  `master-admin-panel` (§7.4, `ROADMAP-DONE.md`). Отдельный вход, роль
  OWNER/OPERATOR, аудит; юзеров можно создавать/блокировать/ревокать их
  сессии и токены, доски — архивировать/удалять, у OWNER — управление
  мастерами. `User.isSuperAdmin` из плана удалён как мёртвый флаг
  (миграция `20260917120000_master_admin`).
- **Исполнители (assignee)** — `Card.assigneeId?`, колонка таблицы и бейдж
  на карточке; membership-проверка, что юзер состоит в доске.
- **Embed-снапшот доски** — `GET /embed/:token`, публичный read-only SSR HTML.
- Рабочие пространства (`Workspace`/`Team` над досками). *(VIEWER-роль из
  этого пункта уехала в ядро — §7.0, реализуется в TASK-25.)*
- «Корзина» — просмотр и восстановление удалённого до истечения
  `PURGE_AFTER_DAYS` (30 дней); soft-delete уже всё для этого хранит.

*(Присутствие и комментарии из этого списка переехали в §7.6.1 —
TASK-36 и TASK-37.)*

### 7.6.1. Совместный UI — TASK-35…37 (запланировано)

Три задачи, превращающие «данные синхронизируются» в «мы работаем вместе».
Бэкенд для всех трёх уже построен к TASK-28 — здесь только интерфейс плюс
одно денормализованное поле и расширение SSE-контракта.

#### TASK-35 — `board-members-ui` · Участники доски и приглашения

- **Зачем:** до этой задачи второго человека на доску **невозможно добавить
  из интерфейса** — только руками в БД. Это не полировка: DoD TASK-30 («два
  браузера видят изменения друг друга») без неё честно не выполняется.
- **Что:**
  - `components/ui/user-avatar.tsx` — инициалы из `displayName` (фолбэк —
    первая буква email), детерминированный цвет из хеша `userId` по палитре
    токенов `index.css`, размеры sm/md/lg, полное имя в тултипе. Базовый
    кирпич для TASK-36/37;
  - модалка «Участники (N)» из шапки рядом со свитчером досок: аватар, имя,
    email, роль; для VIEWER — срок и бейдж «доступ истёк»;
  - **ADMIN:** инвайт по email, смена роли, исключение, выбор `expiresAt`
    для VIEWER; **MEMBER/VIEWER** — тот же список read-only;
  - последний ADMIN защищён: действия заблокированы с тултипом-причиной;
  - ошибки API (юзера нет, уже участник, 403) — тосты.
- **Трогаем:** `Header.tsx`, новые `BoardMembersDialog.tsx` +
  `ui/user-avatar.tsx`, адаптер (§7.5), `locales/*`.
- **API:** endpoints есть с TASK-25. Нужно только, чтобы
  `GET /boards/:id/members` отдавал `userId`, `displayName`, `email` —
  не только роль и срок (§7.4).
- **DoD:** ADMIN приглашает второго юзера, тот видит доску в `GET /boards`;
  смена роли применяется; VIEWER получает read-only UI и 403 на мутацию;
  последний ADMIN не удаляется; строки в `en` и `ru`; тесты на модалку и
  ролевые гварды.
- **Зависимости:** TASK-29.

#### TASK-36 — `presence-attribution` · Кто что делает

- **Зачем:** после TASK-30 чужие правки прилетают, но выглядят как «карточки
  двигаются сами». Самая дешёвая часть работы с самой высокой отдачей.
- **Что:**
  - `Card.lastActorId` — денормализация (§7.3), пишет per-action writer
    (§7.4.1); на лице карточки аватар последнего изменившего рядом с
    «изменено N назад», **только если это не я**;
  - лента активности карточки: аватар + `displayName` вместо безличных
    строк (`actorId` пишется с TASK-28);
  - «сейчас на доске» — стопка аватаров в шапке (до 5 + «+N»);
  - подсветка чужого изменения: карточка/строка, изменённая не мной,
    на 2 с получает мягкое кольцо; при `prefers-reduced-motion` —
    статичный бейдж без анимации;
  - **чего не делаем:** тостов «Борис архивировал X» — на живой доске это
    шум; хватает подсветки и ленты.
- **Контракт SSE расширяется** (§7.0/§7.4): событие получает `type` —
  `command` (`{seq, action, actorId}`), `presence` (`{users: [{id,
  displayName}]}`), `activity` (для TASK-37). Presence: сервер держит
  список подключённых к доске `EventSource`, шлёт список при подключении и
  отключении + heartbeat раз в 30 с; отвалившийся клиент исчезает за ≤60 с.
- **Трогаем:** `CardItem.tsx`, `TableView.tsx`, `CardActivityFeed.tsx`,
  `Header.tsx`, sync-слой, `backend/src/commands` (presence-канал),
  `locales/*`.
- **DoD:** два браузера — каждый видит аватар другого в шапке; изменённая
  чужим карточка подсвечивается; лента показывает, кто именно; закрытие
  вкладки убирает аватар за ≤60 с; `prefers-reduced-motion` учтён.
- **Зависимости:** TASK-30, TASK-35 (`UserAvatar`).

#### TASK-37 — `comments-ui` · Комментарии в карточке

- **Зачем:** API готов с TASK-28, интерфейса нет — самая заметная дыра
  «бэкенд есть, UI нет».
- **Что:**
  - секция «Комментарии (N)» в диалоге карточки под активностью: аватар,
    имя, относительное время, текст; поле ввода (Enter — отправить,
    Shift+Enter — перенос строки); удаление своего с подтверждением;
  - пагинация «показать ещё» по курсору (`GET /cards/:id/comments?cursor`);
  - **plain text, не markdown.** MDXEditor в поле комментария — это 640 KB
    ради жирного шрифта плюс новая XSS-поверхность; ссылки автолинкуются,
    остальное остаётся текстом;
  - чужой комментарий прилетает по SSE (`type: "activity"`) и появляется
    без перезагрузки;
  - `LIMITS.comment = 2000` + счётчик «осталось N» через общий
    `ui/limit-counter.tsx`.
- **Трогаем:** `CardDialog.tsx`, новый `CardComments.tsx`,
  `types/kanban.ts` (`LIMITS.comment`), sync-слой, `locales/*`.
- **DoD:** комментарий пишется / удаляется / пагинируется; чужой прилетает
  живым; лимит гвардит с счётчиком; `en` + `ru`; тесты.
- **Зависимости:** TASK-28 (API), TASK-35 (`UserAvatar`, инвайты), TASK-36 (тип
  события `activity` в SSE).

### 7.7. Порядок итераций (строго по порядку)

| # | TASK | Ветка | Суть | DoD (кратко) |
| --- | --- | --- | --- | --- |
| 1 | TASK-22 `monorepo-restructure` ✅ | `feature/TASK-22-monorepo` | `git mv` фронта в `ui/`, workspaces, `@janosik/shared` (модель+LIMITS+envelope+STORAGE_KEYS+**DTO-типы API и `BoardAction` — контракт фронт↔бэк, форма экшенов к этому моменту финализирована TASK-21.7a/b**; envelope сверить с сериалайзером архива/обложек/сроков — round-trip §7.4), `SAVE_DEBOUNCE_MS` в константы, алиасы vite/tsconfig/vitest | все фронт-тесты зелёные в новом layout, tsc/build зелёные. **Выполнено: PR #67** — 627 тестов (ui 397 + shared 230), coverage выше порогов у обоих пакетов, migrate/seed/text переехали как жёсткие зависимости редьюсера; envelope round-trip подтверждён перенесённым тестом |
| 2 | TASK-23 `backend-scaffold` ✅ | `feature/TASK-23-backend-scaffold` | NestJS + Prisma + docker-compose(postgres:16), `/health`, модули-заглушки, общий tsconfig/ESLint, helmet + rate-limit на auth-роутах сразу | `/health` 200; e2e-пайплайн работает; backend-команды DoD в AGENT.md. **Выполнено:** NestJS 11 + Prisma 6 в `backend/` (workspaces), `/api/v1/health` (пинг БД, 503 при недоступности), модули §7.2-заглушки, auth-роуты 501 с `@Throttle` 5/мин (e2e ловит 429), helmet + ValidationPipe, миграция User, compose postgres:16-alpine на 5433 (dev + тестовая БД), CI: postgres-сервис + backend unit/e2e + build; гейты — 627 (ui+shared) + 6 backend |
| 3 | TASK-24 `backend-auth` ✅ | `feature/TASK-24-backend-auth` | register/login/refresh/logout/me, argon2id, `displayName`, `isSuperAdmin` (первый юзер), ротация refresh + детект реюза, JwtGuard | e2e: полный цикл auth + реюз revoked → отзыв сессий; guard-роуты 401; rate-limit на /auth/login. **Выполнено:** merge `6a0e215` — argon2id; access 15 м (JWT) + refresh 30 д (opaque, sha256 в БД, httpOnly-кука); ротация атомарна (`updateMany`), реюз revoked → отзыв всех сессий; 401 логина без user-enumeration (dummy-verify на незнакомом email); `--runInBand` для e2e (общая тест-БД + in-memory throttle); JWT_SECRET обязателен, ≥32 симв.; 16 unit + 15 e2e |
| 4 | TASK-25 `boards-members` ✅ | `feature/TASK-25-boards-members` | Полная схема §7.3 + миграции **включая soft-delete (`deletedAt`) и `version` — с первого дня, каскады проставлением флага** (§7.0); boards CRUD, membership с ролями ADMIN/MEMBER/VIEWER + `expiresAt` (invite/смена роли — только ADMIN, протухший VIEWER → 403), `GET /boards/:id` агрегат (активные cardIds + cards с archivedAt), import/export с round-trip cover/due/wip/archived | e2e: CRUD, роли (VIEWER-мутация → 403, expiresAt → 403), 403 чужой доске; aggregate shape = модель фронта (включая архив); soft-delete: DELETE прячет сущность, выборки фильтруют `deletedAt`. **Выполнено: PR #69, merge `679aa1f`** — Orca dev+qa; гейты: backend 21 unit + 31 e2e + build/lint/format + ui 397 + shared 230; отклонения задокументированы (id-ремап при импорте, Board.cards без opposite-relation, ленивая чистка expired VIEWER, +DELETE member) |
| 5 | TASK-26 `columns-cards` ✅ | `feature/TASK-26-columns-cards` | Команды колонок/карточек (CRUD, move/reorder с позициями, duplicate — id копии от клиента, archive/unarchive/mass-archive, TOGGLE→SET, SET_COLUMN_CARD_ORDER) поверх командного лога; WIP — отказ команды общим `atWipLimit`; каскады — soft-delete §7.3. **Предусловие: решён §7.4.1** (как результат редьюсера ложится в таблицы) — от него зависит форма всего модуля | e2e: команды apply/reject; повтор `commandId` возвращает сохранённый `result`, дубля нет; позиции стабильны; archive round-trip; WIP 409; каскад колонки; `ifMatch` 409; **контрактный тест §7.4.1: агрегат после команды == `boardReducer(before, action)`**. **Выполнено: PR #70, merge `25d0448`** — гейты: backend 21 unit + 46 e2e + build/lint/format, shared 292, ui 397; live-смоук на dev-БД (идемпотентный replay, WIP/version 409, `400 {field}`, каскад DELETE_COLUMN, RESTORE_CARD-orphan, `?since=`); конкурентные same-`ifMatch` сериализованы `FOR UPDATE` (один 200 / один 409) |
| 6 | TASK-27 `labels-checklists` ✅ | `feature/TASK-27-labels-checklists` | Команды меток (доска+карточка, m2m с позицией) и чек-листов + пунктов (включая `SET_CHECKLIST_ITEM_DONE`, RESTORE_*) | e2e: m2m round-trip, каскад метки (soft-delete), лимиты коллекций, restore-команды возвращают состояние. **Выполнено:** 13 команд меток/чек-листов, per-action writers зеркалят редьюсер (обновлён и `RESTORE_CHECKLIST` — перенумерация), `assertNoWipConflict` зеркалит лимиты (`labelsPerBoard`/`labelsPerCard`/`checklistsPerCard`/`itemsPerChecklist`, инверсии не отклоняются), схема: `Label.position` + миграция `20260916190000_label_position` (иначе порядок меток в агрегате недетерминирован), strict-validate в shared (+25 тестов); гейты: backend 21 unit + 65 e2e, build/lint/format, shared 317, ui 397; live-смоук |
| 7 | TASK-28 `activity-comments` ✅ | `feature/TASK-28-activity-comments` | Ленты активности поверх Command-лога (курсор по `seq`, фильтр по сущностям), member/comment-события в логе, комментарии (REST; UI позже — §7.6) | e2e: каждая мутирующая команда видна в лентах, actorId верный, пагинация, догон `?since=` отдаёт дельту без перезапроса агрегата. **Выполнено:** `ActivityService` сливает Command (`touches has card:<id>`) и `Activity` составным курсором `at:source:key` (команда раньше activity при равном мс, tie-break `seq`/`id` desc), member-события со снапшот-`details` (invite/role/expiry/remove), комментарии REST (plain text, только автор удаляет, `LIMITS.comment` добавлен в shared), `CardAccessGuard` (card/comment → board); гейты: backend 21 unit + 65 e2e, build/lint/format, shared 317, ui 397; live-смоук 41/41 |
| 8 | TASK-29 `optimistic-adapter` ✅ | `feature/TASK-29-optimistic-adapter` | Sync-слой: экшен→`POST /commands {commandId, action, ifMatch}`→`{seq, versions}`/`409`, undo=инверсная команда из стора (TASK-21.7d) с политикой конфликтов §7.0 (текст → отказ с тостом, позиции → LWW), 401/refresh single-flight, откаты, старт-агрегат → REPLACE_STATE, login-экран, миграция localStorage (включая архивные карточки) | UI полностью живёт с сервера; undo/redo и офлайн-тосты работают; undo при чужой правке текста отказывается с тостом, правка другого участника не теряется; 362+ фронт-тестов зелёные. **Выполнено** (координатором напрямую в `main`, ветка не заводилась): `ui/src/api/client.ts` (fetch-клиент, токен в памяти, single-flight refresh, retry 401), `auth/AuthContext` + `LoginPage` (login/register, i18n en+ru), `store/server-sync.ts` (FIFO-очередь на доску, коалесинг quiet-UPDATE_CARD, классификация отказов), `store/board-diff.ts` (dead-пометка чужих сущностей при focus-refetch), `BoardContext` серверный режим (гидратация `GET /boards`+агрегаты, откаты с тостами, `ifMatchVersions` для undo текста, миграция localStorage→`POST /boards/import`, REST create/delete/import, роли, без localStorage-записи), backend: board-level команды + `role` в `GET /boards` + `ifMatchVersions` (e2e); dev-прокси Vite. Гейты: ui 451 (397+54, coverage 95.3/87.8/93.4/97.7), shared 322, backend 21 unit + 72 e2e, build/lint/format, size 204.07/210 KB; live: Orca-браузер (register→миграция «Legacy Smoke»→колонка «Done»→reload) + API-смоук 12/12 |
| 9 | TASK-35 `board-members-ui` ✅ | `feature/TASK-35-board-members-ui` | §7.6.1: модалка «Участники», инвайт по email, смена роли, `expiresAt` для VIEWER, базовый `UserAvatar`. **Идёт до TASK-30:** без неё второго участника на доску не добавить, и DoD «два браузера» нечем выполнить | ADMIN приглашает, роль меняется, VIEWER read-only + 403 на мутацию, последний ADMIN защищён; en+ru; тесты. **Выполнено:** `BoardMembersDialog` (инвайт/роль/срок/исключение, last-ADMIN lock, тосты ошибок), `components/ui/user-avatar.tsx` (+`utils/avatar.ts`), кнопка в шапке рядом со свитчером, `readOnly`-цепочка BoardSection → DndBoard/ColumnView/CardDialog/TableView/CalendarView + `BoardTitle`, FakeServer научился роли; ui 508 (485+23), coverage выше порогов |
| 10 | TASK-30 `realtime-sse` ✅ | `feature/TASK-30-realtime-sse` | SSE `{type, seq, action, actorId}` + применение чужих экшенов тем же `boardReducer`, refetch-on-focus остаётся fallback; в идеале — rebase pending-команд через инверсии | два браузера видят изменения друг друга без перезагрузки; обрыв SSE догоняет `?since=` дельтой. **Выполнено:** `RealtimeService` (in-memory fan-out) + `GET /boards/:id/events` (`@Sse`, publish после коммита, `?since=`-догон, ping 25 с), `X-Board-Seq` на агрегате (REPEATABLE READ), UI-мост в ленивом чанке (fetch-ридер с Authorization, backoff/online/fatal, own-echo по ack-seq, deferred вместо rebase); backend 22 unit + 113 e2e, ui 522, live-смоук `realtime.mjs` 8/8 |
| 10.1 | TASK-30.1 `realtime-refinements` ✅ | `feature/TASK-30.1-30.2-realtime-hardening` | Добор к SSE (детали — §7.5) | события и дельта несут `touches`; мост помечает undo-foreign без диффа доски; отдельная строка size-limit (1.59/6 KB gzip); ui 525, backend 22 unit + 113 e2e; live-смоук `realtime.mjs` 8/8 — **PR #76, merge `1c33aeb`** |
| 10.2 | TASK-30.2 `hardening-followups` ✅ | `feature/TASK-30.1-30.2-realtime-hardening` | Добор по аудиту покрытия (детали — §7.5) | чужой id → 409 (`command-ids.e2e`); `MAX_COMMAND_BYTES` 2 MB + явный json-лимит 5 MB, вложенная валидация restore; own-echo не убивает undo, deferred после ack (ui 533); 17 пар undo-через-`invert` в `commands-undo.e2e`; shared 333, backend 22 + 121 e2e; live-смоуки зелёные; бюджет критического пути 300 KB по решению владельца. **Выполнено: PR #76, merge `1c33aeb`** (в ветке также 30.1, redo/refresh/tailwind-фиксы и фокус/фид-фиксы) |
| 11 | TASK-36 `presence-attribution` ✅ | `feature/TASK-36-presence-attribution` | §7.6.1: `Card.lastActorId` + аватар на карточке, аватары в ленте активности, стопка «сейчас на доске» (SSE-событие `presence`), подсветка чужого изменения | оба браузера видят аватар друг друга; чужая правка подсвечена; лента показывает кто; вкладку закрыли — аватар ушёл за ≤60 с. **Выполнено:** `PresenceService` (сессии per вкладка с дедупом по юзеру, join/leave-бродкасты, heartbeat 30 с, sweep TTL 60 с) + событие `presence` мимо seq-дедупа + `POST /boards/:id/presence` (heartbeat из UI раз в 20 с, `?client=` — стабильный tab-id); `lastActorId` пишут все карточные writers там же, где `updatedAt` (чистые reorder'ы — нет; контрактные e2e снимают поле `stripAttribution()` и проверяют штамп отдельно); UI-сторы `board-live.tsx` с узкими подписками — стопка в шапке (≤5 + «+N» → popover с ролями, пульс-точка, solo скрыт), автор + относительное время на карточке и в таблице (только чужое), кольцо 2 с в цвете автора (`prefers-reduced-motion` → статичная точка/заливка), имя+аватар в ленте; en+ru; ui 558 (72 файла), shared 334, backend 27 unit + 124 e2e; coverage 94.78/87.25/93.33/97.16; size critical 212.21/300, realtime 2.02/6, styles 15.67/18; live-проба двумя браузерами `presence-probe.mjs` 15/15 (ростер, кольцо, лента, таблица, уход по закрытию вкладки, персист `lastActorId` после reload) — **PR #77** |
| 11.1 | TASK-36.1 `account-panel` ✅ | `feature/TASK-36.1-account-panel` | По запросу владельца: вместо кнопки выхода — персональная панель (Linear-style: рейл разделов, на мобиле — табы). Профиль: имя, цвет аватара из палитры (серверный `User.avatarColor`, виден команде — карточки, лента, presence, кольцо атрибуции), email read-only; безопасность: смена пароля с ревоком остальных сессий (кука скоупится `/auth`, поэтому эндпоинт `POST /auth/password`, не `/users/me/password`), API-ключи не затрагиваются; **рабочие персональные API-ключи** (`jnk_…`, sha256 в БД, показ один раз, список/отзыв/`lastUsedAt`; PAT принимают `JwtAuthGuard` и `MembershipGuard`, admin-контур — нет); перенос из хедера языка/времени/фона в «Настройки» (тема живёт только там); Sign out — внизу панели с подтверждением. **Смена имени/цвета транслируется вживую всем:** `PresenceService.updateUser` перезаписывает открытые сессии без реконнекта, `membership change:"updated"` по всем бордам заставляет перечитать каталог (карточки, таблица, лента). **Профиль человека кликабелен отовсюду** (`UserProfileDialog`: presence-ростер, список участников, фейс автора на карточке/в таблице/ленте; онлайн-статус, роль, срок доступа). Осознанно не делаем (отдельные задачи): загрузка фото (нужно файловое хранилище), смена email (нужен мейлер и double opt-in), список активных сессий, 2FA | профиль/пароль/ключи работают из панели; цвет аватара видят остальные; панель не теряет борду (модалка, не роут); en+ru; тесты. **Выполнено:** миграция `20260918080434_user_avatar_color`; `UsersModule` (`PATCH /users/me`, `GET/POST/DELETE /users/me/tokens`), `AuthService.changePassword` + `ApiTokenService`; PAT-фолбэк в guard'ах; UI `components/account/*` (+4 тест-файла), i18n `account.*`; гейты: ui 593 (76 файлов), shared 336, backend 48 unit + 144 e2e, lint/tsc/prettier/build/size зелёные; живая проба `account-probe.mjs` 18/18, `rename-probe.mjs` 9/9 — **PR #78, merge `00de4d5`**; **догон:** фиксированная высота панели под вьюпорт (все вкладки одной высоты, длинный контент скроллится внутри; проба `account-height.mjs` 9/9) — **PR #80, merge `79e9d62`** |
| 11.2 | TASK-36.2 `board-switcher-roles` ✅ | `feature/TASK-36.2-board-switcher-roles` | По запросу владельца: в свитчере видно, где я админ, а где доступ «со стороны» | секции «Мои доски» (ADMIN) и «Совместные» (MEMBER/VIEWER), заголовки — только когда есть обе группы (иначе плоский список); на общих досках в слоте действия — иконка роли с тултипом и aria-label («Участник — можно редактировать» / «Наблюдатель — только просмотр») вместо пустого места, архив по-прежнему только у ADMIN; плоский клавиатурный порядок ↑/↓ и поиск не меняются; en+ru. **Выполнено локально (не закоммичено):** `BoardSwitcher` groups + `board.switcher.section.*`/`role.*`; `FakeServer.roles` per board; ui 597 (76 файлов), lint/tsc/prettier/build/size зелёные; живая проба `switcher-roles.mjs` 7/7 (секции, иконки, порядок) — **PR #79, merge `aaa97da`** |
| 12 | TASK-37 `comments-ui` ✅ | `feature/TASK-37-comments-ui` | §7.6.1: секция комментариев в диалоге карточки поверх API TASK-28, курсорная пагинация, живое прилетание по SSE, `LIMITS.comment`. По запросу владельца расширена до Jira-вида и дважды переоформлена после ревью: Activity — последняя секция, сегментные табы Comments/History (как переключатель видов доски), markdown-композер как у Description (Save/Cancel, Ctrl/Cmd+Enter), кнопка копирования ссылки; History — серверный фид с диффом «было → стало» половинами, старое значение зачёркнуто; комменты видны в истории диффом `Comment: — → текст`; описание коммитится одним `UPDATE_CARD` на сессию печати (blur/смена карточки/закрытие), свежесть истории — по коммит-сигналу `CommitStore` (без лага «на шаг позади» при чек-боксах); дифф подсвечивает изменённый фрагмент word-diff'ом (красное зачёркнутое / зелёное, контекст схлопывается в «…», `clip` снапшотов поднят 280 → `LIMITS.description`); чужой комментарий перевешивает «морду» карточки (SSE-фрейм ставит attribution с кольцом, сервер пишет `Card.lastActorId` — после перезагрузки то же лицо) | пишется/удаляется/пагинируется; чужой комментарий приходит живым; лимит гвардит; en+ru. **Выполнено:** UI `CardActivity`/`CardComments`/`CardHistory` + ленивый `CommentEditor` (компактный MDXEditor, тела комментариев — markdown-вьюер, голые URL линкует `autolinkMarkdown`; оптимистичная отправка, удаление своих с подтверждением, курсорный «Show older»); SSE `type:"activity"` публикуется из `CommentsService` и раздаётся через `ActivityStore`; `Command.details` (миграция `20260918174753_command_details`) хранит снапшот `{detail,changes}` команд, текст комментов — в `Activity.details` (`readCommentSnapshot` в `activity.service`) — диффы в `GET /cards/:id/activity`, посимвольные правки сворачиваются (окно 2 с); копирование `?card=`-ссылки + фикс холодной загрузки deep-link; ui 617 (80 файлов), backend 145 unit+e2e, lint/tsc/prettier/build/size; живые пробы `comments-probe.mjs` 12/12 и `activity-redesign-probe.mjs` 30/30 — **PR #82, merge `a6b8b2c`; полировка — PR #83, merge `68716dc`** |
| 13 | TASK-38a `self-host-hardening` | `feature/TASK-38a-self-host-hardening` | §7.8: шесть грабель самохостинга, каждая ломается **молча** (Secure-кука по HTTP, буферизация SSE за nginx, миграции в entrypoint, JWT без дефолтов, `ALLOW_REGISTRATION`, healthcheck БД) + джоб чистки soft-delete на `@nestjs/schedule` | HTTP-инсталляция ругается, а не разлогинивает молча; SSE работает за дефолтным nginx; пустой `JWT_SECRET` не даёт стартовать; чистка идёт по расписанию |
| 14 | TASK-38b `self-host-release` | `feature/TASK-38b-self-host-release` | §7.8: `LICENSE` (MIT) + поля в `package.json`, multi-stage `Dockerfile`, прод-`docker-compose.yml`, `.env.example`, публикация образов в `ghcr.io` из CI по тегу, README под самохостера, `SECURITY.md`, `CHANGELOG.md` | `curl -O docker-compose.yml && cp .env.example .env && docker compose up -d` поднимает инстанс на чистой машине; `pull && up -d` обновляет без ручных шагов |
| 15 | TASK-39 `public-demo` | `feature/TASK-39-public-demo` | §7.8: демо-инстанс на своём домене, сид-доска en/ru, ночной сброс, два предсозданных аккаунта (совместный режим щупается в двух окнах), регистрация закрыта, ссылка первым экраном README | демо по HTTPS; два аккаунта показывают realtime вдвоём; ночной сброс отрабатывает |
| 16 | TASK-40 `observability` | `feature/TASK-40-observability` | §7.8: Sentry на фронт и бэк (**DSN — переменная, пустая по умолчанию**: свой DSN в опенсорс-образ зашивать нельзя), `pino` со структурными логами и `requestId`→`commandId`, `/health` со статусом БД и версией образа | ошибка долетает до Sentry с версией сборки; пустой `SENTRY_DSN` полностью выключает отправку; по `commandId` трассируется путь команды |
| 17 | TASK-41 `e2e-multiuser` | `feature/TASK-41-e2e-multiuser` | §7.8: Playwright, **ровно шесть** сценариев на два браузера (undo не затирает чужое, конфликт текста, живое прилетание, догон `?since=`, идемпотентность, presence). Правка §0 п.4 — запрет сужается, а не снимается. Гоняется в CI против `docker compose` из TASK-38b | все шесть зелёные в CI; прогон ≤5 мин; §0 и README обновлены |
| 18 | TASK-31 `mobile-ux` | `feature/TASK-31-mobile-ux` | Тач-слой для календаря/таблицы (HTML5 DnD на тачах не работает; доска уже покрыта TASK-21.10), адаптив шапки/фильтров/диалогов | drag-сроки и перенос строк работают на тач-эмуляторе; вёрстка не ломается на 390px |
| 19 | TASK-32 `landing-intro` | `feature/TASK-32-landing-intro` | Презентационная страница для неавторизованных + маршруты «войти / создать аккаунт» (auth готов с TASK-24; роутер уже BrowserRouter — TASK-21.8) | неавторизованный видит лендинг, после логина попадает на доску; deep-links не сломаны |
| 20 | TASK-43 `master-admin-panel` ✅ | `main` (вне очереди, по запросу) | Мастер-контур §7.0/§7.4: `AdminUser` OWNER/OPERATOR отдельно от `User`, свой вход/аудиенция/cookie, админ-панель `/admin` (дашборд, юзеры, доски, журнал, аудит, мастера), CLI `admin:create/passwd/list`, модерация и аудит; `User.isSuperAdmin` удалён | вход мастера из браузера; из панели создаётся оператор и не может управлять мастерами; юзер-токен в `/admin` → 401 и наоборот; блок юзера убивает сессии; всё в аудите; e2e на запреты |
| 21 | TASK-44 `card-layout` ✅ | `feature/TASK-44-card-layout` | По запросу владельца: карточка больше не «дышит» высотой — фикс под вьюпорт, секции сворачиваются в едином стиле, чеклист не растёт бесконечно | диалог карточки — `100dvh−2rem` со скроллом тела; `CollapsibleSection` (Description/Checklists открыты, Activity свёрнута) + сворачивание каждого чеклиста отдельно с видимым прогрессом; пункты чеклиста капнуты 8 строками (внутренний скролл); Title — авто-высота 1–4 строки без пустых строк. **Выполнено:** ui 602 (77 файлов), lint/tsc/prettier зелёные; живая проба `card-layout-probe.mjs` 17/17 (высота 868/608, неизменна при сворачивании, список 218>192) — **PR #81, merge `5fe2677`** |
| 22 | TASK-44.1 `header-gradient` ✅ | `main` (вне очереди, по запросу) | По запросу владельца: шапка сайта получает фон-градиент панели аккаунта (`from-primary/15 via-secondary/10 to-transparent`) поверх `bg-background/80` с блюром | только оформление, функционал не тронут; ui 602 (77 файлов), lint/tsc/prettier зелёные; живой скрин |
| 23 | TASK-45 `card-priority` | `feature/TASK-45-card-priority` | По запросу владельца: Jira-приоритеты на карточке. 6 уровней (`blocker/highest/high/medium/low/lowest`), дефолт Medium; серверный `Card.priority` + миграция, команда `SET_CARD_PRIORITY` (паттерн `SET_CARD_DUE_DATE`) + inverse/activity-событие, writer/aggregate/import, миграция данных v7. UI: селект с иконками и цветами Jira в карточке, бейдж на морде, опциональная колонка в TableView, сортировка колонки по приоритету, мультивыбор в фильтрах | приоритет переживает reload/export/import и undo; чужая смена видна по SSE; en+ru; тесты + живая проба. Готово: полный контур команды (shared-редьюсер/invert/validate/migrate, Prisma v7, writers в ОБОИХ свитчах, aggregate/import/export), UI (селект в диалоге, бейдж на морде для не-medium, опциональная колонка + сортировка в TableView, фасет-мультивыбор в фильтрах), история с локализованным уровнем; проба `priority-probe.mjs` 16/16 (SSE-видимость чужой смены, undo/redo, сортировка, фильтры) — **PR #84, merge `d2066e2`**. Попутно: лимит коммента 2000→10000 (Prisma v8 `Comment.text` → Text), premium-Save слева + Cancel сразу (оба дисейбл на пустом черновике), эмодзи в markdown-вьюерах (`emojify`: шорткоды+эмотиконы, код не трогаем) |
| 24 | TASK-46 `card-links` ✅ | `feature/TASK-46-card-links` | По запросу владельца: Jira-связи карточек. `CardLink (fromCardId, toCardId, type)` — 3 семейства: `blocks`/`blocked by`, `relates to`, `duplicates`/`duplicated by`; отображение обеих сторон, запрет self-link и дублей пары, лимит 50 связей на карточку, каскад при удалении, запрет циклов `blocks` с тостом; всё командами (undo/redo/SSE). В карточке — секция «Linked cards» в стиле общих секций: группы по типу, переход на связанную карточку, поиск при добавлении; на морде — иконка/счётчик связей и красный «Blocked» по входящему blocks от неархивной карточки; фильтры «Blocked» и «Has links» | связи переживают reload/export/import; цикл `blocks` не создаётся; undo/realtime работают; en+ru; тесты. **Выполнено:** `CardLink` хранится на источнике (directional), вторая сторона вычисляется сканом; гварды: self-link, дубль пары, `LIMITS.linksPerCard = 50`, DFS-циклы `blocks`; dangling-tolerant (удаление цели оставляет строку, undo оживляет), дубликаты без связей; Prisma `CardLink` (soft-delete, FK RESTRICT) + миграция `20260919131635_card_links`, writers upsert/soft-delete, aggregate/import, command-details со снапшотом титула цели; UI `CardLinks` (саджесты, 5 Jira-фразировок → 3 wire-типа, клавиатура, тост цикла, навигация `?card=`), бейджи на морде, фасеты фильтров, история; en+ru. Гейты: shared 349, backend 57 unit + 145 e2e, ui 658 (85 файлов), lint/tsc/prettier/build/size зелёные (живая проба отменена владельцем) — **PR #85, merge `54c9937`** |
| 25 | TASK-47 `files` ✅ | `feature/TASK-47-files` | По запросу владельца (self-hosted, без S3): файловые вложения карточек и аватары пользователей на локальном диске. Backend: `Attachment` (id, boardId, cardId, fileName, storedName, mimeType, sizeBytes, uploadedById, deletedAt), multer-хранение в `UPLOAD_DIR` (дефолт `data/uploads`, в git-игноре), upload/stream/delete REST поверх MembershipGuard (как комменты — вне командного контура, undo не покрывает), denormalized `Card.attachmentCount` в aggregate + SSE `type:"attachment"`, лимиты `LIMITS.attachment` (25 MB, mime-allowlist); аватар: `PATCH /users/me/avatar` + `GET /users/:id/avatar`, `User.avatarPath`. UI: секция Attachments в диалоге (иконки по mime, размер, скачивание, удаление), бейдж-счётчик на морде, живое прилетание по SSE; аватар в аккаунт-панели. Docker: прод-compose монтирует `data/` как bind mount (детали упаковки остаются в TASK-38b) | файл переживает рестарт контейнера; чужой upload виден по SSE; лимит и чужой mime отсекаются; скачивание только участникам доски; en+ru; тесты. **Выполнено:** Prisma `Attachment` (soft-delete, FK RESTRICT) + миграция `20260919210000_attachments`, `User.avatarPath`/`Card.attachmentCount`; multer в `UPLOAD_DIR` (дефолт `data/uploads`, git-игнор), storedName=UUID+sanitized ext, allowlist mime (вложения 25MB×20/карточка, аватар 2MB), удаление blob-файла при soft-delete; REST вне командного контура: POST/GET `/cards/:cardId/attachments`, GET `/attachments/:id/content` (Content-Disposition UTF-8), DELETE `/attachments/:id` (uploader или ADMIN), `PATCH /users/me/avatar` + `GET /users/:id/avatar` (immutable-cache); activity `attachment_added/deleted` + SSE, avatarPath сквозь presence/roster/updateUser; UI: секция Attachments (upload/скачивание через blob-fetch, ConfirmDialog, SSE-merge, canDelete), Paperclip-бейдж на морде, аватары в presence/членах/профиле/аккаунте (module-cached object URL), en+ru; попутно правила линков вынесены в `shared/src/store/card-links`. Гейты: backend 57 unit + 152 e2e, ui 661 (86 файлов), lint/tsc/prettier/build/size зелёные — **PR #86, merge `2c2692a`** |
| 26 | TASK-48 `admin-redesign` ✅ | `feat/TASK-48-admin-redesign` | Вне очереди, по запросу владельца: (1) редизайн админ-панели — 9 сущностей таблицами (`/admin/entities/:entity`: cards, users, boards, comments, attachments, checklists, labels, sessions, apiTokens) с cross-entity поиском, пагинацией, период-фильтрами (24h/7d/30d), детальными страницами карточки/юзера/доски с вкладками Activity/Command log/Audit/Sessions/Tokens, скачиванием вложений мастером, приоритетом/due в таблице карточек; (2) Jira-style paste-медиа — Ctrl+V картинки/файлов/видео в описание и комментарии: embed на позиции курсора с сохранением структуры «текст → медиа → текст», картинки/видео/аудио рендерятся (авторизованные blob-URL через imagePreviewHandler), видео/аудио — нативные плееры (`::video{src=…}`-директивы), файлы — ссылки с открытием; в описании — реальное вложение, в комментарии — скрытое inline-вложение (без бейджа и ленты, удаляется вместе с комментарием); fullscreen-просмотрщик картинок; фикс mojibake имён (multer latin1) | вход только по API-токену (e2e-гейт 7 кейсов); период-фильтры обрезают все 6 лент; inline скрыт из списка и счётчика; удаление комментария чистит его inline-вложения (e2e); mojibake-имя сохраняется в UTF-8 (e2e); en+ru; тесты. **Выполнено:** backend — `AdminListQueryDto` (query/from/to), `/admin/entities/:entity`, `GET /admin/attachments/:id/download`, `Attachment.isInline` (миграция `20260920120000_attachment_inline`), payload в командных строках, priority/dueDate в карточных; UI — AdminApp (таблицы, период-табы, `JsonCell` с expand без трима, `CopyButton`/`EntityLink`, `key={entity}` сброс пагинации, `{total}`-подзаголовки, RowActions без действий → null); paste-контур — `embedAttachments` (embedMarkdown/preview-cache/lightbox/click-delegation), `directivesPlugin` с video/audio-дескрипторами (micromark v3, `::video{src="…"}`), paste-хендлеры описания и композера, mojibake-фикс `sanitizeFileName`; admin-чанк бюджет 30→32 KB. Гейты: backend 57 unit + 166 e2e, ui 692 (89 файлов), lint/tsc/prettier/build/size зелёные — **PR #88, merge `681fc96`** |
| 27 | TASK-49 `card-assignee` ✅ | `feature/TASK-49-card-assignee` | Вне очереди, по запросу владельца: Jira-исполнитель на карточке. `Card.assigneeId` (optional-field конвенция: `null` = не назначен) + команда `SET_CARD_ASSIGN` (паттерн `SET_CARD_PRIORITY`) с серверной проверкой, что исполнитель — активный участник доски (принял приглашение, не истёкший VIEWER; inverse освобождён для undo). UI: пикер исполнителя в карточке — поповер с живым поиском по ростеру доски (аватары, email, клавиатура, закреплённый «Unassigned»), мгновенное применение; аватар исполнителя в правом нижнем углу карточки на борде (как в Jira) с профилем по клику; опциональная сортируемая колонка в TableView (не назначенные всегда в хвосте); фасеты фильтров по участникам + «Unassigned». Админка: колонка Assignee в таблице карточек (EntityLink + копирование), исполнитель в мета-панели карточки, вкладка «Assigned cards» и счётчик у юзера, поиск карточек по исполнителю. Попутно убран «кто изменил» с морды карточки и ячейки таблицы (решение владельца) — живой 2-секундный foreign-хайлайт сохранён | назначить можно только активного участника (e2e: outsider/pending 400, member 200, undo); исполнители переживают reload/export/import/undo; чужая смена видна по SSE; en+ru; тесты. **Выполнено:** миграция `20260920210948_card_assignee` (FK SetNull + индекс), writers в обоих свитчах (`writeCardAction`, `cardCreateData`/`cardUpdateData` — DUPLICATE_CARD копирует исполнителя через spread), aggregate/import (FK-гвард от мусорных id), command-details `assignee` from/to; UI — `CardAssignee` (Popover + combobox, поиск по `useBoardMembersList` — новый хук/`MembersStore.list`), `AssigneeBadge` на морде (boardId-prop-drilling для memo), колонка/сортировка/фасеты, история резолвит имя через директорию (fallback на raw id); ретро-аттрибуция: убраны `card-last-actor`/`table-last-actor` + ключ `card.changedBy`. Гейты: shared 367, backend 58 unit + 170 e2e (новый `card-assignee.e2e-spec` 4 кейса), ui 700 (90 файлов), lint/tsc/prettier/build/size зелёные (admin-чанк 31.15/32 KB)

Последовательность выстроена так, что **каждый шаг демонстрируем**: после
TASK-29 приложение живёт с сервера, после TASK-35 на доску можно позвать
человека, после TASK-30 его правки видны сразу, после TASK-36 видно, что это
именно он, после TASK-37 с ним можно разговаривать. Дальше блок релиза
(TASK-38a…41, детали — §7.8): проект становится ставимым, публично
показанным, наблюдаемым и покрытым многопользовательскими E2E. TASK-31/32 —
финальная полировка. §7.6 открывается по запросу.

**Замечание о порядке (одно отклонение от изначального предложения).** Демо
логично было бы поставить сразу после TASK-35 — там впервые появляется, кого
звать на доску. Но демо, где правки другого участника видны только после F5 и
неизвестно, кто их сделал, — слабая витрина. Три шага ожидания ничего не
стоят, а показывать становится что. Если захочется живую ссылку раньше ради
мотивации — TASK-38a/38b можно поднять сразу после TASK-30, они зависят
только от неё (SSE) и от TASK-25 (миграции).

---

### 7.8. Релиз, эксплуатация и E2E (TASK-38a…41)

> **Форма поставки — самохостимый опенсорс** (решение пользователя 2026-09):
> бесплатно, MIT, любой может поднять у себя. Из этого следует, что единица
> поставки — **не README, а `docker compose up -d`**: README только обёртка
> вокруг работающей команды. Так раздаются Vaultwarden, Gitea, Plausible,
> Outline — люди ждут именно этого, и половина уходит, если надо собирать из
> исходников.

#### TASK-38a — `self-host-hardening` · Шесть грабель самохостинга

- **Зачем:** каждая из шести ломается **молча**, и документацией не лечится —
  README читает меньшинство. Это код, а не абзац.
- **Что:**
  1. **`Secure`-кука поверх HTTP.** §7.0 фиксирует refresh как
     `httpOnly Secure SameSite=Strict`. Человек поднимет на
     `http://192.168.1.50:3000` — браузер молча выбросит куку: логин
     визуально пройдёт, через 15 минут выкинет на экран входа, ошибок нет.
     Фикс: в проде без HTTPS либо отказ стартовать, либо явный
     `COOKIE_SECURE=false` с жирным предупреждением в логе.
  2. **SSE за nginx.** `proxy_buffering` включён по умолчанию — поток копится
     в буфере, realtime не работает, ошибок нет; `proxy_read_timeout 60s`
     рвёт соединение. Фикс в коде, а не в конфиге пользователя: бэкенд сам
     отдаёт `X-Accel-Buffering: no` + heartbeat раз в 25 с (тот же, что несёт
     `presence` в TASK-36).
  3. **`prisma migrate deploy` в entrypoint**, не шагом README — иначе
     `docker compose pull` ломает инсталляцию на старой схеме.
  4. **JWT-секреты без дефолтов.** Дефолт = один секрет на все инсталляции
     мира = тривиальная подделка токенов. Генерация при первом старте в
     volume либо отказ стартовать.
  5. **`ALLOW_REGISTRATION`** — иначе на публичном инстансе регистрируется
     кто угодно (первый юзер супер-админ, но остальные всё равно лишние).
     По умолчанию `true` для первого запуска, UI подсказывает выключить
     после создания аккаунта.
  6. **`healthcheck` на Postgres + `depends_on: condition: service_healthy`**
     — иначе бэкенд уходит в краш-луп на первом `up`.
- **Плюс джоб чистки soft-delete** (30 дней, `PURGE_AFTER_DAYS`) на
  `@nestjs/schedule`: внешнего cron в контейнере нет, а без джоба удалённое
  копится вечно. В §7.0 период зафиксирован, исполнитель — здесь.
- **DoD:** `docker compose up` на чистой машине поднимается с первого раза;
  HTTP-инсталляция явно ругается, а не молча разлогинивает; SSE работает за
  nginx с дефолтным конфигом (проверено вручную); повторный `up` после смены
  образа применяет миграции; пустой `JWT_SECRET` не даёт стартовать; чистка
  отрабатывает по расписанию.
- **Зависимости:** TASK-30 (SSE), TASK-25 (миграции).

#### TASK-38b — `self-host-release` · Артефакты поставки и лицензия

- **Зачем:** сейчас `LICENSE` в репозитории **нет**, а README прямо говорит
  «Private project — not yet released under an open-source license» — то есть
  юридически никто не имеет права ни использовать, ни форкать. «Всё
  бесплатно» без файла лицензии остаётся намерением, а не разрешением.
- **Что:**
  - **`LICENSE` — MIT** (решение пользователя 2026-09) + `license`,
    `repository`, `description`, `author` в `package.json`; строка в
    CONTRIBUTING «отправляя PR, вы соглашаетесь, что вклад лицензируется под
    MIT» — лёгкая замена CLA, снимающая проблему на годы вперёд.
    *Почему MIT, а не AGPL:* вы написали, что рассчитываете переиспользовать
    наработки в своих будущих проектах — под AGPL чужие принятые PR тоже
    станут AGPL, и переиспользовать их в закрытом проекте будет нельзя.
  - multi-stage `Dockerfile` (сборка фронта → статика раздаётся бэкендом),
    прод-`docker-compose.yml` (app + postgres + volumes), `.env.example`
    с комментарием к каждой переменной;
  - **публикация образов в `ghcr.io` из CI по тегу** — дополнение к
    TASK-21.1. Без опубликованных образов человек обязан собирать из
    исходников, и половина отваливается;
  - README переписан под самохостера: скриншот/GIF **первым экраном**
    (решение «ставить или нет» принимается за пять секунд и принимается
    картинкой), ссылка на демо, quick start в три команды, таблица
    переменных окружения, upgrade, backup/restore (`pg_dump` + существующий
    JSON-экспорт как второй уровень); development-раздел — ниже и отдельно,
    это другая аудитория;
  - `SECURITY.md` (куда сообщать об уязвимостях — актуально: в проекте есть
    реальная история с XSS-стоком в MDXEditor, TASK-2), `CHANGELOG.md`,
    шаблоны issue в `.github/`.
- **DoD:** `curl -O docker-compose.yml && cp .env.example .env &&
  docker compose up -d` поднимает рабочий инстанс на чистой машине;
  `docker compose pull && up -d` обновляет без ручных шагов; образ собирается
  и публикуется CI по тегу; в репозитории есть `LICENSE`, `SECURITY.md`,
  `CHANGELOG.md`; README больше не называет проект приватным.
- **Зависимости:** TASK-38a.

#### TASK-39 — `public-demo` · Публичный демо-инстанс

- **Зачем:** для опенсорса это главный канал — живой инстанс убеждает лучше,
  чем любой список фич.
- **Что:** инстанс на своём домене по HTTPS; сид-доска с осмысленным
  содержимым на en/ru; ночной сброс к сиду (тот же `@nestjs/schedule`);
  `ALLOW_REGISTRATION=false` и **два предсозданных аккаунта** — чтобы
  совместный режим щупался в двух окнах без регистрации; баннер «демо, данные
  сбрасываются ночью»; ссылка первым экраном README.
- **DoD:** демо доступно по HTTPS; вход двумя аккаунтами показывает realtime
  вдвоём; ночной сброс отрабатывает; регистрация закрыта.
- **Зависимости:** TASK-38b, TASK-36 (без присутствия и атрибуции
  показывать нечего).

#### TASK-40 — `observability` · Sentry, структурные логи, health

- **Зачем:** после деплоя ошибки пользователей не видны вообще —
  `ErrorBoundary` пишет в `console.error`, у бэкенда нет структурных логов.
  Для realtime с оптимистичными откатами это критично: именно эти баги
  невоспроизводимы локально и видны только по телеметрии.
- **⚠️ Нюанс опенсорса:** свой DSN в раздаваемый образ зашивать **нельзя** —
  вы будете собирать ошибки чужих инсталляций, а это проблема приватности.
  Поэтому `SENTRY_DSN` — переменная окружения, **пустая по умолчанию =
  телеметрия выключена**; свой DSN задаётся только на демо и на своём
  инстансе.
- **Что:** Sentry на фронт (`ErrorBoundary` + глобальный handler) и на бэк
  (Nest exception filter), с версией образа в релизе; `pino` со структурными
  логами и `requestId`, прокинутым в `commandId` — путь команды трассируется
  насквозь; `/health` отдаёт статус БД и версию образа; число активных
  SSE-подключений в логе.
- **DoD:** необработанная ошибка долетает до Sentry с версией сборки; пустой
  `SENTRY_DSN` полностью отключает отправку (проверено); `/health` показывает
  деградацию БД; по `commandId` трассируется путь команды.
- **Зависимости:** TASK-38b.

#### TASK-41 — `e2e-multiuser` · Точечный E2E на два браузера

- **Зачем:** §0 запрещал Playwright/Cypress целиком. Для однопользовательского
  SPA это было верное решение — Vitest + RTL закрывали всё. Но DoD
  TASK-30/36/37 звучит как «два браузера видят друг друга», а Vitest два
  браузера не открывает. В итоге **самая сложная часть системы** — SSE,
  оптимистичные откаты, rebase, политика конфликтов undo, presence —
  проверяется руками.
- **Правка §0 п.4:** запрет **сужается, а не снимается**. E2E не используются
  для однопользовательского UI (там по-прежнему Vitest + RTL) и разрешены
  только для многопользовательских сценариев. Никакого «E2E на всё».
- **Что — ровно шесть сценариев:**
  1. Аня правит карточку A, Борис — карточку B; Аня жмёт `Ctrl+Z` → **правка
     Бориса на месте**;
  2. оба правят **одну** карточку; undo Ани → тост «изменил другой
     участник», текст Бориса цел;
  3. изменение Бориса появляется у Ани без перезагрузки (< 2 с);
  4. обрыв SSE → переподключение догоняет дельтой `?since=`, а не полным
     агрегатом;
  5. повтор команды с тем же `commandId` не создаёт дубликат;
  6. presence: закрытие вкладки убирает аватар за ≤60 с.
- **Где гоняется:** в CI против `docker compose` из TASK-38b — то есть
  тестируется ровно то, что получают пользователи, а не отдельная сборка.
- **DoD:** все шесть зелёные в CI; прогон ≤5 минут; §0 п.4 и `README.md`
  обновлены.
- **Зависимости:** TASK-37, TASK-38b.

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
  тестовой БД из docker-compose, секреты — только в `.env` (в git не попадает);
- **с TASK-38b** — `docker compose up -d` на чистой машине поднимает рабочий
  инстанс, а `docker compose pull && up -d` обновляет его без ручных шагов
  (это и есть обещание самохостеру — проверять на каждой задаче, которая
  добавляет переменную окружения или сервис);
- **с TASK-41** — шесть многопользовательских сценариев зелёные в CI, если
  задача трогает SSE, sync-слой, undo или presence.