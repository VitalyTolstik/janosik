# Janosik — Роадмап и план итераций

> **Единый источник правды по развитию приложения.** Этот файл заменяет
> прежние `ARCHITECTURE_REVIEW.md`, `FEATURES_BACKLOG.md` и
> `CURRENT_WORK_ITERATIONS.md` (они удалены). Любой ИИ-агент начинает работу
> с чтения этого файла и `AGENT.md`.
>
> **Текущий фокус:** фундамент перед бэкендом закрыт полностью (§6.0.1,
> TASK-21.1…21.11 ✅); активная фаза — бэкенд, совместный UI и релиз
> (§7, TASK-22…32 и 35…41 — порядок в §7.7). **Форма поставки —
> самохостимый опенсорс** (AGPL-3.0, `docker compose`, публичное демо):
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
- **Тесты** — **1135 тестов: ui 768 (103 файла) + shared 367 (8 файлов)** (reducer, history, persistence, serialization, backup, backup-timestamp, dnd, filter, storage, migrate, i18n, pwa, editor-import, интеграционные BoardSection + CardDialog + свитчер; изоляция рендеров и троттл бэкапа — TASK-21.4/21.4.1; поведение service worker'а — TASK-21.3; обратимость экшенов — `invert.test.ts`, TASK-21.7d; платформа и BrowserRouter deep-links — TASK-21.8; ленивые иконки шапки — `lazy-animated-icon.test.tsx`, TASK-21.9; конфигурация сенсоров тач-DnD — `DndBoard.sensors.test.tsx`, TASK-21.10; сброс диалогов и двойной тап — `ColumnView.double-tap.test.tsx`, TASK-21.11; строгий валидатор команд (включая метки/чек-листы и board-level) — `shared/src/store/validate.test.ts`, TASK-26/27/29; серверный режим — `api/client.test.ts`, `store/server-sync.test.ts`, `store/board-diff.test.ts`, `store/BoardContext.server.test.tsx` (fake-сервер на общем редьюсере), `components/auth/LoginPage.test.tsx`, TASK-29; мастер-панель — `admin/admin-client.test.ts`, `admin/admin-i18n.test.ts`, `admin/AdminApp.test.tsx` (fake admin-API), TASK-43; участники и read-only — `components/ui/user-avatar.test.tsx`, `components/board/BoardMembersDialog.test.tsx`, `components/board/read-only.test.tsx`, `components/BoardSection.roles.test.tsx` (fake-сервер с ролью VIEWER), TASK-35; realtime — `store/realtime.test.ts` (SSE-парсер, reconnect/backoff, `touchedEntityIds`) и кейсы в `store/BoardContext.server.test.tsx` (чужая команда, догон `?since=`, другой таб, foreign-пометка undo по `touches` без рефетча, own-echo не убивает undo, deferred-очередь при in-flight, успешный undo/redo через лог), TASK-30/30.1/30.2; присутствие и атрибуция — `store/board-live.test.tsx` (сторы presence/attribution/members, command→card-ids), `components/board/PresenceStack.test.tsx` (fake-сервер: ростер, «+N», join/leave), кейсы presence/кольца/ленты/таблицы в `realtime.test.ts`, `BoardContext.server.test.tsx`, `CardItem.test.tsx`, `CardActivityFeed.test.tsx`, TASK-36). Цифру сверять командой `npx vitest run`, а не переписывать по памяти.

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
> **Форма поставки — самохостимый опенсорс под AGPL-3.0** (§7.8).

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
| 13 | TASK-38a `self-host-hardening` ✅ | `feature/TASK-38a-self-host-hardening` | §7.8: шесть грабель самохостинга, каждая ломается **молча** (Secure-кука по HTTP, буферизация SSE за nginx, миграции в entrypoint, JWT без дефолтов, `ALLOW_REGISTRATION`, healthcheck БД) + джоб чистки soft-delete на `@nestjs/schedule` | HTTP-инсталляция ругается, а не разлогинивает молча; SSE работает за дефолтным nginx; пустой `JWT_SECRET` не даёт стартовать; чистка идёт по расписанию |
| 14 | TASK-38b `self-host-release` ✅ | `feature/TASK-38b-self-host-release` | §7.8: `LICENSE` (AGPL-3.0) + поля в `package.json`, multi-stage `Dockerfile`, прод-`docker-compose.yml`, `.env.example`, публикация образов в `ghcr.io` из CI по тегу, README под самохостера, `SECURITY.md`, `CHANGELOG.md` | `curl -O docker-compose.yml && cp .env.example .env && docker compose up -d` поднимает инстанс на чистой машине; `pull && up -d` обновляет без ручных шагов |
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
| 27 | TASK-49 `card-assignee` ✅ | `feature/TASK-49-card-assignee` | Вне очереди, по запросу владельца: Jira-исполнитель на карточке. `Card.assigneeId` (optional-field конвенция: `null` = не назначен) + команда `SET_CARD_ASSIGN` (паттерн `SET_CARD_PRIORITY`) с серверной проверкой, что исполнитель — активный участник доски (принял приглашение, не истёкший VIEWER; inverse освобождён для undo). UI: пикер исполнителя в карточке — поповер с живым поиском по ростеру доски (аватары, email, клавиатура, закреплённый «Unassigned»), мгновенное применение; аватар исполнителя в правом нижнем углу карточки на борде (как в Jira) с профилем по клику; опциональная сортируемая колонка в TableView (не назначенные всегда в хвосте); фасеты фильтров по участникам + «Unassigned». Админка: колонка Assignee в таблице карточек (EntityLink + копирование), исполнитель в мета-панели карточки, вкладка «Assigned cards» и счётчик у юзера, поиск карточек по исполнителю. Попутно убран «кто изменил» с морды карточки и ячейки таблицы (решение владельца) — живой 2-секундный foreign-хайлайт сохранён | назначить можно только активного участника (e2e: outsider/pending 400, member 200, undo); исполнители переживают reload/export/import/undo; чужая смена видна по SSE; en+ru; тесты. **Выполнено:** миграция `20260920210948_card_assignee` (FK SetNull + индекс), writers в обоих свитчах (`writeCardAction`, `cardCreateData`/`cardUpdateData` — DUPLICATE_CARD копирует исполнителя через spread), aggregate/import (FK-гвард от мусорных id), command-details `assignee` from/to; UI — `CardAssignee` (Popover + combobox, поиск по `useBoardMembersList` — новый хук/`MembersStore.list`), `AssigneeBadge` на морде (boardId-prop-drilling для memo), колонка/сортировка/фасеты, история резолвит имя через директорию (fallback на raw id); ретро-аттрибуция: убраны `card-last-actor`/`table-last-actor` + ключ `card.changedBy`. Гейты: shared 367, backend 58 unit + 170 e2e (новый `card-assignee.e2e-spec` 4 кейса), ui 700 (90 файлов), lint/tsc/prettier/build/size зелёные (admin-чанк 31.15/32 KB) |
| 28 | TASK-50 `video-transcode` ✓ | `feature/TASK-50-video-transcode` | «Ужиматор» видео как у топ-ресурсов: каждое видео-вложение в фоне перекодируется в компактный H.264/AAC MP4 (ffmpeg, CRF 25, ≤1920 по ширине, +faststart) — минимальная потеря качества, минус 50–80% размера на записях экрана; оригинал живёт до успеха кодека и остаётся при неудаче. Статусы none/pending/done/failed в `Attachment.transcodeStatus`; очередь — in-process FIFO (один кодек за раз), потери при рестарте нет — `onModuleInit` переставляет `pending`-строки в очередь. Блоб подменяется атомарно (tmp+rename), `content`-URL не меняется — плееры и встроенные в описания `::video` продолжают работать без перезагрузки страницы; о SSE-фрейме `attachment_updated` диалог перечитывает ряд. Бинарник — `ffmpeg-static` (без системных зависимостей), оверрайд `FFMPEG_PATH`. UI: плашка «Encoding…/Сжимаем…» у ряда пока идёт кодек. Админка: колонка «Encode» со статусом в таблице вложений. Попутно в TASK-50 вошёл фикс хранилища: дефолт `UPLOAD_DIR` больше не от cwd, а якорится к папке backend (PR #92: cwd-relative путь однажды «потерял» все блобы после рестарта из другой папки); resolved-путь логируется на старте. Тесты: e2e с реальным ffmpeg и коммитнутой фикстурой `sample-video.mp4` — успешный кодек, гарбаж-файл → failed с живым оригиналом, не-видео → none; юнит на профиль аргументов ffmpeg; тест плашки Encoding. Гейты: shared 367, backend 59 unit + 173 e2e (19 сюитов), ui 701 (90 файлов), lint/tsc/build/размеры зелёные
| 29 | TASK-51 `email-change` ✅ | `feature/TASK-51-email-change` | Вне очереди, по запросу владельца: смена email «как у топовых приложений» (double opt-in с кодом) + смена email пользователю из админки. Самостоятельный флоу (аккаунт-панель → профиль → «Изменить»): текущий пароль + новый адрес → 6-значный код уходит на НОВЫЙ адрес (nodemailer, SMTP-переменные опциональны; без `SMTP_HOST` письма пишутся в лог сервера и outbox — самохостинг заводится без почты) → ввод кода (react-otp-input, 6 боксов) → адрес меняется, остальные сессии ревокаются (кука скоупится `/auth`, как у смены пароля), свежая токен-пара возвращается в ответе, на старый адрес — уведомление (best-effort). Код: sha256 в БД (`EmailChangeCode`, миграция `20260921195304_email_change_codes`), 15 минут, одноразовый, новый запрос убивает старый, 5 неверных вводов сжигают код; троттлинг request 3/час, confirm 5/мин; 409 при занятом адресе (пре-чек + P2002 на confirm); шаблоны писем en/ru по `Accept-Language`. Админка: `PATCH /admin/users/:id` принял `email` — мгновенно, без кода, ревок всех сессий юзера, аудит `user.email_changed` (from/to), письмо на старый адрес; UI — пункт «Change email» в Actions на странице юзера. Профиль: поле email разблокировано для флоу (кнопка «Изменить», диалог двухшаговый, resend с кулдауном 60с, en+ru) | код не принимается повторно и не утекает (только хэш); чужие сессии мертвы после смены, сессия инициатора жива (ротация); старый email перестаёт работать для логина; занятый адрес → 409; юнит + e2e (`email-change.e2e-spec`, бюджет троттлинга request×3/confirm×5). Гейты: shared 367, backend 71 unit + 183 e2e, ui 726 (94 файла), lint/tsc/build/size зелёные (index 198.67/300, admin 32.24/33 KB — бюджет админ-чанка 32→33 по прецеденту TASK-48: диалог смены email + en/ru строки). **PR #96, merge `9dff411`**. Догон: тот же диалог в меню «⋯» строк таблицы Users (генерик `EntityAction.renderDialog` в EntityPage — действие, открывающий кастомный диалог вместо confirm) — **PR #97**. Урок эксплуатации: после мержа backend-фич живой процесс надо перезапускать — владелец поймал 404 на новых роутах, пока `node dist/main.js` не перезапущен |
| 30 | TASK-52 `email-service-page` ✅ | `feature/TASK-52-email-service-page` | Вне очереди, по запросу владельца: настройка email-рассылки из админки без правок кода и env, с горячим перезапуском сендера. Вкладка «Email service» (`/admin/email`, OWNER-only, операторам — read-only): карточки-пресеты Gmail / Яндекс / Mail.ru / Brevo / SendGrid + «Свой SMTP» — хост/порт/TLS подтягиваются из пресета (backend берёт их из `EMAIL_SMTP_PRESETS` в shared и игнорирует клиентские значения; для custom — свои поля), вводятся только from/логин/пароль (пароль приложения / API-ключ, ссылка «Как получить» на инструкцию провайдера). Сохранение (PUT `/admin/email-settings`) шифрует пароль AES-256-GCM (`secret-box.ts`, ключ `SETTINGS_SECRET`, fallback — деривация из JWT_SECRET), кладёт singleton-строку в `EmailSettings` (миграция `20260921214147_email_settings`) и вызывает `MailerService.reconfigure()` — транспорт меняется на лету: nodemailer держит соединение только на время отправки, рестарт процесса не нужен, летящие письма доскажут старым транспортом. Приоритет конфигов: сохранённая включённая строка → SMTP_* env (bootstrap) → log-mode; `onModuleInit` переприменяет сохранённую строку после рестарта. Пароль никогда не покидает backend (GET возвращает `hasPassword`); отключение рассылки креды сохраняет. Кнопка «Отправить тестовое письмо» (POST `/admin/email-settings/test`, `@HttpCode(200)`) — outcome ok/error возвращается и пишется в строку (lastTestAt/Ok/Error, сбрасывается при следующем сохранении); в log-mode пробное письмо падает в outbox. Аудит: `email.settings_changed`, `email.test_sent` (в `ADMIN_AUDIT_ACTIONS`). e2e-герметичность: при `NODE_ENV=test` env.ts глушит SMTP_* — дев-`.env` с реальным SMTP не превращает прогоны в живой рассыльщик (спеки с транспортом конфигурируют его явно). UI: `EmailSettingsPage` (статус-баннер active/env/log, LastProbe, пресеты, форма, тест-секция, en+ru в admin-i18n), fake-admin-server с пресет-логикой. Гейты: backend 90 unit + 192 e2e (новые `secret-box.spec`, `email-settings.service.spec`, `admin-email-settings.e2e-spec`: маскировка, OWNER 403, валидации, encrypted-at-rest, dead-transport ECONNREFUSED, аудит), shared 367, ui 731 (95 файлов), lint/build зелёные; size-limit: админ-чанк 35.49/38 KB (бюджет 33→38, стр. ~3.2 KB gzip). **PR #98, merge `72ac404`**. Догон (по репортам владельца, **PR #99**, merge `b06ba0d`): секция «Test providers» с песочницей писем (в TASK-55 внешний сервис заменён локальным Mailpit); проба в log-режиме честно пишет «письмо в журнале сервера»; счётчики Comments/History в карточке появляются сразу (обе вьюхи смонтированы, неактивная скрыта, SSE держит свежей); битая вложенная картинка вместо красного пунктира MDXEditor — спокойный сланцевый плейсхолдер (`attachmentImagePreviewHandler`) |
| 31 | — `card-visual-rework` ✅ | `feature/card-visual-rework` | Вне очереди, по запросу владельца: переработка визуала карточки. Доска: карточка — тайл фиксированного размера (одинаковая ширина/высота у всех, `h-[136px]`), ряды строго по одному: лейблы в одну строку (лишнее обрезается с fade-маской), тайтл в одну строку (`truncate`, нативный тултип только при обрезке), отдельный ряд только с due date, ряд мета-бейджей (иконка дескрипшена → связанные карточки → чеклисты), футер — только приоритет и аватар исполнителя; бейдж вложений с лицевой стороны убран (остался в деталях), приоритет Medium теперь рендерится на карточке (больше не прячется как дефолт). Табличный вид: колонка Assignee включена по умолчанию (сохранённые пользовательские наборы колонок приоритетнее). Card details: «Copy card link» переехала в шапку рядом с заголовком и раскрывается при ховере шапки (не прижата к правому краю), порядок тела — тайтл → строка создан/обновлён → дескрипшен → лейблы → приоритет → due date → далее как было; иконка copy-link наклонена на 45° как в Jira (контекстное меню + шапка деталей). Гейты: ui 740 (96 файлов), lint/build зелёные, size-limit админ-чанк 36.55/38 KB |
| 32 | TASK-53 `registration-email-verification` ✅ | `feature/TASK-53-registration-email-verification` | Вне очереди, по запросу владельца: подтверждение email при регистрации (как в топ-приложениях). При `POST /auth/register` (если mail-транспорт живой) аккаунт создаётся с `User.emailVerifiedAt = null` и на адрес уходит 6-значный код (`EmailVerificationCode` — та же дисциплина, что у кодов смены email: только sha256, одна живая строка на юзера, TTL 15 мин, 5 неверных вводов сжигают код; письмо `verificationCodeEmail` en/ru); отправка при регистрации best-effort (сбой SMTP не валит регистрацию — гейт предлагает resend). Роуты: `POST /auth/verify-email` (10/min — брутфорс держат one-code+burn) и `POST /auth/verify-email/resend` (3/hour, `{expiresAt}`). В log-mode (SMTP не настроен) регистрация сразу верифицирует аккаунт — самохостинг без почты не упирается в глухой гейт. UI: фуллскрин-гейт `EmailVerificationGate` вместо борды, пока `emailVerifiedAt == null` (OTP react-otp-input, resend с кулдауном 60с, «Выйти»), en+ru i18n; fake-server с ручками `unverifiedEmail`/`emailVerifyCode`. Миграции: `20260922142036_user_email_verification` (+ таблица) и `20260922142857_email_verification_backfill` (существующие юзеры считаются подтверждёнными — никто не заперт). Гейты: backend 90 unit + 199 e2e (новый `registration-verification.e2e-spec`: unverified+код в outbox, логин до подтверждения, сжигание кода, resend, успех, 400 после, авто-верификация без SMTP), shared 367, ui 744 (97 файлов), lint/build зелёные |
| 33 | — `session-refresh-resilience` ✅ | `feature/session-refresh-resilience` | Вне очереди, по репортам владельца («карточки не создавались любыми кликами, потом само прошло» + мелькание диалога при дублировании). Диагноз №1 подтверждён логом (`WARN Refresh token reuse detected … all sessions revoked`, инцидент 23.09): ответ ротации refresh-токена не дошёл до браузера (вкладка заморожена ОС / обрыв сети) → ретрай показывал уже отозванный токен → §7.0-ответ «кража» отзывал ВСЕ сессии юзера. UI single-flight уже стоял (Web Locks, 17.09) — дыра была в потерянном ответе, закрывается на бэкенде: reuse токена, отозванного в окне `REFRESH_REUSE_GRACE_MS = 60с`, теперь обычный 401 «race detected» без отзыва сессий (пострадавшая вкладка перелогинивается, остальные живут); конкурентная ротация (rotated.count === 0) — тоже без nuke; reuse старше окна — прежний полный отзыв. Админский контур намеренно оставлен строгим. Диагноз №2: закрытие диалога стирает `?card=` из URL асинхронно; коммит сервера в этом окне перезапускал эффект со старым параметром и переоткрывал диалог — маркер `closedCardRef` гасит ровно этот случай, диплинки и Back не тронуты. Гейты: backend 200 (обновлённый тест nuke на `revokedAt = now − 2×GRACE` + grace/concurrent-тесты; переписанный `auth-refresh-reuse.e2e-spec`: immediate reuse → сессии живы, бэкдейт через prisma → nuke), ui 745 (регресс-смоук диалога: Escape → rename коммит → диалог остаётся закрыт), lint/build зелёные. **PR #104, merge `0d3fbf7`** |
| 34 | TASK-54 `oauth-login` ✅ | `feature/TASK-54-oauth-login` | Вне очереди, по запросу владельца: вход через Google и Яндекс (authorization-code flow, редиректы браузера, без SDK и без CORS). Админка: вкладка «OAuth login» (`/admin/oauth`, OWNER-only, операторам read-only) — на провайдера client id + client secret (AES-256-GCM `secret-box`, аналог EmailSettings: GET отдаёт `hasSecret`, PUT — семантика undefined/null/string = оставить/очистить/заменить, включение без секрета → 400), показ точного callback URL (`PUBLIC_ORIGIN/api/v1/auth/oauth/:provider/callback` — его владелец регистрирует в консоли провайдера verbatim), аудит `oauth.settings_changed` (новый action в `ADMIN_AUDIT_ACTIONS`), таблица `OAuthProviderSettings` (id = provider id, миграция `20261008212559_oauth_login`). Бэкенд: `GET /auth/oauth/providers` (публично, для кнопок), `GET /auth/oauth/:provider/start` (302 на провайдера, state `provider|random32` в httpOnly+lax куке скоупа `/api/v1/auth/oauth`, TTL 10 мин, prompt=select_account для Google) и `GET /auth/oauth/:provider/callback` (timing-safe сравнение state, обмен кода через global fetch с AbortSignal 10с, userinfo; любой сбой → 302 на `/?authError=oauth_failed`, LoginPage показывает локализованную ошибку и чистит параметр). Провижининг по email: существующий аккаунт линкуется (disabledAt → 403) и получает `emailVerifiedAt` (ящик доказан провайдером — гейт TASK-53 снимается), новый — OAuth-only с `passwordHash: null` (колонка сделана nullable: login → 401 invalid credentials, смена пароля и email без текущего пароля; P2002-гонка двух первых входов → линк), сессия через единственный `AuthService.startSession` (сделан публичным) — та же ротация/куки/аудит, что у парольного входа. Yandex: `default_email` + real_name/display_name/login; Google: `email` только при `email_verified`. UI: кнопки «Войти через …» на LoginPage только для включённых провайдеров (сбой загрузки списка = нет кнопок, парольный вход не страдает), en+ru. Гейты: backend 100 unit + 210 e2e суммарно (новые: `oauth.service.spec` — URL/state/обмен/профили/линк/403; `oauth.e2e-spec` — admin-гвард, маскировка секрета, полный Google-раунд до живой сессии через refresh, линк существующего, forged callback → authError, Yandex-раунд, 404 не-сконфигурированного), ui 752 (98 файлов: LoginPage-кнопки/authError, OAuthSettingsPage + fake-admin-server), lint/build зелёные |
| 35 | TASK-55 `sandbox-mailpit` ✅ | `feature/TASK-55-sandbox-mailpit` | Вне очереди, по запросу владельца: заменить песочницу писем — внешний Ethereal недостижим из части сетей (timeout на SMTP и API-хост Hetzner, проверено на машине владельца), поэтому пресет песочницы — **локальный Mailpit**. `EMAIL_SMTP_TEST_PRESETS` получил `mailpit` (host `localhost`, port `1025`, без auth, веб-ящик `http://localhost:8025`). Backend больше не минтит аккаунт через API nodemailer (`ensureEtherealAccount` удалён): транспорт анонимный, включение без пароля, `toConfig`/`onModuleInit`/`active` допускают null-пароль у песочницы, `webViewer` стал `{url}` и виден всем (секретов в нём нет). UI: пресет «Mailpit (sandbox)», панель ящика — только ссылка «Открыть ящик», i18n en+ru; README-гайд по email (логин/пароли приложений Gmail/Yandex/Mail.ru, Brevo/SendGrid, Custom, Mailpit). Гейты: shared 367, backend 107 unit + 210 e2e, ui 752 (98 файлов), lint/build/size зелёные (админ-чанк 38.05/39 KB). Догон: кнопка «Send test email» шлёт **реальный шаблон приложения** (код подтверждения, локаль из `Accept-Language`) вместо двуязычной заглушки. Живая проба визуально (Playwright MCP + контейнер `axllent/mailpit`): поле `delivered`, письмо в веб-ящике. **PR #106, merge `baec0b5`** |
| 36 | TASK-56 `board-write-serialization` ✅ | `main` | Вне очереди, по запросу владельца («рой ИИшек»): параллельные писатели одной доски дедлочились в Postgres (`40P01`) — команды брали строку доски (`SELECT … FOR UPDATE`), а комменты/вложения шли Card → Activity (FK на доску) — противоположный порядок блокировок. Введён `BoardWriteService` (§7.4): единый писатель доски — in-process очередь по `boardId` (ожидающие не держат соединение БД, важно при 100 редакторах) + транзакционный advisory-лок `pg_advisory_xact_lock(hashtextextended(boardId, 0))` (работает и между инстансами: Postgres сам, без Redis/Kafka) + ретрай транзакции на `40P01`/`40001`/`P2034` с backoff. Через него проведены все писатели доски: команды, комменты, вложения, приглашения/членство, archive/delete карточек и доски в мастер-панели. Гейты: backend 118 unit + 212 e2e (новые `board-write.service.spec` — коды/ретрай/сериализация; `concurrency.e2e-spec` — смешанный шторм без дедлоков + gap-free `seq`), lint/format/build зелёные. Замер: 340 одновременных запросов (100 команд + 100 комментов + 100 edits + 40 вложений) на одну доску → **0 ошибок / 0 дедлоков**, консистентно, ~82 req/s. Прямой пуш в `main` |
| 37 | TASK-57 `ops-traffic-demo` ✅ | `main` | Вне очереди, по запросу владельца: эксплуатация из мастер-панели — лимит API (env + панель), живой счётчик запросов и запуск/очистка демо-роя. (1) **Лимит**: `THROTTLE_LIMIT` (env, дефолт 300) + singleton-таблица `ThrottleSettings`; throttler резолвит значение в каждом запросе (`limit: () => throttleLimit()`), поэтому правка из панели применяется без рестарта; OWNER-only, аудит `throttle.settings_changed`. (2) **Трафик**: `TrafficService` — два rolling-кольца по 60 c (приходы через middleware до гардов + отказы 429 через `@Catch(ThrottlerException)`-фильтр), `GET /admin/traffic` отдаёт RPM, посекундный спарклайн и `throttledLastMinute`; страница «Traffic & limits» поллит раз в секунду, операторам read-only. (3) **Демо**: серверный `DemoService` поднимает выделенную доску «Демо» (демо-юзеры `@janosik.demo`, 5 колонок, 5 меток, по карточке на агента) и гоняет их по флоу через `CommandsService`/`CommentsService`; **все созданные id пишутся в манифест** (`DemoRun.manifest`), поэтому `stop` удаляет ровно их (доска, карточки, комменты, команды, членства, демо-юзеры) — без угадывания «демо по имени»; страница «Demo runner» (OWNER) — старт/стоп с подтверждением и живой счётчик. Миграция `20261024173310_throttle_and_demo`. Гейты: shared 367, backend 123 unit + 216 e2e (новые `traffic.service.spec`, `admin-throttle-demo.e2e-spec`), ui 758 (100 файлов: `TrafficSettingsPage`/`DemoPage` + fake-admin-server), lint/tsc/prettier/build зелёные (админ-чанк 40.24/42 KB — бюджет 39→42 на две страницы + i18n). Живой смоук на dev: PUT `limit:1000` → `/admin/traffic` видит 1000; `demo/start {users:5}` → 5/5 готово за ~6 c; `demo/stop` → доска 404, свои 6 юзеров удалены. **Догон (по ревью владельца и живой пробе браузером):** при старте без указанной доски сервис **сначала вычищает всё прежнее демо** — recorded-прогоны (по манифестам) + «сироты» по нашему маркеру заголовка `Демо · рой агентов` (старт, упавший до записи `DemoRun`, больше не оставляет висячих досок без манифеста); число **задач теперь независимо** от агентов (`cards`, раздаются round-robin); числовой элемент — общий `NumberStepper` (тот же, что WIP-лимит колонки, куда он вынесен рефактором); поле доски получило кнопку `Save`, а выбранная доска показана в панели сверху; `cleanupPending` в статусе — «Stop & clean up» доступен и после завершения роя (иначе висячую доску было не убрать); **фикс залипания счётчиков**: реф `mounted` поднимался в cleanup эффекта и в React.StrictMode оставался `false` — поллинг не обновлял UI (демо и трафик); теперь поднимается в теле эффекта. Гейты: shared 367, backend 123 unit + 216 e2e, ui 760 (100 файлов), lint/tsc/prettier/build/size зелёные (админ-чанк 40.81/42 KB). Живьём браузером (Playwright MCP): пустая доска → новая демо-доска; сироты снесены (юзеров 319→207, досок 3→1); рой 6/6 виден вживую; Stop → 0 досок. Ещё догон (наблюдаемость): кнопка «Open board» ведёт на **саму доску** (`/board/:id`) новой вкладкой, а в старт добавлен `watcherEmail` — отдельная доска создаётся под этим аккаунтом (он владелец), чтобы мастер реально зашёл и смотрел (мастер-аккаунт не участник доски); просмотрщик доски в панели получил живое авто-обновление (2с); админ-поллинг (Traffic/Demo/просмотрщик) паузается не только по скрытию вкладки, но и по потере фокуса окна (`blur`) — общий хелпер `pollWhileFocused`. Поле «Watch as» по умолчанию = email текущего мастера и запоминается в localStorage; если аккаунта с таким email нет — бэкенд создаёт его (verified) и делает владельцем доски, а на очистке удаляет, если создал прогон (существующий аккаунт не трогает), так что старт больше не падает «No active account». Прямой пуш в `main` |
| 38 | TASK-58 `board-share` ✅ | `main` | §7.9: публичный read-only шаринг доски **двух видов** — (A) статический снапшот (замороженный агрегат для «переслать / вставить / превью») и (B) живой read-only (SSE по тому же токену — смотреть рой и правки в реальном времени). Токен-сущность `BoardShare`, публичные роуты без auth, страница `/s/:token` (борд без шелла и логина), OG-картинка, TTL/отзыв, приватность-флаги; демо переключается на `live`-шару и избавляется от «Watch as»/watcher-аккаунта | токен без регистрации открывает доску в режиме A (снапшот) и B (живьём); встраивается в iframe на стороннюю страницу; отзыв/TTL гасят доступ; email участников и вложения по умолчанию не утекают; демо-рой виден по ссылке без логина. **Реализовано:** модель `BoardShare` + миграция `20261024225510_board_shares`; backend-модуль `share/` (сервис: токен 128 бит base64url, снапшот = `BoardEnvelope` + санитизированный ростер, TTL/revoke, счётчик просмотров; `ShareAccessGuard` с `ALLOW_PUBLIC_SHARES`; публичные роуты `GET /share/:token[/events|/og.png|/cards/:id/comments|/cards/:id/attachments|/attachments/:id/content]`, любые POST → 405; OG — детерминированный серверный PNG без новых зависимостей); владельческие роуты `/boards/:id/shares` (ADMIN); read-only SSE палит presence и membership; демо создаёт `live`-шару и отдаёт `shareToken`, watcher-логика удалена; админ-страница «Public shares» + аудит `share.created/refreshed/revoked`; UI `/s/:token` (вне auth-шелла, read-only `DndBoard` через `ShareBoardProvider`, живой редьюс SSE, `?embed=1`, клиентские og:meta, noindex), диалог «Поделиться» в шапке. Гейты: shared 367, backend 132 unit + 228 e2e (новые `share.service.spec`, `board-share.e2e-spec`; обновлён demo-спек), ui 768 (103 файла: `PublicBoardPage`, `ShareDialog`, `SharesPage` + fake-admin-server), lint/tsc/prettier/build/size зелёные (админ-чанк 42.74/44 KB — бюджет 42→44; публичная страница — отдельный lazy-чанк 9.77 KB). Публичный контур под **per-token rate-limit** (`ShareThrottlerGuard`, env `SHARE_RATE_LIMIT` 240/мин и `SHARE_OG_RATE_LIMIT` 60/мин на og; ключ — токен, не IP). Живой смоук браузером (без логина): live-ссылка рисует борд read-only, ход карточки виден по SSE без перезагрузки; snapshot заморожен и переживает удаление доски; embed прячет шапку; отзыв → «ссылка недоступна»; диалог создаёт/копирует/отзывает; админ-страница листит и отзывает. Прямой пуш в `main` |
| 39 | TASK-59 `admin-user-support` ✅ | `feature/TASK-59-admin-user-support` | §7.10: саппорт-действия над пользователем, которых в панели нет — **verify email** (выставить `emailVerifiedAt`), **resend verification**, **reset password** (временный, показ один раз), **delete/erase** (не только блок); плюс показ verified-статуса/даты в деталях; аудит новых действий. §7.10 также содержит полный аудит админки, разбор «что делают в админках» и бэклог TASK-60…65 | пользователя можно вручную подтвердить/снять, переслать код, выдать временный пароль и удалить аккаунт; всё в аудите; en+ru; гейты зелёные |
| 40 | TASK-60 `admin-membership-moderation` ✅ | `feature/TASK-60-admin-membership-moderation` | §7.10.3: членство доски из панели (add/remove участника, смена роли, передача владельца — сейчас read-only); удаление **вложений** мастером; ручное **восстановление soft-deleted** (карточки/доски/колонки/метки/чек-листы); **массовые операции** в таблицах | участника можно добавить/убрать/сменить роль/передать владение; вложение удаляется мастером; удалённое (soft-delete) восстанавливается; массовые действия работают; en+ru; аудит; гейты |
| 41 | TASK-61 `admin-flags-ops` ✅ | `feature/TASK-61-admin-flags-ops` | §7.10.3: **feature flags** (глобальные + per-user), тумблеры `ALLOW_REGISTRATION` и публичных шер из панели, **maintenance mode**, per-user rate limit, кнопка **purge soft-deleted** (UI к джобу TASK-38a) | флаги/тумблеры меняются из панели без правок env; maintenance mode закрывает инстанс; purge запускается кнопкой; en+ru; аудит; гейты |
| 42 | TASK-62 `admin-comms` ✅ | `feature/TASK-62-admin-comms` | §7.10.3: письмо/рассылка пользователю (на существующем мейлере TASK-51/55), **объявления/баннеры** для всех/сегмента, редактор шаблонов писем (сейчас шаблоны в коде) | письмо/рассылка уходит и логируется; объявление показывается в приложении; шаблон правится и применяется; en+ru; аудит; гейты |
| 43 | TASK-63 `admin-data-compliance` ✅ | `feature/TASK-63-admin-data-compliance` | §7.10.3: **экспорт данных пользователя** (JSON/архив), GDPR-erase (после TASK-59), retention-политика в UI, инфо о бэкапах/снапшотах | данные юзера выгружаются; erase доступен и аудируется; retention настраивается; en+ru; гейты |
| 44 | TASK-64 `admin-observability` ✅ | `feature/TASK-64-admin-observability` | §7.10.3: вьюер джоб/очередей (видео-транскод, число SSE/presence-сессий), версия/деплой, размер БД/индексы, детали health | в панели видно очереди/джобы, версию, размер БД; en+ru; гейты |
| 45 | TASK-65 `admin-security` ✅ | `feature/TASK-65-admin-security` | §7.10.3: сессии с **IP/UA**, **2FA** (нет вообще), IP-allowlist, продвинутые фильтры аудита, алерты о подозрительной активности | видно откуда сессии; 2FA включается; allowlist работает; аудит фильтруется; алерты есть; en+ru; гейты |
| 46 | TASK-66 `queue-transcode` ✅ | `feature/TASK-66-queue-transcode` | §7.11: перевести **видео-транскод** (TASK-50) с самописной in-process FIFO на **BullMQ** (очередь `transcode`). Сейчас `src/attachments/transcode.service.ts` держит очередь в памяти, «один кодек за раз», и восстанавливает `pending`-строки в `onModuleInit` — всё это BullMQ заменяет целиком: джобы переживают рестарт (очередь в Redis), ретраи `failed` с backoff, `attempts`, прогресс, дедлайн/таймаут джобы, масштабирование на N воркеров/нод (ffmpeg CPU-bound — реальное ускорение). Сохранить: `FFMPEG_PATH`/`ffmpeg-static`, атомарную подмену блоба (tmp+rename), статусы `Attachment.transcodeStatus` (none/pending/done/failed), SSE `attachment_updated`, идемпотентность (повторный `enqueue` по уже готовому — no-op). `enqueue` из `attachments.service` → `queue.add("transcode", {attachmentId}, {attempts, backoff, removeOnComplete})`. Воркер — не в request-скоупе. Observability расширить (pending/done/failed из счетчиков очереди). Миграций нет | видео перекодируются через Redis-очередь; рестарт в середине кодека не теряет задачу; падение кодека ретраится; прогресс/статусы видны; `FFMPEG_PATH` уважается; e2e: успешный кодек, гарбаж→failed с живым оригиналом, не-видео→none (перенести из `transcode.service.spec`/attachments e2e); гейты зелёные |
| 47 | TASK-67 `queue-mail` ✅ | `feature/TASK-67-queue-mail` | §7.11: **транзакционные письма через очередь** (очередь `mail`), чтобы SMTP-сбой не валил запрос. Сейчас коды подтверждения/смены email и уведомления шлются синхронно внутри запроса, и при сбое транспорта наружу летит 503 (`AuthService`). Ввести `MailQueueService`: `enqueue({to, template|subject/text/html, locale})` → `queue.add("send", …, {attempts, backoff, removeOnFail})`; воркер отправляет через `MailerService`, ретраит transient-ошибки; permanent (5xx/550) — в dead-letter без ретраев. Сохранить log-mode/`outbox` (e2e читает коды из outbox) и «код из письма» — тесты не должны гоняться за таймингом: в `NODE_ENV=test` очередь резолвится сразу (in-process drain), не через Redis. Регистрация: остаётся best-effort; `resend`/`requestEmailChange` больше не отдают 503, а отдают `{queued:true}` и статус доставки виден в observability (sent/failed/dead). Опционально: `idempotencyKey` (Message-ID) для защиты от дублей при ретраях. Миграций нет | письмо-код ставится в очередь и уходит с ретраями; сбой SMTP не валит register/resend/change; в лог-режиме код в outbox как раньше; счётчики очереди в observability; e2e (register/resend/change) зелёные без Redis; гейты |
| 48 | TASK-68 `queue-maintenance` ✅ | `feature/TASK-68-queue-maintenance` | §7.11: **регулярное обслуживание** через BullMQ **Job Scheduler** (cron) + кнопку «выполнить сейчас». Сейчас ничего не убирается автоматически: `purgeSoftDeleted` (TASK-63) крутится только по кнопке синхронно в запросе; просроченные `EmailVerificationCode`/`EmailChangeCode`, мёртвые `RefreshToken`/`AdminRefreshToken`, истёкшие `BoardShare` (expiresAt/revoked), просроченные pending-приглашения (`BoardMember.expiresAt`), осиротевшие блобы в `UPLOAD_DIR` — не убираются никогда. Ввести очередь `maintenance` и набор именованных джоб: `purge-soft-deleted` (retention-окно из `OpsSettings.retentionDays`), `sweep-codes`, `sweep-tokens`, `sweep-shares`, `sweep-invitations`, `sweep-orphan-blobs`; расписание (интервал) настраивается из панели (Ops), `upsertJobScheduler` вместо `repeat`; каждый прогон пишет аудит (`maintenance.run`) и счётчики. «Purge now» из панели ставит ту же джобу в очередь (вместо синхронного запроса), UI показывает прогресс/итог | уборки идут по расписанию без рестарта; истёкшее (коды/токены/шары/инвайты/блобы) реально удаляется; purge запускается из панели асинхронно с итогом; расписание меняется из панели; everything в аудите; e2e на каждую джобу (создать мусор → прогнать → 0 остатков); гейты |
| 49 | TASK-69 `queue-demo` ✅ | `feature/TASK-69-queue-demo` | §7.11: **демо-раннер** (TASK-57) как джоба очереди `demo`: сейчас запуск роя агентов живёт в процессе запроса/таймерах (`DemoService`), `DemoRun.manifest` уже фиксирует все созданные id. Перевести на BullMQ-джобу с **прогрессом** (`job.updateProgress` — сколько карточек дошло до done), **cancel/timeout** (стоп → `job.remove`/abort-сигнал + `stop`-путь чистит по манифесту) и авто-стопом по таймауту; статус-эндпоинт читает прогресс из джобы/`DemoRun`. `start` возвращается сразу (сейчас уже асинхронный по сути). Никаких «сирот» (маркер `Демо · рой агентов` + манифест сохраняются). Миграций нет (у `DemoRun` уже есть status/manifest) | демо стартует как джоба, прогресс виден живьём; Cancel/Stop действительно прерывает и чистит по манифесту; таймаут сам останавливает; e2e демо-лайфсайкла зелёные; гейты |
| 50 | TASK-70 `queue-media-derivatives` ✅ | `feature/TASK-70-queue-media-derivatives` | §7.11: **производные медиа** в фоне (очередь `media`): миниатюры для картинок (сейчас `AttachmentThumb` грузит **полный** блоб → трафик и лаги на больших PNG/JPEG) и **постер-кадр** для видео (первый кадр, как у топовых трекеров). Генерация джобой при загрузке (и ре-генерация при восстановлении); хранение — рядом с блобом (`thumbPath`/`posterPath` в `Attachment` или отдельные `storedName`-производные), отдача новым роутом `GET /attachments/:id/thumbnail` (и `/poster`) с кэш-заголовками; если производной нет — фолбэк на полный блоб. Добавить поля в `Attachment` (миграция) + статус derivative-джобы; не блокировать загрузку | в списках/карточках тянется миниатюра, а не оригинал; видео имеет постер; производные генерируются в фоне и переживают рестарт; фолбэк на оригинал при отсутствии; e2e генерации (image→thumb, video→poster) + ui-тест использования; гейты |
| 51 | TASK-71 `queue-exports` ✅ | `feature/TASK-71-queue-exports` | §7.11: **экспорт данных юзера** (TASK-63) через очередь `exports` для крупных аккаунтов: сейчас `AdminService.exportUser` строит JSON синхронно в запросе и отдаёт файлом — на большом юзере это долгий запрос. Ставить джобу `export-user` → собрать бандл (JSON, опц. zip с вложениями) → сохранить артефакт → уведомить заявку (in-app/email) и отдать по ссылке с TTL; прогресс и статус в панели; аудит `data.exported`. Мелкие юзеры — быстрый путь без очереди (порог по объёму). Миграция под артефакт/статус (или переиспользовать файловое хранилище `UPLOAD_DIR`) | экспорт крупного юзера выполняется в фоне, не вешая запрос; статус/прогресс видны; артефакт скачивается и истекает; мелкие — как раньше; аудит; e2e (поставить → получить артефакт); гейты |
| 52 | TASK-72 `queue-comms-scheduled` ✅ | `feature/TASK-72-queue-comms-scheduled` | §7.11: **коммуникации по расписанию** (cron + уже готовая `broadcast`-очередь): дайджесты (что изменилось на досках за период) и **напоминания по `Card.dueDate`** (за N часов/в день срока), опционально — «заброшенные» карточки. Движок: Job Scheduler ставит периодическую джобу `digest`/`due-reminders`, которая собирает получателей (участники с принятым членством, не disabled), рендерит шаблон (reuse TASK-62 редактора шаблонов) и вешает веер в `BroadcastQueueService`; частоты/вкл-выкл из панели Comms/Ops; `List-Unsubscribe` заголовок и учёт отписок (поле `User.notifyDigest`?) для доставляемости. Аудит `comms.digest_sent`/`comms.reminder_sent` | дайджест/напоминания уходят по расписанию, а не вручную; получатели уважают роли/статус/отписку; частоты настраиваются из панели; шаблоны редактируются; e2e: due-карточка → напоминание в outbox; гейты |
| 53 | TASK-73 `bull-board` ✅ | `feature/TASK-73-bull-board` | §7.11: **панель очередей** — `@bull-board` (`@bull-board/api` + `@bull-board/nestjs` + `@bull-board/ui`) поверх BullMQ: страница `/admin/queues` со списком всех очередей (broadcast/mail/transcode/maintenance/media/exports/demo) — счётчики wait/active/completed/failed/delayed, разбор джоб, ретрай/удаление, очистка. Требование безопасности: дашборд **только за `AdminJwtAuthGuard`** (Bull Board отдаёт статику, cookie-авторизация иная — маунт внутри admin-контура, OWNER-only, `disconnectOnLogout`); nginx/CSP не ломать (дашборд грузит свои ассеты `@bull-board/ui`); не светить в проде по умолчанию — флаг `QUEUES_DASHBOARD=true`. Ссылка в сайдбаре Ops (как отдельный пункт или iframe внутри Observability). Пакеты добавить в deps backend, версии согласовать с `@nestjs/bullmq@12`/`bullmq@6` | в панели видно все очереди и их джобы; можно ретраить/чистить; открыт только OWNER-мастеру за admin-контуром, по умолчанию выключен; сборка/lint/size не ломаются; гейты |
| 54 | TASK-74 `realtime-redis-fanout` ✅ | `feature/TASK-74-realtime-redis-fanout` | §7.11 (не Bull, но тот же Redis): **развязать realtime на несколько нод** — сейчас `RealtimeService` это in-process rxjs `Subject` с явным швом «Redis pub/sub» в доках; смоканный `broadcast`-контур уже требует Redis, поэтому перевести fan-out SSE на Redis pub/sub (`publish`/`subscribe`, канал на доску), сохранив `seq`-догон из лога и presence (presence остаётся per-node или тоже через Redis с TTL). Один инстанс → поведение не меняется | две ноды видят изменения друг друга по SSE; догон `?since=` не дублирует; presence не мигает; single-node путь без Redis не деградирует; гейты |
| 55 | TASK-122 `brand-system` ✅ | `feature/TASK-122-brand-system` | §7.12: единый источник бренда — лого, палитра, типографика, tone-of-voice/позиционирование; пакет `brand/` (токены + ассеты) потребляют `site`, `video` и `ui` | сайт и видео собираются на общих токенах; в `ui` нет расхождения палитры/шрифтов; бренд-гайд в `docs/`. **Выполнено:** воркспейс `@janosik/brand` — `src/tokens.ts` + `src/tokens.css` (одна правда, парити-тест `tokens.test.ts`), motion-токены (кастомные кривые + длительности), ассеты `assets/logo/` (mark, feather/lockup/wordmark в dark+light) и `assets/og/` (1200×630); `ui` импортирует токены в `index.css` (значения не менялись — визуально идентично), алиасы/tsconfig/Dockerfile обновлены; `docs/BRAND.md`. Гейты: brand 28, ui 791, lint 0 errors, build/size без изменений (201.57/300 KB) |
| 56 | TASK-123 `marketing-site-scaffold` ✅ | `feature/TASK-123-marketing-site-scaffold` | §7.12: новый воркспейс `site/` (Astro + заготовка Starlight), шелл (шапка/футер/навигация), маршруты `/`,`/pricing`,`/docs`, i18n en/ru, темы, SEO-база (meta/OG/sitemap/robots/canonical), CI-деплой статики | `npm run build -w site` зелёный; пустой сайт деплоится по CI; en/ru и тема работают; Lighthouse ≥95; CTA ведут в приложение. **Выполнено:** воркспейс `site/` (`@janosik/site`) — Astro 7 + Starlight 0.42 + `@astrojs/sitemap`; Starlight смонтирован на `/docs` через вложенную папку контента (`src/content/docs/docs/`), маркетинг владеет корнем; шелл `BaseLayout`/`Header`/`Footer`/`ThemeToggle`/`LangSwitcher`/`SEO`; i18n en/ru (словари + хелперы, 13 тестов) без Astro `i18n` (Starlight запрещает оба); светлая/тёмная темы на токенах `brand`, тема делится с доками через ключ `starlight-theme`; SEO (canonical/hreflang/OG/twitter/JSON-LD Organization+SoftwareApplication), `sitemap-index.xml`, `robots.txt`, 404; `site/` в workspaces и root-скриптах; CI: сборка сайта в `verify`; доставка — **в образе**: NestJS отдаёт сайт на `/` и приложение на `/app/` (`SITE_DIR`/`STATIC_DIR`/`UI_BASE`), Dockerfile собирает `site/`, healthcheck проверяет `/api/v1/health` и `/` (приложение переведено на подпуть: Vite `UI_BASE`, `BrowserRouter basename`, base-aware SW/манифест/шаринг-ссылки, OAuth-редиректы через `UI_BASE`). **Решения:** сайт вшит в Docker-образ (не GitHub Pages) — сайт на `/`, приложение на `/app/`; TASK-32 остаётся (внешний лендинг и in-app презентация сосуществуют). Гейты: site 13, ui 794, shared 369, brand 56, backend 193 unit + 262 e2e; lint 0 errors; format ✓; `astro check` 0 errors; сборка 7 страниц; смоук образа (сайт/приложение/доки/health) ✓ |
| 57 | TASK-124 `landing-hero-features` ✅ | `main` | §7.12: маркетинг-лендинг «как у Miro» — герой+CTA, секции всех ключевых фич со **слотами под медиа** (плейсхолдеры до Ф2), «как это работает», соц-пруф/GitHub, FAQ, финальный CTA, футер | покрыты все ключевые фичи; слоты под медиа готовы; неавторизованный видит лендинг и уходит в логин/регистрацию; мобилка без гор. скролла; en+ru. **Выполнено:** лендинг переписан «как у Miro» — герой в две колонки (оффер+CTA+мокап доски), 4 чередующихся фича-ряда (доска/виды, realtime, карточки, шаринг) с медиа-слотами, список «И детали» (8 пунктов), OSS-полоса с self-host терминалом, 4 шага, 4 FAQ, финальный CTA; новый `site/src/components/MediaSlot.astro` (варианты board/realtime/cards/sharing/selfhost, готов принять `src`/video без CLS); i18n en/ru; убраны «шаблонные» приёмы (ALL-CAPS-«eyebrow», радиальный градиент героя, сетка одинаковых карточек); мобилка без гор. скролла + вход в шапке. Гейты: site 13, `astro check` 0 ошибок, сборка 7 страниц, lint/format ✓ |
| 58 | TASK-125 `landing-pricing` ✅ | `main` | §7.12: страница `/pricing` — планы (Self-hosted/Hosted/Pro/Team/Enterprise), таблица сравнения, лимиты per-plan, CTA, FAQ по оплате/лицензии; связь с TASK-131 | тарифы с понятной сеткой и CTA; тексты en+ru; согласовано с лицензией self-hosted; якорь с лендинга. **Выполнено:** `/pricing` переписан — герой, CSS-only тумблер monthly/annual (`:has()`), 4 карточки (Self-hosted/Hosted Free/Pro★/Team), таблица сравнения (5 колонок × 4 категории, sticky-первая-колонка), Enterprise-полоса, FAQ (7), финальный CTA; все числа в едином `site/src/pricing.ts` (карточки и таблица — из одного источника, дрейф невозможен), тексты в i18n en/ru. Цены ориентировочные (Self-hosted $0 · Hosted Free $0 · Pro $8 · Team $16 · Enterprise custom; годовой = −2 месяца); CTA «лист ожидания/связаться» → `mailto:hello@janosik.app` (env `PUBLIC_CONTACT_EMAIL`) до TASK-131; тизер-полоса на лендинге → `/pricing`. Гейты: site 13, `astro check` 0, сборка 7 страниц, lint 0, format ✓; проверено вживую EN+RU, light+dark, 1280/375px (без гор. скролла) |
| 59 | TASK-126 `site-copy-cro-seo` ✅ | `main` | §7.12: копирайт всех страниц, CRO-проход, SEO (title/description/семантика), AI-SEO, `schema-markup` (Organization/SoftwareApplication/FAQ/Product), privacy-friendly аналитика и трекинг событий, OG-картинки | тексты финализированы en+ru; SEO-чеклист пройден; structured-data валиден; ключевые CTA покрыты событиями; Lighthouse SEO ≥95. **Выполнено:** копирайт-проход по скилу `copywriting` (убраны AI-tells: em dash в коротких строках, negation-списки, trailing pile-ons; CTA `Get started` → `Start your first board`); уникальные SEO title/description по страницам (`seo.*`, keyword-first: 34/39 симв., desc 140–144); структурированные данные единым JSON-LD-массивом: Organization + WebSite + SoftwareApplication (offers из `pricing.ts`) + FAQPage (home/pricing) + Product (AggregateOffer) + BreadcrumbList — валидный JSON-LD на всех страницах; AI-SEO: `/llms.txt` и `/pricing.md` (генерируются из `pricing.ts`), semantic HTML; privacy-friendly аналитика — `src/lib/analytics.ts` + `Analytics.astro`, по умолчанию **не грузится ни одного стороннего скрипта** (opt-in `PUBLIC_ANALYTICS_DOMAIN`/`PUBLIC_ANALYTICS_SRC`), события `cta_clicked` на всех ключевых CTA через `data-cta` (delegated, honour Do Not Track); OG-картинки страниц (`og-pricing.png`, `og-docs.png`) генерируются из бренд-шаблона интеграцией `og-images`. Lighthouse: SEO **100**, perf 100/99, best-practices 100 (home/pricing). Гейты: site 17 (было 13), `astro check` 0, сборка 7 страниц + `/llms.txt` + `/pricing.md`, lint 0, format ✓ |
| 60 | TASK-127 `site-a11y-perf-audit` ✅ | `main` | §7.12: аудит по Web Interface Guidelines (spacing/typography/interaction/a11y) + визуальный QA (`impeccable`) — контраст, фокус/клавиатура, мобильные таргеты, перф-бюджеты (LCP/CLS), reduced-motion | нет критичных a11y-проблем; Lighthouse a11y/perf ≥95 на лендинге и тарифах; мобилка вылизана; чеклист-отчёт в PR. **Выполнено:** аудит скилами `web-design-guidelines` + `impeccable` (`context`/`audit`/`craft-floor`) и Lighthouse desktop+mobile на `/` и `/pricing`. a11y **94/95 → 100** во всех 4 прогонах (perf 100, моб. pricing 99; LCP 0.4s desktop / 1.6s mobile, CLS ≈0). Фиксы: (1) `LangSwitcher` — `aria-label` теперь включает видимый код (`RU — Русский`), убран `label-content-name-mismatch`; (2) футер — заголовки колонок `h4`→`h2` (был пропуск уровня заголовков); (3) контраст — зелёные `✓` в макете терминала (`--success` → `color-mix(success 75%, foreground)`), бейдж «Most popular» и метка «2 months free» (`--primary` → `color-mix(primary 80%, foreground)`), текст CTA-полосы на градиенте (`--muted-foreground` → `color-mix(muted 78%, foreground)`) — всё ≥4.5:1, тема-адаптивно (light+dark, без новых токенов). Крафт: `text-wrap: balance` на заголовках и `pretty` на абзацах (убраны advisory `unbalanced-heading`/`straggler`), `font-variant-numeric: tabular-nums` в ценах и таблице сравнения. Намеренно оставлено: `overused-font` (Space Grotesk — брендовый шрифт) и advisory `nested-cards` (макет доски) — дизайн-решения, не дефекты. Гейты: site 17, `astro check` 0, сборка 7 страниц, lint 0 (51 пре-существующих warning), format ✓; проверено вживую EN light/dark, desktop 1280 + mobile 390 |
| 61 | TASK-128 `video-scaffold` ✅ | `main` | §7.12: воркспейс `video/` (Remotion) на общих бренд-токенах; композиции, скрипт рендера mp4+webm+poster в `site/public/media`, параметризация (тема/размер/fps), CI-рендер | `npm run render -w video` кладёт mp4/webm+poster в `site/public/media`; образец-композиция на токенах; Remotion не тянется в бандл `site`. **Выполнено:** воркспейс `@janosik/video` (Remotion 4.0.539, React 18) — `src/Root.tsx` (по одному авторскому `<Composition>` на клип, `theme`-проп light/dark), `src/lib/{layout,motion,fonts,types}.ts`, бренд-CSS из `@janosik/brand` (`tokens.css` + `site-tokens.css` — без хардкода цветов), Space Grotesk через `@remotion/fonts` (`loadFont`, без FOUT); `scripts/render.mjs` — один бандл на все клипы, `renderMedia` mp4 (H.264) + webm (VP8) и `renderStill` постер для каждой темы (light/dark) в `site/public/media`; `scripts/copy-assets.mjs` (шрифты+лого из `brand/`, git-ignore); CI-джоб `video` (workflow_dispatch/тег → рендер + artifact); `video/README.md`; отдельный воркспейс — Remotion не попадает в бандл `site`. Гейты: video typecheck 0, lint 0; рендер 6 клипов ✓ |
| 62 | TASK-129 `video-feature-clips` ✅ | `main` | §7.12: сценарии и рендер клипов фич на реальных состояниях UI (drag&drop, realtime, комментарии, paste-медиа, шаринг, календарь/таблица, оффлайн/PWA, админка), единый бренд-стиль, 5–15 c, луп-friendly, гифки-превью | клипы покрывают все секции лендинга; визуально консистентны; корректны в лупе; reduced-motion → статичный постер. **Выполнено:** 6 клипов 1280×800 (16:10 = аспект слота), 30 fps, 7–10 c, бесшовный луп — `Hero` (рой из ~10 агентов: 5 колонок, 10 агент-цветов, ростер из 10 аватаров, 4 пульсирующие карточки, 3 карточки в полёте между колонками, 2 коммент-бабла, «10 agents · live» в шапке), `Board` (один клип = **три вида**: канбан с drag&drop → календарь-месяц с перетаскиванием карточки на дату → таблица с сортировкой и инлайн-правкой; переключатель Kanban/Calendar/Table в шапке), `Realtime` (4 курсора разных цветов — Mira/Alex/Sam/Noor, presence-ростер, 2 карточки прилетают), `Cards` (диалог: чек-лист тикает, метки, вложение), `Sharing` (read-only ссылка + copy), `Selfhost` (терминал `docker compose up -d` → `✓ postgres ready`/`✓ janosik ready on :3000`); общий визуальный язык с `MediaSlot` (chrome/колонки/карточки/агент-доты), бренд-токены и motion-кривые. Полный список §7.12 (оффлайн/PWA, админка, paste-медиа) свёрнут до 6 клипов под реальные слоты лендинга (остальные — в бэклоге, если появятся слоты). **Обновлено (по запросу владельца):** запечённые мокапы заменены на **реальные записи приложения** — воркспейс `video/record/`: `seed.mjs` (7 демо-юзеров `@janosik.demo` + доска `Product roadmap`: 4 колонки, 12 карточек, метки, сроки, исполнители, чек-лист, комментарии; токены минтит ключом `JWT_SECRET`, refresh-куки логином), `record.mjs` (Playwright-запись UI 1280×800 light+dark, 2× device scale; hero/realtime открывают доп. контексты для реального presence и live-обновлений; ротация refresh-куки переносится между контекстами), `terminal.mjs` (клип self-host из **реального вывода** команд `docker compose`/`prisma:deploy`), `encode.mjs` (mp4 H.264 + webm VP9 + постер). `npm run clips -w video`; Remotion-пайплайн оставлен как альтернативный авторский путь |
| 63 | TASK-130 `site-media-integration` ✅ | `main` | §7.12: подстановка клипов/скринов в секции — `<video autoplay muted loop playsinline poster preload="none">`, ленивая загрузка, no-CLS, фолбэк на постер/reduced-motion, OG/превью, оптимизация размеров | лендинг показывает реальные клипы; видео не грузятся до вьюпорта; нет CLS; reduced-motion → постеры; вес страницы в бюджете. **Выполнено:** `MediaSlot` принимает `mp4`/`webm`/`poster` + `*Dark` и рендерит два `<video muted loop playsinline preload="none" poster aria-hidden data-lazy-video>` (light/dark; CSS показывает нужный по `data-theme`); клипы рендерятся в двух темах (`render` → `<slug>.*` и `<slug>-dark.*`); ленивая загрузка — `IntersectionObserver` в `BaseLayout` (`rootMargin: 200px`; играет только видимый вариант, `MutationObserver` на `data-theme` пересинхронизирует при переключении темы; `prefers-reduced-motion` → постер; no-JS → постер); no-CLS — кадр 16:10 совпадает с видео; `HomePage` мапит вариант слота → клип через `withBase` (учёт деплой-базы); `.slot-media` фон `--surface`; 6 клипов закоммичены в `site/public/media` (~5.8 MB mp4+webm+jpg, теперь реальные записи). OG/превью — постеры как `poster`; бренд-OG-карточки страниц не тронуты. Проверено вживую (Playwright, 1280): герой играет, off-screen клипы не грузятся (`readyState 0`), при скролле стартуют, гор. скролла нет. Гейты: site 17, `astro check` 0, сборка 7 страниц, lint 0 (51 пре-существующих warning), format ✓ |
| 64 | TASK-131 `billing-subscription` | `feature/TASK-131-billing-subscription` | §7.12: подписка hosted-варианта — выбор провайдера (Stripe/Paddle/ЮKassa/CloudPayments), планы и лимиты per-plan в backend, checkout, идемпотентные вебхуки, статус в UI/админке, self-hosted-лицензия | подписку можно оформить/отменить; лимиты плана реально применяются; вебхуки идемпотентны; статус виден; аудит; e2e на жизненный цикл |
| 65 | TASK-132 `docs-site` | `feature/TASK-132-docs-site` | §7.12: Starlight на `/docs` в `site/` — структура (Начало/Self-hosting/User guide/API/FAQ/Changelog), поиск, версии, i18n en/ru, тема; миграция `README`, `docs/*`, `SECURITY.md`, `CHANGELOG.md` | доки доступны на `/docs`; старые файлы мигрированы без битых ссылок; поиск работает; en+ru; сборка/деплой в CI. **Частично выполнено в TASK-133/134:** структура доков, поиск (Pagefind), i18n en/ru и тема — на месте; контент `README`/`docs/*`/`SECURITY`/`CHANGELOG` перенесён в страницы (getting-started/self-hosting/runbooks/faq/security/changelog). Осталось: версионирование доков, ссылка «Помощь/Документация» из приложения |
| 66 | TASK-133 `docs-user-guide` ✅ | `main` | §7.12: пользовательская документация — гайды по всем фичам, гифки/скрины из `video/`, «первые шаги», FAQ/troubleshooting, навигация и поиск | покрыты все пользовательские фичи; есть скринкасты/гифки; навигация/поиск работают; en+ru. **Выполнено:** 5 страниц пользовательского гайда (`site/src/content/docs[/ru]/docs/user-guide/`: index, boards, cards, collaboration, account) en+ru — режимы local/server, шапка, доски/колонки/карточки, drag&drop, три вида (Board/Calendar/Table), детали карточки (метки/приоритет/срок/исполнитель/чек-листы/связи/обложка/вложения), комментарии и markdown, вставка файлов, участники и роли, realtime/presence, публичные read-only шары, поиск/фильтр, хоткеи, аккаунт/API-ключи/настройки, оффлайн/PWA, бэкапы/экспорт/архив, лимиты; встроены клипы из `video/` (`feature-board`/`feature-cards`/`feature-realtime`/`feature-sharing`) как `<video>` с постером; навигация — Starlight sidebar с переводами, поиск Pagefind. Гейты: site 17, `astro check` 0, сборка 53 страницы, lint 0, format ✓; проверено вживую EN+RU dark |
| 67 | TASK-134 `docs-api-reference` ✅ | `main` | §7.12: API-reference (из `shared/src/api.ts` DTO / OpenAPI) с примерами curl, self-hosting runbooks (бэкап/восстановление/апгрейд/мониторинг/troubleshooting), ADR-раздел, ссылка на security-гайд | reference покрывает публичные роуты; примеры рабочие; runbooks проверены на чистой машине; ADR-структура заведена. **Выполнено:** API-reference из кода (`shared/src/api.ts` + контроллеры/DTO) — 3 страницы (`site/src/content/docs[/ru]/docs/api/`: index, commands, rest) en+ru: конвенции (префикс `/api/v1`, auth JWT+`jnk_…`, error-envelope, `409`-конфликты команд, лимиты, maintenance), 63 пользовательских роута, полный каталог `BoardAction` (48 действий), DTO-каталог (wire-типы, tri-state required, defaults, ограничения), таблица ошибок; self-hosting с полным env-reference (29 переменных) и per-OS Docker; runbooks (бэкап/восстановление/апгрейд/мониторинг/troubleshooting) symptom-first с rollback; ADR-раздел (index + ADR-001 command log, ADR-002 single-image deploy, ADR-003 AGPL+trademark, формат Nygard); security-гайд; faq; changelog. Команды/env взяты из репозитория; внутренние ссылки проверены (48 маршрутов резолвятся). Runbook-и помечены как проверенные против репозитория, не против чистой машины (честно) |
| 68 | TASK-135 `landing-agent-swarm` ✅ | `main` | Вне очереди, по запросу владельца: развернуть лендинг под главную идею — канбан не для человека, а для **роя ИИ-агентов**, а человек наблюдает. Опирается только на реальные фичи: командный API `POST /boards/:id/commands` + персональные API-ключи (TASK-36.1, `jnk_…`), сериализация писателей доски (TASK-56, «рой ИИшек»), realtime SSE и публичные read-only шары (TASK-58) | ядро сайта — про рой агентов; тексты честные (никаких MCP/SDK, которых нет); en+ru. **Выполнено:** герой переписан («Kanban for your agent swarm.») + новый вариант мокапа `swarm` в `MediaSlot` (4 колонки, агенты на карточках, presence-ростер, активная карточка с пульсом, комментарий-бабл; `prefers-reduced-motion` → статика); новая секция `#swarm` «How a swarm works the board» — 3 шага (ключ → агент ведёт доску → вы наблюдаете) + реальный запрос/ответ командного API (`POST /boards/:id/commands` → `{seq, versions}`) + 3 чек-буллета; в «И детали» добавлены «Personal API keys for agents» и «Live read-only share links»; +2 FAQ («Can AI agents use Janosik?», «How do I watch the swarm?»); SEO home title/description под агентов; `llms.txt` и `site.description` обновлены; i18n en+ru. Гейты: site 17, `astro check` 0, сборка 7 страниц, lint 0 (51 пре-существующих warning), format ✓; Lighthouse a11y/perf/SEO/best-practices **100** на `/` и `/pricing`; детектор `impeccable` — только намеренные `overused-font` (Space Grotesk) и `nested-cards` (макет доски); визуально EN+RU light/dark, 1280/390 (починен гор. скролл от `<pre>` — `minmax(0,1fr)` в гриде) |
| 69 | TASK-136 `mcp-server` | `feature/TASK-136-mcp-server` | §7.12: **MCP-сервер для роя агентов** — тонкая TS-обёртка над командным API (`POST /boards/:id/commands`) и комментами; auth персональным ключом `jnk_…` (env `JANOSIK_URL`/`JANOSIK_TOKEN`); тулзы `list_boards`/`get_board`/`create_card`/`update_card`/`move_card`/`comment`/`checklist_*`/`set_label`/`assign`; read-only тулзы отдельно от write; переиспользует DTO из `shared/src/api.ts`; `npx @janosik/mcp` + регистрация в MCP registry | тулзы двигают карточку, комментят и тикают чек-лист на живом борде ключом `jnk_…`; идемпотентность/`ifMatch`/409 обработаны; e2e-смоук; опубликовано в registry |
| 70 | TASK-137 `agent-skill` | `feature/TASK-137-agent-skill` | §7.12: **скилл-плейбук роя** поверх MCP-тулзов — конвенции (колонки, когда комментировать и тащить в Review, как называть карточки), шаблоны карточек/меток, рецепт жизненного цикла; не дублирует I/O, ссылается на тулзы | скилл ставится в харнессы (Claude/opencode/Codex); агент по нему ведёт карточку на реальном борде через MCP; без дублей API-деталей |

> **TASK-38a/38b выполнены (2026-10-26).** Self-host hardening + release
> artifacts. Backend: `COOKIE_SECURE` с fail-fast boot-guard (`assertBootSecurity`
> — прод на HTTP не стартует, пока не задан `COOKIE_SECURE=false`; иначе громкий
> warn), `ALLOW_REGISTRATION` (дефолт флага `registration_open`), публичный
> `GET /auth/config` (UI прячет регистрацию, когда она закрыта), `PURGE_AFTER_DAYS`
> как фолбэк окна ретенции, SSE-поток отдаёт `X-Accel-Buffering: no` (работает
> за дефолтным nginx), SPA раздаётся самим API (`STATIC_DIR` + SPA-fallback,
> helmet CSP подстроен под инлайн-preflight темы и blob-аватары, `/s/*` остаётся
> framable для `?embed=1`). Поставка: multi-stage `Dockerfile` (UI + API в одном
> образе, `STATIC_DIR=/app/public`, `UPLOAD_DIR=/data/uploads`, entrypoint
> `prisma migrate deploy` → API), прод `docker-compose.yml` (app + postgres +
> redis, healthchecks + `depends_on: service_healthy`), аннотированный
> `.env.example`, публикация образа в `ghcr.io` из CI по тегу `v*`, `SECURITY.md`,
> `CHANGELOG.md`, шаблоны issue, README-раздел «Self-hosting with Docker».
> `prisma` переведён в runtime-зависимости (нужен в entrypoint). Гейты: shared 369,
> backend 193 unit + 259 e2e, ui 791, lint/tsc/prettier/build/size зелёные.
>
> **TASK-59…65 выполнены (2026-10-25).** Backend: user support (verify/unverify,
> resend, reset password, erase по FK-графу, promote/demote, impersonate токен),
> membership-moderation (add/remove/role/transfer, удаление вложений, restore,
> bulk), ops (feature flags с реальными потребителями + OpsSettings
> maintenance/per-user-limit/retention + purge), comms (рассылка писем,
> объявления/баннеры с таргетом all/segment, редактор шаблонов с оверрайдом
> встроенных писем), data/compliance (JSON-экспорт, retention+purge, инфо о
> бэкапах), observability (version/deploy, размер БД+таблицы, джобы, health),
> security (TOTP 2FA, IP-allowlist, алерты из аудита, IP/UA сессий у user и
> admin). UI: страницы Ops/Comms/Observability/Security, действия в деталях
> пользователя и в списке Users, модерация членства в BoardDetail, bulk в
> таблицах, бейдж verified, баннер «view as», in-app баннер объявлений;
> автодополнение получателей; en+ru. Плюс расширение TASK-62: рассылка
> новостей/апдейтов в приложение (all или выбранным юзерам) с опциональным
> «также на email»; веерная отправка — **BullMQ** (`@nestjs/bullmq` + `bullmq`
> на Redis, очередь `broadcast`, воркер `BroadcastProcessor`, `attempts`+
> backoff); `redis` добавлен в `backend/docker-compose.yml`, подключение через
> env `REDIS_URL`; без `REDIS_URL` — фолбэк на in-process очередь. Гейты:
> shared 367, backend 138 unit + 228 e2e, ui 769, lint/build/size зелёные.
> **Не покрыто тестами UI:** новые страницы (Ops/Comms/Observability/Security) —
> добавлены без отдельного ui-набора; логика покрыта backend e2e/unit.
>
> **TASK-65 addendum — IP-allowlist только для OWNER.** Менять allowlist может
> **только OWNER**; оператор — read-only (себе тоже не может — нельзя сузить
> собственный адрес входа). Поле — **своё**: owner правит только свою строку.
> **НЕ ЗАБЫТЬ (сделать позже):** управление allowlist **другим мастерам** из
> панели Masters (per-master allowlist: OWNER задаёт адреса для конкретного
> оператора) — сейчас такого UI/эндпоинта нет.

---

### 7.11. Очереди BullMQ: куда ещё прикрутить

> **Контекст.** В TASK-62 рассылка уведомлений уже переведена на **BullMQ**
> (`@nestjs/bullmq` + `bullmq` на Redis, очередь `broadcast`, воркер
> `BroadcastProcessor`), `redis` добавлен в `backend/docker-compose.yml`,
> подключение через env `REDIS_URL` (без него — фолбэк на in-process). Этот
> раздел — что ещё в приложении логично отдать очередям, в каком порядке и
> что для этого нужно. Задачи TASK-66…74.

**Общая инфраструктура (для всех задач раздела).**
- **Redis** уже есть (`REDIS_URL`, сервис `redis` в compose). Один `forRoot`,
  по одному `BullModule.registerQueue({ name })` на очередь; воркеры
  (`@Processor`/`WorkerHost`) — провайдеры, регистрируются только при
  настроенном `REDIS_URL` (как сейчас), чтобы тесты/self-host без Redis жили.
- **Очереди:** `broadcast` (есть), `mail`, `transcode`, `maintenance`, `demo`,
  `media`, `exports`. Имена — константы, не строки по коду.
- **Cron/расписания:** BullMQ **Job Scheduler** (`queue.upsertJobScheduler`),
  НЕ опция `repeat` (её в BullMQ v6 в `Queue.add` нет).
- **Надёжность:** `attempts` + `backoff` (transient) и dead-letter для
  permanent-ошибок; где уместно — `idempotencyKey`/детерминированный `jobId`
  (повторная постановка не дублирует).
- **Тесты без Redis:** в `NODE_ENV=test` очередь резолвится синхронно
  (in-process drain), e2e не должны требовать контейнер. Уже так сделано в
  `BroadcastQueueService` — тот же паттерн переносим на новые очереди.
- **Наблюдаемость:** `ObservabilityService` тянет счётчики каждой очереди
  (`getJobCounts`) в карточку «Jobs».
- **Миграции:** нужны только там, где появляются новые сущности/поля
  (TASK-70 производные медиа; TASK-71 артефакт экспорта).

**Порядок и суть задач**
1. **TASK-66 `queue-transcode`** — самый крупный кастом-код под замену:
   in-process FIFO `TranscodeService` → очередь `transcode` (рестарт-налог
   recovery, ретраи, масштабирование воркеров). Не трогает контракты
   `Attachment.transcodeStatus`/SSE.
2. **TASK-67 `queue-mail`** — транзакционные письма (коды/уведомления) в
   очередь `mail`, чтобы сбой SMTP не валил `register`/`resend`/смену email;
   log-mode/`outbox` сохранить (e2e читает коды оттуда).
3. **TASK-68 `queue-maintenance`** — регулярные уборки через Job Scheduler
   (retention-purge, истёкшие коды/токены/шары/инвайты, осиротевшие блобы) +
   «выполнить сейчас» из панели. Закрывает дыру «ничего не чистится само».
4. **TASK-69 `queue-demo`** — демо-рой как джоба (прогресс, cancel, таймаут),
   манифест уже есть.
5. **TASK-70 `queue-media-derivatives`** — миниатюры картинок и постер-кадры
   видео в фоне (сейчас UI тянет полный блоб); новые поля `Attachment` +
   роуты отдачи с кэшем.
6. **TASK-71 `queue-exports`** — экспорт данных крупных юзеров в фоне со
   ссылкой/уведомлением.
7. **TASK-72 `queue-comms-scheduled`** — дайджесты и напоминания по
   `Card.dueDate` через Job Scheduler + `broadcast`.
8. **TASK-74 `realtime-redis-fanout`** — (не Bull, но тот же Redis)
   multi-node SSE через pub/sub.

**TASK-73 `bull-board` — панель очередей (что надо).**
- **Пакеты (backend deps):** `@bull-board/api`, `@bull-board/nestjs`,
  `@bull-board/ui` (версии согласовать с `@nestjs/bullmq@12`/`bullmq@6`).
  `@bull-board/ui` — статика дашборда, `@bull-board/api` — адаптер очередей,
  `@bull-board/nestjs` — модуль Nest.
- **Маунт:** отдельный модуль, поднятый **только при `QUEUES_DASHBOARD=true`**;
  `BullBoardModule.forRoot({ route: "/api/v1/admin/queues", adapter })` +
  `forFeature` на каждую очередь. Дашборд — **за `AdminJwtAuthGuard`**
  (свой контур, OWNER-only), `disconnectOnLogout` включить; авторизация
  Bull Board по cookie/Basic не совпадает с нашим admin-JWT, поэтому
  маршрут монтируется внутри admin-контура и защищается нашим гардом.
- **UI:** пункт «Queues» в секции Ops сайдбара (OWNER), либо вкладка внутри
  Observability; открывать в новой вкладке (дашборд — своё SPA).
- **nginx/CSP:** дашборд грузит собственные JS/CSS; либо отдавать с того же
  origin (наш случай), либо ослабить CSP для этого пути. Не выставлять в
  прод-по-умолчанию.
- **DoD:** видны все очереди (wait/active/completed/failed/delayed), разбор
  джобы, ретрай/удаление/очистка; доступ только OWNER-мастеру; по умолчанию
  выключено; сборка/lint/size не ломаются.

**DoD раздела:** каждая задача — отдельный тикет с описанием выше; общий
контракт — «работает без Redis в тестах, включается наличием `REDIS_URL`»,
счётчики в observability, аудит действий из панели, en+ru для UI-частей.

**Статус: TASK-66…74 ✅ реализованы одним коммитом** (ветка `main`).
Введён общий каркас `src/ops/queue-core.ts` (`QUEUE_NAMES`,
`queuesEnabled`, `DEFAULT_JOB_OPTIONS`, `redisQueueStats`) и паттерн
«BullMQ при `REDIS_URL`, иначе in-process drain» для всех новых очередей:
`transcode` (TASK-66, детерминированный `jobId` = id вложения), `mail`
(TASK-67, `register`/`resend`/смена email больше не 503 — `{queued:true}`),
`maintenance` (TASK-68, Job Scheduler + именованные sweep'ы и «выполнить
сейчас»), `demo` (TASK-69, прогресс в `DemoRun.progress`, cancel через
`job.remove` + статус `stopping`), `media` (TASK-70, миниатюры/постеры
ffmpeg + роуты `/thumbnail`,`/poster`, поля `Attachment.thumbnailName/
posterName/derivativeStatus`), `exports` (TASK-71, `DataExport` + артефакт
под TTL), `comms` (TASK-72, дайджест + напоминания по `dueDate`,
`User.notifyDigest`; письма `digest`/`due_reminder` редактируются в
Comms-редакторе шаблонов, как и коды), Bull Board (TASK-73, `/api/v1/admin/queues` за
OWNER-тикетом, флаг `QUEUES_DASHBOARD`), realtime Redis pub/sub (TASK-74,
дедуп по `origin`). Тесты герметичны: при `NODE_ENV=test` `env.ts` глушит
`REDIS_URL`/`QUEUES_DASHBOARD`. Гейты: shared 367, backend **158 unit +
240 e2e** (новые `mail-queue.service.spec`, `maintenance.service.spec`,
`comms-scheduler.service.spec`, `admin-queues.e2e-spec`,
`media-derivatives.e2e-spec`), ui **778**
(103 файла), lint/format/tsc/build зелёные; size-limit админ-чанк
63.01/65 KB (бюджет 62→65 по прецеденту: Ops-расписания, счётчики
очередей, экспорт-флоу).

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
> бесплатно, AGPL-3.0, любой может поднять у себя. Из этого следует, что единица
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
  - **`LICENSE`** + `license`, `repository`, `description`, `author` в
    `package.json`; строка в CONTRIBUTING «отправляя PR, вы соглашаетесь, что
    вклад лицензируется под той же лицензией» — лёгкая замена CLA, снимающая
    проблему на годы вперёд. **Изначально MIT** (решение 2026-09); **изменено
    на AGPL-3.0** (решение 2026-10, см. §7.12): модель — self-hosted бесплатно
    + платное облако, и AGPL не даёт конкуренту молча крутить проприетарный
    managed-сервис на нашем коде. Имя/бренд защищает отдельная политика
    (`TRADEMARK.md`).
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

### 7.9. Публичный read-only шаринг доски (TASK-58 `board-share`)

> **Зачем (из запроса владельца).** Ссылка на доску, которая открывается **без
> регистрации** — переслать человеку, вставить в iframe на сайт, дать посмотреть
> «как есть». Этим же механизмом закрывается боль демо-роя: сейчас демо-доску
> видно только если **залогиниться в приложении под аккаунтом-владельцем**
> (watcher), а это лишний костыль (см. историю TASK-57). Шара снимает
> необходимость в watcher-аккаунте полностью.
>
> Референсы: **Figma / Miro / Notion «view-only link»** — неугадываемый токен,
> отдельный публичный роут, встраивание в сайт, часто TTL и отзыв. Копируем
> именно это: **не** «флаг публичности на доске», а **отдельная сущность
> «шера»** (token + режим + срок), которую можно отозвать.

Задача делается в **двух вариантах A и B** — оба нужны (A для «переслать /
вставить / превью», B для «смотреть вживую»), общий механизм один.

#### 7.9.0. Терминология

- **A. Статический снапшот** — замороженная копия агрегата доски на момент
  создания шеры. Не меняется. Живёт даже если доска потом удалена (снимок —
  самостоятельный слой данных). Ровно то, что «вставляют» и «пересылают».
- **B. Живой read-only** — шара указывает на **существующую** доску и открывает
  её **только на чтение**, с обновлениями через SSE. Живёт, пока жива доска и
  пока шара не отозвана/не истекла. Ровно то, чем смотрят демо-рой.
- **Шера (share)** — сущность `BoardShare`: токен, режим, набор разрешённых
  данных, срок, отзыв. Один токен = один режим.

#### 7.9.1. Модель данных `BoardShare`

```
model BoardShare {
  id                 String    @id @default(cuid())
  token              String    @unique             // 128 бит, base64url (~22 симв.)
  boardId            String                         // доска-источник (для A — на момент снимка)
  mode               String    @default("snapshot") // "snapshot" | "live"
  // A: замороженный конверт §7.3 (тот же тип, что export/import — BoardEnvelope)
  snapshot           Json?                          // null для B
  snapshotVersion    Int?                           // seq доски на момент снимка (для «снято на …»)
  title              String?                        // ярлык для списка шер владельца
  includeComments    Boolean   @default(true)       // показывать ленту/комменты
  includeAttachments Boolean   @default(false)      // вложения наружу (blob-роуты)
  expiresAt          DateTime?                       // TTL; null = бессрочно
  revokedAt          DateTime?                       // ручной отзыв
  createdBy          String                          // userId (борд) или admin email (панель/демо)
  views              Int       @default(0)
  lastViewedAt       DateTime?
  createdAt          DateTime  @default(now())

  @@index([boardId])
  @@index([createdBy])
}
```

Соображения:
- **Токен храним как есть** (не хеш): он должен быть в URL и вставляться в сайт.
  Защита — энтропия 128 бит + `expiresAt` + `revokedAt` + rate-limit. Хеширование
  сломало бы embed-сниппет (нельзя восстановить ссылку).
- **Порт-та снимка**: для A можно либо дублировать агрегат в `snapshot`, либо
  хранить ссылку на отдельную «архивную доску». Выбираем **дублирование JSON**
  (самостоятельный слой, переживает удаление источника, не тратит доску).
- В A, если доска удалена — шара всё равно открывается (снимок сам себе данные).
  В B, если доска удалена/архивирована — шара отдаёт `410 Gone`.

#### 7.9.2. Вариант A — статический снапшот

- **Что создаётся:** при создании шеры режима `snapshot` бэкенд снимает
  `BoardsService.exportBoard(boardId)` (готовый `BoardEnvelope`, §7.3 — тот же
  тип, что уже есть для export/import) и кладёт его в `BoardShare.snapshot`,
  очистив приватные поля (см. 7.9.5).
- **Роут чтения (без auth):** `GET /share/:token` → `PublicBoardDto`:
  `{ mode:"snapshot", takenAt, title, snapshot: BoardEnvelope }`.
- **Обновление снимка:** кнопка «Обновить снапшот» у владельца
  (`POST /boards/:id/shares/:shareId/refresh`, ADMIN) — переснимает агрегат,
  инкрементит `snapshotVersion`. Так «замороженная» ссылка обновляется по воле
  автора, но не самовольно.
- **Рендер:** публичная страница `/s/:token` рисует борд из JSON **существующим
  оффлайн-редьюсером** (тот же путь, что offline-first уже умеет) в режиме
  read-only — без правок/кнопок создания.
- **Превью для мессенджеров:** `GET /share/:token/og.png` — картинка доски
  (см. 7.9.6) + meta-теги `og:*` на самой `/s/:token`.
- **DoD A:** ссылка открывается в инкогнито без логина; борд виден read-only;
  правки невозможны; после удаления исходной доски ссылка всё ещё работает;
  «обновить снапшот» меняет содержимое; `og.png` отдаёт превью.

#### 7.9.3. Вариант B — живой read-only

- **Что создаётся:** шара режима `live` на существующую доску (`snapshot=null`).
- **Роуты (без auth, только чтение):**
  - `GET /share/:token` → `PublicBoardDto` `{ mode:"live", aggregate }` —
    **текущий** агрегат (тот же формат, что `GET /boards/:id`).
  - `GET /share/:token/events?since=` → **SSE** (read-only), переиспользует
    `RealtimeService.publish`/`BoardSseEvent`; дельта по `?since=` как у
    обычного борда.
- **Правки запрещены структурно:** на публичном контуре **нет** `POST`
  `/share/:token/...` вовсе (405). Никакие команды/комменты/вложения через токен
  не пишутся.
- **Присутствие:** в live-шаре показываем только «смотрят: N» без личностей
  (или выключаем событие `presence` совсем — решается в реализации; приватность
  важнее).
- **Затухание:** доска удалена/архивирована → `410 Gone`; шара отозвана/истекла →
  `404` (не раскрываем существование).
- **DoD B:** ссылка открывается без логина; борд обновляется вживую (SSE) —
  демо-рой видно по ходу; попытка любой записи → 405/403; закрытие доски гасит
  ссылку.

#### 7.9.4. Публичный контур: роуты, guard, страница, embed

- **Роутинг:** отдельный префикс `/api/v1/share/:token` **вне** user/admin JWT.
  Guard — новый `ShareAccessGuard`: находит `BoardShare` по токену, проверяет
  `revokedAt`/`expiresAt`, прокидывает `mode` и фильтры приватности; **только
  GET**. Существующие `MembershipGuard`/`CardAccessGuard` не трогаем — публичный
  контур отдельный.
- **Rate-limit:** публичные роуты под собственным лимитом на токен (иначе одну
  ссылку можно положить). Переиспользуем инфраструктуру TASK-57
  (`TrafficService`/throttler), но с отдельным окном; агрессивный лимит на
  `og.png`.
- **Страница `/s/:token` (ui):** отдельный роут **вне авторизованного шелла** и
  без `AuthProvider` — чтобы не мигало логином. Монтирует борд в read-only
  режиме (`BoardProvider` в режиме `share`, без команд-каналов), для A — из
  снапшота, для B — живой (мост SSE на `/share/:token/events`).
- **Embed:** `?embed=1` → без шапки/поиска/фильтров, только доска (для iframe на
  стороннем сайте). Заголовки специально разрешают фрейминг только этого роута
  (в остальном `frame-ancestors` строгий); CSP кастомный для `/s/*`.
- **noindex:** `X-Robots-Tag: noindex, nofollow` и `<meta name="robots">` — это
  «только по ссылке».
- **Управление шерой (владелец/панель):**
  - борд: `POST /boards/:id/shares` (ADMIN), `GET /boards/:id/shares`,
    `PATCH /shares/:id` (TTL/флаги), `DELETE /shares/:id` (отзыв); диалог
    «Поделиться» в шапке доски: выбор режима A/B, TTL, «комментарии/вложения»,
    «Copy link», «Embed» (готовый `<iframe …>` сниппет), список активных шер с
    отзывом.
  - панель: те же операции через `adminApi` (мастер и так может всё; аудит
    `share.created` / `share.revoked` в `ADMIN_AUDIT_ACTIONS`).

#### 7.9.5. Приватность и безопасность

- **Токен**: `crypto.randomBytes(16).toString("base64url")`; сравнение по
  значению (не время-безопасное — токен не секрет уровня пароля, но энтропия
  делает перебор бессмысленным).
- **Фильтры приватности** (и в A-снимке, и в B-выдаче):
  - email участников **никогда** не отдаём — только `displayName`/`avatarColor`;
  - `includeComments=false` (дефолт? — решается; предлагаю **true**, чтобы
    «смотреть демо» включало комментарии, но для A наружу — **false** по умолчанию,
    чтобы не утащить внутреннюю переписку);
  - `includeAttachments=false` по умолчанию: blob-роут `/share/:token/attachments/:id`
    появляется только при включённом флаге (иначе 404);
  - API-токены, сессии, аудит — не существуют в публичном контуре by design.
- **Эксплуатация:** TTL; ручной отзыв; `views/lastViewedAt` для аудита; флаг
  self-host `ALLOW_PUBLIC_SHARES` (дефолт **on**, но можно выключить для приватных
  инсталляций) — переменная окружения в духе TASK-38b.
- **Никаких записей** через токен — ни команд, ни комментов, ни лайков: публичный
  контур строго read-only.

#### 7.9.6. OG / превью-картинка

- `GET /share/:token/og.png` — детерминированно рисует «шапку доски» (title +
  первые карточки/колонки + бренд) в PNG **на сервере**. Варианты реализации:
  1. **Без headless**: серверный SVG→PNG (лёгкий генератор, как в демо-скрипте
     PNG-энкодер для «скриншотов»). Дешёво, но вид简陋.
  2. **Headless (Playwright)** один раз при создании/refresh шеры: рендерит `/s/:token?embed=1`
     и сохраняет PNG в blob (`UPLOAD_DIR`). Красиво, но тянет зависимости и время.
  - Решение: **Ф1 — вариант 1** (дешёвый SVG/PNG-шаблон), **Ф3 — опционально
    headless** if захочется красивого превью (за фичефлагом). OG-картинка кэшируется.
- Meta-теги на `/s/:token`: `og:title`, `og:description`, `og:image`, `og:type`,
  `twitter:card` — серверная HTML-обёртка (SPA отдаёт `index.html`; нужен лёгкий
  SSR-html именно для `/s/*`, либо отдавать статический шаблон с подстановкой).

#### 7.9.7. Интеграция с демо (главный выигрыш и упрощение)

- `DemoService.start` создаёт на демо-доске `BoardShare(mode:"live",
  includeComments:true, createdBy: admin email)` и возвращает `shareToken` в
  `AdminDemoStatusDto`.
- `DemoPage`:
  - **«Open live view»** → `/s/<token>` новой вкладкой (без логина, без watcher);
  - **«Copy share link»**;
  - **убрать** поле «Watch as»/`watcherEmail`, автосоздание аккаунта,
    `manifest.watcherId` и всю watcher-логику очистки — она была костылём ровно
    из-за отсутствия шеры.
- `DemoService.stop` удаляет и шеру (каскад от доски/явно) — **ссылка гаснет
  вместе с демо** (иначе живой токен остался бы после очистки доски → 410, но
  лучше убрать запись).
- Итог: демо больше **не** требует второй учётки; смотрят по ссылке. «Open board»
  (в реальный `/board/:id`) можно оставить как есть — для тех, у кого есть
  доступ; но основной путь наблюдения — шара.

#### 7.9.8. Влияние на существующий код (карта изменений)

- **backend**
  - `prisma/schema.prisma`: модель `BoardShare` + миграция
    `board_shares`.
  - новый модуль `share/`: `share.module.ts`, `share.controller.ts`
    (публичные роуты `/share/:token`, `/events`, `/og.png`, вложения по флагу),
    `share.service.ts` (токен, режимы, снимок, фильтры приватности, TTL/revoke),
    `share-access.guard.ts`, DTO.
  - `boards/`: `createShare/listShares/refreshSnapshot/revokeShare` (ADMIN).
  - `commands/` (events): ветка read-only SSE по токену — переиспользовать
    `RealtimeService`, но без `apply`.
  - `admin.controller`/`admin.service`: просмотр/отзыв шер, аудит.
  - `config/env.ts`: `ALLOW_PUBLIC_SHARES`, лимиты публичного контура.
- **shared**
  - `BoardShareMode = "snapshot"|"live"`, `BoardShareDto`, `CreateShareRequest`,
    `UpdateShareRequest`, `PublicBoardDto`, `SHARE_LIMITS`;
  - новые `ADMIN_AUDIT_ACTIONS`: `share.created`, `share.revoked`, `share.refreshed`.
- **ui**
  - роут `/s/:token` + `PublicBoardPage` (read-only, offline-рендер снапшота; live —
    мост SSE на `/share/:token/events`), `?embed=1`-режим.
  - realtime-мост (`store/realtime.ts`) — параметр «источник» (борд по членству
    vs шара по токену).
  - диалог «Поделиться» в шапке доски (ADMIN): режим, TTL, флаги, Copy, Embed,
    список/отзыв.
  - i18n en+ru для публичной страницы и диалога.
- **admin**
  - кнопки в `DemoPage` («Open live view», «Copy share link») и в
    `BoardContentPage` («Share»).

#### 7.9.9. Тесты и живая проба

- **unit**: `share.service.spec` — генерация токена и уникальность; снимок A
  (переживает удаление доски); TTL/`revokedAt` → отказ; фильтры приватности
  (email вычищен, вложения/комменты по флагу); `live` без записи; инкремент
  `views`.
- **e2e** `board-share.e2e-spec`: создание только ADMIN (user-token → 403);
  A-снапшот по токену **без auth** → 200 read-only; B — `GET` + SSE по токену,
  изменение доски видно в потоке; любой `POST` по токену → 405; `revoke` → 404;
  истёкший TTL → 404; удалённая доска (B) → 410; `includeAttachments=false` →
  blob 404; в выдаче нет `email`; `og.png` → `image/png`;
  `ALLOW_PUBLIC_SHARES=false` → 404.
- **ui** `PublicBoardPage.test.tsx`: рендер read-only из снапшота; live-обновление
  по фейковому SSE; `?embed=1` скрывает шапку; отсутствие кнопок правок;
  диалог «Поделиться» (создать/Copy/revoke).
- **живая проба** (Playwright): создать шеру из борда → открыть в **инкогнито без
  логина** → борд виден; для B — запустить демо-рой и увидеть движение карточек
  по ссылке; отозвать → страница гаснет.

#### 7.9.10. DoD задачи (целиком)

- Режим **A**: статический снапшот открывается по ссылке без регистрации,
  read-only, встраивается в iframe, переживает удаление исходной доски,
  обновляется по кнопке, отдаёт OG-превью. 
- Режим **B**: живой борд по токену обновляется через SSE, read-only, гаснет при
  удалении доски/отзыве.
- Приватность: email/вложения/комменты — по флагам, дефолты безопасные;
  `noindex`; rate-limit на токен; `ALLOW_PUBLIC_SHARES` работает.
- Демо: «Open live view»/«Copy share link» **без** watcher-аккаунта; «Watch as»
  и вся watcher-логика удалены; ссылка гаснет вместе со `stop`.
- Гейты зелёные (unit + e2e + ui + lint/tsc/build/size); публичная страница —
  **ленивый чанк**, критический путь не растёт; e2e против `docker compose` из
  TASK-38b (новая env-переменная → проверка «поднимается с нуля», §8).

#### 7.9.11. Фазы (предлагаемый порядок)

1. **Ф1 — вариант A**: `BoardShare` + A-снапшот + `GET /share/:token` + страница
   `/s/:token` (read-only из JSON) + «Copy link» + дешёвый `og.png`. Демо уже
   может отдавать ссылку на **финал** роя.
2. **Ф2 — вариант B**: `mode:"live"` + `GET /share/:token/events` (read-only SSE)
   + публичная страница в live-режиме + интеграция демо («Open live view»),
   **удаление** «Watch as»/watcher-логики.
3. **Ф3 — embed и приватность**: `?embed=1`, диалог шеры с TTL/флагами/отзывом,
   `includeAttachments`, self-host флаг `ALLOW_PUBLIC_SHARES`, (опц.) headless OG.

#### 7.9.12. Зависимости и пересечения

- **Зависит от:** TASK-30/36 (SSE/realtime-мост), TASK-25 (миграции),
  TASK-43 (админ-контур для управления шерами), TASK-57 (демо — интеграция
  `live`-шеры и снятие watcher).
- **Пересекается:** TASK-39 `public-demo` (публичный инстанс — шара это его
  частный случай «показать доску наружу»), TASK-38b (self-host: флаг и проверка
  «поднимается с нуля»).
- **Не трогает:** текущие `MembershipGuard`/`CardAccessGuard` и командный контур —
  публичная шара идёт **отдельным read-only контуром**.

#### 7.9.13. Открытые вопросы (решить в реализации)

- Снимок A: дублировать JSON в `BoardShare` (выбрано) или архивировать доску? —
  дублирование дешевле и переживает удаление.
- `includeComments` дефолт наружу: **false** для A (переслать «доску», не переписку),
  **true** для B-демо (наблюдать работу) — если владелец не против, единый дефолт.
- Presence в B: «смотрят N» без личностей или полностью скрыть.
- OG: дешёвый серверный PNG (Ф1) vs headless-рендер (Ф3, за флагом).

---

### 7.10. Админ-саппорт пользователя + аудит панели (TASK-59 `admin-user-support`)

> **Повод.** В панели нельзя подтвердить пользователя вручную, переслать код,
> сбросить ему пароль или удалить аккаунт — при том что гейт подтверждения
> (TASK-53) и приглашения/мастера уже есть. Это классические саппорт-кейсы, и их
> отсутствие — самая заметная дыра. Ниже: (1) полный аудит того, что уже есть;
> (2) разбор, что вообще делают в админ-панелях; (3) чего нет и в каком порядке
> это закрывать; (4) объём именно TASK-59.

#### 7.10.1. Инвентаризация: что в нашей админке УЖЕ есть

- **Пользователи:** список/поиск/детали (9 read-only вкладок: членства, карточки,
  назначенные, комменты, вложения, сессии, токены, команды, активность); создать
  (с временным паролем); переименовать; **блок/разблок** (`disabledAt`); **смена
  email** (мгновенно, без кода, + ревок сессий); **ревок сессий**; **ревок
  API-токенов**. Полей верификации в DTO/сервисе нет.
- **Доски:** список; **content-редактор** (`/admin/boards/:id/content`:
  создание/переименование/удаление колонок и карточек **через команды** от имени
  владельца); archive/unarchive; delete; meta + members (read-only) + живой
  просмотр.
- **Карточки:** список, archive/unarchive, delete; приоритет/due в таблице.
- **Комменты:** список, delete. **Вложения:** список, скачивание мастером (удаления нет).
- **Сессии:** список (id/created/expires), ревок. **Токены:** список, ревок.
- **Мастера:** create; update (блок/роль); сброс пароля; ревок сессий. **Удаления
  мастера нет.**
- **Логи:** аудит, команды, активность — просмотр (с поиском/периодом).
- **Эксплуатация:** Email service, OAuth login, **Throttle/Traffic** (TASK-57),
  **Demo runner** (TASK-57), dashboard-metrics, глобальный поиск (omnibox),
  18 сущностей generic-списками (в основном read-only).

#### 7.10.2. Что делают в админ-панелях (индустрия) — по категориям

1. **User lifecycle / поддержка** — подтвердить/снять email, переслать код,
   сбросить пароль, «выйти со всех устройств», **impersonate** («войти как»),
   удалить/**erase (GDPR)**, объединить аккаунты, заметки/теги к юзеру, план/биллинг.
2. **Доступы и роли** — роли/права, команды, приглашения, **передача владения**.
3. **Модерация контента** — просмотр/правка/скрытие/удаление/**восстановление**,
   массовые операции, эскалация.
4. **Флаги и конфиг** — feature flags (глобальные и per-user), тумблеры
   (регистрация, публичные шеры), **maintenance mode**, лимиты.
5. **Коммуникации** — письмо/рассылка юзеру, редактор шаблонов, **объявления/баннеры**.
6. **Данные и комплаенс** — **экспорт данных юзера**, GDPR-стирание, retention,
   бэкапы/снапшоты с UI.
7. **Ops/наблюдаемость** — health, метрики, логи, **очереди/джобы**, лимиты,
   версия/деплой, размер БД.
8. **Безопасность** — сессии с **IP/UA**, 2FA управления, IP-allowlist, аудит с
   фильтрами, алерты о подозрительной активности.

#### 7.10.3. Чего у нас НЕТ — **принято всё** (маппинг на задачи)

Владелец подтвердил: нужно **всё** перечисленное ниже. Разбивка по задачам:

- **TASK-59 `admin-user-support` (эта):** по пользователю — verify/unverify email,
  resend verification, reset password (temp), **delete/erase**, показ verified-статуса
  и даты, **promote/demote мастер** (аккаунт-уровень), **impersonate** (read-only
  «view as» поддержки, с аудитом и баннером).
- **TASK-60 `admin-membership-moderation`:** членство доски (add/remove, смена роли,
  передача владельца); удаление **вложений** мастером; **восстановление
  soft-deleted** (`deletedAt`) для карточек/досок/колонок/меток/чек-листов;
  **массовые операции** в таблицах.
- **TASK-61 `admin-flags-ops`:** feature flags (глобальные + per-user), тумблеры
  `ALLOW_REGISTRATION` / публичных шер, **maintenance mode**, per-user лимиты,
  кнопка **purge soft-deleted** (закрывает TASK-38a со стороны UI).
- **TASK-62 `admin-comms`:** письмо/рассылка пользователю, **объявления/баннеры**,
  редактор шаблонов писем (сейчас шаблоны в коде).
- **TASK-63 `admin-data-compliance`:** экспорт данных пользователя, GDPR-erase
  (после TASK-59), retention-политика UI, инфо о бэкапах/снапшотах.
- **TASK-64 `admin-observability`:** вьюер джоб/очередей (видео-транскод, число
  SSE/presence), версия/деплой, размер БД/индексы, детали health.
- **TASK-65 `admin-security`:** сессии с **IP/UA**, **2FA**, IP-allowlist,
  продвинутые фильтры аудита, алерты о подозрительной активности.
- **TASK-58 `board-share`:** публичные read-only ссылки (уже заведена, §7.9).

#### 7.10.4. Объём TASK-59 (эта задача) — саппорт-действия над пользователем

**Backend**
- DTO `AdminUpdateUserDto` + `updateUser`: флаг **`emailVerified: boolean`** →
  `emailVerifiedAt = new Date()` / `null`; аудит `user.verified` / `user.unverified`.
- **`POST /admin/users/:id/verification/resend`** — переиспользовать существующую
  генерацию кода TASK-53 (`EmailVerificationCode`: только sha256, одна живая
  строка, TTL 15 мин; письмо `verificationCodeEmail` en/ru по `Accept-Language`).
  В log-mode — письмо в лог/outbox; для верифицированного — 409.
- **`POST /admin/users/:id/password/reset`** — симметрично `resetMasterPassword`:
  сгенерировать временный пароль (argon2id), вернуть **один раз**, ревок всех
  сессий юзера, аудит `user.password_reset`.
- **`DELETE /admin/users/:id`** — **erase**: в одной транзакции удалить
  authoring-след пользователя (Command/Comment/Activity/Attachment где он actor/
  author; закрыть member-строки; аппаратно код-таблицы `EmailChangeCode`/
  `EmailVerificationCode`; refresh/api токены; `Card.assigneeId` → SetNull), затем
  сам `User`. Это разрушительно для лога досок → подтверждение в UI вводом email.
  Оставляем **disable** как мягкую блокировку; erase — отдельно. (Опция на будущее:
  **анонимизация** вместо удаления.)
- **`POST /admin/users/:id/promote`** → создать `AdminUser` из пользователя (email,
  сгенерированный временный пароль, роль `OPERATOR`), аудит
  `admin.promoted_from_user`; **demote** мастера обратно в `User` — симметрично.
- **`POST /admin/users/:id/impersonate`** — «войти как юзер» для поддержки: минт
  короткого user-токена (aud `janosik-user`, `sub`=userId, claim `imp`=adminId,
  TTL 15 мин); в сеансе действия аудируются как совершённые мастером; UI
  показывает несмываемый баннер «Вы смотрите как <email> — выйти». Полный
  read-only серверно не гарантируется → ограничение в UI (баннер/бан записи);
  риск осознанный и полностью в аудите.
- Аудит-экшены в `ADMIN_AUDIT_ACTIONS`: `user.verified`, `user.unverified`,
  `user.verification_resent`, `user.password_reset`, `user.delete`,
  `admin.promoted_from_user`, `admin.demoted_to_user`, `user.impersonated`.

**Frontend (панель)**
- Детали юзера: **бейдж verified/не verified + дата**; в actions — **Verify /
  Unverify email**, **Resend verification** (дизейбл если verified / почта в
  log-mode не шлёт — показать причину), **Reset password** (диалог, показ временного
  пароля один раз, копирование), **Delete user** (диалог с вводом email, danger),
  **Promote to master** (и обратный Demote), **Impersonate (view as)** — открывает
  борд пользователя в новом табе с несмываемым баннером и «выйти».
- Те же действия в строковом меню списка Users (через `EntityPage`-действия).
- i18n en+ru.

**Тесты**
- e2e `admin-user-support.e2e-spec`: verify снимает гейт (логин/борда открываются);
  resend кладёт код в outbox/лог (и 409 для verified); reset выдаёт пароль, старый
  не работает, сессии отозваны; delete FK-safe (создать у юзера команды/комменты/
  вложения/членства → удалить → 0 остатков), аудит на месте; verify идемпотентен;
  erase необратим.
- ui: `UserDetailPage` — новые действия/диалоги, бейдж verified, показ temp-пароля;
  `entity-configs` actions.
- Гейты: unit+e2e+ui+lint/tsc/build/size; админ-чанк в бюджет.

**DoD TASK-59:** в панели можно подтвердить/снять подтверждение, переслать код,
сбросить пароль (temp, разово), стереть пользователя, сделать мастера из юзера
(и обратно) и войти как пользователь (impersonate) с баннером — всё в аудите;
en+ru; гейты зелёные.

#### 7.10.5. Порядок работ и зависимости

Порядок (сначала фундамент, потом надстройки):
1. **TASK-59** (user support) — самостоятельна, первой.
2. **TASK-60** (membership/moderation) — переиспользует guard'ы и действия `EntityPage`.
3. **TASK-61** (flags/ops, purge) — закрывает env-дырки и UI-часть TASK-38a.
4. **TASK-58** (shares) — независима (см. §7.9), можно параллельно.
5. **TASK-64** (observability) — рядом с TASK-61 (тумблеры/джобы).
6. **TASK-62** (comms) — на существующем мейлере (TASK-51/55).
7. **TASK-63** (data/compliance) — после TASK-59 (erase) и TASK-38a (retention).
8. **TASK-65** (security) — 2FA/IP-allowlist самые тяжёлые, последними.

- **Зависит от:** TASK-43/48 (админ-контур и детали юзера), TASK-51/53 (коды смены
  email/регистрации — переиспользуем), TASK-38a (purge/retention).
- **Связано с:** TASK-58 (шеры), TASK-36 (presence — для impersonate/баннера).
- **Не трогает:** публичный и командный контуры бордов — erase идёт по FK-графу
  User, как `DemoService.purge`.

#### 7.10.6. OWNER vs OPERATOR (TASK-79)

Панель различает две роли мастер-аккаунта. **OPERATOR** — «полный доступ к данным,
никакого управления контуром»: он видит метрики, сущности, сессии, аудит, письма,
шаблоны, ops-настройки (read), но **не меняет** глобальное состояние. **OWNER**
может всё.

OWNER-only на сервере (`assertOwner`, `admin/admin.service.ts` + гейт в
`admin/admin.controller.ts`):

- глобальные ops/flags: `PUT /admin/ops`, `PATCH /admin/flags/:key`;
- comms: создание/правка/удаление объявлений, `POST /admin/email/send`,
  `PUT|DELETE /admin/email-templates/:key`;
- housekeeping: `POST /admin/maintenance/run`, `POST /admin/retention/purge`;
- опасные действия над пользователем: `promote`, `impersonate`,
  `reset password`, экспорт данных (`GET /admin/users/:id/export`,
  `POST /admin/users/:id/export`, `GET /admin/exports/:id/download`);
- управление мастерами (`admins`), email/OAuth-настройки, IP-allowlist
  (было и раньше).

UI (`OpsPage`, `CommsPage`) при `admin.role !== "OWNER"` показывает состояние
read-only и дисейблит контролы; сервер — единственный источник истины.

---

### 7.12. Сайт, документация и видео о продукте (TASK-122…134)

> **Зачем.** У проекта нет ни маркетинг-сайта, ни сайта документации — есть только
> `README.md` и три markdown-гайда в `docs/`. Продукт продаётся двумя способами
> (self-hosted open-source и hosted-подписка), поэтому нужен витринный сайт «как у
> Miro» с показом фич (видео/скрины) и отдельный доковый сайт.
>
> **Решения (зафиксировать в §7.0 при старте первой задачи волны).**
> - **Стек сайта и доков — Astro** (`site/`): маркетинг-страницы + Astro Starlight
>   на `/docs` в одном проекте. Причины: статика/SEO из коробки, MDX-контент,
>   React-острова переиспользуют наш UI-код, Starlight даёт доки/поиск/версии без
>   велосипеда, один toolchain (Vitest) на `site`+docs. Альтернатива (расширять
>   `ui/` Vite) отклонена: маркетинг и приложение — разные ритмы и бандлы.
> - **Видео — Remotion** (`video/`): React → mp4/webm, детерминированно, без
>   внешних сервисов; рендер кладётся в `site/public/media`.
> - **Единый источник бренда** — `brand/` (токены) → `site`, `video`, `ui`.
> - **Медиа не в JS-бандл** — только `<video>`/`<img>` со `poster`, lazy.
> - **Связь с TASK-32 `landing-intro`:** TASK-32 (презентационная страница
>   неавторизованным внутри приложения) остаётся точкой входа приложения; TASK-124
>   — внешний маркетинг-лендинг. Общий бренд и, где можно, общие тексты.
>   **Решено в TASK-123:** обе страницы сосуществуют — внешний лендинг `site/` не
>   заменяет in-app презентацию TASK-32.
> - **Доставка сайта — в образе** (не GitHub Pages): Dockerfile собирает `site/`
>   (приложение — с `UI_BASE=/app/`), а NestJS отдаёт сайт на `/`, приложение на
>   `/app/` и API на `/api/v1` (`SITE_DIR`/`STATIC_DIR`/`UI_BASE`); healthcheck
>   проверяет `/api/v1/health` и `/`. Внешний хостинг сайта (кастомный домен) —
>   отдельный деплой через `SITE_URL`/`SITE_BASE`.
> - **Лицензия — AGPL-3.0** (+ `TRADEMARK.md`): self-hosted бесплатен, но
>   производный managed-сервис обязан делиться изменениями; имя «Janosik»
>   защищено отдельной политикой. Изменено с MIT в ходе монетизации
>   (TASK-125/TASK-131).

**Раскладка репозитория**

```
brand/    токены бренда (палитра/шрифты/лого) — единственный источник
site/     Astro: маркетинг-лендинг + Starlight-доки (/docs) + public/media
video/    Remotion-проект: сценарии клипов фич, рендер → site/public/media
```

`site` и `video` — новые npm-воркспейсы; `brand` — пакет токенов, который
импортируют `site`, `video` и (частично) `ui`.

**Фазы**

| Фаза | TASK | Итог фазы |
| --- | --- | --- |
| Ф0 Бренд | 122 | Единые токены и тон; сайт/приложение/видео наследуют |
| Ф1 Сайт | 123–127 | Лендинг с секциями фич, тарифы, a11y/перф, SEO |
| Ф2 Видео | 128–130 | Клипы фич отрендерены и встроены в лендинг |
| Ф3 Подписка | 131 | Hosted-оплата и планы (после решения владельца) |
| Ф4 Доки | 132–134 | Доковый сайт: self-host, user guide, API |

**Порядок и зависимости:** 122 → 123 → 124 → {125, 126, 127}; 128 → 129 → 130
(129 требует стабильного UI приложения); 131 — независимо, ждёт решения о
провайдере; 132 — можно начинать сразу после 122 (токены), 133/134 — после 132.
Скилы ставятся **по фазам** (не все сразу).

**Карта скилов → задачи**

| Задача | Скил(ы) |
| --- | --- |
| 122 | `leonxlnx/taste-skill@brandkit` (опц.), `emilkowalski/skills@emil-design-eng` |
| 123 | `vercel-labs/agent-skills@vercel-composition-patterns` |
| 124 | `anthropics/skills@frontend-design`, `vercel-labs/agent-skills@web-design-guidelines` |
| 125 | `coreyhaines31/marketingskills@pricing-strategy` |
| 126 | `coreyhaines31/marketingskills@{copywriting,page-cro,seo-audit,ai-seo,schema-markup,analytics-tracking}` |
| 127 | `vercel-labs/agent-skills@web-design-guidelines`, `pbakaus/impeccable` |
| 128–129 | `remotion-dev/skills@remotion-best-practices` (+ опц. `heygen-com/hyperframes@product-launch-video`) |
| 130 | `coreyhaines31/marketingskills@image` (опц.) |
| 131 | — (решить провайдера) |
| 132 | `anthropics/skills@doc-coauthoring` |
| 133 | `riekelt/technical-writer@technical-writing`, `anthropics/skills@doc-coauthoring` |
| 134 | `addyosmani/agent-skills@documentation-and-adrs`, `riekelt/technical-writer@{writing-design-docs,writing-runbooks}` |

---

#### TASK-122 — `brand-system` · Бренд-система и токены

- **Скилы:** `leonxlnx/taste-skill@brandkit` (опц.), `emilkowalski/skills@emil-design-eng`
- **Зачем:** сейчас цвета/шрифты живут только в `ui/src/index.css`; сайт и видео
  добавят третий-четвёртый набор. Нужен один источник истины.
- **Что:**
  - лого (svg, светлая/тёмная, favicon/apple-touch, OG-вариант), палитра, шкала
    типографики, радиусы, тени, motion-токены;
  - тон голоса и позиционирование (что за продукт, для кого, чем отличается) —
    короткий бренд-гайд;
  - `brand/` — токены (CSS custom properties + TS-объект) и ассеты; `site` и
    `video` импортируют, `ui` подтягивает палитру/шрифты **без редизайна**.
- **Трогаем:** новый `brand/`, `ui/src/index.css` (подтянуть токены), корневой
  `package.json` (workspaces).
- **DoD:** единый файл токенов; `site` и `video` собираются на нём; в `ui` нет
  расхождения по палитре/шрифтам; лого во всех форматах; бренд-гайд в `docs/`.
- **Зависимости:** нет (первая задача волны).

#### TASK-123 — `marketing-site-scaffold` · Каркас маркетинг-сайта

- **Скилы:** `vercel-labs/agent-skills@vercel-composition-patterns`
- **Зачем:** нужен воркспейс под лендинг и доки.
- **Что:** новый воркспейс `site/` (Astro + Starlight-заготовка), базовый шелл
  (шапка/футер/навигация), маршруты (`/`, `/pricing`, `/docs`), i18n en/ru,
  светлая/тёмная тема, SEO-база (`<head>`-компонент: title/description/OG/twitter,
  `sitemap.xml`, `robots.txt`, canonical, базовая structured-data), 404; CI-job
  сборки/деплоя статики (gh-pages/Cloudflare Pages/Vercel — решить); dev-порт и
  скрипты в корневом `package.json` (workspaces).
- **Трогаем:** новый `site/`, корневой `package.json`, CI workflow.
- **DoD:** `npm run build -w site` зелёный; пустой сайт деплоится по CI;
  переключение en/ru и темы работает; Lighthouse ≥95 по перф/SEO/a11y на пустом
  каркасе; ссылки «Войти»/«Создать аккаунт» ведут на приложение; решён вопрос с
  TASK-32.
- **Зависимости:** 122.

#### TASK-124 — `landing-hero-features` · Лендинг: герой и фичи

- **Скилы:** `anthropics/skills@frontend-design`, `vercel-labs/agent-skills@web-design-guidelines`
- **Зачем:** витрина «как у Miro» — показать продукт.
- **Что:** герой (оффер + CTA + медиа-слот), секции фич (drag&drop, realtime,
  комментарии, вложения/видео, шаринг доски, календарь/таблица, PWA/оффлайн,
  админка) — каждая со **слотом под медиа** (плейсхолдер-постер до Ф2), «как это
  работает» (3–4 шага), соц-пруф/логотипы (или «open source на GitHub»), FAQ,
  финальный CTA, футер; полностью адаптивно, `prefers-reduced-motion`.
- **Трогаем:** `site/`.
- **DoD:** лендинг покрывает все ключевые фичи; слоты под медиа готовы к
  подстановке; неавторизованный видит лендинг и уходит в логин/регистрацию;
  deep-links не сломаны; мобилка без горизонтального скролла; en+ru.
- **Зависимости:** 123.

#### TASK-125 — `landing-pricing` · Тарифы и подписка

- **Скилы:** `coreyhaines31/marketingskills@pricing-strategy`
- **Зачем:** монетизация hosted-варианта.
- **Что:** страница `/pricing`: планы (Self-hosted free / Hosted free / Pro /
  Team / Enterprise), таблица сравнения, лимиты per-plan, CTA (начать/связаться),
  FAQ по оплате и лицензии; связь с billing (TASK-131) — до него CTA ведут в
  «свяжитесь/лист ожидания».
- **Трогаем:** `site/`.
- **DoD:** страница тарифов с понятной сеткой и CTA; тексты en+ru; якорь на
  лендинге; согласовано с лицензией/self-hosted (что бесплатно, что платно).
- **Зависимости:** 123, 124; согласование с TASK-131.

#### TASK-126 — `site-copy-cro-seo` · Текст, конверсия и SEO

- **Скилы:** `coreyhaines31/marketingskills@{copywriting,page-cro,seo-audit,ai-seo,schema-markup,analytics-tracking}`
- **Зачем:** сайт должен находиться в поиске и конвертировать.
- **Что:** копирайт всех страниц (заголовки/офферы/CTA), CRO-проход по лендингу и
  тарифам, SEO (title/description по страницам, семантика, внутренние ссылки),
  AI-SEO (структура под AI-выдачу), `schema-markup` (Organization/
  SoftwareApplication/FAQ/Product), аналитика и событийный трекинг
  (privacy-friendly), OG-картинки страниц.
- **Трогаем:** `site/`.
- **DoD:** тексты финализированы en+ru; SEO-чеклист пройден; structured-data
  валиден; события трекинга покрывают ключевые CTA; Lighthouse SEO ≥95.
- **Зависимости:** 124, 125.

#### TASK-127 — `site-a11y-perf-audit` · Аудит доступности и перфа

- **Скилы:** `vercel-labs/agent-skills@web-design-guidelines`, `pbakaus/impeccable`
- **Зачем:** «не тупой сайт» = доступный, быстрый, без визуального мусора.
- **Что:** аудит по Web Interface Guidelines (spacing/typography/interaction/
  a11y), проход `impeccable` по визуальным проблемам, контраст, фокус/клавиатура,
  мобильные таргеты, перф-бюджеты (LCP/CLS/размер), `prefers-reduced-motion`,
  исправления.
- **Трогаем:** `site/`.
- **DoD:** нет критичных a11y-проблем (axe/ручной прогон); Lighthouse a11y/perf
  ≥95 на лендинге и тарифах; мобильная версия вылизана; отчёт-чеклист в PR.
- **Зависимости:** 124, 125.

#### TASK-128 — `video-scaffold` · Каркас видео-пайплайна

- **Скилы:** `remotion-dev/skills@remotion-best-practices`
- **Зачем:** клипы фич должны собираться повторяемо и лежать как ассеты.
- **Что:** воркспейс `video/` (Remotion) на общих бренд-токенах; структура
  композиций; скрипт рендера (mp4 + webm + постер-кадр) в `site/public/media`;
  параметризация (тема, размер, fps); CI-job ручного/тегового рендера;
  документация по запуску.
- **Трогаем:** новый `video/`, CI workflow.
- **DoD:** `npm run render -w video` даёт mp4/webm+poster в `site/public/media`;
  композиция-образец на бренд-токенах; сборка не тянет Remotion в бандл `site`.
- **Зависимости:** 122.

#### TASK-129 — `video-feature-clips` · Клипы ключевых фич

- **Скилы:** `remotion-dev/skills@remotion-best-practices` (+ опц. `heygen-com/hyperframes@product-launch-video`)
- **Зачем:** «фичи как у Miro» — показать движением.
- **Что:** сценарии и рендер клипов по фичам (drag&drop, realtime-прилёт,
  комментарии/упоминания, paste-медиа/видео-вложения, шаринг доски read-only,
  календарь/таблица, оффлайн/PWA, админка/очереди) на реальных состояниях UI
  (фикстуры/демо-данные); единый стиль (бренд), длительность 5–15 c, луп-friendly;
  гифки-превью для доков.
- **Трогаем:** `video/`.
- **DoD:** набор клипов покрывает все секции лендинга; визуально консистентны;
  корректно смотрятся в лупе; `prefers-reduced-motion` даёт статичный постер.
- **Зависимости:** 128; стабильный UI приложения.

#### TASK-130 — `site-media-integration` · Встраивание медиа в сайт

- **Скилы:** `coreyhaines31/marketingskills@image` (опц.)
- **Зачем:** соединить лендинг (слоты) и видео (ассеты).
- **Что:** подстановка клипов/скринов в секции, `<video autoplay muted loop
  playsinline poster preload="none">` + ленивая загрузка, no-CLS, фолбэк на
  постер/`prefers-reduced-motion`, OG/превью-картинки страниц, оптимизация
  размеров (webm/mp4, responsive).
- **Трогаем:** `site/`.
- **DoD:** лендинг показывает реальные клипы; видео не грузятся до вьюпорта;
  нет CLS; на reduced-motion — статичные постеры; вес страницы в бюджете.
- **Зависимости:** 124, 129.

#### TASK-131 — `billing-subscription` · Подписка и оплата (hosted)

- **Скилы:** — (специализированных скилов нет; сначала решить провайдера оплаты)
- **Зачем:** продажа hosted-варианта по подписке.
- **Что:** выбрать провайдера (Stripe/Paddle/ЮKassa/CloudPayments — решение
  владельца, влияет на налоги/регион), планы и лимиты per-plan в backend
  (таблица `Subscription`/`Plan`, enforcement лимитов), checkout, вебхуки,
  статус подписки в UI/админке, self-hosted-лицензия (что бесплатно, что под
  ключом), аудит. Отдельно — «за подписку на моём сервере» (managed hosting):
  как выдавать доступ/инстансы.
- **Трогаем:** `backend/`, `shared/`, `ui/` (статус/лимиты), `site/` (CTA).
- **DoD:** можно оформить/отменить подписку; лимиты плана реально применяются;
  вебхуки идемпотентны; статус виден; аудит; e2e на жизненный цикл подписки.
- **Зависимости:** решение владельца о провайдере/модели; 125.

#### TASK-132 — `docs-site` · Доковый сайт (Starlight)

- **Скилы:** `anthropics/skills@doc-coauthoring`
- **Зачем:** сейчас доки — разрозненные markdown-файлы.
- **Что:** Starlight на `/docs` в `site/`: структура (Начало / Self-hosting /
  Пользовательский гайд / API / FAQ / Changelog), поиск, версии, i18n en/ru,
  тёмная тема; миграция `README.md`, `docs/SELF-HOSTING.md`,
  `docs/INSTALL-BY-OS.md`, `SECURITY.md`, `CHANGELOG.md` (с сохранением ссылок);
  связь из приложения (пункт «Помощь/Документация»).
- **Трогаем:** `site/`, `ui/` (ссылка на доки), `README.md`/`docs/*`.
- **DoD:** доки доступны на `/docs`; старые файлы мигрированы, ссылки не битые;
  поиск работает; en+ru; сборка/деплой в CI.
- **Зависимости:** 122 (токены), 123.

#### TASK-133 — `docs-user-guide` · Пользовательская документация

- **Скилы:** `riekelt/technical-writer@technical-writing`, `anthropics/skills@doc-coauthoring`
- **Зачем:** help center по фичам (не только self-hosting).
- **Что:** гайды по фичам (доски/колонки/карточки, drag&drop, комментарии,
  вложения/видео, метки/чек-листы/приоритеты, календарь/таблица, шаринг,
  hotkeys, аккаунт/2FA, админка), гифки/скрины из `video/`, FAQ/troubleshooting,
  «первые шаги» для нового юзера.
- **Трогаем:** `site/` (контент доков), `video/` (гифки).
- **DoD:** покрыты все пользовательские фичи; есть скринкасты/гифки; навигация и
  поиск по разделам; en+ru.
- **Зависимости:** 132, 129 (гифки).

#### TASK-134 — `docs-api-reference` · API-reference и runbooks

- **Скилы:** `addyosmani/agent-skills@documentation-and-adrs`, `riekelt/technical-writer@{writing-design-docs,writing-runbooks}`
- **Зачем:** self-hosters/интеграторы.
- **Что:** API-reference (из `shared/src/api.ts` DTO / OpenAPI), примеры curl,
  self-hosting runbooks (бэкап/восстановление/апгрейд/мониторинг/troubleshooting),
  ADR-раздел, security-гайд (ссылка на `SECURITY.md`).
- **Трогаем:** `site/` (контент доков), возможно генератор из `shared/`.
- **DoD:** reference покрывает публичные роуты; примеры рабочие; runbooks
  проверены на чистой машине; ADR-структура заведена.
- **Зависимости:** 132.

#### TASK-136 — `mcp-server` · MCP-сервер для роя агентов

- **Скилы:** `directory-submissions` (публикация в каталогах/registry)
- **Зачем:** сделать «направьте агентов на доску» реальным: любой MCP-клиент
  (Claude Code/Desktop, Cursor, VS Code, opencode, Codex) двигает карточки
  ключом. MCP — это «руки» агента, а не просто инструкция.
- **Что:** воркспейс `mcp/` — тонкая TS-обёртка над командным API
  (`POST /boards/:id/commands`) и комментами; auth — персональный ключ `jnk_…`
  (TASK-36.1), env `JANOSIK_URL`/`JANOSIK_TOKEN`; тулзы `list_boards`,
  `get_board`, `create_card`, `update_card`, `move_card`, `comment`,
  `checklist_*`, `set_label`, `assign`; read-only тулзы отдельно от write;
  переиспользует DTO из `shared/src/api.ts` (сервер = маппинг тулз→`BoardAction`,
  вся обработка `commandId`/`ifMatch`/409 внутри); раздача `npx @janosik/mcp` +
  регистрация в MCP registry.
- **Трогаем:** новый `mcp/`; `shared/` (только чтение DTO); `README`/доки.
- **DoD:** `npx @janosik/mcp` поднимается; тулзы на живом борде двигают карточку,
  комментируют и тикают чек-лист ключом `jnk_…`; ошибки/идемпотентность/`ifMatch`
  обработаны; e2e-смоук; опубликовано в MCP registry.
- **Зависимости:** 126 (позиционирование), 134 (API-reference).

#### TASK-137 — `agent-skill` · Скилл-плейбук роя

- **Скилы:** `skill-creator`
- **Зачем:** MCP — «руки», скилл — «поведение»: конвенции роя, а не транспорт.
- **Что:** публикуемый скилл `janosik` (markdown + промпты), который ссылается на
  MCP-тулзы и не дублирует I/O; рецепты («взял задачу → создал карточку →
  In progress → коммент → чек-лист → Review → Done»), шаблоны карточек/меток.
- **Трогаем:** новый `skills/janosik/` (или каталог скиллов).
- **DoD:** скилл ставится в харнессы (Claude/opencode/Codex); агент по нему ведёт
  карточку на реальном борде через MCP; нет дублирования API-деталей.
- **Зависимости:** 136.

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