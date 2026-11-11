# Проверка продуктовых разрывов Janosik

**Дата:** 11 ноября 2026  
**База:** `main` = `a858c75`  
**Характер проверки:** read-only статическая сверка кода, DTO, REST/MCP-контрактов, UI, тестов и документации. Приложение не изменялось; интерактивный E2E-прогон не запускался, потому что в окружении нет подготовленной пользовательской сессии и тестовых данных, а создавать их в рамках read-only ревью нежелательно. Все находки подтверждены конкретными путями; для touch-поведения (G-12) дополнительно нужен браузерный прогон.

**Что уже исключено:** подтверждённое отсутствие редактирования комментариев не переоткрывается — оно закрывается в `docs/TASK-176-admin-connections.md` (176.2). Также не переоткрываются пункты `design/admin-connections-review/REVIEW.md`, `design/board-settings-redesign/REPORT.md`, security-контура TASK-166.12 и уже описанные пробелы из `audits/launch-gaps-*` и `audits/e2e-filters-views.md`. Явный список — в §6.

---

## 1. Executive verdict

Найдено **18 новых подтверждённых продуктовых разрывов**: **0 P0, 1 P1, 6 P2, 11 P3**. Это не «список хотелок»: каждый пункт — либо действие, которое API/MCP уже умеет, но UI не даёт; либо обещание интерфейса/документации, которое не выполняется; либо счётчик/состояние, которое вводит пользователя в заблуждение.

**Пять самых глупых и дорогих:**

1. **G-04. Введённый комментарий исчезает при закрытии карточки.** Нет ни сохранения черновика, ни подтверждения «отменить?». При этом описание и заголовок карточки специально защищены от потери — комментарий остался единственным исключением.
2. **G-01. Публичную share-ссылку нельзя отредактировать.** API (`PATCH /boards/:id/shares/:shareId`) и MCP-инструмент `janosik_update_share` умеют менять название, флаги комментариев/вложений и срок жизни; в UI есть только «копировать / embed / refresh / revoke». Приходится удалять ссылку и создавать новую, теряя токен и статистику.
3. **G-02. Участник не может выйти из доски.** ADMIN может удалить его, но сам MEMBER/VIEWER не имеет ни кнопки «Покинуть доску», ни API-маршрута. Доска навсегда остаётся в «Shared with me» и продолжает присылать события.
4. **G-03. Человек не управляет agent-owned состоянием карточки.** Task spec (acceptance criteria/DoD) показан read-only, хотя reducer и MCP уже поддерживают `SET_CARD_TASK_SPEC`; claim не виден в properties карточки, а в UI снять его можно только завершив agent-сессию. Владелец доски не может исправить контракт, по которому агент блокирует переход в Done.
5. **G-05. Счётчики Activity показывают загруженную страницу, а не общее число.** У карточки с 120 комментариями бейдж показывает `50`, а после «Show older» растёт. Это тот же класс, что и админские лимиты из TASK-176, но на основной пользовательской поверхности.

**Системный паттерн — не один, а три связанных:**

- **API/MCP-first, UI last mile.** Сервер и агентские инструменты уже умеют `PATCH share`, `SET_CARD_TASK_SPEC`, `PATCH` pending-invite, фильтр комментариев по `kind`, per-board export, `notifyAttention`; человеческий UI не доводит эти операции до кнопки. Это главный источник «почему я не могу сделать это со своими данными?».
- **Односторонние действия + admin-only recovery.** Сервер soft-delete'ит карточки, колонки, доски, комментарии и вложения, но пользователь после reload не имеет restore; локальный undo живёт только во вкладке, а восстановить может только мастер. При этом копирайт обещает «permanently»/«Delete forever».
- **Загруженная выборка выдаётся за полный список.** Activity-бейджи, admin shares, счётчик карточек в switcher — все показывают не то число, которое пользователь интерпретирует как «сколько всего».

---

## 2. Top-20 findings

> В таблице 18 подтверждённых новых пунктов; остальные кандидаты отсеяны как дубли TASK-176, уже описанные аудиты или непроверяемые гипотезы. Это сознательно короче «ровно 20».

| ID | Находка | Класс | Sev | Effort | Surface | Доказательство |
|---|---|---|---|---|---|---|
| G-01 | Share-ссылку нельзя отредактировать после создания | product gap / surface asymmetry | P2 | S/M | normal UI ↔ REST/MCP | `ShareDialog.tsx:314-370`; `client.ts:854-863`; `board-shares.controller.ts:130-161`; `shares.ts:144-193` |
| G-02 | MEMBER/VIEWER не может выйти из доски | permission asymmetry | P2 | S/M | normal UI ↔ REST | `BoardMembersDialog.tsx:697-776`; `boards.controller.ts:318-356`; `client.ts:926-931` |
| G-03 | Task spec read-only, claim невидим и снимается только завершением сессии | permission asymmetry / product decision | P2 | M | normal UI ↔ MCP | `CardTaskSpec.tsx:4-20`; `board-reducer.ts:2678`; `cards.ts:733`; `agent-sessions.service.ts:248-261` |
| G-04 | Черновик комментария теряется при закрытии карточки | real bug / data loss | P1 | S | normal UI | `CardComments.tsx:96,184-229`; `CardDialog.tsx:455-458,516-523,758-778` |
| G-05 | Бейджи Comments/History считают загруженную страницу, не общее число | misleading counts | P2 | S | normal UI | `CardActivity.tsx:82-106`; `CardComments.tsx:135-136,244-256`; `CardHistory.tsx:158-164` |
| G-06 | Kind комментария нельзя изменить и нельзя фильтровать | product gap | P3 | S | normal UI ↔ REST/MCP | `comments.controller.ts:44-108`; `comments.service.ts:123`; `CardComments.tsx:109`; `docs/TASK-176-admin-connections.md:125` |
| G-07 | Pending invitation нельзя изменить/продлить/переотправить | write path without edit | P3 | S | normal UI ↔ REST | `BoardMembersDialog.tsx:784-822`; `boards.controller.ts:277-316`; `client.ts:915-924` |
| G-08 | Revoke share без подтверждения, хотя admin-панель подтверждает | destructive too easy | P3 | S | normal UI | `ShareDialog.tsx:352-368`; `SharesPage.tsx:247-259` |
| G-09 | Admin shares показывает первые 100 и молчит об остальных | misleading total | P3 | S | admin UI | `SharesPage.tsx:36-39,99-112`; `admin.service.ts:1745-1782`; `use-admin-list.ts:24-46` |
| G-10 | Admin shares не показывает expiry; истёкшая ссылка выглядит активной | misleading status | P3 | S | admin UI | `SharesPage.tsx:99-112,213-237`; `shared/src/admin.ts:1128-1147` |
| G-11 | Счётчик карточек в board switcher включает архивные | misleading count | P3 | S | normal UI | `BoardSwitcher.tsx:437-439`; `board-reducer.ts:1012-1029`; `boards.md:24-28` |
| G-12 | Удаление комментария / ссылки на карточку — hover-only без touch-fallback | mobile/accessibility gap | P3 | S | mobile UI | `CardComments.tsx:603-612`; `CardLinks.tsx:369-386`; ср. `CardChecklists.tsx:350-359`; `index.css:18` |
| G-13 | Файл из «Removed from descriptions» нельзя вернуть, только удалить | UX dead end | P3 | M | normal UI | `CardAttachments.tsx:354-394`; `attachments.controller.ts:62-238`; `cards.md:128-137` |
| G-14 | Per-board export есть в API/доках, но не в UI | docs mismatch / missing surface | P3 | S | normal UI ↔ REST | `boards.controller.ts:358-369`; `DataMenu.tsx:85-103`; `account.md:158-160` |
| G-15 | «Permanent» delete — soft-delete, восстановимый мастером | docs mismatch / admin-only recovery | P2 | M | normal UI ↔ admin | `cards.md:154-165`; `boards.md:34-40,68-70`; `command-writers.ts:801-832`; `admin.service.ts:2277-2285` |
| G-16 | `notifyAttention` и attention-inbox не имеют UI | docs mismatch / product gap | P2 | S/M | normal UI ↔ REST | `notifications.controller.ts:78-89`; `notification-settings.dto.ts:9-16`; `ProfileSection.tsx:36-60`; `api/index.md:575-576` |
| G-17 | Global search обрезает 20 до группировки; board-hits могут исчезнуть | UX dead end | P3 | S | normal UI | `GlobalSearch.tsx:39,152-155,180-181`; `filter.ts:536`; `collaboration.md:112-124` |
| G-18 | Тост «Board exported» при экспорте всех досок | docs/copy mismatch | P3 | S | normal UI | `DataMenu.tsx:85-103`; `locales/en/translation.json:930`; `account.md:158-160` |

---

## 3. Detailed findings

### G-01 — Share-ссылку нельзя отредактировать после создания

**Класс:** product gap / surface asymmetry. **P2, S/M.** **Surface:** normal UI ↔ REST/MCP.

**Что видит пользователь.** В диалоге «Поделиться» он создаёт live/snapshot-ссылку с названием, флагами `comments`/`attachments` и TTL. Позже хочет переименовать ссылку, скрыть комментарии, включить вложения или снять/продлить expiry. В строке ссылки есть только `Copy`, `Embed code`, `Refresh` (только snapshot) и `Revoke` — контрола редактирования нет.

**Что ожидает.** Рядом с `Revoke` есть `Edit`, открывающий ту же форму, но без смены `mode` и токена; сохранение идёт через существующий `PATCH`.

**Почему блокировано.** UI никогда не вызывает `updateShare`, хотя клиентский метод уже есть:

- `ui/src/api/client.ts:854-863` — `PATCH /boards/:id/shares/:shareId`;
- `backend/src/share/board-shares.controller.ts:130-161` — обработчик с approvals/audit;
- `backend/src/share/dto/share.dto.ts:37-56` — `UpdateShareDto` (title, includeComments, includeAttachments, expiresAt);
- `mcp/src/tools/shares.ts:144-193` — `janosik_update_share`;
- `site/src/content/docs/docs/api/rest.md:459` — endpoint опубликован;
- `ui/src/components/board/ShareDialog.tsx:314-370` — фактический набор действий без Edit.

**Repro.** Создать live-ссылку → открыть её строку → попытаться изменить title/флаги/TTL. В UI нет точки входа; через API тот же `PATCH` проходит.

**Рекомендуемый фикс.** Добавить строку `Edit`/иконку карандаша. Переиспользовать `CreateForm` в режиме редактирования: title, includeComments, includeAttachments, expiresAt; `mode` и token не менять. После `PATCH` обновить строку и список; ошибки — существующий `share.actionError`. Для live-ссылки смена `includeComments`/`includeAttachments` должна иметь явное предупреждение, потому что она мгновенно меняет видимость уже существующих данных.

**Тесты.** Component: открыть Edit, изменить title/флаги, отправить `PATCH`, строка обновилась; отмена не отправляет. E2E: live-ссылка с комментариями → выключить комментарии → публичный URL отдаёт 404 на comments; snapshot → очистить expiry. Backend-тесты уже есть.

**Риски.** Смена флагов на живой ссылке — privacy-операция; нужен confirm и запись в ShareAuditLog (сервер уже пишет audit).

---

### G-02 — MEMBER/VIEWER не может выйти из доски

**Класс:** permission asymmetry. **P2, S/M.** **Surface:** normal UI ↔ REST.

**Что видит пользователь.** Его пригласили на доску, он принял приглашение. Доска висит в «Shared with me». В диалоге участников он видит roster и свою роль, но не видит «Покинуть доску». Кнопка удаления есть только у ADMIN и только для других строк.

**Что ожидает.** В своей строке — `Leave board`; после подтверждения доска исчезает из switcher, SSE закрывается, доступ прекращается. Последний ADMIN не может выйти, пока не назначит другого.

**Почему блокировано.**

- `ui/src/components/board/BoardMembersDialog.tsx:697-776` — управляющие контролы рендерятся только при `canManage`; не-ADMIN видит просто текст роли.
- `backend/src/boards/boards.controller.ts:318-356` — `DELETE /boards/:id/members/:userId` под `@BoardRoles(Role.ADMIN)`.
- `ui/src/api/client.ts:926-931` — есть только `removeMember(boardId, userId)`, вызываемый админом.
- `backend/src/boards/boards.service.ts:830-876` — `removeMember` не различает self и other; отдельного маршрута нет.
- `site/src/content/docs/docs/user-guide/collaboration.md:36-42` — документация обещает только admin remove.

**Repro.** Войти как MEMBER на чужую доску → открыть участников → в своей строке нет действия; попытка `DELETE /boards/:id/members/<self>` получает 403.

**Рекомендуемый фикс.** Добавить `DELETE /boards/:id/members/me` (или разрешить `userId === currentUser.id` при `role !== ADMIN` с проверкой last-admin) и кнопку `Leave board` в собственной строке. Серверная проверка: нельзя покинуть доску, если ты последний ADMIN; писать `Activity` `member_left`; опубликовать `membership` SSE; при удалении — закрыть live-соединение.

**Тесты.** Backend e2e: MEMBER leaves; VIEWER leaves; last ADMIN получает 409/403; admin удаляет другого — без регрессии. UI: non-admin видит Leave, admin — нет (или видит для себя с guard); confirm. E2E: после выхода доска исчезает из switcher и прямой URL даёт 403/404.

**Риски.** Нужно решить, что делать с комментариями/вложениями ушедшего; сейчас они остаются. Для VIEWER с expiry — не конфликтует.

---

### G-03 — Agent-owned состояние карточки: task spec read-only, claim невидим

**Класс:** permission asymmetry / product decision. **P2, M.** **Surface:** normal UI ↔ MCP/commands.

**Что видит пользователь.** В карточке есть секция `Task spec` с `Acceptance criteria` и `Definition of done`, но она read-only. Если агент записал туда неверный DoD, человек не может ни исправить, ни очистить контракт. Отдельно: карточка может быть «claimed» агентом, но в properties карточки нет ни бейджа claim, ни кнопки `Release`; claim виден только в History как `Claimed by`/`Claim expires`.

**Что ожидает.** Владелец доски/ADMIN может исправить контракт или хотя бы очистить его; видит, что карточка закреплена за агентом, до когда, и может снять claim (с подтверждением и записью в историю).

**Почему блокировано.**

- `ui/src/components/board/CardTaskSpec.tsx:4-20` — компонент read-only; комментарий говорит «without offering an editor the reducer does not back yet». Но reducer уже поддерживает `SET_CARD_TASK_SPEC`: `shared/src/store/board-reducer.ts:2678`; валидатор — `shared/src/store/validate.ts:921`; MCP-инструмент — `mcp/src/tools/cards.ts:733` (`janosik_set_card_task_spec`) и `:773` (сам action).
- В `ui/src/store/BoardContext.tsx` нет действия `setCardTaskSpec`; UI просто не пробрасывает существующий command.
- Claim: в `ui/src/components/board/CardDialog.tsx` нет ни одного упоминания `claimedBy`/`leaseUntil`; отображение только в истории (`ui/src/utils/activity.ts:124-125`). Снять claim можно через MCP `janosik_release_card` или завершив agent-сессию: `backend/src/agent-sessions/agent-sessions.service.ts:248-261` освобождает claims при end. Прямого действия на карточке нет.

**Repro.** Агент ставит DoD из 5 пунктов; человек хочет убрать один пункт — в UI только текст. Агент падает, claim живой; человек открывает карточку — claim не виден; чтобы освободить, нужно идти в `/agents`, найти сессию и завершить её.

**Рекомендуемый фикс.** Продуктовое решение: разрешить человеку редактировать task spec (как минимум board ADMIN/MEMBER) через существующий `SET_CARD_TASK_SPEC`, с записью в Activity и явной атрибуцией «edited by human». Для claim: добавить в карточку pill «Claimed by … until …» и действие `Release claim` для board ADMIN (или владельца карточки), с confirm. Если политика — «контракт принадлежит агенту», нужно явно написать это в UI и дать кнопку «Ask agent to update»/«Clear contract» с audit, иначе владелец доски остаётся без контроля.

**Тесты.** Backend: human command `SET_CARD_TASK_SPEC` (ADMIN/MEMBER/VIEWER), audit, DoD gate после правки. UI: edit/clear task spec, permissions, history. Claim: show/release by ADMIN, release by agent token, last state. E2E: агент ставит контракт → человек правит → MCP move-to-done видит новый DoD.

**Риски.** Атрибуция: если человек меняет контракт, история должна показать автора. Claim release может конфликтовать с работающим агентом — нужен confirm и, возможно, пауза сессии.

---

### G-04 — Черновик комментария теряется при закрытии карточки

**Класс:** real bug / data loss. **P1, S.** **Surface:** normal UI.

**Что видит пользователь.** Пишет длинный комментарий, случайно нажимает `Escape` или крестик (или переходит по `?card=` на другую карточку). Диалог закрывается без вопроса. При повторном открытии поле пустое.

**Что ожидает.** Либо черновик сохраняется и восстанавливается, либо появляется `Discard comment?` с явным подтверждением. Для описания и заголовка карточки такое поведение уже есть.

**Почему блокировано.**

- `ui/src/components/board/CardComments.tsx:96` — `const [draft, setDraft] = useState("")`; нет ни localStorage, ни module-level map, ни flush.
- `ui/src/components/board/CardComments.tsx:184-229` — очистка/восстановление draft только на send/cancel/error; закрытие диалога сюда не попадает.
- `ui/src/components/board/CardDialog.tsx:453-458` — flush описание при unmount; `:516-523` — flush заголовка; для комментария аналогичного flush нет.
- `ui/src/components/board/CardDialog.tsx:758-778` — `onOpenChange`/`onEscapeKeyDown` не проверяют непустой comment draft; `CardActivity.tsx:120-127` монтирует `CardComments` с `key={cardId}`, поэтому смена карточки тоже размонтирует draft.

**Repro.** Открыть карточку → напечатать комментарий → `Escape` → открыть ту же карточку: пусто. То же при переходе на linked card и обратно.

**Рекомендуемый фикс.** Минимум — module-level `Map<cardId, {text, kind}>` (как `heldDrafts` для описания) с восстановлением при mount и очисткой после успешной отправки. Для reload — `sessionStorage`/`localStorage` с TTL. Альтернатива: `onOpenChange(false)` при непустом draft показывает `ConfirmDialog` «Discard comment?»; но это хуже, чем сохранение. Не терять draft и при ошибке send — текущий код уже возвращает текст, это сохранить.

**Тесты.** Component: type → close → reopen → text and kind restored; send clears; cancel clears. E2E: Escape with draft shows either restored text or confirm; linked-card switch. Regression: send failure keeps draft.

**Риски.** Черновик может «переехать» между вкладками; хранить per-card и очищать после отправки. Не хранить секреты в localStorage дольше нужного.

---

### G-05 — Бейджи Comments/History считают загруженную страницу

**Класс:** misleading counts. **P2, S.** **Surface:** normal UI.

**Что видит пользователь.** У карточки 120 комментариев. В заголовке Activity бейдж `Comments 50`; чтобы увидеть остальные, надо нажать `Show older comments`, и бейдж постепенно растёт до 100, 120. У History аналогично: бейдж показывает `visible.length` после fold, а не число событий.

**Что ожидает.** Либо точное `120`, либо честное `50+` / `50 loaded`, либо `Show older` с подписью «50 of 120». Сейчас число выглядит как полное.

**Почему блокировано.**

- `ui/src/components/board/CardActivity.tsx:82-106` — бейдж берёт `commentCount`/`historyCount` из дочерних компонентов.
- `ui/src/components/board/CardComments.tsx:135-136` — `onCountChange(items.length)`; `:244-256` — `Show older` добавляет страницы, поэтому счётчик растёт.
- `ui/src/components/board/CardHistory.tsx:158-164` — `onCountChange(visible.length)`; `:190-206` — пагинация.
- `backend/src/comments/comments.service.ts:230-268` — `CommentPage` содержит только `items` и `nextCursor`, без `total`.

**Repro.** Создать 60+ комментариев (или 60+ activity events) → открыть карточку: бейдж `50`, список показывает 50, `Show older` есть. После загрузки второй страницы бейдж `100`.

**Рекомендуемый фикс.** Быстрый: передавать в `CardActivity` `{count, hasMore}` и рендерить `50+`, если `nextCursor !== null`. Точный: добавить `total` в `CommentPage`/activity page (count-запрос) или отдельный `GET .../count`. Для History `foldHistory` может схлопывать события, поэтому «total» надо определить как число строк после fold, а не сырых activity; лучше явно писать `50+ events`.

**Тесты.** Component: `nextCursor !== null` → `50+`; после `Show older` → `100+`; exact total if API provides. E2E: 60 comments, badge not `50` as a total; docs copy updated.

**Риски.** Дополнительный count-запрос на карточку; для истории fold-логика.

---

### G-06 — Kind комментария: write-once и без фильтра

**Класс:** product gap. **P3, S.** **Surface:** normal UI ↔ REST/MCP.

**Что видит пользователь.** В композере выбирает `blocker`/`question`/`handoff`; после отправки kind показан бейджем. Ошибочно поставил `question` вместо `blocker` — исправить нельзя. В списке нет фильтра «покажи только blockers», хотя бейджи есть.

**Что ожидает.** Может изменить kind (с audit/пометкой edited) или хотя бы отфильтровать комментарии по kind.

**Почему блокировано.**

- `backend/src/comments/comments.controller.ts:44-108` — только create/list/delete, без PATCH.
- `backend/src/comments/comments.service.ts:123` — kind задаётся при create и дальше не меняется; `toCommentDto` (`:424-436`) возвращает kind, но update-пути нет.
- `comments.controller.ts:80-88` — list уже принимает `?kind=`;
- `ui/src/components/board/CardComments.tsx:109` — UI вызывает list без kind; фильтра в компоненте нет.
- `mcp/src/tools/comments.ts:27-51` — MCP list умеет kind, add — только текст/kind, update отсутствует.
- `docs/TASK-176-admin-connections.md:125` — 176.2 явно требует «do not change ... kind», поэтому после запланированного edit комментария kind всё равно останется неизменяемым.

**Repro.** Создать комментарий `question`, попробовать сменить на `blocker` — в UI нет действия; API `PATCH` отсутствует.

**Рекомендуемый фикс.** Расширить 176.2: `PATCH /comments/:id` принимает `{text?, kind?}`; kind меняется с `editedAt` и Activity. Добавить в `CardComments` фильтр-чипы `All / Note / Status / Question / Blocker / Evidence / Handoff` (серверный `?kind=` уже есть) или хотя бы «Show blockers only» при наличии blocker/handoff.

**Тесты.** Backend: kind update author-only, audit, attention semantics; UI: filter, edit kind; E2E: post question → change to blocker → filter. Учесть, что attention-уведомление о blocker уже могло уйти; смена kind не должна повторно его отправлять.

**Риски.** Kind влияет на attention/MCP; менять его нужно осознанно. Если комментарий уже прочитан, «edited» маркер обязателен.

---

### G-07 — Pending invitation нельзя изменить, продлить или переотправить

**Класс:** write path without edit. **P3, S.** **Surface:** normal UI ↔ REST.

**Что видит пользователь.** Пригласил человека с ролью MEMBER/VIEWER и неверным expiry. В блоке «Pending invitations» видит email, роль и кнопку отмены. Чтобы исправить роль или дату, нужно отменить приглашение и создать новое; повторный invite не гарантирует обновление.

**Что ожидает.** В pending-строке — те же role picker/expiry, что у принятого участника; изменение через существующий `PATCH`. Для потерянного письма — resend (сейчас письма приглашения вообще нет — известный gap).

**Почему блокировано.**

- `ui/src/components/board/BoardMembersDialog.tsx:784-822` — pending-строки рендерят только email, роль и `X`.
- `backend/src/boards/boards.controller.ts:277-316` — `PATCH /boards/:id/members/:userId` уже принимает role/expiresAt.
- `ui/src/api/client.ts:915-924` — `updateMember` уже есть.
- `backend/src/boards/boards.service.ts:730-828` — `updateMember` обновляет `BoardMember` и для pending-строки (`acceptedAt` влияет только на публикацию SSE/active guard).

**Repro.** Пригласить `viewer@example.com` как VIEWER до завтра → в pending-блоке нет контролов; `PATCH` с `{role:"MEMBER"}` через API проходит.

**Рекомендуемый фикс.** Добавить в pending-row `RolePicker` и `ExpiryPicker` (для VIEWER), вызывать `updateMember`; после успеха обновить pending list. Для resend нужен отдельный endpoint/письмо, но это уже product decision.

**Тесты.** Component: pending row role change/expiry clear; E2E: admin меняет роль pending-инвайта, invitee принимает уже с новой ролью. Backend: PATCH pending не создаёт accepted member.

**Риски.** Приглашённый мог уже открыть письмо/увидеть старую роль; после accept должна применяться актуальная. Activity/audit для pending update.

---

### G-08 — Revoke share без подтверждения

**Класс:** destructive too easy. **P3, S.** **Surface:** normal UI.

**Что видит пользователь.** В строке share-ссылки кнопка `Revoke`. Один клик — ссылка отозвана, live-зрители отключены, токен больше не работает. В admin-панели та же операция идёт через `ConfirmDialog`; в пользовательском диалоге подтверждения нет.

**Что ожидает.** Confirm с названием ссылки/режимом, особенно для live-ссылки, которая может быть уже разослана.

**Почему блокировано.**

- `ui/src/components/board/ShareDialog.tsx:352-368` — `onClick` сразу вызывает `api.revokeShare`, без `ConfirmDialog`.
- `ui/src/admin/SharesPage.tsx:247-259` — admin-панель использует `ConfirmDialog` с `confirm.body` и `busy`.
- `backend/src/share/board-shares.controller.ts:163-197` — revoke необратим (создаётся `revokedAt`, un-revoke нет).

**Repro.** Создать live-ссылку, нажать `Revoke` — без вопроса; отменить нельзя, можно только создать новую.

**Рекомендуемый фикс.** Общий `ConfirmDialog` для пользовательского и admin-пути; текст «Revoke this link? Anyone using it will lose access immediately.» Для snapshot дополнительно указать, что snapshot останется, но перестанет открываться.

**Тесты.** Component: cancel не вызывает API; confirm вызывает revoke и обновляет список. E2E: live/snapshot revoke; повторный revoke идемпотентен.

**Риски.** Нет; дополнительный клик.

---

### G-09 — Admin shares показывает первые 100 и молчит об остальных

**Класс:** misleading total. **P3, S.** **Surface:** admin UI.

**Что видит пользователь.** Открывает `/admin/shares`; таблица выглядит полной. На инстансе 250 ссылок видит 100, без `N of M`, `Load more` или pagination. Поиск может найти конкретную, но просмотреть все нельзя.

**Что ожидает.** `100 of 250`, Prev/Next или Load more; смена поиска сбрасывает страницу.

**Почему блокировано.**

- `ui/src/admin/SharesPage.tsx:36-39` — `useAdminList(..., {limit: 100})`, но `Pagination` не импортирован/не отрендерен (сравните `EntityPage.tsx:493`).
- `ui/src/admin/use-admin-list.ts:24-46` — state уже содержит `total`, `offset`, `limit`, `setOffset`.
- `backend/src/admin/admin.service.ts:1745-1782` — сервер возвращает `{items, total, limit, offset}`.
- `ui/src/admin/SharesPage.tsx:99-112` — таблица без футера.

**Repro.** На инстансе с >100 share-ссылками (много досок; лимит 5 live + 10 snapshot действует на одну доску) открыть admin shares: 100 строк, total нигде не показан, next нет. В компонентном тесте достаточно замокать 101 строку.

**Рекомендуемый фикс.** Переиспользовать `Pagination` из `EntityPage`/`ui` с `list.total`, `list.offset`, `list.limit`, `list.setOffset`; сохранить поиск; добавить `N of M` в заголовок.

**Тесты.** Component: 101+ mock rows → footer `1–100 of 101`, next page; search resets offset. E2E: page 2.

**Риски.** Производительность при больших total; limit 100 уже capped.

---

### G-10 — Admin shares не показывает expiry; истёкшая ссылка выглядит активной

**Класс:** misleading status. **P3, S.** **Surface:** admin UI.

**Что видит пользователь.** В таблице есть mode, flags, views, created, revoked. Нет expiry и `lastViewedAt`. Ссылка с `expiresAt` в прошлом выглядит как активная (badge только `Revoked`). Support-оператор не понимает, почему ссылка не открывается.

**Что ожидает.** Колонка `Expires`/бейдж `Expired` (и, желательно, `Last viewed`), чтобы отличать active / expired / revoked.

**Почему блокировано.**

- `shared/src/admin.ts:1128-1147` — DTO уже содержит `expiresAt` и `lastViewedAt`.
- `backend/src/admin/admin.service.ts:1758-1778` — сервер их отдаёт.
- `ui/src/admin/SharesPage.tsx:99-112` — колонки `board/mode/flags/views/created/actions`; expiry отсутствует.
- `ui/src/admin/SharesPage.tsx:213-237` — статус только `revokedAt`, expired не проверяется.

**Repro.** Создать share с TTL 1 час, подождать/подменить expiresAt → в admin-таблице нет признака expired; публичный URL уже не работает.

**Рекомендуемый фикс.** Добавить колонку `Expires` с `formatDate`/`—` и badge `Expired` при `expiresAt <= now`; опционально `Last viewed`. `now` заморозить на mount, как в `ShareDialog`.

**Тесты.** Component: expired row badge; active row no badge; no-expiry `—`. E2E: expired link.

**Риски.** Часовые пояса/`now`; не делать `Date.now()` в render без заморозки.

---

### G-11 — Счётчик карточек в board switcher включает архивные

**Класс:** misleading count. **P3, S.** **Surface:** normal UI.

**Что видит пользователь.** В switcher у доски написано `12`, но на доске видно 9 карточек: 3 архивные. После архивации карточки число не уменьшается. В колонках счётчики активные, поэтому цифры не сходятся.

**Что ожидает.** Либо `9` (активные), либо `9 (+3 archived)` / tooltip «12 total, 3 archived».

**Почему блокировано.**

- `ui/src/components/board/BoardSwitcher.tsx:437-439` — `Object.keys(b.cards).length`; архивные карточки остаются в `board.cards`.
- `shared/src/store/board-reducer.ts:1012-1029` — `ARCHIVE_CARD` убирает id из `column.cardIds`, но не удаляет карточку из `cards`.
- `site/src/content/docs/docs/user-guide/boards.md:24-28` — docs называют это «card count» без уточнения.

**Repro.** Доска с 2 карточками, архивировать одну → switcher всё ещё `2`, колонка `1`.

**Рекомендуемый фикс.** Считать `Object.values(b.cards).filter(c => c.archivedAt === undefined).length`; если нужен total — показывать `active/total`. Тест на archive/unarchive.

**Риски.** Пользователи могут привыкнуть к total; выбрать один контракт и подписать.

---

### G-12 — Hover-only удаление комментария и ссылки на карточку

**Класс:** mobile/accessibility gap. **P3, S.** **Surface:** mobile UI.

**Что видит пользователь.** На touch-устройстве кнопка удаления комментария и кнопка удаления card-link имеют `opacity-0` и появляются только по `group-hover`/`focus-visible`. На устройстве без hover они либо невидимы, либо требуют первого tap, который «включает» hover; при этом невидимая кнопка остаётся в hit-area.

**Что ожидает.** На touch действие видно сразу или доступно через long-press/меню; цель не меньше 24×24.

**Почему блокировано.**

- `ui/src/components/board/CardComments.tsx:603-612` — `opacity-0 ... group-hover:opacity-100`, без `no-hover:opacity-100`.
- `ui/src/components/board/CardLinks.tsx:369-386` — то же для remove.
- В проекте есть готовый вариант `@custom-variant no-hover (@media (hover: none))`: `ui/src/index.css:18`.
- Для сравнения: `CardChecklists.tsx:350-359` и `BoardSwitcher.tsx:453-456` уже используют `no-hover:opacity-100`; значит, это не общий дизайн, а пропуск.

**Repro.** Открыть карточку в DevTools с эмуляцией `hover: none` / на телефоне: кнопки удаления не видны, пока не тапнуть область. Нужен браузерный прогон для подтверждения фактического поведения (CSS-факт подтверждён).

**Рекомендуемый фикс.** Добавить `no-hover:opacity-100` к обеим кнопкам; для comment row — показывать действия при `focus-within`; проверить, что невидимая кнопка не перехватывает tap. Для card-link можно оставить hover, но на touch показывать меню.

**Тесты.** Class assertion (как `BoardSwitcher.test.tsx:302-331`); Playwright mobile viewport: delete comment/link доступны без hover.

**Риски.** Визуальный шум в плотном списке; на touch это приемлемо.

---

### G-13 — Файл из «Removed from descriptions» нельзя вернуть, только удалить

**Класс:** UX dead end. **P3, M.** **Surface:** normal UI.

**Что видит пользователь.** Удалил inline-изображение из описания, сохранил. Файл попал в `Removed from descriptions`. Там есть только `Trash`; после reload локальный undo уже недоступен. Вернуть файл в описание нельзя — только загрузить заново (если файл сохранился на диске) или вставить URL вручную.

**Что ожидает.** `Insert back`/`Restore to description` или хотя бы `Download`, чтобы не потерять файл; либо явное «this file is detached; only delete».

**Почему блокировано.**

- `ui/src/components/board/CardAttachments.tsx:354-394` — detached-секция рендерит только `Trash`.
- `backend/src/attachments/attachments.controller.ts:62-238` — маршруты upload/list/content/derivative/delete; нет `PATCH`/re-attach.
- `site/src/content/docs/docs/user-guide/cards.md:128-137` — docs объясняют undo и permanent delete, но не дают путь восстановления после reload.

**Repro.** Вставить изображение в описание → сохранить → удалить из описания → сохранить → reload → открыть `Removed from descriptions`: только удалить.

**Рекомендуемый фикс.** Добавить `Restore to description`: либо клиентский append markdown `![...](.../attachments/<id>/content)` с текущим description (тогда нужен доступ к id), либо серверный `POST /cards/:cardId/attachments/:id/reattach` с проверкой board/card. Дешёвый минимум — `Download` и copy attachment URL.

**Тесты.** Component: restore appends markdown, attachment leaves detached; reload; permissions; лимит 20. E2E: remove → reload → restore → save → image renders.

**Риски.** Reconciliation inline-ссылок, лимиты, чужие вложения; нельзя восстанавливать файл, который уже permanent-deleted.

---

### G-14 — Per-board export есть в API и доках, но не в UI

**Класс:** docs mismatch / missing surface. **P3, S.** **Surface:** normal UI ↔ REST.

**Что видит пользователь.** В Data menu только `Export JSON` — он сериализует все доски в один файл. Если файл превышает 25 MB, пользователь получает отказ и совет использовать `pg_dump`; выгрузить одну проблемную доску нельзя. В документации при этом упомянут «single server board export».

**Что ожидает.** `Export this board` для активной доски; all-boards остаётся отдельным пунктом. Серверный endpoint уже есть.

**Почему блокировано.**

- `backend/src/boards/boards.controller.ts:358-369` — `GET /boards/:id/export` возвращает ровно одну доску, с preflight по размеру.
- `ui/src/components/DataMenu.tsx:85-103` — UI делает `serializeExport(boards)` по всем доскам; вызова `/boards/:id/export` нет.
- `ui/src/api/client.ts` — метода per-board export нет (есть только `requestAccountExport`/`downloadAccountExport`).
- `site/src/content/docs/docs/user-guide/account.md:158-160` — docs говорят про «single server board export» как про существующую возможность.

**Repro.** Открыть Data menu: только all-boards. Через `GET /api/v1/boards/<id>/export` файл одной доски скачивается.

**Рекомендуемый фикс.** Добавить в Data menu `Export this board` (disabled, если доска не открыта) и метод клиента; скачивать blob/JSON, обрабатывать 413 с сообщением. В admin board detail можно добавить ту же ссылку.

**Тесты.** Component: active board → вызов endpoint, имя файла; no board → disabled; 413. E2E: export one board, re-import.

**Риски.** Размер и rate limit; не смешивать с account export.

---

### G-15 — «Permanent» delete — soft-delete, восстановимый мастером

**Класс:** docs mismatch / admin-only recovery. **P2, M.** **Surface:** normal UI ↔ admin.

**Что видит пользователь.** В карточке написано «Delete ... removes the card permanently», в архиве — «Delete forever»; для колонки и доски — «permanently». После подтверждения сущность исчезает из UI; вернуть её пользователь не может. Через 30 дней (retention) её, возможно, удалит purge, но до этого мастер может восстановить её через `/admin` bulk/restore.

**Что ожидает.** Либо настоящее немедленное удаление, либо честная копия: «Hidden; an administrator can restore it within N days». И, желательно, user-facing restore на время retention.

**Почему блокировано.**

- `site/src/content/docs/docs/user-guide/cards.md:154-165` — «removes the card permanently», «Delete forever».
- `site/src/content/docs/docs/user-guide/boards.md:34-40` — board «permanently»; `:68-70` — column «permanently».
- `backend/src/commands/command-writers.ts:801-832` — `DELETE_CARD` ставит `deletedAt`, не удаляет строку; чек-листы/пункты тоже soft-delete.
- `backend/src/admin/admin.service.ts:2277-2285` — мастер восстанавливает `deletedAt = null`; `admin.controller.ts:723` — публичный admin-маршрут restore.
- Пользовательский UI не имеет restore: только локальный undo, который исчезает после reload.

**Repro.** Удалить карточку → reload → в архиве её нет, restore нет. Мастер в `/admin/cards` находит её в фильтре deleted и восстанавливает.

**Рекомендуемый фикс.** Продуктовое решение: либо (а) true purge для пользовательского delete (опасно, ломает soft-delete/audit), либо (б) переписать copy и docs: «Removed from the board. An administrator can restore it during the retention period»; для доски — type-to-confirm названия. Добавить user-facing «Recently deleted» на retention period, если (б).

**Тесты.** Docs/copy snapshot; E2E: delete → reload → copy says restore possible → admin restore; retention purge. Backend: delete/restore permissions.

**Риски.** Privacy/GDPR: пользователь ожидает удаление, а данные лежат 30 дней. Если обещаем permanent, нужна настоящая очистка. Это не security-баг 166.12, а продуктовый контракт.

---

### G-16 — `notifyAttention` и attention-inbox не имеют UI

**Класс:** docs mismatch / product gap. **P2, S/M.** **Surface:** normal UI ↔ REST.

**Что видит пользователь.** В Account → Profile есть только `Scheduled digests and due reminders` (`notifyDigest`). Настройки `notifyAttention` нет, хотя backend её поддерживает и API-доки обещают. Пользователь, которому приходят немедленные письма об approvals/blockers, не может отключить их из приложения. Отдельно: in-app attention-события (approval requested, blocker, claim expired) не показываются в колокольчике; колокольчик — только приглашения.

**Что ожидает.** Тумблер `Immediate attention emails` рядом с digest; счётчик/инбокс attention в колокольчике или отдельной панели; read/read-all.

**Почему блокировано.**

- `backend/src/notifications/notifications.controller.ts:78-89` — `GET/PATCH /users/me/notification-settings` существуют.
- `backend/src/notifications/dto/notification-settings.dto.ts:9-16` — `notifyAttention` принимается.
- `site/src/content/docs/docs/api/index.md:575-576,629` — API-доки описывают `notifyAttention` и endpoint.
- `ui/src/components/account/ProfileSection.tsx:36-60` — UI отправляет только `notifyDigest`.
- `ui/src/components/NotificationsBell.tsx:20-27` — компонент явно про приглашения; attention API в UI не вызывается (grep по `notifications/read`/`notification-settings` в `ui/src` пуст).
- `site/src/content/docs/docs/user-guide/account.md:54-58` — user guide обещает только digest.

**Repro.** Открыть Account → Profile: тумблера attention нет. `PATCH /users/me/notification-settings {"notifyAttention":false}` работает, но только вручную.

**Рекомендуемый фикс.** Минимум — тумблер `Immediate attention emails`, дергающий `PATCH /users/me/notification-settings`; сохранять в `User`/settings и показывать текущее значение. Следующий шаг — attention-инбокс (уже запланирован в 173.6) с read/read-all. Пока инбокса нет, хотя бы показывать badge «N attention» в bell или явно писать в docs, что in-app inbox ещё не отгружен.

**Тесты.** Component: toggle loads/persists; API failure reverts; E2E: opt-out, письмо не уходит (mailpit), digest не затронут. Inbox — отдельный набор.

**Риски.** Дублирование с digest; люди могут отключить важные approval-письма. Нужен явный copy про то, что in-app остаётся.

---

### G-17 — Global search обрезает 20 до группировки

**Класс:** UX dead end. **P3, S.** **Surface:** normal UI.

**Что видит пользователь.** Вводит запрос, который встречается в 20+ карточках. Палитра показывает 20 карточек и **ни одной доски**, даже если название доски точно совпадает. Нет `Show all`, `20 of N` или прокрутки за предел. Пользователь считает, что досок с таким названием нет.

**Что ожидает.** Группы `Cards` и `Boards` строятся по полному результату; cap применяется внутри групп или есть `Show all results` / счётчик.

**Почему блокировано.**

- `ui/src/components/GlobalSearch.tsx:39` — `MAX_RESULTS = 20`.
- `:152-155` — `searchBoards(boards, query).slice(0, MAX_RESULTS)` до группировки.
- `:180-181` — `cardHits`/`boardHits` уже из усечённого массива.
- `ui/src/utils/filter.ts:536` — `searchBoards` возвращает `[...cardHits, ...boardHits]`, то есть карточки идут первыми и вытесняют доски.
- `site/src/content/docs/docs/user-guide/collaboration.md:112-124` — docs обещают группы `Cards` и `Boards` без оговорки о cap.
- `e2e/tests/app/search/global-search.spec.ts:198` — тест фиксирует лимит 20, но не проверяет, что board-hit не исчезает.

**Repro.** Создать 21 карточку с словом `Alpha` и доску `Alpha`; ввести `Alpha`: доска не появляется.

**Рекомендуемый фикс.** Сначала группировать, затем cap каждую группу (например, 20 cards + 5 boards), либо добавить `Show all results` (открыть board search/отдельную страницу) и показывать `20 of N`. Если cap сохраняется, добавлять строку «More results exist» и не терять board-группу.

**Тесты.** Unit: 21 card hits + 1 board hit → board присутствует; E2E: `Show all`/counter. Сохранить существующий лимит как явный контракт, если он продуктовый.

**Риски.** Производительность client-side поиска; не делать бесконечную палитру.

---

### G-18 — Тост «Board exported» при экспорте всех досок

**Класс:** docs/copy mismatch. **P3, S.** **Surface:** normal UI.

**Что видит пользователь.** Нажимает `Export JSON`, получает файл `janosik-boards.json` со всеми досками, но тост говорит `Board exported` (единственное число). Docs говорят «all your boards». Пользователь может решить, что выгрузилась только активная доска, и повторить экспорт.

**Что ожидает.** `All boards exported` или `N boards exported`; для per-board export (G-14) — `Board exported`.

**Почему блокировано.**

- `ui/src/components/DataMenu.tsx:85-103` — `serializeExport(boards)` по всем доскам; `toast.success(t("data.exportSuccess"))`.
- `ui/src/locales/en/translation.json:930` — `"data.exportSuccess": "Board exported"`.
- `site/src/content/docs/docs/user-guide/account.md:158-160` — docs говорят «all your boards».

**Repro.** Export JSON → тост `Board exported`, файл содержит несколько досок.

**Рекомендуемый фикс.** Отдельный ключ `data.exportAllSuccess` с `{count}`; использовать его для all-boards, а `data.exportSuccess` — для per-board (G-14). EN/RU.

**Тесты.** Component: toast text for all-boards and single-board. Docs copy.

**Риски.** Нет.

---

## 4. Quick wins

Это исправления, которые не требуют схемы/продуктового решения (или требуют только UI-решения):

1. **G-01** — `Edit` в `ShareRow`, переиспользовать `CreateForm`; `PATCH` уже есть.
2. **G-04** — module-level draft map + `beforeunload`/confirm; либо `Discard comment?` в `CardDialog`.
3. **G-05** — передавать `hasMore` и показывать `50+`; не обещать точное число без count.
4. **G-07** — role/expiry контролы в pending-row; `updateMember` уже есть.
5. **G-08** — `ConfirmDialog` на revoke.
6. **G-09** — `Pagination` на admin shares; `total` уже в state.
7. **G-10** — колонка `Expires` + badge `Expired`; данные уже в DTO.
8. **G-11** — считать активные карточки; один `filter`.
9. **G-12** — `no-hover:opacity-100` для comment-delete и link-remove.
10. **G-16** — тумблер `notifyAttention` (только PATCH).
11. **G-18** — ключ `exportAllSuccess`.
12. **G-14** — `Export this board` + клиентский метод.
13. **G-06** — фильтр по `kind` (сервер уже поддерживает), если не делать edit kind.
14. **G-03** — как минимум `Clear task spec`/`Edit` через существующий `SET_CARD_TASK_SPEC` (если продукт разрешает).

---

## 5. Product decisions

1. **Кто владеет task spec и claim?** Может ли человек переписать контракт агента? Если да — какая роль, как атрибутировать в History? Если нет — как человек исправляет ошибочный DoD, который блокирует Done? Нужен явный ответ до реализации G-03.
2. **Что значит «удалить навсегда»?** True purge или soft-delete с admin restore? От этого зависит G-15, retention, GDPR и копирайт. Нельзя одновременно обещать «permanently» и хранить 30 дней.
3. **Нужен ли self-leave для MEMBER/VIEWER?** Да/нет; если да — что происходит с их комментариями/вложениями и уведомлениями; как guard last ADMIN (G-02).
4. **Share edit scope.** Разрешать ли менять `includeComments`/`includeAttachments` у уже разосланной live-ссылки? Нужен ли confirm/повторный audit? (G-01).
5. **Detached attachments.** Нужен ли re-attach или достаточно download/delete? Если re-attach — какой контракт ссылки (G-13).
6. **Global search cap.** 20 — продуктовый лимит или техническая защита? Если лимит, нужен `Show all`/`20 of N`; если защита — группировать до cap (G-17).
7. **Attention inbox.** Делать ли полноценный inbox сейчас (173.6) или только opt-out; что показывать в bell (G-16).
8. **Comment moderation.** Должен ли board ADMIN удалять чужие комментарии (сейчас author-only; attachments — uploader-or-admin). Это уже поднято в `launch-gaps-human-control.md` §3.2; решение всё ещё открыто, TASK-176.2 его сознательно не берёт.
9. **User restore.** Нужен ли «Recently deleted» для карточек/колонок/комментариев на retention, или admin-only restore — окончательная модель (G-15).

---

## 6. Already covered / not worth fixing now

Ниже — чтобы не создавать ложного ощущения, что эти пункты пропущены.

**Уже закрыто или запланировано:**

- **Редактирование комментария** — TASK-176.2. Подтверждено: `comments.controller.ts` не имеет PATCH; это не переоткрывается.
- **Bulk selection между страницами, честные счётчики профиля/карточки, ссылки author/actor/inviter, URL-состояние списков, board/column/label filters, per-row actions в admin** — TASK-176.1–176.7. Не дублируется.
- **Admin full card editor / description + move** — TASK-176.8–176.9 (product decision).
- **Admin agent section** — TASK-176.11, сознательно не планируется.
- **Admin shares** — в TASK-176 не входит; G-09/G-10 новые, не дублируют admin-connections audit.
- **Список собственных сессий и 2FA** — `launch-gaps-human-control.md` (P1) и TASK-174.2. Не переоткрывается.
- **Attention inbox** — `launch-gaps-human-control.md` §0.3 #5, TASK-173.6; G-16 добавляет только отсутствующий opt-out, не переоткрывает inbox.
- **Удаление доски без audit и без user restore** — `launch-gaps-human-control.md` §3.2/§4.2. G-15 — новый угол: docs «permanent» для card/column, не повтор аудита.
- **Board filter не сохраняется в URL** — `audits/e2e-filters-views.md` 2.1 (P1). Не дублируется.
- **Calendar DnD при активном фильтре** — `audits/e2e-filters-views.md` C-02 (P0 bug). Не дублируется.
- **Table inline due-date без теста** — `audits/e2e-filters-views.md` T-01 (test gap, не product bug). Не дублируется.
- **Импорт без preview / server backup** — `launch-gaps-human-control.md` §5.4/§5.9.
- **Comment moderation board ADMIN** — `launch-gaps-human-control.md` §3.2 #5; открытое продуктовое решение, не баг.
- **Security-контур** — TASK-166.12; сюда не включались vuln-классы.

**Не стоит чинить сейчас / сознательно оставлено:**

- Полный per-board список «все сущности» в admin — TASK-176.12 (checklist browser) deferred.
- Отдельный top-level checklist-item browser — низкая ценность.
- Массовое редактирование чужих карточек из `/admin` — продуктовая граница, TASK-176.8/176.9.
- Kinds комментариев как отдельная система уведомлений — 173.6.

---

## 7. Suggested next TASK

Компактное предложение после TASK-176. Не смешивать с 166.12 и не трогать board-settings redesign.

**TASK-177 — `human-last-mile` (P2/P3, 6–8 подзадач)**

| ID | Название | Prio | Effort | Суть | Зависимости |
|---|---|---|---|---|---|
| 177.1 | Share link edit | P2 | S | Edit title/flags/expiry через существующий PATCH; confirm для live privacy flags | — |
| 177.2 | Self-leave board | P2 | M | `DELETE /boards/:id/members/me`, Leave в своей строке, last-admin guard, Activity/SSE | — |
| 177.3 | Comment draft safety + honest activity counts | P2 | S | Draft map/confirm + `50+`/`N of M` badges; тест >50 | — |
| 177.4 | Agent-owned card state | P2 | M | Edit/clear task spec; claim pill/release; attribution; product sign-off | 177.3? нет |
| 177.5 | Admin shares truthful list | P3 | S | Pagination, total, Expires/Expired/Last viewed | — |
| 177.6 | Notification preferences | P2 | S/M | `notifyAttention` toggle; inbox surface — после 173.6 | 166.9 |
| 177.7 | Delete semantics + per-board export | P2 | M | Copy/docs для soft-delete; решение о user restore; `Export this board` | product decision |
| 177.8 | Small UX batch | P3 | S | Pending-invite edit, revoke confirm, board count, `no-hover`, export copy, kind filter | — |

**DoD для каждого:** EN/RU copy, unit/component + backend/E2E где есть поведение, `CHANGELOG.md`, никаких ослабленных тестов, keyboard/touch проверка, 390 px для UI.

**Порядок:** 177.1 + 177.3 + 177.5 + 177.8 — один-два маленьких PR; 177.2 — отдельный; 177.4 и 177.7 — только после продуктового решения; 177.6 — после 173.6, если инбокс ещё не готов.

---

## 8. Метод и ограничения

- Прочитаны: `backend/src/**` (controllers, services, DTO, guards), `ui/src/**` (components, admin, store, api client), `shared/src/**` (types, reducer, validate), `mcp/src/tools/**`, `mcp/README.md`, `site/src/content/docs/docs/**`, `CHANGELOG.md`, `ROADMAP.md`, `docs/TASK-176-admin-connections.md`, существующие `audits/**` и `design/**`.
- Проверены реальные маршруты, DTO и вызовы; найденные «мёртвые» API-методы подтверждены grep'ом по `ui/src` (например, `updateShare` не вызывается ни разу).
- Не запускались: Playwright/E2E, backend e2e, миграции, любые записи в БД. Причина: read-only ревью и отсутствие подготовленной сессии; в окружении есть e2e-контейнеры, но создавать пользователя/данные для проверки без разрешения нельзя.
- G-12 (touch) — CSS-факт подтверждён, фактическое поведение на конкретном браузере требует отдельного runtime-check.
- Все остальные пункты — статическая проверка кода/контрактов; там, где вывод зависит от поведения браузера (hover, Radix unmount), это указано в тексте.
