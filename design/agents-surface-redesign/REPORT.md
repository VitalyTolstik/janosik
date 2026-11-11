# Агенты в Janosik: аудит поверхности и редизайн

Дата: 11 ноября 2026.
Ветка: рабочее дерево на `c6688f3` (поверх `main` `360938b`).
Проверено на запущенном приложении: UI `http://localhost:5173`, API `http://localhost:3000`.

Артефакты:

- `design/agents-surface-redesign/REPORT.md` — этот отчёт.
- `design/agents-surface-redesign/screenshots/` — снимки текущего состояния, размеченные доказательства, предложенные макеты, замеры и консольные логи.

Данные: для проверки созданы одноразовые аккаунты и две доски (`Agent Ops Demo`, `Website Relaunch`) через публичный API; существующие доски и данные пользователя не изменялись. Фикстуры: один PAT, две agent-сессии, одна pending-заявка на `DELETE_CARD`, участник с ролью MEMBER. Все экраны сняты на чистых досках.

---

## 1. Executive verdict

Под капотом агентская часть сильнее, чем её интерфейс. Есть точный plan hash, риск, срок жизни approval, audit trail, SSE, пауза на уровне доски/сессии/токена, dry-run rollback и deep links. Но **поверхность организована по слоям реализации, а не по задачам человека**:

1. **Человек не понимает, где он и что перед ним.** В шапке две одинаковые иконки `Bot` с разным смыслом: одна уводит на глобальную страницу, вторая открывает модалку управления доской. После клика по первой исчезают название доски, «Участники», «Доступ», «Управление агентами» и «Настройки доски»; после клика по второй шапка затемняется overlay'ем, а на 1024/390 физически оказывается под диалогом.
2. **`/agents` выглядит как дашборд, но не отвечает на главный вопрос — «что требует меня сейчас?».** Четыре KPI-карточки смешивают агентов, сессии и approvals; счётчик «Waiting approval» равен нулю при реальной pending-заявке; списка approvals на странице нет; строка агента агрегирует сессии разных досок и показывает одновременно «2 live» и «STALE».
3. **Board-scoped контроль — это второе приложение внутри доски.** Модалка «Agent control» содержит approvals, pause, runs и policy. Policy — это настройка доски на 17 чекбоксов с внутренним скроллом; runs — история, которая логичнее живёт в глобальном консоле; approvals — очередь, которую пользователь ищет в `/agents`. В результате три разных поверхности конкурируют за одни и те же данные, а MEMBER при открытии вкладки Approvals получает 403.

Ощущение «неправильно» возникает не из-за отдельных пикселей, а из-за **трёх конфликтующих контекстов**:

- **глобальный** (`/agents`: все доски, все агенты, история);
- **досковый** (`Agent control`: approvals/pause/policy этой доски);
- **карточный** (claim/attribution/current card).

Пользователь не видит границы между ними, потому что входы выглядят одинаково, а шапка меняет состав контролов в зависимости от маршрута.

**Рекомендуемая IA — комбинация, а не «или страница, или модалка»:**

- `/agents` — **глобальная страница** (не вкладка вида доски и не модалка), с дефолтной секцией **Attention**: approvals + сессии без heartbeat, затем Sessions и Runs, с фильтром по доске.
- Board-scoped настройки и очередь — **вкладка `Agents` внутри Board Settings** (тот же shell, что уже принят для workflow): approvals этой доски, пауза, policy. Отдельная модалка `Agent control` удаляется.
- В шапке остаётся **один** вход `Agents` — в глобальном правом кластере, с бейджем pending approvals. Board settings остаётся шестерёнкой; вкладка `Agents` внутри неё не является «второй иконкой».
- Board/Calendar/Table/Watch **не трогаем**. Пятая вкладка «Агенты» была бы ложной: виды доски — это линзы одной доски, а агенты — кросс-досковый inbox. Связь с доской делается через фильтр `?board=`, ссылки из Watch и карточки.

Одна фраза: **глобальная страница отвечает «кому нужно решение», Board Settings — «как настроена автоматизация этой доски», а карточка — «кто и что с ней делает».**

### 1.1. Что уже было известно

Этот отчёт не первый:

- `design/ui-roast/REVIEW.md:206` — «`/agents` показывает 0 waiting approval при Pending 1»; `:208` — пустой `/agents` без CTA; `:384` — approvals excellent в модалке, но нет глобального входа.
- `docs/TASK-177-human-last-mile.md:199` — U-03: то же самое плюс empty CTA.
- `design/project-gaps-review/REVIEW.md` — G-03: claim/task spec не видны в карточке, освобождение claim только через `/agents`.

Новое в этом отчёте:

- воспроизведена **потеря пяти контролов шапки** при переходе на `/agents` и найден точный механизм (`board === undefined` + условный рендер), а не «визуальный глюк»;
- измерено, что модалка **перекрывает шапку** на 1024 (40 из 56 px) и 390 (28 из 36 px второго ряда), включая `aria-hidden` и `pointer-events: none`;
- доказано, что **MEMBER гарантированно получает 403** на вкладке Approvals, хотя вкладка ему показана; `readOnly`-ветка в `ApprovalsPanel` недостижима;
- найдены **две идентичные Bot-иконки** и объяснено, почему они не анимированные, хотя соседние иконки — `LazyAnimatedIcon`;
- показано, что **focus после закрытия уходит в `BODY`**, а табы — не `tablist`, а `group` с `aria-pressed`;
- измерен **внутренний горизонтальный overflow** табов на 390 (5 px) и разная высота вкладок (24 vs 40 px);
- предложена проверяемая IA с глобальным approvals inbox, board-first группировкой и переносом policy/pause в Board Settings.

---

## 2. Воспроизведённые баги

Сводка:

| ID | Severity | Что сломано | Где |
| --- | --- | --- | --- |
| B1 | **P1** | Переход на `/agents` удаляет из шапки title, Members, Share, Agent control, Board settings; для VIEWER возвращает Undo/Redo | `Header.tsx`, `BoardContext.tsx` |
| B2 | **P1/P2** | Модалка Agent control перекрывает/затемняет шапку; на 1024/390 иконки физически под диалогом | `AgentControlDialog.tsx:92`, `dialog.tsx:23,58` |
| B3 | **P1** | Две одинаковые Bot-иконки с разным поведением; обе статические, не из animated-набора; на touch без tooltip | `Header.tsx:71-94`, `AgentControlButton.tsx` |
| B4 | **P1** | `/agents` показывает 0 waiting approval при 1 pending; approvals вообще нет на странице | `AgentsPage.tsx:74-83`, `agent-model.ts:184` |
| B5 | **P2** | «2 live» и «STALE» одновременно; `stale` подменяет статус сессии | `agent-model.ts:95-97`, `AgentsPage.tsx:423-427` |
| B6 | **P1** | MEMBER открывает Approvals и получает 403 + «Could not load the approval queue» | `AgentControlDialog.tsx:110-129`, `ApprovalsPanel.tsx:443-445` |
| B7 | **P2** | Фокус после Escape уходит в `BODY`; табы не `tablist`; близкие к 16–24 px цели | `AgentControlDialog.tsx:104-131` |
| B8 | **P2** | На 390 табы переносятся, «Policy & limits» обрезана, внутренний overflow 5 px | `AgentControlDialog.tsx:92,104-131` |
| B9 | **P2/P3** | Empty state без CTA; error с нулём строк оставляет пустоту; `lastLoadedAt` не показан; `<title>` не меняется | `AgentsPage.tsx:325-331`, `use-agent-sessions.ts:38` |
| B10 | **P2** | Policy — настройка доски — живёт в модалке управления, с внутренним скроллом и Save ниже фолда | `PolicyPanel.tsx` |
| B11 | **P2** | На 390 в шапке 15 контролов, 9 в первом ряду; title обрезается; иконки 16–36 px и разные наборы | `Header.tsx`, `lazy-animated-icon.tsx` |

### B1. «Кликаю по агенту — исчезают остальные иконки»

**Severity: P1. Воспроизведено вживую.**

Шаги:

1. Открыть доску `Agent Ops Demo` под ADMIN, 1440×900.
2. Зафиксировать левый кластер шапки: brand, `Agent Ops Demo` (h2), switch, bell, Members, Share, Agents (Bot #1), Agent control (Bot #2), Board settings, presence. Всего 10 элементов, 9 из них интерактивные/название.
3. Нажать **первую** Bot-иконку (`aria-label="Agents"`, `data-testid="agents-trigger"`, `<Link to="/agents">`).
4. URL меняется на `/agents`. В шапке остаются: brand, switch, bell, Agents (один Bot), presence. **Пять сущностей исчезают:** BoardTitle, Members, Share, Agent control, Board settings.
5. Нажать Back — они возвращаются. Значит, это не анимация, не `display:none` и не overlay, а **размонтирование по условию маршрута**.

Замеры (`getBoundingClientRect`, 1440×900):

| Элемент | До, x/width | После |
| --- | --- | --- |
| Board title | 68 / 167.25 | — |
| Switch board | 247.25 / 24 | 68 / 24 |
| Notifications | 283.25 / 36 | 104 / 36 |
| Members | 331.25 / 32 | — |
| Share | 375.25 / 36 | — |
| Agents (link) | 423.25 / 36 | 152 / 36 |
| Agent control | 471.25 / 36 | — |
| Board settings | 519.25 / 36 | — |
| Presence | 567.25 / 0 | 200 / 0 |

DOM/скриншоты:

- `screenshots/22-header-before-1440-annot.png`
- `screenshots/23-header-after-1440-annot.png`
- `screenshots/24-header-crop-2x.png`
- `screenshots/header-dom-before-after.json`
- `screenshots/25-annotated-evidence.png`

Причина — цепочка, а не один селектор:

1. `ui/src/store/BoardContext.tsx:558-571`:
   ```ts
   const routeBoardId =
     matchPath(routes.boardPattern, location.pathname)?.params.boardId ?? null;
   const board = routeBoardId
     ? state.find((b) => b.id === routeBoardId && ...)
     : undefined;
   ```
   На `/agents` `routeBoardId = null`, поэтому `board === undefined`, а `role` тоже `undefined` (`BoardContext.tsx:1763-1770`).
2. `ui/src/components/board/BoardTitle.tsx:38` — `if (!id) return null;`.
3. `ui/src/components/board/BoardMembersDialog.tsx:339` — `if (!isApiEnabled() || !board) return null;`.
4. `ui/src/components/board/ShareDialog.tsx:56` — `if (!isApiEnabled() || !board || roleOf(board.id) !== "ADMIN") return null;`.
5. `ui/src/components/agent-control/AgentControlButton.tsx:53-55` — `if (!isApiEnabled() || boardId === undefined) return null;`.
6. `ui/src/components/Header.tsx:95-110` — настройки рендерятся только при `role === "ADMIN"`; `role` на `/agents` — `undefined`, значит кнопки нет.
7. `ui/src/components/Header.tsx:71-86` — единственный контрол, который остаётся, это глобальная ссылка `Agents`.

Дополнительный permission-эффект: `Header.tsx:54` считает `readOnly = role === "VIEWER"`. На `/agents` `role = undefined`, поэтому `!readOnly` истинно и **Undo/Redo рендерятся даже для VIEWER** (на доске они скрыты). В нашем ADMIN-прогоне они были видны, но disabled; для VIEWER это нарушает комментарий «A VIEWER has no mutating affordances» (`Header.tsx:52-54`). Это code-read, не отдельный runtime-прогон под VIEWER.

Почему это ощущается как баг, а не как «глобальная страница»:

- нет breadcrumb «Agent Ops Demo / Agents» в шапке;
- остаётся `Switch board`, но без названия текущей доски — шеврон без контекста;
- исчезают именно **board-scoped** контролы, а глобальные (search/help/data/account) остаются; шапка превращается в недособранную смесь;
- пользователь не понимает, ушёл ли он со страницы доски или что-то сломалось.

Что должно быть: либо **осознанная глобальная шапка** (brand + breadcrumb `Agents` + search/bell/account, без board controls), либо board-шапка с явным `All boards`-контекстом. Сейчас — случайное третье состояние.

### B2. Модалка Agent control перекрывает шапку

**Severity: P1/P2. Воспроизведено на 1440, 1024, 390.**

Шаги:

1. 1024×768, доска, нажать **вторую** Bot-кнопку (`Agent control`).
2. Диалог `1000×736` стоит с `top: 16px`; шапка занимает `0–56px`.
3. Фактически 40 px шапки под диалогом; видны только верхние 16 px. На 390×844 диалог `366×736` начинается с `y=54`; второй ряд шапки `46–82` перекрыт на 28 px из 36.
4. На 1440 диалог `1024×736` стоит с `y=82`, шапка видна, но затемнена overlay'ем `bg-black/60` + `backdrop-blur-sm`; иконки читаются как «пропали».

Замеры:

| Viewport | Header | Dialog | Перекрытие |
| --- | --- | --- | --- |
| 1440×900 | 0–56 | y=82, h=736 | overlay/затемнение, не геометрическое |
| 1024×768 | 0–56 | y=16, h=736 | 40 px шапки |
| 390×844 | 0–89 (2 ряда) | y=54, h=736 | 28 px второго ряда (46–82) |

DOM в момент открытия:

- `document.body.dataset.scrollLocked = "1"`, `body { pointer-events: none }`;
- `header[aria-hidden="true"]`, `header { pointer-events: none }`;
- overlay: `position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.6); backdrop-filter: blur(4px)`.

Код:

- `ui/src/components/agent-control/AgentControlDialog.tsx:92`:
  `className="flex h-[min(46rem,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] ... sm:max-w-5xl"`.
  При 768 px `46rem = 736`, `calc(100dvh - 2rem) = 736`; центрирование даёт `top:16`.
- `ui/src/components/ui/dialog.tsx:23` — overlay;
- `ui/src/components/ui/dialog.tsx:58` — `fixed inset-0 m-auto ... max-h-[calc(100dvh-2rem)]`;
- `ui/src/components/ui/dialog.tsx:67` — close 16×16 (`h-4 w-4`, без padding).

Для сравнения: `BoardSettingsDialog.tsx:93` на `<md` делает **полноэкранный** режим (`max-md:m-0 max-md:h-[100dvh] max-md:w-full max-md:rounded-none`). AgentControlDialog этого не делает, поэтому на мобильном получается «плавающий» диалог, который обрезает шапку, вместо полноэкранного режима.

Важно: сам overlay — нормальное поведение модалки. Проблема в **несоответствии аффорданса**: маленькая icon-only кнопка в шапке открывает полноэкранную поверхность, которая забирает контекст. Если это настройки/контроль — пользователь должен видеть явный заголовок и понимать, что шапка ушла осознанно; если это быстрый просмотр — он не должен перекрывать шапку. Сейчас нет ни того, ни другого.

Скриншоты: `screenshots/10-agent-control-approvals-1440.png`, `21-agent-control-1024.png`, `16-agent-control-open-390.png`, `25-annotated-evidence.png`.

### B3. Две одинаковые Bot-иконки: что каждая делает и почему обе существуют

**Severity: P1. Воспроизведено и подтверждено DOM.**

| | Иконка 1 (левее) | Иконка 2 (правее) |
| --- | --- | --- |
| Компонент | `Header.tsx:71-86` | `Header.tsx:87-94` → `AgentControlButton.tsx` |
| DOM | `<a data-testid="agents-trigger" href="/agents">` | `<button data-testid="agent-control-trigger">` (ADMIN) / `agent-runs-trigger` (MEMBER/VIEWER) |
| `aria-label` | `Agents` | `Agent control` / `Agent runs` |
| Действие | переход на глобальную страницу `/agents` | открывает модалку на текущей доске |
| Бейдж | нет | pending approvals (только ADMIN), красный `bg-danger` |
| Роль | все | все; содержимое зависит от роли |
| Иконка | `<Bot className="h-5 w-5">` | `<Bot className="h-5 w-5">` |
| Размер/стиль | ghost icon 36×36 | ghost icon 36×36, `relative` |
| Анимация | нет | нет |

Обе иконки — **обычный `Bot` из `lucide-react`**, `viewBox 0 0 24 24`, `stroke-width=2`, отрисованный в 20×20. Это не «сломанная» иконка; это **два одинаковых глифа для двух разных сущностей**.

Почему пользователь говорит «не Lucide animated»: в шапке соседние bell/settings/undo/redo используют `LazyAnimatedIcon` (`Header.tsx:17,105,133,148`; `ui/src/components/ui/lazy-animated-icon.tsx`). В списке `AnimatedIconName` (`:27-43`) **нет `bot`**, поэтому агентские кнопки никогда не оживают, даже после idle. На скриншоте `24-header-crop-2x.png` видно: слева от шестерёнки стоят две одинаковые статические Bot-иконки; badge есть только у второй.

Почему обе появились:

- комментарий `routes.ts:19` и `AgentControlButton.tsx:15-22` относят глобальную страницу к TASK-166.13, а модалку — к TASK-166.14/166.15. Это два инкремента, которые не свели к одному входу.
- глобальная страница умеет sessions/heartbeat/detail, но **не умеет approvals**; модалка умеет approvals/pause/policy, но не умеет fleet-обзор. Поэтому «убрать одну» без переноса функций нельзя: нужно сначала перенести board-scoped панели в Board Settings, а approvals — в глобальный inbox.
- на touch tooltip'ы скрыты (`ui/src/index.css:21-23`: `html[data-input="touch"] [role="tooltip"] { display:none }`). На 390 обе кнопки выглядят абсолютно одинаково; aria-label есть только у screen reader.

Что должно быть: **один вход `Agents`** в глобальном правом кластере; board-scoped control — внутри Board Settings; `Bot` остаётся только у глобального входа, а вкладка настроек использует `ShieldCheck`/`ClipboardCheck` (смысл «human control»), чтобы глифы не дублировались.

### B4. `/agents` врёт про waiting approval и не показывает approvals

**Severity: P1. Воспроизведено с реальной pending-заявкой.**

Фикстура:

1. На доске `Agent Ops Demo` создан PAT `Claude Code — audit` и сессия `Refactor approval flow` (active).
2. Агент отправил `DELETE_CARD` для карточки `Card claim visibility` → API вернул `409 approval_required`, `approvalId=cmwc73kxl…`, `planHash=da83a761…`.
3. `GET /api/v1/boards/cmwc73kje001bids376su3vvx/approvals?status=pending` возвращает **1** заявку.
4. На доске вторая Bot-кнопка показывает badge **1**.
5. `/agents` в это же время показывает **0 WAITING APPROVAL** (1440, 1024, 390), а detail-страница токена — **0 WAITING APPROVAL**.

Почему:

- `ui/src/components/agents/AgentsPage.tsx:74-83`:
  ```ts
  waiting: filtered.filter((row) => row.status === "waiting_approval").length;
  ```
  Это **статус сессии**, а не approval-запрос. Заявка на `DELETE_CARD` не обязана менять статус сессии; в фикстуре сессия осталась `active`.
- `ui/src/components/agents/agent-model.ts:184` и `:192` — `waitingCount` также считается по `row.status === "waiting_approval"`.
- `ui/src/components/agents/use-agent-sessions.ts:74-82` загружает только `listBoards`, `listTokens`, `me` и `listAgentSessions` по доскам; **`listApprovals` не вызывается**.
- `AgentsPage` не содержит ни секции approvals, ни ссылки на approval; единственный UI approvals — board-модалка.

Следствие: экран, который должен быть inbox'ом для человека, говорит «0», пока destructive-удаление ждёт решения. Это не «мелкий счётчик»: это пропущенный human-in-the-loop шаг. Ранее это отметил `ui-roast`; здесь показан механизм и фикстура.

Скриншоты: `screenshots/07-agents-page-1440-clean.png` (0), `14-agent-detail-1440.png` (0), `23-header-after-1440-annot.png` (0), `10-agent-control-approvals-1440.png` (1 в модалке). API-ответ зафиксирован в тексте выше.

### B5. «2 live» и «STALE» одновременно

**Severity: P2. Воспроизведено.**

На `/agents` строка токена показывает:

- зелёный бейдж `2 live`;
- жёлтый бейдж `STALE`;
- подпись «Landing page rewrite»;
- чипы двух досок.

На detail-странице каждый session card показывает одновременно `ACTIVE` и `STALE`. Это два взаимоисключающих слова для обычного пользователя.

Код:

- `ui/src/components/agents/agent-model.ts:95-97` — `isLiveSession` смотрит только `endedAt === null` и terminal status; `stale` не учитывается.
- `ui/src/components/agents/agent-model.ts:200-206` — группа сортируется по `liveCount`, затем `waitingCount`.
- `ui/src/components/agents/AgentsPage.tsx:423-427` — если **хотя бы одна** сессия группы stale, показывается `AgentStaleBadge` **вместо** статуса. Поэтому статус `active`/`waiting_approval` исчезает.
- `ui/src/components/agents/AgentDetailPage.tsx:181-192` и `:303-310` — на detail показываются оба бейджа.
- `ui/src/components/agents/agents-ui.tsx:37-51` — stale — отдельный бейдж с точкой.

Правильная семантика: `Stale` — это не lifecycle-статус, а **возраст heartbeat**. Нельзя ставить его в один ряд с `Active`/`Waiting approval`; нужно писать `Active · no heartbeat for 6 min` (или `No heartbeat · 6 min`) и не заменять им статус. Для группы из двух сессий нужно показывать `2 sessions · 1 active · 1 no heartbeat`, а не `2 live` + `STALE`.

Скриншоты: `23-header-after-1440-annot.png`, `14-agent-detail-1440.png`, `07-agents-page-1440-clean.png`.

### B6. MEMBER открывает Approvals и получает 403

**Severity: P1. Воспроизведено под MEMBER.**

Шаги:

1. Владелец приглашает второго пользователя на `Agent Ops Demo` с ролью MEMBER; тот принимает приглашение.
2. MEMBER открывает доску и нажимает вторую Bot-кнопку — она называется **`Agent runs`** и стартует на вкладке Runs.
3. В диалоге видны вкладки `Approvals`, `Pause & sessions`, `Runs & rollback` (Policy скрыта как admin-only).
4. Клик по `Approvals` → запрос `GET /boards/.../approvals?status=pending` → **403**; в UI «Could not load the approval queue» + Retry. В консоли две ошибки 403.

Код:

- `ui/src/components/agent-control/AgentControlDialog.tsx:110-129` фильтрует только `adminOnly` (policy); Approvals и Pause показываются всем.
- `ui/src/components/agent-control/ApprovalsPanel.tsx:443-445` вызывает `api.listApprovals(...)` без проверки `admin`.
- `ui/src/components/agent-control/ApprovalsPanel.tsx:491-495` использует `admin` только для `canDecide`; `:704-707` содержит read-only предупреждение, но до него не доходит, потому что список падает.
- Сервер: `backend/src/approvals/approvals.service.ts:161-164` — `if (!admin && principal?.via !== "pat") throw boardAdminOnly()`. MEMBER с JWT не имеет права читать очередь. Это осознанное правило, но UI его не учитывает.
- `AgentControlButton.tsx:57-60` для MEMBER использует label `agentControl.runs.button` («Agent runs»), хотя в диалоге остаются approvals/pause — обещание «runs» не соответствует содержимому.

Следствие: участник доски видит сломанную вкладку и ошибку доступа в обычном сценарии, хотя ему обещали read-only runs. Это подрывает доверие к permission-модели.

Правильно: для MEMBER/VIEWER **не рендерить Approvals вообще** (или рендерить явный read-only экран без запроса, если продукт решит показывать факт существования заявок). `Agent runs` должен открывать Runs, а не смешивать три вкладки.

Скриншот: `screenshots/18-approvals-member-readonly-1440.png`; консоль: `screenshots/18-console-403.txt`.

### B7. Фокус, табы и размеры целей

**Severity: P2. Воспроизведено.**

Фокус:

1. Сфокусировать `agent-control-trigger` с клавиатуры, нажать Enter.
2. Нажать Escape.
3. `document.activeElement` → `BODY`, а не trigger.

В `BoardSettingsDialog.tsx:41-57` это уже решено явно: после закрытия `requestAnimationFrame` возвращает фокус на `[data-testid="board-settings-trigger"]`. В `AgentControlDialog` такого нет; Radix не может восстановить фокус на внешний trigger, потому что trigger не является `DialogTrigger`.

Табы:

- `AgentControlDialog.tsx:104-131`: `role="group"` + `aria-pressed` на кнопках; нет `role="tablist"`, `role="tab"`, `aria-controls`, `role="tabpanel"`.
- Screen reader слышит «toggle button pressed», а не «tab 1 of 4».
- Высота вкладок 24 px (1440/1024), 24–40 px на 390; close — 16×16 (`dialog.tsx:67`).
- Focus-порядок: tabs → filters → row → Approve → Reject → Close → loop. Это работает, но без семантики tabpanel.

Правильно: Radix Tabs (он уже есть в зависимостях) или ручной roving tabindex; высота 32–36 px на desktop и ≥44 px на touch; close 32×32; вернуть фокус на trigger.

### B8. 390: табы переносятся, последняя вкладка обрезана

**Severity: P2. Воспроизведено.**

Замеры при 390×844:

- dialog: `x=12, y=54, w=366, h=736`;
- `dialog.scrollWidth = 371`, `dialog.clientWidth = 366` → **5 px горизонтального overflow**;
- tab group: `x=29, w=355.44`, правая граница `384.44` при правой границе диалога `378`;
- `Policy & limits` right edge `379.4` → обрезана;
- `Approvals` height 24 px, `Pause & sessions` / `Runs & rollback` / `Policy & limits` — 40 px из-за переноса строки (line-height 16, 2 строки), при этом `Approvals` остаётся 24 px. Ряд выглядит рваным.

Причина: `AgentControlDialog.tsx:104-131` — inline-flex группа без `flex-wrap`/`min-w-0`/адаптивного режима; базовый `px-2.5 py-1` и `text-xs` не рассчитаны на 4 русских/английских названия в 366 px. На 390 нужен другой паттерн: 2×2 сетка, вертикальный список или `<select>`; а лучше — полноэкранная страница/шит, как в Board Settings.

Скриншот: `screenshots/16-agent-control-open-390.png`, `25-annotated-evidence.png`.

### B9. Empty/error/freshness/title

**Severity: P2/P3. Воспроизведено частично, остальное — code-read.**

- Empty state `/agents` (`AgentsPage.tsx:325-331`, `EmptyState` `:532-556`) говорит «Create a personal API token…», но **не содержит ссылки** на Account → API keys и не объясняет, где создать токен. Это тупик первого запуска (уже U-03). В нашем фильтрованном empty (`?board=does-not-exist`) есть только Clear filters — это правильный локальный state, но не first-run.
- Error с нулём строк: `AgentsPage.tsx:325-326` возвращает `null` внутри списка, поэтому под баннером ошибки остаётся пустая область; нет централизованного error state с Retry (Retry есть только в баннере).
- `use-agent-sessions.ts:38` возвращает `lastLoadedAt`, но страница его **не использует**. Нет «Updated 12s ago»; пользователь не знает, свежие ли данные, хотя есть polling 30s и SSE.
- `<title>` приложения всегда «Janosik — Boards»; на `/agents` и `/agents/:tokenId` нет «Agents — Janosik», нет breadcrumb. `index.html`/`App.tsx` не меняют title по маршруту.
- `readAgentFilter` (`agent-model.ts:59-74`) принимает любые `board`/`token` из URL; `SelectField` не находит option и показывает пустой trigger. При stale-ссылке фильтр активен, но нечитаем.
- При ошибке всех досок `state.loading` false, `state.rows` пуст, `state.error` true → баннер + пустое место; это не «error state», а «ничего».

Скриншот: `screenshots/20-agents-filtered-empty-1440.png`.

### B10. Policy — настройка доски — живёт в модалке управления

**Severity: P2. Воспроизведено.**

Policy-вкладка (`PolicyPanel.tsx`) — это большой settings-экран:

- версия политики;
- статус running/paused;
- effective limits (3 поля);
- destructive mode + 17 action-checkbox;
- policy limits (те же 3 поля ещё раз);
- Save policy / Reset to defaults;
- внутренний скролл, Save/Reset ниже фолда (скриншот `13-agent-control-policy-1440.png`).

Это не «управление одним решением»; это конфигурация доски. Ей место в Board Settings рядом с workflow, а не в модалке, которую пользователь открыл, чтобы одобрить удаление карточки. Сейчас policy конкурирует с approvals за внимание и удлиняет модалку.

### B11. Шапка: 15 контролов, 9 в первом ряду, разные наборы иконок

**Severity: P2. Воспроизведено на 390.**

На 390×844 в шапке:

- первый ряд (36 px): brand, board title (обрезан до `Agent Op...`), switch, bell, Members, Share, Bot #1, Bot #2, Settings — **9 контролов**;
- второй ряд (36 px): Search, Help, Undo, Redo, Data, Account — **6 контролов**;
- tooltip'ы на touch скрыты; две Bot-кнопки неразличимы.

На 1440 первый ряд: brand, title, switch, bell, Members, Share, Bot #1, Bot #2, Settings, Presence. Девять icon-only действий подряд — «icon soup». Иконки:

- `Bot` 20 px, lucide, stroke 2, статическая;
- `LazyAnimatedIcon` 20 px, анимированные (bell/settings/undo/redo);
- Members — 32 px button, Share — 36 px, Account — 32 px;
- на touch часть tooltip'ов не показывается.

Пользователь не может отличить «глобальные агенты» от «управления агентами доски» ни по глифу, ни по размеру, ни по подписи. Это прямое следствие B3 и отсутствия единой IA.

Скриншоты: `screenshots/15-board-header-390-before.png`, `24-header-crop-2x.png`.

---

## 3. Текущая инвентаризация

### 3.1. Маршруты и оболочка

| Маршрут | Что рендерит | Оболочка |
| --- | --- | --- |
| `/board/:boardId` | `BoardSection` (Board/Calendar/Table/Watch) | `Header` + notices + board |
| `/agents` | `AgentsPage` (lazy) | тот же `Header`; board controls исчезают (B1) |
| `/agents/:tokenId` | `AgentDetailPage` (lazy) | тот же `Header`; board controls исчезают |
| `/admin/*` | `AdminApp` | своя оболочка |
| `/s/:token` | публичная доска | без auth shell |

`/agents` и `/agents/:tokenId` живут внутри `BoardShell` (`App.tsx:195-216`), но `Header` не знает, что он на глобальном маршруте. Отсюда B1.

### 3.2. Header: все входы

| # | Контрол | Иконка/вид | Что делает | Роли | На `/agents` | Проблема |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | BrandMark | логотип 32 | ссылка на `/` | все | остаётся | — |
| 2 | BoardTitle | h2 / input | inline rename | ADMIN/MEMBER; VIEWER только текст | **исчезает** | B1 |
| 3 | BoardSwitcher | chevron 16 | открывает список досок | все | остаётся без title | контекст потерян |
| 4 | NotificationsBell | bell, badge | приглашения/уведомления | все | остаётся | глобальный, ок |
| 5 | BoardMembersDialog | users | roster/invite/roles | все (manage ADMIN) | **исчезает** | B1 |
| 6 | ShareDialog | external-link | share links | ADMIN | **исчезает** | B1 |
| 7 | Agents link | Bot 20 | `/agents` | все | остаётся | дубль с #8, B3 |
| 8 | AgentControlButton | Bot 20 + badge | модалка: approvals/pause/runs/policy | ADMIN; MEMBER/VIEWER runs | **исчезает** | B3/B6 |
| 9 | BoardSettings | animated gear 20 | Board Settings (сейчас только workflow) | ADMIN | **исчезает** | B1; нет Agents tab |
| 10 | PresenceStack | avatars | кто на доске | все | пустой/остаётся | скрыт на `<sm` |
| 11 | GlobalSearch | текст + icon | palette | все | остаётся | — |
| 12 | HelpMenu | keyboard icon | help | все | остаётся | — |
| 13 | Undo | animated arrow | undo | не VIEWER | остаётся, disabled | для VIEWER появляется из-за `role=undefined` |
| 14 | Redo | animated arrow | redo | не VIEWER | остаётся, disabled | то же |
| 15 | DataMenu | database | export/import | все | остаётся | — |
| 16 | AccountDialog | avatar + name | account | все | остаётся | — |

Вывод: в шапке **два разных входа в агентскую поверхность** и **пять board-scoped контролов**, которые пропадают на глобальном маршруте. Нет ни одного текстового label, только tooltip; на touch tooltip'ы отключены.

### 3.3. `/agents`: секции и контролы

| Секция | Контрол | Действие | Состояния | Роль | Замечание |
| --- | --- | --- | --- | --- | --- |
| Page header | Bot tile + h1 `Agents` + subtitle | — | — | все | h1 20 px; subtitle 12 px |
| Page header | `Refresh` | `state.reload()` | disabled + spinner `refreshing` | все | нет «last updated» |
| Stats | Agents | — | число | все | считает **token groups**, не сессии |
| Stats | Live sessions | — | число | все | считает sessions |
| Stats | Waiting approval | — | число | все | считает `session.status`, не approvals (B4) |
| Stats | Stale | — | число | все | считает sessions; смешано с live (B5) |
| Filters | Board | `?board=` | all/board | все | client-side; unknown → пустой trigger |
| Filters | Agent | `?token=` | all/token | все | это **token**, не agent; label неточен |
| Filters | Status | `?status=` | all/live/stale/active/idle/waiting/… | все | live/stale — производные, не статусы |
| Filters | Last seen | `?time=` | any/1h/24h/7d/30d | все | по `lastSeenAt` |
| Filters | Search | `?q=` | — | все | client-side; placeholder обещает card/model |
| Error | banner + Retry | reload | total/partial | все | при 0 строк — пустое место (B9) |
| List | `AgentRow` (Link) | `/agents/:tokenId` | loading/empty | все | group by token; board chips не кликабельны |
| Row badges | live count, stale/pause/status, waiting count | — | — | все | противоречия B5 |
| Row meta | token short id, sessions, boards | — | — | все | 10 px mono |
| Row meta | last seen, current card/run | — | — | все | current card только если live |
| Row board chips | spans | — | — | все | нельзя открыть доску |
| Empty | title/body | — | no sessions | все | нет CTA (B9) |
| Filtered empty | Clear filters | сбрасывает | no matches | все | хорошо |
| Loading | 5 skeleton cards | — | initial | все | — |

Структурно страница — это **один список токенов**, а не «страница агентов»: нет секций, нет approvals, нет master-detail, нет действий. Stats и filters занимают ~260 px по высоте на 390, оставляя ~440 px на список.

### 3.4. `/agents/:tokenId`: detail

| Контрол/секция | Действие | Роль | Состояния | Замечание |
| --- | --- | --- | --- | --- |
| `Back to agents` | `/agents` | все | — | нет breadcrumb/board exit |
| Header | token name, attribution, owner, boards, last seen | все | — | owner — короткий id, не имя |
| Badges | `2 live`, `STALE` | все | — | B5 |
| Stats (4) | sessions/live/boards/waiting | все | — | дублируют header; waiting ложный |
| Notice | agent token / read-only | PAT / member | — | — |
| Session card | board link | все | — | board link есть только здесь |
| Session card | `Pause` / `Resume` | ADMIN live | confirm dialog | — |
| Session card | `End` | ADMIN live | final status + summary | destructive confirm |
| Session card | `Open board` | все | icon-only `<sm` | на 390 без текста |
| Fields | heartbeat/started/ended/current card/run/session/pause reason/end reason | все | — | 3 пустых «—» на активной сессии |
| Summary | text | все | — | — |
| Attribution | token/session/run | все | — | — |
| `AgentActionDialog` | pause/resume/end | ADMIN | busy/error | отдельная модалка |

Detail — это «карточка сессии» внутри страницы, но без списка слева; на 1440 много пустого места, на 390 один session card высотой 327 px и внутренний скролл.

### 3.5. `AgentControlDialog`: вкладки и контролы

| Вкладка | Контролы | Действие | Permission | Состояния | Проблемы |
| --- | --- | --- | --- | --- | --- |
| Shell | close 16×16 | закрыть | все | — | мелкая цель; focus → BODY |
| Shell | group из 4 кнопок | переключение | policy admin-only | `aria-pressed` | не tablist; 24 px; 390 overflow |
| Approvals | Pending/All | фильтр | ADMIN (фактически) | loading/error/empty | MEMBER → 403 |
| Approvals | approval row | выбрать план | ADMIN | selected | нет `aria-selected` |
| Approvals | Approve/Reject | решение | ADMIN | form/confirm/busy/error | plan hash; comment |
| Approvals | plan detail | — | ADMIN | hash mismatch/expired/consumed | — |
| Pause | board pause reason + Pause/Resume | пауза доски | ADMIN | running/paused | — |
| Pause | active sessions + Pause/Resume | пауза сессии | ADMIN | loading/error/empty | token pause — в Account |
| Runs | Status/Kind/Time/Token/Session filters | фильтр | все (read) | — | Token/Session triggers без aria |
| Runs | run row + detail | timeline | все | empty/loading/error | нет runs в фикстуре |
| Runs | preview/Revert | rollback | ADMIN | dry-run/conflict | — |
| Policy | limits, destructive mode, 17 actions, Save/Reset | настройка | ADMIN | loading/conflict/defaults | внутренний скролл, Save ниже фолда |
| Footer | нет | — | — | — | закрытие только X/Esc |

### 3.6. Permissions matrix

| Возможность | ADMIN | MEMBER | VIEWER | PAT |
| --- | --- | --- | --- | --- |
| Открыть `/agents` в UI | да | да | да | нет (JWT UI) |
| Видеть sessions всех досок | да | да (backend list: any member) | да | observer |
| Видеть approvals доски | да | **нет (403)** | **нет (403)** | только свои |
| Решать approval | да | нет | нет | нет (`SessionOnlyGuard`) |
| Пауза доски/сессии | да | нет (read-only) | нет | нет (pause — ADMIN; end своей — да) |
| End session | да | нет | нет | своя |
| Policy | да | нет | нет | нет |
| Revert run | да | нет | нет | нет |
| Board Settings | да | нет | нет | нет |
| Header `Agents` link | да | да | да | n/a |
| Header `Agent control`/`Agent runs` | да | да (3 tabs) | да (3 tabs) | n/a |
| Undo/Redo на `/agents` | да (disabled) | да (disabled) | **да, из-за `role=undefined`** | n/a |

### 3.7. Состояния

| Состояние | Где | Сейчас | Оценка |
| --- | --- | --- | --- |
| Loading (initial) | `/agents`, detail, modal | skeleton 5 карточек / skeleton блоков | хорошо |
| Empty (no sessions) | `/agents` | текст без CTA | плохо (B9) |
| No matches | `/agents` | Clear filters | хорошо |
| Error (all boards) | `/agents` | banner + Retry, список пуст | средне (B9) |
| Partial error | `/agents` | warning banner, rows остаются | хорошо |
| Refreshing | `/agents` | spinner + label | хорошо |
| Offline | `/agents` | error banner | средне |
| Approval expired/consumed | modal | hints + status | хорошо |
| Approval conflict | policy | conflict message | хорошо |
| Session ended | detail | terminal badge, no actions | хорошо |
| Policy conflict | policy | version conflict | хорошо |
| Permission denied | member approvals | 403 error | плохо (B6) |
| Empty token | detail | not found | хорошо |
| Agent token | detail | notice | хорошо |
| Reduced motion | global CSS | many parts covered | не проверено визуально |

---

## 4. IA recommendation

### 4.1. Оценка вариантов

| Вариант | Плюсы | Минусы | Вердикт |
| --- | --- | --- | --- |
| **Вкладка вида доски** (Board/Calendar/Table/Watch + Agents) | рядом с работой; привычное место | агенты кросс-досковые; вкладка исчезает на других досках; нельзя открыть fleet; пятая вкладка перегружает board chrome; approvals нужно видеть с любой доски | **нет** |
| **Полная страница** `/agents` | масштабируется на все доски; deep links; mobile; история; inbox | требует явного глобального входа и board-scoped shortcut | **да, основа** |
| **Модалка** | быстрый доступ к approvals доски; не уводит | не подходит для fleet; перекрывает шапку; не linkable; не масштабируется на runs/history | **только для Board Settings** |
| **Комбинация** | глобальный inbox + board settings tab + card links | больше кода и миграция тестов | **рекомендуется** |

Ответ на вопрос «Может надо вынести в агенты виды досок туда?»: **нет, но сделать страницу board-first.** Виды доски — это способы смотреть одну доску; агенты — это очередь решений и наблюдение за всеми досками. Если добавить «Agents» пятой вкладкой, пользователь на доске A не увидит агента на доске B, а сама вкладка будет конкурировать с Watch. Вместо этого:

- на `/agents` фильтр `?board=...` и группировка сессий **по доскам** (секции `Agent Ops Demo`, `Website Relaunch`), с переключателем `Group by agent` для token-centric аудита;
- в Watch — фильтр «Agents» и ссылка `Open in Agents` для текущей доски;
- в карточке — attribution/claim со ссылкой на сессию;
- в шапке — один бейдж, который ведёт в `/agents?board=<current>&section=attention`.

### 4.2. Целевая архитектура

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL HEADER  brand · board/agents breadcrumb · search · bell · [Bot 1] · UA│
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │                                                     │
   ┌────▼─────────────────────┐                  ┌────────────▼───────────────┐
   │ /agents (global page)    │                  │ Board Settings (ADMIN)     │
   │ Attention / Sessions /   │                  │ Workflow | Agents          │
   │ Runs · board filter      │                  │  Approvals | Sessions |    │
   │ master-detail            │                  │  Policy                    │
   └────┬─────────────────────┘                  └────────────┬───────────────┘
        │                                                     │
        ├── approval → board + card deep link                  ├── board pause
        ├── session → board + card                             ├── session pause/end
        └── run → rollback                                    └── policy/limits
```

- **Global page** — единственный «fleet»-контекст. URL: `/agents?board=<id>&section=attention|sessions|runs&agent=<token>&status=<...>&q=<...>`.
- **Board Settings → Agents** — единственный board-scoped control. URL не нужен; это модалка, но с явным заголовком и своим shell.
- **Card** — attribution/claim; ссылка `Open session` ведёт в `/agents/<tokenId>?session=<id>`.
- **Account → API keys** — создание/отзыв токенов, token-level pause/stop-all. `/agents` ссылается туда, но не дублирует управление токенами.

### 4.3. Global vs board-scoped

| Объект | Где живёт | Почему |
| --- | --- | --- |
| Attention inbox (approvals) | global `/agents` + Board Settings tab | решение нужно человеку; global — когда он не на доске; board settings — когда он администрирует доску |
| Sessions | global `/agents` (board-first) + detail | наблюдение за всеми агентами; board scoped — фильтр |
| Runs / rollback | global `/agents` → Runs | история/аудит по всем доскам; board settings даёт ссылку «Open run history» |
| Board pause | Board Settings → Agents → Sessions | это состояние доски, не глобальная операция |
| Session pause/end | session detail (global) + Board Settings sessions | ADMIN и контекст сессии |
| Policy/limits | Board Settings → Agents → Policy | конфигурация доски, не ежедневное решение |
| Token create/revoke/pause | Account → API keys | безопасность аккаунта; `/agents` только ссылка |
| Claim/attribution | Card dialog + session detail | карточка — место работы |
| Approval plan hash | approval detail (global/settings) | точное решение; один компонент |

### 4.4. Как убрать дубли иконок

1. **Удалить `AgentControlButton` из Header** (и его testid `agent-control-trigger`/`agent-runs-trigger`) после переноса панелей.
2. **Оставить один `Agents`** в правом глобальном кластере, рядом с поиском/колоколом/аккаунтом; не в левом board-кластере, где живут title/members/share/settings.
3. Иконка — `Bot` 20 px, тот же stroke 2; бейдж — **amber** (`bg-warning text-warning-foreground`), не красный: pending approval — внимание, не ошибка. На доске бейдж показывает pending этой доски, на `/agents` — сумму по доступным доскам; для MEMBER бейджа нет.
4. `aria-label` — `Agents, 1 approval waiting` (или `Agents, 2 approvals waiting`), `title` — то же; на touch label не нужен, но кнопка остаётся единственной.
5. В Board Settings шестерёнка остаётся; внутри — rail `Workflow | Agents`, у `Agents` badge количества. Это не дубль, потому что это **настройки**, а не вход в агентскую поверхность.
6. Если продукт хочет анимированную Bot-иконку, добавить `bot` в `AnimatedIconName` и использовать один и тот же wrapper; но **не смешивать** статическую и анимированную Bot в одном кластере.

### 4.5. Интеграция с Board/Calendar/Table/Watch

- **Не добавлять пятую вкладку.** Четыре вида — уже плотно; `Agents` — другая ось (кросс-досковая), а не ещё один вид контента.
- **Watch**: добавить фильтр `Agents` (показывать только карточки, к которым прикасались агенты) и ссылку `Open in Agents` с `?board=<id>`.
- **Card**: claim pill `Claimed by Claude Code until 18:40` + `Open session` + `Release` (для ADMIN); attribution уже есть, но без ссылки на сессию.
- **Board header**: единственный бейдж на глобальной Bot-кнопке; никаких дополнительных bot-иконок. Если нужен zero-click сигнал, добавить **текстовый** chip `1 approval` в toolbar доски (не icon-only), который ведёт в approval detail; но лучше начать с бейджа, чтобы не плодить контролы.
- **Board Settings**: workflow + agents; не превращать в «третье приложение» — это одна модалка с rail.

### 4.6. Entry/exit

- На `/agents` шапка должна быть **глобальной**: brand, breadcrumb `Boards / Agents` (или `Agent Ops Demo / Agents` при scope), search, bell, single Bot (active), account. Board-only controls отсутствуют **осознанно**; нет `Switch board` без title.
- В page header — `Agents` h1, scope chip, `Updated 12s ago`, Refresh, `Manage tokens`.
- В detail — `Back to agents`, breadcrumb `Agent Ops Demo / Agents / Claude Code — audit`, `Open board` (с `?card=`), `Open session` из карточки.
- В Board Settings — `Close`, `Save policy` (только policy dirty), `Approve plan` в approval detail; sticky footer.
- Deep links:
  - `/agents?board=<id>&section=attention`
  - `/agents?board=<id>&section=sessions&agent=<tokenId>`
  - `/agents/<tokenId>?session=<sessionId>`
  - `/board/<id>?card=<cardId>` (уже есть)
  - `/agents?section=runs&run=<runId>`

---

## 5. Redesign spec

### 5.1. Layout

#### 1440×900

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 56  brand  Agent Ops Demo  /  Agents          search   bell   [Bot 1]   UA   │
├──────────────┬───────────────────────────────────────────────┬───────────────┤
│ 236          │ 832                                           │ 372           │
│ Agents       │ Attention            ● Live  Updated 12s  ↻  │ SELECTED      │
│ What needs…  │ One decision is waiting.                      │ APPROVAL      │
│              │ [search…] [agent] [status] [board ×]          │ Delete card…  │
│ ● Attention 1│ ┌ amber rail ───────────────────────────────┐ │ meta 2×2      │
│   Sessions 3 │ │ APPROVAL · board · 52 min · Medium risk  │ │ plan JSON     │
│   Runs 12    │ │ Delete card “Card claim visibility”      │ │ plan hash     │
│              │ │ Claude Code — audit asks DELETE_CARD…    │ │ [Approve]     │
│ BOARDS       │ └ [Review plan] [Reject] ──────────────────┘ │ [Reject]      │
│ All boards 3 │ Live sessions  2 active  1 no heartbeat      │               │
│ Agent Ops 1  │ AGENT        SESSION      CARD      HB  ST   │               │
│ Website  1   │ Claude Code  Refactor…    Approval… 12s ●    │               │
│              │ Claude Code  Landing…     —         6m ◐    │               │
│ Manage tokens│ Docs agent   API sweep    MCP…      1m ●    │               │
└──────────────┴───────────────────────────────────────────────┴───────────────┘
```

- Rail 236 px: sections + boards + manage tokens. Не карточки, а навигация.
- Center 832 px: page header, filters, attention card, live sessions table.
- Detail 372 px: выбранный approval/session; sticky footer с решением.
- Один scroll на центр; detail scroll независимый; rail фиксирован.

#### 1024×768

```text
┌──────────────────────────────────────────────────────────────┐
│ 56  brand  Agent Ops Demo / Agents    search bell [Bot 1] UA │
├────────────┬─────────────────────────────────────────────────┤
│ 220        │ 804                                             │
│ rail       │ Attention / filters / attention / sessions       │
│            │                                       ┌─────────┴─────────┐
│            │                                       │ detail sheet 360  │
│            │                                       │ (open on select)  │
└────────────┴───────────────────────────────────────┴───────────────────┘
```

- 1024: rail 220 + список; detail — правый sheet 360 поверх списка (не перекрывает шапку), с явным scrim только на контенте.
- В списке скрывается колонка `Current card` (она есть в detail), чтобы не сжимать agent/session.
- Board Settings на 1024 — центрированный диалог 992×736; это осознанный settings-режим, не «иконка-поповер». На `<768` — full-screen (как сейчас).

#### 390×844

```text
┌──────────────────────────────────────────────┐
│ 56  brand  Agent Ops Demo / Agents  bell Bot UA│
├──────────────────────────────────────────────┤
│ 47  Attention 1   Sessions 3   Runs 12       │  sticky section tabs
├──────────────────────────────────────────────┤
│ Attention                                    │
│ One human decision is waiting…               │
│ [search…]                                    │
│ [agent] [status] [board ×]                   │
│ ┌ approval ────────────────────────────────┐ │
│ │ APPROVAL · 52 min · Medium risk          │ │
│ │ Delete card “Card claim visibility”      │ │
│ │ Claude Code — audit asks DELETE_CARD…    │ │
│ │ [Review plan] [Reject]                   │ │
│ └──────────────────────────────────────────┘ │
│ Live sessions  2 active  1 no heartbeat      │
│ ┌ Agent / session / heartbeat ─────────────┐ │
│ │ Claude Code — audit            12s  ›    │ │
│ │ Refactor approval flow                   │ │
│ │ ● Active                                 │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- 390: rail превращается в sticky section tabs; board scope — chip в toolbar; detail — отдельный route/шит с `Back`.
- Никаких KPI-карточек; attention — первый экран.
- Кнопки min 44 px; строки списка — links целиком, не только `›`.

### 5.2. Иерархия и содержание

1. **Page header**: `Agents` (h1) + одна строка «What needs a human. What runs now.» + `Updated 12s ago` + Refresh + `Manage tokens`. Никаких subtitle-простыней.
2. **Attention**: одна карточка на approval или пустое «All clear»; риск, срок, кто/что/где, plan hash; primary `Review plan`.
3. **Live sessions**: таблица/строки, сгруппированные по доске; columns Agent / Session / Current card / Heartbeat / Status; actions `Open`.
4. **Runs**: отдельная секция; filters + list + detail; rollback только ADMIN.
5. **Detail**: выбранный approval/session/run; metadata; plan/hash; sticky footer с действием.

Порядок отвечает на вопросы: «Что требует меня?» → «Что происходит?» → «Что было?» → «Что я могу сделать?».

### 5.3. Компоненты

| Компонент | Назначение | Заменяет |
| --- | --- | --- |
| `AgentsButton` | единственный вход в шапке, badge, aria-label | `agents-trigger` + `AgentControlButton` |
| `GlobalHeader` / `BoardHeader` | route-aware оболочка, без «полусобранной» шапки | текущий `Header` |
| `AgentsShell` | breadcrumb, page header, scope chip, freshness | page header `/agents` |
| `AgentsRail` | Attention/Sessions/Runs + Board list | stats cards |
| `AttentionInbox` | pending approvals, all-clear | отсутствует |
| `ApprovalSummary` | строка approve/risk/expiry | approval row в модалке |
| `ApprovalDetail` | plan/hash/decision | detail в модалке |
| `SessionBoardSection` | группировка по доске | token group |
| `SessionRow` | agent/session/card/heartbeat/status | `AgentRow` |
| `SessionDetail` | detail + actions | `AgentDetailPage` карточки |
| `RunList` / `RunDetail` | history/rollback | `RunsPanel` |
| `StatusPill` / `Heartbeat` | единая семантика статуса | `AgentStatusBadge` + `AgentStaleBadge` |
| `BoardSettingsAgents` | rail `Workflow / Agents`, sub-tabs Approvals/Sessions/Policy | `AgentControlDialog` |
| `EmptyState` | CTA create token/docs | текущий пустой |
| `useAgentsOverview` | один aggregate-запрос (sessions + approvals + counts) | N+1 fan-out |

### 5.4. Типографика, отступы, радиусы, цвет

| Роль | Размер/стиль | Токен/класс |
| --- | --- | --- |
| Page title | 26–28 px, 700, tracking −0.03em | `font-display`, только Latin/цифры |
| RU page title | 24–26 px, 650, body font | `font-sans`; Space Grotesk **не имеет кириллицы** (Fontsource: только latin/latin-ext/vietnamese) |
| Section title | 13 px, 650 | `text-[13px] font-semibold` |
| Body | 13/20 | `text-[13px] leading-5` |
| Meta | 10.5–11/14 | `text-[11px] text-muted-foreground` |
| Uppercase label | 9.5–10 px, tracking .08–.12em | только для колонок/eyebrow, не для каждого блока |
| IDs/hash | 10–10.5 px mono | `font-mono`, `break-all` |
| Numeral stats | 20 px tabular | только в filter chips, не KPI grid |
| Page padding | 24 px desktop, 16 mobile | `p-6`, `p-4` |
| Rail | 236 px / 220 px / hidden | `grid-template-columns` |
| Row | 52–56 px desktop; 96–112 mobile | hairline bottom |
| Radii | dialog 12, panel 10, row 8, chip 5, button 7 | `rounded-xl/lg/md` |
| Border | 1px `--border` | `border-border` |
| Primary | `#3b82f6` | selection/primary CTA |
| Attention | `#f59e0b` | approvals/no heartbeat |
| Success | `#10b981` | live |
| Danger | `#ef4444` | destructive only |
| Text | `#e6edf7`; muted `#93a4bd` | tokens |
| Shadows | одна мягкая на dialog; rows без теней | `shadow-xl` только shell |

Запрещено: KPI-сетка из 4 одинаковых карточек, вложенные карточки с одинаковой рамкой, 7–9 px текст, uppercase на каждом блоке, purple gradient, «AI sparkles», декоративные анимации.

### 5.5. Состояния

| Состояние | Спецификация |
| --- | --- |
| Loading | skeleton строк (5), не карточек; `aria-busy`; через 180 ms fade-in |
| Empty (no sessions) | «No agent sessions yet» + `Create API token` (Account → API keys) + `Read docs`; без ложного «select a run» |
| No matches | «No sessions match these filters» + `Clear filters` |
| Error all | централизованный error state: title, reason, `Retry`, `Open status`; не пустое место |
| Partial error | warning chip `Some boards are unavailable` + Retry; rows остаются |
| Refreshing | `Updated 12s ago` + spinner; не блокирует список |
| Offline | banner `You are offline. Showing last loaded data.` + retry |
| Permission | member: no approvals tab; read-only notice only where нужен; no 403 |
| Approval expired | status `Expired`, no actions, `Request again` hint |
| Approval consumed | status `Consumed`, link to run |
| Approval conflict | hash mismatch message + reload |
| Session ended | terminal badge, no pause/end; `Open board` |
| Policy conflict | version conflict + reload; keep draft? explicit |
| Empty board | no agents; link to token creation |
| Reduced motion | no overlay zoom/fade; respect `prefers-reduced-motion` |

### 5.6. Responsive

- 1440: 3 колонки; detail всегда виден при выборе; rail 236.
- 1024: rail 220 + list; detail sheet 360, top 70 (не перекрывает 56 px header); закрывается по Esc/клику; board settings 992×736.
- 390: full page; header 56; sticky tabs 47; toolbar wraps; rows 96–112; detail route full screen; Board Settings full-screen (как `BoardSettingsDialog`).
- Никакого `overflow-x` на page; внутренние scroll только у списка/тела диалога; sticky footer.
- Touch targets ≥44 px; close 32–44; tabs 44; row link entire row.
- Безопасные зоны: учесть `env(safe-area-inset-*)` (сейчас в коде нет; риск, не воспроизведён на реальном iPhone).

### 5.7. A11y

- `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`, roving tabindex; `ArrowLeft/Right`, `Home/End`.
- Focus return на trigger после закрытия диалога/шита; initial focus — заголовок или первый tab, не случайный.
- `aria-live="polite"` для `Updated`, количества approvals и ошибок; `role="alert"` для ошибки.
- `aria-current="page"` для активной секции; row links с понятным именем (`Claude Code — audit, session Refactor approval flow, Agent Ops Demo`).
- Статус — текст + цвет, не только цвет: `Active`, `No heartbeat 6 min`, `Waiting for approval`, `Expired`.
- Не полагаться на tooltip: icon-only controls имеют `aria-label`, но на touch критичные действия имеют видимый текст.
- Close 32×32, tabs ≥32 desktop / ≥44 touch, buttons ≥36 desktop / ≥44 touch.
- Контраст: 10 px muted на `#172033` близок к порогу; минимум 11 px и проверить 4.5:1.
- `prefers-reduced-motion`: отключить overlay fade/zoom, spinner оставить (или static); не анимировать появление строк.

### 5.8. Motion

- 150–200 ms, `--janosik-ease-out`; только ответ на действие: открытие detail sheet, выбор строки, сохранение policy.
- Никаких постоянных pulse/glow у live; точка live статична; heartbeat обновляется текстом.
- Не анимировать исчезновение шапки; смена header variant — мгновенная/150 ms opacity, не layout jump.

### 5.9. Copy

| Сейчас | Предлагается |
| --- | --- |
| `Waiting approval 0` (session status) | `Approvals 1` (approval records) + `Waiting for your decision` |
| `Stale` badge рядом с `Active` | `No heartbeat · 6 min` (одна строка) |
| `Agent control` / `Agent runs` | `Agents` (global) и `Board settings → Agents` (scoped) |
| `Pending 0` | `No approvals waiting` |
| `Select a run to see its timeline` при пустом списке | `No runs yet. Runs appear when an agent applies commands.` |
| `No sessions match these filters` | ок; добавить `Clear filters` (есть) |
| `Agent` filter | `Agent (API token)` или `Token` |
| `Create a personal API token…` без ссылки | `Create an API token in Account → API keys` + link |
| `Only a signed-in board admin…` в модалке | то же, но показывать только ADMIN; member не видит вкладку |

### 5.10. Макеты и снимки

- Глобальная страница: `screenshots/30-proposed-desktop-1440.png`, `31-proposed-1024.png`, `32-proposed-390.png`.
- Board Settings → Agents: `screenshots/33-proposed-settings-1440.png`, `35-proposed-settings-1024.png`, `34-proposed-settings-390.png`.
- Текущие баги с разметкой: `screenshots/25-annotated-evidence.png`, `screenshots/26-annot-two-bots.png`.

Макеты используют реальные токены (`brand/src/tokens.css`) и Space Grotesk для латинских заголовков; русские заголовки в проде должны идти body-шрифтом, потому что в Fontsource у Space Grotesk нет кириллицы.

---

## 6. Per-button/menu table

### 6.1. Header

| # | Текущий контрол | Текущее поведение/баг | Предлагаемый контрол/место | Ожидаемое поведение | Permission | Тест |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `Agents` Bot link (`agents-trigger`) | уводит на `/agents`; удаляет 5 board-контролов; дубль с #2 | удалить; заменить одним `AgentsButton` в правом кластере | `/agents?board=<current>&section=attention`; шапка остаётся глобальной | все | e2e: click → route, header variant, no removed controls |
| 2 | `Agent control` / `Agent runs` Bot (`agent-control-trigger`) | открывает модалку; перекрывает шапку; member 403; focus → BODY; дубль с #1 | удалить; панели → Board Settings → Agents | нет отдельной модалки; board control в settings | ADMIN (read-only для member — global) | e2e: ADMIN tab; MEMBER no approvals; focus |
| 3 | Board settings gear | только workflow | оставить; добавить Agents tab | settings shell с rail `Workflow / Agents`; badge approvals | ADMIN | component: tabs, dirty close |
| 4 | Members | roster/invite | оставить в board-кластере или свернуть в `Board` menu | не исчезает на /agents | все (manage ADMIN) | browser |
| 5 | Share | share links | оставить/свернуть | не исчезает на /agents | ADMIN | browser |
| 6 | Switch board | dropdown | на /agents заменить на scope selector в page header | board scope visible; no contextless chevron | все | browser |
| 7 | Undo/Redo | на /agents видны (disabled); VIEWER тоже | скрыть на global route | никаких mutating affordances вне доски | не VIEWER | component role matrix |
| 8 | Notifications bell | global | оставить | не дублировать agents badge | все | browser |
| 9 | Search/Help/Data/Account | global | оставить | — | все | smoke |
| 10 | Presence | board | только board route | — | все | browser |

### 6.2. `/agents` page

| # | Текущий контрол | Текущее поведение/баг | Предлагаемый контрол/место | Ожидаемое поведение | Permission | Тест |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | Refresh | reload; no timestamp | `Updated 12s ago` + Refresh | spinner, disabled; aria-live | все | component |
| 12 | 4 stat cards | decorative; mixed units; false waiting | убрать; counts в section tabs/chips | counts clickable and truthful | все | unit/browser |
| 13 | Board filter | client-side; unknown blank | scope chip/dropdown; default current board | URL `?board=`; all boards; fallback | все | component |
| 14 | Agent filter | token filter mislabeled | `Agent (token)`; stable name/owner | filters list | все | component |
| 15 | Status filter | mixes live/stale/status | status + `Heartbeat` filter separately | no contradictory badges | все | component |
| 16 | Last seen | time window | keep, rename `Last activity` | filters by heartbeat/end | все | component |
| 17 | Search | local; placeholder mismatch | server search or at least board/plan hash | search agent/session/card/board | все | browser |
| 18 | Error Retry | banner; zero rows blank | full error state + retry | recover; no blank | все | component |
| 19 | Agent row | one link to token detail; board chips spans | row opens session detail; board chips links; `Open` menu | navigate; board deep link | все | e2e/mobile |
| 20 | Token group | aggregates boards; hides status | board-first sections + group by agent toggle | status per board/session | все | unit/component |
| 21 | Empty state | no CTA | `Create API token` + docs | first-run path | все | browser |
| 22 | Filtered empty | clear filters | keep | reset URL | все | component |
| 23 | Back (detail) | to `/agents` | breadcrumb + back; `Open board` | return to scoped list | все | e2e |

### 6.3. Detail + Board Settings

| # | Текущий контрол | Текущее поведение/баг | Предлагаемый контрол/место | Ожидаемое поведение | Permission | Тест |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | Session Pause/Resume | outline buttons; dialog reason | keep inline in detail; confirm | pause/resume + toast | ADMIN | e2e |
| 25 | Session End | dialog final status/summary | keep; destructive; release claims | end + release claims | ADMIN | e2e |
| 26 | Open board | icon-only `<sm` | visible label mobile; card deep link | open board/card | все | mobile |
| 27 | Detail 4 stats | duplicate header | remove; use metadata line | less noise | все | component |
| 28 | Approvals tab | member 403 | ADMIN-only tab in Board Settings; global Attention | list/decide with plan hash | ADMIN | e2e |
| 29 | Pause tab | board/session pause | Board Settings → Agents → Sessions | pause/resume; read-only notice | ADMIN | e2e |
| 30 | Runs tab | filters/list; empty | global `/agents` Runs | history/detail/rollback | ADMIN revert | e2e |
| 31 | Policy tab | 17 checkboxes; scroll | Board Settings → Agents → Policy | one form, sticky save | ADMIN | component |
| 32 | Close X | 16×16; focus lost | 32×32; focus restore | Esc/X returns focus | все | a11y |
| 33 | Tabs | group/aria-pressed | tablist/tabpanel | arrows/Home/End | все | a11y |
| 34 | Approve/Reject | modal form | shared `ApprovalDetail` in both mounts | exact plan hash; comment; busy/error | ADMIN | e2e |
| 35 | Board-wide pause | reason + pause | Board Settings → Sessions | sticky status; token hint | ADMIN | e2e |
| 36 | Token pause/stop | Account → API keys | link from settings | no duplicate in agent page | account owner | browser |

---

## 7. Implementation plan and tests

### 7.1. Phases

**Phase 0 — hotfix P1 (2–3 дня).**

- `Header` становится route-aware: `boardRoute` vs `globalRoute`; на `/agents` рендерится `GlobalHeader` (brand, breadcrumb, search, bell, account) без board-контролов, с явным `Agents` context. Не оставлять `Switch board` без title.
- Убрать `AgentControlButton` из Header; оставить один `Agents` в правом кластере. Чтобы не потерять approvals, временно добавить в глобальную страницу кнопку `Board control` для ADMIN, открывающую существующую модалку (пока Board Settings tab не готов). Либо сразу перенести панели — если хватает времени.
- `AgentControlDialog`: скрыть Approvals для MEMBER/VIEWER; focus restore; `aria-label` close; на `<768` — full-screen как Board Settings; на 1024 — либо sheet, либо full-screen.
- Убрать `AgentControlButton` badge из board header? Нет: single `Agents` badge должен показывать pending. Для hotfix можно оставить badge на единственной кнопке; fetch aggregate по текущей доске.
- Тесты: header route matrix, member no 403, focus.

**Phase 1 — truthful attention (3–5 дней).**

- Backend: `GET /agents/overview` (или `GET /approvals?scope=...`) с агрегатом: boards, sessions, pending approvals, counts, pagination. Права: ADMIN — approvals по доскам; MEMBER/VIEWER — только sessions; PAT — свои.
- `useAgentsOverview`: убрать N+1 fan-out; URL state; `lastLoadedAt`.
- `/agents`: секции Attention/Sessions/Runs; default Attention; approvals inbox; counts from approval records; remove stat cards; board-first grouping; empty/error states; updated timestamp; `<title>`.
- Tests: unit counts, component filters, e2e approval inbox.

**Phase 2 — Board Settings → Agents (5–8 дней).**

- `BoardSettingsDialog` rail: `Workflow`, `Agents`; `AgentsSettings` with sub-tabs Approvals/Sessions/Policy.
- Reuse `ApprovalsPanel`, `PausePanel`, `PolicyPanel` (refactor props/URL state; no nested modal).
- Sticky footer: board pause status, Close, Save policy when dirty; approve/reject in detail.
- Deprecate/remove `AgentControlDialog`; update testids or keep aliases for one release.
- Tests: role matrix, dirty close, policy conflict, mobile full-screen.

**Phase 3 — polish (3–5 дней).**

- Master-detail at 1440; sheet at 1024; route at 390.
- Move runs to global; Watch filter; card claim/attribution link.
- A11y: tablist, focus, targets, contrast, live regions.
- Empty/error/offline; `Create API token` CTA.
- Visual regression 1440/1024/390; reduced motion.

### 7.2. Files

| Область | Файлы |
| --- | --- |
| Header | `ui/src/components/Header.tsx`, новый `ui/src/components/agents/AgentsButton.tsx`, `ui/src/routes.ts` |
| Global page | `ui/src/components/agents/AgentsPage.tsx`, `AgentDetailPage.tsx`, `agent-model.ts`, `use-agent-sessions.ts`, `agents-ui.tsx` |
| Board settings | `ui/src/components/board/BoardSettingsDialog.tsx`, новый `ui/src/components/board/agents/AgentsSettings.tsx`, `ApprovalsPanel.tsx`, `PausePanel.tsx`, `PolicyPanel.tsx` |
| API | `ui/src/api/client.ts`, backend `approvals.controller.ts`/service, `agent-sessions.controller.ts`/service, shared DTO |
| State/query | `ui/src/store/BoardContext.tsx` (route helper), new `use-agents-overview.ts`; URL params |
| i18n | `ui/src/locales/en/translation.json`, `ru/translation.json` |
| Tests | `ui/src/components/agents/*.test.tsx`, `agent-control/*.test.tsx`, `e2e/tests/app/agents/*.spec.ts`, `e2e/tests/app/navigation/*` |

### 7.3. Backend/API

- `GET /api/v1/agents/overview?board=&status=&cursor=&limit=` — агрегат:
  - boards (id/title/role),
  - sessions (existing DTO + board/token labels? labels client-side),
  - approvals (only where role ADMIN; exact plan summary, no plan JSON in list),
  - counts: pending approvals, live sessions, stale sessions, no-heartbeat.
- `GET /api/v1/approvals?scope=board|all&board=&status=` — global inbox; ADMIN only; pagination; no plan hash? Include hash for detail.
- `GET /api/v1/agent-runs?board=&status=&kind=&token=&session=&cursor=` — global runs; ADMIN revert separately.
- Keep existing board endpoints for compatibility.
- RBAC: global endpoint must not leak approvals/plan to MEMBER/VIEWER; don't rely on UI hide. Use `BoardRoles(ADMIN)` for approvals or service filter.
- Pagination: cursor/limit; counts; `X-Total-Count` or `total`.
- SSE: existing approval frames are board-scoped; global page can subscribe per board or poll 30s. Add `approval` event to a global channel if feasible; otherwise poll + refresh on focus.

### 7.4. State/query

- URL is the source of truth: `board`, `section`, `agent`, `status`, `q`, `run`, `session`.
- Default: from board header → `board=<current>§ion=attention`; from account/home → all boards.
- Use a single `useAgentsOverview` hook; no duplicate `api.listBoards` calls; cache by URL params; abort on unmount.
- Optimistic decide/pause/resume/end with rollback + toast; update counts locally only after server ack.
- `lastLoadedAt` → `Updated 12s ago`, refresh on visibility; polling fallback.
- Detail routes remain deep-linkable; on 1440 selection updates URL without full navigation (replace), on 390 it navigates to detail route.

### 7.5. Test matrix

| Уровень | Что проверять |
| --- | --- |
| Unit | `agent-model`: counts from approvals, live/stale separation, group by board, filter parsing, unknown values fallback |
| Component | Header board/global variants; single AgentsButton; role matrix; empty/error; tabs semantics; focus restore; no 403 for member |
| Browser/e2e | Admin approval flow; member read-only; board settings Agents tab; policy save/reset; pause/resume/end; runs rollback; deep links |
| Mobile 390 | no horizontal overflow; 44 px targets; sticky footer; section tabs; detail route; full-screen settings |
| A11y | axe (no critical), tablist keyboard, focus returned, aria-live, contrast of 11 px |
| Visual | 1440/1024/390 screenshots; no layout shift on header variant; reduced motion |

Конкретные тесты:

1. `header.spec`: on board — title/members/share/settings visible; click `Agents` → URL `/agents?board=...`; **same global header**; no `agent-control-trigger`; `agents-trigger` count 1; backdrop not present.
2. `header.spec`: MEMBER/VIEWER — no board settings/share; Agents button visible; no Undo/Redo on `/agents`.
3. `agents-overview.spec`: fixture with 1 pending approval → `Approvals 1`, `Waiting for your decision`; API count; no stat 0.
4. `agents-member.spec`: member opens `/agents`; no Approvals action; board settings tab absent; no 403 in console.
5. `board-settings-agents.spec`: ADMIN sees Approvals/Sessions/Policy; member cannot open; policy saves with version conflict; close dirty confirm.
6. `focus.spec`: open via keyboard, Esc → trigger focused; tablist arrow keys; close 32×32.
7. `mobile.spec`: 390 header 56, tabs 47, no overflow; dialog/settings full-screen; approve button reachable without horizontal scroll.
8. `approval.spec`: existing e2e plan hash/approve/reject/consumed; reuse with new mount.
9. `perf.spec`: 20 boards → one overview request, not 21; lazy chunk still separate.

### 7.6. Rollout/migration/risks

| Риск | Митигация |
| --- | --- |
| Тесты завязаны на `agent-control-trigger`, `agent-runs-trigger`, `agent-control-dialog` | оставить aliases на один релиз; обновить e2e; не ломать deep links |
| MEMBER теряет доступ к approvals | так и должно быть; global page показывает sessions; admin-only inbox |
| Глобальный SSE | approvals board-scoped; poll + focus refresh на первом этапе; global stream позже |
| Backend aggregate | сначала client fan-out с `Promise.allSettled` и кэшем; затем endpoint; не блокировать UI |
| Policy в Board Settings | перенести без изменения API; сохранить version/conflict; не терять dirty draft |
| Mobile | full-screen settings; sheet detail; safe-area; 44 px |
| i18n | Space Grotesk без кириллицы; RU headings body font; проверить длинные строки |
| Производительность | 20 досок × sessions; один aggregate или lazy load; pagination |
| Security | global approvals только ADMIN/свои PAT; скрытие в UI не заменяет RBAC |
| A11y | tablist/focus/targets; не регрессировать card dialog |

---

## 8. Remove / move / keep

### Удалить

- Вторую Bot-кнопку из шапки (`AgentControlButton`) после переноса панелей.
- Отдельную модалку `AgentControlDialog` как top-level surface.
- 4 KPI-карточки на `/agents` и 4 stats на detail (заменить на counts/chips).
- `waiting approval` из session status; `stale` как статус-бейдж.
- Показ Approvals для MEMBER/VIEWER.
- `Switch board` без title на `/agents`.
- Дублирующие поля policy (effective limits + policy limits) — один блок.
- Три пустых поля `Ended / Pause reason / End reason` у активной сессии — свернуть в «More».

### Переместить

- Approvals, Pause, Policy → Board Settings → Agents.
- Runs & rollback → `/agents` → Runs (с board filter).
- Token-level pause/stop-all → остаётся Account → API keys (ссылка из settings).
- Board chips → кликабельные ссылки на доску.
- `Create API token` → empty state + `Manage tokens`.
- Claim/attribution → Card dialog + session detail.
- «Last updated» → page header.

### Оставить

- `/agents` и `/agents/:tokenId` как deep links.
- Board/Calendar/Table/Watch без изменений.
- Plan hash, risk, expiry, audit history, SSE, polling.
- Session pause/resume/end и confirm-dialog.
- Run dry-run/rollback (ADMIN).
- Workflow rail в Board Settings; расширить его Agents-вкладкой.
- Attachments/claims? Claim display — добавить, не удалять.

---

## 9. Limitations

**Runtime-verified:**

- 1440×900, 1024×768, 390×844 на живом приложении.
- ADMIN и MEMBER на одноразовых досках; 2 сессии, 1 pending approval; board settings/workflow открывались.
- B1: header DOM before/after; 5 контролов исчезают; back возвращает.
- B2: modal geometry 1024/390; header overlay/aria-hidden/body pointer-events; 5 px overflow tabs; tab heights.
- B3: two Bot DOM/size/icons; badge; screenshot.
- B4: API pending=1 vs UI 0 on page/detail.
- B5: `2 live` + `STALE`; `ACTIVE` + `STALE`.
- B6: member 403 + console; UI error.
- B7: focus BODY after Esc; keyboard tab order; aria-pressed/group.
- B8: 390 tab wrap/overflow.
- B9: filtered empty; source-read for no-session empty/error/title.
- B10: policy screenshot and scroll.
- B11: 390 header screenshot.

**Code-read only (не запускалось под ролью/сценарием):**

- VIEWER: `role=undefined` → Undo/Redo visible on `/agents`; Board Settings hidden; no runtime login as VIEWER.
- PAT: UI не логинился PAT; `isAgentToken`/SessionOnlyGuard inspected in code.
- Policy save/reset/conflict, run rollback, approval approve/reject end-to-end: existing e2e/tests and code inspected; we created a pending approval but did not decide it in this audit.
- SSE global stream: does not exist; design assumption.
- Loading/error/offline states not all forced; filtered empty runtime, no-session empty code-read.
- axe-core not run in this pass; a11y findings are DOM/keyboard/measured, not a full audit.
- Real touch device/safe-area not tested; 390 emulation only.
- No automated test suite run; no source changes.

**Данные:**

- Скриншоты сделаны на одноразовых досках; существующие доски не изменялись. Один тестовый аккаунт (Audit Admin) и участник (Member Audit) созданы через API; в отчёте нет их email.
- В `screenshots/` остались снимки только одноразовых досок; снимки с существующей доской удалены.

---

## Приложение A. Индекс скриншотов

| Файл | Что доказывает |
| --- | --- |
| `04-board-with-agents-1440.png` | доска с двумя Bot-иконками, badge 1, 4 колонки |
| `05-board-header-1440.png` | шапка доски до клика |
| `07-agents-page-1440-clean.png` | `/agents` 1440: 0 waiting, 2 live + STALE, KPI-карточки |
| `08-agents-page-1024.png` | `/agents` 1024: filters, empty space, KPI |
| `09-agents-page-390.png` | `/agents` 390: 3 ряда filters, header без board controls |
| `10-agent-control-approvals-1440.png` | approvals admin: plan hash, approve/reject |
| `11-agent-control-pause-1440.png` | board pause + session pause |
| `12-agent-control-runs-1440.png` | runs filters + empty state |
| `13-agent-control-policy-1440.png` | policy: 17 checkbox, internal scroll, save below fold |
| `14-agent-detail-1440.png` | detail: 2 live + STALE, 0 waiting, 4 stats |
| `15-board-header-390-before.png` | 390 header: 9 controls top row, 6 bottom |
| `16-agent-control-open-390.png` | modal covers second header row; tabs cut |
| `17-agent-runs-member-1440.png` | member "Agent runs" opens runs tab, Approvals still visible |
| `18-approvals-member-readonly-1440.png` | member Approvals → 403 error |
| `18-console-403.txt` | console evidence for member 403 |
| `19-agent-detail-390.png` | detail 390: stats, one session card, icon-only Open board |
| `20-agents-filtered-empty-1440.png` | filtered empty + Clear filters |
| `21-agent-control-1024.png` | modal covers header at 1024 |
| `22-header-before-1440-annot.png` | header before (1440) |
| `23-header-after-1440-annot.png` | header after `/agents` (5 controls gone) |
| `24-header-crop-2x.png` | two identical Bot buttons close-up |
| `26-annot-two-bots.png` | annotated close-up of the two Bot buttons |
| `25-annotated-evidence.png` | annotated A–E evidence |
| `header-dom-before-after.json` | DOM/rect/computed styles for B1/B2 |
| `30-proposed-desktop-1440.png` | proposed global page 1440 |
| `31-proposed-1024.png` | proposed 1024 with detail sheet |
| `32-proposed-390.png` | proposed 390 with sticky section tabs |
| `33-proposed-settings-1440.png` | proposed Board Settings → Agents 1440 |
| `34-proposed-settings-390.png` | proposed settings 390 full-screen |
| `35-proposed-settings-1024.png` | proposed settings 1024 |

## Приложение B. Источники

- `ui/src/components/Header.tsx:54,61-110,118-159,168-176`
- `ui/src/components/agent-control/AgentControlButton.tsx:15-22,37-51,53-55,57-83`
- `ui/src/components/agent-control/AgentControlDialog.tsx:25,47-48,88-145`
- `ui/src/components/agent-control/ApprovalsPanel.tsx:411-495,704-707,817-821`
- `ui/src/components/agents/AgentsPage.tsx:40-83,85-152,216-370,375-497,499-556`
- `ui/src/components/agents/AgentDetailPage.tsx:44-59,131-264,268-434`
- `ui/src/components/agents/agent-model.ts:95-97,118-156,174-207`
- `ui/src/components/agents/use-agent-sessions.ts:18-19,62-129,207-245,249-264`
- `ui/src/components/agents/agents-ui.tsx:37-51,78-108`
- `ui/src/components/ui/dialog.tsx:16-29,48-75`
- `ui/src/components/board/BoardSettingsDialog.tsx:41-57,89-109`
- `ui/src/store/BoardContext.tsx:556-571,1763-1770`
- `ui/src/index.css:18-23`
- `ui/src/components/ui/lazy-animated-icon.tsx:27-43,63-190`
- `backend/src/approvals/approvals.controller.ts:36-80`
- `backend/src/approvals/approvals.service.ts:149-179`
- `backend/src/agent-sessions/agent-sessions.service.ts:563-590`
- `design/ui-roast/REVIEW.md:197-211,380-388`
- `docs/TASK-177-human-last-mile.md:199`
- `design/board-settings-redesign/REPORT.md` (референс shell/rail/footer)
