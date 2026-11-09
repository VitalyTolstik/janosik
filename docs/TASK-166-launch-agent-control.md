# ADR-166 / TASK-166: политика agent control, scopes, approvals и run safety

- **Статус:** Accepted / заморожено (2026-11-09)
- **Задача:** TASK-166.0 «Policy & ADR»
- **Нормативный источник программы:** `ROADMAP.md` §7.23 (цели, волны,
  зависимости) и этот ADR (замороженные решения, схема, матрица, коды).
- **Ненормативные локальные материалы:** `audits/launch-gaps-agent-experience.md`
  и `audits/launch-gaps-human-control.md` — исследовательские заметки, не
  входящие в git; они использованы как контекст, но не являются контрактом.
  Если аудит или код противоречат ADR/ROADMAP, действует ADR; противоречие
  исправляется через owner 166.0.

Документ не меняет продуктовый код, Prisma-схему, тесты или UI. Он фиксирует
решения, точную схему данных, матрицу действий, коды ошибок и границы run,
чтобы потоки 166.1–166.16 могли стартовать без переделок.

---

## 1. Контекст и цель

Janosik уже имеет командный лог, детерминированный reducer, `ifMatch`,
атомарный batch до 100 команд, claim с lease, типизированные комментарии,
scoped API-токены, SSE, share-ссылки и MCP. Это не нужно переделывать.

Чего не хватает для позиционирования «Kanban в первую очередь для AI-агентов,
с контролем человека»:

- агент различается только как `actorType: "agent"` и человеческий email;
  два PAT одного аккаунта неразличимы в истории, SSE и Watch;
- нет сущности «запрос согласования»: approval — это комментарий и устная
  договорённость;
- destructive-действия агента не закрыты сервером: MEMBER-агент может удалять
  карточки и колонки;
- нет pause/kill switch, кроме необратимого отзыва токена;
- нет run-level аудита и отката: undo — локальный стек браузера на 50 шагов;
- ошибки записи неполные: нет единых `code`/`retryable`/`requestId`, MCP
  мутации возвращают текст;
- лимит «10 досок» противоречит обещанию unlimited и режет импорт;
- backup-статус в панели вводит в заблуждение.

**Цель TASK-166:** сделать человека владельцем контура «кто из агентов что
делает, что можно, что требует разрешения, как остановить и как откатить», не
ломая self-host, старые доски и существующие MCP-сценарии.

**Границы:** только self-host OSS. Managed cloud, billing, DPA, multi-tenant,
remote MCP/OAuth, webhooks, object storage и SIEM — вне TASK-166 (см. §16).

---

## 2. Принципы

1. **Агент — не boolean, а identity.** Владелец — `User`; исполнитель —
   `ApiToken` + `AgentSession`; каждая запись несёт `apiTokenId`,
   `agentSessionId` (если есть), `runId` (если есть) и snapshot `agentName`.
2. **Сервер — источник истины.** UI pre-check только объясняет. Scopes,
   destructive gate, WIP, workflow, pause, approval и plan hash проверяются
   на сервере внутри транзакции/под блокировкой доски.
3. **Deny by default для destructive.** Прямое destructive-действие агента
   запрещено; исключения — `ApprovalRequest` или явный `trustedCi` scope.
   Legacy PAT — отдельное, явно ограниченное исключение (см. §13).
4. **Один run → один аудит и один rollback.** Batch/plan и одиночное
   destructive-действие получают `runId`; pre-image хранится для каждой
   команды run; человек может посмотреть run и откатить его.
5. **Сначала контракт, потом UI.** Backend-примитивы не зависят от
   `feat/admin-redesign`. Экраны Agents/Approvals/Audit/Rollback/Scopes
   делаются в новой админке (W3).
6. **Не ломать self-host.** Новые поля nullable или с безопасным default;
   старые доски, экспорты и PAT продолжают работать. Все новые таблицы —
   additive; существующие поля не переименовываются.
7. **Человеческий контроль не делегируется агенту.** Pause, resume, scopes,
   board policy и approval decision — session-only (`browser JWT`), не PAT.
8. **Никаких «тихих» no-op.** Ошибка всегда имеет машинный `code`; mutation
   возвращает `structuredContent`; idempotent retry возвращает тот же
   результат.

---

## 3. Термины

| Термин | Значение в TASK-166 |
| --- | --- |
| **Agent** | Не отдельная таблица. Агент — это `ApiToken` пользователя-владельца, действующий через MCP/REST. Владелец всегда человек (`User`). |
| **Agent session** | `AgentSession` — ограниченный доской контекст работы одного токена: start/heartbeat/end, статус, текущая карточка, pause. Сессия не является аккаунтом и не даёт прав сверх токена. |
| **Run** | `AgentRun` — группа команд одного batch/plan/одиночного destructive-действия агента на одной доске. Единица аудита и отката. |
| **Approval** | `ApprovalRequest` — запрос владельцу PAT/board ADMIN на точный план действий с `planHash` и TTL. Approval разрешает применение, но не применяет план сам. Handoff остаётся типизированным комментарием `handoff`; отдельной сущности Handoff в MVP нет, а `kind: "done"` approval — формальное разрешение перехода в Done. |
| **Pause** | Обратимая остановка: новые записи агента получают `403 agent_paused`, in-flight завершаются, SSE закрывается. Уровни: session, token, board. |
| **Kill** | Необратимый отзыв PAT (`DELETE /users/me/tokens/:id`): все сессии `cancelled`, claims освобождаются, новые запросы `401`. Отдельного «kill session» в MVP нет. |
| **Destructive action** | Действие, которое удаляет/скрывает существующий контент, массово архивирует, отзывает доступ или меняет состав участников/видимость доски. Точный список — §7. |
| **Legacy token** | `ApiToken`, существовавший до миграции TASK-166. При миграции получает `scopePreset = "admin"` и `trustedCi = true` (кроме `readOnly`), чтобы работать как раньше. |
| **Board policy** | `Board.agentPolicy` (JSONB) — политика destructive/done/approval для агентов на доске. `NULL` = безопасные defaults. |
| **trustedCi** | Явный boolean-scope токена (в тексте задачи — `trusted_ci`; DB/API — `trustedCi`): разрешает destructive/sensitive-действия без approval. Не даёт account-прав и не отменяет board pause/`destructive: "deny"`. |
| **Pre-image** | Снимок состояния сущностей до команды (`CommandPreimage`), достаточный для построения inverse-команды. |
| **Plan hash** | `sha256` канонического JSON исполняемого плана (`boardId` + `commands`/`operations`), 64 hex-символа. |
| **Effective token scope** | `scopePreset` ∩ `readOnly` (Observer). Это свойство токена, а не авторизационное решение: сервер дополнительно применяет board-роль, workflow и pause. Поле DTO называется `effectiveTokenScope`. |

---

## 4. Зафиксированные решения

### 4.1. Решения из §7.23.1

| # | Вопрос | Решение | Обоснование | Последствия и что запрещено |
| --- | --- | --- | --- | --- |
| D1 | Self-host или managed cloud? | Self-host OSS — единственная форма поставки TASK-166. Cloud — отдельная программа. | Продукт уже self-host, AGPL, Docker; cloud-требования (billing, DPA, tenant isolation) не должны блокировать agent-control. | Запрещено добавлять в TASK-166 billing, DPA, status page, multi-tenant org, обязательный remote MCP/OAuth. |
| D2 | Агент = user+PAT или отдельная сущность? | Владелец — `User`; исполнитель — `AgentSession` + `ApiToken` (`apiTokenId`). Отдельную таблицу `Agent` в MVP не вводим. | Не нужна вторая система аккаунтов; PAT уже аутентифицирует и имеет scopes. `AgentSession` даёт идентичность запуска без миграции аккаунтов. | Запрещено делать «agent user» с отдельным email как обязательный сценарий. `AgentSession` не может быть владельцем доски, токена или приглашения. |
| D3 | Default destructive-действий | **Deny by default означает запрет прямого исполнения:** destructive-запрос агента без approval получает `approval_required`; штатный путь — человек утверждает точный план. `trustedCi` — явное исключение для доверенного CI. Жёсткий запрет (`destructive: "deny"`) — opt-in политики доски для всех, включая `trustedCi`. | Это главный launch-блокер human control. Approval-by-default не зависит от роли MEMBER/ADMIN; hard deny — отдельный, более строгий режим. | Запрещено трактовать board-роль ADMIN как разрешение на destructive без approval/`trustedCi`. Запрещено смешивать `deny` (hard block) и `approval` (штатный путь) в одном default. `trustedCi` не отменяет `destructive: "deny"` и board pause. |
| D4 | Что такое run? | Один `AgentRun` = один board-scoped batch/plan/одиночная destructive-команда PAT + один `agentSessionId?`. Cross-board run запрещён. | Один batch уже одна транзакция и один lock; run — естественная единица аудита/отката. | Запрещено объединять в один run команды разных досок. Запрещено делать run бесконечным окном времени. |
| D5 | Pause-семантика | Новые записи → `403 agent_paused`; in-flight транзакции завершаются; SSE закрывается на следующем keep-alive; resume возвращает запись; board-level pause и «stop all» обратимы; kill = revoke. | Нельзя обрывать транзакцию посередине и оставлять half-applied batch. Необратимый kill уже существует как revoke. | Запрещено делать pause через отзыв токена. Запрещено агенту вызывать pause/resume. Запрещено очищать claims при pause. |
| D6 | Retention | Один `OpsSettings.retentionDays`: default 30, пресеты 30/90/365, custom 1–3650. Он покрывает Command, CommandPreimage, Activity, AgentRun, AgentSession, terminal ApprovalRequest и soft-deleted rows. `AdminAuditLog` сохраняет свои 365 дней. | Один понятный срок; 30 дней достаточно для beta, 365 — для расследований. Отдельный SIEM/audit tier — вне TASK-166. | Запрещено удалять `pending` approvals по retention. Запрещено обещать «вечный» аудит. |
| D7 | Вложения | Локальный диск, как сейчас (`UPLOAD_DIR`), без presigned URL и object storage. | Self-host не требует S3; TASK-166 не про storage backend. | Запрещено добавлять S3/object storage/presigned upload в TASK-166. |
| D8 | Undo агента | Агент не получает browser undo. Компенсация — обычные неразрушающие команды; run rollback — session-only human API. Browser JWT сохраняет обычный undo: `RESTORE_*` разрешены роли, которая могла выполнить исходную команду (ADMIN/MEMBER), независимо от token-scope. | Browser undo — локальная история человека; нельзя ломать MEMBER-сценарий «delete → undo». Run rollback — управляемый, проверяемый и аудируемый. | Запрещено давать PAT доступ к `RESTORE_*` и к apply run revert. `RESTORE_BOARD` остаётся aggregate-level/local snapshot, `/commands` его не принимает. |

### 4.2. Дополнительные замороженные решения

| # | Решение | Обоснование | Последствия и что запрещено |
| --- | --- | --- | --- |
| D9 | **Grandfathering PAT.** Существующие токены при миграции получают `scopePreset = "admin"`, `trustedCi = true` (если `readOnly = false`). `readOnly = true` сохраняет флаг и эффективно означает Observer. Новые токены создаются с `scopePreset = "worker"` и `trustedCi = false`. | Это единственный способ одновременно закрыть destructive по умолчанию и не сломать текущие MCP-сценарии старых PAT. | Старые PAT сохраняют board-поведение, но account-маршруты (`profile`, `tokens`, `invitations`) им закрываются как security fix. `trustedCi` нельзя включить через PAT. |
| D10 | **Пресеты scope:** `observer`, `worker`, `reviewer`, `admin`; отдельный boolean `trustedCi`. Пресет не повышает board-роль. | Простая, объяснимая модель; `readOnly` остаётся для совместимости. | `admin` не даёт account-прав; `trustedCi` не даёт member/share/board-admin прав; `observer` не пишет. |
| D11 | **Scopes токена неизменяемы после создания.** Менять scope = создать новый токен и отозвать старый. | Иммутабельность исключает самоповышение и делает аудит однозначным. | Запрещён `PATCH /users/me/tokens/:id` для scope/trustedCi. Разрешены только pause/resume/revoke. |
| D12 | **Approval разрешает, но не применяет.** Approve переводит запрос в `approved`; применение делает агент тем же планом с `X-Approval-Id`. | Один путь применения, одна транзакция, идемпотентные `commandId`; человек не исполняет устаревший план, если агент уже умер. | Запрещено auto-apply внутри decision endpoint. Approval одноразовый: после apply — `consumed`. |
| D13 | **Human control plane — session-only.** Board policy, pause/resume, token pause, approval decision, run revert, self-service export/delete — только `browser JWT`. | Агент не должен ослаблять ограничения, снимать паузу или утверждать свой план. | PAT получает `403 pat_forbidden` на этих маршрутах; MCP не регистрирует соответствующие tools для агента. |
| D14 | **Board policy** — `Board.agentPolicy` JSONB + `Board.agentPolicyVersion`; правка через `PATCH /boards/:id/agent-policy` с CAS. `NULL` = defaults. | Конфигурация доски, а не контент; не нужно добавлять `BoardAction` и трогать reducer. CAS защищает от двух админов. | Запрещено агенту менять policy. `destructive: "deny"` — жёсткий запрет, не обходится даже `trustedCi`. |
| D15 | **Сессия board-scoped и необязательна для обычной записи.** Указывается заголовком `X-Agent-Session`; batch/plan/approval/destructive run её используют, если она есть. Legacy PAT может работать без сессии. | Совместимость с текущими REST/MCP-клиентами; сессия даёт атрибуцию и per-session pause, но не является единственным kill switch. | Запрещено сессии писать в другую доску. Запрещено считать отсутствие сессии обходом token/board pause. |
| D16 | **Run создаётся только для PAT:** batch, plan/apply и одиночная destructive-команда `BoardAction`. Non-command REST-действия и обычная одиночная неразрушающая команда `runId = null`. | Не раздувать лог; browser undo человека не меняется. | Запрещён cross-board run. Человеческий batch через API не создаёт `AgentRun`; его undo остаётся UI-механизмом. |
| D17 | **Run revert — только человек** (board ADMIN, browser JWT). Агент может получить dry-run/preview, но не применить revert. | Откат destructive-действий — опасная операция; человек видит конфликты и подтверждает. | Запрещён `POST .../revert` с PAT. MCP даёт только `janosik_preview_run_revert`. |
| D18 | **Ошибки — additive-контракт.** Сохраняются текущие `{conflict, currentVersion, workflow}` и `field`; добавляются `code`, `retryable`, `requestId`; `currentVersion` — на state-конфликтах. | Не ломать текущие клиенты и docs; новые агенты получают машинную ветку. | Запрещено переименовывать `conflict`-категории и `pat_read_only`/`pat_forbidden`/`board_write_timeout`. |
| D19 | **Лимит 10 досок убирается в server mode.** `MAX_BOARDS_PER_USER` (env) default `0` = без лимита; оператор может задать положительный cap. Local/offline mode сохраняет 10 как localStorage guard. | Pricing обещает unlimited; 10 — технический guard offline, а не продукт. | Запрещено резать импорт на 10 досках. Импорт больше cap отклоняется атомарно с `limit_exceeded`. |
| D20 | **Import/export:** `EXPORT_SCHEMA_VERSION = 3` (добавляет `Board.agentPolicy`); `MAX_IMPORT_BYTES = MAX_BOARD_EXPORT_BYTES = 25 MB`; command/plan body — отдельный `MAX_COMMAND_BODY_BYTES = 10 MB`; export больше лимита — явная ошибка, не обрезка. | «Импорт ≥ экспорт» без streaming и object storage; команды не должны наследовать import-лимит. | Запрещён молчаливый truncate. Старые v1/v2 импортируются; старые клиенты v3 отвергают. |
| D21 | **Backup status честный.** Janosik не делает backup. API отдаёт `{mode: "external" or "unconfigured", automatic: false, lastBackupAt: null, verified: false}`; UI не показывает «Automatic backups»/«Save a copy now» в server mode. | `BACKUP_DIR` сейчас только отображается; нельзя продавать несуществующий backup. | Запрещено писать «backup healthy». Runbook — `pg_dump` + uploads volume (166.16). |
| D22 | **Account-маршруты недоступны PAT.** Session-only — account **writes** (profile/avatar `PATCH`, token create/revoke/pause, invitation accept/decline, account delete) **и чувствительные account reads**: `GET /users/me/tokens`, `GET /invitations`, `GET /users/me/export/:id`/`download`. PAT остаются только identity/avatar reads: `GET /auth/me`, `GET /users/:userId/avatar`, `janosik_whoami`. MCP tools `janosik_update_profile`, `janosik_list_invitations`, `janosik_accept_invitation`, `janosik_decline_invitation` удаляются. | PAT с board scope мог читать чужие приглашения, список ключей и export, а также менять профиль. Это security fix, а не совместимость. | Старые PAT теряют write-вызовы и чувствительные reads; identity/avatar reads сохраняются. Board-scoped токен не может принимать инвайты. |
| D23 | **Claim attribution.** `Card.claimedBy` (user id) остаётся; добавляются `claimedByTokenId`, `claimedBySessionId`. Сервер ставит их из principal, клиент не может подделать. | Два PAT одного аккаунта должны различаться; legacy UI продолжает работать. | Запрещено доверять token/session id из payload `CLAIM_CARD`. Конфликт claim сравнивает session, затем token, затем legacy user id. |
| D24 | **SSE attribution и pause.** Command/Activity кадры несут `apiTokenId`, `agentSessionId`, `runId`, `agentName`; добавляются `approval` и `agent` события. PAT-SSE закрывается при pause. | Watch и человек должны видеть, кто действует; pause должен останавливать поток. | Запрещено терять `actorType` в SSE. Human SSE при pause не закрывается. |
| D25 | **Идемпотентность REST.** `Idempotency-Key` (8–128 `[A-Za-z0-9_-]`) для create board/import/share/upload; `add_comment` использует существующий body `commandId`; `duplicate_card` и остальные команды — `commandId`. Повтор с тем же ключом и телом возвращает сохранённый ответ; другое тело — `idempotency_conflict`. | Ретраи агентов не должны создавать дубли. | Ключ живёт 24 часа. `in_progress`-повтор получает `idempotency_in_progress` с `retryable: true`. |

---

## 5. Модель scope

### 5.1. Пресеты

| Пресет | Чтение | Обычная запись контента | Destructive | Board administration | Account |
| --- | --- | --- | --- | --- | --- |
| `observer` | да | нет | нет | нет | нет |
| `worker` | да | да | нет (только approval/`trustedCi`) | нет | нет |
| `reviewer` | да | да | нет (только approval/`trustedCi`) | нет | нет |
| `admin` | да | да | да, но только approval/`trustedCi` | да | нет |

Пресеты упорядочены: `observer` ⊂ `worker` ⊂ `reviewer` ⊂ `admin`;
матрица ниже указывает минимальный пресет, старший пресет наследует
разрешение.

Дополнительно:

- `reviewer` = `worker` + право переводить карточку в done-колонку.
  `doneColumnIds = Board.workflow?.doneColumnIds ?? []`; без workflow
  колонок done нет, и `reviewer` практически равен `worker`.
- `admin` не получает destructive напрямую: destructive проходит через
  approval, если не включён `trustedCi`.
- `readOnly = true` всегда даёт эффективный `observer`, даже если
  `scopePreset = "admin"` (так мигрируют старые read-only PAT).
- `trustedCi` — ортогональный boolean. Он не меняет пресет и не даёт
  member/share/board-admin прав. `trustedCi` можно включить только при
  создании токена из browser session.
- Роль на доске (`ADMIN`/`MEMBER`/`VIEWER`) применяется первой. Токен
  `admin` у MEMBER не может управлять участниками; токен `worker` у ADMIN
  не может удалять карточки без approval.

### 5.2. Эффективный scope

Порядок вычисления для каждого запроса:

```
if token.revokedAt or token.expiresAt <= now: 401
if token.individualPausedAt or token.stopAllPausedAt: pause = "token"
if board.agentsPausedAt: pause = "board"          // только board-scoped маршруты
if session.pausedAt: pause = "session"            // только если сессия указана
if readOnly: effectiveTokenScope = observer
else: effectiveTokenScope = scopePreset
if boardRole == VIEWER: write = false
if action requires ADMIN and boardRole != ADMIN: deny
if action requires scope > effectiveTokenScope: deny
```

`trustedCi` проверяется только после scope и destructive-политики:

```
if destructive:
  if board.agentPolicy.destructive == "deny": deny
  if effective == observer: deny
  if trustedCi: allow
  else: approval required
```

Default board policy — `destructive: "approval"`: прямое исполнение
запрещено, approval является штатным путём. `destructive: "deny"` —
осознанный hard block, который не обходится даже `trustedCi`.

Approval **не повышает scope**: `worker`, которому нужен `admin` для
member/share/board delete, получает `scope_denied`, а не `approval_required`.

Browser JWT человека не проходит preset/destructive gate: для него
действуют существующие board-роли и правила маршрута. Approval и `trustedCi`
относятся только к PAT (`actorType: "agent"`); человек не обязан утверждать
собственные действия.

### 5.3. Токен в API

`UserTokenDto` и `CreateUserTokenRequest` расширяются:

```ts
type ScopePreset = "observer" | "worker" | "reviewer" | "admin";

interface UserTokenDto {
  // существующие поля не меняются
  scopePreset: ScopePreset;
  trustedCi: boolean;
  individualPausedAt: number | null;
  individualPausedBy: string | null;
  individualPausedReason: string | null;
  stopAllPausedAt: number | null;
  stopAllPausedBy: string | null;
  paused: boolean; // individualPausedAt != null || stopAllPausedAt != null
  effectiveTokenScope: ScopePreset; // observer при readOnly; не авторизация
}

interface CreateUserTokenRequest {
  // существующие поля не меняются
  scopePreset?: ScopePreset; // default "worker"
  trustedCi?: boolean; // default false; только session JWT
}
```

`readOnly` остаётся в DTO на один релизный цикл как deprecated-совместимость;
новый UI пишет `scopePreset`. Сервер принимает оба поля, `readOnly` побеждает.

---

## 6. Схема данных

### 6.1. Общие правила

- Все новые поля в существующих таблицах — nullable или с безопасным
  default; ни одно существующее поле не переименовывается.
- Новые audit-таблицы (`AgentSession`, `AgentRun`, `ApprovalRequest`,
  `CommandPreimage`, `SecurityAuditLog`, `IdempotencyRecord`) хранят id
  скалярами, без FK на `Board`/`User`/`Card`. Причина: запись должна
  переживать soft-delete и purge; каскадное удаление не должно стирать
  аудит раньше retention. Это тот же приём, что `BoardShareAuditLog`.
- `Command`/`Activity`/`Card`/`Board`/`ApiToken` получают только nullable
  поля или поля с default.
- `CommandPreimage` — 1:1 к `Command`, но без FK; очищается тем же sweep.
- Все `DateTime` — UTC; id — `cuid()`/клиентские id, как в текущей схеме.

### 6.2. `ApiToken`

Добавить:

```prisma
model ApiToken {
  // ...существующие поля без изменений...
  scopePreset String  @default("worker") // observer|worker|reviewer|admin
  trustedCi   Boolean @default(false)
  // Two independent pause sources: resume-all touches only stopAll*.
  individualPausedAt     DateTime?
  individualPausedBy     String?
  individualPausedReason String?
  stopAllPausedAt        DateTime?
  stopAllPausedBy        String?

  @@index([userId, individualPausedAt])
  @@index([userId, stopAllPausedAt])
}
```

`boardId`, `readOnly`, `rateLimitPerMinute`, `lastUsedAt`, `expiresAt`,
`revokedAt` остаются. `lastUsedAt` по-прежнему обновляется не чаще раза в
60 секунд.

### 6.3. `Board`

```prisma
model Board {
  // ...существующие поля без изменений...
  agentPolicy        Json?
  agentPolicyVersion Int       @default(1)
  agentsPausedAt     DateTime?
  agentsPausedBy     String?
  agentsPauseReason  String?
}
```

`agentPolicy = NULL` означает defaults:

```json
{
  "schemaVersion": 1,
  "destructive": "approval",
  "requireApprovalFor": [
    "member.invite",
    "member.update",
    "member.remove",
    "share.create",
    "share.update",
    "share.revoke",
    "share.delete",
    "attachment.delete",
    "delete_board",
    "workflow.update"
  ],
  "approverRoles": ["ADMIN"],
  "maxCommandsPerRun": 100,
  "maxCardsPerRun": 50,
  "approvalTtlMinutes": 60
}
```

Правила валидации policy:

- `schemaVersion` = 1;
- `destructive` ∈ `{ "approval", "deny" }`;
- `requireApprovalFor` — подмножество фиксированного списка:
  `move_to_done`, `delete_card`, `delete_column`, `delete_label`,
  `delete_checklist`, `delete_checklist_item`, `archive_column_cards`,
  `delete_board`, `member.invite`, `member.update`, `member.remove`,
  `share.create`, `share.update`, `share.revoke`, `share.delete`,
  `attachment.delete`, `workflow.update`;
- `approverRoles` в MVP строго `["ADMIN"]`; другие значения — 400;
- `maxCommandsPerRun` 1–100, `maxCardsPerRun` 1–50, `approvalTtlMinutes`
  5–1440; policy может только **понижать** глобальные лимиты, значения выше
  жёстких лимитов отклоняются, а не клампятся молча;
- `SET_BOARD_WORKFLOW` остаётся отдельной `BoardAction` и не является
  destructive-классификацией; её approval регулируется записью
  `workflow.update` в `requireApprovalFor` (по default policy включена).

`PATCH /boards/:id/agent-policy` — session-only board ADMIN:
`{ "policy": { ... } | null, "version": 1 }`. `null` возвращает defaults.
`agentPolicyVersion` увеличивается на каждом PATCH; старая версия →
`409 version_conflict` с `details.currentVersion`.

`agentsPausedAt` — операционное состояние, **не** экспортируется и не
импортируется. Пауза не переживает перенос доски.

Effective-лимиты для batch/plan/approval:

```
maxCommands = min(COMMAND_BATCH_MAX=100, policy.maxCommandsPerRun)
maxCards    = min(50, policy.maxCardsPerRun)  // ADD_CARD/DUPLICATE_CARD/DUPLICATE_COLUMN
effectiveTtlMinutes =
  clamp(min(request.ttlMinutes ?? policy.approvalTtlMinutes,
            policy.approvalTtlMinutes), 5, policy.approvalTtlMinutes)
```

Превышение `maxCommands`/`maxCards` — `409 limit_exceeded` с `limit` и
`current`; TTL меньше 5 минут поднимается до 5, больше policy — урезается до
policy. Запрос TTL не может обойти policy.

### 6.4. `Card`

```prisma
model Card {
  // ...существующие поля без изменений...
  claimedByTokenId   String?
  claimedBySessionId String?

  @@index([claimedByTokenId])
  @@index([claimedBySessionId])
}
```

`claimedBy` (user id) сохраняется для старого UI и старых claim. Сервер
записывает все три поля из principal; payload `CLAIM_CARD` не может задать
token/session. Конфликт: сначала сравнивается `claimedBySessionId`, затем
`claimedByTokenId`, затем legacy `claimedBy`; lease остаётся источником
истины по времени.

Вложения тоже получают token-атрибуцию для правила «свой upload»:

```prisma
model Attachment {
  // ...существующие поля без изменений...
  uploadedByTokenId   String?
  uploadedBySessionId String?

  @@index([uploadedByTokenId])
  @@index([uploadedBySessionId])
}
```

`Comment.apiTokenId` уже добавлен в §6.9. Для обеих таблиц старые строки
имеют `NULL`: self-правило для них падает обратно на совпадение `userId`.

### 6.5. `AgentSession`

```prisma
model AgentSession {
  id              String    @id @default(cuid())
  userId          String
  apiTokenId      String
  boardId         String
  name            String?   @db.VarChar(100)
  clientName      String?   @db.VarChar(100)
  model           String?   @db.VarChar(100)
  status          String    @default("active")
  // active|idle|waiting_approval|completed|failed|cancelled
  currentCardId   String?
  currentRunId    String?
  startedAt       DateTime  @default(now())
  lastHeartbeatAt DateTime  @default(now())
  endedAt         DateTime?
  endReason       String?
  pausedAt        DateTime?
  pausedBy        String?
  pausedReason    String?
  summary         String?   @db.Text

  @@index([apiTokenId, status])
  @@index([boardId, status, lastHeartbeatAt])
  @@index([boardId, startedAt])
  @@index([userId, startedAt])
  @@index([lastHeartbeatAt])
}
```

- `pausedAt` — индивидуальная пауза сессии; общая пауза токена/доски
  вычисляется наложением и не пишется в сессию.
- `lastHeartbeatAt` обновляется явным heartbeat и (не чаще раза в 60 с)
  успешной записью с `X-Agent-Session`.
- Сессия считается `stale` в API, если `lastHeartbeatAt` старше 5 минут;
  это вычисляемое поле, а не отдельный статус БД.
- `currentCardId`/`currentRunId` — подсказки для UI; не заменяют `Command`.

### 6.6. `AgentRun`

```prisma
model AgentRun {
  id             String    @id @default(cuid())
  boardId        String
  apiTokenId     String?
  agentSessionId String?
  actorId        String
  kind           String // batch|plan|single|revert
  status         String    @default("applied") // applied|reverted|failed
  clientRunId    String?
  planHash       String?
  approvalId     String?   @unique
  commandCount   Int       @default(0)
  firstSeq       BigInt?
  lastSeq        BigInt?
  revertsRunId   String?
  createdAt      DateTime  @default(now())
  appliedAt      DateTime  @default(now())
  revertedAt     DateTime?

  @@unique([boardId, clientRunId])
  @@index([boardId, createdAt])
  @@index([agentSessionId, createdAt])
  @@index([apiTokenId, createdAt])
}
```

- `id` — канонический `runId`, генерирует сервер. `clientRunId` — optional
  ключ идемпотентности клиента; уникален в пределах доски.
- `kind = "single"` — одиночная destructive-команда PAT.
- `status = "reverted"` ставится исходному run при успешном revert; revert
  создаёт новый run `kind = "revert"` с `revertsRunId`.
- `approvalId` заполняется при применении approved-плана; уникальность
  гарантирует одноразовость.
- `firstSeq`/`lastSeq` — диапазон `Command.seq`; nullable для неуспешного run.

### 6.7. `ApprovalRequest`

```prisma
model ApprovalRequest {
  id               String    @id @default(cuid())
  boardId          String
  cardId           String?
  requestedBy      String    // userId владельца PAT
  requestedByTokenId String
  agentSessionId   String?
  kind             String // destructive|done|custom
  actionType       String // BoardAction.type | "batch" | operation (например "share.create")
  summary          String    @db.VarChar(500)
  risk             String    @default("medium") // low|medium|high
  plan             Json
  planHash         String
  status           String    @default("pending")
  // pending|approved|rejected|expired|cancelled|consumed
  expiresAt        DateTime
  decidedBy        String?
  decidedAt        DateTime?
  decisionComment  String?   @db.Text
  runId            String?   // AgentRun.id, заполняется при consume
  consumedAt       DateTime?
  createdAt        DateTime  @default(now())

  @@index([boardId, status, createdAt])
  @@index([requestedByTokenId, status])
  @@index([expiresAt, status])
  @@index([planHash])
}
```

`plan` — точный исполняемый план:

```json
{
  "schemaVersion": 1,
  "boardId": "board-…",
  "commands": [
    {
      "commandId": "cmd-…",
      "action": { "type": "DELETE_CARD", "cardId": "card-…" },
      "ifMatch": 42,
      "ifMatchVersions": { "card:card-…": 7 }
    }
  ]
}
```

Для lifecycle-действий, которые не являются `BoardAction`, план содержит
`operations` вместо `commands` (ровно одна операция в MVP):

```json
{
  "schemaVersion": 1,
  "boardId": "board-…",
  "operations": [
    {
      "op": "share.create",
      "target": { "boardId": "board-…" },
      "body": { "mode": "live", "includeComments": false }
    }
  ]
}
```

Whitelist: `board.delete`, `member.invite`, `member.update`,
`member.remove`, `share.create`, `share.update`, `share.revoke`,
`share.delete`, `attachment.delete`. `commands` и `operations` взаимоисключающие.
Отображение policy keys и lifecycle operations:

| Policy key | Operation | Endpoint |
| --- | --- | --- |
| `delete_board` | `board.delete` | `DELETE /boards/:id` |
| `attachment.delete` | `attachment.delete` | `DELETE /attachments/:id` (чужой upload) |
| `member.invite` / `member.update` / `member.remove` | те же | `/boards/:id/members...` |
| `share.create` / `share.update` / `share.revoke` | те же | `/boards/:id/shares...` |
| `share.delete` | `share.delete` | `DELETE /boards/:id/shares/:shareId/permanent` |

`delete_board` — историческое имя policy-key для `BoardAction`-стиля; на
проводе operation называется `board.delete`. `attachment.delete` и
`delete_board` входят в default `requireApprovalFor`; даже при удалении
ключа из policy destructive-режим всё равно требует approval, потому что
`destructive: "approval"` — базовый gate.

`planHash = sha256(utf8(canonicalJson({ schemaVersion, boardId, commands, operations })))`,
где `canonicalJson` рекурсивно сортирует ключи объектов, сохраняет порядок
массивов, не содержит пробелов и **опускает отсутствующие** `commands`/
`operations` (валиден ровно один из них). `summary`/`risk`/`expiresAt` в
hash не входят. `planHash` считает сервер и возвращает клиенту; клиентский
hash не принимается как истина.

`action.at` **исключается** из плана и `planHash` — как в существующем
`actionFingerprint` (`commands.service`). `at` — серверные часы, а не часть
намерения; при apply сервер ставит/клэмпит `at` сам. Поэтому план не
протухает из-за 5-минутного `COMMAND_AT_MAX_SKEW_MS`, а повтор с тем же
`commandId` остаётся идемпотентным. `commandId` и остальные поля action
входят в hash без изменений.

### 6.8. `Command` и `CommandPreimage`

```prisma
model Command {
  // ...существующие поля без изменений...
  apiTokenId     String?
  agentSessionId String?
  runId          String?
  agentName      String? // snapshot ApiToken.name на момент записи

  @@index([apiTokenId, createdAt])
  @@index([agentSessionId, createdAt])
  @@index([runId])
}

model CommandPreimage {
  commandId String   @id
  boardId   String
  runId     String?
  data      Json
  createdAt DateTime @default(now())

  @@index([boardId, runId])
  @@index([createdAt])
}
```

`CommandPreimage.data`:

```json
{
  "schemaVersion": 1,
  "boardVersion": 42,
  "entities": [
    {
      "touch": "card:card-…",
      "id": "card-…",
      "exists": true,
      "version": 7,
      "snapshot": { "...": "полная сущность до команды" },
      "postVersion": 8,
      "postDeletedAt": null
    }
  ]
}
```

- Для `ADD_*`/`DUPLICATE_*` создаваемая сущность записывается с
  `exists: false`; inverse — удалить созданный id.
- Для `DELETE_CARD`, `DELETE_COLUMN`, `ARCHIVE_COLUMN_CARDS`,
  `DELETE_LABEL`, `DELETE_CHECKLIST`, `DELETE_CHECKLIST_ITEM` snapshot
  включает вложенные сущности (колонка + карточки, label + assignments,
  checklist + items), достаточные для точного restore.
- Preimage пишется для **каждой** команды, входящей в `AgentRun`; для
  одиночных неразрушающих команд вне run preimage не пишется.
- Retention preimage = retention `Command`; sweep удаляет preimage раньше
  или вместе с командой.

### 6.9. `Activity`

```prisma
model Activity {
  // ...существующие поля без изменений...
  apiTokenId     String?
  agentSessionId String?
  runId          String?
  agentName      String?

  @@index([apiTokenId, createdAt])
  @@index([agentSessionId, createdAt])
  @@index([runId])
}
```

Новые `Activity.type`:

- `approval_requested`, `approval_approved`, `approval_rejected`,
  `approval_cancelled`, `approval_expired`, `approval_consumed`;
- `agent_session_started`, `agent_session_ended`, `agent_session_paused`,
  `agent_session_resumed`;
- `agents_paused`, `agents_resumed`, `agent_policy_changed`;
- `run_reverted`.

Существующие `member_*`, `comment_*`, `attachment_deleted` не меняются.
`Activity` остаётся board-scoped; account-level события идут в
`SecurityAuditLog`.

`GET /boards/:id/activity` и `GET /cards/:id/activity` получают фильтры
`actorType`, `apiTokenId`, `agentSessionId`, `runId`, `type`, `from`, `to`;
`GET /boards/:id/commands` — `runId`/`apiTokenId` для аудита. Это контракт
166.1/166.7 для Watch/Audit UI (166.13/166.15).

Комментарии живут вне командного лога, поэтому attribution хранится в самой
строке:

```prisma
model Comment {
  // ...существующие поля без изменений...
  actorType      String  @default("human") // human|agent
  apiTokenId     String?
  agentSessionId String?
  agentName      String?

  @@index([apiTokenId, createdAt])
  @@index([agentSessionId, createdAt])
}
```

Старые комментарии получают `actorType = "human"`; token/session остаются
`NULL`. Это позволяет `CommentDto` показывать агента, а не только email
владельца.

### 6.10. `SecurityAuditLog`

```prisma
model SecurityAuditLog {
  id             String   @id @default(cuid())
  userId         String
  actorId        String
  actorType      String   @default("human") // human|agent|admin
  apiTokenId     String?
  agentSessionId String?
  action         String
  targetType     String?
  targetId       String?
  details        Json?
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

Минимальные события:

- `token.created`, `token.revoked`, `token.paused`, `token.resumed`;
- `agents.paused_all`, `agents.resumed_all`;
- `board.deleted`, `board.restored`;
- `account.exported`, `account.delete_scheduled`, `account.deleted`;
- `run.reverted`, `approval.decided` (дублируется в `Activity` для доски).

`details` хранит snapshots `{ name, boardTitle, scopePreset, trustedCi }`, но
никогда не хранит plaintext токена, hash токена или пароль.

`BoardShareAuditLog` получает nullable `apiTokenId`, `agentSessionId`,
`agentName` (старые строки — `NULL`), чтобы share-аудит различал два PAT
одного аккаунта.

### 6.11. `IdempotencyRecord`

```prisma
model IdempotencyRecord {
  id             String   @id @default(cuid())
  scope          String // create_board|import_boards|create_share|upload_attachment|<operation>
  actorKey       String   // "user:<id>" или "token:<id>"
  key            String
  requestHash    String
  status         String   @default("in_progress") // in_progress|completed
  responseStatus Int?
  responseBody   Json?
  resourceId     String?
  createdAt      DateTime @default(now())
  expiresAt      DateTime

  @@unique([scope, actorKey, key])
  @@index([expiresAt])
}
```

TTL 24 часа. Повтор с тем же `scope + actorKey + key` и тем же
`requestHash` возвращает сохранённый status/body; другое тело —
`409 idempotency_conflict`; пока первая запись `in_progress` —
`409 idempotency_in_progress` (`retryable: true`).

### 6.12. DTO, заголовки и SSE

| Контракт | Добавить |
| --- | --- |
| `CommandDeltaEntry`, `CommandSseEvent` | `apiTokenId?`, `agentSessionId?`, `runId?`, `agentName?` |
| `ActivityFeedEntry`, `ActivitySseEvent` | `apiTokenId?`, `agentSessionId?`, `runId?`, `agentName?`; `ActivitySseEvent.actorType` |
| `CommentDto` | `actorType`, `apiTokenId?`, `agentSessionId?`, `agentName?` |
| `AttachmentDto` | `uploadedByTokenId?`, `uploadedBySessionId?` (author attribution; blob DTO fields не меняются) |
| `UserTokenDto` | `scopePreset`, `trustedCi`, `individualPausedAt`, `individualPausedBy`, `individualPausedReason`, `stopAllPausedAt`, `stopAllPausedBy`, `paused`, `effectiveTokenScope` |
| `CreateUserTokenRequest` | `scopePreset?`, `trustedCi?` |
| `Board` | `agentPolicy?`, `agentPolicyVersion?`, `agentsPausedAt?`, `agentsPausedBy?`, `agentsPauseReason?` (pause — только UI, не export) |
| `Card` | `claimedByTokenId?`, `claimedBySessionId?` |
| `CommandBatchRequest` | `clientRunId?` |
| `CommandBatchResponse` | `runId?` (`string`/`null`), см. DTO ниже |
| `CommandResponse` | `runId?`, `approvalId?` (`string`/`null`) |
| `BoardSseEvent` | `ApprovalSseEvent`, `AgentSseEvent` |

Минимальные response-контракты:

```ts
type AgentSessionStatus =
  | "active"
  | "idle"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

interface AgentSessionDto {
  id: string;
  userId: string;
  apiTokenId: string;
  boardId: string;
  name: string | null;
  clientName: string | null;
  model: string | null;
  status: AgentSessionStatus;
  currentCardId: string | null;
  currentRunId: string | null;
  startedAt: number;
  lastHeartbeatAt: number;
  stale: boolean;
  paused: boolean;
  pausedAt: number | null;
  pausedBy: string | null;
  pausedReason: string | null;
  pauseScope: "board" | "token" | "session" | null;
  endedAt: number | null;
  endReason: string | null;
  summary: string | null;
}

type AgentRunStatus = "applied" | "reverted" | "failed";

interface AgentRunDto {
  id: string;
  boardId: string;
  apiTokenId: string | null;
  agentSessionId: string | null;
  actorId: string;
  kind: "batch" | "plan" | "single" | "revert";
  status: AgentRunStatus;
  clientRunId: string | null;
  planHash: string | null;
  approvalId: string | null;
  commandCount: number;
  firstSeq: number | null;
  lastSeq: number | null;
  revertsRunId: string | null;
  createdAt: number;
  appliedAt: number;
  revertedAt: number | null;
}

interface ApprovalRequestDto {
  id: string;
  boardId: string;
  cardId: string | null;
  requestedBy: string;
  requestedByTokenId: string;
  agentSessionId: string | null;
  kind: "destructive" | "done" | "custom";
  actionType: string;
  summary: string;
  risk: "low" | "medium" | "high";
  planHash: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "consumed";
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionComment: string | null;
  runId: string | null;
  consumedAt: number | null;
  createdAt: number;
  plan?: Record<string, unknown>; // только ADMIN detail
}

interface BoardAgentPolicyDto {
  schemaVersion: 1;
  destructive: "approval" | "deny";
  requireApprovalFor: string[];
  approverRoles: ["ADMIN"];
  maxCommandsPerRun: number;
  maxCardsPerRun: number;
  approvalTtlMinutes: number;
}

interface BoardPolicyResponse {
  policy: BoardAgentPolicyDto;
  version: number;
}

type RunSummaryDto = AgentRunDto; // GET /runs: без commands/preimages

interface RunDetailDto {
  run: AgentRunDto;
  commands: CommandDeltaEntry[];
  preimages: Record<string, unknown>; // только board ADMIN
}

interface RevertConflictDto {
  touch: string;
  expectedVersion: number;
  currentVersion: number;
  reason: string;
}

interface RevertPreviewDto {
  dryRun: true;
  run: RunSummaryDto;
  conflicts: RevertConflictDto[];
  canRevert: boolean;
  diff?: Record<string, unknown>; // только board ADMIN
}

interface CommandBatchResponse {
  runId?: string | null;
  results: CommandResponse[];
}

interface CommandResponse {
  seq: number;
  versions: EntityVersions;
  runId?: string | null;
  approvalId?: string | null;
}
```

Новые SSE-события:

```ts
type ApprovalSseEvent = {
  type: "approval";
  approvalId: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "consumed";
  cardId?: string;
  at: number;
};

type AgentSseEvent = {
  type: "agent";
  op: "started" | "paused" | "resumed" | "ended";
  sessionId?: string;
  scope?: "board" | "token" | "session";
  at: number;
};
```

Заголовки:

| Header | Где | Смысл |
| --- | --- | --- |
| `X-Agent-Session` | write-запросы PAT | id сессии; проверяется ownership/board |
| `X-Approval-Id` | commands/batch/plans/apply/lifecycle REST | id approval для точного плана |
| `Idempotency-Key` | create board/import/share/upload | REST-идемпотентность, 24 ч |
| `X-Request-Id` | все ответы | correlation id (уже есть) |
| `X-RateLimit-*`, `Retry-After` | все ответы/429 | 166.10 |
| `X-Board-Seq`, `X-Delta-Resync` | board read/delta | уже есть |

SSE `?session=<sessionId>` — optional; используется для session pause
(§9.3). `?presence=0` остаётся.

### 6.13. Миграция и обратное заполнение

Одна миграция, один schema owner — поток **166.1** (см. §14.1). Порядок:

1. Добавить `ApiToken.scopePreset` как **nullable** (без default), чтобы
   default `worker` не затронул существующие строки.
2. `UPDATE "ApiToken" SET "scopePreset" = 'admin' WHERE "scopePreset" IS NULL;`
3. Добавить `trustedCi Boolean NOT NULL DEFAULT false`;
   `UPDATE "ApiToken" SET "trustedCi" = true WHERE "readOnly" = false;`
4. Поставить `scopePreset` `NOT NULL DEFAULT 'worker'`.
5. Добавить все token pause-поля:
   `ApiToken.individualPausedAt`, `individualPausedBy`,
   `individualPausedReason`, `stopAllPausedAt`, `stopAllPausedBy`
   и индексы `[userId, individualPausedAt]`, `[userId, stopAllPausedAt]`.
6. Добавить nullable-поля `Board`, `Card`, `Command`, `Activity`:
   - `Board.agentPolicy`, `Board.agentPolicyVersion`,
     `Board.agentsPausedAt/By/Reason`;
   - `Card.claimedByTokenId/SessionId`;
   - `Command`/`Activity` attribution (`apiTokenId`, `agentSessionId`,
     `runId`, `agentName`).
7. Добавить `Comment.actorType` (`NOT NULL DEFAULT 'human'`),
   `Comment.apiTokenId`, `agentSessionId`, `agentName` и индексы
   `[apiTokenId, createdAt]`, `[agentSessionId, createdAt]`.
8. Добавить `Attachment.uploadedByTokenId`, `uploadedBySessionId` и индексы
   `[uploadedByTokenId]`, `[uploadedBySessionId]`.
9. Добавить attribution-поля `BoardShareAuditLog`.
10. Создать новые таблицы и индексы.
11. Не переименовывать и не удалять существующие поля.
12. На больших `Command`/`Activity` индексы создавать отдельным
    операторским шагом `CREATE INDEX CONCURRENTLY`, если миграция иначе
    держит таблицу; в обычной self-host установке допустима одна миграция.

Обратное заполнение:

- `Command`/`Activity`: новые поля остаются `NULL`; UI трактует `NULL` как
  «legacy/unknown», `actorType` уже есть.
- `Card`: `claimedByTokenId`/`claimedBySessionId` остаются `NULL`; claim
  продолжает работать по legacy `claimedBy` до истечения lease.
- `ApiToken`: `individualPausedAt`/`stopAllPausedAt` = `NULL`;
  pause-поля не заполняются задним числом.
- `Board`: `agentPolicy = NULL`, `agentPolicyVersion = 1`,
  `agentsPausedAt = NULL`.
- `AgentSession`, `AgentRun`, `ApprovalRequest`, `CommandPreimage`,
  `SecurityAuditLog`, `IdempotencyRecord` — пустые.
- `Board.version` не трогаем; `agentPolicyVersion` отдельный.

### 6.14. Очистка и порядок purge

- `sweepCommands`: сначала `CommandPreimage` по `createdAt < cutoff`, затем
  `Command`.
- `sweepRuns`: `AgentRun` старше cutoff, у которых нет команд; исходные
  `reverted` run удаляются вместе с revert-run по тому же cutoff.
- `sweepAgentSessions`: завершённые/просроченные сессии старше cutoff.
- `sweepApprovals`: `rejected|expired|cancelled|consumed` старше cutoff;
  `pending` и `approved` **не** удаляются по возрасту, только по expiry.
- `sweepSecurityAudit`: `SecurityAuditLog` старше cutoff.
- `sweepIdempotency`: `expiresAt < now`.
- Purge доски/пользователя вызывает те же sweep-функции; ordering:
  preimages → commands → runs → sessions → approvals → board rows.

---

## 7. Матрица действий

Легенда:

- **Preset** — минимальный эффективный scope (роль на доске применяется
  отдельно).
- **Destructive** — требуется destructive gate.
- **Approval** — что происходит без `trustedCi`, если board policy не
  запрещает жёстко.
- **Legacy PAT** — поведение старого токена (`admin` + `trustedCi`, кроме
  `readOnly`).

### 7.1. `BoardAction` (REST `/commands`, `/commands/batch`, `/plans/apply`)

| Действия | Preset | Destructive | Approval | Legacy PAT |
| --- | --- | --- | --- | --- |
| `ADD_CARD`, `UPDATE_CARD`, `TOUCH_CARD`, `MOVE_CARD`, `ARCHIVE_CARD`, `UNARCHIVE_CARD`, `DUPLICATE_CARD`, `SET_CARD_DUE_DATE`, `SET_CARD_PRIORITY`, `SET_CARD_ASSIGN`, `SET_CARD_TASK_SPEC`, `SET_CARD_LABEL`, `SET_CARD_COVER`, `CLAIM_CARD`, `ADD_CARD_LINK`, `REMOVE_CARD_LINK` | `worker` | нет | нет | как раньше |
| `MOVE_CARD` или `UNARCHIVE_CARD` в `doneColumnIds` | `reviewer` | нет | только если policy содержит `move_to_done` | как раньше |
| `ADD_COLUMN`, `RENAME_COLUMN`, `MOVE_COLUMN`, `SORT_COLUMN`, `SET_COLUMN_CARD_ORDER`, `SET_COLUMN_WIP_LIMIT`, `SET_COLUMN_ACCENT`, `DUPLICATE_COLUMN`, `RENAME_BOARD`, `SET_BOARD_COLUMN_STYLE` | `worker` | нет | нет | как раньше |
| `ADD_LABEL`, `RENAME_LABEL`, `SET_LABEL_COLOR`, `ADD_CHECKLIST`, `RENAME_CHECKLIST`, `ADD_CHECKLIST_ITEM`, `SET_CHECKLIST_ITEM_DONE`, `RENAME_CHECKLIST_ITEM` | `worker` | нет | нет | как раньше |
| `DELETE_CARD` | `worker` | да | `approval` | bypass approval |
| `DELETE_COLUMN` | `worker` | да | `approval` | bypass approval |
| `ARCHIVE_COLUMN_CARDS` | `worker` | да | `approval` | bypass approval |
| `DELETE_LABEL` | `worker` | да | `approval` | bypass approval |
| `DELETE_CHECKLIST`, `DELETE_CHECKLIST_ITEM` | `worker` | да | `approval` | bypass approval |
| `SET_BOARD_WORKFLOW` | `admin` | нет (конфиг) | `approval` по default policy (`workflow.update`); человек-ADMIN может убрать пункт из policy | как раньше |
| `ARCHIVE_BOARD`, `UNARCHIVE_BOARD` | `admin` | нет (обратимо) | нет | как раньше |
| `RESTORE_CARD`, `RESTORE_COLUMN`, `RESTORE_COLUMN_CARDS`, `RESTORE_LABEL`, `RESTORE_CHECKLIST`, `RESTORE_CHECKLIST_ITEM` | browser JWT с ролью, которая могла выполнить исходную команду (`ADMIN`/`MEMBER`); серверный run-revert | нет | нет | любой PAT → `scope_denied` (undo не делегируется) |
| `RESTORE_BOARD` (aggregate-level/local snapshot) | не команда `/commands` | — | — | не принимается ни JWT, ни PAT; browser использует refetch/local rollback |

Примечания:

- `REMOVE_CARD_LINK` — редактирование связи, не destructive: ссылку можно
  добавить заново; MCP annotation меняется с `DESTRUCTIVE` на `WRITE`.
- `ARCHIVE_CARD`/`UNARCHIVE_CARD` не destructive: карточка остаётся,
  восстанавливается штатно. `UNARCHIVE_CARD` в done-колонку подчиняется
  тому же `reviewer`/`move_to_done` gate, что и `MOVE_CARD`; иначе это
  обход review.
- `ADD_CARD`/`DUPLICATE_CARD`, создающие карточку сразу в done-колонке,
  тоже считаются done-переходом и требуют `reviewer` (+ approval, если
  policy содержит `move_to_done`).
- `RESTORE_*` — это browser undo, а не agent undo: browser JWT с ролью
  `ADMIN`/`MEMBER` может отправить inverse-команду через `/commands`, как и
  раньше; VIEWER — нет, любой PAT — `scope_denied`. Серверный run-revert
  выполняет inverse от имени человека-ADMIN.
- `RESTORE_BOARD` существует в reducer, но `commands.service` относит его к
  aggregate-level и **не принимает** через `/commands`; это локальный
  snapshot/refetch, не серверная команда. Browser undo board-level действий
  использует их собственные inverse-команды (`UNARCHIVE_BOARD` и т. п.).
- Регрессионный тест: MEMBER удаляет карточку/колонку/метку/чек-лист →
  browser undo отправляет соответствующий `RESTORE_*` → 200; тот же вызов
  с PAT → 403 `scope_denied`; VIEWER → 403.
- Любая команда в batch/plan проверяется по этой таблице; если хотя бы
  одна destructive — approval требуется на весь batch/plan, частичного
  применения нет.

### 7.2. REST endpoints

Новые в TASK-166 маршруты: `/agent-sessions`, `/agents/*`,
`/boards/:id/agents/*`, `/users/me/tokens/:id/pause|resume`, `/approvals`,
`/plans`, `/runs`, `/agent-policy`, `/users/me/export`, `/users/me/delete/request-code`,
`DELETE /users/me`.
Остальные строки описывают существующие контроллеры и их будущие проверки;
ни один новый маршрут не считается уже отгруженным.

| Endpoint / группа | Preset | Destructive | Approval | Legacy PAT |
| --- | --- | --- | --- | --- |
| `GET /boards`, `GET /boards/:id`, `GET /boards/:id/search`, `GET /boards/:id/export`, `GET /boards/:id/commands`, `GET /boards/:id/events`, `GET /boards/:id/activity`, `GET /cards/:id/activity`, `GET /cards/:id/comments`, `GET /cards/:id/attachments`, `GET /attachments/:id/content` | `observer` | нет | нет | как раньше |
| `GET /boards/:id/members` | `observer` | нет | нет | как раньше |
| `GET /auth/me`, `GET /users/:userId/avatar` | any authenticated PAT (identity/avatar read) | нет | нет | как раньше, включая `janosik_whoami` |
| `GET /boards/:id/invitations` | `admin` | нет | нет | как раньше |
| `GET /boards/:id/shares` | `admin` | нет | нет | как раньше |
| `POST /boards/:id/commands` | `worker` | по действию | по действию | как раньше |
| `POST /boards/:id/commands/batch` | `worker` | по действию | approval на весь batch | как раньше |
| `POST /boards/:id/plans`, `POST /boards/:id/plans/apply` | `worker` | по действию | approval на весь plan | как раньше |
| `POST /boards` | `admin` + account-wide token | нет | нет | как раньше; board-scoped → `scope_denied` |
| `POST /boards/import` (+ `?dryRun=1`) | `admin` + account-wide token | нет | нет | как раньше |
| `DELETE /boards/:id` | `admin` | да | `approval` | bypass approval |
| `POST /boards/:id/members` (invite) | `admin` | sensitive | `approval` | bypass approval |
| `PATCH /boards/:id/members/:userId` | `admin` | sensitive | `approval` | bypass approval |
| `DELETE /boards/:id/members/:userId` | `admin` | да | `approval` | bypass approval |
| `POST /boards/:id/shares`, `PATCH /boards/:id/shares/:shareId` | `admin` | sensitive (exposure) | `approval` | bypass approval |
| `POST /boards/:id/shares/:shareId/refresh` | `admin` | нет | нет | как раньше |
| `DELETE /boards/:id/shares/:shareId`, `DELETE .../permanent` | `admin` | да | `approval` | bypass approval |
| `POST /cards/:id/comments` | `worker` | нет | нет | как раньше |
| `DELETE /comments/:id` | `worker` (только свой комментарий) | да, но self-authored exempt | нет для своего; чужой — `scope_denied` | как раньше; PAT по-прежнему только автор |
| `POST /cards/:id/attachments`, `?inline=1` | `worker` | нет | нет | как раньше |
| `DELETE /attachments/:id` | `worker` (свой upload) / `admin` (чужой) | да | нет для своего; чужой — `approval` | как раньше |
| `POST /users/me/tokens`, `GET /users/me/tokens`, `DELETE /users/me/tokens/:id` | session-only | — | — | `pat_forbidden` (security fix) |
| `POST /users/me/tokens/:id/pause`, `/resume` | session-only | — | — | `pat_forbidden` |
| `PATCH /users/me`, `PATCH /users/me/avatar` | session-only | — | — | `pat_forbidden` |
| `GET /invitations`, `POST /invitations/:id/accept`, `/decline` | session-only | — | — | `pat_forbidden` (security fix) |
| `POST /users/me/export`, `GET /users/me/export/:id`, `GET /users/me/export/:id/download` | session-only | — | — | `pat_forbidden` |
| `POST /users/me/delete/request-code` | session-only | — | OAuth proof; email code | `pat_forbidden` |
| `DELETE /users/me` | session-only | да (аккаунт) | пароль или OAuth re-auth + `emailCode`; не approval | `pat_forbidden` |
| `POST /boards/:id/agent-sessions`, `.../:sessionId/heartbeat`, `.../:sessionId/end` | `observer`+ (control-plane) | нет | нет | legacy может не использовать |
| `GET /boards/:id/agent-sessions`, `GET /boards/:id/agent-sessions/:id` | `observer` | нет | нет | как раньше |
| `POST /boards/:id/agent-sessions/:id/pause`, `/resume` | session-only board ADMIN | нет | — | `pat_forbidden` |
| `POST /boards/:id/agents/pause`, `/resume` | session-only board ADMIN | нет | — | `pat_forbidden` |
| `POST /agents/pause-all`, `POST /agents/resume-all` | session-only owner | нет | — | `pat_forbidden` |
| `POST /boards/:id/approvals` | preset планируемого действия (`worker` для destructive, `reviewer` для done, `admin` для member/share/board) | control-plane | нет | legacy trustedCi: approval не требуется, endpoint доступен |
| `GET /boards/:id/approvals`, `GET .../:approvalId` | `admin` или requester `apiTokenId` | нет | нет | как раньше для requester token |
| `POST /boards/:id/approvals/:id/decision` | session-only board ADMIN | — | — | `pat_forbidden` |
| `POST /boards/:id/approvals/:id/cancel` | requester `apiTokenId` или session-only board ADMIN | нет | — | как раньше для requester token |
| `GET /boards/:id/runs` | `observer` — summary без pre-image | нет | нет | как раньше |
| `GET /boards/:id/runs/:runId` | board ADMIN JWT — full detail + pre-image; observer — только summary/attribution | нет | нет | как раньше для summary; PAT full detail → `scope_denied` |
| `POST /boards/:id/runs/:runId/revert` (`dryRun: true`) | observer — conflict summary без snapshot; board ADMIN — полный diff/pre-image | нет | нет | как раньше для summary |
| `POST /boards/:id/runs/:runId/revert` (`dryRun: false`) | session-only board ADMIN | да (откат) | — | `pat_forbidden` |
| `PATCH /boards/:id/agent-policy` | session-only board ADMIN | нет | — | `pat_forbidden` |
| `GET /share/:token`, `GET /share/:token/*` | public share token | — | — | PAT не участвует |
| `/admin/*` | master session | — | — | вне TASK-166 |

Для строк с `approval` REST-вызов повторяется с заголовком
`X-Approval-Id: <approvalId>`; без него сервер создаёт approval и отвечает
`409 approval_required`. Это относится и к lifecycle-операциям
(`board.delete`, `member.*`, `share.*`, `attachment.delete`).

«Свой» комментарий/вложение: для PAT — совпадение `apiTokenId`/
`uploadedByTokenId`; для browser JWT — совпадение `userId`; legacy-строка с
`NULL` — fallback на `userId`. Два PAT одного владельца не удаляют контент
друг друга.

### 7.3. MCP tools

Существующие tools сохраняют имена, кроме перечисленных удалений. В таблице
имена без префикса `janosik_`; полный tool id = `janosik_` + имя. Таблица
покрывает **все** toolsets текущего MCP: boards (включая
`janosik_rename_board` и `janosik_export_board`), columns, cards, labels,
checklists, links, comments, activity, attachments (включая
`janosik_upload_attachment`), members, invitations (удаляется), shares,
account (`whoami`).

| Группа / tools | Preset | Destructive | Approval | Legacy PAT |
| --- | --- | --- | --- | --- |
| Чтение: `list_boards`, `get_board`, `get_card`, `search_cards`, `list_ready_cards`, `wait_for_work`, `list_labels`, `list_comments`, `list_members`, `list_attachments`, `download_attachment`, `board_activity`, `card_activity`, `get_workflow`, `export_board`, `whoami` | `observer` | нет | нет | как раньше; `export_board.outputPath` — локальная запись только при включённом FS |
| `list_shares` | `admin` | нет | нет | как раньше |
| Контент: `create_card`, `update_card`, `move_card`, `archive_card`, `unarchive_card`, `duplicate_card`, `set_card_priority`, `set_card_assignee`, `set_card_due_date`, `set_card_cover`, `set_card_label`, `set_card_task_spec`, `claim_card`, `release_card`, `create_column`, `rename_column`, `move_column`, `sort_column`, `duplicate_column`, `set_column_wip_limit`, `set_column_accent`, `create_label`, `rename_label`, `set_label_color`, `add_checklist`, `rename_checklist`, `add_checklist_item`, `set_checklist_item_done`, `rename_checklist_item`, `add_card_link`, `remove_card_link`, `add_comment`, `rename_board`, `upload_attachment` | `worker` | нет | нет | как раньше |
| `move_card` в done | `reviewer` | нет | `move_to_done` policy | как раньше |
| `delete_card`, `clear_column`, `delete_column`, `delete_label`, `delete_checklist`, `delete_checklist_item` | `worker` | да | `approval` | bypass approval |
| `delete_board` | `admin` | да | `approval` | bypass approval |
| `delete_comment` (свой), `delete_attachment` (свой upload) | `worker` | да, self-authored exempt | нет для своего | как раньше |
| `delete_attachment` (чужой) | `admin` | да | `approval` | bypass approval |
| `create_share`, `update_share`, `revoke_share` | `admin` | sensitive/destructive | `approval` | bypass approval |
| `refresh_share` | `admin` | нет | нет | как раньше |
| `archive_board`, `unarchive_board` | `admin` | нет | нет | как раньше |
| `create_board`, `import_board` | `admin` + account-wide | нет | нет | как раньше |
| `invite_member`, `update_member`, `remove_member` | `admin` | sensitive/destructive | `approval` | bypass approval |
| `update_profile`, `list_invitations`, `accept_invitation`, `decline_invitation` | — | — | — | **удалены из MCP**: PAT не имеет account-маршрутов |
| Новые: `start_session`, `heartbeat`, `end_session` | `observer`+ | нет | нет | — |
| Новые: `request_approval`, `get_approval`, `wait_for_decision`, `cancel_approval` | preset планируемого действия | control-plane | нет | — |
| Новые: `plan_changes`, `apply_plan` | `worker` | по плану | по плану | — |
| Новые: `list_runs`, `get_run`, `preview_run_revert` | `observer` | нет | нет | — |

Обязательные новые tools:

- `janosik_start_session`, `janosik_heartbeat`, `janosik_end_session`;
- `janosik_request_approval`, `janosik_get_approval`,
  `janosik_wait_for_decision`, `janosik_cancel_approval`;
  `wait_for_decision` — повторяемый poll до 60 с на вызов, общий дедлайн —
  `expiresAt` approval;
- `janosik_plan_changes`, `janosik_apply_plan`;
- `janosik_list_runs`, `janosik_get_run`, `janosik_preview_run_revert`.

Мутирующие tools, которым нужен approval, принимают optional `approvalId` и
передают его как `X-Approval-Id`; tools с идемпотентностью принимают
`idempotencyKey`/`commandId`. Это часть write-контракта 166.4. Для
`delete_comment`/`delete_attachment` «свой» считается по `apiTokenId`
(`uploadedByTokenId`), а не по user id; legacy-строка без token id —
fallback на user id.

`janosik_whoami` возвращает:

```json
{
  "user": { "id": "…", "email": "…", "displayName": "…" },
  "token": {
    "id": "…",
    "name": "…",
    "scopePreset": "worker",
    "trustedCi": false,
    "effectiveTokenScope": "worker",
    "boardId": null,
    "readOnly": false,
    "rateLimitPerMinute": null,
    "individualPausedAt": null,
    "stopAllPausedAt": null,
    "paused": false
  },
  "session": null,
  "server": { "version": "…", "apiVersion": "1" }
}
```

Новые toolsets: `sessions`, `approvals`, `plans`, `runs` — входят в default
набор MCP. `members` и `shares` остаются opt-in; `invitations` удаляется;
`account` содержит только `whoami` (profile-инструмент удалён). Точное число
tools не фиксируется в 166.0: 166.11 обновляет pinned-тест после мержа всех
tools; до этого тест фиксирует список toolsets, а не одно число.

### 7.4. Batch, plan, import, share, undo/restore, вложения, комментарии

- **Batch.** Все команды одной доски, all-or-nothing; лимит
  `min(100, policy.maxCommandsPerRun)`, создание карточек —
  `min(50, policy.maxCardsPerRun)`. Если есть destructive — approval на
  весь batch; `approvalId` передаётся заголовком `X-Approval-Id`. Ответ
  содержит `runId` и результаты в порядке команд.
- **Plan/apply.** `POST /plans` — dry-run: тот же validator, diff, warnings,
  конфликты, `planHash`; ничего не пишет и не создаёт `run`.
  `POST /plans/apply` — та же атомарная семантика batch, но обязателен
  `planHash`; план с изменённым hash → `approval_mismatch`. 50 карточек =
  до 100 команд (create + update), это верхняя граница одного plan.
  `/plans` работает только с `commands`; lifecycle-операции
  (`board.delete`, `member.*`, `share.*`, `attachment.delete`) идут через
  `POST /approvals` + исходный REST-маршрут, а не через `/plans`. План
  больше 100 команд — `409 limit_exceeded`; клиент делит работу на
  несколько plan/run, атомарность между чанками не обещается.
- **Import.** `POST /boards/import` — account-wide `admin`; `?dryRun=1`
  валидирует файл и возвращает количество досок/карточек и конфликты без
  записи. Импорт не является run. Лимит досок — `MAX_BOARDS_PER_USER`
  (0 = без лимита); local mode — 10.
- **Share.** Создание/изменение share — `admin` + approval, потому что это
  публикация доски. `refresh` снимка не меняет доступ и approval не требует.
  Revoke/permanent delete — destructive + approval.
- **Undo/restore.** Browser undo не меняется: JWT роли ADMIN/MEMBER
  отправляет inverse-команды (`RESTORE_*`) через `/commands`, как сегодня.
  Агент не вызывает `RESTORE_*`; он делает компенсирующие неразрушающие
  команды или просит человека откатить run. Любой PAT → `scope_denied`;
  серверный run-revert выполняет inverse от имени человека-ADMIN.
  `RESTORE_BOARD` — aggregate-level/local snapshot, `/commands` его не
  принимает.
- **Вложения.** Upload — `worker`, лимиты 20/25 MB не меняются. Delete:
  свой upload — `worker` без approval; чужой — `admin` + approval.
  «Свой» для PAT = совпадение `uploadedByTokenId`; для browser JWT = тот же
  `userId`; legacy-строка с `NULL` падает обратно на `userId`. Presigned/
  object storage не вводятся.
- **Комментарии.** Create — `worker`; `kind` сохраняется. Delete — только
  автор (существующее правило `comments.service`); «свой» для PAT =
  совпадение `Comment.apiTokenId`, иначе `scope_denied`; для browser JWT =
  тот же `userId`; legacy `NULL` — fallback на `userId`. Модерация чужих
  комментариев — вне TASK-166.
- **Идемпотентность.** `create_board`, `import_board`, `create_share`,
  `upload_attachment` принимают `Idempotency-Key` (MCP — optional
  `idempotencyKey`); `add_comment` принимает `commandId`;
  `duplicate_card`/остальные команды — `commandId`.
- **Токены/профиль/инвайты.** PAT не имеет доступа; только browser JWT.
  Это относится и к `trustedCi`, и к legacy PAT.
- **Board policy/pause.** Только browser JWT board ADMIN; агент не может
  ослабить политику или снять паузу.

---

## 8. Таксономия ошибок

### 8.1. Envelope

Все ошибки API (новые и изменённые в 166.4) возвращают:

```json
{
  "code": "scope_denied",
  "message": "English fallback, localizable by code",
  "retryable": false,
  "requestId": "…",
  "currentVersion": null,
  "details": {}
}
```

- `code` — стабильный машинный идентификатор, snake_case.
- `message` — английский fallback; UI/MCP локализуют по `code`.
- `retryable` — присутствует всегда. `true` означает: тот же запрос можно
  повторить без изменения после `Retry-After`/короткой паузы.
- `requestId` — тот же id, что в `X-Request-Id`; уже существует в
  `request-context`.
- `currentVersion` — текущая версия ресурса, который проверялся. Для
  команд это `currentSeq(boardId) = max(Command.seq)` (0 без команд), **не**
  `Board.version`; для policy CAS — `Board.agentPolicyVersion`; для
  `run_conflict` — состояние run. `details.versionOf` называет ресурс; иначе
  `null`. `Board.version` остаётся entity-версией для title/`ifMatchVersions`
  и с `ifMatch`/seq не смешивается.
- `details` — опциональный объект. Существующие top-level `field`,
  `conflict`, `workflow`, `retryAfter` **сохраняются** для совместимости.

### 8.2. Коды

| `code` | HTTP | `retryable` | Когда | Дополнительно |
| --- | --- | --- | --- | --- |
| `scope_denied` | 403 | false | preset/board-role не разрешает действие | `requiredScope`, `action` |
| `destructive_denied` | 403 | false | board policy `destructive: "deny"` | `reason: "board_policy"` |
| `agent_paused` | 403 | false | session/token/board pause | `pauseScope`, `pausedAt` |
| `agent_session_closed` | 403 | false | сессия завершена/отменена | `sessionId` |
| `agent_session_invalid` | 403 | false | сессия не принадлежит токену/доске | `sessionId` |
| `approval_required` | 409 | false | destructive без approval | `approvalId`, `planHash`, `expiresAt` |
| `approval_expired` | 409 | false | approval истёк до decision/apply | `approvalId`, `expiresAt` |
| `approval_mismatch` | 409 | false | planHash/plan не совпал | `approvalId`, expected/actual hash prefix |
| `approval_owner_mismatch` | 403 | false | approval выдан другому `apiTokenId`/session | `approvalId`, `requestedByTokenId` |
| `approval_not_pending` | 409 | false | decision по approved/rejected/cancelled/consumed | `approvalId`, `status` |
| `approval_rejected` | 409 | false | approval отклонён | `approvalId`, `decidedAt` |
| `approval_cancelled` | 409 | false | approval отменён | `approvalId` |
| `approval_consumed` | 409 | false | approval уже применён (consume) | `approvalId`, `runId` |
| `version_conflict` | 409 | false | `ifMatch`/`ifMatchVersions`/policy CAS | `conflict: "version"`, `currentVersion`, `field` |
| `id_conflict` | 409 | false | id принадлежит другой доске | `conflict: "id"`, `currentVersion` |
| `workflow_conflict` | 409 | false | workflow запретил переход | `conflict: "workflow"`, `workflow` (текущий формат) |
| `run_conflict` | 409 | false | `clientRunId`/run уже занят другим планом; run уже откачен; revert of revert | `runId`, `currentVersion` |
| `run_expired` | 409 | false | pre-images/run удалены retention | `runId`, `retentionDays` |
| `limit_exceeded` | 409 | false | WIP/collection/board/run limit | `conflict: "wip"` для WIP, `limit`, `current` |
| `idempotency_conflict` | 409 | false | тот же ключ, другое тело | `key` |
| `idempotency_in_progress` | 409 | true | первая запись ещё выполняется | `key`, `retryAfter` |
| `payload_too_large` | 413 | false | command/import/attachment body | `limit` |
| `rate_limited` | 429 | true | глобальный/per-token/per-agent лимит | `retryAfter`, `limit` |
| `board_write_timeout` | 503 | true | lock/transaction timeout | текущий код сохраняется |
| `not_found` | 404 | false | сущность/доска/approval/run не найдены | `resource` |
| `validation_failed` | 400 | false | class-validator/shape | `field`, `message` |

`limit_exceeded` — семантический лимит (WIP, доски, run). Слишком длинный
batch/DTO — `validation_failed` (400); слишком большое тело —
`payload_too_large` (413).

### 8.3. Совместимость с текущим контрактом

- Тело `409` с `conflict` ∈ `version`/`wip`/`id`/`workflow`,
  `currentVersion` и опциональным `workflow` остаётся. Добавляется `code`:
  `version_conflict` / `limit_exceeded` / `id_conflict` /
  `workflow_conflict`.
- `403 { code: "pat_read_only" }` остаётся для `readOnly`; preset-denial —
  `scope_denied`. `pat_forbidden` остаётся для account-маршрутов.
- `503 { code: "board_write_timeout" }` остаётся.
- `login_backoff` и `retryAfter` на auth-маршрутах не меняются.
- `workflow.code` (`transition_not_allowed`, `role_not_allowed`,
  `condition_failed`) не переименовывается.
- `field` в 400 остаётся.
- `requestId` дублирует `X-Request-Id`; заголовок уже существует.

### 8.4. Rate-limit headers

166.10 добавляет на все аутентифицированные ответы:

- `X-RateLimit-Limit` — потолок текущего bucket;
- `X-RateLimit-Remaining` — остаток;
- `X-RateLimit-Reset` — Unix-время сброса (секунды);
- `Retry-After` — секунды, обязателен на `429 rate_limited`.

Bucket определяется principal: user, token, IP для анонимных. Per-token
лимит и глобальный лимит применяются оба.

### 8.5. MCP

`describeError` и tool results обязаны показывать:

- `code`, `retryable`, `requestId`;
- `approvalId`/`expiresAt` для `approval_required`;
- `currentVersion` для `version_conflict`;
- следующий шаг: «wait for human», «re-read board», «request approval»,
  «stop — paused», «do not retry same destination».

MCP mutation results (166.4) возвращают `structuredContent`:

```json
{
  "ok": true,
  "resourceId": "card-…",
  "seq": 42,
  "runId": "run-…",
  "approvalId": null
}
```

Текстовый `content` остаётся для человека, но агент не обязан его парсить.
Ошибки MCP остаются `isError: true` с `structuredContent` и кодом.

---

## 9. Pause / kill

### 9.1. Уровни

| Уровень | Поле | Кто ставит | Область | Восстановление |
| --- | --- | --- | --- | --- |
| Session | `AgentSession.pausedAt` | browser JWT board ADMIN | одна сессия | resume |
| Token | `ApiToken.individualPausedAt` + `ApiToken.stopAllPausedAt` | browser JWT owner | все PAT-write + PAT-SSE; GET-чтение разрешено | resume |
| Board | `Board.agentsPausedAt` | browser JWT board ADMIN | все PAT на доске | resume |
| Kill | `ApiToken.revokedAt` | browser JWT owner | токен навсегда | новый токен |

Два независимых источника token pause:

- `individualPausedAt` — пауза конкретного токена через
  `POST /users/me/tokens/:id/pause`; снимается только его `/resume`;
- `stopAllPausedAt` — массовая пауза через `POST /agents/pause-all`;
  `resume-all` снимает только stop-all и не трогает individual.
  Токен остаётся на паузе, пока активен хотя бы один источник.

### 9.2. Что блокируется

- Любая запись контента, команда, batch/plan/apply, approval create,
  attachment upload/delete, comment create/delete, claim.
- Reads (GET) остаются разрешены. Открытие нового PAT-SSE запрещено при
  token/board pause. Session pause закрывает записи с этой сессией и SSE,
  если поток открыт с `?session=<sessionId>`; без session-параметра поток
  считается token-level и session pause его не закрывает.
- Исключения control-plane: `heartbeat`, `end_session`, `GET`-чтение
  собственной сессии. Они позволяют агенту корректно завершиться.
- `pause` не освобождает claim. `kill`/`end_session` освобождают claims,
  принадлежащие этой сессии/токену.

### 9.3. In-flight и SSE

- Запрос, который уже прошёл проверку и держит board lock, **завершается**
  и коммитится. Pause не делает rollback посередине.
- Проверка pause выполняется дважды: в guard/начале запроса и внутри
  board-write транзакции после advisory lock. Если pause закоммичен до
  второго чтения — запись отменяется; если после — in-flight завершается.
- SSE keep-alive 25 с. На следующем tick сервер отправляет (best effort)
  `{ type: "agent", op: "paused", scope, at }` и закрывает поток при
  token/board pause или при session pause, если поток открыт с
  `?session=<sessionId>`. Без session-параметра session pause блокирует
  только записи с этим `X-Agent-Session`. Человеческие SSE не закрываются.
- Reconnect во время активной паузы → `403 agent_paused`; после resume —
  обычный stream с `?since=`.
- Отклонённые записи не ставятся в очередь и не повторяются сервером.

### 9.4. API

- `POST /boards/:id/agent-sessions` — start; body `{name?, clientName?, model?}`;
  PAT; board-scoped; ответ `AgentSessionDto`.
- `POST /boards/:id/agent-sessions/:sessionId/heartbeat` — body
  `{status?, currentCardId?, summary?}`; только тот же `apiTokenId`, что у
  сессии; разрешён при pause.
- `POST /boards/:id/agent-sessions/:sessionId/end` — body
  `{status?:"completed"|"failed"|"cancelled", summary?}`; тот же
  `apiTokenId` или board ADMIN-человек; освобождает claims сессии.
- `GET /boards/:id/agent-sessions?active=1` — список; `stale` вычисляется.
- `POST /boards/:id/agent-sessions/:sessionId/pause|resume` — session-only
  board ADMIN; body `{reason?}`. Сокращение ROADMAP `/agents/:id/pause|resume`
  означает именно `agent-sessions/:sessionId`; отдельного account-level
  `/agents/:id` API нет.
- `POST /boards/:id/agents/pause|resume` — session-only board ADMIN;
  body `{reason?}`; пишет `agentsPausedAt/By/Reason` и Activity.
- `POST /users/me/tokens/:id/pause|resume` — session-only owner; ставит/
  снимает `individualPausedAt`; `resume-all` его не трогает.
- `POST /agents/pause-all|resume-all` — session-only owner; ставит/снимает
  `stopAllPausedAt` у всех неотозванных токенов, не меняя
  `individualPausedAt`.
- `DELETE /users/me/tokens/:id` — kill/revoke; сессии `cancelled`,
  claims с `claimedByTokenId` освобождаются, SSE закроется на следующем
  tick. Legacy claims без token id ждут lease.

### 9.5. Kill vs end session

- `end_session` — штатное завершение run-контекста; токен продолжает
  работать, новая сессия может стартовать.
- `revoke` — единственный настоящий kill: токен недействителен, все его
  сессии отменены. Отдельный `POST /agents/:id/kill` не вводится, чтобы не
  дублировать revoke с неясной семантикой.

---

## 10. Approval lifecycle

### 10.1. Состояния

```
pending ──approve──> approved ──apply──> consumed
   │                    │
   ├──reject──> rejected│
   ├──cancel──> cancelled
   └──expiresAt──> expired  (из pending или approved)
```

- `pending` — ждёт человека.
- `approved` — разрешён точный план; ещё не применён.
- `consumed` — план применён; `runId` заполнен.
- `rejected`/`cancelled`/`expired` — применять нельзя.
- Переходы атомарны через `updateMany where status=…`; повторный approve
  уже approved идемпотентен; конфликтующий decision получает
  `approval_not_pending`; `approval_consumed` — только после apply.

### 10.2. Создание

`POST /boards/:id/approvals` — только PAT (агент создаёт запрос; browser
JWT не создаёт approvals). Пресет должен позволять планируемое действие
после approval: `worker` для destructive, `reviewer` для done, `admin` для
member/share/board delete:

```json
{
  "kind": "destructive",
  "cardId": "card-…",
  "ttlMinutes": 60,
  "plan": {
    "schemaVersion": 1,
    "boardId": "board-…",
    "commands": [
      { "commandId": "cmd-…", "action": { "type": "DELETE_CARD", "cardId": "card-…" } }
    ]
  }
}
```

Если destructive-команда/batch или operation приходит **без** approval и
policy требует approval, сервер не применяет её, а создаёт
`ApprovalRequest` для точного плана и возвращает
`409 approval_required` с `approvalId`, `planHash`, `expiresAt`. Это тот же
запрос, что и явный `POST /approvals`; частичного применения нет. Выбран
`409`, а не `202`: запрос не принят в работу и не будет применён без
человеческого решения.

Сервер:

1. Валидирует план: для `commands` — тем же validator, что batch/plan
   (≤`min(100, policy.maxCommandsPerRun)`, карточки ≤
   `min(50, policy.maxCardsPerRun)`, одна доска, все id/предусловия); для
   `operations` — ровно одна операция из whitelist, её target/body и
   board-scope. Превышение — `409 limit_exceeded`.
2. Считает `planHash` и `summary`/`risk`; `summary`/`risk`/`expiresAt`
   не входят в hash.
3. Проверяет, что preset в принципе мог бы выполнить действие после
   approval (не пытается повысить scope).
4. Если `destructive: "deny"` — `403 destructive_denied`, запрос не
   создаётся.
5. Если уже есть `pending`/`approved` запрос этого токена с тем же
   `planHash` — вернуть его (идемпотентность), а не создавать второй.
   `rejected`/`cancelled`/`expired` позволяют создать новый pending;
   `consumed` при уже применённых командах — идемпотентный replay, иначе
   `approval_consumed`.
6. Создаёт `ApprovalRequest` с `expiresAt = now + effectiveTtlMinutes`;
   effective TTL = `min(request.ttlMinutes ?? policy, policy.approvalTtlMinutes)`,
   floor 5 минут. Пишет Activity `approval_requested`, уведомляет board
   ADMIN.

`kind`:

- `destructive` — delete/bulk archive/member/share/board delete;
- `done` — переход в done-колонку при `move_to_done` policy;
- `custom` — прочие планы, требующие человеческого решения.

`summary`/`risk`:

- `risk: "high"` — delete board/column, member remove, share revoke;
- `medium` — delete card/label/checklist, bulk archive, member/share create;
- `low` — done/custom.

### 10.3. Decision

`POST /boards/:id/approvals/:approvalId/decision` — **session-only** board
ADMIN:

```json
{ "decision": "approve", "planHash": "…", "comment": "ok" }
```

- `planHash` обязателен и должен совпасть; иначе `approval_mismatch`.
- Для `pending` требуется `expiresAt > now`; истёкший — `approval_expired`.
  Для `rejected`/`cancelled`/`consumed` — `approval_not_pending`.
- Повторный `approve` уже `approved` с тем же `planHash` — идемпотентный
  `200` с текущим состоянием, не ошибка и не второй approval. Иной
  `decision` для `approved` — `approval_not_pending`.
- `approval_consumed` возвращается только после успешного apply (consume),
  не на decision.
- `approve` → `approved`; `reject` → `rejected`. Apply не выполняется.
- `decidedBy` — user id; `decisionComment`.
- Activity `approval_approved`/`approval_rejected`; уведомление requester.
- Самоодобрение: PAT не может вызывать decision. Владелец токена-человек
  **может** утвердить запрос своего агента — это и есть human control
  boundary; «нельзя approving own request» относится к агенту, а не к
  человеку-владельцу. Browser не создаёт approvals, поэтому отдельного
  сценария «человек утверждает свой browser-created запрос» нет.

`POST /boards/:id/approvals/:id/cancel` — requester `apiTokenId` или
session-only board ADMIN; только `pending`; Activity `approval_cancelled`.
Попытка применить отменённый approval — `approval_cancelled`.

### 10.4. Apply и одноразовость

- Агент повторяет **тот же** план (тот же `commands`/`operations`, те же
  `commandId`) с заголовком `X-Approval-Id: <approvalId>`.
- Владелец approval: `requestedByTokenId` должен совпасть с текущим
  `apiTokenId`; если `agentSessionId` задан — текущая `X-Agent-Session`
  должна совпасть. Иначе `403 approval_owner_mismatch` (нельзя потребить
  чужой approval даже токеном того же пользователя). Browser JWT approval
  не потребляет; для человека approval не нужен. То же для
  lifecycle-операций.
- Для `commands` — `POST /commands/batch` или `POST /plans/apply`.
- Для `operations` — исходный REST-маршрут (`POST/DELETE ...`) с
  `X-Approval-Id`; сервер сверяет операцию, target и body с планом.
- Для `commands` сервер в одной транзакции:
  1. загружает approval `FOR UPDATE`;
  2. проверяет `status = approved`, `expiresAt > now`, `planHash`;
  3. проверяет, что plan совпадает побайтово по канонической форме;
  4. проверяет, что approval не `consumed`;
  5. применяет план как batch под board lock;
  6. создаёт `AgentRun` с `approvalId`, ставит `status = consumed`,
     `runId`, `consumedAt`;
  7. пишет Activity `approval_consumed` и `runId`.
- Для `operations` сервер в транзакции endpoint'а проверяет approval так же,
  выполняет ровно одну операцию, ставит `status = consumed`, `consumedAt`,
  пишет Activity/SecurityAuditLog; `AgentRun` не создаётся, `runId`
  остаётся `null`.
- Retry операции идёт с тем же `Idempotency-Key`; `IdempotencyRecord`
  возвращает сохранённый ответ даже после `consumed`. Без ключа повтор
  после успеха получает `approval_consumed`.
- Если plan не совпал — `approval_mismatch`; approval остаётся `approved`
  до TTL, но применить другой план нельзя.
- Если approval истёк между approve и apply — `approval_expired`, нужен
  новый запрос.
- При apply сервер сам ставит `action.at` (с обычным skew-clamp) для каждой
  команды; hash от этого не меняется, потому что `at` в план/hash не входит.
- Идемпотентный retry: если все `commandId` уже применены этим run,
  вернуть сохранённый результат даже после `consumed`; новых записей нет.
- Approval нельзя использовать для плана, который не требует approval по
  policy, или для другого board/plan. `kind` должен соответствовать плану
  (`destructive`/`done`/`custom`); несовпадение — `approval_mismatch`.

### 10.5. Уведомления и аудит

- `approval_requested` → in-app bell + email всем board ADMIN (включая
  владельца токена), localized by `User.locale`.
- `approval_approved`/`rejected`/`cancelled`/`expired`/`consumed` →
  requester token owner + decision actor.
- Дедупликация: один event на `(approvalId, recipientId, type)`.
- Activity хранит `approvalId`, `planHash` (полный), `risk`, `decision`.
- Expiry проверяется лениво на read/decision/apply и sweep'ом maintenance;
  `pending`/`approved` с `expiresAt <= now` → `expired`, уведомление.
- Email/in-app delivery — 166.9; approval API не ждёт SMTP.
  Attention-события 166.9: `approval.requested`, `approval.decided`,
  `agent.blocked`, `agent.needs_human`, `claim.expired`, `quota.exceeded`,
  `token.revoked`.

---

## 11. Run и rollback

### 11.1. Границы

- Run создаётся сервером при:
  - `POST /boards/:id/commands/batch` от PAT;
  - `POST /boards/:id/plans/apply` от PAT;
  - одиночной destructive-команде PAT из `BoardAction` (например,
    `DELETE_CARD`, `DELETE_COLUMN`, `ARCHIVE_COLUMN_CARDS`).
- Обычная одиночная неразрушающая команда PAT не создаёт run.
- Non-command REST-действия (`DELETE /boards/:id`, member/share/
  attachment/comment delete) **не** создают `AgentRun`: у них своя
  audit/restore-семантика (§11.3).
- Человеческие batch/plan/undo **не** создают `AgentRun`; их история —
  существующий UI undo. Исключение — session-only run-revert, который
  создаёт `kind: "revert"` run для аудита.
- Run строго одной доски: endpoint board-scoped; `AgentRun.boardId` один;
  plan/batch не может содержать команду другой доски.
- Один run = один `agentSessionId` (может быть `NULL` для legacy) + один
  `apiTokenId` (может быть `NULL` только у системного run-revert человека).
- Несколько run у одной сессии разрешены; `AgentSession.currentRunId` —
  последний.

### 11.2. Идентификаторы и идемпотентность

- `runId` — серверный `AgentRun.id` (`cuid`), возвращается в ответе.
- Клиент может прислать `clientRunId` (8–64 `[A-Za-z0-9_-]`); сервер
  использует его только для идемпотентности в пределах доски.
- Повтор с тем же `clientRunId` и тем же набором `commandId` возвращает
  существующий run. Тот же `clientRunId` с другим планом/сессией —
  `409 run_conflict`.
- Если `clientRunId` не передан, но все `commandId` уже существуют с тем
  же payload, сервер возвращает их сохранённые результаты и `runId`
  исходного run; новый run не создаётся. Смесь существующих и новых
  команд с другим run — `409 run_conflict`.
- Response batch/plan: `{ runId, results: CommandResponse[] }`.
- `Command.runId` заполняется для всех команд run; `AgentRun.firstSeq`/
  `lastSeq` — диапазон.

### 11.3. Pre-image

- Для **каждой** команды в run пишется `CommandPreimage`:
  - creates (`ADD_*`, `DUPLICATE_*`) — `exists: false`;
  - updates/moves/sets — полный before-snapshot затронутых сущностей;
  - deletes/bulk archive — полный snapshot с вложенными сущностями.
- Preimage также хранит `version` до и `postVersion`/`postDeletedAt`
  после, чтобы rollback мог проверить, не изменил ли кто-то сущность после
  run.
- Preimage не отдаётся в обычном activity feed. `GET /runs` для observer —
  только summary/attribution; `GET /runs/:runId` с pre-image и полным
  diff — только board ADMIN (browser JWT). `dryRun` для observer возвращает
  conflict summary без snapshot'ов; полный diff — только ADMIN.
- Для non-command destructive REST-действий preimage-таблицы нет:
  - `DELETE /boards/:id` — soft-delete + admin restore + `SecurityAuditLog`;
  - share revoke — `BoardShareAuditLog`; повторное создание даёт новый токен;
  - member remove — Activity details + повторный invite;
  - comment/attachment delete — soft-delete + Activity details + admin
    restore (attachment blob сохраняется до purge).
  Эти действия не входят в run rollback; это осознанная граница MVP.

### 11.4. Revert

`POST /boards/:id/runs/:runId/revert`:

```json
{ "dryRun": true }
```

- `dryRun: true` — board member (observer) получает `RevertPreviewDto`:
  `{ dryRun, run: RunSummaryDto, conflicts, canRevert }` без
  commands/pre-image/snapshot. Board ADMIN получает тот же `RevertPreviewDto`
  с `diff`; полный `RunDetailDto` (commands + preimages) — только ADMIN.
  Ничего не пишет.
- `dryRun: false` — session-only board ADMIN; body дополнительно требует
  `commandId` (идемпотентность). PAT → `403 pat_forbidden`.
- Алгоритм:
  1. загрузить run и команды в обратном порядке;
  2. для каждого `touch` взять **последнее** состояние в run (последняя
     команда, писавшая сущность) и сравнить текущее состояние с её
     `postVersion`/`postDeletedAt`; промежуточные версии того же run
     конфликтом не считаются и разворачиваются в обратном порядке;
  3. если сущность изменена/восстановлена/пересоздана — conflict
     `{ touch, expectedVersion, currentVersion, reason }`;
  4. построить inverse из preimage (restore/update/delete);
  5. применить все inverse в одной транзакции под board lock;
  6. создать новый `AgentRun` (`kind: "revert"`, `revertsRunId = runId`,
     actor — человек), записать команды/preimages;
  7. исходный run → `status: "reverted"`, `revertedAt`;
  8. Activity `run_reverted`.
- Любой конфликт → весь revert отменяется, `409 run_conflict` (или
  `version_conflict`, если причина в версии) с `details.conflicts`;
  partial revert запрещён.
- Revert of revert в MVP запрещён (`409 run_conflict`); повторный revert
  уже откаченного run — `409 run_conflict`.
- Если preimage/run удалены retention — `409 run_expired`.
- Revert не ломает обычный UI undo: созданные им команды приходят по SSE
  как обычные foreign-команды; стек человека обрабатывает их по текущим
  правилам.

### 11.5. Retention и dry-run

- Run/preimage живут столько же, сколько `Command` (retention).
- Dry-run доступен, пока живы команды/preimages; после — `run_expired`.
- Dry-run не создаёт `IdempotencyRecord` и не пишет команды;
  `lastUsedAt` обновляется обычной аутентификацией (не чаще раза в 60 с).
- Revert-run хранится как обычный run; его можно посмотреть в аудите, но
  не откатить (см. выше).

---

## 12. Лимиты и data safety

### 12.1. «10 досок»

- `LIMITS.boardsCount = 10` остаётся только для local/offline mode как
  защита localStorage.
- Server mode: `MAX_BOARDS_PER_USER` (env, default `0` = без лимита).
  Положительное значение — операторский safety cap, не тариф.
- `GET /auth/config` расширяется полем
  `limits: { boards: number | null, importBytes }`; UI показывает лимит
  только если он задан. Отдельный `GET /limits` не вводится.
- `POST /boards` и `POST /boards/import` проверяют cap атомарно; превышение
  → `409 limit_exceeded` (импорт не создаёт ни одной доски).
- Убирается рассинхронизация empty-state/switcher/reducer: сервер — источник
  истины, reducer в server mode не режет по 10.

### 12.2. Retention

- Default 30 дней; пресеты 30/90/365; custom 1–3650.
- Один `retentionDays` для Command, CommandPreimage, Activity, AgentRun,
  AgentSession, terminal ApprovalRequest и soft-deleted rows.
- `pending`/`approved` approvals не удаляются по возрасту; только по
  `expiresAt` (и затем sweep).
- `AdminAuditLog` — существующие 365 дней, не меняется.
- Run revert после retention невозможен; это честно документируется.

### 12.3. Import/export и лимиты тела

- `EXPORT_SCHEMA_VERSION = 3`: добавлено optional `Board.agentPolicy`.
  `agentsPausedAt/By/Reason`, `agentPolicyVersion`, сессии, approvals и runs
  **не** экспортируются. v3 — осознанный client compatibility break: старые
  клиенты отвергают файл, а не теряют policy молча; release notes 166.6 и
  166.16 обязаны это повторить.
- `parseExport` принимает v1/v2/v3; v1/v2 → `agentPolicy = null`.
- `validateImportedBoards` принимает `maxBoards`:
  - local/offline — 10;
  - server — `MAX_BOARDS_PER_USER` (0 = без ограничения).
- `MAX_IMPORT_BYTES = MAX_BOARD_EXPORT_BYTES = 25 MB` — только
  import/export envelope. Это **не** лимит команд.
- `MAX_COMMAND_BODY_BYTES = 10 MB` — тело одного `/commands`,
  `/commands/batch`, `/plans` или `/plans/apply` запроса; per-action
  `MAX_COMMAND_BYTES = 2 MB` сохраняется. Body parser настраивается
  route-specific: import — 25 MB, command/plan — 10 MB, остальное —
  обычный JSON-лимит. Превышение — `413 payload_too_large`; экспорт больше
  25 MB — тот же код с советом использовать `pg_dump`, без молчаливой
  обрезки.
- `POST /boards/import?dryRun=1` — preview: доски/карточки/конфликты,
  ничего не пишет. Импорт не является run.
- Импорт применяет policy из v3 после валидации; paused-состояние не
  переносится.
- Вложения в export не входят (как сейчас); это документируется.

### 12.4. Backup

- Janosik **не** создаёт и не проверяет backup.
- `GET /admin/retention` (и UI) отдаёт:

```json
{
  "retentionDays": 30,
  "purgeable": { "cards": 0, "comments": 0, "attachments": 0, "columns": 0 },
  "backups": {
    "mode": "external",
    "location": "/backups",
    "automatic": false,
    "lastBackupAt": null,
    "verified": false
  }
}
```

- `mode: "unconfigured"`, если `BACKUP_DIR` не задан; `location: null`.
- UI server mode не показывает «Automatic backups»/«Save a copy now»;
  local mode backup остаётся локальным.
- Runbook 166.16: `pg_dump` + uploads volume + restore drill; статус
  «external» не означает «healthy».

### 12.5. Self-service export/delete

- `POST /users/me/export` — session-only, ставит `DataExport` job; ответ
  `202 {id, status}`. `GET /users/me/export/:id` — статус;
  `GET /users/me/export/:id/download` — TTL-ссылка (7 дней).
- Bundle: профиль, token metadata (без hash/plaintext), memberships,
  authored comments/activity/commands, attachments metadata и board
  envelopes досок, доступных пользователю. Blob-файлы не встраиваются;
  они доступны по существующим attachment routes.
- `POST /users/me/delete/request-code` — session-only, только для OAuth-only
  аккаунта (`passwordHash = null`): body `{oauthProof}`; отправляет
  6-значный `emailCode` на email аккаунта, TTL 10 минут, одноразовый.
- `oauthProof` — access token, выданный OAuth-логином
  (`/auth/oauth/:provider/callback`) не более 10 минут назад. Сервер
  проверяет подпись, `sub`, `iat` и claim `authMethod: "oauth"`; обычный
  JWT-пароль-логин и PAT его не заменяют.
- `DELETE /users/me` — session-only; body
  `{password?, oauthProof?, emailCode?, confirmEmail}`. Для аккаунта с
  `passwordHash != null` обязателен текущий пароль. Для OAuth-only
  (`passwordHash = null`) нужны `oauthProof` и `emailCode` из
  `POST /users/me/delete/request-code`; пароль не требуется.
  Немедленно disable + revoke tokens + cancel sessions, затем hard delete
  через 7 дней (maintenance), повторяя семантику admin delete. Hard delete
  дополнительно удаляет `AgentSession`, `ApprovalRequest` пользователя как
  requester и его `IdempotencyRecord`; `SecurityAuditLog` сохраняет opaque
  id без email. Ответ `{status: "scheduled", deleteAfter}`.
- `SecurityAuditLog`: `account.exported`, `account.delete_scheduled`,
  `account.deleted`; board delete — `board.deleted`.

### 12.6. Вложения и лимиты

- 20 вложений на карточку, 25 MB на файл, MIME allowlist — без изменений.
- Object storage/presigned URL — phase 2, не TASK-166.
- Per-board storage quota и token count cap — вне TASK-166 (не блокируют
  agent control); отмечаются как future work в 166.16.

---

## 13. Совместимость

### 13.1. Старые PAT

- Миграция: `scopePreset = "admin"`, `trustedCi = true` для
  `readOnly = false`; `readOnly = true` сохраняет флаг и эффективно
  Observer.
- Старый PAT сохраняет board-поведение: destructive без approval,
  member/share/board admin, batch, export/import (если account-wide).
- `trustedCi` не отменяет:
  - `Board.agentPolicy.destructive = "deny"`;
  - board/token pause;
  - account-маршруты (profile/tokens/invitations) — теперь `pat_forbidden`;
  - scope по boardId (board-scoped токен по-прежнему не видит чужие доски).
- Legacy read-only PAT: любые write → `pat_read_only`, как раньше.
- Legacy PAT без сессии: `agentSessionId = NULL`, `apiTokenId` пишется;
  run создаётся для batch/destructive.

### 13.2. Старые доски и экспорты

- `Board.agentPolicy = NULL` → defaults; старые доски не меняют поведение.
- `agentsPausedAt = NULL`; старые доски не на паузе.
- `EXPORT_SCHEMA_VERSION = 3`; v1/v2 импортируются, policy = null.
- `Board` aggregate получает optional `agentPolicy`; старые клиенты его
  игнорируют.
- Новые поля `Card`/`Command`/`Activity` nullable; старые строки читаются.
- `Board.version` не меняется; `agentPolicyVersion` отдельный.

### 13.3. Старые клиенты и MCP

- Старый MCP без sessions продолжает работать с legacy PAT.
- Новый MCP с новым токеном `worker` получает `approval_required` на
  destructive (или `scope_denied` на admin-only member/share/board delete);
  это ожидаемое поведение, а не поломка.
- `janosik_update_profile`, `janosik_list_invitations`,
  `janosik_accept_invitation`, `janosik_decline_invitation` удалены:
  account **writes и чувствительные account reads** недоступны PAT
  (`GET /users/me/tokens`, `GET /invitations`, export status/download).
  `janosik_whoami` и чтение identity/avatar (`GET /auth/me`,
  `GET /users/:userId/avatar`) остаются. README/skill/docs обновляются в
  166.11 и 166.16.
- `create_share`, `invite_member`, `update_member`, `remove_member`,
  `delete_board` и удаление чужого вложения требуют `admin` + approval;
  удаление контента — `worker` + approval. Legacy PAT обходит approval.
- Tool count и `mcp/README` обновляются в 166.11; до этого не фиксируем
  число в этом документе.

### 13.4. Осознанные breaking changes

1. PAT больше не может менять профиль/аватар, управлять токенами,
   принимать/отклонять приглашения.
2. Новый токен по умолчанию `worker`, а не «всё, что может MEMBER».
3. Новый admin-токен не получает destructive без approval/`trustedCi`.
4. Board policy/pause/approval decision/run revert недоступны PAT.
5. `RESTORE_*`-команды недоступны любому PAT; browser undo для
   ADMIN/MEMBER сохранён, восстановление агентом — через компенсацию или
   human run-revert.
6. `janosik_remove_card_link` больше не считается destructive; annotation
   меняется на WRITE.
7. `EXPORT_SCHEMA_VERSION = 3`: старые клиенты не импортируют новый файл;
   v1/v2 продолжают импортироваться новым сервером.

Все они фиксируются в CHANGELOG и release notes 166.6/166.16; для export v3
release note обязателен отдельно.

---

## 14. Карта потоков и волн

### 14.1. Волны и зависимости

Детальные зоны файлов и DoD каждого потока — в `ROADMAP.md` §7.23.3; ADR
не дублирует 16 строк. Здесь фиксируются только волны и зависимости:

| Волна | Потоки | Зависимость / условие |
| --- | --- | --- |
| W0 | 166.0 | —; выполнена, W1 разблокирована |
| W1 | 166.1–166.6 | после 166.0; 166.1 владеет schema+migration; 166.3/166.5 зависят от 166.1; остальные стартуют параллельно |
| W2 | 166.7–166.12 | после W1; 166.7 — после 166.1+166.4; 166.8 — после 166.4+166.5; 166.9 — после 166.5 |
| W3 | 166.13–166.15 | после `feat/admin-redesign` и соответствующих backend-потоков |
| W4 | 166.16 | после W1–W3 |

Точные ID, названия, file zones и DoD:
[`ROADMAP.md` §7.23.3](../ROADMAP.md) (локальный путь `ROADMAP.md`); при
расхождении приоритет у ROADMAP по составу потоков и у этого ADR по
контрактам/схеме/матрице.

### 14.2. Владение файлами и порядок мержа

- **Prisma schema/migrations** — единственный owner 166.1: он добавляет
  **все** таблицы/поля TASK-166 одной миграцией (включая `ApprovalRequest`,
  `AgentRun`, `CommandPreimage`, `SecurityAuditLog`, `IdempotencyRecord`).
  166.3/166.5/166.7 **не редактируют** `schema.prisma` и не создают свои
  миграции. Если нужна правка — follow-up от 166.1.
- **`shared/src/api.ts`**: 166.4 — owner error envelope/write contract;
  166.1 добавляет attribution, 166.2 — token DTO, 166.5 — approval DTO,
  166.7 — run DTO. Правило: append-only секции, без переформатирования
  файла; конфликт решает 166.4.
- **`backend/src/commands/*`**: 166.1 (attribution), 166.4 (errors),
  166.7 (run/preimage) — 166.7 мержится после 166.1+166.4.
- **Guards**: 166.2 — scopes; 166.3 — pause hook; 166.1 — session header.
  166.3 добавляет проверку после 166.2; 166.2 не реализует pause.
- **MCP `mcp/src/tools/*`**: каждый поток добавляет свой файл/секцию;
  166.4 меняет `format/errors`; 166.11 обновляет README/OpenAPI/счётчик.
- **UI-потоки 166.13–15** не начинаются до мержа `feat/admin-redesign`;
  backend-потоки от него не зависят.
- Если два потока всё же трогают один файл, действует правило ROADMAP:
  развести по времени или один worktree с явным owner.

### 14.3. Порядок разблокировки W1

1. 166.0 (этот документ) мержится.
2. 166.1 первым lands schema+migration; 166.2/166.3/166.5 могут начинать
   реализацию параллельно на своих ветках, но rebase-ят schema-часть после
   166.1. Это единственная зависимость, которую 166.0 не может убрать без
   изменения продуктового кода.
3. 166.4 стартует сразу (error contract не зависит от schema).
4. 166.6 стартует сразу; использует `SecurityAuditLog` из 166.1.
5. W2 стартует после соответствующих W1 DoD; 166.7 — после 166.1+166.4,
   166.8 — после 166.4+166.5, 166.9 — после 166.5.

---

## 15. Общий Definition of Done

- **Безопасность:** ни один агентский путь (REST, MCP, batch, plan, import,
  share, комментарии, вложения, undo/restore) не обходит scopes,
  destructive gate, WIP, workflow, pause и approval. Destructive по
  умолчанию закрыт для новых токенов.
- **Наблюдаемость:** по любому run видно `apiTokenId`, `agentSessionId`,
  `runId`, актора-человека, команды, ошибки, approval и решение.
- **Откат:** run можно посмотреть и откатить с dry-run/conflict-check;
  обычный человеческий undo не ломается.
- **Опыт:** EN/RU docs, понятные `403/409` с машинным кодом и человеческим
  текстом, никаких тихих no-op; mutation возвращает structuredContent.
- **Совместимость:** старые PAT/доски/экспорты работают по §13; новые поля
  nullable; self-host не требует облачных сервисов.
- **Гейты:** shared/ui/backend/mcp typecheck и unit; backend E2E; полный
  admin browser E2E; новые contract/E2E; lint/format; prettier для docs.
- **Обязательные регрессии:** MEMBER delete → browser undo (`RESTORE_*`) →
  200, тот же `RESTORE_*` с PAT → 403; individual pause → pause-all →
  resume-all → токен остаётся на паузе; approval другого `apiTokenId` → 403
  `approval_owner_mismatch`; повторный approve approved идемпотентен;
  observer run preview не содержит pre-image; policy TTL/limits ниже
  глобальных; два PAT одного владельца не удаляют комментарий/вложение друг
  друга; OAuth-only `DELETE /users/me` без пароля с `oauthProof` +
  `emailCode`; export v3 отвергается старым клиентом, v1/v2 импортируются
  новым; command body 10 MB не путается с import 25 MB.
- **166.0 DoD:** документ смержен, ROADMAP/CHANGELOG обновлены, W1
  разблокирована; продуктовый код не изменён.

---

## 16. Осознанно вне TASK-166

- Managed cloud, billing, DPA, status page, multi-tenant org/workspace.
- Отдельная сущность `Agent`/service account с собственным email и логином.
- Remote MCP/OAuth как обязательный канал; webhooks; публичный event API.
- Object storage/S3/presigned URL; base64/URL upload для удалённых агентов.
- Автоматический backup, restore UI, storage quota, SIEM/NDJSON export.
- User 2FA, список сессий пользователя, security-уведомления о входе.
- Полный Jira-граф workflow, post-functions, шаблоны workflow, bulk force
  move; это §7.22 phase 2.
- Маркетинговый редизайн TASK-167 и его claims matrix.
- Мобильный header/390 px, Sentry/pino, axe, TASK-168-хвосты.
- Machine translation, in-app support/status/changelog.
- Delegated human reviewer beyond board ADMIN: `approverRoles` в MVP —
  только `["ADMIN"]`; назначение конкретных reviewer-людей — future work.

---

## 17. Открытые вопросы

**Нет.** Все вопросы, блокирующие W1, закрыты в §4–§13. Если поток
обнаружит противоречие, он не открывает вопрос заново, а присылает
изменение в этот документ через owner 166.0; до мержа действует текущая
редакция.
