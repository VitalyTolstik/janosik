# Janosik — Ревью 2026-10: находки как задачи

> **Источник.** Полное ревью всего приложения (8 параллельных read-only агентов по
> `backend/`, `ui/`, `shared/` + ручная перепроверка каждого Critical/High).
> **База:** `main` @ `ac423b3` (после TASK-66…74).
> **Формат:** как §7.7 роадмапа — одна задача = одна ветка `feature/TASK-{N}-{slug}` =
> один PR (§0.1 ROADMAP). Номера продолжают с `TASK-75` (последняя занятая — `TASK-74`).
> **Статус задач:** ⬜ открыто · 🔷 в работе · ✅ закрыто. После закрытия переносить
> описание в `ROADMAP-DONE.md` и добавлять строку в таблицу §6.0/§7.7.

Пометки достоверности находок:
**[✓]** — подтверждено чтением кода при ревью · **[A]** — сообщено агентом, вживую не перепроверялось.

Приоритеты: **P0** — безопасность / потеря данных · **P1** — корректность и эксплуатация ·
**P2** — архитектура, контракты, производительность, чистка.

Общие гейты для каждой задачи (DoD проекта): `npm run format` + `format:check`,
`npm run lint` (0 errors), backend `tsc -p tsconfig.build.json --noEmit`,
`npx jest --selectProjects unit` + `npm run test:e2e`, ui `npx tsc -b` + `npx vitest run`,
`npm run build -w ui` + `npm run size -w ui`. Для UI-задач — браузерный смоук Playwright.

---

## Сводка

| TASK | Prio | Название | Область | Ключевые файлы |
| --- | --- | --- | --- | --- |
| 75 | P0 | SW не кэширует API и SSE | ui/pwa | `ui/src/pwa/sw.js` |
| 76 | P0 | MIME: sniff + `attachment` на публичной шаре | backend | `attachments/storage.service.ts`, `share/share.controller.ts`, `attachments/attachments.service.ts` |
| 77 | P0 | Orphan-blob sweep: grace-окно | backend | `ops/maintenance.service.ts` |
| 78 | P0 | `pipeline` вместо `pipe` во всех стрим-роутах | backend | `attachments/*`, `users/*`, `admin/*`, `share/*` |
| 79 | P0 | OWNER-гейты на глобальные ops + `assertOwner` на user-actions | backend | `admin/admin.controller.ts`, `admin/admin.service.ts`, `ops/*` |
| 80 | P0 | `inverse` не доверять клиенту | backend | `commands/commands.service.ts` |
| 81 | P0 | Кросс-бордовое удаление inline-вложения | backend | `comments/comments.service.ts` |
| 82 | P1 | Демо-раннер: жизненный цикл в Redis-режиме | backend | `admin/demo.service.ts` |
| 83 | P1 | Comms: таймер, дедуп напоминаний, cadence parity | backend | `ops/comms-scheduler.service.ts` |
| 84 | P1 | Retention `Command` + `take` в `listSince` | backend | `commands/commands.service.ts`, `ops/maintenance.service.ts` |
| 85 | P1 | Имперсонация не апгрейдится до мастера | ui | `api/client.ts`, `auth/AuthContext.tsx` |
| 86 | P1 | `keepalive` только ниже порога | ui | `api/client.ts` |
| 87 | P1 | Живые ретраи транскода | backend | `attachments/transcode.service.ts` |
| 88 | P1 | Вложение: не удалять блоб при soft-delete | backend | `attachments/attachments.service.ts` |
| 89 | P1 | `AdminCreateMasterDto`: `role` вместо `owner` | backend/shared | `admin/dto/admin-create-master.dto.ts` |
| 90 | P1 | Отдельная audience для queue-тикета | backend | `admin/admin.controller.ts`, `admin/admin.types.ts` |
| 91 | P1 | `trust proxy` | backend | `common/app-setup.ts` |
| 92 | P1 | Недостающие индексы БД | backend | `prisma/schema.prisma` + миграция |
| 93 | P1 | Подтверждения деструктивных действий в панели | ui/admin | `entity-configs.tsx`, `EntityPage.tsx`, `BoardDetailPage.tsx`, `UserDetailPage.tsx` |
| 94 | P1 | Мелкие дефекты панели (Retry, hardcoded, даты) | ui/admin | `ObservabilityPage.tsx`, `MastersPage.tsx`, `dialogs.tsx`, `GlobalSearch.tsx`, `SecurityPage.tsx` |
| 95 | P1 | Backend typecheck спека в CI | backend/CI | `backend/package.json`, `.github/workflows` |
| 96 | P2 | Реестр команд + `never`-эксхоустивность | shared/backend | `board-reducer.ts`, `validate.ts`, `command-writers.ts`, `commands.service.ts`, `command-details.ts`, `referenced-entity-ids.ts` |
| 97 | P2 | Харденинг редьюсера (labelIds, restore, inverse, omit) | shared | `store/board-reducer.ts`, `store/validate.ts` |
| 98 | P2 | `createId` → `crypto.randomUUID()` | ui | `utils/id.ts` |
| 99 | P2 | Идемпотентность комментариев | backend | `comments/comments.service.ts` |
| 100 | P2 | TOCTOU: last-ADMIN, invite, count вложений | backend | `boards/boards.service.ts`, `attachments/attachments.service.ts` |
| 101 | P2 | N+1 в `listBoards` | backend | `boards/boards.service.ts` |
| 102 | P2 | Realtime/presence: утечка каналов, ownership, reconnect | backend | `realtime/*`, `commands/events.controller.ts`, `commands/presence.controller.ts` |
| 103 | P2 | Фатальный SSE 401 → auth-lost | ui | `store/realtime.ts`, `store/BoardContext.tsx` |
| 104 | P2 | Живая шара: 404/410, истёкшие VIEWER, snapshot `deletedAt` | backend/ui | `share/share.service.ts`, `ui/src/share/*` |
| 105 | P2 | Offline-outbox (или честный README) | ui | `store/server-sync.ts`, `README.md` |
| 106 | P2 | Утечки object-URL (avatar/attachment/embed) | ui | `hooks/use-avatar-object-url.ts`, `components/board/CardAttachments.tsx`, `utils/embedAttachments.ts` |
| 107 | P2 | Медиа-файлы: `.tmp`, производные, range | backend | `attachments/media.service.ts`, `admin/admin.service.ts`, `attachments/attachments.controller.ts` |
| 108 | P2 | Inline-вложения: cap и `attachmentCount` | backend | `attachments/attachments.service.ts` |
| 109 | P2 | Экспорт: TTL при скачивании + аудит | backend | `admin/exports.service.ts`, `admin/admin.controller.ts` |
| 110 | P2 | Рассылка: фан-аут и реальные ретраи | backend | `ops/broadcast-queue.service.ts`, `ops/broadcast.processor.ts`, `admin/comms.service.ts` |
| 111 | P2 | Экспорт: порог синхронного пути / легаси-роут | backend | `admin/exports.service.ts`, `admin/admin.service.ts` |
| 112 | P2 | Контрактный drift (ошибки/DTO/лимиты) | shared/backend | `shared/src/api.ts`, `shared/src/admin.ts`, `admin/dto/*` |
| 113 | P2 | Редактирование объявлений в панели | ui/admin | `CommsPage.tsx`, `entity-configs.tsx` |
| 114 | P2 | Чистка мёртвого кода и i18n | ui/admin | `admin-i18n.ts`, `admin-client.ts`, `exports.service.ts`, `linkify.ts` |
| 115 | P2 | Дизайн-токены: приоритеты и lightbox | ui | `utils/priority.ts`, `utils/embedAttachments.ts` |
| 116 | P2 | A11y: VIEWER-карточки и заголовок колонки | ui | `components/board/SortableCard.tsx`, `ColumnView.tsx` |
| 117 | P2 | Мемоизация `TableView` | ui | `components/board/TableView.tsx` |
| 118 | P2 | Расслоение god-модулей | ui | `store/BoardContext.tsx`, `CalendarView.tsx`, `TableView.tsx`, `CardContextMenu.tsx` |
| 119 | P2 | `/health` с проверкой Redis/очередей | backend | `health/health.service.ts` |
| 120 | P2 | Env-харденинг (`UPLOAD_DIR`, avatar MIME) | backend | `config/env.ts`, `attachments/storage.service.ts`, `users/users.controller.ts` |
| 121 | P2 | i18n-паритет (en/ru) | ui | `locales/{en,ru}/translation.json` |

---

# P0 — безопасность и потеря данных

### TASK-75 `sw-api-cache` — service worker не кэширует API и SSE [✓] ✅
**Приоритет:** P0. **Область:** ui/pwa.
**Проблема.** Обработчик `fetch` перехватывает **любой** same-origin GET и делает
`cache-first` без учёта `Authorization`, `Cache-Control`, `Vary` (`ui/src/pwa/sw.js:111-125`).
API на том же origin → `GET /api/v1/boards`, `/boards/:id`, `/comments`, `/activity`
кладутся в кэш и отдаются cache-first: доска «замерзает» на старых данных до ротации
`CACHE_VERSION`; кэш одного аккаунта может быть отдан другому в том же профиле;
SSE-ответ (`Accept: text/event-stream`) уходит в `cache.put(response.clone())` и
буферизует бесконечный поток.
**Что сделать.** До `event.respondWith` рано выходить, если: путь начинается с `/api/`,
есть заголовок `Authorization`, либо `Accept` содержит `text/event-stream`. Кэшировать
только app-shell и `/assets/*` (как и заявлено в комментарии).
**DoD.** SW-тесты (`ui/src/pwa/*`) покрывают: `/api/...` не попадает в кэш, SSE не
буферизуется, ассеты по-прежнему cache-first. Живой смоук: доска не показывает stale
после правки на сервере; в Network нет кэш-хитов на `/api`.
**Зависимости:** нет.

### TASK-76 `attachment-mime` — sniff MIME + `attachment` на публичной шаре [✓] ✅
**Приоритет:** P0. **Область:** backend (attachments, share, users).
**Проблема.** Аллоу-лист `text\/[\w.+-]+` пропускает `text/html`/`text/javascript`
(комментарий врёт про исключение) — `storage.service.ts:16-17`. MIME берётся из
multipart-заголовка клиента, сохраняется и отдаётся обратно; публичная шара отдаёт его
`inline` (`share.controller.ts:190-194`) → stored XSS на origin API (helmet `script-src
'self'` не спасает: рядом грузится блоб как `text/javascript`). Тот же тип уходит в
member-роуте и фолбэком миниатюры.
**Что сделать.** Определять тип по magic bytes (напр. `file-type`), хранить
серверный тип; убрать `text/*` (или сузить до `text/plain`) и `application/octet-stream`
из аллоу-листа; на публичном контуре — жёсткий аллоу-лист рендерных типов +
`Content-Disposition: attachment`; на фолбэке миниатюры — тоже `attachment` + `nosniff`.
**DoD.** e2e: загрузка `evil.html` не проходит/отдаётся как octet-stream; публичный
роут не рендерит HTML; avatar MIME берётся из серверного типа. Тест на magic-byte mismatch
(заявлен `image/png`, содержимое не PNG).
**Зависимости:** согласовать с TASK-120 (avatar MIME).

### TASK-77 `orphan-blob-grace` — grace-окно в orphan-sweep [✓] ✅
**Приоритет:** P0. **Область:** backend (ops).
**Проблема.** `sweepOrphanBlobs` (`ops/maintenance.service.ts:223-256`) строит `referenced`
из снапшота БД и удаляет всё остальное, но блобы пишутся **до** появления строки:
upload (`attachments.service.ts:92`), media/transcode `rename` (`media.service.ts:179,186`,
`transcode.service.ts:185`), export (`exports.service.ts:134`). Sweep в этом окне удаляет
живой файл → потеря данных (а `transcode.service.ts` затем удаляет и оригинал).
**Что сделать.** Удалять только блобы старше grace-окна (по `mtime`, напр. 1 ч), либо
перевести все записи на `.tmp-` + rename **после** коммита БД. Учесть, что `listBlobs`
уже игнорирует `.tmp-`.
**DoD.** Юнит-тест sweep: свежий (mtime < окна) блоб не удаляется; тест-регресс на
in-flight запись. Живой смоук: загрузка во время sweep не теряется.
**Зависимости:** TASK-107 (`.tmp`-дисциплина) усиливает фикс.

### TASK-78 `stream-pipeline` — `pipeline` вместо `pipe` во всех стрим-роутах [✓] ✅
**Приоритет:** P0. **Область:** backend.
**Проблема.** `storage.open()` = `existsSync` + `createReadStream`
(`storage.service.ts:107-110`); все вызовы `.pipe(res)` без `'error'`-листенера:
`attachments.controller.ts:90,110,117,130`, `users.controller.ts:81`,
`admin.controller.ts:161,625`, `share.controller.ts:195`. TOCTOU: файл может быть удалён
sweep'ом/`remove()` между проверкой и чтением → стрим эмитит `'error'` без обработчика →
**uncaught exception, падение процесса** (remote DoS).
**Что сделать.** Заменить на `await pipeline(this.storage.open(p), res)` из
`node:stream/promises` во всех точках; `NotFoundException` из `open` обрабатывать до стрима.
**DoD.** Тест: удаление файла во время скачивания не роняет процесс (ответ корректно
обрывается). Grep: ни одного `open(...).pipe(res)` не осталось.
**Зависимости:** нет.

### TASK-79 `admin-owner-guards` — OWNER на глобальные ops + `assertOwner` на user-actions [✓] ✅
**Приоритет:** P0. **Область:** backend (admin, ops).
**Проблема.** Без проверки роли и без `assertOwner` доступны оператору:
`updateFlag` (`admin.controller.ts:700`), `updateOps` (:718),
`create/update/deleteAnnouncement` (:747-787), `sendEmail` (:798),
`updateEmailTemplate`/`resetEmailTemplate` (:816-847), `runMaintenance` (:905).
Проверка `admin.role !== "OWNER"` есть только у `queueTicket` (:879). Оператор может
включить maintenance mode, выключить `registration_open`/`public_shares`, разослать письмо
всем, **переписать глобальный шаблон кода подтверждения** и запустить деструктивный
purge. Дополнительно: `promoteUser` (`admin.service.ts:1864`), `impersonateUser` (:1934),
`resetUserPassword` (:1793), `exportUser` (:2241) — без `assertOwner`.
**Что сделать.** Ввести OWNER-гейт (декоратор/`assertOwner`) на ops/flags/comms/
maintenance; `assertOwner` на четыре user-action метода; пересмотреть, что именно
разрешено OPERATOR (задокументировать в ROADMAP §7.10).
**DoD.** e2e: OPERATOR получает 403 на каждом из перечисленных роутов; OWNER — 200.
UI скрывает/дисейблит эти действия у оператора.
**Зависимости:** нет.

### TASK-80 `inverse-server-side` — не доверять клиентскому `inverse` [✓] ✅
**Приоритет:** P0. **Область:** backend (commands).
**Проблема.** `commands.service.ts:517` (`assertNoWipConflict`) и `:417` пропускают гварды,
если `action.inverse === true`; `inverse` приходит от клиента, `validate.ts` проверяет лишь
булевость. С `inverse:true` проходят `MOVE_CARD`/`UNARCHIVE_CARD`/`RESTORE_*`/
`SET_CARD_LABEL`/`ADD_CARD_LINK`, двигая колонки сверх WIP, карточки сверх
`labelsPerCard`/`linksPerCard`, назначая не-участника в `assigneeId`.
**Что сделать.** Выводить «это инверсия» серверно (или разрешать снятие гвардов только
для `RESTORE_*`); не принимать клиентский `inverse` как основание обойти WIP/лимиты.
**DoD.** e2e: команда с `inverse:true` и выходом за WIP/лимит → 409; легитимный undo
работает. Регресс на `ADD_CARD_LINK` с чужим id.
**Зависимости:** согласовать с TASK-96/97 (доктрина inverse).

### TASK-81 `inline-attachment-scope` — скоуп по доске при удалении inline-вложений [✓] ✅
**Приоритет:** P0. **Область:** backend (comments).
**Проблема.** `unlinkInlineAttachments` (`comments.service.ts:199-209`) парсит id из текста
комментария и делает `tx.attachment.updateMany({ where: { id: { in: ids }, isInline: true,
deletedAt: null } })` **без `boardId`**. Участник доски A вставляет в комментарий
`/api/v1/attachments/<чужой id>/content` и, удалив комментарий, soft-delete'ит inline-вложение
доски B (id утекают через публичные шары с текстом карточек).
**Что сделать.** Скоупить `where` по `boardId` (или проверять принадлежность карточки
доске комментария).
**DoD.** e2e: чужой attachment id в комментарии не удаляется; свой — удаляется.
**Зависимости:** нет.

---

# P1 — корректность и эксплуатация

### TASK-82 `demo-queue-lifecycle` — демо-раннер в Redis-режиме не освобождается [✓]
**Приоритет:** P1. **Область:** backend (admin/demo).
**Проблема.** `demo.service.ts:365-371` выставляет `this.active = run` всегда; при постановке
в очередь (`if (!queued) this.launch(...)`) `active`/`done` никто не чистит и не обновляет.
`status()` (:113-129) предпочитает `this.active` → после завершения queued-джобы
`running:true, cardsDone:0`, а следующий `start` вечно кидает
`ConflictException("A demo is already running")`.
**Что сделать.** В queued-ветке не выставлять `active` (или чистить по завершении),
`start` гейтить по статусу строки `DemoRun`, а не по in-memory флагу; синхронизировать
`progress` из БД.
**DoD.** e2e (Redis-режим): start → статус running с прогрессом → завершение → start снова
работает. Fallback-режим не деградирует.
**Зависимости:** нет.

### TASK-83 `comms-schedule` — таймер, дедуп напоминаний, cadence parity [✓]
**Приоритет:** P1. **Область:** backend (ops/comms).
**Проблема.** `comms-scheduler.service.ts`: fallback `setInterval(..., digest*3_600_000)`
(:79) — при `digestIntervalHours` до 720 значение `2.59e9 > 2^31-1`, Node клампит к 1 мс →
непрерывный поток дайджестов. Напоминания: fallback-интервал фиксирован 1 ч (:86-89), окно
= `lead` → при `lead=48` ~48 одинаковых писем одному человеку. BullMQ-путь
(`every: lead*3.6e6`) расходится с fallback.
**Что сделать.** Клэмпить интервалы (`hours*3.6e6 <= 2^31-1`) или рекурсивный `setTimeout`;
интервал напоминаний = `lead`; персистентная метка «уже напомнили» (dedupe по cardId).
Выровнять cadence BullMQ и fallback.
**DoD.** Юнит-тесты: большие интервалы не клампятся; одна карточка → одно письмо за окно;
счётчики совпадают для обоих бэкендов. e2e: due-карточка → ровно одно письмо в outbox.
**Зависимости:** нет.

### TASK-84 `command-retention` — `take` в `listSince` + retention `Command` [✓]
**Приоритет:** P1. **Область:** backend (commands, maintenance).
**Проблема.** `commands.service.ts:290-297` — `findMany` без `take`; при `since=0` отдаёт
**всю** историю доски в память/SSE (достижимо из публичной шары `share.controller.ts:77`).
Sweep'а `Command` в `MAINTENANCE_JOBS` нет — лог растёт неограниченно.
**Что сделать.** `take` + пагинация дельты; сигнал «перезагрузи агрегат» при сильном
отставании; retention-джоба на `Command` (окно из `OpsSettings`).
**DoD.** Тест: `since=0` не тянет всё; sweep удаляет старые команды, `seq`-догон не ломается.
**Зависимости:** TASK-92 (индекс под sweep).

### TASK-85 `impersonation-refresh` — имперсонация не апгрейдится до мастера [✓]
**Приоритет:** P1. **Область:** ui (api, auth).
**Проблема.** `client.ts:390-409` `runRefresh` постит `/auth/refresh` с `auth:false` → уходит
httpOnly-cookie **мастера**. При истечении имперсонационного токена `AuthContext.tsx:93-118`
любой authed-запрос → 401 → `refreshSession()` → в «просмотровой» вкладке появляется
**токен мастера**; баннер «view as» остаётся, а записи становятся мастер-записями.
**Что сделать.** Во время имперсонации не звать `refreshSession`; на 401 — сбросить
имперсонацию и показать мастер-путь (или явную ошибку).
**DoD.** Тест: истечение имперсонационного токена не приводит к мастер-запросу; баннер
сбрасывается. Регресс: обычный refresh не тронут.
**Зависимости:** нет.

### TASK-86 `command-keepalive` — `keepalive` только ниже порога [✓]
**Приоритет:** P1. **Область:** ui (api).
**Проблема.** `client.ts:500-510` ставит `keepalive: true` на каждый `sendCommand`;
`MAX_COMMAND_BYTES = 2 MB`, а лимит `keepalive`-тела браузера ~64 KB. Крупная инверсная
команда (`RESTORE_COLUMN_CARDS` — до 200 карточек) отвергается синхронным `TypeError`,
который ловится как `ApiError(0)` (:765-776) → классифицируется «offline» → откат + неверный
тост, хотя сети не касалось.
**Что сделать.** Включать `keepalive` только ниже порога (напр. 32 KB); синхронный
`TypeError` классифицировать отдельно от transport-failure.
**DoD.** Тест: большая команда уходит без `keepalive` и не даёт ложный «offline».
**Зависимости:** нет.

### TASK-87 `transcode-retry` — живые ретраи транскода [✓] ✅
**Приоритет:** P1. **Область:** backend (attachments).
**Проблема.** `transcode.service.ts:171,207-215`: при ошибке `process()` пишет
`transcodeStatus:"failed"` и бросает; BullMQ-ретрай входит снова и натыкается на
`if (!row || row.transcodeStatus !== "pending") return;` → no-op. `attempts:3` не работает,
временный сбой ffmpeg/CPU навсегда оставляет видео на оригинале.
**Что сделать.** Не персистить `failed`, пока есть попытки (`job.attemptsMade < opts.attempts`),
либо повторно обрабатывать `failed` с остатком попыток.
**DoD.** e2e: транзиентный сбой → успешный ретрай; permanent → `failed` после попыток.
**Зависимости:** нет.

### TASK-88 `attachment-softdelete-restore` — не удалять блоб при soft-delete [✓] ✅
**Приоритет:** P1. **Область:** backend (attachments).
**Проблема.** `attachments.service.ts:245-249` при soft-delete **сразу** удаляет блоб и
производные, но admin-restore поддерживает `entity:"attachments"` (`admin.service.ts:2204`).
Восстановленное вложение указывает на отсутствующий файл → 404. Комментарий про
«physical blob stays» для вложений неверен.
**Что сделать.** Не удалять блоб при soft-delete; физическое удаление — только в
`purgeSoftDeleted` (он уже чистит `storedName`/`thumbnailName`/`posterName`).
**DoD.** e2e: delete → restore → контент отдаётся; purge удаляет файл.
**Зависимости:** TASK-77.

### TASK-89 `admin-master-role` — панель не создаёт OWNER-мастера [✓] ✅
**Приоритет:** P1. **Область:** backend/shared (admin).
**Проблема.** `shared/src/admin.ts:53-58` шлёт `role`, а `admin-create-master.dto.ts:24-26`
объявляет `owner?: boolean` и нет `role`. При `whitelist:true` `role` вырезается →
`admin.service.ts:529` всегда `dto.role ?? "OPERATOR"`. Кнопка «owner» мертва.
**Что сделать.** Заменить `owner?: boolean` на `@IsOptional() @IsIn(["OWNER","OPERATOR"])
role?`; обновить `MastersPage`/shared при необходимости.
**DoD.** e2e/UI: OWNER создаётся и логинится как OWNER; OPERATOR по умолчанию.
**Зависимости:** нет.

### TASK-90 `queue-ticket-audience` — отдельная audience для queue-тикета [✓] ✅
**Приоритет:** P1. **Область:** backend (admin).
**Проблема.** `admin.controller.ts:884-891` подписывает `{sub, typ: ADMIN_TOKEN_TYPE}` с
`audience: ADMIN_JWT_AUDIENCE` и общим `JWT_SECRET` — ровно форма, которую
`AdminJwtStrategy` принимает на любом `/admin/*`. Тикет, задуманный только для Bull Board,
эквивалентен admin-access-токену.
**Что сделать.** Отдельная `audience` (напр. `janosik-admin-queues`) и/или claim; валидировать
её только в guard дашборда.
**DoD.** Тест: тикет из cookie не проходит на обычные `/admin/*` роуты.
**Зависимости:** нет.

### TASK-91 `trust-proxy` — `app.set("trust proxy")` [✓]
**Приоритет:** P1. **Область:** backend (common).
**Проблема.** `app-setup.ts:12-24` — нет `trust proxy`; `req.ip` за nginx = IP прокси:
глобальный rate limit схлопывается на всех, admin IP-allowlist не матчит реальный адрес,
аудит сессий пишет IP прокси.
**Что сделать.** `app.set("trust proxy", N)` (точное число хопов из env `TRUST_PROXY`,
по умолчанию выключено) + throttler `getTracker` по резолвленному клиентскому IP.
**DoD.** Тест: с `X-Forwarded-For` лимит/allowlist/аудит видят реальный IP; без него —
`req.ip`.
**Зависимости:** TASK-120 (env `TRUST_PROXY`).

### TASK-92 `db-indexes` — недостающие индексы [A]
**Приоритет:** P1. **Область:** backend (prisma).
**Проблема.** Нет индексов под новые sweep/очереди: `DataExport.expiresAt` (sweep фильтрует),
`Card.dueDate` (напоминания), `Attachment.derivativeStatus`/`transcodeStatus`
(boot-recovery + observability), `Attachment.deletedAt` (purge), `DemoRun(status,startedAt)`.
`Command.touches` — B-tree (`schema.prisma:272`), а лента использует `has`
(`activity.service.ts:66`) → нужен GIN.
**Что сделать.** Добавить индексы (в т.ч. GIN `[touches]` / `[boardId, touches]`), миграция.
**DoD.** Миграция применяется; EXPLAIN показывает index scan на целевых запросах.
**Зависимости:** нет.

### TASK-93 `admin-destructive-confirm` — подтверждения в панели [✓]
**Приоритет:** P1. **Область:** ui/admin.
**Проблема.** (1) `confirmTitle` зовётся без параметров (`entity-configs.tsx:141,152,175,184`)
→ показывается литерал `{email}`. (2) Ряд деструктивных действий без подтверждения:
bulk delete (`EntityPage.tsx:318`), удаление доски (`BoardDetailPage.tsx:217-226`),
передача владельца/удаление участника, block/revoke сессий/токенов (`UserDetailPage.tsx`),
удаление объявления; ключи `admin.bulk.confirm.*` есть, но не используются.
**Что сделать.** Передать `{email}` в тайтлы; добавить `confirmTitle`/`confirmBody` всем
`destructive`-действиям и `runBulk` (переиспользовать существующие i18n-ключи).
**DoD.** Тесты UI: тайтлы с email; bulk/board/delete требуют подтверждения.
**Зависимости:** нет.

### TASK-94 `admin-ui-fixes` — мелкие дефекты панели [A]
**Приоритет:** P1. **Область:** ui/admin.
**Проблема.** `ObservabilityPage.tsx:27-46` — «Retry» выставляет `loading` и не
перезапрашивает (вечный loader). Захардкоженный английский: `MastersPage.tsx:185`,
`dialogs.tsx:95`, заголовки таблицы masters, бейджи `GlobalSearch.tsx:51-119`.
`toLocaleString()` вместо `formatDate` в Security/Shares/Observability.
**Что сделать.** Вынести `load()` и звать в `onRetry`; добавить i18n-ключи; перейти на
`formatDate`/`useHour12`.
**DoD.** UI-тест: Retry перезапрашивает. Grep: нет захардкоженных строк и `toLocaleString`
в этих файлах.
**Зависимости:** нет.

### TASK-95 `backend-ci-typecheck` — typecheck спека в CI [A]
**Приоритет:** P1. **Область:** backend/CI.
**Проблема.** CI гоняет `npm run build:backend` = `tsc -p tsconfig.build.json`, а он
исключает `**/*.spec.ts` и `test/` — типы в тестах не проверяются (прошлый аудит §3.1).
**Что сделать.** Добавить `"typecheck": "tsc -p tsconfig.json --noEmit"` в backend и шаг в CI.
**DoD.** CI падает на типовой ошибке в спеке; локально команда зелёная.
**Зависимости:** нет.

---

# P2 — архитектура, контракты, производительность, чистка

### TASK-96 `command-registry` — реестр команд и `never`-эксхоустивность [✓]
**Приоритет:** P2. **Область:** shared/backend.
**Проблема.** `never`-guard есть только в `invert.ts:599`. Молчаливые `default` в
`board-reducer.ts:2280`, `validate.ts:691`, `command-writers.ts:1034`,
`commands.service.ts:645`, `command-details.ts:296` + ручные списки `SUPPORTED_ACTIONS`,
`DIRECT_KEYS`/`ARRAY_KEYS`. Новая команда = ~7-9 ручных правок, компилятором проверяется одна;
промах в writer'е — тихая рассинхронизация, в `DIRECT_KEYS` — примитив кросс-бордовой записи.
**Что сделать.** `const _x: never = action` в каждом switch; `satisfies`-мапы для
`SUPPORTED_ACTIONS`/`DIRECT_KEYS`/`textEntityKey`; по возможности единый реестр
`Record<BoardAction["type"], …>`.
**DoD.** Промах ловится компиляцией; тест-«полнота» по реестру. Гейты зелёные.
**Зависимости:** TASK-80, TASK-97.

### TASK-97 `shared-reducer-hardening` — дефекты редьюсера [✓/A]
**Приоритет:** P2. **Область:** shared.
**Проблема.** (1) `ADD_CARD` кладёт произвольные `labelIds` (`board-reducer.ts:804`), сервер
создаёт `CardLabel` только для существующих (`command-writers.ts:180-188`) → reducer ≠ агрегат.
(2) `RESTORE_*`-снапшоты не валидируют `priority`/`assigneeId`/`activity` (`validate.ts:183-223`).
(3) `SET_COLUMN_CARD_ORDER` игнорирует `inverse` (`board-reducer.ts:1850-1870`) — undo молча
отказывает. (4) `updateCard` может оставить `description: undefined` (:845-861).
**Что сделать.** Фильтровать `labelIds` по `board.labels`; валидировать снапшот; пропускать
permutation-гвард при `inverse`; удалять `description`, если не задано.
**DoD.** Юнит-тесты на каждый пункт; property-тест invert без регресса.
**Зависимости:** TASK-96.

### TASK-98 `createid-crypto` — `createId` → `crypto.randomUUID()` [✓]
**Приоритет:** P2. **Область:** ui.
**Проблема.** `ui/src/utils/id.ts:7` — `Math.random()`; после TASK-29 это PK на сервере.
**Что сделать.** `crypto.randomUUID()` с фолбэком на `getRandomValues`; старые данные не ломаются.
**DoD.** Тест уникальности/формата; импорт старых данных работает.
**Зависимости:** нет.

### TASK-99 `comment-idempotency` — идемпотентность комментариев [A]
**Приоритет:** P2. **Область:** backend (comments).
**Проблема.** `comments.service.ts:44-101` — нет `commandId`/idempotency key: ретрай
`POST /cards/:id/comments` создаёт дубли комментария и `Activity`.
**Что сделать.** Принимать клиентский idempotency key, дедуп на сервере.
**DoD.** e2e: двойной POST с одним ключом → один комментарий.
**Зависимости:** нет.

### TASK-100 `board-write-toctou` — TOCTOU-гонки [A]
**Приоритет:** P2. **Область:** backend.
**Проблема.** last-ADMIN проверка вне транзакции (`boards.service.ts:314,383`); invite-проверка
вне транзакции → возможен `P2002` 500; `count()` вложений вне транзакции
(`attachments.service.ts:79-92`).
**Что сделать.** Перенести проверки внутрь `boardWrite.run`/транзакции; обрабатывать `P2002`.
**DoD.** e2e на конкурентные demote/invite/upload без нарушения инвариантов.
**Зависимости:** нет.

### TASK-101 `list-boards-counts` — N+1 в `listBoards` [A]
**Приоритет:** P2. **Область:** backend (boards).
**Проблема.** `boards.service.ts:60-63` — `card.count()` на каждую доску.
**Что сделать.** Один `groupBy`/`_count` в исходном запросе.
**DoD.** Тест: число запросов не растёт с числом досок.
**Зависимости:** нет.

### TASK-102 `realtime-presence-hardening` — утечки и ownership [✓/A]
**Приоритет:** P2. **Область:** backend (realtime, commands).
**Проблема.** `RealtimeService.channels`/`subscribed` (`realtime.service.ts:126-133`) не
удаляются, Redis-подписки не отписываются. `clientId` не привязан к юзеру
(`presence.controller.ts:28-29`, `events.controller.ts:57-58`) — подмена/выбивание чужой
сессии; reconnect-гонка удаляет свежую сессию (teardown старого стрима после нового join).
**Что сделать.** Ref-count подписчиков на доску + unsubscribe/удаление Subject; хранить
`userId` в сессии и отклонять mismatch; не удалять сессию, если она не «текущая».
**DoD.** Юнит-тесты: канал освобождается; чужой `clientId` отклонён; reconnect не теряет presence.
**Зависимости:** нет.

### TASK-103 `sse-auth-lost` — фатальный SSE 401 → auth-lost [✓]
**Приоритет:** P2. **Область:** ui (store).
**Проблема.** `realtime.ts:143-149,232-251`: `onFatal` обрабатывает только 403,
`refreshSession` не зовёт `onAuthLost` → мёртвая сессия, доска молчит бесконечно.
**Что сделать.** На фатальный 401 звать `api.onAuthLost?.()`.
**DoD.** Тест: 401 в SSE переводит приложение в anonymous/login.
**Зависимости:** нет.

### TASK-104 `share-live-frozen` — шара: 404/410, VIEWER, snapshot [A]
**Приоритет:** P2. **Область:** backend/ui (share).
**Проблема.** Живая шара замирает при отзыве/удалении (нет `onFatal` в `PublicBoardPage`).
Публичный ростер включает истёкших VIEWER (`share.service.ts:366-381` игнорирует `expiresAt`).
Snapshot-шара отдаёт живые комментарии/вложения удалённой доски (`:393-399` без `deletedAt`).
**Что сделать.** `onFatal` → состояние `ShareUnavailable`; фильтр `expiresAt` в ростере;
`deletedAt: null` в snapshot-режиме.
**DoD.** Тесты/e2e: отозванная ссылка → «недоступна»; истёкший VIEWER не в списке;
snapshot не отдаёт контент удалённой доски.
**Зависимости:** нет.

### TASK-105 `offline-outbox` — offline-outbox или честный README [✓]
**Приоритет:** P2. **Область:** ui (+ README).
**Проблема.** `ServerSync` — чисто in-memory; при потере сети оптимистичные правки
откатываются с тостами, reload теряет несохранённое (`server-sync.ts`, `BoardContext.tsx:1121-1143`),
но README/`package.json` заявляют offline-first.
**Что сделать.** Либо персистентный outbox (IndexedDB + дренаж по `online`, `commandId`
идемпотентен), либо уточнить формулировку README.
**DoD.** Тест: команда, не ушедшая при offline, отправляется после reconnect / либо README
приведён к реальности.
**Зависимости:** нет.

### TASK-106 `object-url-leaks` — утечки object-URL [✓/A]
**Приоритет:** P2. **Область:** ui.
**Проблема.** `use-avatar-object-url.ts` — нет дедупа in-flight, нет `revokeObjectURL`,
`setUrl(null)` в теле эффекта, нет негативного кэша. `CardAttachments.tsx:203-215` —
`revokeObjectURL` сразу после `click` (отменяет скачивание в Firefox/Safari). `embedAttachments.ts`
создаёт URL для download/lightbox и не revoke; кэш превью не эвиктится.
**Что сделать.** In-flight map + revoke предыдущего; отложенный revoke (как в `utils/download.ts`);
очистка кэша аватаров при logout.
**DoD.** Тесты: один запрос на аватар, revoke вызывается, скачивание не отменяется.
**Зависимости:** нет.

### TASK-107 `media-files-hardening` — `.tmp`, производные, range [A]
**Приоритет:** P2. **Область:** backend (attachments, admin).
**Проблема.** Утечка `.tmp-*` при таймауте media (`media.service.ts:235-238` — нет `rm` в
finally; `listBlobs` игнорит `.tmp-`). Admin delete не чистит производные
(`admin.service.ts:1828-1858,2105-2107` — только `storedName`). Нет `Accept-Ranges`/
`Content-Length` (видео не скроллится). Регенерация производной может осиротить старый блоб +
кэш на сутки.
**Что сделать.** `rm(tmp, {force:true})` в finally; чистить `thumbnailName`/`posterName`
в admin delete; range-раздача (или `res.sendFile`); short-circuit при `derivativeStatus:"done"` +
cache-bust URL.
**DoD.** Тесты: нет `.tmp` после таймаута; admin delete чистит производные; range работает.
**Зависимости:** TASK-77.

### TASK-108 `inline-attachment-cap` — cap и `attachmentCount` [✓]
**Приоритет:** P2. **Область:** backend (attachments).
**Проблема.** `attachments.service.ts:79-87,231-234`: `count()` включает inline, но
инкремент — только `!isInline`; `remove()` декрементит безусловно (в admin-пути есть
`if (!row.isInline)`). Итог — отрицательный/дрейфующий счётчик и неограниченные inline-блобы.
**Что сделать.** Не декрементить для inline; применять cap к inline-загрузкам.
**DoD.** e2e: счётчик не уходит в минус; cap держит inline.
**Зависимости:** TASK-100.

### TASK-109 `export-ttl-audit` — TTL при скачивании + аудит [A]
**Приоритет:** P2. **Область:** backend (admin).
**Проблема.** `exports.service.ts:174-187` `download()` проверяет только `status`/`storedName`,
не `expiresAt`. `downloadExport`/`exportUser`/`queueTicket` не пишут аудит.
**Что сделать.** Отклонять `expiresAt < now`; аудит `data.export_downloaded`,
`data.exported`, `queue.ticket_issued`.
**DoD.** Тест: просроченный артефакт → 404/410; аудит-строки создаются.
**Зависимости:** TASK-92.

### TASK-110 `broadcast-fanout-retry` — фан-аут и реальные ретраи [A]
**Приоритет:** P2. **Область:** backend (ops/comms).
**Проблема.** `broadcast-queue.service.ts:84-108` + `broadcast.processor.ts:21-23`:
`deliver()` глотает все ошибки и никогда не бросает → `attempts:3` мёртв; один джоб на весь
список — при будущем throw ретрай разошлёт дубли.
**Что сделать.** Фан-аут по одному джобу на получателя (или чанк) с детерминированным `jobId`;
бросать/помечать failure, чтобы ретраи работали.
**DoD.** Тест: сбойный адрес ретраится, успешные не дублируются.
**Зависимости:** нет.

### TASK-111 `exports-queue-threshold` — порог синхронного экспорта [✓]
**Приоритет:** P2. **Область:** backend (admin).
**Проблема.** `exports.service.ts:86-89` при `rows <= 5000` строит бандл **в запросе**;
легаси `GET /admin/users/:id/export` (`admin.service.ts:2241`) отдаёт весь `buildUserBundle`
инлайн.
**Что сделать.** Понизить порог/всегда в очередь; легаси-роут через `exports`-очередь.
**DoD.** Тест: крупный юзер не блокирует запрос.
**Зависимости:** нет.

### TASK-112 `contract-drift` — drift контрактов [✓/A]
**Приоритет:** P2. **Область:** shared/backend.
**Проблема.** `ConflictError` (`shared/src/api.ts:47-53`) vs 409 без `conflict`/`currentVersion`
при коллизии id (`commands.service.ts:397-401`). `AdminUpdateAnnouncementRequest.sendEmail`
не применяется (`admin-v3.dto.ts`). `InviteMemberRequest.expiresAt?: string|null` vs DTO без `null`.
`perUser` без валидации формы. `segment` без `@MaxLength`. `commandId` без `@MaxLength`.
`EXPORT_SCHEMA_VERSION` декоративен.
**Что сделать.** Выровнять shared↔DTO↔service; добавить недостающие валидаторы; осмысленная
версия экспорта.
**DoD.** Тесты контракта; e2e на новые поля/ошибки.
**Зависимости:** нет.

### TASK-113 `admin-announcement-edit` — редактирование объявлений [✓]
**Приоритет:** P2. **Область:** ui/admin.
**Проблема.** Есть `PATCH /admin/announcements/:id`, но UI умеет только activate/deactivate
и delete; расписание/контент правятся только через API.
**Что сделать.** Диалог редактирования (title/body/level/audience/schedule/active/`sendEmail`).
**DoD.** UI-тест: редактирование применяется; `sendEmail` (см. TASK-112) работает.
**Зависимости:** TASK-112.

### TASK-114 `dead-code-i18n-cleanup` — мёртвый код и i18n [✓/A]
**Приоритет:** P2. **Область:** ui/backend.
**Проблема.** Мёртвая фича «Watch as»: `watcherEmail` (`admin-demo-start.dto.ts:21`) +
i18n `admin.demo.watcher*`. ~40 неиспользуемых i18n-ключей (`admin-i18n.ts`, включая
`admin.bulk.confirm.*`). `adminApi.exportUser` (GET) без вызывающих.
`ExportsService.sweepExpired` — дубликат. `splitLinks`/`TextSegment`/`isPairLinked`.
Возможные неиспользуемые колонки `OpsSettings`.
**Что сделать.** Удалить мёртвое; добавить тест/линт на неиспользуемые ключи.
**DoD.** Grep чист; паритет i18n сохранён; гейты зелёные.
**Зависимости:** нет.

### TASK-115 `design-tokens` — токены: приоритеты и lightbox [A]
**Приоритет:** P2. **Область:** ui.
**Проблема.** `utils/priority.ts:34-70` — сырые Tailwind-цвета (`bg-red-600`, `bg-amber-400`, …);
lightbox `utils/embedAttachments.ts:69,144,152,185` — `rgba/#fff/#8b8fa3`.
**Что сделать.** Маппинг приоритетов на токены темы; overlay на `--`-переменные.
**DoD.** Нет хардкод-цветов; тема/high-contrast применяются.
**Зависимости:** нет.

### TASK-116 `a11y-board` — a11y карточек и заголовка колонки [A]
**Приоритет:** P2. **Область:** ui.
**Проблема.** VIEWER-карточки получают `role="button"`/`tabIndex` dnd-kit
(`SortableCard.tsx:61,78` — `useSortable` без `disabled: readOnly`); заголовок колонки —
`role="button"` drag-хэндл, оборачивающий интерактивные дети (`ColumnView.tsx:254-263`).
**Что сделать.** `disabled: readOnly` в `useSortable`; drag-атрибуты на отдельную ручку.
**DoD.** Тест: в VIEWER карточки не focusable как кнопки; клавиатура доходит до меню.
**Зависимости:** нет.

### TASK-117 `tableview-memo` — мемоизация `TableView` [A]
**Приоритет:** P2. **Область:** ui.
**Проблема.** `TableView.tsx:252-312` пересобирает `rows` и сортировку на каждый рендер,
подписан на всю доску → O(n log n) на keystroke.
**Что сделать.** `useMemo` для `rows`/`sortedRows`.
**DoD.** Тест/замер: правка карточки не пересчитывает всё.
**Зависимости:** нет.

### TASK-118 `god-module-split` — расслоение god-модулей [A]
**Приоритет:** P2. **Область:** ui.
**Проблема.** `BoardContext.tsx` 1864, `CalendarView.tsx` 1163, `TableView.tsx` 1159,
`CardContextMenu.tsx` 972 строк.
**Что сделать.** Вынести `useBoardPersistence`/`useBoardServerMode`/`useBoardRouting`;
подкомпоненты Calendar/Table (day-panel, composer, row).
**DoD.** Поведение не меняется, тесты зелёные, размеры файлов снижены.
**Зависимости:** TASK-117.

### TASK-119 `health-readiness` — `/health` с зависимостями [A]
**Приоритет:** P2. **Область:** backend (health).
**Проблема.** `health.service.ts:13-24` пингует только БД; нет Redis/очередей/диска;
роут под maintenance/throttler.
**Что сделать.** Опциональные проверки Redis/очередей; исключить health из maintenance/throttle.
**DoD.** Тест: недоступный Redis отражается в readiness.
**Зависимости:** нет.

### TASK-120 `env-hardening` — env и avatar MIME [A]
**Приоритет:** P2. **Область:** backend.
**Проблема.** `UPLOAD_DIR` вне envalid (`storage.service.ts:37-40`) — относительное значение
резолвится от cwd. Avatar `Content-Type` из расширения клиентского файла
(`users.controller.ts:76-79`), без хранимого MIME.
**Что сделать.** Добавить `UPLOAD_DIR`/`TRUST_PROXY` в envalid и абсолютизировать; хранить
и отдавать серверный avatar MIME.
**DoD.** Тесты env-валидации; avatar отдаётся с корректным типом.
**Зависимости:** TASK-76, TASK-91.

### TASK-121 `i18n-parity` — паритет en/ru [A]
**Приоритет:** P2. **Область:** ui.
**Проблема.** RU без `presence.people_other`; RU-ключ `card.links.cap` без EN.
**Что сделать.** Дополнить/удалить; при необходимости расширить тест паритета.
**DoD.** Тест паритета зелёный.
**Зависимости:** нет.

---

## Карта к прошлому аудиту (2026-09-20)

| Находка прошлого аудита | Задача |
| --- | --- |
| `createId()` не crypto-random | TASK-98 |
| rate limit по `req.ip`, нет `trust proxy` | TASK-91 |
| MIME/Content-Type доверяется клиенту | TASK-76 |
| backend `tsc --noEmit` не в CI | TASK-95 |
| `listSince` без лимита + нет retention `Command` | TASK-84 |
| `?client=` presence не привязан к юзеру | TASK-102 |
| 5 параллельных `switch`, нет exhaustiveness | TASK-96 |
| гонка лимита вложений + orphan-блобы | TASK-77, TASK-100, TASK-108 |
| `.pipe(res)` без обработки ошибок | TASK-78 |
| `use-avatar-object-url` дедуп/revoke | TASK-106 |
| offline-first не реален в серверном режиме | TASK-105 |
| `RealtimeService.channels`/`ServerSync.chains` утечка | TASK-102 |
| `BoardContext.tsx` god-module | TASK-118 |
| `avatarPath` в presence | (проверить; кандидат в TASK-102) |

---

## Порядок работы (рекомендация)

1. **Волна 1 (P0):** TASK-75 … TASK-81 — можно резать по файлам параллельно
   (sw.js · attachments/storage/share · maintenance · controllers · commands · comments).
2. **Волна 2 (P1):** TASK-82 … TASK-95.
3. **Волна 3 (P2):** TASK-96 … TASK-121, начиная с контрактов/редьюсера (96, 97, 112)
   и эксплуатации (92, 109, 110, 111).

**Замечания.**
- Каждая задача — отдельная ветка `feature/TASK-{N}-{slug}` и отдельный PR (§0 ROADMAP).
- Задачи, помеченные `[A]`, перед стартом подтвердить чтением кода (в отчёте ревью
  помечены как «не перепроверял вживую»).
- Часть P2 допускает объединение в один PR, если правится один файл (напр. 97 — целиком
  `board-reducer.ts`); разбиение фиксирует координатор.
- После закрытия задачи — переносить полное описание в `ROADMAP-DONE.md` и строку в
  §6.0/§7.7, как обычно.
