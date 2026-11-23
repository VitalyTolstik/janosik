# TASK-200 — Agent-scale performance (`agent-scale-performance`)

> **Эпик.** Сделать Janosik ультралёгким для сотен одновременных агентов:
> убрать усиление нагрузки на агентском пути, доказать ёмкость замерами и
> закрепить её CI-гейтом. Это не переписывание стека.
>
> **Research-вход:** [`docs/PERF-AGENT-SCALE.md`](PERF-AGENT-SCALE.md) —
> полный отчёт с evidence-таблицей, оценками и разделом «мифы vs факты».
> **Статус:** запланировано. Запуск — после текущей волны TASK-177/185;
> TASK-167 не начинаем. Каждая подзадача — отдельная ветка
> `feat/TASK-200.x-*` и отдельный PR.

---

## 1. Зачем

Приложение уже умеет вести доску роем агентов, но текущая архитектура
платит за это полным чтением доски на каждом шаге. При 100–500 агентах
первыми ломаются не БД, не NestJS и не React, а:

1. **холостой поллинг** — `janosik_wait_for_work` каждые 5 с читает всю
   доску (500 агентов ≈ 100 полных чтений/с);
2. **board-wide CAS в MCP** — агенты, правящие разные карточки, конфликтуют
   и перечитывают доску;
3. **тройная загрузка aggregate** на PAT-команде и 30–40 запросов на одну
   команду;
4. **общий board-лимит 600 req/min** (~5 действий/с), который MCP не
   умеет пережидать (нет retry на `429`);
5. **некэшированные auth/membership/flags** и keep-alive SSE;
6. **отсутствие singleflight/ETag/gzip** — 500 одновременных чтений
   доски на 1 000 карточек ≈ 6,5 ГБ временной памяти;
7. **MCP stdio** — 108 МБ на процесс агента.

Цель — не «купить сервер побольше», а убрать амплификацию: один и тот же
объём работы должен обслуживать в 5–10 раз больше агентов.

### Что уже измерено

| Метрика | Значение | Источник |
|---|---|---|
| Raw HTTP ceiling | ~5 600 req/s | `docs/PERF-BASELINE.md` |
| Чтение доски | ~430 req/s; 3,37 МБ / 5k карточек, 128 мс | `docs/PERF-BASELINE.md`, `docs/PERF-CAPACITY.md` |
| Команды одной доски | ~42–48/с; ~24 мс на 200 карточках | `docs/PERF-ONE-BOARD.md` |
| Команды 100 досок | ~290/с | `docs/PERF-BASELINE.md` |
| Запросов на PAT-команду | ~30–40, до 3 загрузок aggregate | `backend/src/commands/commands.service.ts` |
| SSE | 3 000 соединений ≈ 703 МБ; ~0,10–0,17 МБ/conn | `docs/PERF-BASELINE.md` |
| MCP-процесс | 108–113 МБ RSS | `docs/PERF-BASELINE.md` |
| Board rate limit | 600 req/min на доску (общий) | `backend/src/config/rate-limit.ts` |
| WSL 8 ГБ | dev-окружение, не продукт: API idle 123–173 МБ | `docs/PERF-AGENT-SCALE.md` §2.3 |

Все оценки ёмкости в research-документе — экстраполяция из этих unit-cost
замеров. Реального 500-агентного прогона ещё нет; поэтому 200.1 —
обязательный первый шаг.

---

## 2. Принципы

1. **Сначала измерить, потом менять.** Каждая подзадача начинается с
   baseline-замера и заканчивается сравнением с ним.
2. **Не ломать correctness core.** Command log, `seq`, идемпотентность,
   undo/preimages, advisory lock и SSE-resume остаются как есть.
3. **Никаких переписываний «на всякий случай».** Go, Fastify, React и
   worker threads не входят в план по умолчанию (см. §7).
4. **Обратная совместимость.** MCP-тулы и публичный API не ломаются без
   версии/капабилити-гейта; старые клиенты продолжают работать.
5. **Один PR = одна подзадача.** Параллелить можно только непересекающиеся
   файлы/пакеты.
6. **Лучше меньше, но доказано.** Цифры в PR обязательны: p50/p95, RSS,
   queries/command, 409/429, bytes/request.

---

## 3. Подзадачи

Приоритеты: **P0** — без этого эпик не имеет смысла; **P1** — целевая
ёмкость; **P2** — устойчивость/эксплуатация; **Gate** — только по замеру.

### 200.1 — Harness и baseline (P0)

**Проблема:** нет ни одного замера реального агентского сценария; все
решения ниже опираются на unit-cost экстраполяцию.

**Scope:**
- HTTP/k6-драйвер: `GET /boards/:id`, `POST /commands`, `POST /comments`,
  `GET /activity`, `GET /events`, `/health`.
- MCP-драйвер: N реальных stdio-процессов (или HTTP-сессий позже),
  последовательность `ready → claim → comment → move`.
- Сценарии S1–S6: idle swarm; claim→comment→move; mixed с людьми и SSE;
  burst-старт; SSE ramp 0→5 000; read burst 500×1 000 карточек.
- Инструментация: `process.memoryUsage`, event-loop delay, `--cpu-prof`,
  `pg_stat_statements`, `pg_stat_activity`, Redis `INFO`, MCP RSS/запросы.
- Генератор — на отдельном хосте от API; результаты — в
  `scripts/perf/results/` с датой и коммитом.

**DoD:**
- Воспроизводимый прогон одной командой; baseline-отчёт с p50/p95/p99,
  actions/s, 409/429/5xx, RSS, query count.
- Профиль Top-20 запросов и Top-10 CPU-функций.
- Задокументированы фактические cadence агентов и boards-per-swarm
  (см. §10).

**Файлы:** `scripts/perf/`, `docs/PERF-*`, CI (nightly заготовка).

---

### 200.2 — Server-side ready/work endpoint + long-poll (P0)

**Проблема:** `janosik_wait_for_work` каждые 5 с читает всю доску; 500
простаивающих агентов — ~100 полных чтений/с.

**Scope:**
- `GET /boards/:id/ready?limit=` — только summary готовых карточек
  (id, title, column, priority, claim state), индексированный SQL по
  первой колонке.
- Long-poll 25–60 с или резко сниженный cadence; jitter обязателен.
- MCP `wait_for_work` переводится на новый endpoint; full board для
  поиска работы больше не читается.
- Опционально: `GET /boards/ready` для всех доступных досок без N+1.

**DoD:**
- Idle full-board reads/agent/min падают ≥90%.
- 500 агентов: summary-запросы вместо полных досок; p95 <300 мс.
- MCP-тул сохраняет контракт (timeout, фильтры, выбранная доска).

**Файлы:** `backend/src/boards/*`, `mcp/src/tools/cards.ts`,
`shared/src/api.ts`, docs/MCP reference.

**Статус:** реализовано в `feat/TASK-200.2-ready-endpoint` (review fixes).
`GET /boards/:id/ready` — сводка по первой/начальной колонке
(`ReadyService`, индексированный SQL с `LIMIT`); текст описания не
выбирается, а `descriptionChars` берётся из сохранённого
`Card.descriptionLength`, который поддерживает триггер БД (миграция с
backfill). `?wait=` удерживает запрос 0–60 с и просыпается только на
действиях, меняющих готовность (карточка/колонка/claim/связь/workflow),
либо `resync`; метки, чек-листы, комментарии и переименование доски не
будят. Пустое состояние после пробуждения продолжает удержание, а
со-ждущие делят один снимок на событие; удержанный `200`/`204` несёт
`X-Ready-Held`, таймаут — `204` с `X-Board-Seq`/`no-store`, `?since=`
завершает начальное удержание сразу после изменения доски. Отключение
клиента освобождает подписку и слот допуска; на процесс есть лимиты
удержаний (`503 ready_poll_capacity` + `Retry-After`), а из latency
p50/p95 исключается только реально удержанный успешный ответ. Удаление
доски во время удержания — `404`.
`GET /boards/ready` — та же сводка по всем доступным доскам за
постоянное число запросов (без N+1); архивные доски перечислены пустыми,
`ready` не парсится как id доски.
MCP `list_ready_cards`/`wait_for_work` используют эти эндпоинты: одиночная
доска — long-poll 25–60 с с jitter независимо от `pollMs`, без `boardId` —
полный диапазон 15–60 с; `timeoutMs: 0` делает один снимок, транзиентные
сетевые ошибки и capacity повторяются внутри дедлайна; контракт тула
сохранён (включая `descriptionChars`), а сервер без эндпоинта (`404`)
получает прежний full-board fallback. Покрытие: unit
`ready.service.spec.ts` (форма, лимит, первая колонка, wake-фильтр, пустое
пробуждение, coalescing, timeout/abort, удаление, admission, число
запросов), e2e `ready-work.e2e-spec.ts` (VIEWER, PAT, архив, membership,
timeout/wake/since, disconnect, all-boards, capacity, description length),
MCP client/server тесты, миграция, OpenAPI и EN/RU документация.
**Ограничение:** p95 для 500 агентов не измерялся — тяжёлая нагрузка в
рамках этой задачи не запускалась; это остаётся проверкой 200.1/емкостного
прогона, а не доказанным результатом 200.2.

---

### 200.3 — Budget и `429`/`Retry-After` (P0)

**Проблема:** board-бакет 600 req/min общий на доску; MCP не ретраит 429.

**Scope:**
- Пересмотреть `BOARD_RATE_LIMIT`: safety ceiling + per-token/session
  бюджеты вместо одного узкого бакета.
- MCP: уважать `Retry-After`, экспоненциальный backoff с jitter, лимит
  попыток; не превращать 429 в падение тула.
- Сервер: по возможности очередь/`503` вместо мгновенного `429` для
  команд, чтобы burst не терял работу.
- Метрики: 429 по токену/доске, fairness.

**DoD:**
- 100 агентов на одной доске не упираются в 429 на idle.
- 500 агентов/20 досок: 429 <0,1%, один abusive token не голодает доску.
- Тест: параллельные агенты + один шумный токен.

**Файлы:** `backend/src/config/rate-limit.ts`,
`backend/src/common/*rate-limit*`, `mcp/src/client.ts`, `mcp/src/errors.ts`.

**Статус:** реализовано в `feat/TASK-200.3-rate-budget`. Доска — высокий
предохранительный потолок с непрерывным пополнением (`BOARD_RATE_LIMIT`,
`max(12000, 2 × THROTTLE_LIMIT)`); справедливость — на бюджетах токена
(`AGENT_TOKEN_RATE_LIMIT`) и сессии. Команды сверх потолка ждут
`AGENT_COMMAND_QUEUE_MS` и получают `503 rate_limited` + `Retry-After`; MCP
сам повторяет `429`/`503` с `Retry-After`, jitter и лимитом попыток, сохраняя
`commandId`/`Idempotency-Key`.

---

### 200.4 — Убрать дубли aggregate на PAT-команде (P0)

**Проблема:** до трёх полных загрузок доски и два full-board
`stableStringify` на одну команду; 30–40 запросов.

**Scope:**
- Одна загрузка aggregate внутри транзакции, переиспользовать для
  plan-limits и running state.
- Пропускать pre-lock aggregate, когда классификация политики не требует
  полного снимка.
- Сузить `include: user` у PAT до нужных полей.
- Не менять семантику `ifMatch`, идемпотентности и undo.

**DoD:**
- Queries/command −30…50%; throughput +1,3–2× на 200 карточках.
- Все correctness/e2e-тесты команды зелёные; `pg_stat_statements`
  подтверждает снижение.

**Файлы:** `backend/src/commands/commands.service.ts`,
`backend/src/auth/api-token.service.ts`, `backend/src/boards/board-aggregate.ts`.

**Реализовано (TASK-200.4):**
- Pre-lock снимок грузится только когда он реально нужен: `classifyPlan`
  читает доску лишь для done-переходов/созданий, а card-create лимит —
  только для `ADD_CARD`/`DUPLICATE_*`. Обычный `UPDATE_CARD`/claim/delete
  классифицируется на `emptyBoardAggregate`, без запросов к
  `Column`/`Label`/`Card`/`CardLink`.
- План, который сам меняет workflow/колонки (`SET_BOARD_WORKFLOW`,
  `ADD_COLUMN`/`DELETE_COLUMN`/`MOVE_COLUMN`, restore/archive колонок),
  всегда берёт реальный снимок: `classifyPlan` сначала реплеит эти команды,
  и `UNARCHIVE_CARD`/`MOVE_CARD` после них может стать done-переходом даже
  на доске без done-колонок.
- `loadBoardAggregate` принимает уже прочитанную строку `Board`: в
  транзакции она одна и служит и для plan-limits, и для running state.
  Обычный edit-replay не грузит aggregate в транзакции; create/workflow
  replay оставляет один pre-lock снимок, потому что его всё ещё нужно
  классифицировать/посчитать. Между pre-lock и tx нет второй/третьей
  полной загрузки.
- `ApprovalsService.ensureCommandApproval` принимает этот же снимок, чтобы
  approval-seam не делал ещё одну загрузку ради `maxCardsPerRun`; планы с
  `ADD_CARD`/`DUPLICATE_*` берут реальный снимок даже при полном replay,
  иначе soft-deleted карточки занижали бы лимит.
- PAT `authenticate` выбирает 12 полей пользователя вместо `include: user`
  целиком; `disabledAt`/`expiresAt`/`revokedAt` читаются как раньше.
- Тесты: `test/commands-aggregate-load.e2e-spec.ts` (spy на
  `loadBoardAggregate`: 1 загрузка на fresh-команду и батч, 0 на обычный
  edit-replay, 1 pre-lock на done workflow-replay, 0 pre-lock для
  board-independent destructive-классификации), `board-aggregate.spec.ts`
  (переиспользование строки `Board`), `plans.e2e-spec.ts`
  (workflow+unarchive/move как `done`-approval, replay create-лимита).

Статический счёт запросов на одну PAT `UPDATE_CARD` (без run, доска без
workflow): было ≈31, стало ≈20 (−35%); обычный edit-replay — ≈14 → 4;
батч из 5 команд — один aggregate вместо трёх. Safety-случаи (done
workflow, create, смена workflow планом) добавляют один pre-lock снимок,
но не возвращают вторую загрузку в транзакции. Это mock/статическая оценка;
`pg_stat_statements` на живом стенде остаётся для приёмки 200.15.

---

### 200.5 — TTL-кэши auth/membership/flags + SSE `presence=0` (P1)

**Проблема:** каждый запрос — PAT lookup + board lookup + membership;
каждый SSE-tick — 4–6 запросов; флаги не кэшированы.

**Scope:**
- TTL 10–30 с: PAT (по hash), membership (user, board), feature flags.
- Инвалидация по revoke/смене роли/pause/флагу через существующий
  realtime-bus.
- SSE для агентов по умолчанию `?presence=0`; keep-alive с jitter и
  overlap-guard; для PAT-потоков — 60 с.
- Bypass кэша на write/pause/resume.

**DoD:**
- Запросов на 500 агентов меньше на 30–50%; keep-alive QPS <100 на
  3 000 потоков.
- Тест: отзыв токена виден в пределах TTL; pause применяется сразу.

**Файлы:** `backend/src/auth/*`, `backend/src/common/membership.guard.ts`,
`backend/src/ops/feature-flags.service.ts`,
`backend/src/commands/events.controller.ts`.

**Реализация (TASK-200.5):**
- Один process-wide `HotPathCacheService` (global module) вместо кэша на
  каждый guard-инстанс. TTL: PAT — `AUTH_CACHE_TTL_MS` (15 с), членство —
  `MEMBERSHIP_CACHE_TTL_MS` (30 с), строка флага — `FEATURE_FLAG_CACHE_MS`
  (30 с). Все три — bounded LRU (`*_MAX_ENTRIES`), ключи содержат полный
  тенант: sha256 PAT, `(boardId, userId)`, ключ флага. Per-user overrides
  флага применяются после чтения строки, поэтому строка безопасна для всех.
- Инвалидация — control-plane канал `janosik:cache-invalidate` в
  существующем `RealtimeService`: локальные слушатели срабатывают
  синхронно, при наличии Redis версионированный кадр (v1) разносится по
  репликам (без Redis — только TTL-граница на других узлах). Membership-кадры
  автоматически инвалидируют `(board, user)`; token revoke/update/pause/resume/
  pause-all/resume-all, password reset/change, OAuth claim, admin revoke/disable,
  account deletion (только после коммита внешней транзакции) и
  `FeatureFlagsService.update` публикуют явно; admin-правки
  членства, передача владельца и удаление доски — тоже. Пропущенный кадр
  ограничен TTL.
- Загрузка кэша singleflight по ключу + epoch-guard: 500 одновременных
  промахов дают один запрос, а инвалидация во время запроса не даёт записать
  устаревший ответ. TTL не скользит: окно членства продлевается только
  чтением из БД, не попаданием в кэш.
- Bypass: PAT `authenticate({fresh})` для всех write-методов и SSE-коннекта;
  `MembershipGuard` читает членство из кэша только для обычных GET. Борда
  (`agentsPausedAt`) читается всегда свежей, а pause/resume проверяется на
  каждом write/SSE-tick — пауза применяется сразу. Просроченный
  `expiresAt` в закэшированной строке не используется и перечитывается.
  PAT, истекающий внутри окна, не кэшируется.
- SSE: PAT-поток по умолчанию `presence=0` (явный `?presence=1` возвращает
  ростер), JWT — как раньше `presence=1`. Ticks: 25 с для людей и 60 с для
  PAT, с jitter (2,5 с / 6 с) и overlap-guard; пропущенные из-за
  пересечения тики агрегируются в одну строку лога в минуту; один
  `KeepAliveScheduler` на поток, `onModuleDestroy` останавливает все таймеры.
  Keep-alive tick переиспользует только `acceptedAt`/`expiresAt`/`board.deletedAt`
  на 30 с; token active/pause, `passwordHash`/`disabledAt`/`email` для JWT-stamp,
  expiry/family и `verifyCaughtUp` читаются свежими на каждом тике. Удаление
  доски очищает board/membership-снапшоты, поэтому открытый поток закрывается
  на следующем тике, а не через 30 с.
- Тесты: `ttl-cache.spec.ts` (LRU/expiry), `hot-path-cache.spec.ts`
  (инвалидация, изоляция тенантов, границы, singleflight/epoch),
  `cache-invalidation.spec.ts` (локальный канал, membership-кадр, версия),
  `keep-alive.spec.ts` (jitter/overlap/stop), `sse-timing.spec.ts` (25 s/60 s),
  `feature-flags.service.spec.ts` (500 чтений и 500 конкурентных = 1 запрос,
  TTL, update, per-user), `api-token.service.spec.ts` (500 PAT = 1 lookup,
  fresh bypass, revoke/pause, инвалидация без изменённых строк),
  `membership.guard.spec.ts` (read-hit без скольжения TTL, singleflight,
  write/SSE bypass, expired row, fresh role),
  `stream-access.service.spec.ts` (свежие password/disable поля при
  закэшированном membership), `admin-cache-invalidation.spec.ts` (revoke и
  disable), `account-deletion.service.spec.ts` / `account-data.service.spec.ts`
  (инвалидация только после коммита), `events.controller.spec.ts` (presence
  default, shutdown таймеров, агрегация skip-логов),
  `env.spec.ts` (неотрицательные TTL/bounds), плюс
  `task-200-5-auth-cache.e2e-spec.ts` (bootstrap DI, revoke только по TTL
  vs немедленно, role/pause/flag invalidation, presence defaults, удаление
  доски закрывает поток, смена пароля закрывает поток). Mock-оценка: обычный
  board GET с PAT — 1 запрос в steady-state (board) вместо 3 (PAT + board +
  membership); 500 одинаковых/конкурентных PAT-чтений и флаговых проверок
  дают по одному lookup. SSE: 3 000 PAT-потоков тикают ~50 раз/с вместо
  ~120 при 25 с; человеческий 25-секундный тик попадает в кэш
  флагов/членства через раз. Это mock/unit оценка; реальные 500 агентов и
  `pg_stat_statements` — приёмка 200.15.

---

### 200.6 — gzip/ETag/singleflight и лимит конкурентных чтений (P1)

**Проблема:** одинаковые чтения строятся и сериализуются каждое отдельно;
500 одновременных чтений — OOM-вектор.

**Scope:**
- gzip/br на `GET /boards/:id` (или на прокси), ETag по `seq + route +
  role/projection`.
- Singleflight: одинаковые запросы coalesce в одну сборку.
- Семафор/очередь на конкурентные полные чтения; вежливый `503`/ожидание
  вместо OOM.
- Кэш не отдаётся для CAS-записи без учёта конфликта.

**DoD:**
- Bytes/response −70…80%; 500 одновременных чтений 1 000 карточек:
  RSS <2 ГБ, без 5xx.
- ETag-тест: изменение доски меняет ETag; `304` корректен.

**Файлы:** `backend/src/boards/boards.service.ts`,
`backend/src/common/*`, `nginx/Caddy` конфиг (если прокси).

**Реализовано (TASK-200.6):**
- `GET /boards/:id` отвечает через `BoardReadService`
  (`backend/src/common/board-read.service.ts`): одна дешёвая SQL-метка
  `aggregateRevision + MAX(Command.seq)` (`BoardsService.getReadStamp`), затем
  `If-None-Match` → `304` **до** загрузки aggregate. Слабый `ETag` строится из
  board id + `Board.aggregateRevision` + route + role + projection.
  `aggregateRevision` — новая BIGINT-колонка (миграция
  `20261123100000_task_200_6_board_aggregate_revision`, backfill из текущего
  `MAX(seq)`), монотонная: `Board` BEFORE UPDATE trigger поднимает её на любую
  правку доски, statement-level `Card` INSERT/UPDATE/DELETE триггеры — на
  комментарии, вложения, claim-expiry, admin/account-deletion правки, а вторая
  миграция `20261123120000_task_200_6_aggregate_table_triggers` покрывает
  Label, Column, CardLink, CardLabel, Checklist и ChecklistItem
  (statement-level transition tables, boardId через Card/Column joins).
  Стоимость — один UPDATE строки `Board` на SQL statement на затронутую доску,
  не на строку; при этом writer позиций чанкует по 1 000, поэтому перестановка
  5 000 карточек — это 5 Card-стейтментов + 1 Column-bump (`bumpColumnVersion`)
  + 1 Board-bump самой команды = 7 bump'ов, а не один. Циклы, пишущие по одной
  строке на entity (duplicate column/cards, checklist item upserts, label
  restore по одному), платят один bump на итерацию; это задокументированная
  амплификация, а не per-row trigger. `X-Board-Seq` остаётся отдельным SSE-значением и может
  уменьшиться после sweep команд, не меняя ETag. `304` берёт seq из той же
  одно-запросной метки, чтобы клиент не перепрыгнул команду, отсутствующую в
  кешированном теле.
- `Cache-Control: private, no-store`; `Vary: Accept-Encoding` ставится и на
  200, и на 304. UI/MCP пока не шлют `If-None-Match`, поэтому ETag — для явных
  условных клиентов; `no-store` сознательно запрещает браузерную ревалидацию
  (иначе ответ мог бы переехать между пользователями одного профиля).
- Сжатие — только этот буферизованный JSON: gzip/Brotli через async `zlib`
  (Brotli q4 предпочтителен при равном q; identity без явного q считается
  q=1, поэтому `gzip;q=0.5` выбирает identity, а `gzip;q=1`/`*` — сжатие;
  явный `identity;q` переопределяет; `q=0` исключает кодировку), порог 1 КБ,
  откат в identity, если сжатие не уменьшило тело. SSE, multipart, media и
  `no-transform` helper не трогает; глобального compression middleware нет,
  поэтому uploads/ошибки/потоки остаются как были.
- Singleflight (`backend/src/common/single-flight.ts`) объединяет одинаковые
  конкурентные чтения в одну сборку **вместе с сериализацией и сжатием**
  (ключ: board + role + projection + coding; ничего пользовательского), так
  что всплеск делит и буферы. Точка линеаризации — снимок БД лидера, а не
  момент присоединения: joiner после записи может получить pre-write snapshot;
  это не read-your-writes, и клиенту с таким требованием нужен ещё один
  проход. Запись живёт только до settle: ошибка/таймаут не отравляют ключ,
  следующий запрос снова читает БД — CAS-retry не получает вечный snapshot.
- Семафор (`backend/src/common/read-semaphore.ts`) ограничивает полные
  сборки **на процесс**: `BOARD_READ_CAP=16`, `BOARD_READ_QUEUE_MAX=256`,
  `BOARD_READ_WAIT_MS=10000`, `BOARD_READ_TIMEOUT_MS=20000` (обязан быть больше
  wait и не меньше 300 мс), `BOARD_READ_RETRY_AFTER_SECONDS=2`. На старте
  `read()` считается **один** deadline; remainder передаётся условному stamp,
  semaphore/singleflight wait, Prisma `maxWait`/`timeout` и кодированию, поэтому
  conditional miss не складывает `WAIT_MS + TIMEOUT_MS`. Stamp по-прежнему идёт
  мимо semaphore (это один дешёвый indexed-запрос) и **намеренно не
  coalesce'ится**: зависший общий stamp отравил бы все последующие
  conditional-чтения, а joiner мог бы получить pre-write `304`. Каждый stamp
  ограничен своим transaction/`statement_timeout`; зависший promise
  бросается, следующий запрос начинает новый. Если stamp исчерпал deadline,
  build уже не стартует. Cap может быть выше
  `DB_CONNECTION_LIMIT=10`: лишние сборки ждут в Prisma pool не дольше
  `BOARD_READ_WAIT_MS` и получают `503 board_read_busy`; для нулевого pool-wait
  задайте cap ≤ pool. При `WAIT_MS=0` semaphore не держит очередь и pool
  `maxWait=0`, но stamp и транзакция получают общий deadline; `maxWait +
  timeout` всегда ≤ остатка (transaction slice резервируется заранее).
  Переполнение очереди/ожидания, P2024, P2028-start, P2028-expired и
  PostgreSQL `statement_timeout` (P2010/57014) отвечают `503
  board_read_busy`/`board_read_timeout` + `Retry-After`; коды добавлены в
  `API_ERROR_CODES`, OpenAPI enum и `RETRYABLE_CODES`. Read-транзакция получает
  `timeout` = остаток минус encode-margin (не более 250 мс) и `maxWait` =
  min(`BOARD_READ_WAIT_MS`, budget) с зарезервированным transaction slice,
  поэтому pool-wait/transaction-timeout/statement-timeout не становятся `500`. Уже отправленный запрос не отменяется, но истекает по
  этому budget и освобождает слот. `onModuleDestroy` отклоняет очередь и ждёт
  активные чтения (bounded). Порядок «auth → membership → role/pause → ETag»
  задаёт `MembershipGuard`; чужой не получает 304.
- UI: фоновая гидратация остальных досок ретраит GET доски до 4 попыток с
  backoff 1/2/4 с, но пока не выдерживает `Retry-After`; явный refetch после
  `503 board_read_busy`/`board_read_timeout` не ретраится, а idempotent POST
  делает один немедленный повтор. Расхождение ограничено этими бюджетами и
  задокументировано; Retry-After-aware retry чтения остаётся будущему клиенту.
  MCP считает оба кода transient и повторяет GET в своём bounded network-budget.
- Метрики процесса — `BoardReadService.metrics` (fullReads, coalesced,
  notModified, compressed, identity, rejected, timeouts, inFlight,
  active/waiting); Prometheus-экспорта в проекте нет. Request-log/traffic
  классифицируют `board_read_*` 503 как backpressure (`rateLimited.read`), не
  как 5xx, через маркер ответа из exception filter; в `throttledLastMinute`
  (429 ring) они не попадают, поэтому двойного счёта нет.
- Тесты: `backend/src/common/*.spec.ts` (singleflight, семафор, negotiation с
  identity/q=0 и fallback, ETag, сервис, общий stamp+build deadline,
  hanging-stamp recovery, WAIT_MS=0 maxWait=0, P2010/57014/P2028/P2024→503,
  timeout/backpressure) и `backend/test/board-read.e2e-spec.ts` (gzip/br +
  Content-Length + Vary, tiny/304 + Cache-Control, role/tenant/role-change,
  CAS rename, non-seq policy, attachment add/delete, comment, claim
  release/expiry, direct admin edit, command-log sweep, прямые мутации
  Label/Column/CardLabel/Checklist/ChecklistItem/CardLink через delete/restore,
  trigger bump-семантика, 12→1 через spy на `$transaction`, queue-wait/
  queue-full/timeout 503+Retry-After, настоящий PostgreSQL statement_timeout
  через `pg_sleep`), `board-read-wait-zero.e2e-spec.ts` (полный 200 + 304 при
  `WAIT_MS=0`), плюс `task-200-6-migration.e2e-spec.ts` для backfill и per-run
  temp upload dir.
  `openapi:check`/`openapi:test` зелёные.
- **Честно про DoD:** механизм и тесты поставлены, но −70…80% байт и
  RSS <2 ГБ на 500×1 000 карточек **не измерялись** в этой задаче — для них
  нужен отдельный стенд и прогон 200.1/200.15. Ожидание по байтам основано на
  `docs/PERF-AGENT-SCALE.md` и gzip-замерах `PERF-25K-UX`, а не на новом
  замере. Прокси: API сам отдаёт `Content-Encoding` + `Vary`; nginx не должен
  повторно сжимать уже сжатый ответ (заметка в `deploy/nginx.conf`), Caddy
  также оставляет upstream `Content-Encoding` без изменений.

---

### 200.7 — Per-entity CAS / targeted intents вместо board-wide CAS (P1)

**Проблема:** MCP читает всю доску и шлёт `ifMatch = board seq`; правки
разных карточек конфликтуют, каждый retry снова читает доску.

**Scope:**
- MCP использует `ifMatchVersions` для затрагиваемых сущностей (сервер уже
  поддерживает).
- Либо targeted endpoints: `claim`, `move`, `PATCH card`, `comment` —
  сервер сам загружает карточку/колонку/workflow и применяет команду.
- `ifMatch = seq` остаётся для явного режима «прочитал всю доску».
- Контракт ошибок: 409 содержит актуальные версии, чтобы retry был
  точечным.

**DoD:**
- 409-retry rate на несвязанных правках <5%.
- MCP-действие больше не требует полного чтения доски (кроме явного
  режима).
- Тесты: concurrent move/update разных карточек; конфликт одной карточки
  по-прежнему 409.

**Файлы:** `mcp/src/client.ts`, `mcp/src/tools/*`,
`backend/src/commands/*`, `shared/src/api.ts`.

---

### 200.8 — MCP Streamable HTTP gateway (P1)

**Проблема:** 108 МБ × N процессов; 500 агентов на одной машине
невозможны.

**Scope:**
- Отдельный сервис/контейнер с Streamable-HTTP транспортом, token
  pass-through из `Authorization`.
- `JanosikClient` на сессию/запрос; никакого общего состояния токенов.
- stdio остаётся для desktop-клиентов.
- Не встраивать gateway в API-процесс.

**DoD:**
- 500 сессий — один/несколько процессов, суммарно сотни МБ, не 54 ГБ.
- Изоляция токенов: сессия A не видит данные сессии B.
- Нагрузочный тест: 100/500 HTTP-сессий.

**Файлы:** `mcp/src/index.ts`, новый `mcp/src/http*`, Docker/CI.

---

### 200.9 — Read model v1: summary + pages + detail (P1)

**Проблема:** `GET /boards/:id` отдаёт все карточки с описаниями и
checklist/link; 3,37 МБ на 5k, 64–131 МБ transient на открытие.

**Scope:**
- Summary: колонки, счётчики, первая страница карточек.
- Курсорные окна по колонкам и отдельный card detail.
- Capability-гейт: старый full aggregate остаётся для старых клиентов,
  admin/export.
- UI/store/undo/DnD/deep links переводятся постепенно, без потери
  функций.

**DoD:**
- Initial view <2 МБ / <300 мс; 10 одновременных открытий 1 000 карточек:
  RSS <1,5 ГБ.
- Board/table/calendar, undo, DnD и deep links без регрессий.
- Agent-чтения ограничены summary/ready/detail.

**Файлы:** `backend/src/boards/*`, `ui/src/store/*`,
`ui/src/components/board/*`, `shared/src/api.ts`.

**Реализовано (TASK-200.9, read model v1):**
- `GET /boards/:id/summary?limit=` — метаданные доски, метки, колонки с
  полным упорядоченным `cardIds` (для абсолютных DnD-индексов), счётчики
  активных/архивных карточек, архивные id и первая страница карточек на
  колонку. В теле нет `description`, `checklists`, `links`, task spec —
  только счётчики (`descriptionChars`, элементы чек-листов, степень/blocked
  связей). `role` входит в ответ, `seq`/`atSeq` — командная
  последовательность, `aggregateRevision` — контентная ревизия.
- `GET /boards/:id/cards?columnId=&cursor=&limit=` — keyset-страницы
  `(position, id)`; `?archived=1` — архив доски `(archivedAt desc, id)`.
  Непрозрачный cursor привязан к доске и колонке/архиву; чужой cursor —
  `400`, чужая колонка — `404`; `limit` ≤100, `total` — полный размер
  области. `ids=…&detail=full` (≤50) — bounded batch полных карточек для
  undo-preimage; `detail=full` на списке запрещён.
- `GET /boards/:id/cards/:cardId` — единственное полное чтение карточки:
  описание, чек-листы, связи, task spec, версия, `linkCount`/`blocked`,
  `seq`/`aggregateRevision`. Карточка ищется через `:boardId`, чужая — `404`.
- Все три проекции идут через TASK-200.6 read path: weak ETag с board +
  revision + route + role + canonical query, `304` до сборки тела, gzip/
  Brotli, `Vary`, `X-Board-Seq`; membership/role/архивные правила те же.
- Старый `GET /boards/:id` остаётся для старых клиентов, admin/export/
  internal. Capability-гейт: клиент с `X-Janosik-Read-Model: v1` получает
  `400 read_model_required`, пока не попросит `?projection=full`; старый
  клиент без заголовка работает как раньше.
- UI: гидратация идёт summary + первая страница, остальные summary-страницы
  догружаются в фоне; полный порядок id известен сразу (DnD не становится
  page-local). Карточка открывается с detail-запросом (диалог показывает
  скелетон, редактор описания не монтируется до detail). Deep link на
  карточку вне первой страницы сначала тянет detail и только потом
  объявляет её отсутствующей. Destructive-команды (`DELETE_CARD`,
  `DELETE_COLUMN`, `ARCHIVE_COLUMN_CARDS`, удаление чек-листов и т.п.)
  сначала загружают preimage чанками ≤50, поэтому undo восстанавливает
  полное содержимое. Лицевые бейджи/фильтры связей используют скалярные
  факты summary, таблица/календарь/фильтры/сохранённые виды/
  bulk-selection — прежние контракты. Server-search по-прежнему покрывает
  описание/чек-листы/комментарии/вложения для query-фильтра.
- Тесты: `backend/test/task-200-9-read-model.e2e-spec.ts` (форма/лимиты/
  cursor/чужой cursor/чужая доска/VIEWER/outsider/архив/старый full gate/
  batch/ETag/304, отсутствие detail-полей в payload),
  `ui/src/store/read-model.test.ts` (адаптеры, merge деталей, link facts),
  `ui/src/store/BoardContext.read-model.test.tsx` (summary+все страницы,
  detail on demand, preimage+undo), deep-link тест в
  `CardDialog.test.tsx`; OpenAPI и CHANGELOG обновлены.
- **Review hardening:** инверсия `UPDATE_CARD` теперь меняет только поля,
  которые команда реально трогала (title-only rename на summary-карточке
  больше не пишет пустое описание). Ответ `DELETE_LABEL` несёт
  `preimage.labelAssignments`, снятый внутри транзакции под board-write
  lock: инверсия `RESTORE_LABEL` восстанавливает все вложения
  (1000-карточная доска, загружена первая страница), а параллельный
  add/remove не может обогнать снимок. Undo/redo ждут ответ, прежде чем
  снять шаг со стека (быстрый Ctrl+Z не отправляет неполный inverse), а
  провалившийся delete сбрасывает отложенный undo, не трогая более старый
  шаг; redo получает свежий снимок собственного удаления. Устаревший
  `GET .../labels/:labelId/assignments` оставлен на один релиз для старого
  UI при rolling deploy; новый UI дополнительно снимает его перед delete
  как fallback для старого backend. Detail отдаёт и входящие строки связей
  (`incomingLinks`), а reducer обновляет `readModel.linkCount/blocked` на
  add/remove/archive, на delete card/column и restore — включая выживших
  *источников* удалённой цели, — и сохраняет консервативный `blocked` у
  summary-цели, пока возможен другой блокер или неблокирующая связь.
  Fact-only изменение summary (тот же `updatedAt`) вливает свежие
  count/blocked в закешированный detail, сохраняет `detailLoaded` (открытый
  диалог не падает в loading-skeleton), убирает входящие строки и помечает
  их stale; диалог и popover затем перечитывают detail. Старая страница
  никогда не заменяет более новый локальный detail, а detail с тем же
  stamp применяется, если изменился состав входящих строк. Иностранные
  checklist-команды по summary-карточке планируют тот же refresh. Reducer
  также обновляет счётчики описания/чек-листа, сбрасывает факты у duplicate
  и грузит preimage для duplicate column. Гидратация
  страниц сверяет `atSeq`/`aggregateRevision` с summary и мержит только id,
  ещё входящие в колонку/архив; `HYDRATE_CARDS` не воскрешает tombstone и не
  перетирает более новую карточку. Ошибки страниц ретраятся, показывают
  partial-маркер с кнопкой повтора; завершённая неизменённая доска не
  перекачивает все страницы на каждый focus, но новый `atSeq`/revision
  перечитывает страницы (правка на второй странице не теряется; это
  осознанная плата за отсутствие page-level revision). `If-None-Match: *`
  выполняет precheck существования карточки/колонки до `304` и не пропускает
  валидацию cursor; частичный batch detail — all-or-nothing `404`. Запросы:
  summary — одна страница на колонку + константа, batch preimage — одна
  карточная выборка на 50 id (`board-read-model.spec.ts`). Popover
  связанных карточек догружает detail summary-карточки и помечает
  незагруженную цель «Not loaded», а не «Deleted card».
- **Ограничение:** DoD «initial <2 МБ / <300 мс» и RSS для 10×1 000
  карточек не измерялись — нужен прогон 200.1/200.15. Таблица/карточки без
  detail показывают счётчики вместо текста описания/чек-листа (detail
  приходит при открытии карточки); это осознанный lazy-контракт v1.

---

### 200.10 — Per-board aggregate cache по `aggregateRevision` (P2)

**Проблема:** каждая команда заново грузит всю доску из БД.

**Scope:**
- Board revision, который растёт от любого board-scoped writer (команды,
  комментарии, вложения, session end, admin restore).
- LRU aggregate в памяти; использовать внутри транзакции.
- Инвалидация между репликами (Redis/версия) и тесты на coherency.
- Не путать с `seq`: комментарии/вложения не всегда двигают command seq.

**DoD:**
- Command throughput 5–10× на больших досках.
- Тесты: comment/attachment/session/admin-восстановление инвалидируют кэш.
- Память кэша ограничена и настраиваема.

**Файлы:** `backend/src/boards/*`, `backend/src/commands/*`,
`backend/src/comments/*`, `backend/src/attachments/*`.

---

### 200.11 — Command log: партиционирование/вынос деталей (P2)

**Проблема:** 9 индексов, JSON payload/result/details, 30 дней retention,
нет партиций; при 25–50 командах/с — гигабайты в день.

**Scope:**
- Партиции по доске или месяцу; вынос тяжёлых `details`/preimages в
  side-таблицу или сжатие.
- Ограничение размера description-diff.
- Политика retention для агентских команд (если аудит допускает).
- Дашборд bloat/vacuum.

**DoD:**
- 30 дней при целевой нагрузке не превращаются в сотни ГБ без плана.
- Replay/resync/undo/admin-запросы работают.
- Миграция проверена на пустой и существующей БД.

**Файлы:** `backend/prisma/schema.prisma`, миграции,
`backend/src/ops/maintenance.service.ts`, `backend/src/commands/*`.

---

### 200.12 — Реплики API + nginx/Caddy (P1, production prerequisite)

**Проблема:** один Node-процесс обслуживает API, SSE, uploads и статику;
нет прокси и лимитов.

**Scope:**
- 2–4 API-реплики за прокси; Redis для общего throttler/fan-out.
- Статика/gzip/SSE-buffering — на прокси.
- `ulimits.nofile`, memory/CPU limits, `DB_CONNECTION_LIMIT` на реплику.
- SSE не требует sticky из-за `?since=`; проверить на практике.

**DoD:**
- Горизонтальный прогон S2/S3 без расхождения лимитов и SSE.
- Документированная топология и sizing на 4 vCPU/8 ГБ и 16 vCPU/32 ГБ.
- Rollback на одну реплику.

**Файлы:** `docker-compose*.yml`, `Dockerfile`, `deploy/*`, docs
self-hosting.

---

### 200.13 — Pre-serialized SSE frames и keep-alive (P2)

**Проблема:** Nest stringify'ит кадр на каждого подписчика; fan-out
синхронный после commit.

**Scope:**
- Сериализовать `data:` один раз на событие, писать один Buffer всем.
- Ограничить буфер медленных подписчиков/отключать их.
- Jitter/overlap-guard keep-alive; summary-канал для агентов, если SSE
  вообще нужен агентам.

**DoD:**
- Fan-out CPU −2…10× при высоком числе подписчиков; p95 <500 мс на
  3 000 соединений.
- Нет потери порядка/ресинка.

**Файлы:** `backend/src/commands/events.controller.ts`,
`backend/src/realtime/*`.

---

### 200.14 — Сертификация ёмкости, CI-гейт и документация (P1)

**Scope:**
- Прогоны A–F из §5 на выделенном хосте; отчёт с коммитом и конфигом.
- Nightly perf job (100 агентов/1 доска, 500/20) с порогом регрессии 20%.
- PR-smoke: 50 агентов/1 доска, 2 минуты; fail при 5xx/429 >1% или
  p95 >2× baseline.
- Docs: capacity tiers, sizing, retention, known limits; EN/RU;
  CHANGELOG.
- Явное решение по 200.15.

**DoD:**
- Capacity certificate для профилей A–F (или честно зафиксированные
  отклонения).
- CI-гейт не флапает на GitHub runners (nightly — отдельный runner).
- Документация совпадает с замерами.

---

### 200.15 — Gate: только по замеру (P2, по умолчанию «нет»)

Кандидаты, которые **не** входят в план без доказанной необходимости:

| Кандидат | Когда рассматривать | Ожидание |
|---|---|---|
| Worker threads/Piscina | Если после 200.9/200.10 JSON-сериализация всё ещё >20% CPU | Малый выигрыш; горячий CPU внутри транзакции |
| Fastify adapter | Если профиль покажет >20% в Express-middleware на hot endpoint | <10% сейчас; multer/SSE/static rework |
| Go SSE gateway | Если после 200.13/200.12 SSE всё ещё доминирует | Только SSE-edge, не агентский путь |
| Полный Go rewrite | Практически никогда для этой нагрузки | 1,2–2× при идентичном порте, 6–12 месяцев |
| Read replicas | Если API CPU исправлен, а БД всё ещё насыщена | Сейчас БД не bottleneck |
| PgBouncer | >8 реплик API | 10 conn × 4 = 40 < 100 |
| Bun/Deno/uWebSockets | После отдельного spike с замером | Нет доказательств для этого workload |

Решение фиксируется в этом файле и в PR 200.14.

---

## 4. Волны и параллельность

Кодовые потоки можно параллелить, если не пересекаются файлы. UI-ревью
для задач с UI — строго через один общий слот.

| Волна | Подзадачи | Зависимости |
|---|---|---|
| W0 | 200.1 | — |
| W1 | 200.2, 200.3, 200.4, 200.12 | 200.1 |
| W1.5 | 200.5, 200.6 | 200.1; 200.12 — для прокси |
| W2 | 200.7, 200.8, 200.9 | 200.2–200.4 |
| W2.5 | 200.10 | 200.4, 200.9 |
| W3 | 200.11, 200.13, 200.14, 200.15 (решение) | W2 |

Порядок-стрелка:

`200.1 → [200.2 ∥ 200.3 ∥ 200.4 ∥ 200.12] → [200.5 ∥ 200.6] → [200.7 ∥ 200.8 ∥ 200.9] → 200.10 → [200.11 ∥ 200.13 ∥ 200.14] → 200.15 (gate)`

### 4.1 — MCP release plan (`@janosik/mcp` 0.6.0)

Опубликованная версия — `0.5.1`. TASK-200 меняет поведение MCP
(long-poll, per-entity CAS, backoff, опциональный HTTP), поэтому клиент
выходит минорным релизом **`0.6.0`**.

**Server-first.** Сначала в `main` попадают аддитивные серверные
эндпоинты, затем MCP. Старый `0.5.1` продолжает работать с новым
сервером — без выигрыша в ёмкости, но без ошибок.

**Содержимое 0.6.0:**
- `wait_for_work` переходит на long-poll нового ready-endpoint вместо
  полного чтения доски (200.2).
- Записи используют per-entity `ifMatchVersions` вместо board-wide
  `ifMatch` (200.7).
- `429`/`Retry-After` — backoff с jitter вместо простого форматирования
  ошибки (200.3).
- Опциональный Streamable HTTP-транспорт/gateway (200.8).
- Summary/detail-чтения там, где применимо (200.9).
- Обновления документации и skill.

**Совместимость.** Никаких удалённых тулов и ломающих изменений схемы;
только аддитивные опциональные параметры. Новый MCP проверяет
`/boards/:id/ready` и откатывается на старый polling, если сервер
старше. `stdio` остаётся транспортом по умолчанию, HTTP — opt-in.

**Чек-лист релиза:** версия/CHANGELOG; публикация в npm; Docker-образ,
если gateway входит в релиз; документация EN/RU и skill; матрица
совместимости (old/new server × old/new MCP); unit-тесты MCP и прогон
S2-harness.

---

## 5. Целевые SLO (предварительные, подтверждаются 200.1/200.14)

| Профиль | Нагрузка | SLO |
|---|---|---|
| **A. 500 агентов / 20 досок** | 1 действие/10 с = 50 cmd/s; ~100 req/s | p95 command <500 мс; p95 MCP <1,5 с; error <1%; 429 <0,1%; API RSS <2 ГБ; PG CPU <60% |
| **B. 1 000 агентов / 50 досок** | 1 действие/15 с = 67 cmd/s; ~133 req/s | p95 command <1 с; p95 MCP <2 с; error <1%; API RSS <3 ГБ; PG CPU <70% |
| **C. 100 агентов / 1 доска** | 1 действие/20 с = 5 cmd/s | p95 command <1 с; 409 retries <5%; 429 <0,1% |
| **D. 500 агентов / 1 доска** | 1 действие/60 с = 8,3 cmd/s | p95 command <2 с; no 429; no OOM; queue wait <500 мс |
| **E. SSE** | 3 000 потоков, 10 мин | RSS <800 МБ; keep-alive QPS <100; fan-out p95 <500 мс |
| **F. Read burst** | 500 одновременных чтений 1 000 карточек | RSS <2 ГБ (со singleflight); p95 <500 мс; no 5xx |

500 агентов на одной доске при 1 действии/с **не обещаем** — это
отдельный профиль D с медленным cadence и структурными фиксами.

---

## 6. Не входит

- Полный Go rewrite, Fastify adapter, React rewrite, worker threads по
  умолчанию (см. 200.15).
- Read replicas и PgBouncer без замеров.
- «Поднять heap до 8 ГБ» как способ пережить OOM.
- Per-card concurrency/отказ от board lock — только если одна доска
  реально должна превышать ~50 команд/с (отдельный эпик).
- Новые продуктовые функции, не связанные с ёмкостью.
- Переписывание command log/undo/SSE-контракта.

---

## 7. Риски

| Риск | Митигация |
|---|---|
| Кэш auth/membership отдаёт устаревшие права | TTL ≤30 с, bypass на write/pause, инвалидация по bus, тест на revoke |
| ETag/singleflight отдаёт устаревшую доску | ключ по `seq`, не кэшировать CAS-чтение, тест на изменение |
| Read model ломает UI/store/undo/DnD | capability-гейт, старый aggregate как fallback, поэтапный перевод |
| aggregate cache расходится между репликами | версия/revision + Redis-инвалидация, тесты на comments/attachments/admin |
| 429-backoff создаёт retry-шторм | jitter, лимит попыток, серверная очередь, метрики fairness |
| MCP-контракт меняется и ломает агентов | версия/capability, старый режим сохраняется |
| Harness меряет сам себя | генератор на отдельном хосте, фиксированный профиль |
| Command log растёт быстрее диска | 200.11 до сертификации, retention-политика |
| CI-гейт флапает | nightly на выделенном runner, широкие пороги, PR-smoke короткий |

---

## 8. Definition of Done эпика

1. 200.1 даёт воспроизводимый baseline и профиль.
2. Все P0/P1 подзадачи в `main`; P2 — либо в `main`, либо явно
   отложены с owner/причиной.
3. Профили A–F подтверждены на выделенном хосте (или зафиксированы
   отклонения с решением).
4. Нет регрессий: backend/UI/MCP/e2e зелёные; идемпотентность, undo,
   SSE-resume и права не сломаны.
5. 500 агентов/20 досок и 1 000/50 проходят SLO; 100/1 — без 429;
   3 000 SSE — <800 МБ.
6. Nightly perf job и PR-smoke работают; порог регрессии зафиксирован.
7. Документация EN/RU: capacity tiers, sizing, retention, лимиты,
   MCP-режимы; CHANGELOG.
8. Решение по 200.15 записано (по умолчанию — не делать).
9. Research-документ `docs/PERF-AGENT-SCALE.md` обновлён фактическими
   замерами и больше не содержит неразрешённых «estimate» в ключевых
   выводах.
10. `@janosik/mcp` 0.6.0 опубликован и проверен матрицей old/new server
    × old/new MCP.

---

## 9. Открытые вопросы (решить до/в 200.1)

1. Реальный cadence агента: действие раз в 10 с, 30 с или 5 минут?
2. Сколько агентов делят одну доску: 500/1 или 500/50?
3. Нужен ли агентам SSE/presence вообще, или это только человеческий
   oversight?
4. Агенты co-located с сервером? Если да — 200.8 обязателен.
5. Прод-хост: 2 vCPU/4 ГБ, 4/8 или 16/32? Postgres внешний?
6. Можно ли менять MCP-контракт (ready endpoint, per-entity CAS,
   targeted intents)? Это самые рычаговые изменения.
7. Какая staleness допустима для summary (100–500 мс)?
8. Какой retention нужен для агентских команд: 30 дней, 7 дней, архив?
9. 600/min board budget — продуктовое требование или дефолт? **Решено в
   200.3:** safety ceiling `max(12000, 2 × THROTTLE_LIMIT)` + взвешенные
   бюджеты токена/сессии.
10. Какой 409/retry budget считаем нормой?

---

## 10. Ссылки

- [`docs/PERF-AGENT-SCALE.md`](PERF-AGENT-SCALE.md) — полный research,
  evidence-таблица, мифы vs факты, 30/60/90.
- [`docs/PERF-BASELINE.md`](PERF-BASELINE.md) — raw HTTP, SSE, MCP.
- [`docs/PERF-ONE-BOARD.md`](PERF-ONE-BOARD.md) — сериализация команд.
- [`docs/PERF-CAPACITY.md`](PERF-CAPACITY.md) — размеры досок и память.
- [`docs/PERF-25K-INVESTIGATION.md`](PERF-25K-INVESTIGATION.md) — read
  model и aggregate cache.
- TASK-157 — agent-ready board (ready/wait, claim, CAS, DoD).
- TASK-160 — batch commands (2,3–2,5×).
- TASK-173/175 — post-1.0 read model и scale phase 2.
- TASK-185 — comment revisions (нагрузка на diff/историю).
