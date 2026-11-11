# TASK-179 — независимое ревью спецификации

Дата: 11 ноября 2026.  
Ревью: read-only, без изменений исходников, тестов, docs и worktree.  
Проверено: `main` = `762f4da`; код и guard'ы прочитаны, приложение и браузерные тесты не запускались.

---

## 1. Вердикт

**Not ready — передавать субагентам нельзя.** Спецификация подробная и в целом следует прототипу, но содержит несколько взаимоисключающих решений, которые нельзя «додумать» на реализации: два аудиторских отчёта рекомендуют разную IA, «глобальная шапка» описана как «либо так, либо так», а `stop token/stop all` в Live приписаны board ADMIN, хотя это account-owner операции. Кроме того, `/agents` требует кросс-бордовых runs/approvals и `total`, которых в текущем API нет, а перенос Policy в Board Settings опирается на верхнеуровневый rail, которого в смерженном TASK-178 нет.

После фикса блокеров (B1–B9) спецификация станет пригодной; после этого её всё равно нужно разрезать на 5–7 PR, а не вести одной задачей.

### Top-5 проблем

1. **B1 — конфликт «утверждённых» источников.** `agents-surface-redesign` требует удалить модалку и перенести approvals/pause/policy в Board Settings, `agent-control-redesign` и прототип требуют оставить board-модалку Inbox/Live/Runs. Спека не говорит, кто главнее.
2. **B2 — вход и шапка.** «Один board Bot + один global entry» и «global header или board context with back link» — это два разных продукта; не задано, где global entry на board-route, что происходит с `/agents/:tokenId`, и не будут ли снова две Bot-иконки.
3. **B3 — stop token/all.** В `179.4` и матрице прав это действия board ADMIN, но API — только владелец токена (`/users/me/tokens/:id/pause`, `/agents/pause-all`); board ADMIN не может остановить чужой токен.
4. **B4 — MEMBER/VIEWER и counts.** `3.3` говорит «read-only Runs, без Inbox», `179.4` — «Live read-only», а `Attention item` — «member sees only own safe items». Плюс «один и тот же count» в board icon, `/agents`, global header и bell смешивает разные scope; bell вообще сейчас считает приглашения.
5. **B5 — API reality.** Нет глобального runs/approvals endpoint, `total`, cursor для approvals, поиска по runs и имён token/session; `ROADMAP` при этом утверждает «новых backend-фич нет». Без решения (fan-out или read-only aggregation) 179.2/179.5 не реализуемы однозначно.

Дополнительно: **B6** — в Board Settings нет верхнеуровневого rail `Workflow | Agents & automation`; **B8** — не описана миграция `/agents/:tokenId`; **M1** — прототип и evidence не в git, visual DoD невоспроизводим в чистом worktree.

---

## 2. Результаты checklist

| Область | Статус | Что показала проверка |
| --- | --- | --- |
| Scope и нумерация | **PARTIAL** | 179.1–179.9 есть, но 179.7 — сквозная, 179.8 — фундамент, а не поздняя полировка; 179.9 пытается отложить тесты/доки в конец. Задача слишком большая для одного PR. |
| ROADMAP row 110 / §7.28 | **PARTIAL** | Строка и секция есть, ссылки и 9 подзадач совпадают. Но baseline `737bf08` — родитель spec-коммита `762f4da`; §7.28 утверждает «новых backend-фич нет»; TASK-177.6/177.14 не упомянуты; ссылка на прототип ведёт на untracked-файл. |
| IA | **FAIL** | Два отчёта противоречат друг другу; спека не фиксирует supersession. «Global header» — either/or. Board Settings shell не имеет верхнеуровневого rail. Сам split Inbox/Live/Runs vs Policy-в-настройках когерентен (daily ops vs configuration), но его нельзя реализовать без B1/B6. |
| Контролы | **FAIL** | Пропущены refresh/updated/manage tokens, Needs/Decided/All, копирование hash/link, cancel confirm, policy triggers, reset disabled, named token/session filters, clear filters, total/load more, retry detail, empty CTA и др. |
| Permissions | **FAIL** | `stop token/all` = board ADMIN — неверно; MEMBER/VIEWER Live vs Runs — противоречие; mixed-role (ADMIN на одной доске, MEMBER на другой) не описан; «own safe items» не определён. |
| API / DTO | **FAIL** | Нет глобального aggregation, `total`, cursor для approvals, поиска runs, имён token/session/actor; `cancelApproval` отсутствует в клиенте; preimages/diff — только ADMIN JWT. |
| Файлы / архитектура | **PARTIAL** | Почти все указанные файлы существуют; новые `AgentsAutomation`, shared shell, shared list/detail не названы и не разложены по подзадачам. |
| Тесты | **PARTIAL** | Категории unit/browser/mobile/a11y/visual перечислены, но нет точной матрицы, mixed-role, URL/deep-link, testid-миграции, per-PR тестов. |
| Rollout | **PARTIAL** | Старые `?section/?board` упомянуты, но не `?token/?status/?time/?q`, не `/agents/:tokenId`, не testid alias'ы, не modal deep links; feature flag не обсуждается. |

**Baseline и дубли.** `166.17` (`fb3a530`) и `178` (`360938b`) действительно в `main`; `737bf08` их включает, так что «baseline» по коду корректен, но это родитель spec-коммита `762f4da`. Дублей с TASK-166.17 нет, кроме partial-error retention, который уже сделан (m5). TASK-176 не пересекается. TASK-177 пересекается существенно: `177.14` — approval truth/empty CTA, `177.6` — attention inbox/bell (M9). TASK-178 не дублируется, но его shell не содержит верхнеуровневого rail, на который опирается 179.6 (B6). Пятой вкладки board view и master-panel секции спека не вводит — это корректно.

### 2.1. Фактическая матрица прав (code-read)

| Возможность | ADMIN (JWT) | MEMBER | VIEWER | PAT | Источник |
| --- | --- | --- | --- | --- | --- |
| Список/деталь approvals доски | да | **403** | **403** | только свои | `backend/src/approvals/approvals.service.ts:149-200` |
| Approve/Reject | да | нет | нет | нет | `backend/src/approvals/approvals.controller.ts:84-105` |
| Cancel approval | да | нет | нет | requester PAT | `backend/src/approvals/approvals.service.ts:294-310` |
| Session list/detail | да | да | да | да (observer+) | `backend/src/agent-sessions/agent-sessions.controller.ts:85-99` |
| Session pause/resume | да | нет | нет | нет | `backend/src/agent-sessions/agent-sessions.controller.ts:105-129` |
| Session end | да | нет | нет | владелец токена | `backend/src/agent-sessions/agent-sessions.service.ts:203-221` |
| Board pause/resume | да | нет | нет | нет | `backend/src/agent-sessions/agent-pause.controller.ts:27-51` |
| Stop token/all | владелец | владелец | владелец | нет | `backend/src/agent-sessions/agent-pause.controller.ts:59-80` |
| Runs list/detail/preview | да | да | да | да | `backend/src/runs/runs.controller.ts:42-73` |
| Preimages/diff | да | **нет** | **нет** | нет | `backend/src/runs/runs.service.ts:162-166,189-199` |
| Apply revert | да | нет | нет | нет | `backend/src/runs/runs.service.ts:223-229` |
| Policy get/update | да | нет | нет | нет | `backend/src/boards/boards.controller.ts:164-174` |
| Token pause/revoke | владелец | владелец | владелец | нет | `ui/src/api/client.ts:556-588` |

Вывод: матрица TASK-179 верна для approvals/session/run/policy, **кроме** `stop token/all` (B3) и неоговорённого preimages/diff (M5). Строка «Cancel: requester/ADMIN» технически верна для API, но UI-пользователь-requester — это PAT, а не JWT; в UI cancel фактически ADMIN-only, пока member не видит approvals.

### 2.2. Существующие API, на которые можно опереться

| Область | Endpoint / файл | Ограничение |
| --- | --- | --- |
| Boards + role | `GET /boards` — `ui/src/api/client.ts:786-788` | даёт `BoardSummary.role`, по нему нужен per-board gate |
| Sessions | `GET /boards/:id/agent-sessions` — `ui/src/api/client.ts:1115-1117` | только per-board, без cursor/total |
| Approvals list | `GET /boards/:id/approvals` — `ui/src/api/client.ts:609-623` | `limit <= 100`, без cursor/total; MEMBER 403 |
| Approval detail | `GET /boards/:id/approvals/:id` — `:625-633` | plan только ADMIN/owner; нет history array |
| Approval decision | `POST …/decision` — `:635-649` | session-only ADMIN; требует `planHash` |
| Approval cancel | `POST …/cancel` — backend `approvals.controller.ts:107-124` | **нет метода в `ui/src/api/client.ts`** |
| Runs | `GET /boards/:id/runs` — `:653-675` | per-board, cursor, без total |
| Run detail/preview/revert | `:677-702` | preimages/diff — ADMIN JWT only; apply — ADMIN |
| Policy | `GET/PATCH /boards/:id/agent-policy` — `:704-720` | session-only ADMIN, CAS `version` |
| Board pause | `POST /boards/:id/agents/pause` / `…/resume` — `:722-745` | session-only ADMIN |
| Token pause/stop-all | `POST /users/me/tokens/:id/pause` / `…/resume`, `/agents/pause-all` / `…/resume-all` — `:575-604` | owner only |

---

## 3. Findings

### Blockers

| ID | Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| B1 | **BLOCKER** | Два «approved» отчёта задают разную IA; спека не говорит, какой источник нормативный. `agents-surface-redesign` требует вкладку `Agents` внутри Board Settings и удаление отдельной модалки; `agent-control-redesign` и прототип требуют оставить board-модалку Inbox/Live/Runs. Субагент может выбрать любую и сделать не тот продукт. | `design/agents-surface-redesign/REPORT.md:35-36` (Board Settings tab, «Отдельная модалка Agent control удаляется»), `design/agent-control-redesign/REPORT.md:54-57` (остаётся модалом, Inbox/Live/Runs, policy в Board Settings), `design/agent-surfaces-prototype/README.md:5-9,97`, `docs/TASK-179-agent-surfaces-redesign.md:6-11` (оба названы approved) | Добавить в spec раздел «Normative decision»: прототип — target UX; отчёты — audit evidence. Явно: board modal сохраняется, approvals/pause не переезжают в Board Settings tab, Policy — только Board Settings. |
| B2 | **BLOCKER** | Не зафиксирован вход и route-aware шапка. `3.1` одновременно требует «exactly one board agent icon» и «exactly one global Agents entry»; `179.1` разрешает global entry «в global header right cluster **или** account menu»; `3.1` разрешает «global header **или** board context with back link». На board-route это может снова дать две Bot-иконки, на `/agents` — гибридную шапку. | `docs/TASK-179-agent-surfaces-redesign.md:40-44,90`, `ui/src/components/Header.tsx:71-94` (две Bot), `ui/src/App.tsx:195-215` (тот же Header внутри BoardShell), `ui/src/routes.ts:19-23` (`/agents` и `/agents/:tokenId`), `design/agent-surfaces-prototype/index.html:2236-2237` | Зафиксировать route matrix: board-route — ровно один Bot `Agents` → modal; global-route — ровно один Bot → `/agents`; на board-route нет второго Bot, global entry доступен из Account и из rail модалки «All agents across boards»; `/agents/:tokenId` — сохранить как deep link/redirect. |
| B3 | **BLOCKER** | `stop token` и `stop all` в Live приписаны board ADMIN. Фактически это account-owner операции: `POST /users/me/tokens/:id/pause` / `…/resume` и `/agents/pause-all` / `…/resume-all`; board ADMIN не может остановить чужой PAT. Это также противоречит non-goal «no new token features». | `docs/TASK-179-agent-surfaces-redesign.md:134,211,226-227`; `backend/src/agent-sessions/agent-pause.controller.ts:59-80`; `ui/src/components/agent-control/PausePanel.tsx:29-31,620-621`; `design/agent-surfaces-prototype/index.html:4102` (token pause/stop-all — в Account) | Убрать `Stop token/Stop all` из Live как действия. Оставить ссылку `Manage token` → Account → API keys; разрешить board ADMIN только board pause и session pause/resume/end. Либо явно добавить новый backend-контракт и permissions — но это уже не «reuse». |
| B4 | **BLOCKER** | Роли MEMBER/VIEWER описаны противоречиво: `3.3` — «read-only Runs (and no Inbox at all)»; `179.4` — «Permissions: board ADMIN only; read-only for others» для Live; `Attention item` — «member sees only own safe items». Непонятно, видит ли MEMBER вкладку Live, что в Attention у MEMBER/VIEWER, и что такое «own safe items». Mixed-role (ADMIN на доске A, MEMBER на B) не описан. | `docs/TASK-179-agent-surfaces-redesign.md:66,136,205,224-231`; `design/agent-surfaces-prototype/README.md:70` (MEMBER/VIEWER: Live и Runs read-only, no Inbox); `backend/src/approvals/approvals.service.ts:161-164` (role проверяется по доске); `ui/src/components/agents/use-agent-sessions.ts:230-244` (`boardRole` у каждой доски) | Зафиксировать матрицу: ADMIN — Inbox/Live/Runs; MEMBER/VIEWER — Live и Runs read-only, Inbox отсутствует, approvals не запрашиваются; Attention у них содержит только stale/no-heartbeat sessions; все проверки — по `boardRole` каждой доски, а не по глобальной роли. Удалить «own safe items». |
| B5 | **BLOCKER** | `/agents` требует данные, которых нет в существующем API: глобальные runs/approvals, `total`, cursor для approvals, поиск по runs, имена token/session/actor. Спека оставляет решение открытым («unless a missing read-only aggregation endpoint is proven necessary»), а ROADMAP утверждает, что backend не нужен. | `docs/TASK-179-agent-surfaces-redesign.md:34,51,145,241`; `ROADMAP.md:5027-5028`; `ui/src/api/client.ts:653-675` (runs только per-board), `shared/src/api.ts:1250-1255` (approvals: только limit), `:1341-1354` (runs: cursor, без total); `ui/src/components/agents/use-agent-sessions.ts:80-82` (fan-out по доскам) | Принять решение: либо добавить 179.10 — read-only `GET /agents/overview`, `GET /agents/approvals`, `GET /agents/runs` с per-board RBAC, cursor/total и display names; либо явно вырезать из 179.2/179.5 `total`, глобальный поиск runs и `?run` без `?board`, зафиксировав ограничения fan-out. |
| B6 | **BLOCKER** | «Policy в Board Settings» опирается на несуществующий верхнеуровневый shell. В смерженном TASK-178 `BoardSettingsDialog` рендерит только `WorkflowSettings`; у него header с `Columns/Matrix` и column rail, а не rail `Workflow / Agents & automation`. Нет подзадачи на извлечение shell, dirty-композицию и перенос Policy. | `docs/TASK-179-agent-surfaces-redesign.md:71-80,155-160`; `ui/src/components/board/BoardSettingsDialog.tsx:96-108`; `ui/src/components/board/workflow/WorkflowSettings.tsx:204-335,345-352`; `docs/TASK-178-board-settings-rail.md:27`; `design/agent-surfaces-prototype/index.html:4228,4272` | Добавить отдельный пункт: извлечь `BoardSettingsShell` / верхнеуровневый `Workflow / Agents & automation` rail, сохранить внутри Workflow его `Columns/Matrix`; новый `AgentsAutomation` с policy; поднять dirty-state на уровень диалога. |
| B7 | **BLOCKER** | «Один и тот же pending count» в global header, board icon, `/agents` rail и bell семантически невозможен: board icon считает текущую доску, `/agents` All boards — сумму, bell сейчас считает приглашения, а не approvals. «Same number» будет либо ложью, либо заставит board icon показывать чужие доски. | `docs/TASK-179-agent-surfaces-redesign.md:43,167-168,218`; `ui/src/components/agent-control/AgentControlButton.tsx:37-51` (board-scoped, limit 50); `ui/src/components/NotificationsBell.tsx:46-60,86,104-111` (invitations only); `docs/TASK-177-human-last-mile.md:108-114` (attention inbox — 177.6) | Зафиксировать инвариант: один hook/селектор, но scope-корректные числа: board icon = pending этой доски; `/agents?board=X` = то же; All boards = сумма; `99+` на каждой поверхности. Bell либо получает attention items через TASK-177.6, либо не трогается в 179.1/179.7. |
| B8 | **BLOCKER** | Не описана миграция `/agents/:tokenId`. Сейчас это отдельная detail-страница; `3.2` вводит master-detail на `/agents`, а `179.9` требует «remove old duplicate route code» и сохранения только `?section/?board`. Субагент может удалить рабочий deep link и сломать существующие e2e. | `ui/src/App.tsx:205-206`; `ui/src/routes.ts:19-23`; `ui/src/components/agents/AgentDetailPage.tsx:44-59`; `e2e/tests/app/agents/agents-permissions.spec.ts:26-40`; `docs/TASK-179-agent-surfaces-redesign.md:54,189,250` | Явно сохранить `/agents/:tokenId` как canonical deep link (token → sessions) либо сделать redirect на `/agents?section=sessions&agent=<tokenId>&session=<id>`; добавить в URL contract `?session=`, `?agent=`, `?approval=`, `?run=` и правило: `?run/?approval` требуют `?board`. |
| B9 | **BLOCKER** | Approval detail требует «impact/diff» и «decision history», которых нет в DTO: plan есть только в detail и содержит commands/operations без before/after; history — один decision record, а не массив; имён token/session/agent нет. Без решения 179.3 можно только имитировать diff/history. | `docs/TASK-179-agent-surfaces-redesign.md:119`; `shared/src/api.ts:1198-1204` (`ApprovalPlan`), `:1226-1247` (`ApprovalRequestDto`: `requestedByTokenId`, нет names/history), `backend/src/approvals/approvals.service.ts:184-200`; `design/agent-control-redesign/REPORT.md:100-125` | Определить impact как human summary + target(s) (без выдуманного diff) и decision history как один decision record; либо добавить read-only audit/preview endpoint. Для agent/token labels добавить display names или использовать short id с явной подписью. |

### Major

| ID | Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| M1 | **MAJOR** | Прототип и evidence не в git: `git ls-files design/agent-surfaces-prototype` пуст, папка в `git status` — `??`. Visual DoD «1440/1024/390 match prototype» невоспроизводим в чистом worktree/CI. | `design/agent-surfaces-prototype/` untracked; `git status --short` → `?? design/agent-surfaces-prototype/`; `docs/TASK-179-agent-surfaces-redesign.md:183`; `ROADMAP.md:4989`; `design/agent-surfaces-prototype/README.md:85-97` | Либо закоммитить прототип (index, README, fonts, evidence, screenshots), либо заменить visual acceptance на tracked PNG/README и явно написать «local-only, not in repo». |
| M2 | **MAJOR** | Миграция URL и testid неполная. Сохраняются только `?section/?board`; текущие `?token/?status/?time/?q` и `/agents/:tokenId` не упомянуты. E2E завязаны на `agent-control-trigger`, `agent-runs-trigger`, `agent-control-dialog`, `agent-approvals-tab`, `agent-policy-tab`, `agent-run-*`. | `docs/TASK-179-agent-surfaces-redesign.md:250`; `ui/src/components/agents/agent-model.ts:59-75`; `e2e/tests/app/agents/runs-policy.spec.ts:309-328`; `e2e/tests/app/agents/agents-permissions.spec.ts:26-40`; `e2e/tests/app/agents/approvals-pause.spec.ts:86` | Добавить migration table: old → new URL, old → new testid; сохранить aliases на один релиз; обновить e2e/скриншоты. |
| M3 | **MAJOR** | В 179.2 пропущены контролы страницы из отчёта/прототипа: `Updated 12s ago`, Refresh, `Manage tokens`, empty CTA `Create API key` + `Read docs`, `<title>` route, unknown board fallback. Текущий empty-state — тупик. | `design/agents-surface-redesign/REPORT.md:328-331,690-696,748-751`; `design/agent-surfaces-prototype/README.md:60,63`; `ui/src/components/agents/AgentsPage.tsx:325-331`; `ui/src/components/agents/use-agent-sessions.ts:38` (`lastLoadedAt` не используется); `docs/TASK-179-agent-surfaces-redesign.md:100-112` | Добавить в 179.2 явные acceptance: freshness + refresh, manage tokens, empty CTA, `<title>`, unknown scope recovery; заменить `EmptyState` без ссылки. |
| M4 | **MAJOR** | Не зафиксировано, что stale — это возраст heartbeat, а не lifecycle-статус. Сейчас `isLiveSession` не учитывает stale, а UI показывает `2 live` и `STALE` одновременно; спека говорит «live/stale/paused/ended», но не запрещает ставить их в один ряд. | `design/agents-surface-redesign/REPORT.md:252-258`; `ui/src/components/agents/agent-model.ts:95-97,174-207`; `ui/src/components/agents/AgentsPage.tsx:423-427`; `design/agent-surfaces-prototype/README.md:57-59` | В 179.4/179.8: `Active/Waiting/Paused/Ended` — lifecycle; `No heartbeat · 6 min` — отдельная колонка/строка; никогда не показывать `Active` и `STALE` как два статуса. |
| M5 | **MAJOR** | Runs-контролы неполны: token/session остаются free-text UUID; нет `Clear filters`, `total`, load-more с total, retry detail error; preimages/diff названы общими, хотя сервер отдаёт их только ADMIN JWT. | `docs/TASK-179-agent-surfaces-redesign.md:143-151`; `ui/src/components/agent-control/RunsPanel.tsx:431-449,543,569-573`; `backend/src/runs/runs.service.ts:162-166,189-199`; `design/agent-surfaces-prototype/README.md:59,69` | Заменить token/session на combobox с именами; добавить clear/total/retry; в permissions указать: MEMBER/VIEWER получают timeline/attribution/conflicts, preimages/diff — только ADMIN, с явным read-only state. |
| M6 | **MAJOR** | Policy-перенос потеряет настройку `requireApprovalFor` (approval triggers), если следовать списку полей 179.6. Сейчас 17 действий и `requireApprovalFor` реально участвуют в `evaluateAgentRule`; destructive-триггеры — мёртвые, но non-destructive — работают. | `docs/TASK-179-agent-surfaces-redesign.md:72-78` (нет triggers); `shared/src/types/kanban.ts:617-647`; `ui/src/components/agent-control/PolicyPanel.tsx:194-205,436-471`; `backend/src/auth/token-scope.ts:458-464`; `design/agent-surfaces-prototype/index.html:4355-4365` | Добавить `Also require approval for` (non-destructive triggers) в Board Settings; destructive triggers показать disabled с «covered by destructive mode»; не удалять `requireApprovalFor` из DTO/save. |
| M7 | **MAJOR** | Policy dirty/CAS/link не композируются с Board Settings. `BoardSettingsDialog` хранит только workflow `dirty`; `PolicyPanel` не имеет baseline/dirty и своего reload; ссылка «Open policy in Board Settings» из модалки не имеет механизма (два локальных state в Header, нет callback/route). | `ui/src/components/board/BoardSettingsDialog.tsx:36-38,59-66,96-108`; `ui/src/components/agent-control/PolicyPanel.tsx:124-151,207-230`; `ui/src/components/Header.tsx:55-58,161-176`; `docs/TASK-179-agent-surfaces-redesign.md:159` | Поднять dirty на уровень BoardSettingsDialog (workflow + policy), добавить `usePolicyDraft` с baseline, `onDirtyChange`, CAS `reload` (сохраняет draft), reset disabled on defaults; ссылка из Agent Control должна закрыть modal и открыть settings через общий controller/route. |
| M8 | **MAJOR** | Deep links модалки/доски не заданы. Глобальная страница может дать `?approval=`, но board-модалка не имеет URL; непонятно, как открыть approval в контексте доски и как `?run=`/`?approval=` на `/agents` находит boardId. | `docs/TASK-179-agent-surfaces-redesign.md:51,148`; `design/agent-control-redesign/REPORT.md:429` (`?agent=inbox&approval=`); `design/agents-surface-redesign/REPORT.md:598-603`; `ui/src/routes.ts:19-23` | Добавить: board modal URL `?agent=inbox` / `?agent=live` / `?agent=runs` + `&approval=<id>` / `&run=<id>` (или явный отказ); глобальные `?approval/?run` обязаны требовать `?board` либо иметь lookup endpoint; cross-link global → board modal. |
| M9 | **MAJOR** | Дублирование с TASK-177 не reconciled. 177.14 буквально требует approval truth на `/agents` + empty CTA; 177.6 — attention inbox/bell. TASK-177 не merged, но обе задачи планируются. | `docs/TASK-177-human-last-mile.md:108-114,227-233`; `ROADMAP.md:1707` (TASK-177 planned); `docs/TASK-179-agent-surfaces-redesign.md` (TASK-177 не упомянут) | Добавить в spec: 177.14 и approval-часть 177.6 поглощаются 179.3/179.7 (или TASK-179 зависит от них); обновить ROADMAP row 108/110 и order. |
| M10 | **MAJOR** | ROADMAP §7.28 утверждает «новых backend-фич нет, только reuse», что противоречит B5; приоритеты в row 110 не совпадают со spec (sessions P1 vs 179.4 P1/P2; runs P2 vs 179.5 P1/P2); baseline stale. | `ROADMAP.md:1709,4987,5013-5028`; `docs/TASK-179-agent-surfaces-redesign.md:5,129-151` | Обновить baseline на `762f4da` (spec commit) или «code baseline 737bf08»; выровнять P1/P2; заменить «no backend» на решение 179.10 или явный scope cut. |
| M11 | **MAJOR** | Тестовый план не покрывает ключевые риски: mixed-role per board, route-aware header, URL/back-forward, 99+/50-cap, expiry while open, cancel, reject reason, empty CTA, modal deep links, detail route migration, no-403 console, per-tab dirty. Часть acceptance-критериев нефальсифицируема: «all buttons behave as specified», «no dead ends», «visually match», «no AI-slop». | `docs/TASK-179-agent-surfaces-redesign.md:193-197,263-265`; existing tests `e2e/tests/app/agents/*.spec.ts`; `ui/src/components/agent-control/AgentControlDialog.test.tsx:252-268` (мок успешного member-list — ловушка) | Добавить точную матрицу (см. §4) и распределить тесты по PR, а не в 179.9; заменить member-тест на «listApprovals не вызывается», а не на 403-мок; переписать DoD в проверяемые Given/When/Then. |
| M12 | **MAJOR** | Visual/typography: `Space Grotesk display/body stack` без оговорки про кириллицу. В отчёте прямо сказано, что у Space Grotesk нет кириллицы; RU-заголовки должны идти body-шрифтом. Также не задан 1024-режим модалки (перекрытие header) и lazy-chunk fallback. | `docs/TASK-179-agent-surfaces-redesign.md:181`; `design/agents-surface-redesign/REPORT.md:723`; `design/agent-surfaces-prototype/README.md:99-103`; `ui/src/components/Header.tsx:168-175` (`Suspense fallback={null}`); `design/agents-surface-redesign/REPORT.md:144-176` | Уточнить: display-шрифт только для Latin, RU — body stack; для 1024 задать sheet/полноэкранный режим без перекрытия header; для lazy modal — skeleton/спиннер, не мёртвый клик. |
| M13 | **MAJOR** | Member read-only Board Settings из прототипа не реализуем при текущей архитектуре: gear скрыт для MEMBER, а `179.6` говорит «board ADMIN only». Это расхождение target UX и acceptance. | `design/agent-surfaces-prototype/README.md:83`; `docs/TASK-179-agent-surfaces-redesign.md:160`; `ui/src/components/Header.tsx:95-110`; `ui/src/components/board/BoardSettingsDialog.tsx:101` | Явно выбрать: либо gear только ADMIN и member read-only state не нужен, либо добавить read-only Board Settings для MEMBER и убрать «ADMIN only». |
| M14 | **MAJOR** | Approvals list ограничен 100 и не имеет cursor/total. `99+` можно сделать sentinel'ом, но «all statuses» и точные Needs/Decided counts за 100 не получить; пагинации нет. | `shared/src/api.ts:1250-1255`; `backend/src/approvals/dto/approval.dto.ts:64-69`; `ui/src/components/agent-control/ApprovalsPanel.tsx:443-445`; `ui/src/components/agent-control/AgentControlButton.tsx:41-43`; `docs/TASK-179-agent-surfaces-redesign.md:168` | Либо явно зафиксировать «latest 100 + 99+ sentinel» и не обещать точные counts/пагинацию, либо добавить cursor/total и кнопку Load more. |

### Minor / Nits

| ID | Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| m1 | **MINOR** | `cancelApproval` отсутствует в `ui/src/api/client.ts`; 179.3 требует Cancel, но файл клиента не указан. | `ui/src/api/client.ts:607-650` (list/get/decide, no cancel); `backend/src/approvals/approvals.controller.ts:107-124`; `docs/TASK-179-agent-surfaces-redesign.md:120` | Добавить `cancelApproval(boardId, approvalId)` в 179.3 Files и тест. |
| m2 | **MINOR** | «Reject requires reason» — это UI-валидация, backend `comment` optional. Спека говорит «no new approval semantics», но требует reason. | `backend/src/approvals/dto/approval.dto.ts:35-47`; `ui/src/components/agent-control/ApprovalsPanel.tsx:272-289`; `docs/TASK-179-agent-surfaces-redesign.md:120` | Написать «UI requires a non-empty reason; API remains unchanged»; добавить тест. |
| m3 | **MINOR** | Статусы cancelled/consumed описаны неверно: cancelled показывает «Not decided» + «Decided», consumed — UUID вместо «Card deleted by this approval». 179.3 требует «all statuses», но не фиксирует copy. | `design/agent-control-redesign/REPORT.md:363-369`; `ui/src/components/agent-control/ApprovalsPanel.tsx:750-782`; `docs/TASK-179-agent-surfaces-redesign.md:121` | Добавить acceptance для cancelled/consumed/expired copy и ссылок на run/card. |
| m4 | **MINOR** | Pending badge сейчас `bg-danger` (ошибка), а отчёт/прототип требуют amber attention; и он icon-only, без видимого label на touch. | `ui/src/components/agent-control/AgentControlButton.tsx:74-80`; `design/agents-surface-redesign/REPORT.md:579`; `design/agent-surfaces-prototype/index.html:3861-3863` | Задать amber badge и видимый label/aria `Agents, N approvals waiting`; 44 px на touch. |
| m5 | **MINOR** | 179.2 acceptance «partial error keeps loaded sessions» уже реализован в 166.17. Это regression guard, а не новая работа; спека не отмечает. | `ui/src/components/agents/use-agent-sessions.ts:99-116`; `git show --stat fb3a530` (AgentsPage.test + use-agent-sessions); `docs/TASK-179...:56,112` | Пометить как «already shipped in 166.17; keep test», убрать из оценки. |
| m6 | **MINOR** | Baseline `737bf08` — родитель spec-коммита `762f4da`; reports добавлены в `762f4da`. Для субагента это не ошибка, но формулировка «main = 737bf08» устарела. | `docs/TASK-179...:5`; `ROADMAP.md:4987`; `git log --oneline` (`762f4da` — spec, `737bf08` — parent) | Писать «code baseline 737bf08; spec/report commit 762f4da (current main)». |
| m7 | **MINOR** | `BoardSettingsDialog` close 29 px, не 44 px; Agent Control должен быть 44 px, но shared shell не описан. `AgentControlDialog` tabs всё ещё `role=group`, `aria-pressed`. | `ui/src/components/board/workflow/WorkflowSettings.tsx:322-332`; `ui/src/components/agent-control/AgentControlDialog.tsx:104-131`; `docs/TASK-179...:67,182` | Задать touch-размеры в shared shell и `tablist/tab/tabpanel` для rail; не копировать 29 px. |
| m8 | **NIT** | «Icon: animated if suitable, otherwise Lucide» — не решение; `AnimatedIconName` не содержит `bot`. | `docs/TASK-179...:44`; `ui/src/components/ui/lazy-animated-icon.tsx:27-43`; `design/agents-surface-redesign/REPORT.md:582` | Либо добавить `bot` в animated set, либо зафиксировать статическую Lucide-иконку для обоих входов. |

---

## 4. Чего не хватает: контролы, состояния, подзадачи

### `/agents` (179.2–179.3)

- `Updated 12s ago` + Refresh + `Manage tokens` в page header.
- `<title>` `Agents — Janosik`, breadcrumb `Boards / Agents` (или `Board / Agents`).
- Empty state с `Create API key` → Account → API keys и `Read docs`; filtered empty с `Clear filters`.
- Unknown `?board=` fallback (не пустой trigger), offline state, partial-error banner с Retry.
- `Group by Agent (token)` toggle (prototype) при default board-first группировке.
- Approval sub-filter `Needs / Decided / All` с честными count; `All clear` empty.
- Approval card: agent/token name, board, action, risk, TTL/countdown, card/session/run links, `Review plan`.
- Approval detail: exact commands, plan hash + copy, impact (human summary), decision record, status; expired/consumed/cancelled copy.
- Approve: подтверждение exact hash; Reject: обязательная причина; Cancel request: confirm; disabled after expiry/consumed; no orphan detail.
- Attention only for ADMIN: pending approvals; для MEMBER/VIEWER — только stale sessions, без approval API.

### Board modal / Live (179.4)

- MEMBER/VIEWER: Live + Runs read-only, no Inbox; initial tab определить (предлагаю Live).
- Board pause/resume: confirm + reason; один banner, не повторять «board paused» в каждой строке.
- Session row/detail: current card/run, `Open board`, heartbeat, pausedBy/board/token, ended state, no actions after end.
- Session pause/resume/end: reason, confirm, busy/error; end releases claims; pause does not.
- `Stop token/Stop all` — убрать как board-admin actions; ссылка в Account → API keys.
- Claims/in-flight: объяснение, без «release claim» (если не решено отдельно).

### Runs (179.5)

- Named token/session combobox (не free-text UUID); status/kind/time; board scope на `/agents`; Clear filters.
- `total` + load more; cursor; global merge или aggregation endpoint.
- Detail error Retry; conflict run disabled с reason; applied/reverted/failed badges right-aligned.
- Preimages/diff — только ADMIN JWT; MEMBER/VIEWER — timeline/attribution/conflicts + read-only notice.
- Danger confirm с impact/conflicts; `run.reverted` refresh; deep links.

### Policy (179.6)

- Top-level rail `Workflow | Agents & automation`; pending badge.
- `requireApprovalFor` triggers: non-destructive — редактируемые; destructive — disabled с «covered by destructive mode».
- Version, `Using safe defaults`, reset disabled on defaults.
- Dirty state across tabs; close/discard; Save/Cancel; inline validation; CAS conflict + `Reload` keeps draft; reset confirm.
- Link `Open policy in Board Settings` из Agent Control и `Live` link из policy.
- Read-only member state — либо явно исключить, либо реализовать.

### Header / rollout

- Route matrix: board / `/agents` / `/agents/:tokenId` / `/`; no board controls on global; no `Switch board` without title; no Undo/Redo for VIEWER.
- One Bot per route; global entry from Account/console rail; no second identical glyph.
- Lazy chunk fallback (skeleton/spinner), focus return to actual trigger.
- 1024 modal/sheet without covering header; 390 full-screen; 44 px targets; safe-area.
- Migration: old `?token/?status/?time/?q`, `/agents/:tokenId`, testid aliases; feature flag or staged release for header.

### Подзадачи, которых нет

- **179.10 (P1) — read-only aggregation/display names**, если B5 решается backend'ом: `GET /agents/overview`, `GET /agents/approvals`, `GET /agents/runs`, RBAC per board, cursor/total, token/session/actor names.  
  Либо **явный scope cut** в 179.2/179.5: no `total`, no global run search, `?run/?approval` require `?board`.
- **179.11 (P2) — settings shell extraction** (`BoardSettingsShell`, top-level rail), если не включать в 179.6.
- **179.12 (P2) — route/testid migration + aliases**, если не включать в 179.1/179.9.

---

## 5. Готовность подзадач

| Подзадача | Статус | Почему |
| --- | --- | --- |
| 179.1 Entry/header | 🔴 red | B1/B2/B7: не решено, где global entry, будет ли второй Bot, что на `/agents/:tokenId`, что с bell/Undo/Redo. |
| 179.2 `/agents` shell | 🔴 red | B5/M3/M11: нет решения по aggregation/total/search; пропущены updated/refresh/manage tokens/empty CTA; master-detail vs detail route. |
| 179.3 Attention/approvals | 🔴 red | B4/B5/B9: impact/diff/decision history/agent names отсутствуют; member Attention не определён; cancel client нет; pagination/99+ не решена. |
| 179.4 Sessions/Live | 🔴 red | B3/B4/B8: stop token/all — неверная permission; MEMBER Live vs Runs; detail route migration; named token/session filters. |
| 179.5 Runs/rollback | 🔴 red | B5/M5: нет total/global merge; preimages/diff role; named filters/clear/retry не заданы; deep links. |
| 179.6 Policy in Board Settings | 🔴 red | B6/M6/M7/M13: нет верхнеуровневого shell; triggers теряются; dirty/CAS/link не композируются; member state. |
| 179.7 One count/permissions | 🟡 yellow | Идея ясна, но B4/B7: scope counts и bell; mixed-role; member test trap. Можно делать после decision. |
| 179.8 Design/mobile/a11y | 🟡 yellow | Примитивы понятны, но prototype untracked, Space Grotesk/Cyrillic, 1024 overlay, lazy fallback, shared shell. |
| 179.9 Cleanup/docs/tests | 🟡 yellow | Направление верное, но route/testid migration и per-PR tests не описаны; 179.9 не должен быть единственным местом для тестов. |

Зелёных нет: пока не закрыты B1–B9, любая подзадача может пойти в неверную сторону.

---

## 6. Рекомендуемое разбиение на PR

| Волна | PR | Содержание | Зависимости |
| --- | --- | --- | --- |
| 0 | Decision PR (docs only) | Зафиксировать normative IA, header matrix, counts, token scope, API decision (179.10 или scope cut), prototype tracking, TASK-177 dedupe. | — |
| 1 | Truth + primitives | 179.7 + часть 179.8: `usePendingApprovals` per board, 99+/100 sentinel, status/heartbeat component, combobox upgrade, testid aliases, per-board role helper. Без route change. | Decision PR |
| 2 | Entry + route-aware header | 179.1: один board Bot, global entry, `GlobalHeader` для `/agents` и `/agents/:tokenId`, redirect/keep detail, focus, no Undo/Redo for VIEWER. | PR1 |
| 3 | `/agents` shell + Attention | 179.2 + 179.3: page shell, URL state, board scope, Attention, approvals list/detail, cancel, 99+, empty CTA. Если нужен aggregation — 179.10 в этом же PR или отдельным backend PR. | PR2 |
| 4 | Sessions/Live | 179.4: global sessions master-detail, board modal Live, board pause, session actions, claims, member read-only. | PR3 (shared shell/route) |
| 5 | Runs/rollback | 179.5: shared Runs list/detail/filters/preview/revert в `/agents` и modal; named filters, total/load more, preimage role. | PR3; можно параллельно с PR4 после shared list/detail primitives |
| 6 | Policy in Board Settings | 179.6 + settings shell extraction: top-level rail, `AgentsAutomation`, triggers, dirty/CAS/reload/reset, link. | PR2; можно параллельно с PR4/5, если shell-owner отдельный |
| 7 | Polish/docs/cleanup | 179.8/179.9: visual 1440/1024/390, a11y/mobile, EN/RU docs, CHANGELOG, remove aliases/old code. | PR1–6 |

Параллельно: PR4 и PR5 можно вести параллельно после PR3, если заранее согласованы shared `SessionRow/SessionDetail` и `RunList/RunDetail`. PR6 независим от `/agents` page, но конфликтует с Header/BoardSettings — нужен один owner. Тесты и docs — в каждом PR; 179.9 — финальный аудит, не место, где тесты появляются впервые.

---

## 7. Предлагаемые точные правки

### 7.1. Spec — нормативное решение

```md
## 0. Normative decision (read before §3)

The prototype is the target UX. Where it conflicts with the audit reports,
the prototype wins; the reports remain evidence, not an alternative IA.

- Board-scoped Agent Control remains a modal: Inbox / Live / Runs.
- Do not move approvals or pause into Board Settings.
- Policy lives only in Board Settings → Agents & automation.
- `/agents` is the global cross-board inbox; it is not a board view tab.
```

### 7.2. Header matrix

```md
- On `/board/:id`: exactly one Bot `Agents` in the board header.
  It opens Agent Control; it never links to `/agents`.
- On `/agents` and `/agents/:tokenId`: a global header variant with
  breadcrumb and exactly one Bot `Agents` linking to `/agents`.
- On a board route there is no second Bot and no global `Agents` link in
  the header; `/agents` is reachable from the Agent Control rail
  "All agents across boards" and from Account.
- `/agents/:tokenId` stays a deep link (or a documented redirect);
  do not delete it in 179.9.
- Global header: no BoardTitle/Members/Share/BoardSwitcher/Settings/
  Presence; no Undo/Redo, including VIEWER.
```

### 7.3. Counts / bell

```md
One `usePendingApprovals` source, scope-correct values:
- board icon: pending on the current board;
- `/agents?board=<id>`: the same number;
- `/agents` All boards: sum of pending on boards where the caller is ADMIN;
- `99+` at 100+; no 50-row cap;
- bell: attention total only if TASK-177.6 is in scope; otherwise leave
  the invitation bell unchanged and remove it from 179.1/179.7.
```

### 7.4. Token actions

```md
- Live: board pause/resume, session pause/resume/end, claims/in-flight.
- Remove Stop token / Stop all as Agent Control actions.
- Add `Manage token` link to Account → API keys; token pause/stop-all/revoke
  are owner-only and are not board policy.
```

### 7.5. API / 179.10

```md
### 179.10 — Read-only aggregation and display names (P1)

Add only if B5 is not scoped out:
- `GET /agents/overview?board=&status=&cursor=&limit=` — boards, sessions,
  approvals (ADMIN boards only), counts;
- `GET /agents/approvals?scope=board|all&board=&status=&cursor=&limit=` —
  details for ADMIN boards only;
- `GET /agents/runs?board=&status=&kind=&token=&session=&from=&to=&cursor=&limit=` —
  merged, total, cursor;
- DTO additions: `apiTokenName`, `agentSessionName`, `actorName`, `boardTitle`.
RBAC: never rely on UI hiding; filter per `BoardSummary.role`.
```

Если 179.10 не добавляется — явно вырезать `total`, глобальный поиск runs и `?run` без `?board` из 179.2/179.5.

### 7.6. Policy

```md
- Add a top-level Board Settings rail: `Workflow | Agents & automation`.
- Extract `BoardSettingsShell`; keep Workflow's Columns/Matrix inside.
- New `AgentsAutomation` section with `usePolicyDraft`:
  destructive mode, max commands/cards, TTL, approver roles, reset,
  and `requireApprovalFor` triggers (non-destructive editable;
  destructive disabled as "covered by destructive mode").
- Dirty state lifted to BoardSettingsDialog for both tabs.
- CAS conflict: `Reload` keeps the draft, updates version, clears banner.
- Reset disabled when policy is already defaults.
- `Open policy in Board Settings` closes Agent Control and opens settings.
```

### 7.7. ROADMAP

```md
- Baseline: code `737bf08`; spec/report commit `762f4da` (current main).
- `TASK-177.14` and the approval part of `177.6` are superseded by
  179.3/179.7 (or make TASK-179 depend on them); update row 108/110.
- Replace "новых backend-фич нет" with the 179.10 decision, or state the
  exact fan-out limits.
- Align P1/P2: 179.4/179.5 are P1/P2 in the spec, not "sessions P1 / runs P2".
- Link a tracked prototype/evidence artifact, not an untracked folder.
```

### 7.8. Tests

```md
Add per-PR tests:
- header matrix: board / `/agents` / `/agents/:tokenId` / `/`; ADMIN/MEMBER/VIEWER;
  no board controls on global, no Undo/Redo, focus return.
- counts: 1, 50, 99, 100, 150 pending; board vs All boards; bell if in scope.
- URL: `?section`, `?board`, `?approval`, `?run`, back/forward, unknown board,
  old `?token/?status/?time/?q`, `/agents/:tokenId`.
- roles: mixed ADMIN/MEMBER per board; no approval request/403 in member flow.
- approvals: pending/approved/rejected/expired/cancelled/consumed; expiry while open;
  cancel; reject reason; hash mismatch; no orphan detail.
- live: board pause banner once; pause does not release claims; end releases;
  ended no actions; stop-token link goes to Account.
- runs: named filters, clear, total/load-more, preview diff only ADMIN,
  conflict disables, danger confirm, detail Retry, `run.reverted`.
- policy: dirty close per tab, tab switch, reload keeps draft, reset disabled,
  CAS conflict, triggers, validation.
- mobile/a11y/visual: 390 full-screen, 44 px, one scroll, safe-area, tablist,
  combobox, focus, reduced motion, screenshots vs tracked prototype.
```

---

## 8. Ограничения ревью

- **Read-only**: исходники, тесты, docs, design-файлы и worktree не изменялись; этот отчёт — единственный созданный файл.
- **Не запускались** приложение, Playwright, backend e2e/unit, axe-core, Lighthouse. Runtime-поведение описано по коду и по отчётам, которые проверялись на `c6688f3`/`fdd8010`.
- **Права** выведены из guard'ов/сервисов (`MembershipGuard`, `BoardRoles`, `SessionOnlyGuard`, `TokenScope`) и сервисных проверок; реальные 403/409 не воспроизводились.
- **Прототип** проверен по README и выборочным участкам `index.html` (header, control modal, settings, policy triggers, stop token/all, deep links); все 44 controls интерактивно не проходились.
- **TASK-176/177** не реализованы и не merged; пересечения с ними оценены по их spec/ROADMAP, а не по коду.
- **TASK-166.17/178** проверены по merge-коммитам и текущему коду; 166.17 уже закрывает partial-error retention, это отмечено.
- **Визуальное сравнение** 1440/1024/390 не выполнялось; выводы о 1024/390 основаны на коде, отчётах и прототипе.
- **Не проверялись** production build, Safari/Firefox, реальный touch, safe-area, screen reader.
