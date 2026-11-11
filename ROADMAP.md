# Janosik — Роадмап и план итераций

> **Единый источник правды по развитию приложения.** Этот файл заменяет
> прежние `ARCHITECTURE_REVIEW.md`, `FEATURES_BACKLOG.md` и
> `CURRENT_WORK_ITERATIONS.md` (они удалены). Любой ИИ-агент начинает работу
> с чтения этого файла и `AGENT.md`.
>
> **Текущее состояние:** серверный режим, совместная работа, MCP и первый
> self-hosted релиз реализованы. Открытые задачи и их зависимости перечислены
> в §7.7; Sentry и полный браузерный E2E-набор закрываются в TASK-168 (§7.25).
> Отдельный публичный демо-инстанс TASK-39 отменён: демо запускается из
> админки. **Форма поставки — самохостимый опенсорс** (AGPL-3.0,
> Docker Compose). Аудит статусов: 2026-11-04.

---

## Редизайн мастер-панели (ветка `feat/admin-redesign`, 2026-11)

Направление — **«Dense data console» с брендовым исключением для входа**.
Исследование и прототип: `audits/admin-redesign-research.md` (не входит в
репозиторий) и `design/admin-redesign.html`. Пользовательская документация:
`site/src/content/docs/docs/admin/redesign.md` и RU-версия.

| Фаза | Содержание | Статус |
| --- | --- | --- |
| 0. Foundations | admin-токены, плотные примитивы, breadcrumbs, hub-модель | ✅ в этой ветке |
| 1. Login + shell | split login, 8 хабов, rail/sheet, breadcrumbs, палитра, роли | ✅ в этой ветке |
| 2. Overview + Users | attention-first статус-строка, 6+2 KPI, users list/detail, URL-табы, keyboard rows, page size, empty/error/403 | ✅ в этой ветке |
| 3. Boards + Moderation | Boards hub с data-браузерами, Moderation hub, исправленный back-link редактора | ✅ в этой ветке (3-pane inspector отложен) |
| 4. Audit + Comms + Access | аудит/команды/активность, communications с объявлениями и shares, sessions/tokens/masters | ✅ в этой ветке |
| 5. Settings + Ops | Settings hub на 7 вкладок, единый read-only баннер, owner-only границы | ✅ в этой ветке |
| 6. Polish + docs | E2E, docs EN/RU, CHANGELOG, ROADMAP, responsive 390/834/1280 | ✅ в этой ветке |
| P1 | серверная сортировка, saved views, column chooser, inline edit, audit drawer, 3-pane inspector, bulk users | ⏳ отложено |
| P2 | virtualization, recent pages server-side, role preview, OIDC для мастеров | ⏳ отложено |

Инварианты, которые нельзя терять при следующих правках: 8 хабов и редиректы
старых URL; `data-testid` из отчёта; OWNER/OPERATOR проверки на сервере;
отдельная мастер-сессия; `janosik.admin.sidebar` и `janosik.admin.density`;
все 26 возможностей доступны как табы.

---

## Редизайн «Настройки доски» (ветка `feat/board-settings-rail-redesign`, 2026-11)

Направление **01 «Рельс доски»** из `design/board-settings-redesign/REPORT.md`:
колонки доски стали горизонтальным рельсом, правила выбранной колонки — списком
с инспектором 316 px, полная матрица осталась вкладкой, сквозные переходы и
старт/готовность — двумя компактными строками. Модель `BoardWorkflow` не
менялась; это UI-рефакторинг с сохранением всех правил, ролей, условий,
обратных рёбер, шаблона, сброса и мастер-панели.

| Фаза | Содержание | Статус |
| --- | --- | --- |
| 1. Каркас | один surface, sticky header/footer, single scroll body, dirty close | ✅ в этой ветке |
| 2. Рельс и список | tablist с roving tabindex, счётчики, «Разрешить», disabled/locked | ✅ в этой ветке |
| 3. Инспектор | роли, условия, обратный переход, проверка карточки, удаление | ✅ в этой ветке |
| 4. Матрица и адаптив | вкладка «Матрица», 316 px / stacked / full-screen, snap rail | ✅ в этой ветке |
| 5. Тесты и docs | unit + browser + mobile, EN/RU user-guide, CHANGELOG | ✅ в этой ветке |

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
   - E2E-тесты (Playwright) — **норма, а не исключение**: покрывают приложение
     **целиком**, а не только многопользовательские сценарии. Браузер —
     **только Google Chrome** (`channel: "chrome"`); кросс-браузерной матрицы
     (Firefox/WebKit) нет. Юнит/компонентные тесты остаются Vitest + RTL; E2E
     берут то, что RTL физически не воспроизводит (реальный браузер, сеть, SSE,
     два контекста, drag&drop, загрузки). См. TASK-41, §7.8.
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
  принимает и `path:<repo>`, и `id:<repoId>`;
  worktree-селекторы — `id:<repoId>::<abs path>` (полный id из
  `create`/`list`), `path:<abs>`, `name:<display>`, `branch:<ветка>`.
  Прежняя заметка «`id:` в `worktree create` отвечает
  `repo_not_found`» устарела: форма `id:` рабочая (проверено
  create+show+rm пробного worktree).
1. **Worktree под каждого субагента** (ветка = имя):
   `orca worktree create --repo path:… --name <slug> --setup run --json`
   → `~/orca/workspaces/janosik/<slug>`, `node_modules`
   ставится setup-хууком. До `worker-start`: (а) дождаться setup-хуука —
   `ls <worktree>/node_modules/.bin` непуст; (б) скопировать секреты
   координатором: `cp <repo>/backend/.env <worktree>/backend/.env` —
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
| Виды доски | канбан, **календарь**, **таблица** и **watch**; настройки вида и компактного отображения сохраняются; в watch видны изменения участников, комментариев и вложений | 14, 14.1, 142 |
| Колонки | добавление, переименование (двойной клик), удаление с каскадом, drag-перестановка, дублирование, сортировка карточек (создание/срок/название) | 6, 9 |
| Карточки | inline-композер (в т.ч. hover-зоны между карточками), живое редактирование заголовка, удаление с подтверждением, drag&drop внутри/между колонками и на тачах (long-press), перенос через меню, дублирование | 6, 21.10 |
| Описание карточки | WYSIWYG MDX-редактор (MDXEditor) в диалоге, бейдж «есть описание» на карточке, санитизация сырого HTML при импорте | 2, 21 |
| Чек-листы | подзадачи в диалоге (добавление/галочки/переименование/удаление), прогресс-бар и бейдж «2/5» на карточке | 3 |
| Сроки | дата+время в диалоге (календарь + вил-пикер), бейдж на карточке: просрочено (красный), скоро ≤24 ч (жёлтый) | 4 |
| Обложки | 12 цветов + 6 градиентов на токенах, полоса сверху карточки | 5 |
| Метки | 14 цветов, мульти-выбор, создание/переименование/перекраска/удаление (каскад со всех карточек) | — |
| Архив карточек | `archivedAt`, архив с карточки/строки таблицы/диалога, массовый архив колонки, модалка «Архив (N)» с поиском и восстановлением в выбранную колонку | 18.1 |
| WIP-лимиты | лимит на колонку (1…99), счётчик `N/M`, блокировка композера и drag'а, тост | 13 |
| Рабочий процесс | настраиваемые ADMIN переходы между колонками: матрица, роли ADMIN/MEMBER, условия (исполнитель/срок/описание/чек-листы), глобальные переходы, initial/done; запрещённая цель видна с причиной в DnD/меню/диалоге/таблице, `409 conflict:"workflow"`, мастер-панель от имени владельца с аудитом, MCP `janosik_get_workflow`, импорт/экспорт; без процесса — прежние правила | 165 |
| Фильтр | поиск по названию, описанию, пунктам чек-листов и именам меток; метки (**ANY/ALL** + «без метки»), срок, дата создания (окно/точный день), приоритет, исполнитель, связи (`Blocked`/`Has links`); фасеты с бейджем, `/` для фокуса, счётчик совпадений, чипы и сброс, одинаковый результат в канбане/календаре/таблице, DnD выключен при активном фильтре | 10, 16, 45, 46, 49 |
| Глобальный поиск | `Ctrl/Cmd+K` — по всем доскам, по названию/описанию/меткам/чек-листам, крошка «Доска › Колонка», сниппет, бейдж «В архиве», клавиатура со скроллом выбранного и лимит 20; клик открывает карточку (`?card=`) или доску, архивная доска объясняет, что её нужно восстановить | 10, 157 |
| Хоткеи | палитра по `?`, `j/k` курсор, `e`/Enter открыть, `n`/`c` композеры, `Esc` | 11 |
| Undo/redo | история 50 шагов с коалесцингом, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, кнопки в шапке. **На инверсных командах** (`{do, undo}`, селективный undo — не откат снапшота) | 33, 21.7 |
| Активность карточки | лента **10 типов** событий (включая `archived`/`unarchived`), «Активность (n)», лимит 50/карточку (снимет БД — §7.3) | 12, 18.1 |
| Данные | дебаунс-сохранение (400 мс) + flush при закрытии, экспорт/импорт JSON, авто-бэкапы в IndexedDB (троттл 60 с с trailing-снимком, ротация 20), ручное «сохранить копию», восстановление/удаление бэкапов | —, 21.4 |
| Устойчивость | ErrorBoundary (Reload / Reset с подтверждением и автоэкспортом, EN-fallback без i18n), баннер «Данные не сохраняются», карантин битого JSON (`janosik-boards.corrupt.<ts>`) | 21.2 |
| PWA / офлайн | манифест, иконки 192/512/maskable, service worker (app-shell network-first, `/assets/*` cache-first, кэшируются только успешные ответы, `CACHE_VERSION` = хеш сборки → старые кэши чистятся после деплоя) | 15, 21.3 |
| Оформление | тёмная/светлая темы с префлайтом (без мигания), 4 фона доски, `prefers-reduced-motion`, кастомные скроллбары | — |
| Загрузка | единая система skeleton-плейсхолдеров (board shell, ленивые виды, секции карточки, таблицы админки, публичная доска, панели) с `aria-busy`, задержкой появления и reduced-motion | — |
| i18n | en/ru, типобезопасные ключи, плюрализация, тумблер формата времени «Авто/12ч/24ч» | 17 |
| Бренд | Space Grotesk (self-hosted), анимированный логотип «Перо Яношика», живые иконки шапки | — |
| Лимиты ввода | `LIMITS` на 14 полях + коллекциях, счётчики «осталось N», тултипы/тосты гвардов. **Калибруются в TASK-21.5** | 20 |
| ИИ-агенты | MCP-сервер (`@janosik/mcp`) + скилл `janosik`: описание 64к, захват с лизингом, контракт задачи, CAS `expectedVersion`, идемпотентные id, типизированные комментарии (`kind`), поиск по комментам/чек-листам, проекция чтения, ready-to-work + wait-for-work, DoD-гейт на Done, `actorType`, скоупы токенов | 157 |

| Совместная работа | аккаунты, роли и приглашения, realtime/presence, комментарии, исполнители, уведомления, публичные ссылки для просмотра | 24, 35–37, 49, 58 |
| Вложения | файлы и аватары, загрузка и скачивание, вставка в описание с Undo/Redo и очисткой, обработка видео и миниатюры | 47, 50, 66, 70 |
| Self-hosting | Docker Compose, установщик и публичный образ GHCR `v0.2.0` для amd64/arm64; документация и MCP | 38a, 38b, 136 |

> **Из открытого:** тач-слой календаря/таблицы (TASK-31), Sentry и полный
> E2E-набор теперь закрываются в TASK-168 (§7.25); TASK-166–172 —
> release-программа, TASK-173–175 — post-launch backlog.
> Полный перечень открытых задач — в §7.7.

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
- **Тесты** — **1505 тестов: ui 1057 (130 файлов) + shared 448 (8 файлов)** (reducer, history, persistence, serialization, backup, backup-timestamp, dnd, filter, storage, migrate, i18n, pwa, editor-import, интеграционные BoardSection + CardDialog + свитчер; изоляция рендеров и троттл бэкапа — TASK-21.4/21.4.1; поведение service worker'а — TASK-21.3; обратимость экшенов — `invert.test.ts`, TASK-21.7d; платформа и BrowserRouter deep-links — TASK-21.8; ленивые иконки шапки — `lazy-animated-icon.test.tsx`, TASK-21.9; конфигурация сенсоров тач-DnD — `DndBoard.sensors.test.tsx`, TASK-21.10; сброс диалогов и двойной тап — `ColumnView.double-tap.test.tsx`, TASK-21.11; строгий валидатор команд (включая метки/чек-листы и board-level) — `shared/src/store/validate.test.ts`, TASK-26/27/29; серверный режим — `api/client.test.ts`, `store/server-sync.test.ts`, `store/board-diff.test.ts`, `store/BoardContext.server.test.tsx` (fake-сервер на общем редьюсере), `components/auth/LoginPage.test.tsx`, TASK-29; мастер-панель — `admin/admin-client.test.ts`, `admin/admin-i18n.test.ts`, `admin/AdminApp.test.tsx` (fake admin-API), TASK-43; участники и read-only — `components/ui/user-avatar.test.tsx`, `components/board/BoardMembersDialog.test.tsx`, `components/board/read-only.test.tsx`, `components/BoardSection.roles.test.tsx` (fake-сервер с ролью VIEWER), TASK-35; realtime — `store/realtime.test.ts` (SSE-парсер, reconnect/backoff, `touchedEntityIds`) и кейсы в `store/BoardContext.server.test.tsx` (чужая команда, догон `?since=`, другой таб, foreign-пометка undo по `touches` без рефетча, own-echo не убивает undo, deferred-очередь при in-flight, успешный undo/redo через лог), TASK-30/30.1/30.2; присутствие и атрибуция — `store/board-live.test.tsx` (сторы presence/attribution/members, command→card-ids), `components/board/PresenceStack.test.tsx` (fake-сервер: ростер, «+N», join/leave), кейсы presence/кольца/ленты/таблицы в `realtime.test.ts`, `BoardContext.server.test.tsx`, `CardItem.test.tsx`, `CardActivityFeed.test.tsx`, TASK-36; окно карточек/строк/календаря — `ColumnView.virtualization.test.tsx`, `TableView.virtualization.test.tsx`, `CalendarView.virtualization.test.tsx`, TASK-139). Цифру сверять командой `npx vitest run`, а не переписывать по памяти.

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
| — | TASK-36…41 | совместный UI, релиз и полировка — **порядок и DoD в §7.7** (TASK-22…29, TASK-35…37 и TASK-43 сделаны); детали: совместный UI — §7.6.1, релиз и E2E — §7.8. **Открыты:** TASK-40/41, TASK-31, TASK-159, TASK-161 — сведены в TASK-168 (§7.25); TASK-131 (отложено). TASK-166–172 запланированы, TASK-173–175 отложены (§7.23–§7.25), TASK-176 — отдельный admin/comment backlog (§7.26), TASK-177 — human-last-mile backlog (§7.27), TASK-178 — редизайн настроек доски ✅, TASK-179 — agent surfaces redesign (§7.28). TASK-32 и TASK-39 отменены; TASK-140/141 и TASK-158 завершены |

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
  text      String   @db.Text            // LIMITS.comment (10000) — plain
                                         // text, не markdown (TASK-37, §7.6.1)
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
Исторический снимок калибровки TASK-21.5 (§6.0.1 «Решённые вопросы» п.4;
актуальные значения — в `shared/src/types/kanban.ts`): чеклистов
≤ 20/карточка, пунктов ≤ 100, меток ≤ 20 на карточке и ≤ 50 на доске,
**колонок ≤ 12, карточек ≤ 200 в колонке, досок ≤ 10 на юзера**,
`description` ≤ 10000, `comment` ≤ 2000 (TASK-37).

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

#### TASK-30.1 — `realtime-refinements` · Добор к SSE (TASK-30) ✅

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

#### TASK-30.2 — `hardening-followups` · Добор по итогам аудита покрытия ✅

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

#### TASK-35 — `board-members-ui` · Участники доски и приглашения ✅

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

#### TASK-36 — `presence-attribution` · Кто что делает ✅

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

#### TASK-37 — `comments-ui` · Комментарии в карточке ✅

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
| 11.1 | TASK-36.1 `account-panel` ✅ | `feature/TASK-36.1-account-panel` | По запросу владельца: вместо кнопки выхода — персональная панель (Linear-style: рейл разделов, на мобиле — табы). Профиль: имя, цвет аватара из палитры (серверный `User.avatarColor`, виден команде — карточки, лента, presence, кольцо атрибуции), email read-only; безопасность: смена пароля с ревоком остальных сессий (кука скоупится `/auth`, поэтому эндпоинт `POST /auth/password`, не `/users/me/password`), **все API-ключи тоже отзываются**; **рабочие персональные API-ключи** (`jnk_…`, sha256 в БД, показ один раз, список/отзыв/`lastUsedAt`; PAT принимают `JwtAuthGuard` и `MembershipGuard`, admin-контур — нет); перенос из хедера языка/времени/фона в «Настройки» (тема живёт только там); Sign out — внизу панели с подтверждением. **Смена имени/цвета транслируется вживую всем:** `PresenceService.updateUser` перезаписывает открытые сессии без реконнекта, `membership change:"updated"` по всем бордам заставляет перечитать каталог (карточки, таблица, лента). **Профиль человека кликабелен отовсюду** (`UserProfileDialog`: presence-ростер, список участников, фейс автора на карточке/в таблице/ленте; онлайн-статус, роль, срок доступа). Осознанно не делаем (отдельные задачи): загрузка фото (нужно файловое хранилище), смена email (нужен мейлер и double opt-in), список активных сессий, 2FA | профиль/пароль/ключи работают из панели; цвет аватара видят остальные; панель не теряет борду (модалка, не роут); en+ru; тесты. **Выполнено:** миграция `20260918080434_user_avatar_color`; `UsersModule` (`PATCH /users/me`, `GET/POST/DELETE /users/me/tokens`), `AuthService.changePassword` + `ApiTokenService`; PAT-фолбэк в guard'ах; UI `components/account/*` (+4 тест-файла), i18n `account.*`; гейты: ui 593 (76 файлов), shared 336, backend 48 unit + 144 e2e, lint/tsc/prettier/build/size зелёные; живая проба `account-probe.mjs` 18/18, `rename-probe.mjs` 9/9 — **PR #78, merge `00de4d5`**; **догон:** фиксированная высота панели под вьюпорт (все вкладки одной высоты, длинный контент скроллится внутри; проба `account-height.mjs` 9/9) — **PR #80, merge `79e9d62`** |
| 11.2 | TASK-36.2 `board-switcher-roles` ✅ | `feature/TASK-36.2-board-switcher-roles` | По запросу владельца: в свитчере видно, где я админ, а где доступ «со стороны» | секции «Мои доски» (ADMIN) и «Совместные» (MEMBER/VIEWER), заголовки — только когда есть обе группы (иначе плоский список); на общих досках в слоте действия — иконка роли с тултипом и aria-label («Участник — можно редактировать» / «Наблюдатель — только просмотр») вместо пустого места, архив по-прежнему только у ADMIN; плоский клавиатурный порядок ↑/↓ и поиск не меняются; en+ru. **Выполнено:** `BoardSwitcher` groups + `board.switcher.section.*`/`role.*`; `FakeServer.roles` per board; ui 597 (76 файлов), lint/tsc/prettier/build/size зелёные; живая проба `switcher-roles.mjs` 7/7 (секции, иконки, порядок) — **PR #79, merge `aaa97da`** |
| 12 | TASK-37 `comments-ui` ✅ | `feature/TASK-37-comments-ui` | §7.6.1: секция комментариев в диалоге карточки поверх API TASK-28, курсорная пагинация, живое прилетание по SSE, `LIMITS.comment`. По запросу владельца расширена до Jira-вида и дважды переоформлена после ревью: Activity — последняя секция, сегментные табы Comments/History (как переключатель видов доски), markdown-композер как у Description (Save/Cancel, Ctrl/Cmd+Enter), кнопка копирования ссылки; History — серверный фид с диффом «было → стало» половинами, старое значение зачёркнуто; комменты видны в истории диффом `Comment: — → текст`; описание коммитится одним `UPDATE_CARD` на сессию печати (blur/смена карточки/закрытие), свежесть истории — по коммит-сигналу `CommitStore` (без лага «на шаг позади» при чек-боксах); дифф подсвечивает изменённый фрагмент word-diff'ом (красное зачёркнутое / зелёное, контекст схлопывается в «…», `clip` снапшотов поднят 280 → `LIMITS.description`); чужой комментарий перевешивает «морду» карточки (SSE-фрейм ставит attribution с кольцом, сервер пишет `Card.lastActorId` — после перезагрузки то же лицо) | пишется/удаляется/пагинируется; чужой комментарий приходит живым; лимит гвардит; en+ru. **Выполнено:** UI `CardActivity`/`CardComments`/`CardHistory` + ленивый `CommentEditor` (компактный MDXEditor, тела комментариев — markdown-вьюер, голые URL линкует `autolinkMarkdown`; оптимистичная отправка, удаление своих с подтверждением, курсорный «Show older»); SSE `type:"activity"` публикуется из `CommentsService` и раздаётся через `ActivityStore`; `Command.details` (миграция `20260918174753_command_details`) хранит снапшот `{detail,changes}` команд, текст комментов — в `Activity.details` (`readCommentSnapshot` в `activity.service`) — диффы в `GET /cards/:id/activity`, посимвольные правки сворачиваются (окно 2 с); копирование `?card=`-ссылки + фикс холодной загрузки deep-link; ui 617 (80 файлов), backend 145 unit+e2e, lint/tsc/prettier/build/size; живые пробы `comments-probe.mjs` 12/12 и `activity-redesign-probe.mjs` 30/30 — **PR #82, merge `a6b8b2c`; полировка — PR #83, merge `68716dc`** |
| 13 | TASK-38a `self-host-hardening` ✅ | `feature/TASK-38a-self-host-hardening` | §7.8: шесть грабель самохостинга, каждая ломается **молча** (Secure-кука по HTTP, буферизация SSE за nginx, миграции в entrypoint, JWT без дефолтов, `ALLOW_REGISTRATION`, healthcheck БД) + джоб чистки soft-delete на `@nestjs/schedule` | HTTP-инсталляция ругается, а не разлогинивает молча; SSE работает за дефолтным nginx; пустой `JWT_SECRET` не даёт стартовать; чистка идёт по расписанию |
| 14 | TASK-38b `self-host-release` ✅ | `feature/TASK-38b-self-host-release` | §7.8: `LICENSE` (AGPL-3.0) + поля в `package.json`, multi-stage `Dockerfile`, прод-`docker-compose.yml`, `.env.example`, публикация образов в `ghcr.io` из CI по тегу, README под самохостера, `SECURITY.md`, `CHANGELOG.md` | **Выполнено:** PR #159 и #160; опубликован стабильный релиз `v0.1.1` и публичный GHCR-образ для amd64/arm64; установка из опубликованного образа без авторизации проверена на WSL. Установщик создаёт уникальные секреты, доступны EN/RU-инструкции и MCP. Физические macOS и Windows вне WSL не проверялись. |
| 15 | TASK-39 `public-demo` ❌ отменено | — | Отдельный публичный инстанс больше не планируется по решению владельца. Демонстрация роя запускается из админки (TASK-57/69), наблюдать можно по публичной live-ссылке (TASK-58) | См. §7.8: постоянно доступный инстанс и остальные первоначальные требования не реализованы и не требуются |
| 16 | TASK-40 `observability` | `feature/TASK-40-observability` | §7.8: Sentry на фронт и бэк (**DSN — переменная, пустая по умолчанию**: свой DSN в опенсорс-образ зашивать нельзя), `pino` со структурными логами и `requestId`→`commandId`, `/health` со статусом БД и версией образа | ошибка долетает до Sentry с версией сборки; пустой `SENTRY_DSN` полностью выключает отправку; по `commandId` трассируется путь команды. **Частично (2026-10-31):** `/health` со статусом БД и версией (TASK-147 `health/ready` + TASK-64 observability) и `requestId`→`commandId` (TASK-153) — уже сделано; осталось **Sentry + `pino`** |
| 17 | TASK-41 `e2e-chrome` | `feature/TASK-41-e2e-chrome` | §7.8: Playwright-набор **на всё приложение**, браузер — **только Google Chrome** (без кросс-браузерной матрицы Firefox/WebKit). Правка §0 п.4 — запрет E2E **снимается**. Гоняется в CI против `docker compose` из TASK-38b | покрыты auth / доска / карточка / виды / realtime+presence (два контекста) / шаринг / аккаунт / админ-smoke / PWA; зелёные в CI; артефакт трейсов на падении; §0 и README обновлены |
| 18 | TASK-31 `mobile-ux` | `feat/TASK-168.2-mobile-ux` | Тач-слой для календаря/таблицы (HTML5 DnD на тачах не работает; доска уже покрыта TASK-21.10), адаптив шапки/фильтров/диалогов | drag-сроки и перенос строк работают на тач-эмуляторе; вёрстка не ломается на 390px. **Выполнено в 168.2:** `useTouchDrag` + чипы календаря и строки таблицы (строки — с workflow/WIP), auto-scroll и явное меню, мобильная шапка/фильтры/диалоги, touch-E2E 390×844 |
| 19 | TASK-32 `landing-intro` ❌ | — | Отменена по решению владельца: лендинг с переходами ко входу и регистрации уже реализован в TASK-124; отдельная презентация внутри приложения дублирует его | — |
| 20 | TASK-43 `master-admin-panel` ✅ | `main` (вне очереди, по запросу) | Мастер-контур §7.0/§7.4: `AdminUser` OWNER/OPERATOR отдельно от `User`, свой вход/аудиенция/cookie, админ-панель `/admin` (дашборд, юзеры, доски, журнал, аудит, мастера), CLI `admin:create/passwd/list`, модерация и аудит; `User.isSuperAdmin` удалён | вход мастера из браузера; из панели создаётся оператор и не может управлять мастерами; юзер-токен в `/admin` → 401 и наоборот; блок юзера убивает сессии; всё в аудите; e2e на запреты |
| 21 | TASK-44 `card-layout` ✅ | `feature/TASK-44-card-layout` | По запросу владельца: карточка больше не «дышит» высотой — фикс под вьюпорт, секции сворачиваются в едином стиле, чеклист не растёт бесконечно | диалог карточки — `100dvh−2rem` со скроллом тела; `CollapsibleSection` (Description/Checklists открыты, Activity свёрнута) + сворачивание каждого чеклиста отдельно с видимым прогрессом; пункты чеклиста капнуты 8 строками (внутренний скролл); Title — авто-высота 1–4 строки без пустых строк. **Выполнено:** ui 602 (77 файлов), lint/tsc/prettier зелёные; живая проба `card-layout-probe.mjs` 17/17 (высота 868/608, неизменна при сворачивании, список 218>192) — **PR #81, merge `5fe2677`** |
| 22 | TASK-44.1 `header-gradient` ✅ | `main` (вне очереди, по запросу) | По запросу владельца: шапка сайта получает фон-градиент панели аккаунта (`from-primary/15 via-secondary/10 to-transparent`) поверх `bg-background/80` с блюром | только оформление, функционал не тронут; ui 602 (77 файлов), lint/tsc/prettier зелёные; живой скрин |
| 23 | TASK-45 `card-priority` ✅ | `feature/TASK-45-card-priority` | По запросу владельца: Jira-приоритеты на карточке. 6 уровней (`blocker/highest/high/medium/low/lowest`), дефолт Medium; серверный `Card.priority` + миграция, команда `SET_CARD_PRIORITY` (паттерн `SET_CARD_DUE_DATE`) + inverse/activity-событие, writer/aggregate/import, миграция данных v7. UI: селект с иконками и цветами Jira в карточке, бейдж на морде, опциональная колонка в TableView, сортировка колонки по приоритету, мультивыбор в фильтрах | приоритет переживает reload/export/import и undo; чужая смена видна по SSE; en+ru; тесты + живая проба. Готово: полный контур команды (shared-редьюсер/invert/validate/migrate, Prisma v7, writers в ОБОИХ свитчах, aggregate/import/export), UI (селект в диалоге, бейдж на морде для не-medium, опциональная колонка + сортировка в TableView, фасет-мультивыбор в фильтрах), история с локализованным уровнем; проба `priority-probe.mjs` 16/16 (SSE-видимость чужой смены, undo/redo, сортировка, фильтры) — **PR #84, merge `d2066e2`**. Попутно: лимит коммента 2000→10000 (Prisma v8 `Comment.text` → Text), premium-Save слева + Cancel сразу (оба дисейбл на пустом черновике), эмодзи в markdown-вьюерах (`emojify`: шорткоды+эмотиконы, код не трогаем) |
| 24 | TASK-46 `card-links` ✅ | `feature/TASK-46-card-links` | По запросу владельца: Jira-связи карточек. `CardLink (fromCardId, toCardId, type)` — 3 семейства: `blocks`/`blocked by`, `relates to`, `duplicates`/`duplicated by`; отображение обеих сторон, запрет self-link и дублей пары, лимит 50 связей на карточку, каскад при удалении, запрет циклов `blocks` с тостом; всё командами (undo/redo/SSE). В карточке — секция «Linked cards» в стиле общих секций: группы по типу, переход на связанную карточку, поиск при добавлении; на морде — иконка/счётчик связей и красный «Blocked» по входящему blocks от неархивной карточки; фильтры «Blocked» и «Has links» | связи переживают reload/export/import; цикл `blocks` не создаётся; undo/realtime работают; en+ru; тесты. **Выполнено:** `CardLink` хранится на источнике (directional), вторая сторона вычисляется сканом; гварды: self-link, дубль пары, `LIMITS.linksPerCard = 50`, DFS-циклы `blocks`; dangling-tolerant (удаление цели оставляет строку, undo оживляет), дубликаты без связей; Prisma `CardLink` (soft-delete, FK RESTRICT) + миграция `20260919131635_card_links`, writers upsert/soft-delete, aggregate/import, command-details со снапшотом титула цели; UI `CardLinks` (саджесты, 5 Jira-фразировок → 3 wire-типа, клавиатура, тост цикла, навигация `?card=`), бейджи на морде, фасеты фильтров, история; en+ru. Гейты: shared 349, backend 57 unit + 145 e2e, ui 658 (85 файлов), lint/tsc/prettier/build/size зелёные (живая проба отменена владельцем) — **PR #85, merge `54c9937`** |
| 25 | TASK-47 `files` ✅ | `feature/TASK-47-files` | По запросу владельца (self-hosted, без S3): файловые вложения карточек и аватары пользователей на локальном диске. Backend: `Attachment` (id, boardId, cardId, fileName, storedName, mimeType, sizeBytes, uploadedById, deletedAt), multer-хранение в `UPLOAD_DIR` (дефолт `data/uploads`, в git-игноре), upload/stream/delete REST поверх MembershipGuard (как комменты — вне командного контура, undo не покрывает), denormalized `Card.attachmentCount` в aggregate + SSE `type:"attachment"`, лимиты `LIMITS.attachment` (25 MB, mime-allowlist); аватар: `PATCH /users/me/avatar` + `GET /users/:id/avatar`, `User.avatarPath`. UI: секция Attachments в диалоге (иконки по mime, размер, скачивание, удаление), бейдж-счётчик на морде, живое прилетание по SSE; аватар в аккаунт-панели. Docker: прод-compose монтирует `data/` как bind mount (детали упаковки остаются в TASK-38b) | файл переживает рестарт контейнера; чужой upload виден по SSE; лимит и чужой mime отсекаются; скачивание только участникам доски; en+ru; тесты. **Выполнено:** Prisma `Attachment` (soft-delete, FK RESTRICT) + миграция `20260919210000_attachments`, `User.avatarPath`/`Card.attachmentCount`; multer в `UPLOAD_DIR` (дефолт `data/uploads`, git-игнор), storedName=UUID+sanitized ext, allowlist mime (вложения 25MB×20/карточка, аватар 2MB), удаление blob-файла при soft-delete; REST вне командного контура: POST/GET `/cards/:cardId/attachments`, GET `/attachments/:id/content` (Content-Disposition UTF-8), DELETE `/attachments/:id` (uploader или ADMIN), `PATCH /users/me/avatar` + `GET /users/:id/avatar` (immutable-cache); activity `attachment_added/deleted` + SSE, avatarPath сквозь presence/roster/updateUser; UI: секция Attachments (upload/скачивание через blob-fetch, ConfirmDialog, SSE-merge, canDelete), Paperclip-бейдж на морде, аватары в presence/членах/профиле/аккаунте (module-cached object URL), en+ru; попутно правила линков вынесены в `shared/src/store/card-links`. Гейты: backend 57 unit + 152 e2e, ui 661 (86 файлов), lint/tsc/prettier/build/size зелёные — **PR #86, merge `2c2692a`** |
| 26 | TASK-48 `admin-redesign` ✅ | `feat/TASK-48-admin-redesign` | Вне очереди, по запросу владельца: (1) редизайн админ-панели — 9 сущностей таблицами (`/admin/entities/:entity`: cards, users, boards, comments, attachments, checklists, labels, sessions, apiTokens) с cross-entity поиском, пагинацией, период-фильтрами (24h/7d/30d), детальными страницами карточки/юзера/доски с вкладками Activity/Command log/Audit/Sessions/Tokens, скачиванием вложений мастером, приоритетом/due в таблице карточек; (2) Jira-style paste-медиа — Ctrl+V картинки/файлов/видео в описание и комментарии: embed на позиции курсора с сохранением структуры «текст → медиа → текст», картинки/видео/аудио рендерятся (авторизованные blob-URL через imagePreviewHandler), видео/аудио — нативные плееры (`::video{src=…}`-директивы), файлы — ссылки с открытием; в описании — реальное вложение, в комментарии — скрытое inline-вложение (без бейджа и ленты, удаляется вместе с комментарием); fullscreen-просмотрщик картинок; фикс mojibake имён (multer latin1) | вход только по API-токену (e2e-гейт 7 кейсов); период-фильтры обрезают все 6 лент; inline скрыт из списка и счётчика; удаление комментария чистит его inline-вложения (e2e); mojibake-имя сохраняется в UTF-8 (e2e); en+ru; тесты. **Выполнено:** backend — `AdminListQueryDto` (query/from/to), `/admin/entities/:entity`, `GET /admin/attachments/:id/download`, `Attachment.isInline` (миграция `20260920120000_attachment_inline`), payload в командных строках, priority/dueDate в карточных; UI — AdminApp (таблицы, период-табы, `JsonCell` с expand без трима, `CopyButton`/`EntityLink`, `key={entity}` сброс пагинации, `{total}`-подзаголовки, RowActions без действий → null); paste-контур — `embedAttachments` (embedMarkdown/preview-cache/lightbox/click-delegation), `directivesPlugin` с video/audio-дескрипторами (micromark v3, `::video{src="…"}`), paste-хендлеры описания и композера, mojibake-фикс `sanitizeFileName`; admin-чанк бюджет 30→32 KB. Гейты: backend 57 unit + 166 e2e, ui 692 (89 файлов), lint/tsc/prettier/build/size зелёные — **PR #88, merge `681fc96`** |
| 27 | TASK-49 `card-assignee` ✅ | `feature/TASK-49-card-assignee` | Вне очереди, по запросу владельца: Jira-исполнитель на карточке. `Card.assigneeId` (optional-field конвенция: `null` = не назначен) + команда `SET_CARD_ASSIGN` (паттерн `SET_CARD_PRIORITY`) с серверной проверкой, что исполнитель — активный участник доски (принял приглашение, не истёкший VIEWER; inverse освобождён для undo). UI: пикер исполнителя в карточке — поповер с живым поиском по ростеру доски (аватары, email, клавиатура, закреплённый «Unassigned»), мгновенное применение; аватар исполнителя в правом нижнем углу карточки на борде (как в Jira) с профилем по клику; опциональная сортируемая колонка в TableView (не назначенные всегда в хвосте); фасеты фильтров по участникам + «Unassigned». Админка: колонка Assignee в таблице карточек (EntityLink + копирование), исполнитель в мета-панели карточки, вкладка «Assigned cards» и счётчик у юзера, поиск карточек по исполнителю. Попутно убран «кто изменил» с морды карточки и ячейки таблицы (решение владельца) — живой 2-секундный foreign-хайлайт сохранён | назначить можно только активного участника (e2e: outsider/pending 400, member 200, undo); исполнители переживают reload/export/import/undo; чужая смена видна по SSE; en+ru; тесты. **Выполнено:** миграция `20260920210948_card_assignee` (FK SetNull + индекс), writers в обоих свитчах (`writeCardAction`, `cardCreateData`/`cardUpdateData` — DUPLICATE_CARD копирует исполнителя через spread), aggregate/import (FK-гвард от мусорных id), command-details `assignee` from/to; UI — `CardAssignee` (Popover + combobox, поиск по `useBoardMembersList` — новый хук/`MembersStore.list`), `AssigneeBadge` на морде (boardId-prop-drilling для memo), колонка/сортировка/фасеты, история резолвит имя через директорию (fallback на raw id); ретро-аттрибуция: убраны `card-last-actor`/`table-last-actor` + ключ `card.changedBy`. Гейты: shared 367, backend 58 unit + 170 e2e (новый `card-assignee.e2e-spec` 4 кейса), ui 700 (90 файлов), lint/tsc/prettier/build/size зелёные (admin-чанк 31.15/32 KB) |
| 28 | TASK-50 `video-transcode` ✅ | `feature/TASK-50-video-transcode` | «Ужиматор» видео как у топ-ресурсов: каждое видео-вложение в фоне перекодируется в компактный H.264/AAC MP4 (ffmpeg, CRF 25, ≤1920 по ширине, +faststart) — минимальная потеря качества, минус 50–80% размера на записях экрана; оригинал живёт до успеха кодека и остаётся при неудаче. Статусы none/pending/done/failed в `Attachment.transcodeStatus`; очередь — in-process FIFO (один кодек за раз), потери при рестарте нет — `onModuleInit` переставляет `pending`-строки в очередь. Блоб подменяется атомарно (tmp+rename), `content`-URL не меняется — плееры и встроенные в описания `::video` продолжают работать без перезагрузки страницы; о SSE-фрейме `attachment_updated` диалог перечитывает ряд. Бинарник — `ffmpeg-static` (без системных зависимостей), оверрайд `FFMPEG_PATH`. UI: плашка «Encoding…/Сжимаем…» у ряда пока идёт кодек. Админка: колонка «Encode» со статусом в таблице вложений. Попутно в TASK-50 вошёл фикс хранилища: дефолт `UPLOAD_DIR` больше не от cwd, а якорится к папке backend (PR #92: cwd-relative путь однажды «потерял» все блобы после рестарта из другой папки); resolved-путь логируется на старте. Тесты: e2e с реальным ffmpeg и коммитнутой фикстурой `sample-video.mp4` — успешный кодек, гарбаж-файл → failed с живым оригиналом, не-видео → none; юнит на профиль аргументов ffmpeg; тест плашки Encoding. Гейты: shared 367, backend 59 unit + 173 e2e (19 сюитов), ui 701 (90 файлов), lint/tsc/build/размеры зелёные
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
| 56 | TASK-123 `marketing-site-scaffold` ✅ | `feature/TASK-123-marketing-site-scaffold` | §7.12: новый воркспейс `site/` (Astro + заготовка Starlight), шелл (шапка/футер/навигация), маршруты `/`,`/pricing`,`/docs`, i18n en/ru, темы, SEO-база (meta/OG/sitemap/robots/canonical), CI-деплой статики | `npm run build -w site` зелёный; пустой сайт деплоится по CI; en/ru и тема работают; Lighthouse ≥95; CTA ведут в приложение. **Выполнено:** воркспейс `site/` (`@janosik/site`) — Astro 7 + Starlight 0.42 + `@astrojs/sitemap`; Starlight смонтирован на `/docs` через вложенную папку контента (`src/content/docs/docs/`), маркетинг владеет корнем; шелл `BaseLayout`/`Header`/`Footer`/`ThemeToggle`/`LangSwitcher`/`SEO`; i18n en/ru (словари + хелперы, 13 тестов) без Astro `i18n` (Starlight запрещает оба); светлая/тёмная темы на токенах `brand`, тема делится с доками через ключ `starlight-theme`; SEO (canonical/hreflang/OG/twitter/JSON-LD Organization+SoftwareApplication), `sitemap-index.xml`, `robots.txt`, 404; `site/` в workspaces и root-скриптах; CI: сборка сайта в `verify`; доставка — **в образе**: NestJS отдаёт сайт на `/` и приложение на `/app/` (`SITE_DIR`/`STATIC_DIR`/`UI_BASE`), Dockerfile собирает `site/`, healthcheck проверяет `/api/v1/health` и `/` (приложение переведено на подпуть: Vite `UI_BASE`, `BrowserRouter basename`, base-aware SW/манифест/шаринг-ссылки, OAuth-редиректы через `UI_BASE`). **Решения:** сайт вшит в Docker-образ (не GitHub Pages) — сайт на `/`, приложение на `/app/`; TASK-32 впоследствии отменена: лендинг TASK-124 уже реализован. Гейты: site 13, ui 794, shared 369, brand 56, backend 193 unit + 262 e2e; lint 0 errors; format ✓; `astro check` 0 errors; сборка 7 страниц; смоук образа (сайт/приложение/доки/health) ✓ |
| 57 | TASK-124 `landing-hero-features` ✅ | `main` | §7.12: маркетинг-лендинг «как у Miro» — герой+CTA, секции всех ключевых фич со **слотами под медиа** (плейсхолдеры до Ф2), «как это работает», соц-пруф/GitHub, FAQ, финальный CTA, футер | покрыты все ключевые фичи; слоты под медиа готовы; неавторизованный видит лендинг и уходит в логин/регистрацию; мобилка без гор. скролла; en+ru. **Выполнено:** лендинг переписан «как у Miro» — герой в две колонки (оффер+CTA+мокап доски), 4 чередующихся фича-ряда (доска/виды, realtime, карточки, шаринг) с медиа-слотами, список «И детали» (8 пунктов), OSS-полоса с self-host терминалом, 4 шага, 4 FAQ, финальный CTA; новый `site/src/components/MediaSlot.astro` (варианты board/realtime/cards/sharing/selfhost, готов принять `src`/video без CLS); i18n en/ru; убраны «шаблонные» приёмы (ALL-CAPS-«eyebrow», радиальный градиент героя, сетка одинаковых карточек); мобилка без гор. скролла + вход в шапке. Гейты: site 13, `astro check` 0 ошибок, сборка 7 страниц, lint/format ✓ |
| 58 | TASK-125 `landing-pricing` ✅ | `main` | §7.12: страница `/pricing` — планы (Self-hosted/Hosted/Pro/Team/Enterprise), таблица сравнения, лимиты per-plan, CTA, FAQ по оплате/лицензии; связь с TASK-131 | тарифы с понятной сеткой и CTA; тексты en+ru; согласовано с лицензией self-hosted; якорь с лендинга. **Выполнено:** `/pricing` переписан — герой, CSS-only тумблер monthly/annual (`:has()`), 4 карточки (Self-hosted/Hosted Free/Pro★/Team), таблица сравнения (5 колонок × 4 категории, sticky-первая-колонка), Enterprise-полоса, FAQ (7), финальный CTA; все числа в едином `site/src/pricing.ts` (карточки и таблица — из одного источника, дрейф невозможен), тексты в i18n en/ru. Цены ориентировочные (Self-hosted $0 · Hosted Free $0 · Pro $8 · Team $16 · Enterprise custom; годовой = −2 месяца); CTA «лист ожидания/связаться» → `mailto:hello@janosik.app` (env `PUBLIC_CONTACT_EMAIL`) до TASK-131; тизер-полоса на лендинге → `/pricing`. Гейты: site 13, `astro check` 0, сборка 7 страниц, lint 0, format ✓; проверено вживую EN+RU, light+dark, 1280/375px (без гор. скролла). **Обновлено (2026-10):** после решения «опенсорс сейчас, облако позже» страница переделана — вместо 4 per-seat карточек осталось **два тарифа: Self-hosted (free, AGPL) + Cloud (coming later)**; убраны тумблер monthly/annual и Enterprise-полоса; таблица сравнения — 2 колонки; FAQ переписан; `pricing.ts`/`i18n/ui.ts`/`pricing.md.ts`/`SEO.astro`/`llms.txt` синхронизированы; гейты site 17, `astro check` 0, сборка 53 страницы, lint 0, format ✓ |
| 59 | TASK-126 `site-copy-cro-seo` ✅ | `main` | §7.12: копирайт всех страниц, CRO-проход, SEO (title/description/семантика), AI-SEO, `schema-markup` (Organization/SoftwareApplication/FAQ/Product), privacy-friendly аналитика и трекинг событий, OG-картинки | тексты финализированы en+ru; SEO-чеклист пройден; structured-data валиден; ключевые CTA покрыты событиями; Lighthouse SEO ≥95. **Выполнено:** копирайт-проход по скилу `copywriting` (убраны AI-tells: em dash в коротких строках, negation-списки, trailing pile-ons; CTA `Get started` → `Start your first board`); уникальные SEO title/description по страницам (`seo.*`, keyword-first: 34/39 симв., desc 140–144); структурированные данные единым JSON-LD-массивом: Organization + WebSite + SoftwareApplication (offers из `pricing.ts`) + FAQPage (home/pricing) + Product (AggregateOffer) + BreadcrumbList — валидный JSON-LD на всех страницах; AI-SEO: `/llms.txt` и `/pricing.md` (генерируются из `pricing.ts`), semantic HTML; privacy-friendly аналитика — `src/lib/analytics.ts` + `Analytics.astro`, по умолчанию **не грузится ни одного стороннего скрипта** (opt-in `PUBLIC_ANALYTICS_DOMAIN`/`PUBLIC_ANALYTICS_SRC`), события `cta_clicked` на всех ключевых CTA через `data-cta` (delegated, honour Do Not Track); OG-картинки страниц (`og-pricing.png`, `og-docs.png`) генерируются из бренд-шаблона интеграцией `og-images`. Lighthouse: SEO **100**, perf 100/99, best-practices 100 (home/pricing). Гейты: site 17 (было 13), `astro check` 0, сборка 7 страниц + `/llms.txt` + `/pricing.md`, lint 0, format ✓ |
| 60 | TASK-127 `site-a11y-perf-audit` ✅ | `main` | §7.12: аудит по Web Interface Guidelines (spacing/typography/interaction/a11y) + визуальный QA (`impeccable`) — контраст, фокус/клавиатура, мобильные таргеты, перф-бюджеты (LCP/CLS), reduced-motion | нет критичных a11y-проблем; Lighthouse a11y/perf ≥95 на лендинге и тарифах; мобилка вылизана; чеклист-отчёт в PR. **Выполнено:** аудит скилами `web-design-guidelines` + `impeccable` (`context`/`audit`/`craft-floor`) и Lighthouse desktop+mobile на `/` и `/pricing`. a11y **94/95 → 100** во всех 4 прогонах (perf 100, моб. pricing 99; LCP 0.4s desktop / 1.6s mobile, CLS ≈0). Фиксы: (1) `LangSwitcher` — `aria-label` теперь включает видимый код (`RU — Русский`), убран `label-content-name-mismatch`; (2) футер — заголовки колонок `h4`→`h2` (был пропуск уровня заголовков); (3) контраст — зелёные `✓` в макете терминала (`--success` → `color-mix(success 75%, foreground)`), бейдж «Most popular» и метка «2 months free» (`--primary` → `color-mix(primary 80%, foreground)`), текст CTA-полосы на градиенте (`--muted-foreground` → `color-mix(muted 78%, foreground)`) — всё ≥4.5:1, тема-адаптивно (light+dark, без новых токенов). Крафт: `text-wrap: balance` на заголовках и `pretty` на абзацах (убраны advisory `unbalanced-heading`/`straggler`), `font-variant-numeric: tabular-nums` в ценах и таблице сравнения. Намеренно оставлено: `overused-font` (Space Grotesk — брендовый шрифт) и advisory `nested-cards` (макет доски) — дизайн-решения, не дефекты. Гейты: site 17, `astro check` 0, сборка 7 страниц, lint 0 (51 пре-существующих warning), format ✓; проверено вживую EN light/dark, desktop 1280 + mobile 390 |
| 61 | TASK-128 `video-scaffold` ✅ | `main` | §7.12: воркспейс `video/` (Remotion) на общих бренд-токенах; композиции, скрипт рендера mp4+webm+poster в `site/public/media`, параметризация (тема/размер/fps), CI-рендер | `npm run render -w video` кладёт mp4/webm+poster в `site/public/media`; образец-композиция на токенах; Remotion не тянется в бандл `site`. **Выполнено:** воркспейс `@janosik/video` (Remotion 4.0.539, React 18) — `src/Root.tsx` (по одному авторскому `<Composition>` на клип, `theme`-проп light/dark), `src/lib/{layout,motion,fonts,types}.ts`, бренд-CSS из `@janosik/brand` (`tokens.css` + `site-tokens.css` — без хардкода цветов), Space Grotesk через `@remotion/fonts` (`loadFont`, без FOUT); `scripts/render.mjs` — один бандл на все клипы, `renderMedia` mp4 (H.264) + webm (VP8) и `renderStill` постер для каждой темы (light/dark) в `site/public/media`; `scripts/copy-assets.mjs` (шрифты+лого из `brand/`, git-ignore); CI-джоб `video` (workflow_dispatch/тег → рендер + artifact); `video/README.md`; отдельный воркспейс — Remotion не попадает в бандл `site`. Гейты: video typecheck 0, lint 0; рендер 6 клипов ✓ |
| 62 | TASK-129 `video-feature-clips` ✅ | `main` | §7.12: сценарии и рендер клипов фич на реальных состояниях UI (drag&drop, realtime, комментарии, paste-медиа, шаринг, календарь/таблица, оффлайн/PWA, админка), единый бренд-стиль, 5–15 c, луп-friendly, гифки-превью | клипы покрывают все секции лендинга; визуально консистентны; корректны в лупе; reduced-motion → статичный постер. **Выполнено:** 6 клипов 1280×800 (16:10 = аспект слота), 30 fps, 7–10 c, бесшовный луп — `Hero` (рой из ~10 агентов: 5 колонок, 10 агент-цветов, ростер из 10 аватаров, 4 пульсирующие карточки, 3 карточки в полёте между колонками, 2 коммент-бабла, «10 agents · live» в шапке), `Board` (один клип = **три вида**: канбан с drag&drop → календарь-месяц с перетаскиванием карточки на дату → таблица с сортировкой и инлайн-правкой; переключатель Kanban/Calendar/Table в шапке), `Realtime` (4 курсора разных цветов — Mira/Alex/Sam/Noor, presence-ростер, 2 карточки прилетают), `Cards` (диалог: чек-лист тикает, метки, вложение), `Sharing` (read-only ссылка + copy), `Selfhost` (терминал `docker compose up -d` → `✓ postgres ready`/`✓ janosik ready on :3000`); общий визуальный язык с `MediaSlot` (chrome/колонки/карточки/агент-доты), бренд-токены и motion-кривые. Полный список §7.12 (оффлайн/PWA, админка, paste-медиа) свёрнут до 6 клипов под реальные слоты лендинга (остальные — в бэклоге, если появятся слоты). **Обновлено (по запросу владельца):** запечённые мокапы заменены на **реальные записи приложения** — воркспейс `video/record/`: `seed.mjs` (7 демо-юзеров `@janosik.demo` + доска `Product roadmap`: 4 колонки, 12 карточек, метки, сроки, исполнители, чек-лист, комментарии; токены минтит ключом `JWT_SECRET`, refresh-куки логином), `record.mjs` (Playwright-запись UI 1280×800 light+dark, 2× device scale; hero/realtime открывают доп. контексты для реального presence и live-обновлений; ротация refresh-куки переносится между контекстами), `terminal.mjs` (клип self-host из **реального вывода** команд `docker compose`/`prisma:deploy`), `encode.mjs` (mp4 H.264 + webm VP9 + постер). `npm run clips -w video`; Remotion-пайплайн оставлен как альтернативный авторский путь. **Hero-клип перезаписан по запросу владельца:** зум 1.3 (крупные читаемые карточки вместо обрезанных), рой из 6 агентов двигает карточки в разные колонки двумя волнами одновременно (presence 5+«+2»), Backlog не пустеет. **Догон (TASK-142, по запросу владельца):** добавлен 7-й клип `feature-watch` (реальная запись watch-вида, light+dark) и пятая фича-строка на лендинге (вариант `watch` в `MediaSlot` + запасная «ленточная» заглушка); постер клипа можно брать из середины сцены (`posterMs` в манифесте/`encode.mjs`), поэтому клип, у которого первый кадр не главный, всё равно получает осмысленный постер |
| 63 | TASK-130 `site-media-integration` ✅ | `main` | §7.12: подстановка клипов/скринов в секции — `<video autoplay muted loop playsinline poster preload="none">`, ленивая загрузка, no-CLS, фолбэк на постер/reduced-motion, OG/превью, оптимизация размеров | лендинг показывает реальные клипы; видео не грузятся до вьюпорта; нет CLS; reduced-motion → постеры; вес страницы в бюджете. **Выполнено:** `MediaSlot` принимает `mp4`/`webm`/`poster` + `*Dark` и рендерит два `<video muted loop playsinline preload="none" poster aria-hidden data-lazy-video>` (light/dark; CSS показывает нужный по `data-theme`); клипы рендерятся в двух темах (`render` → `<slug>.*` и `<slug>-dark.*`); ленивая загрузка — `IntersectionObserver` в `BaseLayout` (`rootMargin: 200px`; играет только видимый вариант, `MutationObserver` на `data-theme` пересинхронизирует при переключении темы; `prefers-reduced-motion` → постер; no-JS → постер); no-CLS — кадр 16:10 совпадает с видео; `HomePage` мапит вариант слота → клип через `withBase` (учёт деплой-базы); `.slot-media` фон `--surface`; 6 клипов закоммичены в `site/public/media` (~5.8 MB mp4+webm+jpg, теперь реальные записи). OG/превью — постеры как `poster`; бренд-OG-карточки страниц не тронуты. Проверено вживую (Playwright, 1280): герой играет, off-screen клипы не грузятся (`readyState 0`), при скролле стартуют, гор. скролла нет. Гейты: site 17, `astro check` 0, сборка 7 страниц, lint 0 (51 пре-существующих warning), format ✓ |
| 64 | TASK-131 `billing-subscription` ⏸ | — | §7.12: **отложено (решение 2026-10)** — платное облако позже; сейчас форма поставки — бесплатный self-hosted опенсорс (AGPL), облако — заглушка «coming later» на `/pricing`. Когда облако понадобится: выбрать провайдера (для РФ/РБ/СНГ — Prodamus/ЮKassa/CloudPayments/bePaid; Stripe/Paddle/Lemon Squeezy продавцов из РФ/РБ не берут), планы и лимиты per-plan в backend, checkout, идемпотентные вебхуки, статус в UI/админке, аудит | при возврате к задаче: облако можно оформить/отменить; лимиты применяются; вебхуки идемпотентны; статус виден; e2e на жизненный цикл |
| 65 | TASK-132 `docs-site` ✅ | `feature/TASK-132-docs-site` | §7.12: Starlight на `/docs` в `site/` — структура (Начало/Self-hosting/User guide/API/FAQ/Changelog), поиск, версии, i18n en/ru, тема; миграция `README`, `docs/*`, `SECURITY.md`, `CHANGELOG.md` | доки доступны на `/docs`; старые файлы мигрированы без битых ссылок; поиск работает; en+ru; сборка/деплой в CI. **Частично выполнено в TASK-133/134:** структура доков, поиск (Pagefind), i18n en/ru и тема — на месте; контент `README`/`docs/*`/`SECURITY`/`CHANGELOG` перенесён в страницы (getting-started/self-hosting/runbooks/faq/security/changelog). **Версионирование доков и вход «Документация» добавлены (2026-10):** метка версии `v0.1.0` в шапке доков (источник — версия корневого `package.json`, читается на сборке; оверрайд `SiteTitle`), политика «доки = последний релиз, переключатель версий появится на втором мажоре»; в приложении кнопка «?» стала меню «Помощь» (горячие клавиши + «Документация» → `/docs/`, для ru `/ru/docs/`; в сплит-деплое задаётся `VITE_SITE_URL`). **Обновлено (2026-10):** пользовательский гайд переписан под функции — реальные скриншоты приложения на каждую функцию (`video/record/screenshots.mjs` → `site/public/screens/`, 20 снимков), добавлена страница «Виды календаря и таблицы», быстрое меню по правому щелчку — отдельный раздел, убраны таблицы лимитов и технические детали; гейты site 17, `astro check` 0, сборка 55 страниц |
| 66 | TASK-133 `docs-user-guide` ✅ | `main` | §7.12: пользовательская документация — гайды по всем фичам, гифки/скрины из `video/`, «первые шаги», FAQ/troubleshooting, навигация и поиск | покрыты все пользовательские фичи; есть скринкасты/гифки; навигация/поиск работают; en+ru. **Выполнено:** 5 страниц пользовательского гайда (`site/src/content/docs[/ru]/docs/user-guide/`: index, boards, cards, collaboration, account) en+ru — режимы local/server, шапка, доски/колонки/карточки, drag&drop, три вида (Board/Calendar/Table), детали карточки (метки/приоритет/срок/исполнитель/чек-листы/связи/обложка/вложения), комментарии и markdown, вставка файлов, участники и роли, realtime/presence, публичные read-only шары, поиск/фильтр, хоткеи, аккаунт/API-ключи/настройки, оффлайн/PWA, бэкапы/экспорт/архив, лимиты; встроены клипы из `video/` (`feature-board`/`feature-cards`/`feature-realtime`/`feature-sharing`) как `<video>` с постером; навигация — Starlight sidebar с переводами, поиск Pagefind. Гейты: site 17, `astro check` 0, сборка 53 страницы, lint 0, format ✓; проверено вживую EN+RU dark |
| 67 | TASK-134 `docs-api-reference` ✅ | `main` | §7.12: API-reference (из `shared/src/api.ts` DTO / OpenAPI) с примерами curl, self-hosting runbooks (бэкап/восстановление/апгрейд/мониторинг/troubleshooting), ADR-раздел, ссылка на security-гайд | reference покрывает публичные роуты; примеры рабочие; runbooks проверены на чистой машине; ADR-структура заведена. **Выполнено:** API-reference из кода (`shared/src/api.ts` + контроллеры/DTO) — 3 страницы (`site/src/content/docs[/ru]/docs/api/`: index, commands, rest) en+ru: конвенции (префикс `/api/v1`, auth JWT+`jnk_…`, error-envelope, `409`-конфликты команд, лимиты, maintenance), 63 пользовательских роута, полный каталог `BoardAction` (48 действий), DTO-каталог (wire-типы, tri-state required, defaults, ограничения), таблица ошибок; self-hosting с полным env-reference (29 переменных) и per-OS Docker; runbooks (бэкап/восстановление/апгрейд/мониторинг/troubleshooting) symptom-first с rollback; ADR-раздел (index + ADR-001 command log, ADR-002 single-image deploy, ADR-003 AGPL+trademark, формат Nygard); security-гайд; faq; changelog. Команды/env взяты из репозитория; внутренние ссылки проверены (48 маршрутов резолвятся). Runbook-и помечены как проверенные против репозитория, не против чистой машины (честно). **Обновлено (2026-10):** раздел «Архитектурные решения» (ADR-001/002/003 + index) удалён из доков по решению владельца — документация про функции для пользователя, не про архитектуру; ссылки из `docs/index` и секция сайдбара убраны |
| 68 | TASK-135 `landing-agent-swarm` ✅ | `main` | Вне очереди, по запросу владельца: развернуть лендинг под главную идею — канбан не для человека, а для **роя ИИ-агентов**, а человек наблюдает. Опирается только на реальные фичи: командный API `POST /boards/:id/commands` + персональные API-ключи (TASK-36.1, `jnk_…`), сериализация писателей доски (TASK-56, «рой ИИшек»), realtime SSE и публичные read-only шары (TASK-58) | ядро сайта — про рой агентов; тексты честные (никаких MCP/SDK, которых нет); en+ru. **Выполнено:** герой переписан («Kanban for your agent swarm.») + новый вариант мокапа `swarm` в `MediaSlot` (4 колонки, агенты на карточках, presence-ростер, активная карточка с пульсом, комментарий-бабл; `prefers-reduced-motion` → статика); новая секция `#swarm` «How a swarm works the board» — 3 шага (ключ → агент ведёт доску → вы наблюдаете) + реальный запрос/ответ командного API (`POST /boards/:id/commands` → `{seq, versions}`) + 3 чек-буллета; в «И детали» добавлены «Personal API keys for agents» и «Live read-only share links»; +2 FAQ («Can AI agents use Janosik?», «How do I watch the swarm?»); SEO home title/description под агентов; `llms.txt` и `site.description` обновлены; i18n en+ru. Гейты: site 17, `astro check` 0, сборка 7 страниц, lint 0 (51 пре-существующих warning), format ✓; Lighthouse a11y/perf/SEO/best-practices **100** на `/` и `/pricing`; детектор `impeccable` — только намеренные `overused-font` (Space Grotesk) и `nested-cards` (макет доски); визуально EN+RU light/dark, 1280/390 (починен гор. скролл от `<pre>` — `minmax(0,1fr)` в гриде) |
| 69 | TASK-136 `mcp-server` ✅ | `feature/TASK-136-mcp-server` | §7.12: **MCP-сервер для роя агентов** — тонкая TS-обёртка над командным API (`POST /boards/:id/commands`) и комментами; auth персональным ключом `jnk_…` (env `JANOSIK_URL`/`JANOSIK_TOKEN`); тулзы `list_boards`/`get_board`/`create_card`/`update_card`/`move_card`/`comment`/`checklist_*`/`set_label`/`assign`; read-only тулзы отдельно от write; переиспользует DTO из `shared/src/api.ts`; `npx @janosik/mcp` + регистрация в MCP registry | тулзы двигают карточку, комментят и тикают чек-лист на живом борде ключом `jnk_…`; идемпотентность/`ifMatch`/409 обработаны; e2e-смоук; опубликовано в registry |
| 70 | TASK-137 `agent-skill` ✅ | `feature/TASK-137-agent-skill` | §7.12: **скилл-плейбук роя** поверх MCP-тулзов — конвенции (колонки, когда комментировать и тащить в Review, как называть карточки), шаблоны карточек/меток, рецепт жизненного цикла; не дублирует I/O, ссылается на тулзы | скилл ставится в харнессы (Claude/opencode/Codex); агент по нему ведёт карточку на реальном борде через MCP; без дублей API-деталей |
| 71 | TASK-138 `contributing-cla` ✅ | `main` | Вне очереди (решение 2026-10): `CONTRIBUTING.md` — как ставить/тестировать/отправлять PR + **DCO** (Developer Certificate of Origin, `git commit -s`), inbound=outbound. Страховка на будущее: перелицензировать проект можно, только пока все права у владельца, поэтому DCO/CLA нужны **до** первых внешних PR. Ссылка из README | процесс PR описан; DCO требуется явно; лицензирование вкладов недвусмысленно. **Выполнено:** `CONTRIBUTING.md` (dev-setup, гейты, стиль коммитов, PR-процесс, DCO + `Signed-off-by`, inbound=outbound); ссылка из README |
| 72 | TASK-139 `board-virtualization` ✅ | `feature/TASK-139-board-virtualization` | §7.13: виртуализация больших досок — рендер только видимых карточек/колонок, без фризов на 1000+ карточек | **Выполнено:** окно карточек в колонке (`use-card-window.ts`) и строк таблицы (`@tanstack/react-virtual`) с точной высотой скролла; несмонтированные карточки остаются в `SortableContext`, j/k скроллит колонку к курсору; календарь: bounded-месяц не тронут, но unscheduled-панель, недельные ячейки и day-panel получают окно. Замер: board 2400 → 108 карточек в DOM, ~4.0k узлов, 90 MB heap, первый рендер ~0.7 с, max long task 176 мс (было 4.81 с / 67.7k / 1.1 GB / 3.90 с); table 2400 → 26 строк вместо 49k DOM; unscheduled 1200 → 27 кнопок. См. §7.13, `docs/PERF-BASELINE.md` |
| 72.1 | TASK-142 `simplify-design` ✅ | `main` | §7.13: чекбокс «Упростить дизайн» — плотная лицевая часть карточки и лёгкий «watch»-вид для наблюдения за роем (снижает DOM и перерисовки), **после виртуализации** | тумблер переключает плотный/полный вид и сохраняется; DOM/время рендера заметно ниже (замер); функции по клику; en+ru. **Выполнено:** чекбокс в меню плотности на панели вида (рядом с настройками колонок), выбор в `localStorage` (`janosik-board-density`); компактная однострочная карточка (48px) — заголовок, метки точками, blocked-маркер, прогресс чек-листа, приоритет, исполнитель; hover-кнопки, описание, срок и подписи меток ушли в диалог по клику; компактная высота строки (56px) прокинута в виртуализацию; ResizeObserver на каждую карточку в компактном режиме не создаётся. Замер на 2400 карточек: DOM 4 482 → 2 414 (−46%), первый рендер 1 060 → 740 мс (−30%), карточек в окне 108 → 156; 240 live-обновлений роя (≈9/с) — 0 long task в обоих режимах. Плюс четвёртый **watch-вид «без косметики»** (крупный статус + онлайн + живая лента активности, без карточек/DnD/анимаций: 0 карточек, ~405 DOM-узлов на 2400-доске). См. §7.13, `docs/PERF-BASELINE.md` |
| 72.2 | TASK-143 `presence-deltas` ✅ | `main` | §7.13: presence дельтами — `sync` на connect, `join`/`leave`/`update` дальше, без 30-секундного broadcast ростера; `?presence=0` для агентских потоков | **Выполнено:** 3000 SSE без OOM (703 MB, было падение); 1600 коннектов 1464→463 MB; backend 280 / ui 866 / shared 431 тестов зелёные. См. §7.13 |
| 73 | TASK-140 `realtime-resilience` ✅ | `feature/TASK-140-realtime-resilience` | §7.13: устойчивость SSE — heap-лимит, лимит соединений на инстанс с вежливым отказом вместо OOM, масштабирование нод | перегруз не роняет процесс; лимит и heap настраиваются env; доки self-hosting описывают масштаб. **Выполнено: PR #144** — `NODE_OPTIONS=--max-old-space-size=1024` (Dockerfile/compose/.env), лог числа живых соединений раз в минуту + warn при отказе (`RealtimeService`), раздел «Scaling» в self-hosting-доках (en/ru); лимит соединений с `503`+`Retry-After` — TASK-146. См. §7.13 |
| 74 | TASK-141 `scale-caches-config` ✅ | `feature/TASK-141-scale-caches-config` | §7.13: TTL-кэш live-share и admin-метрик, `shared_buffers` в self-host compose | live-share и метрики читаются из кэша (RPS ×N), конфиг БД задокументирован. **Выполнено: PR #145** — `ShareAggregateCache` (кэш агрегата live-шары по `seq` + TTL для ростера + single-flight), `TtlCache` для `/admin/metrics` (сброс на любой модерации через `audit()`), env `SHARE_AGGREGATE_CACHE_MS`/`ADMIN_METRICS_CACHE_MS`; `shared_buffers`/`DB_CONNECTION_LIMIT` — TASK-153. См. §7.13 |
| 75 | TASK-144 `ui-edit-coalescing` ✅ | `main` | §7.14: слияние quiet-патчей по полям; не коммитить описание при неразрешённом конфликте | **Выполнено:** quiet-патчи сливаются по полям (title+description в одном окне не теряются); конфликтное описание не коммитится на blur/close/switch/pagehide, черновик держится за карточкой и переопрашивается при открытии; тесты server-sync и CardDialog. См. §7.14 |
| 76 | TASK-145 `presence-consistency` ✅ | `main` | §7.14: топология presence (1/несколько нод), presence-epoch + resync, rejoin по TTL, `avatarPath`, `clientId` до Observable | **Выполнено:** presence — только локально (без Redis-фан-аута → нет ложных `leave` на 2 нодах); `epoch` в кадрах + keepalive + reconnect при расхождении; ping `410` → rejoin; `avatarPath` в сравнении; `clientId` проверяется до Observable; CRLF-парсер; ростер чистится на смене доски; тесты. **Остаётся:** общий presence-store в Redis для сходимости ростера на нескольких нодах (отдельная задача). См. §7.14 |
| 77 | TASK-146 `resource-limits` ✅ | `main` | §7.14: кэпы SSE/сессий, `ifMatchVersions`, upload-квоты, bounded share-throttle | **Выполнено:** SSE-кэпы instance/user/board (`503` + `Retry-After`); `ifMatchVersions` ≤100 и батч-чтение версий (≤1 запрос на тип); upload-rate 60/мин на юзера (`429`); share-throttle ограничен по размеру + валидация формы токена; тесты. **Остаётся:** temp-file uploads → **TASK-155**; Redis-лимитер шары на несколько нод. См. §7.14 |
| 78 | TASK-147 `security-hardening` ✅ | `main` | §7.14: `/health`, read-only impersonation, expiry/assignee-leak, bull-board allowlist, `COOKIE_SECURE`, CIDR/TOTP/логи | **Выполнено:** `/health` — liveness без I/O, `/health/ready` — readiness с кэшем ~2 с и single-flight; impersonation-токен read-only (safe-методы + presence-ping, прочие записи и `/users/me/tokens` → `403`); единый предикат активного членства в `listBoards`/`listMembers`/дайджестах/напоминаниях + drop assignee на restore/import; bull-board за тем же IP-allowlist; `COOKIE_SECURE=true` по умолчанию (compose/.env/docs); CIDR с валидацией префикса и IPv6 (+ отказ при сохранении); TOTP в lockout + защита от replay; тела писем не логируются в production. e2e на каждую дыру; тесты. См. §7.14 |
| 79 | TASK-148 `retention-and-indexes` ✅ | `main` | §7.14: индексы `deletedAt/expiresAt/dueDate`, sweeps Board/Activity/audit/shares/exports, retry очередей | **Выполнено:** индексы purge/TTL/due (`CONCURRENTLY`-скрипт `db:indexes` + миграция `IF NOT EXISTS`); sweep целых `Board` (доска+фид+лог+шары+блобы), `Activity`, `AdminAuditLog` (`AUDIT_RETENTION_DAYS=365`), отозванных шар (24 ч), `.tmp-*` по grace; `exports`/`media` бросают ошибку пока есть попытки (BullMQ retry); retention-opts у Job Scheduler; GDPR-erase удаляет `DataExport`/бандлы; тесты на каждый sweep. См. §7.14 |
| 80 | TASK-149 `admin-consistency` ✅ | `main` | §7.14: admin-мутации через команды, `attachmentCount`, импорт батч/атомарность | **Выполнено:** archive/delete/restore карточек и колонок (включая bulk) идут через `CommandsService.apply` от owner — версия, SSE и каскад; `DELETE_CARD`/`DELETE_COLUMN` больше не рвут `CardLabel` (restore пересобирает `labelIds`/чек-листы); бейдж вложений пересчитывается на delete/restore/erase и на revive карточки; импорт — одна транзакция с явным `timeout`, `createMany`-батчи; тесты. См. §7.14 |
| 81 | TASK-150 `ui-render-perf` ✅ | `main` | §7.14: per-key members, drag strategy, `linkSignature`, CardDialog, focus-diff, анимации | **Выполнено:** `MembersStore` — per-user/per-board подписки (directory reload не ререндерит карточки); dnd `MeasuringStrategy.WhileDragging`/`BeforeDragging`; `linkSignature` кэшируется по снапшоту (WeakMap); заголовок карточки — локальный черновик с тихим коммитом по blur/close (ввод не ререндерит MDXEditor); focus-diff по `updatedAt`/`archivedAt` вместо JSON всей доски; входная анимация только у новых карточек + `prefers-reduced-motion`; тесты изоляции рендера. См. §7.14 |
| 82 | TASK-151 `pwa-stream-recovery` ✅ | `main` | §7.14: SW не убивает старый деплой, SSE-watchdog, 404 доски, `APP_BASE`, restore | **Выполнено:** SW ждёт `SKIP_WAITING` (баннер «новая версия» + reload) и хранит прошлый кэш как fallback для старых lazy-chunk; watchdog 90 с без кадров → abort+reconnect; 404 стрима → доска убирается; `cardHref` через `APP_BASE` (`/app/…`); restore бэкапа в server-режиме отключён; compact error boundary на `CardDialog`; тесты. См. §7.14 |
| 83 | TASK-152 `ui-a11y-polish` ✅ | `main` | §7.14: tab-order зон, drag-handle/AT, lightbox focus, due-тик, локали | **Выполнено:** зоны вставки `tabIndex=-1` (из tab-порядка ушли ~2400 стопов); карточка — `role="group"` вместо вложенной `button`, локализованные dnd-анонсы и инструкция; listbox времени и radiogroup фильтров ходят стрелками (roving tabindex); lightbox — focus-trap, `alt`, revoke blob, возврат фокуса; бейдж срока пересчитывается по таймеру/фокусу; `common.close` в диалогах; закрытие карточки удаляет только `card` из URL; тесты. См. §7.14 |
| 84 | TASK-153 `config-and-observability` ✅ | `main` | §7.14: `connection_limit`/Postgres, кэш OpsSettings, low-баги, slow-query/requestId | **Выполнено:** `DB_CONNECTION_LIMIT` (в DSN, если не задан) + `shared_buffers`/`work_mem`/`max_connections` в compose; кэш `OpsSettings` 15 с с инвалидацией (guard больше не ходит в БД на каждый запрос); счётчик карточек без архива/удалённых колонок, фид приглашений без истёкших, битые seq-курсоры → 400, idempotency коммента проверяет автора, admin refresh с grace 60 с, `notifyDigest` в API/UI; slow-query лог с `X-Request-Id` (AsyncLocalStorage); `CONCURRENTLY` уже закрыт в 148. Тесты. См. §7.14 |
| 85 | TASK-154 `mcp-perf-bench` ✅ | `feat/TASK-154-mcp-perf-bench` | §7.16: бенч «API напрямую vs MCP», профиль MCP-сервера, точечные оптимизации (keep-alive, меньше read-modify-write, ленивый рендер, батч-тулы) | воспроизводимые цифры латентности/запросов/CPU + вердикт и улучшения без регрессий. См. §7.16. **Выполнено:** бенч `~/.janosik-dev/load/mcp-vs-api.mjs` (считающий прокси `:3100`, прямой HTTP vs MCP stdio, R=20) — подтверждённая точка: `move_card` читал доску **дважды** (DoD-гейт + `commandOnFreshBoard`); фикс — `commandOnFreshBoard(prefetched)`, снимок первого чтения переиспользуется, повтор только на 409. Итог: MCP на паритете с прямым клиентом — 6.00→**5.00** запросов/итерацию, move 65.4→**45.2 ms**, CPU 12.5→11.0 ms/вызов. Рендер markdown на `json`, keep-alive, JSON/Zod и батч-тул замерены как **не**-горячие (нет серверного батч-эндпоинта). Раздел «Путь агента через MCP» в `docs/PERF-BASELINE.md` + строка матрицы. Гейты: mcp typecheck/lint/build + 93 теста (2 новых). **PR #141** |
| 86 | TASK-155 `upload-hardening` ✅ | `main` | §7.14: multer `diskStorage` → temp-файл → sniff первых байт → `rename` в место; `rm` в `finally`; sweep `.tmp-*` | **Выполнено:** `tempUploadStorage` (multer disk → `.tmp-<uuid><ext>` в blob-root); `UploadedBlob.path`; MIME по префиксу 4 КБ; `rename` после проверок; `rm` в `finally` на всех путях (вложения и аватар); транскод/деривативы по id; `.tmp` sweep из TASK-148. e2e загрузок/транскода/шары зелёные. См. §7.14 |
| 87 | TASK-156 `review-fixes` ✅ | `main` | §7.15: правки по итогам семи независимых ревью TASK-148/149/150/151/152/153/155 (блокеры, средние, low, тесты) | **Выполнено:** subtree-restore доски с memberships и без воскрешения ранее удалённых чек-листов; snapshot несёт links/lastActorId/attachmentCount; единый `APP_BASE`; `controllerchange` во всех вкладках + отказ кэшировать HTML как JS; сборка финального блоба при ошибке после `rename`; ресинк/конфликт draft заголовка; page-purge доски; минуты не закрывают пикер; чанкированные sweeps и индексы кодов; сортировка bulk restore и audit по элементам; oversight-limit для внутренних restore; чанки импорта; P2028→503; a11y/dnd/lightbox/DueBadge; detached snapshot-шары; кэш ops-settings и границы курсоров. Гейты: unit 306, e2e 301, ui 908, shared 431; lint 0 errors, format/build/size/site зелёные. См. §7.15 |
| 88 | TASK-157 `agent-ready-board` ✅ | `main` | §7.17: описание 64к + конвенции слоя 0, атомарный захват с лизингом, контракт задачи, `actorType` + скоупы токенов, CAS на всех мутациях, виды комментариев, поиск по комментам/чек-листам, DoD-гейт, ready-to-work, проекция чтения, доки/сайт/скилл | **Выполнено:** A+B описание 64к + конвенции (`#120`), C1 claim+lease (`#121`), C2 taskSpec (`#123`), C3a `actorType` (`#124`), C3b скоупы+rate-limit (`#125`), E13 лимит пункта 500 (`#126`), E16 проекция чтения (`#131`), D10+D11 виды комментариев + поиск по комментам/чек-листам (`#132`), D9+E14 CAS `expectedVersion` + идемпотентные id (`#133`), D12 DoD-гейт на Done (`#134`), E15+E17 ready-to-work + wait-for-work (`#135`); F (доки en+ru, сайт, скилл, README, AGENT.md) и бамп `@janosik/mcp` 0.4.0 — в этом же этапе. Гейты: shared 448, ui 1004, backend 314 e2e, mcp 90. См. §7.17 |
| 89 | TASK-158 `admin-master-allowlist` ✅ | `feature/TASK-158-admin-master-allowlist` | §7.18: OWNER управляет IP-allowlist других мастеров из панели; оператор видит свой список в Security | IP проверяется при входе, refresh и запросах; изменения записываются в аудит; en+ru; тесты. См. §7.18 |
| 90 | TASK-159 `admin-ui-tests` | `feature/TASK-159-admin-ui-tests` | §7.18: тесты админ-страниц Ops/Comms/Observability/Security (для Observability уже есть частичные тесты) | страницы покрыты тестами на fake-admin-server; гейты `ui` зелёные. См. §7.18 |
| 91 | TASK-160 `board-command-batching` ✅ | `feature/TASK-160-board-command-batching` | §7.19: батч команд одной доски — одна транзакция на N команд (амортизация `loadBoardAggregate`/проверок/лока), чтобы держать рой агентов на одной доске | `POST /boards/:id/commands/batch` принимает массив; N `Command`-строк в одной транзакции; throughput одной доски выше; MCP склеивает поля карточки. Замер — `docs/PERF-ONE-BOARD.md`. **Выполнено:** батч-эндпоинт (≤`COMMAND_BATCH_MAX`=100) — один lock/`loadBoardAggregate`/id-чек на пачку против бегущего агрегата, атомарно, с сохранением `seq`/идемпотентности/undo/SSE; `apply` = обёртка над `applyBatch` из одной команды; MCP `commandBatch` + `create_card` одним батчем (бамп `@janosik/mcp` 0.5.0). Замер: **43 → 102 команд/с** (×2.3–2.5), латентность/команда ×2.3 ниже. Гейты: backend unit 333, e2e (новый `commands-batch` 5 + старые 49), mcp 95, lint/format ✓. См. §7.19 |
| 92 | TASK-161 `admin-security-events` | `feature/TASK-161-admin-security-events` | §7.20: журналирование отказов доступа и понятная лента подозрительной активности в админке | причины отказов, IP и этап видны в ленте и аудите; повторные события ограничены без потери счётчика; en+ru; тесты |
| 93 | TASK-162 `browser-e2e` | `feature/TASK-41-e2e-chrome` | Декомпозиция TASK-41 по частям продукта и инфраструктуре, §7.8 | TASK-162.0–162.17 выполнены; общий DoD TASK-41 соблюдён |
| 94 | TASK-163 `watch-activity-audit` ✅ | `feature/TASK-162.5-views-e2e` | §7.21: полнота и точность ленты Watch, диффы, границы аудита и права; [issue #171](https://github.com/VitalyTolstik/janosik/issues/171) | матрица событий и доступа документирована; одновременная смена роли и срока не теряет значения; согласованные события и диффы проверены браузерными и серверными тестами |
| 95 | TASK-164 `column-accent-styles` | `feat/column-accent-styles` | Стиль колонок: per-column accent из палитры card cover + board-wide форма (9 вариантов), палитра в шапке, команда, БД, realtime, импорт/экспорт и MCP-тул | 9 форм рендерятся в light/dark; цвет per-column переживает reload, undo/redo и realtime; VIEWER не управляет; shared/ui/backend/e2e зелёные |
| 96 | TASK-165 `card-workflow` | `feat/card-workflow` | §7.22: настраиваемый workflow карточек над колонками (ADMIN, матрица переходов, роли, условия, глобальные переходы, initial/done), enforcement UI→reducer→server, `409 conflict:"workflow"`, мастер-панель, MCP, импорт/экспорт, E2E и docs | MVP реализован в ветке; исправления по ревью внесены, ожидает CI/merge; phase 2 (граф, post-functions, шаблоны платформы, bulk/force move, ifMatch) явно вынесен в §7.22 |
| 97 | TASK-166 `launch-agent-control` | `docs/TASK-166-launch-agent-control` → отдельные `feat/TASK-166.x-*` | §7.23: launch-readiness «agent-first с контролем человека» — идентичность и сессии агентов, scopes, pause/kill, approvals/handoff, надёжный write-контракт, run-level rollback, plan/apply/bulk, attention-inbox, лимиты и data safety, observability, DX и UI-экраны после редизайна админки | **166.0–166.17 выполнены:** восемь замечаний ревью исправлены и покрыты регрессиями — [agent-control review hardening](docs/TASK-166.17-agent-control-hardening.md). Независимый MCP/security аудит остаётся в TASK-172/171. См. §7.23 |
| 98 | TASK-167 `marketing-site-redesign` | `docs/TASK-167-site-redesign` → отдельные `feat/TASK-167.x-*` | §7.24: редизайн маркетингового сайта под новую реальность — agent-first с контролем человека, workflow, approvals/scopes/pause/audit, новая админка, self-host/AGPL; новая IA, копирайт EN/RU, реальные медиа, docs, SEO/AI-SEO, a11y/perf, E2E | **Запланировано:** 9 потоков в 4 волнах (W0–W3); копирайт/IA можно начинать после TASK-166.0, экраны и медиа — после `feat/admin-redesign` + TASK-166.13–15; каждый поток — отдельный worktree/PR; все утверждения на сайте соответствуют отгруженному продукту, EN/RU паритет. См. §7.24 |
| 99 | TASK-168 `launch-tail` | отдельные `feat/TASK-168.x-*` | §7.25: закрыть хвосты вне TASK-166/167 — TASK-40 (Sentry + pino), TASK-31 (тач-слой и 390 px), TASK-161 (события безопасности), TASK-159/41 (тестовое покрытие и формальная ревизия) | **Запланировано:** 4 потока; 168.1/168.2 можно начинать сразу, 168.3/168.4 — после редизайна админки; каждый хвост получает финальный статус, тесты и docs, без «висящих открытыми» задач. См. §7.25 |
| 100 | TASK-169 `docs-audit` | отдельные `feat/TASK-169.x-*` | §7.25: README и документация под 1.0 — инвентаризация кода против docs, поиск недобавленного/устаревшего, README, docs EN/RU, ссылки, версия, changelog | **Запланировано:** 4 потока; аудит можно начинать сразу, фиксы — после TASK-166.16 и TASK-167.5; gap-отчёт с «fixed/deferred/issue»; docs-сайт собирается, ссылки живые, EN/RU паритет. См. §7.25 |
| 101 | TASK-170 `docker-release` | отдельные `feat/TASK-170.x-*` | §7.25: обновление Docker-образа — базовые образы, multi-arch, SBOM/provenance, CVE, размер, compose/.env, upgrade/rollback, публикация RC в GHCR | **Запланировано:** 4 потока; после 168, 169 и 172, до 171; clean install amd64/arm64, миграции, health, upgrade с 0.2.x, rollback; без critical/high CVE; образ — кандидат для 1.0.0. См. §7.25 |
| 102 | TASK-171 `pre-cloud-1.0` | отдельные `feat/TASK-171.x-*` | §7.25: полное ревью перед облаком и релиз 1.0.0 — security, data/backup/DR, perf/scale, cloud readiness, release engineering, независимый review board | **Запланировано:** 6 потоков; зависит от 166–170 и 172; 0 P0/P1, P2 закрыты или приняты с owner/date; 1.0.0 во всех пакетах/образе/доках; clean install + upgrade + rollback + staging dry-run; launch checklist подписан. См. §7.25 |
| 103 | TASK-172 `mcp-skill-review` | отдельные `feat/TASK-172.x-*` | §7.25: отдельный сквозной ревью MCP и скила после всей новой функциональности — tools/schemas/errors/scopes, live-сценарии approval/pause/rollback/plan, skill и references, README/docs EN/RU, tool count | **Запланировано:** 4 потока; после TASK-166, 167.5 и 169; до Docker RC и 1.0.0; найденные пробелы исправляются в MCP/skill/docs, контракт продукта не меняется. См. §7.25 |
| 104 | TASK-173 `agent-experience-phase2` | `feat/TASK-173.x-*` | §7.25: post-1.0 P1/P2 из agent-experience — subscriptions/webhooks, read model, claim/my work, remote attachments, entity versions, remote MCP/OAuth, limits/quotas, UX/analytics | **Отложено:** после 1.0.0; 9 потоков; каждый P1/P2 имеет дом; запуск не блокирует. См. §7.25 |
| 105 | TASK-174 `human-control-phase2` | `feat/TASK-174.x-*` | §7.25: post-1.0 P1/P2 из human-control — comment moderation, share privacy, 2FA/sessions, token rotation, invite email, limits/a11y, service accounts, legal/SIEM/messaging/templates | **Отложено:** после 1.0.0; 5 потоков; каждый P1/P2 имеет дом; запуск не блокирует. См. §7.25 |
| 106 | TASK-175 `scale-phase2` | `feat/TASK-175.x-*` | §7.25: post-1.0 масштабирование — глобальный потолок команд и шардинг, multi-node/Redis fan-out, presence после TASK-145 | **Отложено:** после 1.0.0; 3 потока; не блокирует self-host-запуск. См. §7.25 |
| 107 | TASK-176 `admin-connections` | `docs/TASK-176-admin-connections.md` → отдельные `feat/TASK-176.x-*` | §7.26: исправить подтверждённые баги и пробелы мастер-панели (bulk между страницами, честные счётчики/выборки, прямые ссылки, URL-состояние, адресуемые фильтры, per-row действия) и добавить **author-only редактирование своих комментариев** в обычном продукте | **Запланировано:** 12 подзадач; первая волна — 176.1 bulk-контракт, 176.2 редактирование комментариев, 176.3 честные счётчики; админский редактор карточки и атрибуция мастера — отдельные решения (176.8–176.10), раздел агентов — осознанно вне scope (176.11). См. §7.26 |
| 108 | TASK-177 `human-last-mile` | `docs/TASK-177-human-last-mile.md` → отдельные `feat/TASK-177.x-*` | §7.27: закрыть **все 18** разрывов project-gaps + **9 новых** находок UI-roast — share edit, self-leave, потеря черновика, честные счётчики, task spec/claim, admin shares, notification opt-out + inbox, per-board export, «permanent» copy, detached attachments, search cap, mentions, поиск комментариев/файлов, approval truth на `/agents`, a11y, first-run, safe-area и bulk actions | **Запланировано:** 20 подзадач, все G-01…G-18 и U-01…U-09 в scope; первая волна — 177.3 draft+counts, 177.15 a11y, 177.17 delete safety; затем 177.1/177.5/177.8/177.16/177.18; 177.2/177.6/177.13/177.14; 177.10/177.11/177.12; 177.4/177.7/177.9/177.19/177.20 — с зафиксированным решением, но не вне задачи. См. §7.27 |
| 109 | TASK-178 `board-settings-rail` ✅ | `docs/TASK-178-board-settings-rail.md` → `feat/board-settings-rail-redesign` | Редизайн «Настройки доски» по направлению **01 «Рельс доски»**: один surface, рельс колонок, список правил, инспектор 316 px, матрица как вкладка, компактные global/start-done, responsive/a11y, мастер-панель без диалогового shell | **Выполнено:** PR #242, merge `360938b`; все 5 фаз, unit/browser/mobile-тесты, EN/RU user-guide, CHANGELOG. Модель `BoardWorkflow` не менялась. См. spec и `design/board-settings-redesign/REPORT.md` |
| 110 | TASK-179 `agent-surfaces-redesign` | `docs/TASK-179-agent-surfaces-redesign.md` → отдельные `feat/TASK-179.x-*` | §7.28: единая IA агентских поверхностей — один board Bot-icon, глобальный `/agents` inbox (Attention/Sessions/Runs), board-scoped Agent Control (Inbox/Live/Runs), Policy в Board Settings → Agents & automation, scope-correct pending count, permissions/mobile/a11y, session-only read-only aggregation API | **Запланировано:** 12 подзадач; P1 — вход/шапка, `/agents` shell, Attention/approvals, sessions, count/permissions, session-only aggregation, prototype sync; P2 — runs, settings shell/policy, design/mobile/a11y, cleanup/docs. Independent review accepted; 177.14 поглощён 179.2/179.3; 177.6 остаётся владельцем bell. См. spec, `docs/TASK-179-independent-review.md` и tracked prototype |

> **TASK-38a выполнена 2026-10-26; TASK-38b завершена публичным релизом `v0.1.1` 2026-11-04 (PR #159/#160).** Self-host hardening + release
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
> **UI-тесты:** для Observability позже добавлены частичные тесты; Ops/Comms/
> Security не имеют отдельных наборов. Полное покрытие остаётся в TASK-159;
> серверная логика покрыта backend e2e/unit.
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

#### TASK-38a — `self-host-hardening` · Шесть грабель самохостинга ✅

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

#### TASK-38b — `self-host-release` · Артефакты поставки и лицензия ✅

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

#### TASK-39 — `public-demo` · Публичный демо-инстанс ❌ отменено

**Статус:** отменено по решению владельца. Для демонстрации уже есть запуск
демо-роя из админки (TASK-57/69) и публичная read-only live-ссылка (TASK-58).
Это закрывает текущую потребность; отдельный постоянно доступный демо-инстанс
не планируется. Описанные ниже первоначальные требования не считаются выполненными.

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

#### TASK-41 — `e2e-chrome` · E2E на всё приложение (Google Chrome)

- **Зачем:** §0 запрещал Playwright/Cypress целиком. Для однопользовательского
  SPA это было верное решение — Vitest + RTL закрывали всё. Но **самая сложная
  часть системы** — SSE, оптимистичные откаты, rebase, политика конфликтов undo,
  presence, drag&drop, загрузки — проверялась руками, а «два браузера видят друг
  друга» Vitest физически не воспроизводит. Решение: E2E — **норма**, а не
  исключение.
- **Правка §0 п.4:** запрет **снимается** — E2E покрывают **всё** приложение.
  Ограничение одно: браузер — **только Google Chrome** (`channel: "chrome"`),
  без кросс-браузерной матрицы (Firefox/WebKit). Юнит/компонентные тесты
  остаются Vitest + RTL; E2E берут то, что RTL не может (реальный браузер, сеть,
  SSE, два контекста, drag&drop, загрузки).
- **Что:** Playwright-набор на Chrome, покрывающий ключевые сценарии:
  - **auth:** регистрация/логин/логаут, подтверждение email; восстановление
    забытого пароля — проверить после появления пользовательского сценария;
  - **доска:** создать/переименовать/архивировать, колонки, DnD карточек;
  - **карточка:** диалог, описание (markdown), метки, приоритет, срок,
    исполнитель, чек-листы, связи, обложка, вложения (upload/download);
  - **комментарии и лента активности**, undo/redo;
  - **виды:** канбан / календарь / таблица, фильтр/поиск, watch-вид;
  - **realtime и presence на два контекста (Chrome):** undo не затирает чужое,
    конфликт текста, живое прилетание (<2 c), догон `?since=` после обрыва SSE,
    идемпотентность повтора `commandId`, presence убирается ≤60 c;
  - **шаринг:** снапшот и live read-only, `?embed=1`;
  - **аккаунт/настройки, API-ключи**; **админ-контур** (мастер-панель) — smoke;
  - **оффлайн/PWA** (service worker) и восстановление после перезагрузки.
- **Где гоняется:** в CI против `docker compose` из TASK-38b — тестируется ровно
  то, что получают пользователи. Chrome ставится в раннер
  (`npx playwright install chrome`), канал зафиксирован.
- **DoD:** набор покрывает перечисленные сценарии и зелёный в CI; прогон
  укладывается в бюджет (шарды/параллель); на упавшем прогоне — артефакт с
  трейсами/HTML-отчётом; §0 п.4 и `README.md` обновлены.
- **Зависимости:** TASK-37, TASK-38b.

#### TASK-162 — `browser-e2e` · Структура и подзадачи TASK-41

TASK-162 — декомпозиция TASK-41, а не второй независимый набор тестов.
Кроме отмеченных, подзадачи открыты; отметка о выполнении ставится после реализации и
проверки. Один workspace `e2e/` покрывает пользовательские переходы между
приложением, мастер-панелью, сайтом и документацией:

```text
e2e/
├── package.json, playwright.config.ts, tsconfig.json, README.md
├── docker-compose.e2e.yml       # дополнения к self-host compose для тестов
├── tests/
│   ├── app/
│   │   ├── auth/               # TASK-162.1
│   │   ├── boards/             # TASK-162.2
│   │   ├── columns/            # TASK-162.3
│   │   ├── cards/              # TASK-162.4
│   │   ├── views/              # TASK-162.5
│   │   ├── filters/            # TASK-162.6
│   │   ├── search/             # TASK-162.7
│   │   ├── history/            # TASK-162.8
│   │   ├── collaboration/      # TASK-162.9
│   │   ├── sharing/            # TASK-162.10
│   │   ├── account/            # TASK-162.11
│   │   ├── data/               # TASK-162.12
│   │   ├── navigation/         # TASK-162.13
│   │   └── pwa/                # TASK-162.14
│   ├── admin/                  # TASK-162.15
│   ├── site/                   # TASK-162.16
│   └── docs/                   # TASK-162.17
├── fixtures/                   # пользователи, контексты и подготовка данных
├── helpers/                    # общие действия и настройки адресов
└── data/                       # файлы для проверок загрузки/скачивания
```

| Задача | Папка / область | Сценарии и критерии |
| --- | --- | --- |
| TASK-162.0 ✅ | Инфраструктура `e2e/` | Playwright Test и **только Google Chrome** (`channel: "chrome"`); изолированный Compose со свежей БД и Mailpit для писем, тестовый мастер, независимые данные и очистка; адреса Docker (`/app/`) и dev (`/`) настраиваются; запуск всего набора и отдельных папок, CI, HTML-отчёт и трейсы при падении, README. PWA и переходы сайта проверять в окружении с нужной сборкой и адресами. Локально проверены Chrome, контейнеры, мастер и доставка письма; CI-прогон ожидает PR. До TASK-162.1 в CI временно разрешён пустой набор. |
| TASK-162.1 ✅ | `app/auth/` | Chrome E2E: регистрация, ошибки формы, занятый email, неверный и повторно отправленный код из Mailpit, выход до подтверждения, сохранение сессии, выход, неверный пароль и повторный вход. Отключение почты и регистрации администратором проверяется на отдельном изолированном стенде. Пользовательского сценария восстановления забытого пароля пока нет: тестировать после его появления. |
| TASK-162.2 ✅ | `app/boards/` | Chrome E2E: создание, переименование и переключение досок; архивирование, восстановление и удаление, сохранение результата после перезагрузки. |
| TASK-162.3 ✅ | `app/columns/` | Chrome E2E: создание, переименование, перетаскивание, дублирование и удаление колонки; WIP-лимит и массовая архивация карточек. |
| TASK-162.4 ✅ | `app/cards/` | Chrome E2E: создание, правка и DnD, копирование, архивирование, восстановление в колонку и удаление; описание, метки, приоритет, срок, исполнитель, task spec, связи, обложка, чек-листы, вложения, комментарии и история; действия контекстного меню карточки, включая быстрые изменения и открытие ссылки. |
| TASK-162.5 ✅ | `app/views/` | Chrome E2E: создание карточки в календаре, создание и правка в таблице, счётчики и лента watch, события доски, карточек, участников и файлов, диффы и пагинация; переключение на канбан и между видами, сохранение после перезагрузки. Отдельные пользователь и доска для каждого теста. |
| TASK-162.6 ✅ | `app/filters/` | Chrome E2E: поиск по названию, описанию, метке и пункту чек-листа; фасеты срока, даты создания (окно и точный день), меток (ANY/ALL, «без метки»), приоритета, исполнителя и связей; чипы, сброс, счётчик фасетов и результатов; пустое состояние; DnD выключен при фильтре; тот же фильтр в таблице/календаре и скрытие панели в Watch. **PR #176:** 37 независимых тестов, полный Chrome-набор 157/157 зелёный; попутно исправлена подсветка бейджа описания при совпадении только по чек-листу. |
| TASK-162.7 ✅ | `app/search/` | Chrome E2E: глобальная палитра (кнопка и Ctrl/Cmd+K; совпадения по названию, описанию, метке и пункту чек-листа; подсветка, сниппет, чипы меток, крошка «Доска › Колонка»); архивные карточки и доски с бейджем и ранжированием; переход к карточке/доске и диалогу архивной карточки; клавиатура со скроллом выбранного и лимит 20; пустой запрос/результат и сброс при повторном открытии; поиск в архиве (фильтр, «ничего не найдено», пустой архив, сброс, открытие карточки) и trim запроса доски. **PR #178:** 26 независимых тестов поиска и 2 теста выбора типа связи, полный Chrome-набор 185/185; найдены и исправлены незаметный скролл выбранного результата, молчаливый редирект с архивной доски (теперь тост) и закрытие формы Link card при выборе типа связи; подсказки упоминают чек-листы. |
| TASK-162.8 ✅ | `app/history/` | Chrome E2E: undo/redo кнопками и Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y; состояние кнопок, отмена/повтор нескольких шагов, очистка redo новым действием, игнорирование горячих клавиш в полях ввода; undo/redo карточек (создание, заголовок, перенос, копия, архив и восстановление из архива, удаление с чек-листом, срок, приоритет, исполнитель, обложка, связи), колонок (создание, переименование, дублирование, удаление с карточками, перенос, сортировка, WIP, массовый архив), меток (привязка, переименование, цвет, удаление с привязками), чек-листов и их пунктов (создание, переименование, удаление, отметка), переименование доски; отдельные стеки досок; результат переживает reload, история — нет; два контекста: чужая правка карточки/доски помечает шаг dead и undo не затирает её, несвязанная чужая правка не мешает. **PR #179:** 44 независимых теста, полный Chrome-набор 229/229; исправлено: `RENAME_BOARD` не попадал в `touchedIds`, поэтому undo после чужого переименования доски мог перезаписать его. **PR #195:** +10 тестов: undo/redo описания, reorder внутри колонки, перенос через строку `Column`, создание метки, смешанная последовательность add→rename→move, dead steps колонки/метки/чек-листа и несколько dead steps одним нажатием, Ctrl+Z в contenteditable. |
| TASK-162.9 ✅ | `app/collaboration/` | Chrome E2E: приглашение по email из диалога участников, уведомление с доской, пригласившим и ролью, принятие (доска появляется без перезагрузки) и отказ, отсутствие доступа по pending-приглашению; живое повышение до ADMIN, живое понижение до VIEWER с read-only доской, защита последнего ADMIN и живой отзыв доступа при удалении участника. Два независимых контекста Chrome: обновление карточки <2 с, presence-ростер и уход ≤60 с, догон пропущенной дельты через `?since=` после закрытия и переоткрытия SSE, идемпотентный повтор `commandId`; конфликт описания с «Keep mine»/«Reload», undo не затирает чужую правку. **PR #180:** 18 независимых тестов, полный Chrome-набор 247/247; исправлено: `membership updated` не обновлял роль вызывающего, поэтому после смены роли UI оставался с прежними правами до перезагрузки. **PR #195:** +21 тест: title-конфликт Keep/Reload, описание после закрытия, undo против чужого описания, read-only VIEWER на карточке/шапке/участниках/share, MEMBER без управления, expiry через UI и живое истечение, pending-инвайт с новой ролью и его отмена, lapsed/дубликат, bell по focus, presence heartbeat/sweep/overflow, две вкладки одного аккаунта, удаление доски. Исправлено: Undo/Redo у VIEWER и очистка истории при live-понижении, ложный success при заблокированном clipboard, past expiry в календаре, невидимые pending-инвайты. |
| TASK-162.10 ✅ | `app/sharing/` | Chrome E2E: создание и отзыв ссылок, snapshot и live без входа, read-only, обновление live, комментарии и вложения, iframe и его темы на отдельном origin, лимиты ссылок, фильтрация и удаление отозванной ссылки. Пользователь и доска изолированы для каждого теста. **PR #195:** +12 тестов: freeze комментариев/вложений в snapshot, refresh snapshot, expired-ссылка и освобождение слота, revoke у открытого зрителя, удалённая доска (live 404, snapshot жив), title/views/flags строки, clipboard success/error, embed snapshot с неизвестной темой, приватность ростера, Content-Disposition и 404 неизвестного токена. |
| TASK-162.11 ✅ | `app/account/` | Chrome E2E: профиль и аватар (имя, цвет, загрузка фото и отказ не-картинке, digest), пароль (успех, неверный текущий, короткий/несовпавший новый), живой отзыв других сессий с сохранением текущей и отзыв всех API-ключей, смена почты через код из Mailpit, неверный код, чистый сброс диалога после отмены/успеха и отзыв других сессий, настройки (тема, язык, формат времени, фон) с сохранением после reload; API-ключи: создание и показ один раз, копирование, успешный запрос с ключом, отзыв с подтверждением, отказ последующего запроса и запрет управления ключами через PAT. **PR #182:** 28 независимых тестов, полный Chrome-набор 275/275; исправлено: копия обещала сохранение API-ключей при смене пароля, хотя сервер их отзывал; диалог смены почты не сбрасывался и мог вернуться на шаг кода после закрытия; верхняя полоса аккаунта игнорировала загруженное фото; смена почты оставляла старую refresh-cookie вызывающего живой. |
| TASK-162.12 ✅ | `app/data/` | Chrome E2E: экспорт всей рабочей области и содержимого доски (колонки, карточки, метки); импорт валидного файла (одна и несколько досок, сохранение содержимого, открытие импортированной доски и сохранение после reload), round-trip файла, экспортированного через UI; отказ для невалидного JSON, чужого файла, неподдерживаемой версии, структурно битых данных, файла больше 5 МБ и пустого конверта (без success-тоста); восстановление локальной копии в server mode недоступно. **PR #186:** 18 независимых тестов, полный Chrome-набор 293/293; исправлено: при отказе сервера во время импорта показывались и ошибка, и «Board imported». |
| TASK-162.13 ✅ | `app/navigation/` | Chrome E2E: прямые ссылки на доску и карточку (вход по ссылке, несколько досок, reload, архивная доска, 404 и возврат, отсутствующая карточка), переходы home → доска, свитчер с клавиатуры, браузерные Back/Forward, пустое состояние «все доски в архиве»; Ctrl+click открывает карточку в новой вкладке с доски, таблицы и календаря; клавиатура: `?`-шпаргалка и Help, `j`/`k`, `e`/Enter, `n`, `c`, Escape, защита от срабатывания при вводе и открытом контекстном меню. **PR #187:** 30 независимых тестов, полный Chrome-набор 323/323; исправлено: `?card=constructor` открывал диалог с прототипом вместо «Card not found» (в том числе на архивной доске), Ctrl/Cmd+click в таблице и календаре не открывал новую вкладку, Enter при активном j/k-курсоре открывал карточку курсора вместо сфокусированной, горячие клавиши доски и `?`/`/` срабатывали поверх открытых меню, а home с активной доской мог показать «все доски в архиве». |
| TASK-162.14 ✅ | `app/pwa/` | Service worker в собранном приложении, офлайн-сценарий, восстановление соединения и состояния после перезагрузки. Chrome E2E: регистрация воркера и scope `/app/`, контроль страницы после reload; офлайн-загрузка app shell и входных ассетов из кэша; офлайн-создание карточки с понятной ошибкой и откатом без «призрака» на сервере; догон чужой правки после восстановления сети через SSE-дельту; восстановление сессии и доски после офлайн-перезагрузки и возврата сети; отсутствие API/SSE-ответов в Cache Storage; манифест и иконки под `/app/`. Каждый сценарный тест — свой пользователь и доска; набор пропускается вне production-сборки `/app/`. **PR #190:** 7 независимых тестов, полный Chrome-набор 330/330; исправлено: обрыв сети во время idle-предзагрузки анимированных иконок ронял всю доску в глобальный error screen (теперь остаётся статичная иконка), а ошибка чанка без ожидающего service worker показывала ложный баннер «доступна новая версия». Офлайн доступен только shell — доски требуют соединения (как описано в user guide). |
| TASK-162.15 ✅ | `admin/` | Chrome E2E: вход мастера (неверный пароль, обычный аккаунт, сохранение сессии после reload, выход), навигация по разделам сайдбара, прямые URL, омнибокс и возврат к доскам; права OWNER/OPERATOR — owner-only пункты и действия скрыты, прямой заход в Masters даёт 403, IP allowlist read-only, при этом оператор может блокировать пользователей; действия под OWNER-сессией — создание пользователя, блокировка/разблокировка, удаление с подтверждением, создание мастера, impersonate в новой вкладке; Audit/Security — успешный и неуспешный вход мастера, блокировка и удаление пользователя, фильтрация по уникальному email/id/IP; изоляция — свои мастера и пользователи на тест, глобальные настройки не меняются. **PR #189:** 23 независимых теста, полный Chrome-набор 346/346 (+ mail-disabled 3/3); исправлено: оператору показывались owner-only действия пользователя (сброс пароля, повышение до мастера, impersonate, выгрузка данных), хотя сервер отвечает 403 — теперь они скрыты и в списке, и на странице пользователя. |
| TASK-162.15-full ✅ | `admin/` (full) | Полное браузерное покрытие мастер-панели по `ADMIN-E2E-PLAN.md` + аудит: **139 admin-тестов (23 smoke + 116 новых)** на 26 экранах. Core (125) — auth/security (lockout+unlock, disabled-master copy, TOTP enroll/login/replay/disable, IP allowlist на login и каждом запросе, throttle, изоляция admin/user сессий), shell/nav (все 26 пунктов EN/RU, collapse/Ctrl+B, тема, язык, омнибокс по 6 типам, Back/Forward, deep link, unknown route), права (operator read-only Email/OAuth/Traffic/Demo/Ops/Comms, скрытые owner-only действия, модерация), users/support (verify/unverify/resend, change email, revoke sessions/tokens, reset, promote, blocked impersonate, export, 8 счётчиков/9 вкладок), masters (OWNER/OPERATOR, duplicate, block/enable, reset, revoke, remove, self/last-owner guards), boards (CRUD/bulk, detail, members/roles/owner transfer), content editor через command log, cards (весь граф), generic browsers (columns/labels/checklists/links/comments/attachments/sessions/tokens/activity/commands/pagination), core settings, comms (announcements/banner+email/templates), security alerts, shares, audit-семейства, error/retry, queue dashboard, concurrent tabs. Global (14, только `tests/admin/global/`, serial, два одноразовых стека) — email status/test/save, OAuth оба провайдера, traffic, demo start/stop/live/cleanup, 4 флага+maintenance+per-user rate+retention purge+sweeps, one-off email, template reset. Каждый тест готовит данные через API, уникальные id/email, проверяет своё audit-событие, cleanup в `finally`. **PR #196:** отдельная CI-джоба `browser-e2e-admin`, `test:admin`/`test:admin:global`, `browser-e2e` исключает `tests/admin/**`. Исправлено: оператор видел owner-only actions анонсов (403 от сервера); не было confirm на card/board delete, board archive, user block/revoke; `Badge` не пробрасывал testid; добавлены detail/settings testid, accessible labels, `aria-pressed` у FilterTabs, testid/aria пагинации, сброс омнибокса при закрытии, отдельное сообщение disabled master, queue dashboard в E2E-стеке. |
| TASK-162.16 ✅ | `site/` | Chrome E2E: лендинг — hero, все основные секции, пять строк возможностей и FAQ; pricing — планы с ценами и лимитами, таблица сравнения, FAQ, CTA на GitHub и в waitlist, финальный CTA; навигация шапки и подвала на главную, pricing и docs, якорь `#features`, гайд по self-hosting и возврат назад; CTA в приложение (`/app/`) — Sign in, Create account, hero и pricing открывают реальные экраны входа/регистрации с передачей языка (`?lng=`), включая русскую страницу, и все app-ссылки остаются на базе приложения; переключатель EN/RU на главной и pricing (та же страница, `<html lang>`, переведённые навигация и контент); тема — light/dark, сохранение после reload, перенос в docs через общий `starlight-theme` и работа на двуязычной 404; 404 — статус, EN/RU и ссылка на главную. **PR #188:** 34 независимых теста, полный Chrome-набор 357/357; исправлено: на двуязычной 404 переключатель темы не работал — две шапки навешивали два inline-обработчика, и клик дважды переключал тему; кнопка теперь биндится однократно. **PR #192:** +11 тестов — SEO (title/description/canonical/hreflang/OG/Twitter/JSON-LD) на home/pricing/RU/404, sitemap/robots/llms.txt/pricing.md/OG, mobile 375 и 720–879, analytics `dataLayer`/DNT/CSP, docs-ссылка и переключатель языка на 404, внешние ссылки, полный RU-лендинг с hreflang, a11y, system Auto и reduced motion; всего 45 site-тестов, полный Chrome 434/434. Исправлено: на 720–879 px не было ни Sign in, ни Create account; CSP блокировал Plausible. |
| TASK-162.17 ✅ | `docs/` | Chrome E2E: лендинг документации и пять групп сайдбара (Start/User guide/Admin panel/API/Reference) с переходом в ключевую страницу каждой; Pagefind-поиск (кнопка и Ctrl/Cmd+K, закрытие Escape, английский и русский индексы, переход по результату, пустой запрос и отсутствие совпадений); целостность inline-ссылок на выборке страниц обеих локалей (HTTP 200) и prev/next; переключатель языка сохраняет страницу, переводит контент и `<html lang>`; общая тема docs↔site для явного выбора и Auto, в том числе после reload; переходы site→docs (шапка/футер), docs→site (бренд с сохранением языка), docs→app (CTA в шапке с `?lng=`) и app→docs (меню Help). **PR #191:** 26 независимых тестов, полный Chrome-набор 349/349 зелёный. Исправлено: Pagefind не запускался в self-host образе под CSP (нужен `wasm-unsafe-eval`), тема Auto из docs не переносилась на сайт; добавлен вход в приложение из шапки доков. **PR #192:** +10 тестов — все 44 страницы (200/lang/H1/title/canonical), полный crawl ссылок и якорей, keyboard-навигация и recoverable error state поиска, docs 404 EN/RU, code copy/таблицы/якоря/TOC/version, locale switch admin/api/user-guide, docs SEO, mobile sidebar/search, a11y; всего 36 docs-тестов. Исправлено: Pagefind при сбое загрузки навсегда оставлял «Searching...» — теперь показывает ошибку с Retry. |
| Coverage audit follow-up ✅ | `app/{auth,account,boards,columns,cards,data,pwa}` | Закрыты пробелы аудита браузерного E2E: backoff входа и одновременные вкладки, board-scoped read-only ключ и метаданные/expiry ключей, лимит аватара и ошибки смены email, отзыв сессий/ключей при восстановлении пароля, группы/роль/лимит/отмена архива в свитчере, WIP-drag и снятие WIP, лимит 12 колонок, insert-zone, скачивание/удаление/лимиты вложений, composer (быстрый ввод, Shift+Enter, метки), удаление своего комментария, Ctrl+Enter/Cancel и пагинация комментариев, delete-forever, duplicate content, move-to-column, полный round-trip export→import, повторный импорт, удаление backup, ошибка 500 импорта, PWA update-баннер с второй вкладкой и офлайн-правка с откатом. `mail-disabled` переведён на serial с восстановлением настроек. **PR #194:** 32 независимых теста; targeted Chrome 126/126, mail-disabled 3/3, полный набор — CI. |

Follow-up по аудиту браузерного E2E `filters`/`search`/`views`/`navigation` (2026-11-09): закрыты все 27 пробелов (5 P0, 9 P1, 13 P2) — AND всех фасетов со счётчиком, перенос чипа с сохранением времени, DnD календаря при фильтре, лимит 3 чипов и полный day-panel, inline-срок в таблице, сброс всех фасетов, фасетный фильтр в Table/Calendar, week/Today/Prev/Next и persistence, drag из Unscheduled, inline title/labels/column, сортировка всех заголовков, Watch status/WIP/roster/agents/delete/retention/page sizes, свитчер и all-archived deep link, ранжирование карточек. Продуктовые фиксы: фильтр в URL (`?f.*`) и после reload, съёмные чипы priority/assignee/links, `isFiltering` для календаря, `aria-sort` на `<th>`, Watch error/retry и `totalCards` без архивных карточек, double-click по title в таблице больше не открывает диалог первым кликом. **PR #193:** targeted Chrome-прогон зелёный, полный Chrome-набор — в CI.

Общий DoD — критерии TASK-41 выше: сценарии зелёные в CI против self-host
Compose, укладываются в бюджет времени, а отчёты и трейсы доступны при падении.
Наборы можно запускать по отдельности; проверять реальные пользовательские пути,
не дублируя механически все unit/API-тесты. Существующий запрет §0 уже снят;
README обновляется с добавлением запуска браузерных E2E.

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
- **Пересекается:** отменённая TASK-39 `public-demo` (публичный инстанс),
  TASK-38b (self-host: флаг и проверка
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
> - **Связь с TASK-32 `landing-intro`:** отдельная презентация внутри приложения
>   отменена по решению владельца: лендинг TASK-124 уже выполняет эту роль.
> - **Доставка сайта — в образе** (не GitHub Pages): Dockerfile собирает `site/`
>   (приложение — с `UI_BASE=/app/`), а NestJS отдаёт сайт на `/`, приложение на
>   `/app/` и API на `/api/v1` (`SITE_DIR`/`STATIC_DIR`/`UI_BASE`); healthcheck
>   проверяет `/api/v1/health` и `/`. Внешний хостинг сайта (кастомный домен) —
>   отдельный деплой через `SITE_URL`/`SITE_BASE`.
> - **Лицензия — AGPL-3.0** (+ `TRADEMARK.md`): self-hosted бесплатен, но
>   производный managed-сервис обязан делиться изменениями; имя «Janosik»
>   защищено отдельной политикой. Изначально MIT, изменено на AGPL-3.0
>   (решение 2026-10). **Вопрос смены лицензии закрыт (решение 2026-10):**
>   остаёмся на AGPL, монетизация — облако позже; страховка на будущее
>   (возможность перелицензирования) — DCO в `CONTRIBUTING.md` (TASK-138).

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
| Ф3 Подписка | 131 | Отложено: облако позже; сейчас — бесплатный self-hosted (AGPL) |
| Ф4 Доки | 132–134 | Доковый сайт: self-host, user guide, API |

**Порядок и зависимости:** 122 → 123 → 124 → {125, 126, 127}; 128 → 129 → 130
(129 требует стабильного UI приложения); 131 — отложено (облако позже,
решение 2026-10); 132 — можно начинать сразу после 122 (токены), 133/134 — после 132.
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

#### TASK-122 — `brand-system` · Бренд-система и токены ✅

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

#### TASK-123 — `marketing-site-scaffold` · Каркас маркетинг-сайта ✅

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

#### TASK-124 — `landing-hero-features` · Лендинг: герой и фичи ✅

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

#### TASK-125 — `landing-pricing` · Тарифы и подписка ✅

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

#### TASK-126 — `site-copy-cro-seo` · Текст, конверсия и SEO ✅

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

#### TASK-127 — `site-a11y-perf-audit` · Аудит доступности и перфа ✅

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

#### TASK-128 — `video-scaffold` · Каркас видео-пайплайна ✅

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

#### TASK-129 — `video-feature-clips` · Клипы ключевых фич ✅

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

#### TASK-130 — `site-media-integration` · Встраивание медиа в сайт ✅

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

#### TASK-131 — `billing-subscription` · Подписка и оплата (hosted) · ⏸ отложено

- **Статус:** **отложено (решение владельца 2026-10).** Сейчас форма поставки —
  бесплатный self-hosted опенсорс (AGPL), а платное **облако — позже**. Страница
  `/pricing` уже приведена к двум тарифам: Self-hosted (free) + Cloud
  («coming later», CTA — лист ожидания). Пока облака нет, биллинг не строим.
- **Зачем (когда вернёмся):** продажа managed-облака по подписке; self-hosted
  остаётся бесплатным навсегда.
- **Что (когда вернёмся):**
  - **Провайдер** — под РФ/РБ/СНГ (Stripe/Paddle/Lemon Squeezy продавцов из
    РФ/РБ не подключают): быстрый старт без кода — **Prodamus** (самозанятый/ИП,
    авто-выдача доступа, чеки 54-ФЗ, платёжные ссылки); максимум конверсии и
    контроль — **ЮKassa** (API, автоплатежи); для РБ — **bePaid**. Решение влияет
    на налоги/регион и юрформу (самозанятый/ИП/ООО).
  - планы и лимиты per-plan в backend (таблица `Subscription`/`Plan`, enforcement
    лимитов — сейчас его нет нигде), checkout, идемпотентные вебхуки, статус в
    UI/админке, аудит; отдельно — как выдавать инстансы managed-хостинга.
  - **Лицензионная инфраструктура (только когда появится платный уровень):**
    подписанные офлайн-проверяемые ключи (в образе — публичный ключ; опциональная
    приватная проверка без телеметрии) + отдельный back-office для лицензий.
    Пока платящего спроса нет — преждевременно.
- **Трогаем (потом):** `backend/`, `shared/`, `ui/` (статус/лимиты), `site/` (CTA).
- **DoD (потом):** облако можно оформить/отменить; лимиты плана применяются;
  вебхуки идемпотентны; статус виден; аудит; e2e на жизненный цикл подписки.
- **Зависимости:** спрос на облако; 125 (страница тарифов — готова).

#### TASK-138 — `contributing-cla` · Контрибьютинг и DCO · ✅ вне очереди

- **Зачем:** репозиторий публичный и опенсорсный, но нет `CONTRIBUTING.md`:
  непонятно, как ставить/тестировать/отправлять PR. И главное — **пока все права
  у владельца, лицензию можно сменить в любой момент; как только примут первый
  внешний PR без DCO/CLA, часть кода «залипает» под текущей лицензией.** DCO —
  лёгкая страховка на годы вперёд (её упоминал и TASK-38b как «замену CLA»).
- **Что:** `CONTRIBUTING.md` — dev-setup (workspaces, `docker compose` для
  Postgres/Redis), гейты перед PR (`lint`/`format:check`/тесты/`build`/`size`),
  стиль коммитов, процесс PR; **DCO**: подпись `git commit -s` (`Signed-off-by`),
  inbound=outbound (вклад лицензируется под лицензией проекта), просьба не
  мержить чужие PR без подписи. Ссылка из `README.md`.
- **Трогаем:** `CONTRIBUTING.md` (новый), `README.md` (ссылка).
- **DoD:** процесс PR описан; DCO требуется явно; лицензирование вкладов
  недвусмысленно; ссылка из README.
- **Зависимости:** нет.

#### TASK-132 — `docs-site` · Доковый сайт (Starlight) ✅

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
- **Статус:** ✅ выполнено. Структура, поиск (Pagefind), i18n en/ru и тема —
  сделаны в TASK-133/134; пользовательский гайд переписан под функции
  (реальные скриншоты, `video/record/screenshots.mjs` → `site/public/screens/`,
  20 снимков; страница «Виды календаря и таблицы»; быстрое меню по правому
  щелчку). Версионирование доков — метка версии в шапке (источник — версия
  корневого `package.json`), доки описывают последний релиз, переключатель
  версий появится на втором мажоре. Вход из приложения — меню «Помощь» в
  шапке (кнопка «?»): «Горячие клавиши» + «Документация» (`/docs/`, для ru
  `/ru/docs/`; в сплит-деплое — `VITE_SITE_URL`).

#### TASK-133 — `docs-user-guide` · Пользовательская документация ✅

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

#### TASK-134 — `docs-api-reference` · API-reference и runbooks ✅

- **Скилы:** `addyosmani/agent-skills@documentation-and-adrs`, `riekelt/technical-writer@{writing-design-docs,writing-runbooks}`
- **Зачем:** self-hosters/интеграторы.
- **Что:** API-reference (из `shared/src/api.ts` DTO / OpenAPI), примеры curl,
  self-hosting runbooks (бэкап/восстановление/апгрейд/мониторинг/troubleshooting),
  ADR-раздел, security-гайд (ссылка на `SECURITY.md`).
- **Трогаем:** `site/` (контент доков), возможно генератор из `shared/`.
- **DoD:** reference покрывает публичные роуты; примеры рабочие; runbooks
  проверены на чистой машине; ADR-структура заведена.
- **Зависимости:** 132.

#### TASK-136 — `mcp-server` · MCP-сервер для роя агентов ✅

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
- **Статус:** ✅ выполнено. Воркспейс `mcp/` (`@janosik/mcp`, bin `janosik-mcp`,
  сборка `tsup` в один `dist/index.js` со вшитым `@janosik/shared`): клиент
  командного контура (штампует `commandId`/`at`/`boardId`, обработка
  `ifMatch`/409 внутри) + REST-обёртки; **71 тулз** покрывают всё приложение
  (доски, колонки, карточки, метки, чек-листы, связи, комментарии, участники,
  приглашения, ссылки на доску, активность, вложения, аккаунт/API-ключи);
  auth — `Bearer jnk_…` через `JANOSIK_URL`/`JANOSIK_TOKEN` (или `--url`/`--token`);
  `response_format` markdown/json, пагинация курсором, лимит ответа, аннотации
  readOnly/destructive, actionable-ошибки. Гейты: typecheck, **28 тестов**
  (config/errors/format/client + сервер через `InMemoryTransport` с fake-API),
  lint/format, сборка; живой смоук `mcp/scripts/smoke.mjs` — 13/13 на
  `:3210` (полный цикл: доска → колонка → карточка → чек-лист → коммент →
  активность → поиск → удаление). Публикация: `npx @janosik/mcp` (publishConfig
  public), страница доков `/docs/mcp/` (en+ru). Осталось внешнее: `npm publish`
  и регистрация в MCP registry.
- **Ревью и харденинг (независимый архитектурный аудит).** Исправлено: битая
  `npx`-установка (`@janosik/shared` ушёл в devDependencies — он и так вшит в
  бандл); `janosik_accept_invitation` больше не падает (эндпоинт отвечает
  `void`); ссылка на доску строится от `JANOSIK_APP_BASE` (`/s/:token`, а не
  `/app/s/…`); upload/download вложений стали opt-in (`JANOSIK_MCP_ALLOW_FS`,
  опционально `JANOSIK_MCP_FS_ROOT`) — это реальный prompt-injection → запись
  в файл, плюс `download` перестал помечаться read-only; `structuredContent`
  больше не льётся без лимита; ошибки REST показывают тело (`message`), а не
  только статус; границы полей берутся из `LIMITS`; `limit` проброшен в
  пагинацию; `search_cards` останавливается на лимите; cover-`value` — enum;
  `expiresInDays` ограничен `API_TOKEN_MAX_TTL_DAYS`; CLI ругается на опечатки
  в флагах и не режет `=` в значении; graceful shutdown по SIGINT/SIGTERM;
  тестов **39** (было 28), счётчик тулзов запинен на 71.
- **Финальное MCP-ревью (2026-10-28).** Предыдущий статус
  завышал: `ifMatch`/409 были только в клиенте, ни один тулз их не слал;
  «идемпотентность» не работала (новый `commandId` на каждый вызов, без
  повторов). Исправлено:
  - no-op-команда (`versions: {}`) → ошибка «nothing changed», а не успех;
    «не найдено» везде `isError`;
  - id валидируются (`[A-Za-z0-9_-]{1,128}`) и кодируются в пути
    (`apiPath`) — `delete_comment("../boards/<id>?")` больше не уходит как
    `DELETE /boards/<id>`;
  - тулзы аккаунта/участников/приглашений/шар — opt-in
    (`JANOSIK_MCP_TOOLSETS`), режим `JANOSIK_MCP_READONLY`;
  - read-then-write тулзы (`move_card`, `move_column`, `duplicate_column`,
    `remove_card_link`) шлют `ifMatch` = `X-Board-Seq` и повторяют при 409;
    `update_card` — CAS через `expectedDescription`;
  - сетевые сбои команд повторяются с тем же `commandId`; таймауты на все
    запросы;
  - `create_card` валидирует дату/исполнителя до `ADD_CARD`, а частичный
    сбой называет id созданной карточки;
  - `search_cards include_archived` реально ищет в архиве;
  - JSON сверх лимита — ошибка с подсказкой вместо битого JSON;
    `get_board` получил `columnId`/`include_archived`, `export_board` —
    `outputPath`;
  - FS-песочница: `realpath` (симлинки за корень отклоняются), только
    обычные файлы ≤ лимита вложения, запись только новых файлов (`wx`);
  - строгий тип `CommandAction` = `BoardAction` без `at`/`boardId` (ошибка
    формы команды — ошибка компиляции); cover — discriminated union; лимиты
    из `LIMITS`/`SHARE_LIMITS`/`DISPLAY_NAME_MAX`.
  Тулзы API-ключей (`list/create/revoke_api_key`) удалены: бэкенд теперь
  отвечает ключу `jnk_…` 403 `pat_forbidden` на управление ключами, паролем
  и email; со всеми группами — 68 тулзов, по умолчанию 54 (~11.6k токенов
  каталога вместо ~13.9k). Тестов **65** (было 39). Осталось внешнее:
  `npm publish` и MCP registry.

#### TASK-137 — `agent-skill` · Скилл-плейбук роя ✅

- **Скилы:** `skill-creator`
- **Зачем:** MCP — «руки», скилл — «поведение»: конвенции роя, а не транспорт.
- **Что:** публикуемый скилл `janosik` (markdown + промпты), который ссылается на
  MCP-тулзы и не дублирует I/O; рецепты («взял задачу → создал карточку →
  In progress → коммент → чек-лист → Review → Done»), шаблоны карточек/меток.
- **Трогаем:** новый `skills/janosik/` (или каталог скиллов).
- **DoD:** скилл ставится в харнессы (Claude/opencode/Codex); агент по нему ведёт
  карточку на реальном борде через MCP; нет дублирования API-деталей.
- **Зависимости:** 136.
- **Статус:** ✅ выполнено. Новый `skills/janosik/`: `SKILL.md` (поведение:
  прочитать → взять карточку → наполнить описание/чек-лист/метки/приоритет →
  комментировать на каждом шаге → вести Backlog→In Progress→Review→Done → на
  баге **вернуть карточку** в Bugs/In Progress с комментарием и пунктом
  чек-листа, чтобы остался след истории), плюс `references/templates.md`
  (шаблоны карточек/комментов/меток) и `references/recipes.md` (рецепты
  жизненного цикла тулзами). Ссылается на тулзы по именам, не дублирует API.
  Ставится в харнессы (Claude Code/opencode/agent-compatible — каталоги
  `skills/`), в репо — симлинк `.claude/skills/janosik`; для Codex — вставка в
  `AGENTS.md`. **Валидировано вживую** на `:3210` через MCP: прогон по плейбуку
  (доска → колонки → карточка → комменты → чек-лист → Review → баг → возврат в
  Bugs) виден в `janosik_board_activity` как forward-back-forward. Документация:
  раздел в корневом README, страница `/docs/mcp/` (en+ru) про скилл и установку,
  ссылка в `mcp/README.md`.

---

### 7.13. Производительность и масштаб (TASK-139…143)

> **Зачем.** Нагрузочный прогон (2026-10-29, полный отчёт —
> `~/.janosik-dev/load/LOAD-REPORT.md`, одна нода 16 vCPU, лимиты подняты)
> показал: архитектура ведёт себя **предсказуемо**, но есть несколько точек, которые
> стоит закрыть (пять задач; TASK-143 уже закрыта, §7.7 строки 72–74). Замеры,
> одиночная нагрузка:
> - агрегат доски **~430–465 rps и не зависит от размера** (200 и 2400 карточек —
>   одинаково) → упирается в CPU сборки, ~4.3 ядра;
> - микс (read/write/comment) ~250 rps; запись **одной** доски **~48/s**
>   (сериализация advisory-lock `BoardWriteService`, латентность линейна: 100
>   писателей → ~1 с); запись по 100 доскам ~290/s (CPU); комментарии ~257 rps;
> - admin ~650 rps (~6 ядер); live-share ~95 rps, snapshot ~250; `/health` ~5.6k rps;
> - realtime: 1000 потоков ок, **~3000 → `V8 heap out of memory`, падение процесса**
>   (~0.45 MB/соединение), systemd-рестарт рвёт **все** соединения;
> - UI: доска 2400 карточек рендерится **4.8 с**, 67.7k DOM-узлов, ~1.1 GB heap,
>   блокировка main-thread **3.9 с**;
> - БД: все индексы корректны (горячие запросы 0.05–0.76 ms), но
>   `shared_buffers=16 MB` (дефолт контейнера);
> - «всё сразу»: микс ×4.9, admin ×6.7, сайт ×1.6, fan-out realtime 30–90 ms → **10–20 с**.
>
> **Вывод.** Всё упирается в один CPU-процесс и очередь записи на доску — это
> масштабируется **нодами + Redis** (pub/sub fan-out уже есть, TASK-74), а не
> переписыванием. Многонодность и защита `/auth/login` (5/мин) уже в порядке —
> закрываем то, что бьёт пользователя и режим отказа. Порядок — в таблице §7.7
> (строки 72–74).

#### TASK-139 — `board-virtualization` · Большие доски без фризов ✅

- **Зачем:** доска максимального размера (`LIMITS` 12×200 = 2400 карточек)
  достижима уже сейчас, но рендерится 4.8 с и морозит main-thread на 3.9 с
  (67.7k DOM, ~1.1 GB heap). Это **единственная** найденная проблема, которая бьёт
  обычного пользователя, а не гипотетический масштаб.
- **Что:** виртуализация списка карточек в колонке (рендер видимых + буфер),
  скролл без ломки DnD; строка таблицы — виртуализация; календарь — по необходимости.
  Модель/редьюсер не трогаем. Совместимость с `memo`/рендер-изоляцией и **со
  стабильными значениями для dnd-kit** (§1.2: новый массив/объект меняет контекст).
- **Трогаем:** `ui/src/components/board/ColumnView.tsx`, `CardItem.tsx`,
  `AddCardZone.tsx`, таблица/календарь при необходимости; тесты рендера.
- **DoD:** доска 2400 карточек рендерится <1 c, ни одной long task >200 мс, heap
  <300 MB (замер Playwright **до/после** в PR); DnD, фильтр, архив, поиск, read-only
  не сломаны; ui-тесты и `size` зелёные.
- **Выполнено:** карточки колонки и строки таблицы монтируются окном, высота
  скролла сохраняется spacer-элементами; `SortableContext` по-прежнему получает
  все id, а j/k подскролливает колонку к курсору. Календарь: месячная сетка не
  растёт (42 ячейки × 3 чипа), окно добавлено только к неограниченным спискам —
  unscheduled-панели, недельным ячейкам и day-panel. Замер на dev-UI, 2400
  карточек: board — 108 карточек в DOM, 4.0k DOM, 90 MB heap, первый рендер
  ~0.7 с, max long task 176 мс; table — 26 строк вместо 49k DOM/513 MB/1.9 с;
  unscheduled — 27 кнопок вместо 2400. См. `docs/PERF-BASELINE.md`.
- **Зависимости:** нет.

#### TASK-142 — `simplify-design` · Чекбокс «Упростить дизайн» (+ лёгкий «watch»-вид) ✅

- **Зачем:** рой агентов постоянно меняет карточки → частые перерисовки; полная карточка
  (~28 DOM-узлов: бейджи, контролы, обёртки) тяжела для рендера и шумна для глаза,
  который **наблюдает** за роем. Гипотеза: упрощённый визуальный слой снижает DOM и
  стоимость рендера и делает «что происходит на доске» читаемее. Проверить **замером**
  (§7.13 «всё сразу»/UI), а не на веру: если выигрыш чисто косметический — не усложнять.
- **Что:**
  1. пользовательский тумблер **«Упростить дизайн»** (в настройках/шапке, сохраняется
     как локальная настройка вида, как выбор «канбан/календарь/таблица») — переключает
     **плотную** лицевую часть карточки (только ключевое: заголовок, при необходимости
     метка/приоритет/исполнитель) против полной. Не «пусто» ради простоты — смысл на
     стене человеку нужен;
  2. опционально — **read-only «watch»-режим** для наблюдения за роем: поток
     активности + presence + минимум DOM, крупный статус;
  3. совместимость с виртуализацией (TASK-139) и рендер-изоляцией: значения для
     dnd-kit стабильны, `memo` не ломается; полные детали — по клику, не на лицевой части.
- **Трогаем:** `ui/src/components/board/CardItem.tsx`, `ColumnView.tsx`, шапка/настройки
  вида, `src/locales/{en,ru}`, локальные настройки вида; при «watch»-режиме — отдельный
  лёгкий компонент.
- **DoD:** тумблер «Упростить дизайн» переключает плотный/полный вид и **сохраняется
  между сессиями**; упрощённый вид заметно снижает DOM-узлов и время рендера (замер
  до/после в PR); функции доступны по клику; en+ru; read-only/presence/DnD не сломаны.
- **Зависимости:** TASK-139 (виртуализация — сначала она), затем этот слой.
- **Выполнено (2026-10-30):**
  - **Тумблер «Упростить дизайн»** — меню плотности на панели вида (только board-вид, рядом с
    настройками стекла колонок); флаг хранится в `localStorage` (`janosik-board-density`,
    `"full" | "compact"`) и переживает перезагрузку/смену доски, как выбор вида. На корне
    выставляется `data-density` (для CSS и замеров).
  - **Компактная карточка** (`CardItem compact`): одна строка 48px — заголовок, метки точками
    (`LABEL_COLOR_DOT`), красный blocked-маркер, прогресс чек-листа (`2/3`), приоритет и аватар
    исполнителя. Hover-кнопки duplicate/archive, описание, срок и подписи меток намеренно убраны
    с лица — они остаются по клику (диалог) и в контекстном меню. Компактный режим не заводит
    per-card `ResizeObserver` (полное лицо использует его для `title`-тултипа).
  - **Совместимость с виртуализацией:** высота строки `COMPACT_CARD_ROW_HEIGHT = 56` (48px карточка
    + 8px зона) прокинута в `useCardWindow`, spacer-геометрию и j/k-скролл; `SortableContext`
    по-прежнему получает все id; `memo` не ломается (компактность — примитивный проп).
  - **Замер (Playwright, dev-UI, синтетическая доска 12×200 с метками/описаниями/чек-листами/
    сроками/исполнителями):** DOM 4 482 → 2 414 узлов (−46%), узлов на карточку 41.5 → 15.5,
    первый рендер 1 060 → 740 мс (−30%), max long task 499 → 295 мс, карточек в окне 108 → 156
    (компакт показывает больше).
  - **Под нагрузкой:** 240 команд-обновлений живьём (≈9/с, конкурентно×6) через командный API
    (та же обвязка, что у MCP) — **0 long task** в обоих режимах; карточка, созданная
    `janosik_create_card` по MCP, появилась в открытой компактной доске без перезагрузки.
  - **Watch-вид (`WatchView`) — «без косметики»:** четвёртая вкладка вида. Ни карточек, ни
    drag & drop, ни анимаций/переходов (правило `[data-watch] { animation/transition: none }`
    глушит всё внутри). Крупный статус (карточек / колонок / онлайн), левая рейка со счётчиками
    колонок и списком online, справа — живая лента `GET /boards/:id/activity` (команды + activity),
    newest-first, лимит 50. Форматтер строки вынесен в `utils/activity.ts` (`sentenceFor`) и
    переиспользован в `CardHistory`; строки — чистый текст без аватаров/диффов. Лента опрашивается
    раз в 3 с (+ немедленно на кадр комментария и на свой settled-коммит), presence и счётчики
    колонок идут по обычному SSE; пауза при `document.hidden`. Замер на 2400 карточек: **0 карточек
    в DOM, ~405 узлов всего** (против 2 414 у компакта и 4 482 у полного), фильтр-панель и меню
    плотности скрыты. См. `docs/PERF-BASELINE.md`.
  - **Документация:** пользовательский гайд — страница «Виды календаря, таблицы и наблюдения»
    (en/ru) с реальными скринами watch-вида и компактных карточек
    (`site/public/screens/watch.png`, `card-density.png`; генерируются
    `video/record/screenshots.mjs`); README (список фич, счётчик тестов),
    маркетинговый сайт (`home.row.board.title`, `home.more.views`) и ссылки в
    user-guide обновлены. Заодно лента watch и карточная история читают имя
    колонки/метки/доски: `commandDetails` пишет снапшот для команд колонок,
    меток, `DELETE_CARD`, `RENAME_BOARD` и `RESTORE_*`, а фронт маппит все типы
    `BoardAction` (`utils/activity.ts`, тест на 50 типов).
  - **Гейты:** ui 992 теста (было 918), backend unit 310, site 61, lint 0 errors / 57 warnings,
    `tsc -b`, build, size-limit, `astro check` и сборка сайта — зелёные.

#### TASK-143 — `presence-deltas` · Presence без O(N²) ✅

- **Зачем.** Нагрузочный прогон показал, что ~0.5–0.8 MB на SSE-соединение — это не
  сам поток, а полный presence-ростер, который рассылался **всем** на каждый
  join/leave и каждые 30 c: O(N²) на событие, O(N³) на массовое подключение. Именно
  это валило процесс (`V8 heap out of memory`) на ~3000 соединений (разбор —
  `~/.janosik-dev/load/SSE-MEMORY-FINDINGS.md`).
- **Что (сделано).** Протокол presence переведён на дельты — как в Yjs awareness /
  Ably / Pusher / Supabase: `sync` (полный ростер) отправляется **только** новому
  соединению; дальше `join`/`leave`/`update`. 30-секундный broadcast ростера удалён
  (остался TTL-sweep); клиент ведёт `Map<userId, PresenceUser>` (`PresenceStore.apply`).
  Добавлен `?presence=0` для агентских/служебных потоков. Контракт —
  `shared/src/api.ts` (`PresenceSseEvent`), сервер — `realtime/presence.service.ts`,
  `commands/events.controller.ts`, клиент — `store/realtime.ts`, `store/board-live.tsx`.
- **Результат (замер).** 1600 коннектов: **1464 → 463 MB**; **3000 коннектов —
  703 MB, API жив** (раньше — падение по OOM); steady-state 1000 коннектов +
  heartbeat 3 мин — плато ~470 MB (не течёт). ~0.17 MB/коннект при массовом
  подключении (включая `sync` каждому) и ~0.10 в steady-state.
- **DoD.** ✅ дельты + sync-on-connect; backend 280 тестов, ui 866, shared 431 —
  зелёные; lint/format/build/size зелёные.
- **Зависимости:** TASK-30 (SSE), TASK-36 (presence).

#### TASK-140 — `realtime-resilience` · Перегруз не должен ронять сервер ✅

- **Зачем:** при ~3000 одновременных SSE процесс падает `V8 heap out of memory`,
  systemd перезапускает — и **все** соединения рвутся разом. Режим отказа должен быть
  «вежливо не пустить новым», а не «умереть для всех».
- **Что:** `NODE_OPTIONS=--max-old-space-size` (дефолт в `Dockerfile` + self-host),
  настраиваемый env-лимит одновременных SSE на инстанс с **отказом** при превышении
  (событие/`503`, без падения), метрика и лог числа активных соединений; в
  `docs/SELF-HOSTING.md` — масштабирование нескольких нод API за LB (Redis pub/sub
  fan-out готов, TASK-74) и `docker` replicas.
- **Трогаем:** `backend/src/commands/events.controller.ts`,
  `backend/src/realtime/realtime.service.ts`, `backend/src/realtime/presence.service.ts`,
  `backend/src/config/env.ts`, `.env.example`, `Dockerfile`, `docker-compose.yml`,
  `docs/SELF-HOSTING.md`.
- **DoD:** под синтетическим перегрузом (> лимита) сервер **отказывает** новым
  соединениям и остаётся жив; лимит и heap — через env; доки self-hosting описывают
  масштаб и путь «несколько нод»; смоук `sse-agents`: N соединений без OOM.
- **Зависимости:** TASK-74 (уже реализовано).
- **Статус:** причина OOM (присутствие) устранена в TASK-143 (3000 коннектов
  держатся без падения); **лимит одновременных SSE с вежливым `503`+`Retry-After`
  уже сделан в TASK-146** (`SSE_MAX_CONNECTIONS`/`SSE_MAX_PER_USER`/`SSE_MAX_PER_BOARD`,
  счётчик `RealtimeService.subscriberCount` виден в observability TASK-64).
  **Сделано (PR #144):** heap-лимит (`--max-old-space-size=1024` в
  `Dockerfile`/compose/.env), лог числа активных соединений раз в минуту +
  warn при отказе, раздел «Scaling (streams and multiple nodes)» в
  `docs/SELF-HOSTING.md` и в сайтовых runbooks (en/ru).

#### TASK-141 — `scale-caches-config` · Кэши и конфиг БД ✅

- **Зачем:** live-share пересобирает агрегат на каждый просмотр (~95 rps против ~250
  у snapshot); admin-чтение дорогое (~6 ядер на 650 rps); Postgres стартует с
  `shared_buffers=16 MB`.
- **Что:** (1) short-TTL кэш live-share (снапшот агрегата + инвалидация по `seq`);
  (2) инвалидируемый кэш `/admin/metrics` и тяжёлых admin-списков; (3) `shared_buffers`
  как настраиваемый параметр в self-host compose + обоснование в `docs/SELF-HOSTING.md`;
  (4) пометка: пул Prisma и `max_connections=100` пересчитать при нескольких нодах.
- **Трогаем:** `backend/src/share/share.service.ts`, `backend/src/admin/*` (метрики),
  `docker-compose.yml`, `docs/SELF-HOSTING.md`.
- **DoD:** повторные live-share и admin-метрики обслуживаются из кэша (замер RPS
  до/после в PR), консистентность сохраняется (инвалидация по `seq`); self-host compose
  и доки описывают `shared_buffers`.
- **Зависимости:** нет.
- **Статус:** пункты (3) `shared_buffers`/`work_mem`/`max_connections` и (4)
  `DB_CONNECTION_LIMIT` **уже сделаны в TASK-153** (compose + `.env.example` +
  `docs/SELF-HOSTING.md`). **Сделано (PR #145):** (1) `ShareAggregateCache` —
  TTL-кэш live-share с инвалидацией по `seq` (+ single-flight, TTL для ростера)
  и (2) `TtlCache` для `/admin/metrics` со сбросом на любой модерации через
  `audit()`; env `SHARE_AGGREGATE_CACHE_MS`/`ADMIN_METRICS_CACHE_MS`.

#### Отложено (не сейчас)

- **Батчинг/шардинг команд одной доски** (~48/s) и **глобальный потолок команд**
  (~290/s, CPU). Для команды из 5–20 человек незаметно. **Замер 2026-11-01
  (`docs/PERF-ONE-BOARD.md`) — «рой агентов» наступил: запись одной доски держит
  ~42 команд/с, а из 24 ms на команду лок всего 0.7 ms (3 %), тогда как загрузка
  всей доски — 8 ms (33 %) и pre-checks — 7 ms (29 %). Рычаг — батч команд, а не
  снятие лока. → TASK-160 (§7.19) сделан: батч-транспорт поднял запись одной
  доски до ~102 команд/с (×2.3–2.5). Глобальный потолок (~290/s, CPU) и шардинг
  по-прежнему отложены.**
- Многонодность, Redis pub/sub fan-out, лимит `/auth/login` 5/мин — **не трогаем**
  (первое уже есть, второе — защита by design). **Исключение:** presence при
  нескольких нодах ломается (см. TASK-145) — включать >1 ноды можно только после неё.

---

### 7.14. Аудит 2026-10-29 — найденные дыры (TASK-144…155)

> **Зачем.** Три независимых аудита (realtime/scale, backend/DB/queues/security,
> frontend/UI) после нагрузочного теста дали ~50 находок. Полный свод с
> `file:line` — `~/.janosik-dev/load/AUDIT-FINDINGS.md`. Здесь — сгруппированные
> задачи: одна тема = одна ветка = один PR. Порядок — по цене ошибки, не по
> объёму.

#### TASK-144 — `ui-edit-coalescing` · Без молчаливых потерь правок ✅

- **Зачем:** C2 — коалесинг quiet-правок ключуется `${boardId}:${cardId}` и
  **заменяет весь patch**: «описание (blur) + заголовок (по символу)» в пределах
  400 мс теряют одно из полей (локально видно, на сервер не ушло). C3 — при
  неразрешённом конфликте описания закрытие диалога/смена карточки/`pagehide`
  коммитят черновик поверх чужого нового текста.
- **Что:** сливать `UPDATE_CARD`-патчи по полям (а не заменять целиком), резолвить
  waiter только когда покрыты его поля; при `conflict` не флашить описание
  (сохранять черновик по карточке и переопрашивать при открытии); тесты на оба
  сценария.
- **DoD:** «описание → сразу заголовок» не теряет ни одного поля (сервер + reload);
  закрытие диалога с конфликтом не затирает чужой текст; тесты зелёные.
- **Зависимости:** нет.
- **Выполнено (2026-10-29):** `ServerSync` сливает quiet-`UPDATE_CARD` по полям
  (title+description в одном окне оба уходят), waiter'ы резолвятся исходом
  коалесцированного отправления; `CardDialog` не коммитит описание при
  неразрешённом конфликте (черновик в per-card `Map`, восстановление при
  открытии, «Keep mine»/«Reload» его чистят). Тесты: `server-sync.test.ts`,
  `CardDialog.conflict.test.tsx`.
- **Дополнено (аудит 2026-10-29):** `conflictedDrafts` ключуется `board:card`
  (нет коллизий между досками); провал коалесцированного отправления
  обрабатывается один раз (одно сообщение/откат) — waiter'ы резолвятся одним
  outcome, дедуп в `BoardContext`; тест на порядок резолва.

#### TASK-145 — `presence-consistency` · Presence не врёт и самовосстанавливается ✅

- **Зачем:** A1 — per-node presence фан-аутится через Redis глобально: на 2+ нодах
  `sync` неполный, ложные `leave`, `update` по невидимым сессиям. A2 — после
  удаления 30-сек broadcast нет сверки: потерянная дельта (Redis at-most-once,
  реконнект подписчика, порядок) навсегда. A3 — фоновые вкладки троттлятся >TTL,
  `POST /presence` всегда 204, клиент не переподключается → юзер «пропадает».
- **Что:** решить топологию (фильтровать `presence` из Redis при одной ноде **или**
  общий presence-store в Redis для нескольких); per-board presence `epoch` и
  сверка `sync` на keep-alive/редкий resync; `ping` отдаёт `410` при пропавшей
  сессии → клиент перезапускает стрим (rejoin); `samePresence` учитывает
  `avatarPath`; чистить ростер на disconnect/смене доски; валидировать `clientId`
  до создания Observable (иначе течёт `releaseTracking`); SSE-парсер по `/\r?\n\r?\n/`.
- **DoD:** single-node: TTL/rejoin не теряет юзера; 2 ноды: ростер сходится, нет
  ложных `leave`; тесты на `presence=0`, `avatarPath`, touch-miss/rejoin и
  two-node.
- **Зависимости:** TASK-143 (есть), TASK-74.
- **Выполнено (2026-10-29):** топология решена как **присутствие per-node** —
  presence публикуется через `RealtimeService.publishLocal`, а не в Redis, поэтому
  на 2 нодах нет ложных `leave` (каждая нода показывает своих; полная сходимость —
  см. «Остаётся»). Кадры presence несут `epoch`; keep-alive возвращает
  `presenceEpoch`, при расхождении клиент переподключается и получает свежий `sync`
  (A2). `ping` отдаёт `410` при пропавшей сессии → rejoin (A3). `samePresence`
  сравнивает `avatarPath` (A6). `clientId` валидируется до `Observable` (A9). SSE
  парсится по `/\r?\n\r?\n/` (A10). Ростер чистится на смене доски/stop (A8),
  heartbeat не глушится поздним teardown (A11). `sync` переиспользует ростер из
  `join` (A5). Тесты: `presence.service.spec` (+epoch/локальность/`assertClientAvailable`),
  `events.e2e-spec` (ping `410`), ui `realtime`/`board-live`.
- **Остаётся:** общий presence-store в Redis (HSET/Lua) для сходимости ростера на
  нескольких нодах — сейчас многонодный режим нельзя включать с ожиданием полного
  presence (нода пишет warning при `usingRedis`).
- **Дополнено (аудит 2026-10-29):** `clientId`, занятый другим пользователем,
  теперь `409 client_id_taken` → UI берёт новый id и переподключается, а не
  «отзывает доступ» (не сбрасывает доску); `reconnect()` форсирует мгновенное
  переподключение и на живом стриме; поздний ping `410` старой доски не
  реконнектит новую; `epochs` освобождается вместе с пустой доской; SSE-парсер
  ограничен по размеру буфера.

#### TASK-146 — `resource-limits` · Кэпы на SSE, команды, загрузки, шары ✅

- **Зачем:** A4 — нет лимита SSE-соединений/сессий (один VIEWER = неограниченно
  потоков). B1 — `ifMatchVersions` без лимита: десятки тысяч ключей внутри
  advisory-lock → board-wide DoS. B20 — вложения без квот, multer в память 25 MB.
  B23 — share-throttler in-memory, неограниченный Map, на нодах ×N.
- **Что:** env-лимиты SSE (instance/user/board) с `503 Retry-After`; cap
  `ifMatchVersions` (~100) + батч-запрос версий; квоты upload + temp-file вместо
  памяти + upload-rate; bounded share-throttle (Redis/LRU) + валидация токена.
- **DoD:** перегруз > лимита — вежливый отказ, процесс жив; большая
  `ifMatchVersions` — `400` без блокировки доски; квоты работают; тесты.
- **Зависимости:** TASK-140 (пересекается по кэпу соединений).
- **Выполнено (2026-10-29):** SSE-лимиты `SSE_MAX_CONNECTIONS` /
  `SSE_MAX_PER_USER` / `SSE_MAX_PER_BOARD` (`0` = без лимита) через
  `RealtimeService.reserveSubscriber`, отказ `503` + `Retry-After` (A4);
  `ifMatchVersions` ≤ 100 ключей и батч-чтение версий `entityVersions` — не
  больше одного запроса на тип, без N+1 под advisory-lock (B1);
  `UPLOAD_RATE_LIMIT` (60/мин на юзера, `429`) + существующий cap
  `attachmentsPerCard` (B20, частично); `ShareThrottlerGuard` ограничен
  `MAX_BUCKETS` + валидирует форму токена (B23). Тесты: `realtime.service.spec`,
  `commands-board-level.e2e-spec`, `attachments`/`board-share` e2e.
- **Остаётся:** temp-file uploads — вынесено в **TASK-155**; Redis-лимитер шары
  на несколько нод (сейчас лимит per-process, на N нодах ×N).
- **Дополнено (аудит 2026-10-29):** `parseSince` считается до `reserveSubscriber`
  (нет утечки слота на `400`); кэп `ifMatchVersions` проверяется до advisory-lock;
  admission (instance/board) добавлен и на публичный SSE-шар (`userId=null`,
  per-user не применяется); upload-rate вынесен в `UploadRateGuard` до буферизации
  multer; share-throttle — честный LRU. Тесты: events e2e (нет утечки слота),
  `realtime.service.spec`, `upload-limiter.spec`, `share-throttler.guard.spec`.

#### TASK-147 — `security-hardening` · Auth, доступ, секреты ✅

- **Зачем:** B2 — `/health` публичный/без троттлинга/ходит в БД+Redis (усилитель
  пула). B3 — impersonation выдаёт полноценный user-JWT (смена пароля/PAT →
  takeover). B4/B5 — истёкшие VIEWER и не-члены-исполнители получают данные по
  email. B6 — bull-board в обход admin IP-allowlist. B13 — прод-compose по
  умолчанию `COOKIE_SECURE=false`. B17 — CIDR без валидации префикса/IPv6.
  B18 — TOTP-ошибки не в lockout, нет replay. B19 — коды писем в прод-логах.
- **Что:** разделить liveness/readiness (или троттлить/кэшировать); read-only
  impersonation (запрет credential/PAT/email/write при `imp`); единый предикат
  активного членства в `listBoards`/`listMembers`/дайджестах/напоминаниях;
  проверка assignee на restore/import; bull-board за тем же allowlist; default
  `COOKIE_SECURE=true`; валидация CIDR; TOTP в lockout + replay-защита; без тел
  писем/кодов в прод-логах.
- **DoD:** e2e на read-only impersonation, expiry-leak, assignee-non-member;
  allowlist у дашборда; secure-cookie по умолчанию.
- **Зависимости:** нет.
- **Выполнено (2026-10-29):** B2 — `GET /health` стал liveness без I/O,
  `GET /health/ready` — readiness (DB+Redis) с кэшем ~2 с и single-flight;
  healthcheck образа/compose переведён на `/health/ready`. B3 — `JwtAuthGuard`
  применяет политику read-only impersonation (`imp`): safe-методы + presence-ping
  проходят, записи и `/users/me/tokens` → `403 code: impersonation_read_only`
  (e2e в `admin.e2e-spec`). B4/B5 — единый предикат `activeMembershipWhere`
  (`common/membership.ts`) в `listBoards`, `listMembers`, дайджестах и
  напоминаниях (batch-запрос); assignee снимается на `RESTORE_CARD`/import, если
  он не активный участник (e2e `security-hardening.e2e-spec`). B6 — `queueDashboardOwner`
  применяет тот же IP-allowlist к bull-board. B13 — `COOKIE_SECURE` по умолчанию
  `true` (compose + `.env.example` + self-hosting доки), HTTP-триал задаёт `false`
  явно. B17 — CIDR с проверкой префикса и поддержкой IPv6 (BigInt), сохранение
  невалидных записей → `400`. B18 — неверный TOTP идёт в тот же lockout, что и
  пароль, а принятый шаг запоминается (replay отклоняется). B19 — в production
  лог писем не содержит тела/кодов. Тесты: unit 249, e2e 284.
- **Остаётся:** общий presence-store в Redis (TASK-145) — не в объёме этой задачи;
  per-node TOTP-replay и IP-лимитер шары (см. TASK-146) остаются per-process.
- **Дополнено (аудит 2026-10-29):** тема письма (несёт код подтверждения) тоже
  не логируется в production; квикстарты `README`/`INSTALL-BY-OS`/self-hosting
  (en/ru) и таблицы дефолтов приведены к `COOKIE_SECURE=true`.

#### TASK-148 — `retention-and-indexes` · Очистка, индексы, очереди не копятся ✅

- **Зачем:** B8 — нет индексов `deletedAt` (Card/Comment/Checklist/…),
  `expiresAt/revokedAt` (токены/шары/инвайты), `dueDate` (ReminderSent) → purge
  seq-scan/O(n²). B9 — retention не удаляет `Board`/`Activity`/`AdminAuditLog`/
  отозванные шары (GDPR/рост). B12 — GDPR-erase не удаляет `DataExport`/бандлы.
  B22 — `.tmp-*` блобы не чиcтятся. B7 — scheduler копит completed/failed.
  B21 — exports/media глотают ошибки (retry BullMQ не работает).
- **Что:** индексы `CONCURRENTLY`; sweeps для Board/Activity/audit/shares/exports;
  rethrow в exports/media при остатке попыток; `removeOnComplete/Fail` у scheduler;
  чистка `.tmp-*` по grace.
- **DoD:** maintenance на большой таблице без seq-scan; erase удаляет экспорт;
  очереди не растут; тесты на каждую sweep.
- **Зависимости:** нет.
- **Выполнено (2026-10-29):** B8 — миграция
  `20261029180000_task148_retention_indexes` плюс `npm run db:indexes`
  (`CONCURRENTLY` для больших инсталляций): `deletedAt` на Board/Column/Card/
  CardLink/Label/Checklist/ChecklistItem/Comment, `expiresAt`/`revokedAt` у
  RefreshToken/AdminRefreshToken/BoardShare, `expiresAt` у BoardMember,
  `dueDate` у ReminderSent, `createdAt` у Activity. B9 — `purge-soft-deleted`
  добивает целые доски (строки, фид, журнал, шары, блобы), новые sweeps
  `sweep-activity` и `sweep-audit` (`AUDIT_RETENTION_DAYS`, по умолчанию 365),
  `sweep-shares` удаляет и отозванные >24 ч. B12 — GDPR-erase удаляет
  `DataExport` и `.json`-бандлы. B22 — `listTempBlobs()` + чистка `.tmp-*` по
  часовому grace. B7 — `removeOnComplete/removeOnFail` в шаблоне Job Scheduler
  (`maintenance`, `comms`). B21 — `exports`/`media` пробрасывают ошибку, пока
  BullMQ не исчерпал `attempts`, и только тогда пишут `failed`.
  Тесты: unit 260, e2e 285 (в т.ч. e2e на erase экспорта).

#### TASK-149 — `admin-consistency` · Админка через те же инварианты ✅

- **Зачем:** B10 — admin archive/delete/restore мутируют строку напрямую (без
  command/version/SSE/каскада): удаление колонки оставляет карточки вне колонок.
  B11 — `Card.attachmentCount` разъезжается. B16 — импорт: 5 с транзакция, N+1
  `user.findFirst`, частичный импорт.
- **Что:** admin-мутации через команды/`BoardWriteService` + события; счётчики
  вложений условно/с восстановлением; импорт: батч юзеров, явный timeout,
  атомарно или детерминированно.
- **DoD:** админ-удаление колонки не теряет карточки; счётчик вложений сходится;
  импорт атомарен/батчится; тесты.
- **Зависимости:** нет.
- **Выполнено (2026-10-29):** B10 — `setCardArchived`/`deleteCard` и
  `setDeletedAt`/`setArchived` для карточек и колонок (включая
  `bulkEntity("delete"|"restore")`) применяют `ARCHIVE_CARD`,
  `DELETE_CARD`, `RESTORE_CARD`, `DELETE_COLUMN`, `RESTORE_COLUMN` через
  `CommandsService.apply` от имени owner (`commandAsOwner`) — версия, SSE-кадр и
  каскад консистентны. `DELETE_CARD`/`DELETE_COLUMN` больше не удаляют
  `CardLabel`, поэтому `RESTORE_*` пересобирает `labelIds` и чек-листы из строк
  (снимок — `admin/admin-snapshots.ts`); остальные сущности пишутся под
  `BoardWriteService` с bump версии. B11 — `attachmentCount` пересчитывается
  (live, не inline) при админском delete/restore/erase и внутри `upsertCard`,
  так что verify-путь тоже не теряет бейдж. B16 — импорт всего конверта в одной
  транзакции с `timeout: 120 s` (ошибка не оставляет первые N−1 досок) и
  `createMany` для карточек/меток/чек-листов/пунктов. Тесты: e2e на каскад
  колонки и восстановление поддерева, бейдж вложений, атомный многодосочный
  импорт (unit 263, e2e 288).

#### TASK-150 — `ui-render-perf` · Больше не дёргать всю доску ✅

- **Зачем:** C4 — `MembersStore` глобальный: загрузка участников/любое membership
  перерисовывает все карточки (второй полный рендер). C6 — `MeasuringStrategy.Always`
  + пересчёт курсора на drag. C7 — `linkSignature` O(n log n) на каждый рендер.
  C8 — `CardDialog` подписан на весь board (ввод заголовка рендерит MDXEditor).
  C14 — focus-refetch диффит JSON.stringify по всем карточкам. C20 — анимация на
  каждой карточке без `prefers-reduced-motion`.
- **Что:** per-key подписки участников (и не подписываться без assignee/attribution);
  `WhileDragging`/`BeforeDragging`; memo `linkSignature`; локальный draft заголовка
  + memo-секции диалога; дифф по `version`/`updatedAt`; анимировать только новые
  карточки + `motion-reduce`.
- **DoD:** загрузка участников не перерисовывает все карточки; drag на 2400 без
  O(n)/frame; ввод не рендерит MDXEditor; focus-refetch без JSON.stringify; замер
  до/после.
- **Зависимости:** TASK-139 (виртуализация).
- **Выполнено (2026-10-29):** C4 — `MembersStore.set()` уведомляет только
  изменившиеся `board:user` ключи (и per-board ростер); неизменившиеся строки
  переиспользуют объект, поэтому `useBoardMember` даёт стабильный снапшот и
  reload директории не ререндерит карточки. C6 — droppable измеряется
  `WhileDragging`, dragging — `BeforeDragging` (вместо `Always` на каждый кадр).
  C7 — `linkSignature` кэшируется в `WeakMap` по снапшоту `board.cards` (O(1)
  на повторный рендер). C8 — заголовок в `CardDialog` держится локальным
  черновиком, стор получает один тихий `UPDATE_CARD` по blur/закрытию/смене
  карточки, а не на каждый символ — MDXEditor больше не ререндерится при
  наборе заголовка. C14 — focus-refetch сравнивает `updatedAt` (и наличие
  `archivedAt`) на карточку вместо `JSON.stringify` всей доски; колонки/метки
  остаются глубоким сравнением. C20 — входная анимация только у карточек,
  впервые появившихся в этой вкладке, плюс `animation: none` при
  `prefers-reduced-motion`. Тесты: `MembersStore` per-key notify, изоляция
  рендера при наборе заголовка (store не пишется до blur, затем ровно один
  рендер колонки и один flip undo). ui 876 зелёные.
- **Остаётся:** числовой Playwright-замер 2400 карточек — в объёме **TASK-139**
  (виртуализация); здесь доказательство через счётчики рендеров.

#### TASK-151 — `pwa-stream-recovery` · Деплой и обрывы не ломают открытую доску ✅

- **Зачем:** C5 — SW делает `skipWaiting`/`claim` и удаляет прошлый кэш → открытая
  вкладка ловит старый lazy-chunk, nginx отдаёт `index.html` (200) → SyntaxError,
  весь app падает. C12 — нет watchdog SSE: полуоткрытый поток не даёт reconnect.
  C13 — фатальный 404 стрима проглатывается (удалённая доска висит). C11 — один
  error boundary на всё. C9 — ссылки в новой вкладке теряют `APP_BASE`. C15 —
  «Restore backup» в server-режиме дублирует доски.
- **Что:** update-prompt / не claim'ить при живых старых клиентах / хранить прошлый
  кэш; boundary на BoardSection/CardDialog + retry для chunk-load; watchdog
  last-frame + reconnect на `online`; 404 → убрать доску; `cardHref` с `APP_BASE`;
  отключить/починить restore в server-режиме.
- **DoD:** деплой при открытой вкладке не роняет открытие карточки; half-open
  стрим переподключается; удалённая доска уходит; ссылки на `/app/`; restore не
  дублирует.
- **Зависимости:** нет.
- **Выполнено (2026-10-29):** C5 — `install` больше не делает безусловный
  `skipWaiting`: новый воркер ждёт, страница показывает баннер `UpdatePrompt`
  («доступна новая версия» → `SKIP_WAITING` → reload). `activate` удаляет только
  старые кэши, оставляя самый свежий прошлый; cache-first отдаёт статический
  ассет из прошлого кэша, если в текущем его нет — открытая старая вкладка после
  деплоя находит свой lazy-chunk, а не `index.html`. C12 — watchdog в
  `BoardRealtime`: 90 с без кадров (сервер шлёт keep-alive каждые 25 с) →
  `abort` и reconnect; порог переопределяем `stallMs` в тестах. C13 — фатальный
  `404` стрима теперь `onAccessRevoked` (доска уходит из списка, не висит).
  C11 — `ErrorBoundary compact` вокруг `CardDialog`: падение диалога не уносит
  всё приложение. C9 — `cardHref` строится через `appPath` (`/app/board/…`).
  C15 — restore бэкапа в server-режиме отключён с пояснением (он POST'ил бы
  копии как новые доски). Тесты: SW (ожидание update, fallback прошлого кэша,
  аккуратный activate), watchdog, parity i18n. ui 878 зелёные.

#### TASK-152 — `ui-a11y-polish` · Клавиатура, фокус, локали ✅

- **Зачем:** C16 — зоны вставки невидимы, но в tab-порядке (~2400 stop). C17 —
  каждая карточка `role="button"` с вложенными кнопками, j/k-курсор недоступен AT,
  dnd-kit объявления на английском в ru-UI. C18 — lightbox без focus-trap, `alt=""`,
  blob URL не revoke'атся. C19 — просрочка/«скоро» не обновляются по времени.
  Плюс: английский «Close», listbox/radio без стрелок, закрытие карточки стирает
  все query-параметры.
- **Что:** `tabIndex=-1`/focus-visible для зон; drag-handle/roving tabindex +
  локализованные dnd-announcements; Radix-диалог для lightbox (trap + revoke);
  тик due на visibility/focus; `t("common.close")`; стрелки в TimePicker/FilterBar;
  удалять только `card` из URL.
- **DoD:** keyboard-only проходит доску, нет невидимого фокуса; lightbox
  запирает фокус; «просрочено» обновляется; ru/en.
- **Зависимости:** нет.
- **Выполнено (2026-10-29):** C16 — кнопка-призрак зоны вставки получила
  `tabIndex={-1}`: полная доска больше не добавляет ~2400 остановок Tab.
  C17 — dnd-kit-обёртка карточки стала `role="group"` (вместо вложенной
  `button`; `aria-roledescription="sortable"` и клавиши сохранены), а
  `DndContext accessibility` отдаёт локализованные анонсы start/over/end/cancel
  и инструкцию; listbox времени — roving tabindex + стрелки/Home/End;
  radiogroup фильтров (due/created/label-match) — стрелки с перемещением фокуса.
  C18 — lightbox: focus-trap на кнопке закрытия, осмысленный `alt`, возврат
  фокуса открывшему, revoke blob-URL, созданного только для просмотра.
  C19 — `DueBadge` переклассифицируется раз в минуту и на `focus`/
  `visibilitychange`. Локали — `<span class="sr-only">Close</span>` больше не
  хардкод: `common.close` (en/ru). Закрытие карточки удаляет только `card` из
  query, прочие параметры сохраняются. Тесты: tab-order зоны, стрелки фильтра,
  тик срока, focus-trap/revoke/alt. ui 882 зелёные (один известный флейк
  CardComments под нагрузкой).

#### TASK-153 — `config-and-observability` · Конфиг БД, guard-кэш, логи ✅

- **Зачем:** B14 — `shared_buffers=16MB`, пул Prisma ~33/нода без `connection_limit`;
  B15 — `MaintenanceGuard` ходит в БД на каждый запрос до auth; low-находки:
  счётчики карточек включают архив/удалённые колонки, фид приглашений не фильтрует
  истёкшие, битые курсоры → 500, idempotency коммента без проверки автора, admin
  refresh без grace, нет `notifyDigest`, `CREATE INDEX` не CONCURRENTLY, нет
  slow-query/requestId.
- **Что:** `connection_limit` + настройки Postgres в self-host; кэш `OpsSettings`
  с инвалидацией; исправить перечисленные low-пункты; slow-query + `requestId` в
  логах; `CONCURRENTLY` в операционных миграциях.
- **DoD:** нет DB-запроса maintenance на каждый запрос; пул не выедает
  `max_connections`; low-пункты закрыты тестами; инцидент трассируется по id.
- **Зависимости:** нет.
- **Выполнено (2026-10-29):** B14 — `DB_CONNECTION_LIMIT` (по умолчанию 10)
  добавляется в DSN, если там нет `connection_limit`; compose задаёт
  `shared_buffers`/`work_mem`/`max_connections` через env. B15 — `OpsSettings`
  кэшируется на 15 с, `update()` инвалидирует; `MaintenanceGuard` больше не
  делает запрос на каждый запрос (unit: два чтения — один запрос). Low: счётчик
  карточек в `/boards` исключает архивные и карточки удалённых колонок; фид
  приглашений скрывает истёкшие (accept всё так же 409); `cursor=<t>:c:<nonce>`
  → 400, а не `BigInt` 500; повтор `commandId` коммента от другого автора → 409;
  admin refresh получил grace 60 с (повтор в окне — гонка, не угон); `notifyDigest`
  доступен в `PATCH /users/me` и чекбоксом в аккаунте. Наблюдаемость: middleware
  `X-Request-Id` (AsyncLocalStorage) + Prisma slow-query warn (`SLOW_QUERY_MS`,
  по умолчанию 200 мс) с id запроса. `CONCURRENTLY` для операционных индексов
  закрыт ещё в TASK-148 (`db:indexes`). Тесты: unit 271, e2e 290, ui 882.

#### TASK-155 — `upload-hardening` · Загрузки через временный файл, а не RAM ✅

- **Зачем:** B20 (остаток TASK-146). `multer` держит до `LIMITS.attachmentSize`
  (25 MB) **на запрос в памяти** (`memoryStorage` → `file.buffer`), затем
  `AttachmentsService` пишет буфер на диск. Пик RAM = число одновременных
  загрузок × 25 MB, а rate-limit считает штуки в минуту, не конкурентность: пачка
  параллельных загрузок на маленьком VPS — риск OOM. `.tmp-*`-дисциплина и sweep
  уже есть (B22, `storage.service.ts`) — их и надо задействовать.
- **Что:**
  1. `multer.diskStorage` в отдельный temp-каталог (`.tmp-*`); лимиты
     `files:1`/`fileSize` сохранить;
  2. `UploadedBlob` — путь вместо буфера; MIME определять по **первым байтам
     файла** (читать ограниченный префикс, не весь файл), сохраняя текущую политику
     allowlist/signature (TASK-76);
  3. перенос temp → `storage.attachmentPath` через `rename` **после** проверок;
     `rm(temp, { force: true })` в `finally` на любом отказе/ошибке;
  4. видео-транскод (`transcode`/`media`) получает путь, а не буфер;
  5. брошенные temp-файлы подчищает тот же sweep, что и `.tmp-*` (grace).
- **DoD:** при ~20 одновременных загрузках по 25 MB RSS API не растёт на ~500 MB
  (замер до/после в PR); после ошибок/отмен не остаётся `.tmp-*`; MIME/signature,
  публичная шара и транскод не сломаны; unit + e2e загрузок/деривативов зелёные.
- **Зависимости:** TASK-146 (лимиты, ✅), TASK-76 (MIME-sniff), B22 (`.tmp` sweep).
- **Выполнено (2026-10-29):** `attachments/upload-storage.ts` — multer
  `diskStorage` пишет тело запроса в `<blob root>/.tmp-<uuid><ext>` (каталог
  создаётся на месте; из клиентского имени остаётся только короткое безопасное
  расширение). `UploadedBlob` теперь несёт `path` вместо `buffer`; MIME
  определяется по префиксу 4 КБ (`readFilePrefix`), allowlist/signature
  (TASK-76) сохранены. Вложения и аватар делают `rename` в blob-tree **после**
  всех проверок и квот; `rm(temp, { force: true })` в `finally` на любом
  отказе/отмене (дополнительно временные файлы собирает `.tmp-*` sweep из
  TASK-148). Транскод/деривативы, как и раньше, ходят по id вложения. e2e
  загрузок, транскода, деривативов и публичной шары зелёные; после прогона
  `.tmp-*` в blob-root не остаётся.

> Порядок внедрения (рекомендация): **144 → 145/146 → 147 → 148 → 150/151 →
> 149/152/153**; **155** — после 146. Первые две — потери данных и целостность
> realtime (их видно пользователю), дальше безопасность и ресурсы, потом
> перф/полировка.

---

### 7.15. Ревью 2026-10-29 — правки по семи таскам (TASK-156)

> **Зачем.** После закрытия TASK-148…155 каждая таска ушла на отдельное
> read-only ревью (семь потоков, по одному на таску). Проверялись: корректность
> инвариантов, регрессии поведения, отказные пути, безопасность, память/локи и
> достаточность тестов. Ниже — единая задача на все правки: один PR/ветка,
> три волны по цене ошибки. Пункты, помеченные **[проверено]**, подтверждены
> чтением кода или целевым прогоном.

#### TASK-156 — `review-fixes` · Правки по итогам ревью ✅

- **Зачем:** ревью подтвердило, что заявленные в TASK-149/150/151/155 свойства
  местами не достигнуты (restore доски, «ввод не рендерит редактор», деплой
  старой вкладки, очистка финального блоба), а TASK-148/153 оставили
  неограниченные sweeps и неполные low-фиксы. Публичные контракты (REST/SSE,
  формат экспорта) не меняются, кроме уже добавленного `notifyDigest` и
  поведения снапшот-шары.

- **Выполнено (2026-10-29):** волны 1–2 закрыты одним коммитом на `main`.
  Доска восстанавливается целым поддеревом (дети с меткой операции,
  memberships сохранены, live-шары сняты и возвращены); `DELETE_CARD`/
  `DELETE_COLUMN` больше не перestamp-ят ранее удалённые чек-листы; snapshot
  несёт links/lastActorId/attachmentCount; `APP_BASE` идемпотентен,
  `cardHref` не удваивается; все вкладки перезагружаются по
  `controllerchange`, а 200-HTML на `/assets/*` не кэшируется; финальный блоб
  удаляется при отказе после `rename`; draft заголовка пересинкивается и не
  затирает чужой rename; purge доски идёт страницами; стрелки минут не
  подтверждают время; sweep-коды индексированы и чанкированы (как activity/
  audit/commands/exports), invalid index от `CONCURRENTLY` чинится скриптом;
  bulk restore сортируется, аудит per-action с `failed`; внутренние
  `RESTORE_*` не упираются в `MAX_COMMAND_BYTES`; импорт чанкуется и дедупит
  метки, P2028 → 503; закрыты a11y/dnd/lightbox/DueBadge-замечания; snapshot-
  шары переживают purge (nullable `BoardShare.boardId`, `SET NULL`); кэш
  ops-settings защищён generation-guard, курсоры ограничены; общий
  `wipeAll()` для e2e. Гейты: unit 306, e2e 301, ui 908, shared 431, lint 0
  errors, format/build backend/ui/site/size зелёные.
- **После независимого ревью (`openrouter/z-ai/glm-5.3`, 2026-10-30):**
  закрыты его замечания — purge доски удаляет `Activity`/`Command`
  страницами (не одним batch), revoked live-шары живут до конца окна
  восстановления доски, subtree-restore отказывает живой доске (409) без
  bump версии, bulk возвращает `failed` и пишет отдельный audit на каждый
  отказ, assignee вне активных участников снимается при restore,
  `priority`/`since`/внутренний oversize-кап валидируются, `DELETE_CHECKLIST`
  и `DELETE_LABEL` не трогают записи ранее удалённых карточек, PWA
  переподключает SSE после транзиентного 404/410, SW отвергает HTML без
  Content-Type и отравленный прошлый кэш, баннер обновления не воскресает
  после dismiss. Независимый ревьювер **не запускал тесты** (общая БД);
  полные гейты прогнаны здесь.

##### Волна 1 — блокеры (чинить до всего остального)

1. **[проверено] 149 / high — restore доски пустой и без участников.**
   `admin.service.ts:2246–2253` + `boards.service.ts:203–258`: админский
   «delete» каскадит `deletedAt` на детей и **hard-deletes `BoardMember`**, а
   «restore» только снимает флаг с `Board`. Итог: доска возвращается пустой,
   без владельца и не видна в `listBoards`. Фикс: либо полноценный
   subtree-restore (memberships/владелец + clean children), либо не каскадить
   membership на пути админского soft-delete. e2e: delete→restore заполненной
   доски.

2. **[проверено] 149 / high — удаление перestamp-ит ранее удалённые чек-листы.**
   `command-writers.ts:511–527, 644–660` обновляют `deletedAt` у **всех**
   чек-листов/пунктов карточки, включая удалённые ранее; `sameOp()` в
   `admin-snapshots.ts:64–76` принимает их за часть текущей операции → restore
   воскрешает удалённое. Фикс: писать только `deletedAt: null`. Тесты:
   «удалить пункт/чек-лист → удалить карточку/колонку → restore: остаётся
   удалённым».

3. **[проверено] 149 / high — snapshot ≠ reducer после restore.**
   `admin-snapshots.ts:12–17, 89–106`: снимок не содержит `links`,
   `lastActorId`, `attachmentCount`, а `upsertCard`/`cardUpdateData`
   (`command-writers.ts:224–242`) не пишут links и attachmentCount из payload.
   Агрегат после restore содержит links и бейдж, `boardReducer` — нет; это
   расхождение командного контракта. Фикс: включить live-links по
   `position`, `lastActorId` и точный `attachmentCount` в snapshot и
   использовать их в writer (или задокументированный repair). Контрактный
   тест: admin-snapshot → `boardReducer` == aggregate.

4. **[проверено] 151 / high — двойной `APP_BASE` (`/app/app/board/…`).**
   `card-nav.ts:29` возвращает `/app/board/…`, но
   `CardContextMenu.tsx:178,345` пропускает его через `appShareUrl()`, которая
   снова добавляет `APP_BASE` (`app-path.ts:13–19`). Ломает «Copy link» и
   «Open in new tab» на self-host. Фикс: добавить router-relative
   `cardPath()` и строить `appShareUrl(cardPath(...))`; `cardHref()` оставить
   только для `data-card-href`/`window.open`; сделать `appPath`
   идемпотентным (`startsWith(APP_BASE)`). Тест с `BASE_URL="/app/"`.

5. **[проверено] 151 / high — обновление одной вкладки захватывает все.**
   `sw.js:127` делает `clients.claim()` на `activate`, а
   `applyServiceWorkerUpdate` (`register-sw.ts:47–54`) сразу перезагружает
   только текущую вкладку. Остальные вкладки продолжают старый бандл без
   `controllerchange`-релоада → тот же SyntaxError. Фикс: слушать
   `controllerchange` во всех клиентах с one-shot guard, либо не
   `claim()`-ить при обновлении (только при первой установке).

6. **[проверено] 151 / high — fallback не спасает никогда не кэшированный chunk.**
   Старая вкладка просит `assets/editor-OLD.js`; его нет ни в текущем, ни в
   прошлом кэше (lazy chunk не открывали до деплоя) → SPA-fallback отдаёт
   `index.html` (200), код кэширует его как JS (`sw.js:195–198`) → падение.
   Фикс: для `/assets/*` принимать только `response.ok` **и** не-`text/html`
   (`Content-Type`), иначе 503/без кэша; в приложении ловить ошибки dynamic
   import и показывать баннер обновления. Тест: 200 HTML на `.js` не кэшируется.

7. **[проверено] 155 / high — финальный блоб остаётся при ошибке после `rename`.**
   `attachments.service.ts:164` переносит temp в blob-tree, затем
   `flags.isEnabled` (`:171`) и `boardWrite.run` (`:186`) могут бросить (реальный
   триггер — проигранная гонка квоты `:192–200`). `finally` (`:89`) удаляет
   только старый temp-путь, поэтому до ~25 MB × N остаются до orphan sweep.
   То же у аватара (`users.service.ts:116–118`). Фикс: `storedPath` +
   `committed`; в `finally` при `moved && !committed` — `storage.remove(storedPath)`.

8. **[проверено] 150 / high — draft заголовка не ресинкается.**
   `CardDialog.tsx:429–442, 449–453`: ресид только по
   `[cardId, open, board?.id]`, поэтому чужой rename/undo/RESTORE_BOARD не
   обновляет поле, а blur/flush безусловно пишет локальный текст поверх чужого.
   После отклонённого `UPDATE_CARD` draft также не откатывается. Фикс: сверять
   с `updatedAt`/сфокусированностью и dirty-состоянием, путь конфликта как у
   описания (уведомление + «Reload»/«Keep mine»), ресид при ошибке записи.

9. **[проверено] 148 / high — purge доски не ограничен чанком.**
   `maintenance.service.ts:255–317`: чанк по доскам (≤500), но затем
   `card.findMany`/`attachment.findMany` **без `take`** и один `$transaction`
   на всё поддерево. Большая доска даёт огромные `in`-массивы (лимит
   bind-параметров), долгий лок и повторный выбор в следующих чанках. Фикс:
   удалять карточки/детей пачками по `PURGE_CHUNK` (переиспользовать
   `purgeChunks` по card id), либо чанковать внутри доски.

10. **[проверено] 152 / high — стрелки в минутах закрывают пикер.**
    `TimePicker.tsx:81–95` вызывает `onSelect` для обеих колонок, а
    `onSelect` минут вызывает `onConfirm()` (`:214–217`) → `setTimeOpen(false)`
    в `CardDueDate.tsx:85`. Фикс: стрелки только меняют значение/фокус;
    подтверждение — Enter, click или blur.

##### Волна 2 — средние

11. **148 / medium — снапшот-шары не должны умирать с доской.**
    `maintenance.service.ts:306–308` удаляет все `BoardShare`, хотя `schema.prisma`
    и `share.service.ts` гарантируют, что `mode: "snapshot"` переживает удаление
    источника. Нужно решение: nullable `BoardShare.boardId` + `onDelete: SetNull`
    (или отдельная таблица снапшотов), при purge доски удалять только `live`.
12. **148 / medium — `sweep-codes` без индексов.** `EmailVerificationCode`/
    `EmailChangeCode` имеют только `@@index([userId])`; добавить
    `expiresAt`/`consumedAt` в схему, миграцию и `db:indexes.cjs`.
13. **148 / medium — `IF NOT EXISTS` не чинит invalid index.** Прерванный
    `CREATE INDEX CONCURRENTLY` оставляет `indisvalid = false`; скрипт и
    миграция считают индекс существующим. Фикс: проверять `pg_index.indisvalid`
    и `DROP INDEX CONCURRENTLY` + повтор, либо падать с понятной ошибкой.
14. **148 / medium — прочие sweeps без чанков.** `sweepExports` грузит все
    строки и удаляет файлы последовательно; `sweepActivity`/`sweepAudit`/
    `sweepCommands` — один `deleteMany`; `sweepOrphanBlobs` грузит все вложения.
    Применить `purgeChunks`/пагинацию.
15. **149 / medium — bulk restore зависит от порядка.** `bulkEntity`
    (`admin.service.ts:2216–2234`) переигрывает сохранённые `position` по одному
    в порядке id; `[C,B,A]` даёт `[A,C,B]`. Фикс: сортировать restore по
    `(boardId, columnId, position)` / `column.position` до применения.
16. **149 / medium — bulk частичный и без аудита при сбое.** Один id = одна
    транзакция; падение посередине оставляет часть изменений без
    `entity.bulk_deleted` (и имя действия неверно для restore/archive).
    Фикс: audit на каждый элемент / in `finally`, action-specific имя, вернуть
    частичный результат.
17. **149 / medium — `RESTORE_COLUMN` упирается в `MAX_COMMAND_BYTES` (2 MiB).**
    `admin-snapshots.ts:169` пакует все карточки колонки в один action; 200
    карточек с большими описаниями → 413 и «не восстановить». Фикс: поднять
    лимит для внутренних restore или восстанавливать чанками
    (`RESTORE_COLUMN` → `RESTORE_COLUMN_CARDS`/по карточке).
18. **149 / medium — import `createMany` без чанков и дедупа.** Один
    `createMany` на сущность может превысить 65 535 bind-параметров; дубли в
    `labelIds` бьют composite PK `CardLabel`. Фикс: `createMany` пачками
    (≈1 000) и дедуп `labelIds`.
19. **149 / low — timeout импорта → 500.** `boards.service.ts:518–533` не
    маппит `isTransactionTimeout` (P2028) в `503`.
20. **149 / low — snapshot может нести удалённую метку/битую обложку.**
    `admin-snapshots.ts:79–87, 100`: фильтровать live-метки доски; неизвестные
    `cover` игнорировать, а не кастовать вслепую.
21. **149 / low — архивные карточки в удалённой колонке мешают purge.**
    `DELETE_COLUMN` оставляет их с `columnId` на soft-deleted колонку; sweep
    колонки ждёт `cards: none` → колонка не чистится. Решить явно (переносить
    в orphan/помечать) и покрыть тестом.
22. **150 / medium — заявленный выигрыш C8 не достигнут.** `DescriptionEditor` —
    un-memoized `forwardRef`, рендерится inline (`CardDialog.tsx:694–763`);
    `setTitleDraft` на каждый символ ререндерит диалог. Нужно memo/split
    редактора со стабильным `onChange` и render-probe в тесте.
23. **150 / medium — мёртвый ключ `dragging: { strategy: BeforeDragging }`.**
    В `MeasuringConfiguration` есть только `draggable`/`droppable`/`dragOverlay`;
    `MEASURING` передан переменной, поэтому excess-property check не сработал.
    Удалить ключ или использовать `dragOverlay`.
24. **150 / low–medium — focus-diff пропускает label-only изменения.**
    `DELETE_LABEL`/`RESTORE_LABEL` меняют `card.labelIds` без bump
    `updatedAt`; fast path в `board-diff.ts` перестаёт помечать undo dead.
    Добавить дешёвое сравнение `labelIds` (или версии в агрегате).
25. **150 / low — `MembersStore` шумит на no-op reload.** `set()` всегда
    уведомляет board-роутер и глобальный version, хотя `touchedUsers` пуст;
    `useBoardMembersList` использует глобальный `getVersion`. Пропускать
    уведомления при пустом `touchedUsers`, завести per-board snapshot.
26. **150 / low — двойной `TOUCH_CARD` за сессию.** `flushTitle` вызывает
    `touchCard` напрямую и не чистит `touchTimerRef`; продублировать через
    `scheduleTouch`/взаимный сброс таймеров.
27. **151 / medium — keep-selection не гарантирует кэш прошлого активного деплоя.**
    `stale.slice(-1)` полагается на порядок `caches.keys()`; кэш
    неактивированного воркера может вытеснить нужный. Хранить последний
    активированный `CACHE_VERSION` в метаданных или не удалять кэши, пока есть
    живые клиенты.
28. **151 / medium — прошлый кэш пиннит не-hashed файлы.** `matchShellAsset`
    применяется и к `manifest`/icons → при онлайне отдаётся старый манифест.
    Fallback только для `/assets/`; остальное network-first.
29. **151 / medium — баннер обновления одноразовый.** `CustomEvent` может
    уйти до подписки; `registration.installing` не проверяется; нет
    `registration.update()`/поллинга. Проверять `installing`/`waiting` на
    mount, слушать `statechange`, обновлять на focus/visibility.
30. **151 / medium — compact boundary не сбрасывается.** После падения
    `CardDialog` fallback висит для всех следующих карточек. `key={openCardId}`,
    закрытие из fallback, опционально `resetKeys`.
31. **151 / medium — 404 трактуется как перманентное удаление.** `onAccessRevoked`
    удаляет доску из хранилища и тостит «нет доступа»; транзиентный 404 от
    прокси/неполного деплоя теряет запись. Перечитывать список и удалять только
    при реальном отсутствии; отдельный текст «доска удалена». Обработать 410.
32. **152 / medium — `role="group"` без имени.** dnd-обёртка карточки
    фокусируема и ведёт себя как контрол, но не имеет accessible name; на
    drag эмитится `aria-pressed`, невалидный для group. Добавить
    `aria-label={card.title}`, не эмитить `aria-pressed`; в идеале — отдельный
    drag-handle.
33. **152 / medium — хедер колонки остался `role="button"` вокруг меню.**
    `ColumnView.tsx:254–261`; применить тот же фикс/handle.
34. **152 / medium — у радио нет roving tabindex.** `FilterBar.tsx:171–187`:
    все `role="radio"` остаются в tab-порядке. `tabIndex={selected?0:-1}` и
    тест на tab-порядок. Стрелки на «On date» не должны кликать календарь
    (`:166–167, 551–559`).
35. **152 / low–medium — `DueBadge` плодит таймеры.** Один `setInterval` + два
    слушателя на каждый бейдж (2400 карточек → тысячи таймеров). Общий тикер
    через провайдер/модуль; тест на focus/visibility и cleanup.
36. **152 / low — восстановление фокуса в detached узел.** Проверять
    `isConnected` перед `focus()`; не терять свежий blob, если overlay уже
    открыт (`openImageLightbox` рано выходит).
37. **153 / medium — истёкшее приглашение блокирует реинвайт.**
    `boards.service.ts:326–330` возвращает 201-no-op, не проверяя `expiresAt`,
    а фид его уже скрывает → реинвайт «молча ничего» до sweep. В транзакции
    обновлять `role`/`expiresAt`/`invitedById` (или delete+create).
38. **153 / medium — admin concurrent refresh всё ещё revoke-all.**
    `admin-auth.service.ts:205–211`: при `rotated.count === 0` нужно логировать
    гонку и отдавать 401 **без** `revokeAllSessions` (как user-контур
    `auth.service.ts:218–222`).
39. **153 / medium — `SLOW_QUERY_MS=0` инвертирован.** `prisma.service.ts:45,54`:
    `duration >= 0` → логируется всё; плюс `log`-события включены всегда.
    Проверять `> 0` и не включать event-лог при 0.
40. **153 / low — P2002-путь коммента не сверяет автора.**
    `comments.service.ts:112–125`: добавить `existing.authorId === authorId` в
    catch, иначе вернуть 409.
41. **153 / low — `notifyDigest: null` → Prisma 500.** `IsOptional` пропускает
    `null`; писать только `typeof === "boolean"` (или `ValidateIf`).
42. **153 / low — cache может затереться in-flight чтением.**
    `ops-settings.service.ts:32–39`: сид из результата `upsert` или generation
    guard перед записью устаревшего чтения.
43. **153 / low — курсоры всё ещё 500 на границах.** Ограничить `at` ≤
    `8.64e15`, seq ≤ `9223372036854775807` (19 цифр), иначе 400.
44. **153 / low — `X-Request-Id` спуффится и почти не трассируется.** Либо
    минтить всегда/доверять только trusted proxy, либо добавить
    exception/access-лог с id. `observability.service.ts:219–225` должен читать
    через кэш `OpsSettingsService`.
45. **153 / low — неполные e2e-wipe.** `admin`, `admin-queues`,
    `admin-email-settings` чистят `user` без FK-графа → suite остаётся
    order-dependent. Завести общий `wipeAll()`.

##### Волна 3 — мелочи, тесты и доки

46. `MAINTENANCE_JOBS` дублируется в `ops/maintenance.service.ts` и
    `admin/dto/admin-v3.dto.ts` — импортировать один список.
47. В `backend/.env.example` нет `AUDIT_RETENTION_DAYS`, `DB_CONNECTION_LIMIT`,
    `SLOW_QUERY_MS`, `POSTGRES_*`; в README нет `POSTGRES_WORK_MEM`/
    `POSTGRES_MAX_CONNECTIONS`.
48. `DB_CONNECTION_LIMIT` принимает нецелые/отрицательные значения —
    валидировать (0 — документированный «как у Prisma»).
49. Тесты: `.tmp`/финальный блоб после 400/413/отмены/квоты; SW «200 HTML на
    `.js` не кэшируется»; `cardHref` с `/app/`; announcements en/ru;
    `RESTORE_*` контракт (snapshot→reducer==aggregate); board delete→restore;
    bulk restore в обратном порядке; label-only focus-diff; `linkSignature`
    (инвалидация по новому снапшоту); `DueBadge` focus/visibility + cleanup;
    server-mode BackupDialog.
50. Замер RSS для 155 (~20 × 25 MB) и запись в `docs/PERF-BASELINE.md`.

- **DoD:** все пункты волн 1–2 закрыты; полные гейты (unit, e2e, ui, shared,
  lint, format, build backend/ui/site, size) зелёные; новые тесты из волны 3
  покрывают каждый блокер; публичный REST/SSE-контракт не сломан; экспорт/
  импорт и публичная шара по-прежнему работают; после отказных сценариев в
  blob-root нет ни `.tmp-*`, ни новых осиротевших блобов.
- **Зависимости:** TASK-148…155 (✅ на `main`), TASK-139 для перф-замеров UI.
- **Порядок:** волна 1 → полные гейты → волна 2 → волна 3 → один PR.

---

### 7.16. Производительность MCP (TASK-154)

> **Зачем.** Замеры §7.13 и `docs/PERF-BASELINE.md` сняты **напрямую по HTTP/SSE**
> — это правильно для ёмкости сервера. Но агенты работают не так: они ходят через
> MCP-сервер (`stdio` JSON-RPC → `fetch` → API). Этот путь добавляет то, чего нет в
> прямом замере: один **последовательный** `stdio`-поток (нет параллелизма вызовов —
> узкое место переезжает в MCP-процесс, а не в API), **read-modify-write** в
> `commandOnFreshBoard` (`GET /boards/:id` + `POST /commands`, до 3 перестройств на
> `409 version`), ретраи с backoff, генерацию idempotency-ключей, Zod-валидацию схем
> и рендер markdown. Нужно понять реальный потолок «агентской» работы и найти, что
> оптимизировать, — иначе улучшать наугад.
>
> **Замечание.** Ёмкость самого API MCP не меняет (MCP — ещё один клиент того же
> `POST /commands`); меняется **стоимость действия агента** (латентность и число
> запросов к API). Поэтому мерить надо отдельно, как метрику задачи агента.

#### TASK-154 — `mcp-perf-bench` · Замер и оптимизация пути через MCP ✅

- **Зачем:** неизвестно, где узкое место у агентского пути: в MCP-процессе
  (валидация/рендер/`stdio`), в лишних round-trip'ах (`GET`+`POST` на действие),
  или в самом API. Без цифр «напрямую vs MCP» оптимизировать нельзя.
- **Что:**
  1. бенч `mcp-vs-api`: одна и та же последовательность операций (создать карточку
     → приоритет → move → комментарий) напрямую через HTTP и через MCP-клиент
     (`@modelcontextprotocol/sdk`, `StdioClientTransport`); мерить латентность на
     шаг, **суммарное число запросов к API**, CPU/память MCP-процесса;
  2. профиль MCP-сервера (CPU/аллокации) на длинной серии вызовов — найти горячие
     точки (валидация схем, рендер markdown, сериализация JSON, ретраи);
  3. по результатам — точечные улучшения, если подтвердятся: keep-alive
     `fetch`/переиспользование соединения; меньше read-modify-write там, где это
     безопасно; ленивый рендер markdown при `response_format: "json"`; опциональный
     батч-тул для роя агентов (несколько команд одним вызовом);
  4. отдельный раздел «MCP» в `docs/PERF-BASELINE.md` с цифрами и матрицей
     перепроверки.
- **Трогаем:** новый `~/.janosik-dev/load/mcp-vs-api.mjs` (клиент MCP), при
  оптимизациях — `mcp/src/client.ts`, `mcp/src/render.ts`, `mcp/src/format.ts`,
  тулы; `docs/PERF-BASELINE.md`.
- **DoD:** воспроизводимый бенч и цифры «напрямую vs MCP» (латентность на шаг,
  запросы к API, CPU MCP); явный вердикт «что оптимизировать»; реализованные
  улучшения (если подтвердятся) без функциональных регрессий; MCP
  `test`/`typecheck`/`lint` зелёные; результат записан в `docs/PERF-BASELINE.md`.
- **Зависимости:** нет; логично делать после §7.14 (144/145), но не блокирует.

---

### 7.17. Агент-реди борда (A2A): контракт задачи и координация роя (TASK-157)

> **Зачем.** Janosik — рабочая среда для роя ИИ-агентов (MCP + скилл `janosik`),
> но модель карточки до сих пор спроектирована под человека. Описание урезано до
> 10к — это наследие localStorage-бюджета 5 МБ офлайн-режима (`persistence.ts`),
> который в серверном режиме уже неактуален (`BoardContext.tsx:708` пишет в
> localStorage только вне server mode). Задача — это проза, которую каждый агент
> перепарсивает заново. Координации нет вовсе: `assignee` совещательный, два агента
> берут одну карточку и пишут поверх друг друга. Чтобы рой работал параллельно и
> без гонок, нужны три вещи: **вместительное описание**, **машинно-читаемый
> контракт задачи** и **атомарный захват карточки**. Стейл-ссылки на «2000» в
> `ROADMAP.md:1036` и `AGENT.md:465` (по факту `LIMITS.comment` = 10к) — побочный
> симптом того же разъезда.
>
> **Замечание.** Это не про «+символы». 64к описания × 2 байта (кириллица) ≈ 128 КБ
> — в 15× меньше лимита одной команды (`MAX_COMMAND_BYTES` = 2 МБ). Узкое место
> роя — координация и объём чтения, а не запись.

#### TASK-157 — `agent-ready-board` · Описание 64к + конвенции + контракт + координация ✅

- **Зачем:** снять лимит описания, дать агентам машинно-читаемый контракт задачи и
  убрать гонки за карточку — чтобы рой агентов работал на борде параллельно и
  оставлял проверяемый след.

- **Что:**
  **A. Описание 64к (одна константа).** `LIMITS.description` 10к → 64к. Все слои
  читают константу: UI-`maxLength` + клэмп + тост, редьюсер (`board-reducer.ts`),
  `validate` (action + restore), `migrate`, MCP-zod, бэкенд через валидацию команд.
  Обновить тесты (`board-reducer.test`, `migrate.test`, `validate.test`,
  `DataSafetyBanner.test`) и `SNAPSHOT_MAX` (= `LIMITS.description`); обоснование —
  в комментарии константы.
  **B. Слой 0 — конвенции (без схемы, работает уже сегодня).**
  1. Фикс стейл-доков: `ROADMAP.md:1036`, `AGENT.md:465` — «2000» → актуальный
     `LIMITS.comment`.
  2. «Agent-ready карточка» — зарезервированный формат описания: `## Why`,
     `## Scope`, `## Acceptance criteria` (чек-боксы), `## Out of scope`,
     `## Verify` (точная команда).
  3. Чек-лист с фиксированным заголовком `Definition of Done` — «прошло» = все
     пункты отмечены.
  4. Типизированные комментарии префиксом: `[status] [question] [blocker]
     [evidence] [handoff]`; `[handoff]` — обязательный короткий summary при
     передаче (следующий агент читает его + description, а не весь тред).
  5. Зарезервированные метки состояния: `agent:blocked`, `agent:needs-human`,
     `agent:verified` — статус роя видно одним фильтром.
  **C. Слой 1 — схема + команды (главный выигрыш).**
  6. Атомарный захват с лизингом: `CLAIM_CARD {cardId, leaseMs}` → поля `claimedBy`/
     `leaseUntil`, авто-истечение, отказ если держит живая лизия — убирает гонки роя.
  7. Контракт как данные: `acceptanceCriteria: string[]` + `definitionOfDone: string[]`
     (или единый `taskSpec`) — агент читает машинно, без парсинга markdown.
  8. `actorType: "human" | "agent"` + отдельный API-токен на каждого агента (токены
     уже есть) — реальная атрибуция в ленте; скоупы токена (доска, read/write) и
     rate-limit на токен.
  **D. Слой 2 — надёжность.**
  9. CAS на все мутации (`expectedVersion`/ETag): сейчас только `expectedDescription`
     у `update_card` — идемпотентные ретраи без затирания чужой правки.
  10. `kind` комментария в схеме (`note|status|question|blocker|evidence|handoff`)
      вместо префикса — фильтр «только блокеры/вопросы».
  11. Поиск по комментариям и пунктам чек-листов (сейчас только title/description).
  12. DoD-гейт на Done: сервер/MCP отказывает `move → Done`, пока в `Definition of
      Done` есть непунктирнутые пункты или нет `[evidence]`-коммента (анти-«зелёный
      забор из вранья»).
  **E. Слой 3 — гигиена.**
  13. `checklistItem` 200 → 500 (агенты кладут туда под-промпты); soft-кап/архивация
      тредов; WIP- и rate-limit учитывают агентов.
  14. Idempotent-создание: клиентские id для карточек/пунктов/комментариев, чтобы
      ретрай не плодил дубликаты (команды уже идемпотентны по `commandId`).
  15. «Ready to work» — запрос: unblocked + unassigned + Backlog, по приоритету —
      откуда агенты берут работу.
  16. Read-projection / summary для чтения доски: `fields=`/краткий режим в
      `get_board`/`search_cards`, чтобы 64к-описания не раздували ответ. **Следствие
      A — делать вместе с ним**, иначе рост лимита ломает bulk-чтение.
  17. Сигнал «есть работа»: SSE/вебхук при входе карточки в Backlog — чтобы
      простаивающие агенты не поллили.
  **F. Документация и сайт (после реализации).**
  18. Доки en+ru: `docs/mcp.md` — agent-ready формат, `Definition of Done`,
      типизированные комменты, `CLAIM_CARD`, `taskSpec`/`acceptanceCriteria`,
      per-agent токены и скоупы, «Ready to work»; `docs/user-guide/cards.md` —
      новый лимит описания 64к и разделы контракта; `docs/api/commands.md` —
      `CLAIM_CARD` и новые поля; `docs/api/rest.md`/`index.md` — лимиты и поиск
      по комментам; `docs/changelog.md` — запись. Плюс `AGENT.md` и скилл
      `janosik/SKILL.md` + `references/`.
  19. Сайт: фича-строка «для ИИ-агентов / MCP» на лендинге (`HomePage.astro` +
      `ui.ts` en/ru) и, если меняется вид карточки, — переснять затронутые
      скрины/клипы (§7.12 пайплайн).

- **Трогаем:** `shared/src/types/kanban.ts` (`LIMITS`, `Card`), `shared/src/store/
  {validate,board-reducer,migrate}.ts`, `backend/prisma/schema.prisma` (+миграция),
  `backend/src/commands/{command-writers,command-details}.ts`,
  `backend/src/activity/*`, `mcp/src/tools/{cards,comments}.ts`, `mcp/src/render.ts`,
  `mcp/src/client.ts`, `ui/src/components/editor/DescriptionEditor.tsx`,
  `ui/src/components/board/CardDialog.tsx`, `ui/src/utils/persistence.ts`,
  `site/src/content/docs/{docs,ru/docs}/{mcp,user-guide/cards,api/commands,api/rest,api/index,changelog}.md`,
  `site/src/components/pages/HomePage.astro`, `site/src/i18n/ui.ts`, скилл
  `janosik/SKILL.md` + `references/`, `AGENT.md`, `ROADMAP.md`.

- **DoD:** `LIMITS.description = 64000`, все шесть слоёв обновлены; конвенции
  зафиксированы в `AGENT.md` и скилле; `CLAIM_CARD` с лизингом (тесты на гонку и
  истечение); `acceptanceCriteria`/`definitionOfDone` (или `taskSpec`); `actorType`
  + скоупы токенов; CAS на всех мутирующих тулзах; поиск по комментам/чек-листам;
  DoD-гейт на Done; read-projection; гейты `ui`/`backend`/`shared`/`mcp`
  (test/typecheck/lint/build) зелёные; `prisma migrate dev` применяется чисто;
  строки UI — en+ru; доки en+ru (`mcp`, `cards`, `commands`, `rest`, `changelog`)
  и сайт обновлены (лендинг + доки), затронутые скрины/клипы пересняты; §1.1 и
  §1.2 обновлены.

- **Зависимости:** TASK-154 (`mcp-perf-bench` — батч-тул роя, §7.16); логично после
  §7.14. **Порядок:** A+B → C → D → E (каждый слой — отдельный PR; A+B можно
  отдельным PR сразу).

---

### 7.18. Хвосты из ревизии статуса (TASK-158…159)

> **Откуда.** Ревизия статусов 2026-10-31 (проверка таблицы §7.7 против кода)
> нашла два пункта, которые были помечены словами «НЕ ЗАБЫТЬ»/«не покрыто», но
> **не заведены задачей** — значит не попадут ни в одну итерацию. Заводим явно.

#### TASK-158 — `admin-master-allowlist` · IP-allowlist для других мастеров ✅

**Выполнено:** владелец открывает «Доступ по IP» в меню мастера и задаёт
адреса или диапазоны; проверка и нормализация общие с собственными настройками.
Оператор видит собственный список в Security без права изменения. Новые
эндпоинты доступны только OWNER, собственный IP нельзя исключить; изменение
пишется в аудит. При входе с запрещённого IP показывается понятное сообщение.
Документация обновлена на английском и русском.

- **Зачем:** §7.10 (addendum к TASK-65). Сейчас `AdminUser.ipAllowlist`
  (CSV IP/CIDR, `null` = без ограничений) — **self-service**: `PUT /admin/security`
  действует на `@CurrentAdmin()` (`admin.controller.ts`), правит только свою
  строку, и только OWNER (`security.service.ts`). Нет способа из панели **Masters**
  задать/посмотреть allowlist **другому мастеру** — а именно это нужно, чтобы
  «пускать оператора только с этих адресов».
- **Что:** эндпоинт OWNER-only для чтения/записи allowlist конкретного мастера
  (`GET`/`PUT /admin/masters/:id/allowlist`), та же валидация `invalidAllowlistEntries`
  и нормализация, аудит `security.ip_allowlist_changed` с `target=admin:<id>`;
  поле в UI на странице Masters (редактор у оператора, read-only для OPERATOR).
  Гвард: нельзя сузить allowlist **собственного** входа мимо проверки caller-IP
  (уже есть в `SecurityService.update`).
- **Трогаем:** `backend/src/admin/admin.controller.ts`, `security.service.ts`,
  `dto/admin-v3.dto.ts`, `ui/src/components/admin/*` (страница Masters), `locales/*`.
- **DoD:** OWNER задаёт allowlist оператору из панели; адрес вне списка получает
  отказ на входе и на каждом запросе; изменение списка — в аудите; en+ru; тесты.
  Журналирование отказов обычных запросов и расширение ленты — TASK-161 (§7.20).
- **Зависимости:** TASK-65 (сделано).

#### TASK-159 — `admin-ui-tests` · Тесты админ-страниц Ops/Comms/Observability/Security

- **Зачем:** §7.7 (примечание к TASK-59…65). Страницы Ops/Comms/Security добавлены **без отдельного ui-набора**;
  для Observability есть частичные тесты `ObservabilityPage.test.tsx`, но полного
  покрытия критериев задачи нет — логика покрыта backend
  e2e/unit, но регресс в самих страницах (fake-admin-server, формы, i18n) не
  ловится.
- **Что:** тесты на страницы Ops (флаги/maintenance/retention/purge), Comms
  (рассылка/объявления/шаблоны), Observability (version/deploy, размер БД, джобы,
  health), Security (2FA/IP-allowlist/алерты) — на fake-admin-server, как у
  `TrafficSettingsPage`/`DemoPage`/`SharesPage`.
- **Трогаем:** `ui/src/components/admin/*.test.tsx` (новые), fake-admin-server.
- **DoD:** страницы покрыты тестами (рендер, ключевые действия, ошибки API, en/ru);
  гейты `ui` зелёные.
- **Зависимости:** TASK-59…65 (сделано).

---

### 7.19. Запись одной доски под рой агентов (TASK-160)

> **Откуда.** Цель продукта — рой агентов на одной доске. Замер
> `docs/PERF-ONE-BOARD.md` (2026-11-01): запись одной доски держит **~42 команд/с
> независимо от числа писателей**, а стоимость одной команды — **24 ms**, из
> которых **advisory-lock 0.7 ms (3 %)**, `loadBoardAggregate` (загрузка всей
> доски) **8 ms (33 %)** и `preChecks` **7 ms (29 %)**. Значит потолок — не
> board-wide лок, а работа внутри сериализованной транзакции; рычаг — **батч
> команд**. См. §7.13 «Отложено».

#### TASK-160 — `board-command-batching` · Батч команд одной доски ✅

- **Зачем:** §7.13 (отложенный «батчинг команд одной доски»), замер
  `docs/PERF-ONE-BOARD.md`. Агентский шаг (create + description + priority +
  assignee + due) — это **5 отдельных транзакций**, каждая грузит всю доску; при
  100 агентах это 5× цена за одну логическую операцию.
- **Что (как сделано):** новый эндпоинт `POST /boards/:id/commands/batch`
  принимает `{ commands: [...] }` (≤ `COMMAND_BATCH_MAX = 100`); сервер применяет
  их в **одной** транзакции — один захват advisory-lock, один `loadBoardAggregate`,
  одна проверка чужих id на всю пачку — против «бегущего» агрегата в памяти.
  Каждая команда по-прежнему пишет свою `Command`-строку (`seq`,
  `commandId`-идемпотентность, атрибуция, undo, SSE), пачка атомарна. Одиночный
  `POST /boards/:id/commands` **не менялся** — `apply` стал тонкой обёрткой над
  `applyBatch` из одной команды (один путь → нет дрейфа). MCP: `commandBatch` +
  `create_card` шлёт `ADD_CARD` и поля одним батчем.
- **Трогаем:** `shared/src/api.ts` (контракт батча + `COMMAND_BATCH_MAX`),
  `backend/src/commands/*` (dto/controller/service), `backend/src/common/app-setup.ts`
  (лимит тела для `/commands/batch`), `mcp/src/client.ts` + `tools/cards.ts`, тесты,
  доки.
- **DoD:** ✅ N команд одной доски применяются за одну транзакцию; замер
  (`docs/PERF-ONE-BOARD.md`, «Результат 3») — **43 → 102 команд/с (×2.3–2.5)**,
  латентность на команду ×2.3 ниже; инварианты (WIP, claim, id, board-management)
  сохранены; идемпотентность/undo/SSE без регрессий; unit + e2e + MCP-тесты
  зелёные.
- **Зависимости:** замер `docs/PERF-ONE-BOARD.md` (сделано); TASK-56, TASK-157
  (сделано).

---

### 7.20. События безопасности мастеров (TASK-161)

#### TASK-161 — `admin-security-events` · Аудит и подозрительная активность

- **Зачем:** при проверке TASK-158 выяснилось, что изменение IP-списка пишется
  в аудит, отказ при входе или refresh попадает в аудит и ленту, но отказ
  обычного запроса с токеном и запрещённого IP не записывается. Лента называет
  события общим «неудачный вход», а некоторые ошибки входа (например неверный
  пароль) не сохраняют IP; она показывает не более 50 событий за 24 часа.
- **Что:**
  - Записывать в аудит отклонённые из-за IP запросы авторизованного мастера,
    а также IP и причину неудачных входов, блокировок и отказов на refresh.
    Сохранять этап (`login`, `refresh`, `request`), время, доступный IP и
    идентификатор/email мастера, если он известен. Для неизвестного IP сохранять
    явное отсутствие значения; определять адрес через существующий `TRUST_PROXY`.
  - Показывать в Security → «Подозрительная активность» понятные локализованные
    причины и этапы (неверный пароль/2FA, блокировка, запрещённый IP при входе,
    refresh или запросе), адрес, аккаунт и время. Изменения IP-списка остаются
    в общем журнале аудита с автором и целевым мастером. Указать окно и лимит
    ленты либо добавить удобный просмотр более старых событий через аудит.
  - Ограничить поток одинаковых отказов: агрегировать повторы со счётчиком и
    временем первого/последнего события либо применить другой ограниченный
    механизм, чтобы непрерывные запросы не переполняли БД и ленту. События для
    разных аккаунтов и адресов не объединять. Сохранить действующую ретенцию
    аудита и не записывать пароли, токены, коды 2FA и тела запросов.
- **DoD:** e2e покрывают неверный пароль, блокировку, запрещённый IP на login,
  refresh и обычном запросе, а также аудит смены списка и ограничения повторов;
  UI-тесты проверяют причины, IP, отсутствие IP и отображение en/ru. Убедиться,
  что защита доступа не зависит от успешного отображения ленты.
- **Зависимости:** TASK-65 и TASK-158; пересечение с TASK-159 (UI-тесты Security).

---

### 7.21. Полнота ленты Watch (TASK-163)

#### TASK-163 — `watch-activity-audit` · События, диффы и границы аудита

- **Статус:** реализовано в `feature/TASK-162.5-views-e2e`; проверка Chrome E2E,
  серверные unit-тесты и границы отдельного аудита описаны в `ROADMAP-DONE.md`.
- **Источник:** [issue #171](https://github.com/VitalyTolstik/janosik/issues/171),
  аудит Watch 2026-11-05. Лента читает `Command` и `Activity`, но не отдельные
  аудиты публичных ссылок и админки; это не полный журнал в�**Ошибка данных:** при одновременном изменении роли и срока участника поля
  `from`/`to` срока перезаписывали поля роли. Теперь оба изменения пишутся
  отдельными событиями в одной транзакции, включая снятие срока при переходе
  с VIEWER; ранее утраченные данные восстановить нельзя.
- **Контракт:** документация en/ru описывает источники событий, доступ и
  ретенцию, а также отдельные аудиты ссылок и администратора. Presence,
  техническая обработка файлов и просмотры не образуют историю в Watch.
- **Качество записей:** исправлены атрибуция новых админских команд, подписи
  дублирования и восстановления, WIP, позиции и порядок карточек. Все поля выводятся,
  длинные значения раскрываются по кнопке; ретенция настраивается, по
  умолчанию 30 дней.
- **Пересечение с TASK-162.5:** в этой же ветке добавлены E2E и исправления
  подписей вложений/приглашений, удалённого комментария и имени участника.
- **DoD:** согласованные события и значения до/после проверены серверными и
  изолированными Chrome E2E-тестами, включая права, Undo/Redo и старые записи;
  документация en/ru описывает матрицу, отдельные аудиты и ретенцию.

---

### 7.22. Настраиваемый workflow карточек (TASK-165)

> **Статус:** MVP реализован в ветке `feat/card-workflow`, исправления по
> независимому ревью внесены; ожидает зелёного CI на финальном head и merge.
> Колонки остаются единственным статусом карточки (`columnId`); `Board.workflow`
> — необязательный JSONB-слой правил над ними. Без поля или при `enabled: false`
> доска ведёт себя как раньше.

**MVP — сделано:**

- Shared-модель `BoardWorkflow`/`WorkflowTransition`, evaluator
  `evaluateTransition`, условия `requireAssignee`/`requireDueDate`/
  `requireDescription`/`requireChecklistsDone`, глобальные переходы (`from:
  null`) с приоритетом специфичного ребра, initial/done и `remapBoardWorkflow`.
- Prisma-поле `Board.workflow Json?` и миграция без backfill; агрегат,
  импорт/экспорт (`schemaVersion: 2`, чтение 1) и public share получают
  конфигурацию.
- Команда `SET_BOARD_WORKFLOW` в reducer/invert/validate/writers, ADMIN-only,
  проверка ссылок и минимум двух колонок внутри блокировки доски.
- Трёхслойная проверка: UI pre-check → shared reducer (структура/условия без
  роли) → сервер (роль + условия + WIP) с `409 { conflict: "workflow",
  workflow: { code, allowedToColumnIds, failedConditions } }`.
- Recovery не обходит границу: `UNARCHIVE_CARD` и `RESTORE_CARD` проверяют
  переход из исходной колонки (роль, условия, доступные цели); UI архива
  показывает запрещённые цели с причиной.
- Включённый процесс без активного перехода отклоняется API и редактором;
  невалидный/будущий сохранённый JSONB работает fail-closed; сохранение из
  настроек ждёт ack сервера, а открытый редактор предупреждает о чужом
  изменении. LWW при одновременном сохранении двух ADMIN остаётся известным
  ограничением MVP (полноценный ifMatch — phase 2).
- UX «Настройки доски → Рабочий процесс»: матрица, инспектор, глобальные
  переходы, initial/done, предпросмотр, шаблон, сброс и выключение контроля;
  read-only «Правила процесса» для участников. DnD, меню карточки, диалог
  карточки, таблица и тосты показывают причину; запрещённые цели остаются
  видимыми и неактивными.
- Мастер-панель: панель статуса в `BoardDetail` и страница
  `/admin/boards/:id/workflow`, сохранение от имени владельца через
  `POST /admin/boards/:id/commands` с записью `AdminAuditLog`.
- MCP: `janosik_get_workflow` (включая проверку целей конкретной карточки),
  ready-work по `initialColumnId`, DoD по `doneColumnIds`, текст `409` без
  призыва ретраить тот же `toColumnId`.
- Импорт/экспорт remap id; удаление колонки не чистит процесс (ссылки «спят» и
  оживают при undo); дублирование доски через export/import сохраняет правила.
- Browser E2E: конфигурация и reload, allowed/blocked DnD и меню, условия,
  роли MEMBER/VIEWER, таблица/диалог, realtime second context,
  import/export, archive/restore, мастер-панель + аудит, legacy/disabled board.
- Документация en/ru: user guide, admin guide, commands/rest API, MCP,
  CHANGELOG; этот раздел ROADMAP.

**Phase 2 — не входит в MVP:**

- Jira-подобный граф-редактор и визуальная карта процесса (только просмотр).
- Post-functions: авто-поля, уведомления, approvals, evidence/blocking-links
  conditions, `UNDO_MOVE` с проверяемым `originalCommandId`.
- Платформенные шаблоны workflow (`WorkflowTemplate`, мастер-панель,
  «применить к доске»).
- Полноценный `ifMatch`/version-conflict для `SET_BOARD_WORKFLOW` вместо LWW
  при одновременном сохранении двух ADMIN и MCP write-tool
  `janosik_set_workflow`.
- Bulk move с атомарным preflight и force move для ADMIN с подтверждением и
  аудитом; ограничение создания карточек только initial-колонкой.
- Аналитика отказов, счётчик заблокированных переходов в Watch, кэш/ETag
  отдельно от `seq`, если профилирование покажет необходимость.
- Если появится durable offline-очередь: `409 workflow` — non-retryable, replay
  идёт по текущим правилам, запись не удаляется молча.

---

### 7.23. Launch readiness: agent-first с контролем человека (TASK-166)

> **Статус:** 166.0 выполнена — политика, схема данных, матрица действий и
> коды ошибок заморожены в
> [`docs/TASK-166-launch-agent-control.md`](docs/TASK-166-launch-agent-control.md);
> Потоки 166.1–166.17 выполнены; **166.17** исправила 2 P1 и 6 P2 из ревью.
> Независимый аудит остаётся в TASK-172/171. Сценарии
> запуска и эксплуатации описаны в документации EN/RU; реальный запуск и
> restore drill выполняет оператор.
> Это не одна фича, а программа из параллельных потоков: примитивы
> идентичности/прав/согласований можно делать до редизайна админки, а новые
> экраны — только после `feat/admin-redesign`, чтобы не строить их дважды в
> старой IA.
>
> **Источники (локальные research-материалы, не входят в git):**
> - `audits/launch-gaps-agent-experience.md` + `design/launch-gaps-agent-experience.html`
> - `audits/launch-gaps-human-control.md` + `design/launch-gaps-human-control.html`
> - `audits/admin-redesign-research.md` + `design/admin-redesign.html`
> - `audits/card-workflow-research.md` (§workflow уже даёт state-boundary)
>
> **Нормативный контракт TASK-166:** этот раздел + ADR
> [`docs/TASK-166-launch-agent-control.md`](docs/TASK-166-launch-agent-control.md).
>
> **Главный вывод аудитов:** Janosik технически зрелый (командный лог,
> reducer, WIP, SSE, share, MCP), но контур «человек контролирует агентов»
> пока не продуктовая механика. Агент — это `actorType` и человеческий email;
> approval/handoff — только вид комментария; pause/kill — только отзыв ключа;
> rollback — локальный undo на 50 шагов; write-контракт неполный.
>
> **Цель:** закрыть launch-блокеры, при которых приложение можно назвать
> «Kanban в первую очередь для AI-агентов, с контролем человека», не ломая
> self-host, существующие доски и текущие MCP-сценарии.

**Ключевые принципы**

1. **Агент — не boolean, а identity.** Нужны `apiTokenId`, `agentSessionId`,
   человекочитаемое имя, `runId` и heartbeat; два ключа одного аккаунта должны
   быть различимы в истории, аудите, Watch и SSE.
2. **Сервер — источник истины.** UI pre-check только объясняет; scopes,
   destructive gate, WIP, workflow и approval проверяются на сервере внутри
   транзакции/блокировки.
3. **Deny by default для destructive.** Опасное действие агенту либо запрещено,
   либо требует `ApprovalRequest`; trusted CI — отдельный явный scope.
4. **Один run → один аудит и один rollback.** Батч/сессия получают `runId`,
   destructive-команды — pre-image; человек может посмотреть и откатить run.
5. **Сначала контракт, потом UI.** Agents/Approvals/Audit/Rollback/Scopes —
   новые экраны в новой админке; backend-примитивы от неё не зависят.
6. **Не ломать self-host.** Новые поля/таблицы nullable, старые доски и токены
   работают как раньше; hosted/cloud-темы (billing, DPA, tenant isolation) —
   отдельное решение.

#### 7.23.1. Решения до кода (TASK-166.0, блокирует остальные)

| Вопрос | Рекомендация | Что фиксируем |
| --- | --- | --- |
| Self-host или managed cloud в первую очередь? | Self-host OSS; cloud — отдельная программа | remote MCP/OAuth, billing, DPA, status page не блокируют этот релиз |
| Агент = user+PAT или отдельная сущность? | Владелец — `User`, исполнитель — `AgentSession` + `apiTokenId`; отдельный `Agent` не вводим в MVP | `AgentSession`/токен в истории и правах, без второй системы аккаунтов |
| Дефолт destructive-действий | Прямое исполнение запрещено; штатный путь — approval; `trusted_ci` — явное исключение; hard deny (`destructive: "deny"`) — opt-in политики доски | матрица действий и коды ошибок |
| Что такое run? | Один batch/plan + `agentSessionId`; cross-board run запрещён в MVP | `runId`, границы, retention |
| Pause-семантика | новые записи получают 403, in-flight завершаются, SSE закрывается | поведение очередей и UI |
| Retention | 30 дней по умолчанию, 90/365 — настройка | аудит/история/экспорт |
| Вложения | локальный диск (как сейчас), object storage — phase 2 | presigned URL не в MVP |
| Undo агента | compensating edits + run rollback; не давать агенту browser undo | API/аудит |

**DoD 166.0:** решения записаны в ADR/документе, схема данных и матрица
действий заморожены; остальные потоки могут стартовать без переделок.

**Выполнено (2026-11-09):** ADR —
[`docs/TASK-166-launch-agent-control.md`](docs/TASK-166-launch-agent-control.md);
W1 разблокирована.

#### 7.23.2. Волны и параллельность

| Волна | Потоки | Можно запускать | Условие |
| --- | --- | --- | --- |
| W0 | 166.0 | сразу | — |
| W1 | 166.1–166.6 | после 166.0 | 6 потоков параллельно, разные worktree |
| W2 | 166.7–166.12 | после W1 (166.7 — после 166.1+166.4; 166.8 — после 166.4+166.5; 166.9 — после 166.5) | 6 потоков, но с указанными зависимостями |
| W3 | 166.13–166.15 | после `feat/admin-redesign` + соответствующих backend-потоков | 3 UI-потока параллельно |
| W4 | 166.16 | после W1–W3 | документация, runbook и launch checklist |
| W5 | 166.17 | после 166.1–166.16 | исправления восьми подтверждённых замечаний ревью; до сквозного аудита TASK-172/171 |

Каждый поток — отдельная ветка `feat/TASK-166.x-<slug>` и отдельный PR.
Если два потока трогают один файл, они либо разводятся по времени, либо
делаются в одном worktree с явным владельцем файла. UI-потоки не начинать до
мержа редизайна админки.

#### 7.23.3. Потоки

| ID | Поток | Зависит | Зона / ключевые файлы | DoD |
| --- | --- | --- | --- | --- |
| 166.0 | Policy & ADR ✅ | — | `docs/`, этот раздел | **Выполнено:** решения, схема данных и матрица действий заморожены в [`docs/TASK-166-launch-agent-control.md`](docs/TASK-166-launch-agent-control.md); W1 разблокирована |
| 166.1 | Agent identity & sessions ✅ | 166.0 | Prisma `Command`/`Activity`/`AgentSession`; `auth/api-token.service`; command writers; SSE; `shared/src/types`; `mcp/src` | два PAT одного аккаунта различимы по `apiTokenId`/`agentSessionId` в БД, API, SSE, Watch; start/heartbeat/end; тесты |
| 166.2 | Scopes & destructive gate ✅ | 166.0 | `auth/jwt-auth.guard`, `common/membership.guard`, `api-token.service`, controllers, `shared/src/api`, MCP; минимальный UI токенов не в админке | пресеты Observer/Worker/Reviewer/Admin; board-scoped токен не читает чужие доски/не принимает инвайты/не меняет профиль; destructive denied/approval; матрица тестов |
| 166.3 | Pause / kill switch ✅ | 166.0, 166.1 | `AgentSession.paused*`, `ApiToken.individualPaused*`/`stopAllPaused*`, `Board.agentsPaused*`, `POST /boards/:id/agent-sessions/:sessionId/pause` / `resume`, `POST /boards/:id/agents/pause`, guards, SSE | **Выполнено:** обратимая пауза сессии/токена/доски и stop-all; `403 agent_paused` с приоритетом token → board → session (проверяется до role/scope/destructive); проверка на границе и под блокировкой доски (in-flight завершается, а поставленные в очередь записи после revoke/end отклоняются); GET, heartbeat и end остаются доступны; claims не освобождаются паузой; PAT SSE получает событие и закрывается на следующем keep-alive (session — только с `?session=`); reconnect → `403`; kill отзывает токен, отменяет сессии и освобождает claims под блокировкой доски; Activity/SecurityAudit и docs EN/RU; e2e/unit-тесты. |
| 166.4 | Reliable write contract ✅ | 166.0 | backend exception filter, `shared` error types, `api` client, MCP `format/schemas`; все write endpoints/tools | **Выполнено:** единый конверт ошибок (`code`/`retryable`/`requestId`/`currentVersion`, legacy `conflict`/`field`/`workflow`), фильтр покрывает REST/админку/SSE-ошибки; `Idempotency-Key` для create_board/import/duplicate_card/add_comment/create_share/upload (24 ч, replay/`idempotency_conflict`/`idempotency_in_progress`); MCP `structuredContent` у мутаций и коды в ошибках; UI читает новые поля; контрактные e2e + unit |
| 166.5 | Approval & handoff API ✅ | 166.0, 166.1 | `ApprovalRequest` endpoints, activity/SSE/audit hook; MCP approval tools | **Выполнено:** PAT создаёт запрос с каноническим `planHash`, summary/risk и TTL (floor 5 мин); destructive-команды/батчи/lifecycle без `X-Approval-Id` создают тот же запрос и отвечают `409 approval_required` с `approvalId`/`planHash`/`expiresAt` без частичного применения; решение — только сессия board ADMIN (идемпотентный approve), отмена — токен-заявитель или ADMIN; expiry ленивый; применение с `X-Approval-Id` одноразовое и атомарное с командами/`AgentRun`, повтор тех же команд идемпотентен, ошибки `approval_mismatch`/`owner_mismatch`/`consumed`; Activity/SSE/`approval.decided`; MCP request/list/get/wait/cancel; EN/RU docs и e2e/unit/MCP-тесты |
| 166.6 | Limits & data safety ✅ | 166.0 | UI-лимит 10 досок, board/token audit, import/export limits, backup/retention status, self-service export/delete | 10-board противоречие убрано/честно объяснено; удаление доски/токена в аудите; импорт ≥ экспорта; статус backup честный; тесты и docs |
| 166.7 | Run grouping & rollback foundation ✅ | 166.1, 166.4 | batch `runId`, pre-images destructive commands, run list API, revert dry-run/conflict | **Выполнено:** PAT batch создаёт один board-scoped `AgentRun` (`batch`), одиночная destructive-команда PAT — `single`; browser-батч и обычная non-destructive команда остаются без run (D16). `clientRunId` — идемпотентный ключ доски; каждая команда run несёт `runId` и прежнюю атрибуцию. Для каждой команды run пишется `CommandPreimage` (before-state, версии до/после, inverse; у destructive — вложенные карточки/чек-листы/метки). API: `GET /boards/:id/runs` (фильтры+курсор), `GET …/runs/:runId` (pre-images только browser-JWT board ADMIN), `POST …/revert/preview` (dry-run, конфликты, diff для ADMIN) и `POST …/revert` (только browser-JWT board ADMIN; PAT → `pat_forbidden`). Revert проверяет конфликты, all-or-nothing, одноразовый, создаёт `kind:"revert"` run с `revertsRunId`, помечает исходный `reverted`/`revertedAt`, пишет Activity + SSE `run.reverted` + audit и не ломает обычный undo. Shared DTO append-only, MCP только `list_runs`/`get_run`/`preview_run_revert` (apply запрещён, D17; tool count 82). e2e/unit/MCP-тесты. Follow-up: revert повторно проверяет конфликты под board-lock до применения inverse; retention — preimages → commands → runs (`sweep-runs` не трогает run с командами и удаляет reverted-пару вместе); `X-Run-Id` в ответах команд/батча/реального revert. |
| 166.8 | Plan / apply / bulk ✅ | 166.4, 166.5 | plan/diff/apply endpoints, atomic ≤100, chunking; MCP tools | **Выполнено:** `POST /boards/:id/plans` — чистый dry-run: тот же валидатор/скоупы/destructive-классификация, что у batch/plan, replay редьюсера в памяти, канонический `planHash` (sha256 canonical JSON без `action.at`/boardId), net-diff before/after, warnings (`approval_required`/`destructive`/`reviewer_required`/`no_op`) и conflicts (`version`/`wip`/`workflow`/`id`/`scope`/`destructive_denied`/`invalid`); не пишет команды, не создаёт `AgentRun`/`ApprovalRequest`. `POST …/plans/apply` требует hash (mismatch → `409 approval_mismatch` с expected/actual prefix) и переиспользует batch-транзакцию: all-or-nothing, одна блокировка доски, лимиты `min(100, policy.maxCommandsPerRun)` команд и `min(50, policy.maxCardsPerRun)` созданий карточек (`409 limit_exceeded`, без межатомарности чанков), auto-approval для destructive без `X-Approval-Id` и одноразовое consumption с идемпотентным повтором; PAT-план создаёт один `AgentRun kind:"plan"` с preimages и rollback, браузерный — без run. MCP: только `plan_changes`/`apply_plan` (tool count 84), shared DTO append-only, тесты на dry-run/diff/conflicts/hash/лимиты 100–101 и 50–51/approval/replay/rollback/PAT-browser-VIEWER, EN/RU docs, CHANGELOG. |
| 166.9 | Attention / notifications backend ✅ | 166.5 | in-app + email events для approval/blocker/needs-human/claim expiry/quota; digest v2 | **Выполнено:** `AttentionNotification` (уникальный `dedupKey`), in-app inbox API `/users/me/notifications` (list/read/read-all, только сессия), настройки `notifyAttention` + `/users/me/notification-settings`; письма EN/RU для approval requested/decided/cancelled/consumed/expired, `agent.blocked`/`agent.needs_human` (agent-блокер/handoff комментарии), `claim.expired`, `quota.exceeded` и `token.revoked` (только владелец); адресаты — активные board ADMIN (approval/blocker), requester+decision actor (decision/cancel/consume/expiry), claimant+ADMIN (claim), сам аккаунт (quota/token revoke); PAT/токены письма не получают, чужие доски отфильтрованы; повторные запросы/свипы и несколько вкладок дедуплицируются, opt-out уважается (in-app остаётся); digest v2 добавляет undigested attention-категории и помечает их `digestedAt`, не ломая старый digest/reminders; новый `sweep-claims` освобождает просроченные claim и шлёт одно событие, `sweep-attention` чистит старые записи; unit/e2e EN/RU, негативные сценарии; UI — позже |
| 166.10 | Observability / rate limits ✅ | 166.1, 166.2 | per-token/agent metrics, rate-limit headers, 429/Retry-After, structured logs, queue fields | **Выполнено:** глобальный per-principal лимит сохранён; PAT получает бюджеты на токен (`rateLimitPerMinute`), агентскую сессию (`AGENT_SESSION_RATE_LIMIT`, по умолчанию = глобальный, min 60) и доску (`BOARD_RATE_LIMIT`, по умолчанию 2× глобального, min 600), браузерные сессии не меняются; `X-RateLimit-*`/`RateLimit-*`/`X-RateLimit-Scope` и `Retry-After`, конверт `429 rate_limited` с `retryable`/`retryAfter`/`limit`/`scope`/`requestId`; структурированный журнал запросов (requestId, method/path/status/duration, actor, boardId, apiTokenId, agentSessionId, runId/approvalId, операция) с вырезанием query и share-токенов и без тел/секретов; те же поля в `/admin/traffic.telemetry` (акторы, записи, ошибки, отказы по области, approvals/pauses/runs, latency); `attribution` в payload `media`/`transcode`/`exports`; unit/e2e на изоляцию токенов/сессий/досок, заголовки, 429, редакцию логов и очереди; docs EN/RU, ADR §8.4 и CHANGELOG |
| 166.11 | Agent DX / OpenAPI / MCP docs ✅ | 166.4 | OpenAPI/JSON schema, MCP descriptions/discovery, examples, versioning, tool count drift | **Выполнено:** публичный OpenAPI 3.1 (`site/public/openapi.yaml`, 72 операции: полный агентский контур + основная запись доски, единый error envelope, approval/pause/plan/run и version/idempotency-семантика) с валидатором `npm run openapi:check` (3.1 schema, уникальные operationId/пути, path-параметры, локальные $ref); MCP-каталог проверяется `mcp/src/catalog.test.ts` (title/description/параметры/аннотации и drift README), 84 tool остаются; EN/RU docs, real-примеры, auth/scopes/versioning, runs/policy и prompt-injection warning |
| 166.12 | Contract/security test suite ✅ | 166.1–166.8 | e2e/backend contract, token matrix, prompt-injection content, destructive gate, concurrency, pause, approval, rollback | **Выполнено:** добавлены backend-сьюты `agent-control-security` и `agent-control-approval-security` (13 сценариев: actor/board scope, deleted/archived доски, pause precedence, read-only, граница prompt-injection, approval exactness/expiry, planHash/конфликты/конкурентность), Playwright-полоса `e2e/tests/security` (VIEWER rollback и `run.reverted` refresh) и независимая CI-полоса `security-contract` с БД `janosik_test_16612`; негативные пути проверяют отсутствие записи. |
| 166.13 | Agents & sessions UI ✅ | admin-redesign, 166.1 | новая IA: Agents, сессии, heartbeat, attribution в Watch/audit | **Готово (PR #232):** консоль `/agents` агрегирует сессии всех досок, группирует по PAT, фильтрует по доске/токену/статусу/времени, показывает heartbeat/stale/current card/run; деталь токена со списком сессий, pause/resume с причиной и end с финальным статусом для board ADMIN, read-only для MEMBER/VIEWER и agent-токена; `agent` SSE обновляет затронутую доску без reload (+poll fallback); Watch различает два PAT одного аккаунта и показывает token/session/run, History и комментарии агента — ту же атрибуцию. EN/RU docs, 17 unit и 9 browser E2E (list/detail/pause/end/SSE/empty/error/permissions/Watch attribution). |
| 166.14 | Approvals + pause/kill UI ✅ | admin-redesign, 166.3, 166.5 | `ui/src/components/agent-control/*`, Header trigger, `ApiTokensSection`, `AgentControlStore`; `events.controller`/`agent-sessions.service` SSE passthrough | **Выполнено:** board-ADMIN диалог Agent control — очередь+деталь согласований (summary/risk/карточка/токен/сессия/план/planHash/TTL/аудит, approve/reject с reason, все шесть статусов), пауза доски и сессий с причиной, in-flight-семантика; token pause/resume, stop-all/resume-all и kill (revoke) в Account → API keys (только browser session; PAT получает `403 pat_forbidden`). Approval и agent события идут в board SSE (approval-кадры теперь проходят transport; board/session pause/resume публикуют `agent`), счётчик и статусы обновляются без reload. EN/RU i18n, loading/empty/error/permission, responsive; unit-тесты + 7 browser E2E (approve/reject/expiry/permissions/pause/resume/stop-all/SSE) |
| 166.15 | Audit/rollback + scopes/limits UI ✅ | admin-redesign, 166.2, 166.7 | run timeline, revert, pre-image diff, token presets, limits dashboard | **Выполнено:** в Agent control добавлены вкладки **Runs & rollback** (фильтры status/kind/token/session/time, курсор, таймлайн, команды с атрибуцией, `firstSeq`/`lastSeq`, plan/approval hash, pre-images и diff только browser-JWT board ADMIN, список конфликтов) и **Policy & limits** (effective limits, destructive `approval`/`deny`, фиксированный `requireApprovalFor`, `["ADMIN"]`, границы 1–100 / 1–50 / 5–1440, pause state). Preview отката доступен членам доски; apply — только board ADMIN из браузерной сессии, с подтверждением, generated `commandId`, all-or-nothing и понятными `run_conflict`/`run_expired`/`pat_forbidden`; UI перечитывает run по SSE `run.reverted`. `PATCH /boards/:id/agent-policy` (session-only ADMIN, CAS по `agentPolicyVersion`, `null` = defaults, Activity + SecurityAudit) и `PATCH /users/me/tokens/:id` (session-only owner, scope/trustedCi/board/rate, audit, без секрета) реализованы; Account → API keys получил edit-dialog и компактный limits/pause-статус. EN/RU i18n и docs, unit/e2e/browser-тесты. |
| 166.16 | Docs / runbook / launch checklist ✅ | W1–W3 | `site/.../docs` EN+RU, `README`, `docs/`, ROADMAP/CHANGELOG | **Выполнено:** сценарии администратора и разработчика агента, launch checklist и release notes EN/RU; согласованный backup базы и uploads, изолированный restore drill и rollback обновления описаны в runbook; README и self-hosting ссылаются на процедуры. Оператор выполняет checklist и drill для своей установки. |
| 166.17 | Agent-control review hardening ✅ | 166.1–166.16 | MCP session attribution, backend pause/limits/approval/idempotency/rate-limit, tests, docs | **Выполнено:** исправлены все 2 P1 и 6 P2; живой MCP, PostgreSQL E2E с барьерами, unit, OpenAPI и документация. [Спецификация](docs/TASK-166.17-agent-control-hardening.md); независимые проверки TASK-172/171 остаются. |

#### 7.23.4. Общий Definition of Done

- **Безопасность:** ни один агентский путь (REST, MCP, batch, import, share,
  undo/restore) не обходит scopes/WIP/workflow/approval; destructive по
  умолчанию закрыт.
- **Наблюдаемость:** по любому run видно `apiTokenId`, `agentSessionId`,
  `runId`, актора-человека, команды, ошибки и разрешения.
- **Откат:** run можно откатить или получить dry-run с конфликтами; обычный
  человеческий undo не ломается.
- **Опыт:** EN/RU docs, понятные `409/403` с машинным кодом и человеческим
  текстом, никаких «тихих» no-op.
- **Совместимость:** старые PAT/доски/экспорты работают; новые поля nullable;
  self-host не требует облачных сервисов.
- **Гейты:** shared/ui/backend/mcp typecheck и unit; backend E2E; полный
  admin browser E2E; новые contract/E2E; lint/format.

#### 7.23.5. Осознанно не входит в TASK-166

- Managed cloud, billing, DPA, status page, multi-tenant org layer.
- Полный Jira-подобный граф и post-functions (это §7.22 phase 2).
- Remote MCP/OAuth как обязательный канал; webhooks — после решения W0.
- Автоматический machine translation анонсов/комментариев.
- Полный SIEM/external log export; object storage для вложений — phase 2.

---

### 7.24. Редизайн маркетингового сайта под новые реалии (TASK-167)

> **Статус:** запланировано. Копирайт, IA и структуру страниц можно начинать
> после TASK-166.0 (зафиксированные решения и матрица фич). Экраны админки,
> approvals/scopes/audit и новые медиа — только после `feat/admin-redesign` и
> TASK-166.13–15. Публиковать утверждения о фичах — только после их мержа в
> `main`; иначе сайт снова начнёт продавать несуществующий продукт.
>
> **Источники:**
> - `audits/launch-gaps-agent-experience.md` + HTML
> - `audits/launch-gaps-human-control.md` + HTML
> - `audits/admin-redesign-research.md` + HTML
> - текущий `site/` (TASK-122…135), `site/src/content/docs/**`
> - `ROADMAP.md` §7.22 (workflow) и §7.23 (agent control)

**Зачем.** Сайт описывает продукт до workflow, agent-control и редизайна
админки: герой — «Kanban for your agent swarm», фича-ряды — доска, realtime,
карточки и шаринг, медиа записаны на старом UI, а документация уже знает про
workflow, которого нет на лендинге. После TASK-166 обещание меняется: не «рой
без контроля», а **«агенты работают — человек контролирует»**. Если не
переупаковать сайт, он будет продавать старую версию, завышать ожидания и
прятать главное отличие Janosik от обычного канбана с API.

**Позиционирование (ядро).**

- EN: **“Kanban for AI agents. Control stays with you.”**
- RU: **«Канбан для ИИ-агентов. Контроль остаётся у вас.»**
- Три уровня истории:
  1. **Agents do the work** — ключи, сессии, захват карточек, batch/plan;
  2. **Workflow keeps them honest** — переходы, роли, условия, WIP, DoD;
  3. **You stay in control** — scopes, approvals, pause/kill, audit, rollback.
- Честность превыше маркетинга: self-hosted AGPL — основной продукт; cloud —
  «later» без дат; никаких фейковых логотипов, SSO, SLA, «enterprise» и
  отзывов до реальной реализации. Каждое утверждение на сайте должно иметь
  ссылку на docs/changelog и соответствовать отгруженной версии.

**Новая IA маркетинга.**

1. Hero: агент двигает карточку, человек подтверждает действие; CTA в app.
2. **Control loop** — 3–4 шага: scoped key → agent claims card → workflow
   проверяет переход → approval/pause/audit при риске.
3. **Workflow** — матрица переходов, роли, условия, initial/done.
4. **Admin console** — 8 хабов, Agents, Approvals, Audit & activity,
   Rollback, Scopes, limits; реальный скрин новой админки.
5. **Swarm in motion** — существующий watch/realtime-сюжет, но с атрибуцией
   агентов и «человек рядом».
6. **Board for humans** — доска, карточки, виды, комментарии, шаринг.
7. **Self-host & trust** — AGPL, данные на своём сервере, бэкапы, scopes.
8. **Pricing teaser** — self-hosted free, cloud later.
9. FAQ, финальный CTA, футер с docs/security/changelog.

Плюс отдельные SEO-страницы (EN/RU), если поток 167.3 успевает без потери
качества: `/agent-control`, `/workflow`, `/security`. Если нет — те же секции
живут на лендинге, а страницы выносятся в §7.24.4.

#### 7.24.1. Волны и потоки

| Волна | Потоки | Можно запускать | Условие |
| --- | --- | --- | --- |
| W0 | 167.0 | после TASK-166.0 | зафиксированы решения и статус фич |
| W1 | 167.1, 167.5, 167.6 | параллельно редизайну админки | только shipped-фичи; новые экраны — заглушки/пометка «planned» |
| W2 | 167.2, 167.3, 167.4 | после `feat/admin-redesign` + TASK-166.13–15 | UI-фичи смержены, экраны и медиа финальны |
| W3 | 167.7, 167.8 | после W1–W2 | все страницы и медиа заморожены |

Каждый поток — отдельная ветка `feat/TASK-167.x-<slug>` и отдельный PR.
Если два потока трогают один файл, они разводятся по времени или получают
явного владельца файла. Финальную интеграцию, навигацию, SEO-паритет и
launch-гейт держит головной поток.

#### 7.24.2. Потоки

| ID | Поток | Зависит | Зона / ключевые файлы | DoD |
| --- | --- | --- | --- | --- |
| 167.0 | Narrative, IA & claims matrix | TASK-166.0 | `site/src/i18n/ui.ts`, `site/src/components/pages/HomePage.astro`, `audits/`, `ROADMAP.md` | таблица «фича → статус (shipped/planned) → где на сайте → docs-ссылка»; ни одного утверждения без подтверждения; EN/RU тексты-основы готовы |
| 167.1 | Marketing design system refresh | 167.0 | `brand/`, `site/src/styles/global.css`, `site/src/layouts/BaseLayout.astro`, `site/src/components/*` | типографика/сетка/отступы/motion/тёмная тема обновлены на токенах бренда; нет хардкода цветов; reduced-motion; визуальный язык сочетается с новым app, но не копирует плотную админку |
| 167.2 | Landing rebuild | 167.1, 167.4 | `site/src/components/pages/HomePage.astro`, `site/src/i18n/ui.ts`, `site/src/components/MediaSlot.astro` | новая IA из §7.24; hero/control loop/workflow/admin/swarm/self-host/pricing/FAQ/CTA; EN/RU; 390/768/1280 без гор. скролла; CTA ведут в app с `?lng=` |
| 167.3 | New marketing pages | 167.1, 167.2 | `site/src/pages/agent-control.astro`, `workflow.astro`, `security.astro`, `site/src/pages/ru/*`, `site/astro.config.mjs` | `/agent-control`, `/workflow`, `/security` + RU-версии; уникальные title/description/canonical/hreflang/OG/JSON-LD; навигация и футер; без дублей контента |
| 167.4 | Media v2: real UI recordings | 167.2, admin redesign + 166.13–15 | `video/record/seed.mjs`, `record.mjs`, `screenshots.mjs`, `encode.mjs`, `site/public/media`, `site/public/screens` | новые клипы: control loop, workflow, approvals, audit/rollback, admin console; старые клипы перезаписаны на текущем UI; только демо-данные; постеры, reduced-motion, no-CLS, вес в бюджете |
| 167.5 | Docs & changelog sync | 167.0 | `site/src/content/docs/**` + `ru/**`, `site/astro.config.mjs`, `CHANGELOG.md` | новые страницы Agent control / Approvals / Scopes / Pause / Rollback / Admin redesign map; обновлены workflow, MCP, API, self-hosting; EN/RU паритет; ссылки из маркетинга живые |
| 167.6 | SEO, AI-SEO & CRO | 167.2, 167.3 | `site/src/i18n/ui.ts`, `site/src/components/SEO.astro`, `site/src/pages/llms.txt.ts`, `site/src/pages/*.md.ts`, `site/src/lib/analytics.ts` | новые ключевые запросы (agent control, AI workflow, approvals, self-hosted agent kanban); JSON-LD/FAQ/SoftwareApplication валидны; `llms.txt` и pricing.md синхронны; события CTA; Lighthouse SEO 100 |
| 167.7 | A11y, perf & responsive | 167.2–167.4 | `site/src/styles/*`, `site/src/components/*`, `site/src/layouts/BaseLayout.astro` | Lighthouse a11y/perf ≥95 на home/pricing/new pages; контраст, фокус, клавиатура, 390 px; LCP/CLS в бюджете; видео не грузятся до вьюпорта; reduced-motion → постеры |
| 167.8 | E2E & launch gate | 167.2–167.7 | `e2e/tests/site/**`, `e2e/tests/docs/**` | обновлены 45 site- и 36 docs-тестов; новые секции/страницы/языки/темы/мобилка/SEO/ссылки; полный Chrome-набор зелёный; crawl без 404; claims-audit подписан; CHANGELOG/ROADMAP обновлены |

#### 7.24.3. Общий Definition of Done

- **Честность:** каждое обещание на сайте либо уже в `main`, либо явно
  помечено «planned/roadmap»; никаких фейковых логотипов, отзывов, SSO, SLA,
  cloud-доступности и цифр без источника.
- **Полнота:** новая реальность закрыта — workflow, agent identity/scopes,
  approvals, pause, audit/rollback, admin console, self-host/AGPL.
- **Языки:** EN/RU паритет, без непереведённых строк и «русского в английском».
- **Медиа:** все клипы и скриншоты сняты с текущего UI после UI-freeze; старый
  UI и старые названия не встречаются; только демо-данные.
- **Документация:** у каждой новой фичи есть docs-страница EN/RU и ссылка с
  сайта; API/MCP-примеры рабочие.
- **Качество:** `npm run build -w site`, `astro check`, lint/format; Lighthouse
  a11y/perf/SEO/best-practices ≥95; нет CLS и горизонтального скролла на 390 px;
  reduced-motion учтён.
- **Тесты:** site/docs Chrome E2E обновлены и зелёные; crawl ссылок без 404;
  новые страницы покрыты независимыми пользовательскими сценариями.
- **Релиз:** `CHANGELOG.md`, `ROADMAP.md`, OG/sitemap/robots/llms.txt
  синхронизированы; launch checklist и rollback сайта (предыдущий образ) готовы.

#### 7.24.4. Осознанно не входит в TASK-167

- Billing, cloud-тарифы и checkout (TASK-131) — только честная заглушка
  «cloud later».
- Новая бренд-идентичность, логотип и палитра — это TASK-122, здесь только
  развитие системы.
- CMS, блог-движок, редакционный workflow, маркетинговая автоматизация/CRM.
- Языки сверх EN/RU.
- Полная переделка docs-IA и всех старых страниц; трогаем только то, что
  связано с новой реальностью.
- Сравнительные страницы «Janosik vs …» и programmatic SEO — после запуска,
  если появится спрос.
- Фейковые social proof, enterprise-блоки и «как у конкурентов» без реального
  содержания.

---

### 7.25. Релиз 1.0.0 и подготовка к облаку (TASK-168…172)

> **Статус:** запланировано. Это release-программа после TASK-166/167:
> сначала закрываются старые хвосты, затем README/docs приводятся в
> соответствие с продуктом, отдельно проверяются MCP и скил, потом
> обновляется Docker-образ, и только после этого — независимое ревью и тег
> `1.0.0`.
>
> **Логика порядка:** 168 → 169 → 172 → 170 → 171. Внутри каждой задачи есть
> параллельные потоки, но финальный тег ставится только после того, как
> предыдущая задача закрыта и её результат попал в `main`.
>
> **Что значит «облако» здесь:** hosted/staging-развёртывание того же образа
> (TLS, reverse proxy, managed PostgreSQL/Redis, решение по object storage,
> бэкапы, наблюдаемость), а не billing и не multi-tenant SaaS. Billing и
> планы остаются в TASK-131; 1.0.0 сначала выходит как self-hosted релиз.

**Принципы релизной программы.**

1. **Никаких «открыто, но сделано».** Каждый старый open-task получает
   финальный статус с PR/тестом/причиной, а не остаётся висеть в таблице.
2. **Docs — часть продукта.** README и docs обновляются после фич; отдельный
   аудит ищет не только устаревшее, но и то, что вообще не добавили.
3. **Один артефакт.** Релиз — это Docker-образ и тег, а не набор локальных
   сборок. `1.0.0` ставится только после clean install, upgrade и rollback.
4. **Self-host first.** Облако не оправдывает пропуск self-host-сценариев;
   hosted-развёртывание использует тот же образ и те же миграции.
5. **Независимое ревью.** В 171 проверяют не авторы потоков; замечания
   классифицируются, P0/P1 блокируют тег.

| Шаг | Задача | Что закрывает | Выход |
| --- | --- | --- | --- |
| 1 | TASK-168 `launch-tail` | TASK-40, TASK-31, TASK-161, TASK-159/41 | все старые хвосты закрыты или явно перенесены с причиной |
| 2 | TASK-169 `docs-audit` | README, docs EN/RU, «что не добавили» | документация соответствует 1.0.0, gap-отчёт закрыт |
| 3 | TASK-172 `mcp-skill-review` | MCP tools/schemas, skill, references, MCP docs | MCP и скил проверены на живых сценариях, пробелы исправлены |
| 4 | TASK-170 `docker-release` | Dockerfile, compose, CI, GHCR | обновлённый multi-arch RC-образ, проверенный на чистой машине |
| 5 | TASK-171 `pre-cloud-1.0` | security/data/perf/cloud/release | тег `1.0.0`, образы, отчёт ревью, launch checklist |

#### TASK-168 — `launch-tail` · Закрыть хвосты прошлых задач

- **Зачем:** после TASK-166/167 в роадмапе остаются задачи, которые либо
  фактически сделаны, либо маленькие, либо ждут новую IA админки. Если их не
  закрыть сейчас, они растворятся в релизной суете и всплывут после 1.0.0.
- **Потоки:**

| ID | Поток | Что делаем | DoD |
| --- | --- | --- | --- |
| 168.1 | TASK-40 `observability` | Sentry на фронт (`ErrorBoundary` + global handler) и бэк (exception filter) с версией сборки; `pino` + `requestId` → `commandId`; пустой `SENTRY_DSN` полностью выключает отправку. `/health` и `requestId` уже сделаны — не переделывать | ошибка долетает до Sentry; без DSN — ноль сетевых вызовов; по `commandId` виден путь команды; тесты/доки |
| 168.2 | TASK-31 `mobile-ux` | тач-слой календаря/таблицы (перенос строк/дат), адаптив шапки, фильтров и диалогов доски на 390 px | drag/перенос работают на тач-эмуляторе; нет горизонтального скролла; существующие жесты не сломаны. **Выполнено в `feat/TASK-168.2-mobile-ux`:** общий `useTouchDrag` (long-press, медленный тап остаётся тапом, auto-scroll у края, отмена на скролле/multi-touch/Escape, click после drop); чипы календаря (month/week/unscheduled) сохраняют время, строки таблицы переносятся с проверками workflow/WIP; у чипа и строки есть явная кнопка «Card actions»; шапка на 390 px — две строки, фильтры/диалоги без горизонтального скролла, панель `Unscheduled` свёрнута; touch-E2E 390×844 (16 сценариев) + unit-тесты хука и обоих видов |
| 168.3 | TASK-161 `admin-security-events` | аудит отказов по IP на login/refresh/request, причина/этап/IP, агрегация повторов; лента Security в новой IA админки | e2e на неверный пароль, блокировку, запрещённый IP; UI en/ru; поток не переполняет БД |
| 168.4 | TASK-41/159 closure | сверить фактическое покрытие TASK-162 с DoD TASK-41; добить UI-тесты Ops/Comms/Observability/Security или закрыть как поглощённые редизайном; обновить статусы | TASK-41/159 закрыты с evidence или имеют остаток с owner/date; нет «зелёных» тестов, которые ничего не проверяют |

- **Порядок:** 168.1 и 168.2 можно начинать сразу; 168.3 — после
  `feat/admin-redesign`; 168.4 — после 166.13–15 и 168.3.
- **DoD:** все пять старых пунктов (40/31/161/159/41) переведены в
  `ROADMAP-DONE.md` или явно перенесены; тесты, docs EN/RU и CHANGELOG
  обновлены; ни один пункт не остаётся «открытым, но фактически сделанным».
- **Не входит:** новые продуктовые фичи; TASK-131 (billing/cloud).

#### TASK-169 — `docs-audit` · README, документация и «что не добавили»

- **Зачем:** README всё ещё описывает продукт версии 0.2.0 и 71 MCP-tool,
  часть новых фич есть только в коде, часть docs ссылается на старый UI, а
  `ROADMAP`/`CHANGELOG`/сайт могут расходиться. Нужен не косметический
  проход, а инвентаризация «код ↔ документация» с явным списком пробелов.
- **«Инвестигейт чего не добавили»:** отдельный отчёт
  `docs/DOCS-COVERAGE.md`:
  - все публичные фичи, роуты, env-переменные, команды, лимиты, MCP-tools,
    skill-файлы и админ-экраны против README/docs;
  - фичи, реализованные, но не задокументированные;
  - docs, обещающие то, чего нет в коде;
  - устаревшие скриншоты/клипы/названия/версии;
  - отсутствующие EN/RU-пары, битые ссылки и якоря;
  - TODO/FIXME и «НЕ ЗАБЫТЬ» в коде/ROADMAP, которые не заведены задачей.
  Каждый пункт — `fixed`, `deferred` с причиной или `issue` со ссылкой.
- **Потоки:**

| ID | Поток | Что делаем | DoD |
| --- | --- | --- | --- |
| 169.1 | Inventory & gap report | инвентаризация кода/контрактов/доков, отчёт `docs/DOCS-COVERAGE.md` | таблица покрытия; ни одного «неизвестного» пункта; приоритеты |
| 169.2 | README 1.0 | переписать верх, quick start, возможности, архитектурное дерево, MCP/skill, workflow, админка, self-host, версия, актуальные скриншоты | README соответствует 1.0.0; все ссылки живые; нет устаревших чисел/названий |
| 169.3 | Docs site EN/RU | Agent control / approvals / scopes / pause / rollback / admin redesign map; обновить workflow, MCP, API, self-hosting, runbooks, FAQ | каждая новая фича имеет страницу EN+RU; навигация и поиск работают |
| 169.4 | Consistency & links | версия в docs/сайте, changelog, `llms.txt`, `pricing.md`, sitemap, canonical/hreflang, перекрёстные ссылки | `astro check`/build; crawl без 404; docs E2E; changelog полный |

- **Зависимости:** 166.16 (docs/runbook) и 167.5 (docs redesign); аудит 169.1
  можно начинать раньше, фиксы — после мержа этих потоков.
- **DoD:** README и docs описывают ровно то, что есть в 1.0.0; gap-отчёт
  закрыт или заведены issues; EN/RU паритет; docs-сайт собирается; ссылки
  живые; `CHANGELOG.md` и `ROADMAP.md` синхронны.
- **Не входит:** полная переделка несвязанных docs-страниц, блог/CMS,
  маркетинговый копирайт (это TASK-167).

#### TASK-172 — `mcp-skill-review` · Сквозной ревью MCP и скила

- **Зачем:** TASK-166 меняет identity, scopes, approvals, pause, rollback,
  plan/apply и контракт ошибок; TASK-167/169 меняют docs и skill. Если не
  пройти MCP и `skills/janosik` целиком после этого, агент продолжит работать
  по старым инструкциям, часть tools останется без новых полей, а
  README/docs/skill разъедутся. Это отдельная задача, а не хвост 166: она
  проверяет весь продукт на живых сценариях, а не только backend-потоки.
- **Потоки:**

| ID | Поток | Что делаем | DoD |
| --- | --- | --- | --- |
| 172.1 | Tool & schema audit | все tools/schemas/descriptions/errors/`structuredContent`, новые поля, scope/destructive-аннотации, идемпотентность, `retryable`/`requestId` | матрица tools × scopes × destructive; ни один tool не обходит gate; схемы и описания актуальны |
| 172.2 | Live scenario matrix | claim → workflow block → approval → move → pause → resume → rollback; scoped/read-only/batch/plan; негативные сценарии | сценарии проходят через реальный MCP-клиент; ошибки понятны; нет обхода прав |
| 172.3 | Skill & references | `skills/janosik/SKILL.md`, `references/*`: новые lifecycle-сценарии, approval/pause/rollback/plan, scopes, reviewer flow; убрать устаревшее | skill не обещает несуществующего; агент проходит сценарии без подсказок из кода |
| 172.4 | MCP docs & release | `mcp/README.md`, `site/.../docs/mcp.md` EN/RU, tool count/pinned-тест, examples, `@janosik/mcp` version bump, CHANGELOG | README/docs/skill/tool count синхронны; version bump; examples рабочие |

- **Зависимости:** TASK-166 (166.1–166.17), TASK-167.5, TASK-169.3;
  запускать после TASK-169 и до TASK-170.
- **DoD:** полный матричный прогон; живой сценарий; tool count; README/docs/
  skill; version bump; найденные баги исправлены; новых фич нет.
- **Не входит:** новые backend-фичи; изменение контракта продукта; повторный
  ревью TASK-166 (это TASK-171).

#### TASK-170 — `docker-release` · Обновление Docker-образа

- **Зачем:** образ — то, что получает самохосетер. Сейчас база — Node 24,
  Postgres 16 и Redis 7, сборка multi-arch идёт через отдельные arch-образы,
  а для 1.0.0 нужны обновлённые базовые образы, supply-chain-артефакты и
  проверенный upgrade/rollback. Нельзя ставить `latest` на 1.0.0, не проверив
  чистой машиной и предыдущей версией.
- **Потоки:**

| ID | Поток | Что делаем | DoD |
| --- | --- | --- | --- |
| 170.1 | Base images & Dockerfile | оценить и обновить Node/Postgres/Redis на актуальные стабильные версии; Prisma engines/openssl; non-root, read-only где возможно; healthcheck; OCI labels; размер | сборка чистая; runtime не требует лишних пакетов; размер в бюджете; нет regression по upload/ffmpeg/Prisma |
| 170.2 | Supply chain & CI | multi-arch manifest, SBOM, provenance/attestations, CVE-скан (Trivy/Grype), digest pinning, cache; теги `1.0.0`, `1.0`, `1`, `latest` | RC-образы amd64/arm64; SBOM/attestation; 0 critical/high без accepted-риска; теги и digest задокументированы |
| 170.3 | Install / upgrade / rollback | clean install на amd64 и arm64; `docker compose up`; миграции на старте; upgrade с 0.2.x после бэкапа; rollback на предыдущий digest; volume-совместимость | три сценария пройдены на чистой машине; данные/вложения целы; rollback возвращает рабочий инстанс |
| 170.4 | Compose / env / docs | обновить `docker-compose.yml`, `.env.example`, `docs/SELF-HOSTING.md`, `README`, CHANGELOG; не ломать env-имена без миграции | compose/env валидны; документация по установке/обновлению/откату; upgrade-notes для 0.x → 1.0 |

- **Зависимости:** TASK-168, TASK-169 и TASK-172; запускать до TASK-171.
  Финальный `1.0.0`-тег ставит 171, 170 готовит RC и проверяет артефакт.
- **DoD:** RC-образ опубликован в GHCR; clean install/upgrade/rollback
  зелёные; SBOM/provenance/CVE-отчёт приложены; compose/.env/docs обновлены;
  образ — единственный кандидат для 1.0.0.
- **Не входит:** Kubernetes/Helm, managed-cloud-инфраструктура, object
  storage (решение — в 171, реализация — отдельно).

#### TASK-171 — `pre-cloud-1.0` · Полное ревью и версия 1.0.0

- **Зачем:** 1.0.0 — обещание стабильности и совместимости, а деплой в облако
  впервые выносит продукт за пределы «своего сервера». Нужно независимо
  проверить безопасность, данные, масштаб, эксплуатацию и релизную инженерию,
  а не только «собирается и тесты зелёные».
- **Ревью-потоки:**

| ID | Поток | Что проверяем | DoD |
| --- | --- | --- | --- |
| 171.1 | Security & access | auth/session/token/scopes, destructive gate, approvals, pause, CSRF/CORS/CSP, rate limits, upload/SSRF, prompt injection, secrets, зависимости, CodeQL | 0 P0/P1; negative-тесты; отчёт с классификацией P2 |
| 171.2 | Data & continuity | миграции 0.x → 1.0, backup/restore/PITR, retention/purge, вложения, export/import, DR, data residency | восстановление из бэкапа; миграция без потерь; rollback; runbook |
| 171.3 | Performance & scale | рой 100 агентов на доске, SSE 5k, профиль запросов/индексов, память, очереди, Redis, многодосковность; capacity plan | нагрузочный отчёт; известные пределы задокументированы; нет регрессий против baseline |
| 171.4 | Cloud readiness & ops | staging/prod topology, TLS/reverse proxy, secrets manager, managed DB/Redis, object storage решение, наблюдаемость/алерты, incident response, status page, support/SLA, privacy/DPA, AGPL/trademark | staging dry-run; алерты/runbooks; честный SLA/support; cloud checklist |
| 171.5 | Release engineering 1.0.0 | версии root/backend/ui/shared/site (и `@janosik/mcp` — синхронно или явное исключение), CHANGELOG, tag, GHCR, docs version, site, skill, release notes, migration guide | `1.0.0` во всех артефактах; тег и образы; release notes; migration/rollback guide |
| 171.6 | Independent review board | отдельные ревьюеры по security/data/perf/UX/docs/release; классификация замечаний; launch checklist | 0 P0/P1; P2 с owner/date; подписанный launch checklist |

- **Release gates (все обязательны):**
  - 0 P0/P1; P2 либо исправлены, либо приняты с owner/date и риском;
  - полный CI + Chrome E2E + contract/security suite зелёные;
  - clean install amd64/arm64, upgrade с последней 0.x, rollback;
  - backup/restore и staging dry-run в cloud-like окружении;
  - 1.0.0 в пакетах/образе/доках/сайте; `CHANGELOG` и release notes;
  - никаких заявлений на сайте, которых нет в 1.0.0 (см. TASK-167).
- **DoD:** тег `1.0.0` (подписанный) и опубликованные образы; отчёт ревью с
  классификацией; все гейты пройдены; launch checklist и rollback runbook
  подписаны; после тега — мониторинг первых 72 часов и горячая линия
  исправлений.
- **Зависимости:** TASK-166, 167, 168, 169, 170, 172.
- **Не входит:** billing/планы (TASK-131), полный multi-tenant SaaS,
  SOC2/ISO-сертификация, 24/7-поддержка, Kubernetes/Helm, переписывание
  продукта «к 1.0».

#### Отложено, но не забыто

> Всё ниже не входит в 1.0.0, но имеет явную задачу или раздел и не теряется.
> Порядок выполнения — после TASK-171, если не указано иное.

**TASK-131 `billing-subscription` — платное облако** (детали — §7.12)

- Выбор провайдера: Prodamus / ЮKassa / bePaid (Stripe/Paddle/Lemon Squeezy
  не подходят для РФ/РБ).
- Планы и лимиты per-plan в backend.
- Checkout, идемпотентные вебхуки.
- Статус подписки в UI/админке, аудит.
- Лицензионная инфраструктура: подписанные офлайн-ключи + back-office.
- Выдача managed-инстансов.
- DoD: оформление/отмена, лимиты, вебхуки, статус, e2e.

**TASK-165 workflow — phase 2 (после MVP)** (детали — §7.22)

- Jira-подобный граф-редактор и визуальная карта процесса.
- Post-functions: авто-поля, уведомления, approvals, evidence/blocking-links
  conditions, `UNDO_MOVE` с проверяемым `originalCommandId`.
- Платформенные шаблоны workflow (`WorkflowTemplate`, мастер-панель,
  «применить к доске»).
- Полноценный `ifMatch`/version-conflict для `SET_BOARD_WORKFLOW` вместо LWW
  + MCP write-tool `janosik_set_workflow`.
- Bulk move с атомарным preflight и force move для ADMIN с подтверждением и
  аудитом.
- Ограничение создания карточек только initial-колонкой.
- Аналитика отказов, счётчик заблокированных переходов в Watch, кэш/ETag.
- Durable offline-очередь: `409 workflow` как non-retryable, replay по текущим
  правилам.

**TASK-173 `agent-experience-phase2` — P1/P2 из agent-experience**

- **173.1 Subscriptions & webhooks** — `wait_for_event`, `wait_for_decision`,
  SSE `Last-Event-ID`/filters, webhooks с HMAC и retries.
- **173.2 Read model & pagination** — пагинация карточек, `GET /cards/:id`,
  глобальный поиск с cursor/snippet, board-wide comments by `kind`, `my_work`.
- **173.3 Claim visibility & my work** — claim/lease в UI, фильтр
  `claimedBy=me`, восстановление контекста после перезапуска.
- **173.4 Remote attachments** — base64/URL/presigned upload, MCP image
  content, 50–100 вложений на карточку.
- **173.5 Entity versions & create-card contract** — версии в read DTO,
  `expectedCardVersion`/`ifMatchVersions`, `create_card` с task spec/checklist,
  URL карточки в ответах.
- **173.6 Notifications & mentions** — in-app/email, `@mention`, настройки
  уведомлений (attention-события уже в 166.9).
- **173.7 Remote MCP/OAuth/OpenAPI** — streamable HTTP/SSE MCP, OAuth,
  `GET /capabilities`, OpenAPI, compatibility matrix.
- **173.8 Limits, quotas & retention** — поднять/сделать конфигурируемыми
  лимиты, серверный board cap/tenant quotas, retention/audit export.
  **2026-11-10:** `cardsPerColumn` 200→**1000** вынесено вперёд после
  TASK-139 (виртуализация) и нагрузочного теста (`docs/PERF-CAPACITY.md`);
  остальное — конфигурируемые лимиты, quotas, retention — остаётся post-1.0.
- **173.9 UX, analytics & token lifecycle** — edit комментариев и board-wide
  фильтр, короткие ключи/шаблоны, MCP undo/history filters, `X-RateLimit-*`/
  usage/cost, token rotation/multi-board, agent analytics/budgets,
  presence/heartbeat.
- **DoD:** каждый P1/P2 из agent-experience закрыт или явно отклонён с
  причиной; тесты, docs EN/RU, CHANGELOG.

**TASK-174 `human-control-phase2` — P1/P2 из human-control**

- **174.1 Comment moderation & share privacy** — модерация комментариев
  агенту board ADMIN, snapshot-share без комментариев по умолчанию + warning.
- **174.2 Account security & token lifecycle** — user 2FA и список сессий,
  token default 90 дней + rotation, invite email и notification prefs.
- **174.3 Limits, a11y & traffic/quota** — limits page и server-driven limits,
  axe в CI + a11y-фиксы, per-agent traffic/quota dashboard.
- **174.4 Service accounts & onboarding** — агент без email, провижининг из UI,
  «подключите первого агента», шаблон доски/демо.
- **174.5 Legal, SIEM, locales & marketplace** — legal/DPA/status page для
  cloud, SIEM/webhook export и audit retention, дополнительные локали,
  agent-to-agent messaging/mentions, board templates marketplace, SSO/SCIM и
  hosted control plane после облака.
- **DoD:** каждый P1/P2 из human-control закрыт или явно отклонён с причиной;
  тесты, docs EN/RU, CHANGELOG.

**TASK-175 `scale-phase2` — масштабирование**

- **175.1 Global command ceiling & sharding** — глобальный потолок команд
  (~290/с, CPU) и шардинг.
- **175.2 Multi-node & Redis fan-out** — многонодность, Redis pub/sub fan-out,
  Redis-backed token rate; presence при нескольких нодах — только после
  TASK-145.
- **175.3 Capacity & load** — capacity plan, многодоковый/многонодовый
  нагрузочный отчёт, лимиты и алерты.
- **Не трогаем:** лимит `/auth/login` 5/мин — это защита by design.
- **DoD:** нагрузочный отчёт, multi-node проверен, регрессий против baseline
  нет.

**Осознанно не входит в TASK-166** (с домами, чтобы не потерялось)

- Managed cloud, billing, DPA, status page, multi-tenant org layer —
  **TASK-131** и **TASK-171.4**.
- Полный Jira-граф и post-functions — **TASK-165 phase 2**.
- Remote MCP/OAuth как обязательный канал; webhooks — после решения W0 —
  **TASK-173.1/173.7**.
- Автоматический machine translation анонсов/комментариев — **не планируется**
  (осознанный non-goal, не задача).
- Полный SIEM/external log export; object storage для вложений — **TASK-174.5**
  и **TASK-173.4**.

#### Трассировка P0/P1/P2 из launch-gaps аудитов

> Ниже — каждый пункт из `audits/launch-gaps-agent-experience.md` и
> `audits/launch-gaps-human-control.md`. P0 закрываются в TASK-166/168,
> P1/P2 — либо в TASK-166/168, либо в TASK-173/174/175 после 1.0.0.

**Agent experience**

| Аудит | Пункт | Где в роадмапе |
| --- | --- | --- |
| P0-1 | Agent identity & session | 166.1, 166.13; service account без email — 174.4 |
| P0-2 | Approval & handoff | 166.5, 166.14 |
| P0-3 | Reliable write contract | 166.4 |
| P0-4 | Plan / apply / bulk | 166.8 |
| P0-5 | Capability scopes + destructive gate | 166.2, 166.15 |
| P1-6 | Subscriptions / webhooks | 173.1 |
| P1-7 | Read model / pagination / search | 173.2 |
| P1-8 | Claim visibility / my work | 166.13, 173.3 |
| P1-9 | Remote attachments | 173.4 |
| P1-10 | Workflow / DoD server-side | 165 MVP + 165 phase 2 |
| P1-11 | Notifications / mentions | 166.9, 173.6 |
| P1-12 | Entity versions | 173.5 |
| P1-13 | Create card contract / URLs | 173.5 |
| P1-14 | Remote MCP / OAuth / OpenAPI | 166.11, 173.7 |
| P1-15 | Docs / tests drift / MCP e2e | 172 |
| P2-16 | Limits raise | 173.8 — `cardsPerColumn=1000` pulled forward 2026-11-10; the rest post-1.0 |
| P2-17 | Board cap / tenant quotas | 166.6, 173.8 |
| P2-18 | Comment edit / board-wide filter | 173.9 |
| P2-19 | Short keys / templates | 173.9 |
| P2-20 | Retention / audit export | 173.8 |
| P2-21 | Rate headers / usage / cost | 166.10, 173.9 |
| P2-22 | MCP undo / history filters | 173.9 |
| P2-23 | SSE Last-Event-ID / filtering / image content | 173.1 |
| P2-24 | Token rotation / multi-board | 173.9 |
| P2-25 | Presence / heartbeat | 166.1, 166.13, 173.9 |
| P2-26 | Agent analytics / budgets | 173.9 |

**Human control**

| Аудит | Пункт | Где в роадмапе |
| --- | --- | --- |
| P0-1 | Agent identity & service accounts | 166.1, 166.13; `actorType`/имя токена в комментариях; service account без email — 174.4 |
| P0-2 | Approval policy + queue | 166.5, 166.14 |
| P0-3 | Pause / kill switch | 166.3, 166.14 |
| P0-4 | Run grouping + rollback | 166.7, 166.15 |
| P0-5 | Attention inbox | 166.9, 166.13, 166.14 |
| P0-6 | Launch consistency & data safety | 166.6; backup automation/restore drill — 171.2 |
| P1-1 | Per-action token scopes v2 | 166.2 |
| P1-2 | Comment moderation for board ADMIN | 174.1 |
| P1-3 | Share privacy defaults | 174.1 |
| P1-4 | User 2FA + sessions | 174.2 |
| P1-5 | Token default 90d + rotation | 174.2 |
| P1-6 | Invite email + notification prefs | 174.2 |
| P1-7 | Limits page + server-driven limits | 166.6, 166.15, 174.3 |
| P1-8 | Mobile header + E2E 390px | 168.2 |
| P1-9 | axe в CI + a11y fixes | 174.3 |
| P1-10 | Per-agent traffic/quota dashboard | 166.10, 166.15, 174.3 |
| P1-11 | Digest v2 (agents/attention) | 166.9 |
| P1-12 | Backup automation + restore drill | 166.6, 171.2 |
| P2 | Legal pages / DPA / status page | 131, 171.4 |
| P2 | Billing / plans | 131 |
| P2 | SIEM / webhook export / audit retention | 174.5 |
| P2 | Multi-node presence / Redis-backed token rate | 175.2 |
| P2 | More locales / announcement localization | announcement localization сделана; дополнительные локали — 174.5 |
| P2 | Admin redesign | в работе (`feat/admin-redesign`) |
| P2 | Advanced run analytics | 173.9 |
| P2 | Agent-to-agent messaging / mentions | 174.5 |
| P2 | Board templates marketplace | 174.5 |

Дополнительно из Phase 3 agent-experience: SSO/SCIM, hosted control plane и
marketplace-шаблоны — **TASK-174.5** (SSO/SCIM, marketplace) и **TASK-131**
(hosted control plane). Это не P2-блокеры запуска, но заведены явно.

---

### 7.26. Связи и честность мастер-панели + редактирование комментариев (TASK-176)

> **Статус:** запланировано, не входит в TASK-166.
> **Полный spec:** [`docs/TASK-176-admin-connections.md`](docs/TASK-176-admin-connections.md).
> **Источник:** независимая проверка [`design/admin-connections-review/REVIEW.md`](design/admin-connections-review/REVIEW.md) (аудит `design/admin-ui-study/MISSING-CONNECTIONS.md`).
> **База:** `main` = `5e0a05b`.

**Зачем.** Мастер-панель задумана как контур поддержки/модерации, а не второй
board-клиент. Но проверка подтвердила **4 реальных бага** и набор пробелов,
которые не являются осознанной границей: bulk между страницами применяется
только к текущей странице, глобальный поиск теряет найденный объект,
счётчики/выборки профиля и карточки выглядят полными, а прямые ссылки и
адресуемые фильтры отсутствуют. Отдельно в продукте нет базовой возможности
**отредактировать свой комментарий** — это не админская функция, а нормальный
пользовательский сценарий.

**Что осознанно не входит:** полный редактор карточки в `/admin`, право мастера
редактировать чужой текст комментария, master-раздел агентов, отдельный
браузер пунктов чек-листа. Это продуктовые решения/отложенные пункты, а не
багфиксы.

**Подзадачи.**

| ID | Что делаем | Приоритет | Волна |
| --- | --- | --- | --- |
| 176.1 | Bulk-контракт: отправлять все сохранённые ID, guard на 500, очищать выбор при смене фильтра/поиска, не терять выбор при пагинации; счётчик, confirm и запрос совпадают | P1 | 1 |
| 176.2 | **Author-only редактирование своих комментариев**: `PATCH /comments/:id`, `editedAt`, Activity/SSE `comment_updated`, inline-редактор, пометка «изменён», тесты; чужие комментарии и админский override — нет | P1 | 1 |
| 176.3 | Честные счётчики и выборки: `25 из N` / `100+`, load more/пагинация, deleted/revoked не вытесняют живые, точные totals или явная пометка «последние N» | P1 | 1 |
| 176.4 | Прямые ссылки: автор комментария, актор timeline, `lastActorId`, `invitedById`, audit target; для `OPERATOR` — текст вместо ссылки в 403 | P2 | 2 |
| 176.5 | URL-состояние списков + `returnTo`; глобальный поиск ведёт к конкретному комментарию/файлу с якорем или страницей вокруг объекта | P2 | 2 |
| 176.6 | Адресуемые фильтры `boardId` / `columnId` / `labelId`; ссылки со счётчиков доски, колонки и метки; точные ID, не поиск по имени | P2 | 2 |
| 176.7 | Per-row действия в профиле/карточке: revoke одной сессии/токена, удаление одного комментария/вложения через существующие API | P2 | 2 |
| 176.8 | Админский пилот: редактирование description и перемещение карточки через command log, с баннером «действуете от имени владельца» и audit `masterId`/`commandId` | P2 | 3, решение |
| 176.9 | Полное редактирование карточки из админки (assignee, due, priority, labels, checklists, links) — отдельное продуктовое решение | P3 | 3, решение |
| 176.10 | Связка command ↔ audit и атрибуция мастера; не менять board-facing атрибуцию без решения | P3 | 3, решение |
| 176.11 | Раздел агентов в `/admin` — не делаем; зафиксировать границу в docs/ADR | P3 | backlog |
| 176.12 | Отдельный browser пунктов чек-листа — отложено; при необходимости фильтр/поиск и якорь в карточке | P3 | deferred |

**Первая волна (P1).** 176.1 + 176.2 + 176.3. Это самый опасный баг
(подтверждённое действие тихо не выполняется), базовая пользовательская
возможность и честность данных поддержки. 176.2 требует миграции
`Comment.editedAt`, нового REST-контракта и EN/RU docs; MCP-инструмент для
редактирования комментариев — отдельный follow-up после 166.11, с явным
обновлением pinned tool count.

**Вторая волна (P2).** 176.4–176.7: дешёвые ссылки, URL/поиск, фильтры и
per-row действия. Их можно делать параллельно после первой волны.

**Третья волна (решения).** 176.8–176.10 — только после ответа на вопросы:
от чьего имени мастер правит контент, как это видно в истории доски и кто
несёт ответственность. 176.8 — минимальный пилот; полный редактор (176.9)
не начинать до него.

**DoD.** Для каждой подзадачи: тесты без ослабления ожиданий, EN/RU docs,
CHANGELOG, audit/activity для новых записей, клавиатура/фокус, `format:check`,
lint/typecheck и релевантные suite. Не менять backend-контракт без отдельного
решения, кроме 176.2 (комментарии) и 176.6 (фильтры). Всё, что уже покрыто
TASK-176, не дублировать в других задачах.

**Зависимости.** TASK-176 не зависит от TASK-166.16, но обе задачи трогают
`CHANGELOG.md`/`ROADMAP.md` и docs — при параллельном запуске разделять файлы
или мержить последовательно. 176.5/176.6 меняют `use-admin-list` и admin
list DTO; 176.2 — `Comment`/`comments` и `shared/src/api.ts`; 176.8 — только
после решения по атрибуции.

---

### 7.27. Human last mile: честные списки, share/invite и agent-owned состояние (TASK-177)

> **Статус:** запланировано, отдельно от TASK-166/176.
> **Полный spec:** [`docs/TASK-177-human-last-mile.md`](docs/TASK-177-human-last-mile.md).
> **Источники:** [`design/project-gaps-review/REVIEW.md`](design/project-gaps-review/REVIEW.md) (18 находок, статическая проверка) + [`design/ui-roast/REVIEW.md`](design/ui-roast/REVIEW.md) (живой UI 1440/1024/390 + axe-core, 9 новых находок U-01…U-09). База `main` = `a858c75`.
> **Связь:** TASK-176 закрывает bulk, admin-счётчики, admin-ссылки и author-only редактирование комментариев; TASK-177 не дублирует его, а закрывает **обычный пользовательский UI** и несколько admin-поверхностей. **Все 18 G-01…G-18 и 9 U-01…U-09 входят в TASK-177; продуктовые решения — предпосылки, а не исключения.**

**Зачем.** Проверка нашла **18 новых подтверждённых разрывов**: 0 P0, 1 P1, 6 P2, 11 P3.
Главный паттерн — **API/MCP-first, UI last mile**: сервер уже умеет share edit,
task spec, pending invite, per-board export и `notifyAttention`, но
человеческий интерфейс не доводит операцию до кнопки. Второй паттерн —
**односторонние действия + admin-only recovery**: soft-delete есть, а
пользователь после reload восстановить не может, хотя копирайт обещает
«permanently». Третий — **загруженная выборка выдаётся за полный счётчик**.

**Все находки и куда они уходят.**

| ID | Находка | Класс | Sev | Effort | Surface | Куда |
| --- | --- | --- | --- | --- | --- | --- |
| G-01 | Share-ссылку нельзя отредактировать после создания | product gap / surface asymmetry | P2 | S/M | normal UI ↔ REST/MCP | 177.1 |
| G-02 | MEMBER/VIEWER не может выйти из доски | permission asymmetry | P2 | S/M | normal UI ↔ REST | 177.2 |
| G-03 | Task spec read-only, claim невидим и снимается только завершением сессии | permission asymmetry / product decision | P2 | M | normal UI ↔ MCP | 177.4 |
| G-04 | Черновик комментария теряется при закрытии карточки | real bug / data loss | **P1** | S | normal UI | 177.3 |
| G-05 | Бейджи Comments/History считают загруженную страницу, а не всего | misleading counts | P2 | S | normal UI | 177.3 |
| G-06 | Kind комментария write-once и без фильтра | product gap | P3 | S | normal UI ↔ REST/MCP | 177.11 (author-only edit kind + filter) |
| G-07 | Pending invitation нельзя изменить/продлить/переотправить | write path without edit | P3 | S | normal UI ↔ REST | 177.8 |
| G-08 | Revoke share без подтверждения | destructive too easy | P3 | S | normal UI | 177.8 |
| G-09 | Admin shares показывает первые 100 и молчит об остальных | misleading total | P3 | S | admin UI | 177.5 |
| G-10 | Admin shares не показывает expiry; истёкшая ссылка выглядит активной | misleading status | P3 | S | admin UI | 177.5 |
| G-11 | Счётчик карточек в board switcher включает архивные | misleading count | P3 | S | normal UI | 177.8 |
| G-12 | Удаление комментария/ссылки — hover-only без touch-fallback | mobile/a11y | P3 | S | mobile UI | 177.8 |
| G-13 | Файл из «Removed from descriptions» нельзя вернуть, только удалить | UX dead end | P3 | M | normal UI | 177.9 |
| G-14 | Per-board export есть в API/доках, но не в UI | docs mismatch / missing surface | P3 | S | normal UI ↔ REST | 177.7 |
| G-15 | «Permanent» delete — soft-delete, восстановимый мастером | docs mismatch / admin-only recovery | P2 | M | normal UI ↔ admin | 177.7 |
| G-16 | `notifyAttention` и attention-inbox не имеют UI | docs mismatch / product gap | P2 | S/M | normal UI ↔ REST | 177.6 |
| G-17 | Global search обрезает 20 до группировки; board-hits исчезают | UX dead end | P3 | S | normal UI | 177.10 |
| G-18 | Тост «Board exported» при экспорте всех досок | docs/copy mismatch | P3 | S | normal UI | 177.8 |

**Дополнительные находки UI-roast (тоже в TASK-177).**

| ID | Находка | Класс | Sev | Surface | Куда |
| --- | --- | --- | --- | --- | --- |
| U-01 | `@mention` — просто текст: нет picker, уведомления и получателя | BASIC MISSING | P1 | comments / notifications | 177.12 |
| U-02 | Поиск не находит комментарии и имена вложений | BASIC MISSING | P2 | global/board search | 177.13 |
| U-03 | `/agents` показывает `0 waiting approval` при Pending 1; пустой экран без CTA | INCONSISTENT / BURIED | P2 | agents | 177.14 |
| U-04 | A11y карточки: чекбокс/progressbar без имён, фокус не возвращается, контраст, h1/main/li | BROKEN / A11Y | P2 | card / shell | 177.15 |
| U-05 | Первый борд создаётся как «New board» без имени; нет шаблона; rename невидим | INCONSISTENT | P2 | onboarding | 177.16 |
| U-06 | Удаление комментария: confirm без текста, нет undo, touch-target 22×22 | POLISH / SAFETY | P2 | comments | 177.17 |
| U-07 | Нет safe-area; лейбл карточки обрезается/уходит под hover-кнопки | POLISH / MOBILE | P3 | mobile / board card | 177.18 |
| U-08 | Нет multi-select и bulk-действий с карточками | BASIC MISSING | P3 | board | 177.19 |
| U-09 | Нет watchers/follow, saved views и assignment/due-уведомлений | PRODUCT DECISION | P3 | collaboration | 177.20 |

Дубли UI-roast не переоткрываются: edit comment — 176.2; draft — 177.3;
touch delete — 177.8; attention inbox — 177.6; self-leave — 177.2; share edit/
revoke/export — 177.1/177.7/177.8; счётчики — 177.3/177.8; search cap — 177.10;
account sessions — TASK-174.2; global approval entry — 177.6/177.14.

**Подзадачи TASK-177.**

| ID | Что делаем | Приоритет | Зависимость |
| --- | --- | --- | --- |
| 177.1 | **Share link edit**: Edit в строке share, title/`includeComments`/`includeAttachments`/`expiresAt` через существующий `PATCH`; mode/token не менять; confirm для live privacy-флагов; audit уже серверный | P2, S | G-01 |
| 177.2 | **Self-leave board**: `DELETE /boards/:id/members/me`, кнопка `Leave board` в своей строке, last-ADMIN guard, Activity/SSE, закрытие доступа и switcher | P2, M | G-02 |
| 177.3 | **Comment draft safety + honest activity counts**: module-level draft map/confirm, `50+`/`N of M` бейджи, тест >50; не терять draft при ошибке send | **P1**, S | G-04, G-05 |
| 177.4 | **Agent-owned card state**: edit/clear task spec через `SET_CARD_TASK_SPEC`, claim pill + `Release claim`, атрибуция в History; только после решения, кто владеет контрактом | P2, M | G-03, решение |
| 177.5 | **Admin shares truthful list**: pagination/total, Expires/Expired/Last viewed; не показывать первые 100 как полный список | P3, S | G-09, G-10 |
| 177.6 | **Notification preferences + attention inbox**: тумблер `notifyAttention` (PATCH уже есть) + колокольчик/инбокс с read/read-all и deep-link на board/card/approval; 173.6 остаётся для расширенного attention-контура, но базовый UI входит сюда | P2, S/M | G-16 |
| 177.7 | **Delete semantics + per-board export**: `Export this board` в Data menu через `GET /boards/:id/export`; решить true purge vs честный copy «admin can restore during retention»; user restore, если решение (б) | P2, M | G-14, G-15, решение |
| 177.8 | **Small UX batch**: pending-invite role/expiry edit, revoke confirm, switcher active-count, `no-hover:opacity-100`, export-all toast | P3, S | G-07, G-08, G-11, G-12, G-18 |
| 177.9 | **Detached attachments**: `Restore to description` или минимум Download/copy URL для файла из «Removed from descriptions»; решение зафиксировать в PR | P3, M | G-13 |
| 177.10 | **Global search grouping**: группировать Cards/Boards до cap или добавить `Show all`/`20 of N`; board-hit не должен исчезать | P3, S | G-17 |
| 177.11 | **Comment kind**: author-only edit `kind` в существующем PATCH (после 176.2) + фильтр-чипы `All/Note/Status/Question/Blocker/Evidence/Handoff`; attention dedup и `edited` marker | P3, S | G-06, 176.2 |
| 177.12 | **Mentions**: `@`-picker по участникам доски, явные mentions, attention-уведомление получателю (с opt-out), deep-link; без автора/дублей; удалённые target не воскрешают уведомление | P1/P2, L | U-01, 177.6 |
| 177.13 | **Search comments/attachments**: подключить существующий backend comment search + filename; type badge, deep-link к комментарию/файлу, `20 of N`/Show all | P2, S/M | U-02, 177.10 |
| 177.14 | **Agent approval truth + empty CTA**: `/agents` считает pending approvals и ведёт в board dialog/global inbox; пустой экран ведёт к созданию API key | P2, S | U-03, 177.6 |
| 177.15 | **A11y pass**: имена checklist toggle/progressbar, возврат фокуса, контраст AA, один h1/main, `li` в списке; axe в тестах | P2, S/M | U-04 |
| 177.16 | **First-run**: спрашивать имя доски, шаблон/пример колонок, заметный rename; убрать «New board» по умолчанию | P2, S/M | U-05 |
| 177.17 | **Comment delete safety**: confirm с цитатой/автором, undo где возможно, touch-target ≥44; не терять текст | P2, S | U-06, 177.8 |
| 177.18 | **Mobile safe-area + card metadata**: `viewport-fit=cover`, `env(safe-area-inset-*)`, лейбл не под hover-кнопками, 390/1440 | P3, S | U-07 |
| 177.19 | **Bulk card actions**: multi-select, move/archive/delete, batch/plan, partial failure, keyboard; продуктовая граница Trello/Linear | P3, M | U-08, решение |
| 177.20 | **Watchers/saved views/assignment-due notifications**: follow card/board, saved filters, attention on assign/due; opt-out и deep-link | P3, L | U-09, решение |

**Порядок.** 177.3 (P1 data-loss), 177.15 (a11y), 177.17 (delete safety) —
первый маленький набор. 177.1 + 177.5 + 177.8 + 177.16 + 177.18 — вторая
UI-волна. 177.2, 177.6, 177.13, 177.14 — отдельными PR. 177.10 + 177.11 +
177.12 — после первой волны (177.11 после 176.2). 177.4/177.7/177.9/177.19/
177.20 — с зафиксированным решением из §4 spec; они не выпадают из задачи,
если решение принимается дольше.

**Продуктовые решения, которые фиксируем в рамках 177.** Если владелец не
выберет иначе, использовать recommended default из spec §4; это не исключает
пункт из задачи, а задаёт вариант реализации.

1. **Task spec/claim (G-03):** board ADMIN/MEMBER могут править/очищать контракт; claim виден всем, release — claim owner и board ADMIN, с Activity.
2. **«Permanent» delete (G-15):** оставить soft-delete, убрать слово «permanently», честный copy + user-facing **Recently deleted** на retention; true purge не делать.
3. **Self-leave (G-02):** MEMBER/VIEWER могут выйти; последний ADMIN — нет; контент остаётся с обычной атрибуцией.
4. **Share edit (G-01):** title/флаги/expiry можно менять; mode/token неизменны; live privacy-флаги — с confirm и audit.
5. **Detached attachments (G-13):** `Restore to description` + Download/copy URL; отдельный backend re-attach — только если клиентского append недостаточно.
6. **Global search (G-17):** группировать Cards/Boards до cap; board-hit не терять; `20 of N`/Show all.
7. **Attention inbox (G-16):** сделать тумблер и базовый bell/inbox read/read-all сейчас; 173.6 остаётся для расширенного контура.
8. **Comment moderation:** author-only edit/kind; удаление чужих комментариев board ADMIN — отдельное решение, в 177 не добавляем молча.
9. **User restore (G-15):** **Recently deleted** на retention, как в п. 2.
10. **Mentions (U-01):** делать `@`-picker, явные mentions и attention-уведомления; если решим не делать — убрать `@` из копирайта, а не оставлять текстом.
11. **Bulk actions (U-08):** нужны ли multi-select/move/delete; для Trello-класса можно поздней волной, но пункт остаётся в 177.
12. **Watchers/saved views/assignment-due (U-09):** объём follow/saved views и уведомлений; можно разбить на волны, но не выбрасывать из 177.

**DoD.** Для каждой подзадачи: EN/RU copy, unit/component + backend/e2e где
есть поведение, `CHANGELOG.md`, никаких ослабленных тестов, keyboard/touch
проверка, 390 px для UI, audit/activity для новых записей; для 177.15 —
axe-core light/dark; для 177.13 — comment/attachment hits и deep-link.
Не смешивать с TASK-176 и board-settings redesign; 177.3 не должен ломать
176.2, а 177.4 — не начинать до ответа по атрибуции.

---

### 7.28. Agent surfaces: глобальный inbox, board console, policy (TASK-179)

> **Статус:** запланировано; baseline `main` = `fc6c3e7` (166.17 и 178 уже в main). Independent review (2026-11-12) принят; резолюции — spec §11.
> **Полный spec:** [`docs/TASK-179-agent-surfaces-redesign.md`](docs/TASK-179-agent-surfaces-redesign.md); review — [`docs/TASK-179-independent-review.md`](docs/TASK-179-independent-review.md).
> **Дизайн:** [`design/agents-surface-redesign/REPORT.md`](design/agents-surface-redesign/REPORT.md) + [`design/agent-control-redesign/REPORT.md`](design/agent-control-redesign/REPORT.md); интерактивный эталон — [`design/agent-surfaces-prototype/index.html`](design/agent-surfaces-prototype/index.html).
> **Normative decision:** прототип главнее отчётов, но пока 179.12 не синхронизировал его со спекой, правила §3/§4/§11 главнее прототипа. Board-модалка остаётся Inbox/Live/Runs, Policy — только в Board Settings. Первый отчёт с «удалить модалку и перенести approvals/pause в Board Settings» не принят.

**Зачем.** Сейчас два одинаковых Bot-icon ведут в разные места, при переходе на
`/agents` пропадают board-scoped контролы, pending approvals показываются как
три разных числа, MEMBER получает 403 на видимой вкладке, а Agent Control
смешивает approvals, pause, runs и policy в четыре равные вкладки. Нужны три
честных слоя: **глобальная осведомлённость → действие на доске → настройка**.

**Целевая IA.**

1. **`/agents`** — глобальная страница-инбокс: Attention (pending approvals +
   stale sessions), Sessions (board-first), Runs; board scope, поиск, deep
   links; scope-correct count и `99+`.
2. **Board-scoped Agent Control** — одна модалка в shell Board Settings:
   вертикальный rail **Inbox / Live / Runs**; Policy здесь больше нет.
3. **Board Settings → Agents & automation** — destructive mode,
   `requireApprovalFor`, лимиты, TTL, approver roles, reset, dirty/CAS;
   верхний rail `Workflow | Agents & automation`.
4. **Один board Bot-icon** и один глобальный вход `Agents`; duplicate удалить.
   `/agents/:tokenId` сохраняется как deep link.
5. **MEMBER/VIEWER** не видят approvals; Live и Runs read-only; никаких
   403+Retry.
6. **Stop token/all** — только owner в Account → API keys; board ADMIN может
   board pause и session pause/resume/end.
7. **Read-only `/agents` aggregation** (§179.10) — **session-only**, глобальные
   approvals/runs/sessions, cursor/total, display names, per-board accepted
   memberships; никаких PAT/членских записей и никаких writes.
8. **TASK-177.14** поглощён 179.2/179.3; **TASK-177.6** остаётся владельцем
   bell/attention inbox.
9. **179.12** синхронизирует прототип со спекой (убрать Stop token/all из
   Live, approval count из bell, выдуманный diff, member Board Settings).

**Подзадачи.**

| ID | Что делаем | Приоритет |
| --- | --- | --- |
| 179.1 | Один board Bot-icon, один глобальный `Agents`, route-aware шапка, `/agents/:tokenId`, focus | P1 |
| 179.2 | `/agents` shell: Attention/Sessions/Runs, board scope, поиск, URL state, refresh/updated, empty CTA, partial error, mobile | P1 |
| 179.3 | Attention/approvals: Needs/Decided/All, все статусы, approve/reject/cancel, hash/risk/TTL, human summary, expired; TASK-177.14 absorbed | P1 |
| 179.4 | Sessions/Live: board/token grouping, lifecycle vs heartbeat, pause/resume/end, board pause, claims; **без stop token/all** | P1/P2 |
| 179.5 | Runs: named filters, total/load more, detail/retry, diff/preimages (ADMIN), preview/revert, conflicts, read-only | P1/P2 |
| 179.6 | BoardSettingsShell: верхний rail `Workflow / Agents & automation`, dirty/scroll/mobile | P2 |
| 179.7 | Policy в Board Settings: destructive/triggers/limits/TTL, dirty/CAS/reload/reset; убрать Policy tab из модалки | P2 |
| 179.8 | Scope-correct `usePendingApprovals`, `99+`, permissions, member no-403, mixed-role | P1 |
| 179.9 | Custom combobox, badges, typography (RU body stack), 1024/390, a11y/focus/lazy fallback | P1/P2 |
| 179.10 | Read-only `/agents` aggregation API: **session-only**, overview/approvals/runs, effective expiry без writes, sorting/cursor/total, names, accepted memberships | P1 |
| 179.11 | URL/testid migration, cleanup, EN/RU docs, CHANGELOG, unit/browser/mobile tests, visual acceptance | P2 |
| 179.12 | Sync prototype with spec: remove Stop token/all from Live, approval count from bell, fabricated diff, member Board Settings; fix scope count, mixed roles, sorting, run links, own-token link, 44 px actions, per-board freshness | P1 |

**DoD.** Все 12 подзадач закрыты; independent review §11 закрыт; `/agents` и
Agent Control используют одни hooks/components для approvals/runs; Policy
существует только в Board Settings; count scope-correct (board icon ≠ All
boards sum, не «одно число везде»); MEMBER/VIEWER не делают запрещённых
запросов; 179.10 session-only, effective expiry без writes, cursor/total/names;
179.7 делает field-level CAS merge; 179.12 синхронизировал прототип; 1440/1024/
390 совпадают с **tracked** прототипом; focus/keys/a11y; тесты не ослаблены;
EN/RU docs и CHANGELOG. **Зависимости:** TASK-166.17 и TASK-178 уже в main;
179.10 — единственная новая backend-фича (read-only), остальное —
переиспользование существующих API.

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
