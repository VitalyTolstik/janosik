# Performance baseline — Janosik

Снято 2026-10-29 на одной машине. Это **точка отсчёта**: после перф-фиксов
сверяемся с ней (см. «Матрицу перепроверки» внизу).

## Где лежат данные

| Что | Где |
| --- | --- |
| Полный отчёт нагрузочного прогона (все поверхности) | `~/.janosik-dev/load/LOAD-REPORT.md` (WSL, не в git) |
| Разбор памяти SSE до/после presence-фикса | `~/.janosik-dev/load/SSE-MEMORY-FINDINGS.md` |
| Аудит дыр (3 агента) | `~/.janosik-dev/load/AUDIT-FINDINGS.md` |
| Сырые k6-summary | `~/.janosik-dev/load/results/*.json` |
| Мониторы CPU/RSS/Postgres | `~/.janosik-dev/load/results/mon-*.csv` |
| Скрипты | `~/.janosik-dev/load/` (`k6/*.js`, `*.mjs`, `*.sh`) |
| Этот baseline | `docs/PERF-BASELINE.md` (в репозитории) |

## Стенд

- WSL2 Ubuntu-24.04, **16 vCPU, 23 GiB RAM**; одна машина.
- API `:3000` (NestJS, один процесс), Postgres 16 (Docker): **`max_connections=100`,
  `shared_buffers=16 MB`, `work_mem=4 MB`**; Redis 7 (Docker).
- Dev UI `:5173` (Vite), сайт `:4321` (Astro dev).
- Лимиты на время прогона подняты (`THROTTLE_LIMIT=1e6`, share-лимиты), затем
  `.env` восстановлен.
- **Важно:** генераторы нагрузки (k6, Node-SSE, Playwright) живут на том же хосте и
  делят CPU с приложением. Абсолютные числа консервативны; конкурентные выводы
  валидны. Для «настоящего» капасити нужен отдельный генератор + несколько нод.

## Заголовочные числа (одна нода, одиночная нагрузка)

| Поверхность | Метрика | Baseline |
| --- | --- | --- |
| `/health` (сырой HTTP) | RPS | ~5 600 |
| Агрегат доски (200 и 2400 карточек) | RPS | ~430–465 (не зависит от размера) |
| Реалистичный микс (чтение/запись/коммент) | RPS | ~250 |
| Команды на **1 доску** | RPS | **~48** (сериализация advisory-lock) |
| Команды по 100 доскам | RPS | ~290 (CPU) |
| Комментарии | RPS | ~257 |
| Admin API (чтение) | RPS | ~650 |
| Public share live / snapshot | RPS | ~95 / ~250 |
| Сайт (Astro dev) | RPS | ~460 |
| `/auth/me` | RPS | ~2 550 |
| `/auth/login` | — | 5/мин на IP (by design) |

Латентность агрегата растёт линейно с VUs (50→400 VUs: 62→461 ms) при постоянном
RPS — упор в CPU сборки агрегата (~4.3 ядра). Запись 1 доски: 100 писателей → ~1 s
латентности, RPS не растёт.

## UI (headless Chromium, 1600×900)

| Карточек | Полный рендер | DOM-узлов | JS heap | Long task (max) |
| ---: | ---: | ---: | ---: | ---: |
| 200 | 0.56 s | 5 778 | 261 MB | 0.37 s |
| 500 | 1.10 s | 16 744 | 353 MB | 0.91 s |
| 1 000 | 2.26 s | 28 286 | 489 MB | 1.77 s |
| **2 400 (max)** | **4.81 s** | **67 676** | **1 106 MB** | **3.90 s** |

## SSE / presence (до и после TASK-143)

| Соединений | До фикса | После фикса |
| ---: | ---: | ---: |
| 1 000 | 1 169 MB | 389 MB |
| 1 600 | 1 464 MB | 463 MB |
| 2 000 | не доходило | 525 MB |
| **3 000** | **OOM / падение** | **703 MB, жив** |

Steady-state 1000 коннектов + heartbeat 3 мин: 377→473 MB, после ~80 c плато.
Цена: ~0.17 MB/коннект при массовом connect, ~0.10 MB в steady-state.

## Как повторить

```bash
# 0) поднять лимиты и (опционально) Redis-режим; вернуть — revert-env.sh
bash ~/.janosik-dev/load/env-prep.sh dev      # или: redis

# 1) данные (идемпотентно): 2000 юзеров, доски 200/500/1000/2400, 100 досок
cd ~/.janosik-dev/load
USERS=2000 SHARED_CARDS_PER_COL=50 UI_TIERS=200,500,1000,2400 node provision.mjs
node mint-admin.mjs
node setpass.mjs

# 2) HTTP-нагрузка (k6 в ~/.local/bin)
bash series.sh read-aggregate.js 50 100 200 400
bash series.sh write-shared.js 10 25 50 100
bash series.sh mixed.js 100 200 400
bash series.sh admin-read.js 25 50 100
bash series.sh site.js 100 300 600
bash series.sh share.js 50 100 200
MODE=me bash runmon.sh auth.js 200

# 3) запись по 100 доскам
M=100 node add-boards.mjs && bash runmon.sh write-many.js 200

# 4) SSE/память (нужен временный /health/memory — см. ниже)
PER=0 STEPS=200,400,700,1000,1300,1600,2000,3000 node mem-ramp.mjs
C=2000 DUR=75 node steady.mjs

# 5) UI (Playwright, headless Chromium)
node ui-cards.mjs
N=10 node ui-agents-multi.mjs

# 6) вернуть окружение
bash ~/.janosik-dev/load/revert-env.sh
```

> `/health/memory` — временный диагностический маршрут, после измерений удалён.
> Чтобы снова мерить память: вернуть его в `backend/src/health/health.controller.ts`
> (за `MEMORY_DIAG=1`) и добавить `MEMORY_DIAG=1` в `backend/.env`, пересобрать
> `npm run build:backend`, перезапустить `janosik-api`. Скрипты `mem-ramp.mjs` и
> `steady.mjs` читают `/api/v1/health/memory`.
> `env-prep.sh` меняет `THROTTLE_LIMIT`/`REDIS_URL`, `revert-env.sh` возвращает
> исходный `.env` из `~/.janosik-dev/load/env.backup`.

## Матрица перепроверки после фиксов

| После задачи | Что мерить | Ожидание |
| --- | --- | --- |
| **TASK-139** виртуализация | `node ui-cards.mjs` | 2400 карточек <1 s, heap <300 MB, long task <200 ms |
| **TASK-143** presence (✅ сделано) | `mem-ramp` / `steady` | 3000 коннектов без OOM; ≤~0.2 MB/коннект |
| **TASK-144** coalescing | UI-сценарий «описание → сразу заголовок» | оба поля на сервере (сейчас теряется) |
| **TASK-140/146** лимиты SSE | `sse-agents`/`mem-ramp` выше лимита | вежливый отказ, процесс жив |
| **TASK-141** кэши | `share.js` (live vs snapshot), `admin-read.js` | live-share ближе к snapshot; admin RPS выше |
| **TASK-145** presence-консистентность | `steady` + 2 ноды | ростер сходится, нет ложных `leave` |
| **TASK-148** retention | время `maintenance` на большой таблице | без seq-scan, стабильное время |
| **TASK-150** UI-рендеры | `ui-cards` / Playwright re-render | меньше long tasks, стабильный heap |
| Бэкенд-потолки | `read-aggregate`, `write-shared`, `write-many` | не хуже baseline (регрессия = сигнал) |

## Напоминание

Числа — это **одна нода и общий хост с генераторами**. Сравнивать прогоны между
собой корректно только на этой же машине и в том же режиме (`dev`/`redis`).
