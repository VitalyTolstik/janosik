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
9. 600/min board budget — продуктовое требование или дефолт?
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
