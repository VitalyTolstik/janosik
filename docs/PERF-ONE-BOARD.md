# One-board write breakdown — Janosik

Снято 2026-11-01 на dev-стенде. Цель — ответить на один вопрос: **что именно
ограничивает запись одной доски, когда её пишут десятки агентов одновременно?**
Это вход в решение TASK-160 (`board-command-batching`, см. `ROADMAP.md` §7.19).

## Стенд

- WSL2 Ubuntu-24.04, та же машина, что и `docs/PERF-BASELINE.md` (16 vCPU, 23 GiB).
- API `:3000` (NestJS, один процесс, systemd `janosik-api`), Postgres 16 (Docker,
  `max_connections=100`), Redis 7 (Docker, в этом прогоне **не** использовался —
  `REDIS_URL` пуст, режим self-host).
- Доска `shared`: **200 карточек**, 4 колонки, **2001 участник**.
- `THROTTLE_LIMIT=1000000` на время прогона (иначе длинная серия режется лимитом),
  `.env` восстановлен после.
- Нагрузчик — k6 на том же хосте (`write-shared.js`: каждый VU — отдельный
  пользователь, `UPDATE_CARD` случайной карточки одной доски). Абсолютные числа
  консервативны; сравнение «до/после» на одной машине валидно.

## Метод

Временная инструментация в командном пути (`BoardWriteService` + `CommandsService.apply`)
собирала длительности и писала агрегат раз в 200 команд:

| Проба | Что измеряет |
| --- | --- |
| `queueWait` | ожидание в in-process очереди `BoardWriteService` (до входа в транзакцию) |
| `lockAcquire` | время `SELECT pg_advisory_xact_lock(...)` внутри транзакции |
| `preChecks` | до `loadBoardAggregate`: board/command lookup + `assertIdsBelongToBoard` + `assertAssigneeIsBoardMember` + `assertClaimIsFree` |
| `aggLoad` | `loadBoardAggregate` — загрузка **всей** доски |
| `preWip` | `assertBoardManagement` + `currentSeq` + `assertVersionPreconditions` + `ifMatch` + `assertNoWipConflict` |
| `reducerDiff` | `boardReducer` + два `stableStringify` (before/after diff) |
| `cmdCreate` | `tx.command.create` |
| `writes` | `applyCommandWrites` + `collectVersions` |
| `cmdUpdate` | `tx.command.update` (payload/result/touches) |
| `txTotal` | вся транзакция целиком |

Инструментация снята после замера; в репозитории не остаётся (см. «Как повторить»).

## Результат 1 — пропускная плоская, латентность линейна

| Писателей (VU) | RPS | med | p95 | max | ошибок |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | **43.6** | 273 ms | 554 ms | 573 ms | 0 |
| 50 | **41.7** | 559 ms | 1221 ms | 1259 ms | 0 |
| 100 | **42.3** | 1119 ms | 2484 ms | 2548 ms | 0 |

Пропускная **не растёт** с числом писателей (≈42/s при 25, 50 и 100 VU), а
латентность растёт линейно. Это подпись строгой сериализации одной доски:
лишние писатели встают в очередь, а не увеличивают throughput. Ни `429`, ни
`503`, ни отказов — потолок упирается в скорость обработки, а не в таймауты.

## Результат 2 — разбор одной команды (100 писателей)

Средние по всем окнам; `txTotal` — вся транзакция, остальные — её части.

| Часть | avg | peak | доля от `txTotal` |
| --- | ---: | ---: | ---: |
| `lockAcquire` (advisory lock) | **0.7 ms** | 4.1 ms | **3 %** |
| `preChecks` | **7.0 ms** | 15.5 ms | 29 % |
| `aggLoad` (вся доска) | **8.0 ms** | 17.8 ms | 33 % |
| `preWip` | 2.0 ms | 9.5 ms | 8 % |
| `reducerDiff` | 0.5 ms | 1.5 ms | 2 % |
| `cmdCreate` | 1.0 ms | 5.3 ms | 4 % |
| `writes` | 2.9 ms | 5.6 ms | 12 % |
| `cmdUpdate` | 0.8 ms | 1.6 ms | 3 % |
| *остаток (commit/оверхед)* | ~1.5 ms | — | ~6 % |
| **`txTotal`** | **24.4 ms** | 45.8 ms | 100 % |
| `queueWait` (до транзакции) | 1213 ms | 2287 ms | — |

## Анализ

1. **Advisory lock — не узкое место (3 %).** In-process очередь сериализует
   писателей ещё до входа в транзакцию, поэтому DB-лок почти никогда не
   контендится (`lockAcquire` ≈ 0.7 ms). Снятие board-wide лока (вариант
   «per-entity optimistic») дало бы экономию порядка **0.7 ms из 24 ms** — то
   есть не дало бы почти ничего.
2. **Узкое место — работа *внутри* сериализованной транзакции.** 62 % — это
   `aggLoad` (33 %) + `preChecks` (29 %). `aggLoad` загружает **всю** доску
   (все карточки + метки + чек-листы + связи) на **каждую** команду и растёт с
   размером доски (на 200 карточках — 8 ms; на 2400 будет кратно больше).
3. **Throughput = 1 / `txTotal`.** 1 / 24 ms ≈ 42/s — ровно измеренные 42 rps.
   Чтобы поднять потолок, надо уменьшить *стоимость одной команды*, а не
   бороться с локом.
4. **`cmdCreate` + `cmdUpdate`** — две записи в `Command` на команду (insert,
   затем update payload/result/touches). ~1.8 ms; при батче — один путь на пачку.

## Вывод для решения

- **Батч команд — правильный рычаг.** Одна транзакция на N команд амортизирует
  ровно то, что доминирует: `aggLoad` (загрузить доску **один** раз), `preChecks`
  (проверки уровня пачки — один раз), `lockAcquire` и commit (один раз). Оценка:
  пачка из 5 команд даёт ≈ (8 + ~7 + 5×~4)/5 ≈ **~7 ms/команда** против 24 ms —
  порядок **×3** и выше, плюс меньше round-trip'ов у MCP.
- **Снятие board-wide лока (per-entity) — не решает** измеренную проблему: лок
  это 3 %, а не 50 %. Вариант остаётся на будущее, но не первым.
- **Async-очередь с backpressure** убирает `503` при всплесках (здесь их и не
  было — `txTotal` 24 ms ≪ 15 s таймаута), но потолок не поднимает.

## Оговорки

- Тест `write-shared.js` не шлёт `ifMatch` → **нет** `409` и ретраев. Агентский
  путь через MCP использует `ifMatch`/`expectedVersion`; при 100 агентах на одной
  доске конфликты версий и повторные чтения добавят амплификацию — отдельный
  замер (MCP-рой) остаётся за TASK-160.
- Числа — одна нода, генераторы делят CPU с API. Сравнивать корректно только на
  этой же машине/режиме.

## Как повторить

```bash
# 1) временная инструментация: пробы в BoardWriteService/CommandsService.apply
#    (см. таблицу «Метод»), сборка и рестарт:
npm run build -w backend && sudo systemctl restart janosik-api

# 2) свежие токены 100 участникам доски (JWT из backend/.env JWT_SECRET)
#    и поднятый лимит:
bash ~/.janosik-dev/load/env-prep.sh dev

# 3) нагрузка в одну доску:
BOARD=<shared-board-id> bash ~/.janosik-dev/load/run.sh write-shared.js 100

# 4) тайминги из лога:
journalctl -u janosik-api --since "<start>" | grep WRITE-TIMING
```

Скрипты-обвязки замера (свежие токены, парсинг, свёртка) — вне репозитория,
`~/.janosik-dev/load/`.
