# Управление агентами на доске: полный аудит и редизайн

Дата: 11 ноября 2026.  
Среда: Chromium (Playwright), dark-тема; light — выборочно; viewport 1440×900, 1024×768, 390×844.  
Код: `HEAD c6688f3` поверх `360938b`; рабочее дерево не изменялось.  
Эталон нативного модала: `ui/src/components/board/BoardSettingsDialog.tsx` + `ui/src/components/board/workflow/WorkflowSettings.tsx` и отчёт `design/board-settings-redesign/REPORT.md`.

**Что проверено runtime.** Одноразовая доска `Agent Control Audit` (`cmwc71z8w000zids32lrto81f`), созданная через публичный API на одноразовый аккаунт. На ней: 8 согласований (pending, approved, rejected, cancelled, consumed, expired, expired-во-время-открытия), 7 запусков (batch, single, plan, revert, reverted, applied), 4 сессии (active, waiting approval, stale, session pause), роли ADMIN / MEMBER / VIEWER и PAT. Чужие доски и аккаунты не затрагивались.

**Что проверено только чтением кода.** Лимит >50 согласований, failed-run, SSE-обрыв, экранный диктор, 320 px, Safari/Firefox, реальные touch-события, конкурентные вкладки policy (CAS воспроизведён через API, а не двумя браузерами).

Скриншоты: `screenshots/before-*` — текущее состояние и воспроизведённые баги; `screenshots/after-*` — предложенный дизайн (статический макет, не production-код).

---

## 1. Executive verdict

### 1.1. Что действительно работает

1. **Серверная модель согласования — сильная.** Согласование разрешает ровно один plan hash, одноразово потребляется, живёт по TTL, решение принимает только board ADMIN из браузерной сессии. Проверено на реальном PAT: `DELETE_CARD` → `409 approval_required` → approve → повтор с `X-Approval-Id` → `consumed`. Ошибки `approval_expired`, `approval_not_pending`, `approval_mismatch` обрабатываются.
2. **Откат запусков — лучшая часть продукта.** Есть pre-image, dry-run, конфликты `expectedVersion → currentVersion`, атомарный apply, отдельный audit-run. Проверено: план из двух `ADD_CARD` после ручной правки карточки даёт `canRevert=false` и конфликт `card:… · recreated · 0 → 3`.
3. **Семантика паузы описана честно.** In-flight завершаются, новые записи получают `403 agent_paused`, чтение/heartbeat/end доступны, claims не освобождаются. Это видно и в копирайте, и в коде, и в поведении.
4. **CAS политики и серверные лимиты.** Версия, `version_conflict`, min(global hard limit, policy), безопасные умолчания, запрет PAT на policy — всё есть.
5. **SSE и состояния.** Согласования, запуски и сессии обновляются live-событиями; скелетоны, empty-state и retry есть почти везде.
6. **Тестовая инфраструктура.** E2E покрывают approve/reject/consume/expire, pause/resume, rollback, policy CAS и permissions.

### 1.2. Что сломано или сбивает

1. **Три разных числа для одной правды.** В шапке доски badge = 1 pending; в модале chip «Pending» после переключения на All показывает 8 (все согласования); `/agents` показывает 0 waiting approval. Bell вообще не знает о согласованиях — это список приглашений. Один и тот же вопрос «сколько ждёт человека?» получает три ответа.
2. **MEMBER/VIEWER видят вкладку, которая гарантированно падает.** API `GET /boards/:id/approvals` для не-ADMIN возвращает 403 (`backend/src/approvals/approvals.service.ts:161-164`), а UI показывает вкладку и на 403 рисует «Could not load the approval queue» + бесполезный Retry. Юнит-тест маскирует это, мокая `listApprovals` успешным для MEMBER (`AgentControlDialog.test.tsx:252-268`).
3. **Нет защиты черновика.** В policy можно изменить пять полей, нажать X — и всё потерять без подтверждения. В approvals можно начать вводить комментарий к решению и потерять его так же. Board Settings в этом смысле уже правильный: `dirty` + ConfirmDialog (`BoardSettingsDialog.tsx:59-66`), а Agent control — нет.
4. **Истёкшее согласование продолжает предлагать Approve.** Если TTL истёк, пока модал открыт, список и деталь не перезапрашиваются; кнопка Approve остаётся. Нажатие даёт toast «This approval has expired», после чего выбранная строка исчезает из фильтра Pending, а деталь остаётся — orphan detail без строки в списке. Это воспроизведено.
5. **Policy — это отдельное приложение внутри модала.** 17 чекбоксов с техническими ключами, дублирующий блок «Effective limits» + те же поля ниже, Save без dirty, CAS-ошибка без кнопки Reload, Save и Reset уезжают за экран. Для сравнения: Board Settings — одна поверхность, липкий футер, «Все изменения сохранены», Revert/Save.
6. **Мобильный shell не соответствует ни Board Settings, ни Account.** При 390 px диалог 366×736 с 12 px полями и `border-radius: 0`; вкладки переносятся на 2 строки, причём активная — 24 px, остальные — 40 px; close — 16×16; очередь и деталь — два вложенных скролла.
7. **Клавиатура и фокус.** Вкладки — `role="group"` + `aria-pressed`, а не `tablist`; стрелки не работают, Tab проходит по всем четырём; после Escape фокус уходит в `BODY`, а не на кнопку-триггер. Измерено.

### 1.3. Почему это ощущается «не как Janosik»

| Признак | Board Settings (эталон) | Agent control (сейчас) |
|---|---|---|
| Поверхность | Одна поверхность, тонкие разделители, без вложенных карточек | Градиентная шапка, pill-вкладки, затем 4 независимых панели со своими карточками |
| Типографика | 18/600 заголовок, 12.5 подзаголовок, 12–13 тело, 11 мета | 16 заголовок, 12 тело, 10–11 мета, 10 px uppercase-лейблы |
| Действия | Липкий футер: статус, Revert, Save | Футера нет; Save/Reset в конце длинного скролла, Approve — внизу детали |
| Навигация | Рельс колонок + вкладка «Матрица» | Четыре равные вкладки: срочное, операционное, аудит и конфигурация в одном ряду |
| Язык | «Правило», «роль», «условие» | «Apply DELETE_CARD (1 command)», «Run», «Pre-image», сырой JSON, UUID |
| Цвет | Один акцент + янтарный для условий + зелёный для «действует» | Синий, зелёный approve, красный reject, жёлтая залитая «Pause agents», ещё градиент |
| Мобильный | Полноэкранный `100dvh`, липкий футер | Плавающий прямоугольник 366×736, квадратные углы, перенос вкладок |
| Иконки | Шестерёнка — `LazyAnimatedIcon` | Две одинаковые статические `lucide-bot` рядом, одна ведёт на `/agents`, другая открывает модал |

Agent control выглядит как **отдельная админ-консоль**, вставленная в доску: у неё свой язык, своя плотность, свои правила навигации и своя правда о количестве согласований.

### 1.4. Вердикт по IA (кратко)

- **Остаться модалом**, не становиться страницей: решение по согласованию требует контекста доски и быстрого возврата.
- **Разделить ответственность:** board-модал — Inbox / Live / Runs; policy — в Board Settings; кросс-бордовые согласования и все сессии — в `/agents`; токены — в Account.
- **Один Bot-icon** в шапке доски. Второй (глобальный) убрать; `/agents` открывать из шапки консоли и из Account.
- **Один источник счётчиков:** pending approvals, а не длина списка и не статус сессии.

---

## 2. Полная инвентаризация

Легенда: **A** — ADMIN, **M** — MEMBER, **V** — VIEWER, **PAT** — API-ключ. «Состояния» — loading / empty / error / permission / expiry, если применимо.

### 2.1. Shell и точки входа

| Контрол | Сейчас | Права | Состояния | Проблема |
|---|---|---|---|---|
| `agents-trigger` (Bot) в шапке | Ссылка на `/agents`; без badge; тот же `lucide-bot`, что у контроля | A/M/V | — | Дублирует иконку; пользователь не понимает, какая из двух «агенты» |
| `agent-control-trigger` (Bot) | Открывает модал; badge pending; для M/V testid `agent-runs-trigger`, стартует с Runs | A/M/V | badge 0/1/50 | Badge ограничен 50; при 120 pending покажет 50, «99+» недостижим |
| `board-settings-trigger` (шестерёнка) | Board Settings; `LazyAnimatedIcon` | A | — | Единственная анимированная иконка в этом кластере — визуальный диссонанс |
| Ленивый chunk модала | `Suspense fallback={null}` | все | loading | Клик по иконке ничего не показывает, пока чанк грузится; при ошибке — мёртвая кнопка |
| `DialogContent` | 1024×736 при 1440; 1000×736 при 1024; 366×736 при 390; `rounded-xl` | все | — | Не использует высоту экрана; на 390 — не full-screen и 0 radius |
| Header | Градиент `primary/secondary`, title 16, description 12 | все | — | Не как Board Settings; description для M/V читается как «вам здесь ничего нельзя» |
| Вкладки | `role="group"`, `aria-pressed`, 24 px высота, 4 шт. | A: 4; M/V: 3 | active | Не `tablist`; стрелки не работают; Policy скрыта, Approvals — нет |
| Body | `overflow-hidden`, каждая панель скроллится сама | все | — | Вложенные скроллы; нет единого футера |
| Close X | Встроенный Radix close, 16×16, без padding | все | — | Цель 16 px; нет dirty-confirm; фокус после закрытия — `BODY` |
| Escape | Закрывает | все | — | Нет подтверждения при несохранённых данных |
| Клик по overlay | Закрывает (Radix default) | все | — | Случайное закрытие с потерей черновика |
| Футер | Отсутствует | — | — | Нет статуса, сохранения, «next pending», контекстного действия |
| Deep link | Нет | — | — | Нельзя дать ссылку на согласование/запуск; refresh закрывает модал |
| Mobile | 366×736, 12 px поля, tabs 24/40, close 16 | все | — | См. B-13/B-14 |

### 2.2. Approvals

| Секция / контрол | Сейчас | Права | Состояния | Проблема |
|---|---|---|---|---|
| Вкладка Approvals | Видна всем | A/M/V | — | M/V получают 403 и generic error + Retry |
| Фильтр Pending / All | Два pill-button; `aria-pressed` | A/M/V | active | Нет поиска, kind/risk/date, refresh, пагинации |
| Счётчик на «Pending» | `rows.length` в любом фильтре | — | — | В All показывает все 8, а не 1 pending (B-02) |
| Подсказка «A decision authorizes…» | Статичный текст | — | — | Занимает место, не помогает принять решение |
| Loading очереди | 3 скелетона | — | loading | Нормально |
| Error очереди | Иконка, текст, Retry | — | error/permission | Permission неотличим от сети; Retry при 403 бессмыслен |
| Empty Pending | Зелёная галочка + текст | — | empty | Нет CTA «All»/«Refresh»/«Create API key» |
| Empty All | Тот же блок | — | empty | Нет CTA |
| Строка очереди | Summary, status, risk, kind, `#card.title`, relative time | A/M/V | selected | Summary обрезается; card title в 10 px; `#` — ложный номер; нет агента/TTL |
| Status badge строки | 10 px uppercase | — | все 6 | Цвет + текст; expired/cancelled одинаково серые |
| Risk badge | 10 px uppercase + ShieldAlert | — | low/med/high | «Medium risk» у destructive DELETE_CARD может занижать ставку |
| Kind label | Destructive / Done / Custom | — | — | Технический термин |
| Card meta | `cardFor(row.cardId)?.title` или «Board-level request» | — | card deleted | После consumed карточка удалена → пишет «Board-level request», хотя запрос был card-level |
| Detail header | Summary, kind, plan count, risk/status | A/M/V | 6 статусов | Нет человеческого предложения и impact |
| Read-only banner | Для не-ADMIN | M/V | — | Недостижим: list/detail уже 403 |
| Approved hint | «Waiting for agent» | — | approved | Верно |
| Consumed hint | «Applied by agent» | — | consumed | Верно |
| Expired hint | «Server will mark on next read» | — | expired | Формулировка перекладывает работу на человека |
| Meta: requestedBy | Имя board member | — | — | Нет имени агента/токена/сессии; только UUID токена и сессии |
| Meta: token | Сырой `cmwc…` | — | — | Нет имени токена, ссылки, копирования |
| Meta: session | Сырой `cmwc…` или «No session» | — | — | Нет ссылки на сессию/`/agents` |
| Meta: card | Название или UUID | — | deleted | UUID вместо «Card deleted by this approval» |
| Meta: expires | Дата + relative | — | все | Показывается даже для consumed/cancelled; нет countdown/просрочки |
| Meta: decidedBy | Имя или «Not decided» | — | cancelled | У cancelled одновременно «Not decided» и «Decided <time>» (B-15) |
| Meta: decidedAt/consumedAt | Даты | — | — | Нет истории «кто → что → когда» |
| Meta: run | UUID | — | consumed | Нет ссылки на run |
| Comment view | Текст решения | — | approved/rejected | Нормально |
| PlanBlock commands | `<pre>{JSON.stringify(action)}</pre>` | A | — | Сырой JSON — главный контент; нет diff/impact |
| PlanBlock operations | `<pre>{target,body}</pre>` | A | — | То же |
| Plan hash | 64 символа в `<code>` | A | — | Нет copy, нет «Integrity»-раскрытия; доминирует визуально |
| Approve | Зелёная кнопка → inline form | A | pending, not expired | Нет подтверждения impact; contrast white/#10b981 ≈2.5:1 |
| Reject | Outline red → inline form | A | pending | Комментарий необязателен; аудит без причины |
| Comment | Textarea 2 строки, max 2000 | A | — | Автофокус; при закрытии теряется |
| Confirm / Cancel | Кнопки формы | A | submitting | Двухшаговая модель ок, но Cancel имеет accessible name, конфликтующий с строкой «Cancel me» |
| Успех решения | Toast + `setFilter("all")` + revision | A | — | Фильтр меняется под пользователем; счётчик становится ещё более ложным |
| Ошибка решения | Toast + revision | A | expired/conflict | Строка исчезает, detail остаётся — orphan (B-03) |
| Retry списка/детали | Только при error | — | error | Нет refresh при SSE-обрыве |
| Cancel request | Нет | A/PAT | — | API `POST /approvals/:id/cancel` есть, UI нет |
| Copy hash/link | Нет | — | — | Нельзя передать согласование коллеге |
| Bulk actions | Нет | — | — | Для low-risk, возможно, не нужны; для очереди 20+ нужен «next pending» |

### 2.3. Pause & sessions

| Секция / контрол | Сейчас | Права | Состояния | Проблема |
|---|---|---|---|---|
| Board status | Running / Paused pill | A/M/V | 2 | Нормально |
| Paused banner | Since + reason | A/M/V | paused | Нет `pausedBy` (кто остановил) |
| Reason textarea | Виден всегда; label «Reason (optional)», placeholder «Why are you pausing?» | A | running/paused | При paused стоит рядом с Resume и выглядит как причина возобновления; вводится в пустоту |
| Pause agents | Жёлтая filled-кнопка, без confirm | A | running | Мгновенно останавливает всех агентов доски; самый громкий цвет в модале |
| Resume agents | Зелёная filled-кнопка | A | paused | `api.resumeBoardAgents(boardId)` не передаёт reason; измерено body `{}` |
| Semantics | Абзац про in-flight/403/claims | все | — | Хороший текст, но визуально — ещё одна рамка |
| Read-only | Текст «Only a board admin…» | M/V | — | Нет ссылки на админа/запрос |
| Sessions header | «Active sessions (4)» | A/M/V | — | Считает stale-сессии «активными» (B-09) |
| Refresh | Кнопка с иконкой Refresh и текстом **Retry** | A/M/V | — | Неверный глагол; выглядит как retry ошибки |
| Loading/error/empty | Skeleton / error+Retry / empty | — | — | Нормально, кроме copy |
| Session name/status | Bot icon, name, status, stale, pause scope | все | 6 статусов | Waiting approval — серый, хотя это самый важный статус |
| Client/model | «cursor · claude-sonnet» | все | — | Нет версии/модели отдельно; ок |
| Token/heartbeat | Сырой token UUID + relative heartbeat | все | — | Нет имени токена, ссылки, session age |
| Current card/run | Не показываются | — | — | DTO содержит `currentCardId`/`currentRunId`, UI игнорирует |
| Paused reason | Текст | все | paused | Нормально |
| Paused by board/token | Пояснение под строкой | все | paused | При board pause повторяется в каждой строке (B-19) |
| Pause session | Кнопка → inline reason | A | not paused | Дублирует `AgentActionDialog`; нет confirm, нет end |
| Resume session | Кнопка | A | session paused | Нормально; reason-поле отсутствует |
| End session | Нет | A | — | API и `/agents` умеют; в board-модале тупик |
| Kill/revoke | Нет | owner | — | Только Account → API keys; текст без ссылки |
| Token hint | «Token-level pause, stop-all and kill are in Account → API keys» | все | — | Нет ссылки; для MEMBER токен может быть чужим |
| Claims | Текст «pause does not release claims» | все | — | Нет действия «Release claim»; человек не может освободить карточку |

### 2.4. Runs & rollback

| Секция / контрол | Сейчас | Права | Состояния | Проблема |
|---|---|---|---|---|
| Status / Kind / Time selects | 3 селекта | A/M/V | all | Нормально, но 10 px лейблы |
| Token filter | Free-text input «Token id» | A/M/V | — | Пользователь не знает UUID; нет select/autocomplete |
| Session filter | Free-text input «Session id» | A/M/V | — | То же |
| Clear filters | Нет | — | — | После 5 фильтров нет способа сбросить одним действием |
| List loading/error/empty | Skeleton / error+Retry / empty | — | — | Нормально |
| Run row | ID 10 chars, status, kind, «1 commands», time, token/session | A/M/V | applied/reverted/failed | «1 commands»; нет human summary/actor; selection слабо видна |
| Load more | «Показать ещё» при `rows.length===50` | — | — | Нет total/next cursor; ровно 50 даст пустую страницу |
| Detail loading | Skeleton | — | — | Нормально |
| Detail error | Текст «Could not load this run» | — | error | **Нет Retry** — тупик |
| Header | Run ID, status, kind, counts/seq | — | — | ID доминирует; нет human summary |
| Timeline | Created / Applied / Reverted / revertsRunId | — | — | Нет duration, нет actor |
| Attribution | actorId, token, session — UUID | — | — | Нет имён/ссылок |
| Authorization | plan hash, approval ID, clientRunId | — | — | Нет ссылки на approval |
| Commands | action type, entity title, actor, token/session | — | — | Нет before→after diff; preimage отдельно |
| Pre-image | `<details>` с JSON | A | — | Сырой JSON; для M/V скрыт |
| Rollback section | Заголовок + hint | все | applied/reverted/failed | У failed/reverted остаётся пустая карточка |
| Preview | Auto для applied; can/cannot + conflicts + diff | все | loading/error | Хорошая механика; diff — сырой JSON |
| Conflicts | touch/reason/version | A | conflict | Хорошо; нет ссылки на сущность |
| Revert button | Outline | A | canRevert | Нет tooltip при disabled |
| Non-admin note | Текст | M/V | — | Нормально |
| Already reverted | Текст | — | — | Нормально |
| Refresh preview | Ghost-кнопка | A | — | Нормально |
| Preimages section | JSON всего run | A | — | Дублирует per-command preimage; очень шумно |
| Revert-run hint | Текст | — | revert | Нормально |
| Confirm dialog | Title/description + Cancel/Revert | A | — | Кнопка **синяя**, не destructive; нет impact/conflicts summary; run id сырой |
| `run.reverted` SSE | Refetch list+detail | — | — | Нормально |

### 2.5. Policy & limits

| Секция / контрол | Сейчас | Права | Состояния | Проблема |
|---|---|---|---|---|
| Вкладка Policy | Скрыта для M/V | A | — | Read-only ветка в `PolicyPanel` недостижима (мёртвый код) |
| Header/version | Title, description, «Version N» | A | — | Нет who/when последнего изменения |
| Pause card | Running/Paused + explanation | A | 2 | Дублирует Live; нет ссылки на Live |
| Effective limits | 3 read-only карточки | A | — | Дублируют поля ниже; при dirty показывают старые значения |
| Destructive select | Require approval / Block | A | — | Хорошо; но hint не объясняет, что чекбоксы destructive ниже инертны |
| Require list | 17 чекбоксов, human label + raw key | A | — | Для destructive-действий чекбокс ничего не меняет (B-07); сырые ключи шумят |
| Approver roles | Текст «board ADMINs only (fixed)» | A | — | Ок, если это product decision |
| Limit inputs | 3 NumberStepper | A | valid/invalid | Нет dirty; Effective-блок не обновляется |
| Save | Primary, enabled при valid, даже без изменений | A | saving/error | Нет dirty; CAS-ошибка без reload; кнопка уезжает за экран |
| Reset | Outline + ConfirmDialog | A | — | Enabled даже когда policy уже null/defaults |
| Defaults badge | AlertTriangle + «Using defaults» | A | — | Warning-иконка у безопасного состояния |
| Load error/retry | Текст + Retry | — | error | Нормально |
| Save error | Inline red text | A | error | Нет retry/reload; остаётся после правок |
| CAS conflict | «changed in another tab (now version N). Reload and try again.» | A | conflict | Кнопки Reload нет; Save ниже экрана |
| Foreign change live | Нет | — | — | Узнаём только при Save |
| Dirty guard | Нет | — | — | X/Escape/overlay теряют всё |
| Mobile | 3 эффективных карточки столбиком, Save в конце | A | — | 3+ экрана скролла без футера |

### 2.6. Интеграции

| Точка | Сейчас | Проблема |
|---|---|---|
| Шапка доски | Два Bot-icon: `/agents` и modal | Дублирование; разная семантика при одинаковой иконке |
| `/agents` | Stats: agents/live/waiting/stale; waiting = sessions со статусом `waiting_approval` | Не считает approvals; 0 при pending 1 (`AgentsPage.tsx:74-83`) |
| `/agents` empty | Текст без CTA | Нет «Create API key»; тупик первого запуска (`AgentsPage.tsx:325-332`) |
| Bell | `NotificationsBell` = список приглашений, poll 30 s | Согласования не приходят; badge нет (`NotificationsBell.tsx:54-74`) |
| Account → API keys | Token pause, Stop all, Revoke, Edit | Дублирует часть board-модала; из модала нет ссылки |
| Board settings | Только workflow | Policy не имеет дома; логичное место — Agents & automation |
| Session detail `/agents/:tokenId` | Pause/Resume/End через `AgentActionDialog` | Board-модал не переиспользует этот диалог |
| Deep links | Нет | Ни approval → card/run, ни run → approval, ни session → /agents |
| Count sync | badge, chip, /agents — три разных источника | Нет единого pending-count |

### 2.7. Матрица прав (фактическая)

| Действие | ADMIN (JWT) | MEMBER (JWT) | VIEWER (JWT) | PAT |
|---|---|---|---|---|
| Список согласований доски | да | **403** | **403** | только свои |
| Деталь/план согласования | да | **403** | **403** | только свои |
| Approve/Reject | да | нет | нет | нет (`pat_forbidden`) |
| Cancel approval | да | нет | нет | создатель |
| Board pause/resume | да | нет | нет | нет |
| Session list | да | да | да | да (observer+) |
| Session pause/resume | да | нет | нет | нет |
| Session end | да | нет | нет | владелец токена |
| Runs list/detail | да | да | да | да, без preimage |
| Revert preview | да | да | да | да |
| Revert apply | да | нет | нет | нет |
| Preimages/diff | да | нет | нет | нет |
| Policy read/update | да | нет | нет | нет |
| Token pause/stop-all/revoke | владелец | владелец | владелец | нет |

---

## 3. Воспроизведённые баги и UX-тупики

Severity: **P0** — блокирует сценарий/вводит в заблуждение; **P1** — потеря данных или неверная правда; **P2** — заметные трения/тупик; **P3** — полировка.

Пометка **(код)** означает, что дефект подтверждён чтением исходников, а не воспроизведён в браузере; остальные пункты воспроизведены runtime.

### B-01 · P0 · MEMBER/VIEWER получают вечный error в Approvals

**Шаги.** Войти MEMBER (или VIEWER) → открыть доску → Bot → вкладка Approvals.  
**Ожидалось.** Вкладка скрыта, либо read-only объяснение «решения принимает ADMIN».  
**Фактически.** «Could not load the approval queue» + Retry; деталь справа «Select an approval…». Два 403 в консоли. Retry повторяет 403.  
**Код.** `AgentControlDialog.tsx:61-66,110-128` (вкладка не фильтруется по роли), `approvals.service.ts:161-164` (list запрещён не-ADMIN), `approvals.service.ts:192-199` (detail запрещён).  
**Тест-ловушка.** `AgentControlDialog.test.tsx:252-268` мокает успешный `listApprovals` для MEMBER — тест зелёный, runtime мёртвый.  
**Скриншот.** `screenshots/before-06-member-approvals-error.png`.

### B-02 · P1 · «Pending» показывает все согласования

**Шаги.** Открыть Approvals → нажать All.  
**Ожидалось.** «Pending 1» — количество ожидающих.  
**Фактически.** «Pending 8»: в `rows` лежат все 8, а счётчик берёт `rows.length` независимо от фильтра.  
**Код.** `ApprovalsPanel.tsx:567-571`; тот же `rows.length` используется после auto-switch на All (`:510-514`).  
**Скриншот.** `screenshots/before-03-approvals-count-bug.png`; в шапке badge = 1, в `/agents` — 0.

### B-03 · P1 · Истёкшее согласование всё ещё предлагает Approve; после ошибки — orphan detail

**Шаги.** Открыть pending-согласование → в БД (disposable) сдвинуть `expiresAt` в прошлое → нажать Approve → Confirm.  
**Ожидалось.** Кнопка недоступна/статус Expired сразу; деталь остаётся связанной со списком.  
**Фактически.** До клика: status Pending, expiry «in 60 minutes», Approve доступен. После клика: toast «This approval has expired», деталь Expired, а в списке Pending выбранной строки уже нет — деталь висит без строки.  
**Код.** `ApprovalsPanel.tsx:487-495` (expiry считается только из загруженного `detail`), `:128-135` (`useNow` 30 s, но список не перезапрашивается), `:509-514` (фильтр переключается только при успехе), `:522-525` (на ошибке только revision).  
**Скриншоты.** `screenshots/before-26-approval-before-expiry.png`, `screenshots/before-05-approval-expired-click.png`.

### B-04 · P1 · Policy: закрытие с черновиком теряет изменения без подтверждения

**Шаги.** Policy → изменить Max commands 100→42 → X.  
**Ожидалось.** Confirm «Discard changes?» как в Board Settings.  
**Фактически.** Диалог закрывается; при повторном открытии снова 100.  
**Код.** `PolicyPanel.tsx:124-151,207-230` (нет dirty/baseline), `AgentControlDialog.tsx:36-48` (unmount = reset), сравнить `BoardSettingsDialog.tsx:59-66`.  
**Скриншоты.** `screenshots/before-13-policy-dirty.png`, `screenshots/before-15-policy-discarded.png`.

### B-05 · P1 · CAS-конфликт говорит «Reload», но кнопки Reload нет

**Шаги.** Открыть Policy → изменить значение → другим админом (API) поднять version → Save.  
**Ожидалось.** Inline-баннер с кнопкой «Reload policy» и сохранённым черновиком.  
**Фактически.** «The policy changed in another tab (now version 2). Reload and try again.»; кнопки Reload нет; Save/Reset находятся ниже видимой области; повторный Save снова упадёт с тем же.  
**Код.** `PolicyPanel.tsx:100-122` (текст), `:224-229` (saveError), `:560-592` (футер без reload).  
**Скриншот.** `screenshots/before-14-policy-cas-conflict.png`.

### B-06 · P2 · Save активен без изменений; Effective limits противоречат полям

**Шаги.** Открыть Policy, ничего не менять → Save активен. Изменить Max commands на 42 → блок «Effective limits» всё ещё 100.  
**Ожидалось.** Save disabled при clean; Effective показывает текущее сохранённое, а draft явно помечен «Unsaved».  
**Фактически.** Save enabled (`saveDisabled:false`), `dirtyMarkers:0`; два разных значения на одном экране без подписи.  
**Код.** `PolicyPanel.tsx:180-192` (draft), `:365-401` (effective), `:473-548` (inputs), `:560-574` (save disabled только по valid/saving).  
**Скриншот.** `screenshots/before-13-policy-dirty.png`.

### B-07 · P2 · Чекбоксы destructive-действий ничего не меняют

**Шаги.** В Policy «Delete a card» не отмечен; всё равно DELETE_CARD создаёт approval.  
**Ожидалось.** Либо чекбокс управляет поведением, либо его нет/он disabled с пояснением.  
**Фактически.** `evaluateAgentRule` сначала обрабатывает `rule.destructive` и возвращает approval/deny, не глядя на `requireApprovalFor`. Чекбоксы `delete_card`, `delete_column`, `delete_label`, … — мёртвые.  
**Код.** `backend/src/auth/token-scope.ts:453-465`; список в `PolicyPanel.tsx:436-471`; default policy не включает `delete_card` (`token-scope.ts:60-73`), но approval создаётся.  
**Скриншот.** `screenshots/before-12-policy.png` (Delete a card не отмечен) + `before-02` (destructive approval).

### B-08 · P2 · Board pause без подтверждения; reason при Resume игнорируется

**Шаги.** Pause & sessions → ввести причину → Pause agents. Затем ввести другую причину → Resume agents.  
**Ожидалось.** Для pause — confirm с impact; для resume — либо причина не показывается, либо передаётся.  
**Фактически.** Pause срабатывает сразу, 0 confirm-диалогов; Resume отправляет body `{}`, введённый текст исчезает.  
**Код.** `PausePanel.tsx:495-544` (одно поле на оба действия), `:382` (`resumeBoardAgents(boardId)` без reason).  
**Скриншоты.** `screenshots/before-08-board-paused.png`, `before-07-pause.png`.

### B-09 · P2 · «Active sessions (4)» включает stale; нет End session; refresh называется Retry

**Шаги.** Открыть Pause & sessions.  
**Ожидалось.** «Sessions (4)» или «Live 1 · Stale 3»; для stale — End; refresh — Refresh.  
**Фактически.** «Active sessions (4)», 3 из 4 со badge Stale; единственные действия — Pause/Resume; кнопка обновления подписана «Retry».  
**Код.** `PausePanel.tsx:445` (`sessions.length`), `:151-155` (stale badge), `:193-225` (только pause/resume), `:565-574` (Retry). End API есть: `agent-sessions.controller.ts:65-83`; UI есть в `AgentActionDialog.tsx:71-90`.  
**Скриншот.** `screenshots/before-07-pause.png`.

### B-10 · P2 · Runs: фильтры по сырым UUID; «1 commands»; detail error без Retry **(detail error — код)**

**Шаги.** Runs → посмотреть фильтры; выбрать run; отключить сеть/вызвать ошибку детали.  
**Ожидалось.** Token/session — select с именами; «1 command»; у ошибки детали — Retry.  
**Фактически.** Два free-text поля «Token id»/«Session id»; «1 commands · 3 minutes ago»; при `detailError` только красный текст, без кнопки.  
**Код.** `RunsPanel.tsx:431-450` (inputs), `:528-533` (`rowMeta`), `:569-573` (detail error).  
**Скриншот.** `screenshots/before-09-runs.png`.

### B-11 · P2 · Revert confirm: синяя кнопка и нет impact/conflicts

**Шаги.** Выбрать applied-run без конфликтов → Revert run.  
**Ожидалось.** Destructive-confirm: сколько команд, что изменится, конфликты, «Roll back» danger/outline.  
**Фактически.** Кнопка `Revert run` с `background rgb(59,130,246)` (primary), в описании только run id; конфликты не перечислены.  
**Код.** `RunsPanel.tsx:884-924`, кнопка `:909-921` без `variant="destructive"`.  
**Скриншот.** `screenshots/before-11-revert-confirm.png`.

### B-12 · P2 · Две одинаковые Bot-иконки с разной семантикой

**Шаги.** Посмотреть шапку доски.  
**Ожидалось.** Одна точка входа «Агенты» или две визуально разные.  
**Фактически.** Два `lucide-bot h-5 w-5` подряд (x=366 и x=414): первая — ссылка `/agents`, вторая — модал с badge. Шестерёнка справа — анимированная, боты — статические.  
**Код.** `Header.tsx:71-94`; `AgentControlButton.tsx:62-85`; `LazyAnimatedIcon` только у settings (`Header.tsx:105`).  
**Скриншот.** `screenshots/before-01-header-two-bots.png`.

### B-13 · P2 · Мобильный shell: не full-screen, вкладки разной высоты, вложенный скролл

**Шаги.** 390×844 → открыть модал.  
**Ожидалось.** `100dvh`, full width, один скролл, вкладки 44 px без переноса, close ≥44 px.  
**Фактически.** 366×736, 12 px поля, radius 0; tabs: Approvals 24 px, остальные 40 px, текст в 2 строки; close 16×16; очередь и деталь — два скролла; деталь начинается в середине экрана.  
**Код.** `AgentControlDialog.tsx:92`; сравнить `BoardSettingsDialog.tsx:93` (`max-md:h-[100dvh] …`).  
**Скриншоты.** `screenshots/before-19-mobile-shell-annotated.png`, `before-20-mobile-policy.png`; для сравнения `before-18`.

### B-14 · P2 · Фокус возвращается в BODY; вкладки не tablist; стрелки не работают

**Шаги.** Открыть модал → Escape; снова открыть → сфокусировать вкладку → ArrowRight; Tab 12 раз.  
**Ожидалось.** Фокус на триггере; `tablist`/`tab`/`tabpanel`; стрелки/Home/End; roving tabindex.  
**Фактически.** `activeElement = BODY` после Escape; ArrowRight не меняет вкладку; Tab проходит все 4 вкладки, затем фильтры/строку/кнопки; `aria-pressed` вместо `aria-selected`. Close 16×16, tabs 24 px.  
**Код.** `AgentControlDialog.tsx:104-131`; `dialog.tsx:64-74`; в `BoardSettingsDialog.tsx:45-57` возврат фокуса реализован явно.  
**Скриншот.** `screenshots/before-19-mobile-shell-annotated.png` (размеры); данных фокуса — в тексте.

### B-15 · P3 · Cancelled: «Not decided» + «Decided» + Expires; consumed: UUID вместо карточки

**Шаги.** Открыть cancelled, затем consumed.  
**Ожидалось.** «Cancelled by requester at …», без Expires; «Card deleted by this approval · Run …».  
**Фактически.** Cancelled: `Decided by: Not decided`, `Decided: 11/11/26, 5:14 PM`, `Expires: …`. Consumed: `Card: 72afd94c-…` и строка очереди «Board-level request».  
**Код.** `ApprovalsPanel.tsx:750-757` (card fallback UUID), `:646-652` (board-only), `:759-782` (Expires/DecidedBy/DecidedAt без учёта cancelled).  
**Скриншоты.** `screenshots/before-24-approval-cancelled.png`, `before-04-approval-consumed.png`.

### B-16 · P2 · `/agents` показывает 0 waiting, bell не знает о согласованиях

**Шаги.** Оставить 1 pending approval, перевести сессию в active → открыть `/agents`.  
**Ожидалось.** «1 waiting approval» и строка/ссылка на согласование; bell с attention.  
**Фактически.** «0 WAITING APPROVAL», «4 LIVE SESSIONS», «3 STALE»; в шапке доски badge 1. Bell — только приглашения.  
**Код.** `AgentsPage.tsx:74-83` (waiting из `session.status`), `NotificationsBell.tsx:54-74` (только invitations).  
**Скриншоты.** `screenshots/before-16-agents-zero-waiting.png`, `before-01` (badge 1).

### B-17 · P3 · Нет Cancel request, copy hash, deep link **(код)**

**Шаги.** Открыть pending approval.  
**Ожидалось.** «Cancel request» (ADMIN), копирование hash/ссылки, ссылка на карточку/сессию.  
**Фактически.** Только Approve/Reject; hash — статичный `<code>`; card/session/run — текст. API cancel существует.  
**Код.** `ApprovalsPanel.tsx:817-821`; `approvals.controller.ts:108-122`; `:727-790` (meta).  
**Скриншот.** `screenshots/before-02-desktop-approvals-pending.png`.

### B-18 · P3 · Согласование говорит на языке API, а не человека

**Шаги.** Посмотреть очередь/деталь.  
**Ожидалось.** «Release bot wants to delete “Pending me”», impact, diff.  
**Фактически.** «Apply DELETE_CARD (1 command)», «Destructive · DELETE_CARD · 1», сырой JSON, hash 64 символа.  
**Код.** `approval-plan.ts:427-442` (summary), `ApprovalsPanel.tsx:347-386` (plan JSON).  
**Скриншот.** `screenshots/before-02`.

### B-19 · P3 · Board pause дублируется в каждой строке сессии

**Шаги.** Поставить доску на паузу.  
**Ожидалось.** Один banner сверху; строки показывают только свой scope.  
**Фактически.** У каждой из 4 строк badge «Board pause» + предложение «Blocked by the board pause; resume the board to release writes.» Четыре раза.  
**Код.** `PausePanel.tsx:156-163,181-185`.  
**Скриншот.** `screenshots/before-08-board-paused.png`.

### B-20 · P3 · Policy: warning-иконка у безопасных умолчаний, Reset активен на defaults **(код)**

**Шаги.** Сбросить policy к умолчаниям.  
**Ожидалось.** Спокойный статус «Using safe defaults»; Reset disabled.  
**Фактически.** AlertTriangle + «Using defaults»; Reset по-прежнему открывает confirm.  
**Код.** `PolicyPanel.tsx:575-585,586-591`.  
**Скриншот.** `screenshots/before-15-policy-discarded.png`.

---

## 4. Идеальная IA и редизайн

### 4.1. Модал, страница или drawer?

**Решение: остаётся модалом, но это board-scoped console, а не «набор вкладок».**

Почему не страница:
- Согласование — срочное решение в контексте доски; уход на отдельный route ломает «увидел badge → решил → вернулся».
- Rollback и plan diff требуют ширины, но не требуют отдельного URL.
- Board Settings уже задаёт паттерн «большой модал 1040 px с липким футером».

Почему не drawer:
- 1120 px контента (list + detail + diff) в правом drawer тесно.
- Drawer хорош для быстрых карточек, а здесь есть длинные планы и audit.

Что меняется:
- **Deep link без page:** `?agent=inbox&approval=<id>` / `?agent=runs&run=<id>` открывает модал поверх доски. Это даёт shareable link, не превращая продукт в отдельную страницу.
- **Policy выносится** в Board Settings → «Agents & automation».
- **Кросс-бордовые согласования** уходят в `/agents` как inbox, с deep link обратно в доску.

### 4.2. Что где живёт

| Поверхность | Владеет | Не владеет |
|---|---|---|
| **Board → Agents (модал)** | Inbox согласований этой доски; board pause; live-сессии этой доски; запуски/откат этой доски; ссылки на карточку/сессию/токен | Политика; создание токенов; stop-all; кросс-бордовый список |
| **Board Settings → Agents & automation** | Destructive gate, approval triggers, лимиты, TTL, approver roles, ссылка на Live | Ежедневные решения; запуски |
| **`/agents`** | Кросс-бордовый inbox pending approvals; все сессии; группировка по токенам; stop-all; ссылки в доску; empty CTA «Create API key» | Решение по конкретному плану (только deep link в доску) |
| **Account → API keys** | Создание/скоуп/revoke токена; token pause; stop-all; kill | Board pause; approvals |
| **Bell** | Attention: approval pending/expired, agent blocked, claim, quota | Полный план/decision UI |

### 4.3. Точки входа и дублирование иконок

1. **Одна Bot-иконка** в шапке доски — `AgentConsoleButton`. Badge = pending approvals (99+). Для MEMBER/VIEWER badge = только «agent blocked/approval waiting» count, без деталей (см. backend count).
2. **Удалить** отдельную ссылку `/agents` из шапки доски. `/agents` доступен:
   - из шапки консоли: «All agents across boards ↗»;
   - из Account → «Agent sessions»;
   - из bell/attention.
3. Если продукт хочет глобальную иконку в шапке — использовать **другую** иконку и подпись (`Network`/`Activity`), не ставить её рядом с Bot. Лучше — не использовать.
4. **Анимация:** один язык. Либо обе иконки статические, либо Bot получает тот же `LazyAnimatedIcon`, что settings. Анимировать только hover/open и мягкий pulse badge при новом pending; `prefers-reduced-motion` отключает.
5. **Board settings** остаётся шестерёнкой; policy — внутри неё, не отдельной иконкой.

### 4.4. Layout по разделам

#### Inbox (Approvals)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Agents on this board            ● Running  ● 1 waiting   All agents ↗   × │
├──────────────┬─────────────────────────────────┬───────────────────────────┤
│ THIS BOARD   │ Approvals                       │ Delete card “Pending me”  │
│ ● Inbox   1  │ [Needs 1] [Decided] [All 8]  ⟳  │ Release bot · opencode    │
│ ○ Live    4  │ ┌─────────────────────────────┐ │ impact / diff / integrity │
│ ○ Runs       │ │ Pending me                  │ │ history                   │
│ ──────────   │ │ Release bot wants to delete │ │                           │
│ ○ Policy  ↗  │ │ Destructive · 47 min        │ │                           │
│              │ └─────────────────────────────┘ │                           │
│ All agents ↗ │ Recently decided …              │ [Reject]  [Approve plan]  │
├──────────────┴─────────────────────────────────┴───────────────────────────┤
│ Approving authorizes this exact plan hash. The agent applies it.           │
└────────────────────────────────────────────────────────────────────────────┘
```

- Заголовок раздела — «Approvals», не только фильтры.
- Слева — список, сгруппированный «Needs decision» / «Recently decided»; pending сортируется по TTL.
- Справа — деталь; на 1024 list 300 px; на <900 list и detail меняются местами (list → detail с Back).
- Футер — контекстный: выбранное согласование + Reject/Approve; helper про hash.

#### Live (Pause & sessions)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Live                         4 sessions · 2 tokens     [All 4] [Stale 3] ⟳ │
├────────────────────────────────────────────────────────────────────────────┤
│ ● Agent writes are allowed                                                 │
│   Pausing stops every token on this board. In-flight finish; claims stay.  │
├────────────────────────────────────────────────────────────────────────────┤
│ Audit agent worker        token “Release bot” · 2 live · 1 paused           │
│  Release bot   Waiting approval  Card: Pending me       [Open inbox][Pause]│
│  Docs bot      Session pause     Reason: …              [Resume][End]      │
│ Release agent (CI)        2 stale                                           │
│  Release bot   Stale 18m   No current card                        [End]    │
├────────────────────────────────────────────────────────────────────────────┤
│ Pause is a board-wide safety switch, not a policy change.   [Pause all]    │
└────────────────────────────────────────────────────────────────────────────┘
```

- Один board-pause banner; без повторов в строках.
- Группировка по токену; имя токена, не UUID.
- Строка: имя агента, статус, текущая карточка (link), client/model, heartbeat, session age.
- Actions: Pause/Resume, End session (confirm, «release claims»), Open in `/agents`; token pause/stop-all — ссылка в Account.
- Non-admin: read-only banner + count, без фантомных disabled-кнопок.

#### Runs

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Runs                   [Status] [Kind] [Time] [Filters 2] [Clear]      ⟳  │
├───────────────────────────────┬────────────────────────────────────────────┤
│ Today                         │ Release bot added 2 cards                  │
│  Release bot +2 cards  Applied│ Applied · Batch · 2 commands · 5:24 PM     │
│  Plan · 2 cards         Applied│ Release bot · session 8f3a · token “CI”    │
│ Yesterday                     │ Timeline / Authorization / Commands diff   │
│  …                            │ Rollback: no conflicts   [Roll back run]   │
├───────────────────────────────┴────────────────────────────────────────────┤
│ 50 of 128 runs · Load more                                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

- Token/session — combobox с именами, не free-text UUID; «Clear all».
- Run row — human summary + actor + status; ID вторично.
- Detail: before→after diff по каждой команде, raw JSON — в «Technical details».
- Rollback — только когда применим; confirm с impact/conflicts и danger-кнопкой.
- Failed/reverted — одна строка состояния, без пустой карточки.

#### Policy (в Board Settings)

```text
┌ Board settings ────────────────────────────────────────────────────────────┐
│ [Workflow] [Agents & automation]                                      ×    │
├────────────────────────────────────────────────────────────────────────────┤
│ ● Agents running    Open live controls ↗          Policy v3 · admins only  │
│ ┌ Destructive actions ─────────────┐ ┌ Approval limits ──────────────────┐ │
│ │ ● Require approval              │ │ Commands/run 100  Cards/run 50    │ │
│ │ ○ Block completely              │ │ TTL 60 min                        │ │
│ └─────────────────────────────────┘ └───────────────────────────────────┘ │
│ Also require approval for                                                   │
│  ☑ Move to Done        ☑ Invite member        ☐ Delete a card (covered)    │
│  ☑ Change role         ☑ Create share         ☑ Workflow update            │
│  [Show technical keys]                                                      │
├────────────────────────────────────────────────────────────────────────────┤
│ ● Unsaved changes   Last saved by Audit Admin · 3 min ago  [Discard][Save] │
└────────────────────────────────────────────────────────────────────────────┘
```

- Destructive actions — radio, не select; чекбоксы destructive либо disabled «covered», либо убраны.
- Effective limits не дублируются: значение в поле + helper «global hard limit 100».
- Sticky footer с dirty/CAS/reload.
- Reset — в overflow «…», disabled на defaults.

### 4.5. Поток согласования

1. Агент создаёт approval → badge/bell/`/agents` показывают **одно** число.
2. Человек открывает Inbox; pending сортируется по TTL; строка говорит, что произойдёт.
3. Деталь: impact → diff → integrity → history.
4. Reject требует причину; Approve — опциональный комментарий. Оба — в sticky footer.
5. После решения строка не исчезает: статус меняется на «Approved», появляется «Next pending».
6. Если approval истёк/конфликтует — inline banner, действия disabled, «Refresh request»; detail не остаётся orphan.
7. Агент применяет план; статус Consumed + ссылка на run; карточка помечена «deleted by this approval».

### 4.6. Мобильный поток

- Полноэкранный sheet 100dvh, safe-area.
- Верх: Close/Back, title, badge.
- Горизонтальный segmented nav 44 px: Inbox / Live / Runs (Policy — ссылка).
- Один pane: список → деталь (Back), без одновременного list+detail.
- Sticky decision bar 64 px + safe-area.
- Строки 72–80 px, chips 24 px, кнопки 44 px.

---

## 5. Дизайн-спека в языке Janosik

### 5.1. Типографика

| Роль | Размер / вес | Где |
|---|---|---|
| Dialog title | 18 / 650, tracking −0.02em | шапка |
| Dialog subtitle | 12.5 / 400, line 1.45 | шапка, max 66ch |
| Section title | 12.5–13 / 650 | «Approvals», «What will change» |
| Body | 12.5–13 / 400, line 1.5 | описания, impact |
| List primary | 13.5 / 650 | card title / summary |
| Meta | 11 / 400 | heartbeat, token, time |
| Chip | 11 / 600 | статусы, risk |
| Mono | 11 / 400 | hash, ID; не 10 px |
| Минимум | 11 px | ничего ниже, кроме декоративных счётчиков |

Убрать `text-[10px] uppercase tracking-wide` из статусов и мета. Верхний регистр — только для коротких rail-лейблов, и то не обязательно.

### 5.2. Отступы, радиусы, границы, тени

- Ритм: 4 / 8 / 12 / 16 / 20 / 24.
- Диалог: padding 0; header 18–20/16; body 20–24; list row 12/16; footer 12/24.
- Радиусы: dialog 12–14; rail item / card 8; control 6; chip 4 или full только для status.
- Границы: 1 px `--border`; внутри — только hairline-разделители, не рамка вокруг каждой секции.
- Тени: только dialog и popover. Внутри — без теней.
- Одна поверхность: `bg-popover`; rail `#0d1526` или `--card`; никаких пяти вложенных `rounded-lg border`.

### 5.3. Цвета и статусы

| Смысл | Токен | Применение |
|---|---|---|
| Фон | `--background #0b1220` | page |
| Поверхность | `--card #121a2e` / `--surface #172033` | dialog / header, footer |
| Акцент | `--primary #3b82f6` | active rail, primary action, selected row left bar |
| Успех | `--success #10b981` | running, approved, applied |
| Внимание | `--warning #f59e0b` | pending, TTL, stale, medium risk |
| Опасность | `--danger #ef4444` | destructive, reject, high risk |
| Muted | `--muted-foreground #93a4bd` | meta |

Статусы:
- Pending — amber outline; TTL amber, <5 min — danger.
- Approved — success outline; Consumed — primary outline; Rejected — danger outline; Expired/Cancelled — muted.
- Board Running — success dot; Paused — amber dot.
- Risk: low — neutral; medium — amber; high — danger.

**Контраст.** Белый текст на `#10b981` ≈ 2.5:1, на `#ef4444` ≈ 3.8:1, на `#3b82f6` ≈ 3.7:1. Для 12 px это ниже WCAG AA 4.5:1. Для approve/resume/reject использовать более тёмные оттенки фона или тёмный текст; как минимум не делать 12 px white-on-green. Это системная проблема токенов, но в agent-control она заметнее всего на Approve/Resume.

### 5.4. Shell

```tsx
<DialogContent
  className="
    flex h-[min(800px,calc(100dvh-2rem))] w-[calc(100vw-2rem)]
    max-w-[1120px] flex-col gap-0 overflow-hidden p-0
    max-md:m-0 max-md:h-[100dvh] max-md:max-h-none
    max-md:w-full max-md:max-w-none max-md:rounded-none!
    max-md:border-0!
  "
>
```

- Header 72 px: icon 34, title 18, subtitle 12.5; right: Running/Paused chip, pending chip, «All agents», close 32.
- Rail 218 px: label «THIS BOARD», items 40 px, count 18; divider; «Agent policy» с external-arrow; внизу «All agents across boards».
- Content: toolbar 54 px + split; один scroll на pane.
- Footer 56–60 px: статус + helper + действия; `border-t`, `bg-surface`.
- Mobile: rail → горизонтальный nav 44 px; list/detail swap; footer safe-area.

### 5.5. Компоненты

- `AgentConsoleDialog` — shell + state (tab, selection, deep link).
- `AgentRail` — `role="tablist"`, roving tabindex, counts.
- `PendingChip` — единый источник count, `99+`.
- `ApprovalInbox` — list + filters + search + refresh.
- `ApprovalDetail` — impact, diff, integrity, history, related links.
- `DecisionBar` — Reject (requires reason) / Approve, sticky.
- `BoardPauseCard` — status, since/by/reason, confirm.
- `SessionGroup` / `SessionRow` — token grouping, current card/run, actions.
- `RunFilters` — combobox token/session, clear all.
- `RunDetail` / `CommandDiff` / `RollbackCard`.
- `AgentPolicySettings` — moved into Board Settings, dirty footer.
- Reuse `ConfirmDialog`, `EmptyState`, `SkeletonRegion`, `NumberStepper`, `SelectField`, `AgentActionDialog`, `AgentStatusBadge`.

### 5.6. Адаптивность

| Ширина | Поведение |
|---|---|
| ≥1200 | dialog 1120; rail 218; list 332; detail flex; footer 60 |
| 1024–1199 | dialog 960–1040; rail 200; list 300; detail flex; фильтры в 2 ряда |
| 768–1023 | rail → горизонтальные tabs; list 280; detail flex; policy — один scroll |
| <768 | full-screen 100dvh; nav 44; list/detail swap; sticky footer; safe-area; никакого горизонтального скролла |
| 320 | проверить отдельно; минимум 44 px targets; заголовки не обрезать |

Container queries по ширине диалога предпочтительнее `@media`, чтобы модал в тестах/галерее вёл себя так же.

### 5.7. Клавиатура, фокус, a11y

- Rail: `role="tablist"`, `aria-selected`, `aria-controls`, roving `tabIndex`, ArrowUp/Down (desktop) / Left/Right (mobile), Home/End, Enter/Space.
- Panel: `role="tabpanel"`, `aria-labelledby`.
- List: roving tabindex, ArrowUp/Down, Enter — detail, Esc — back (mobile).
- Focus trap; initial focus — заголовок или активный rail item; после закрытия — **триггер**, не `BODY`.
- Close 32×32 desktop / 44×44 mobile; tabs 40–44; chips 24 минимум.
- `aria-live="polite"` для: decision result, save status, expiry, counts.
- `aria-busy` на панели при загрузке; skeleton с label.
- Не использовать цвет как единственный носитель; статус всегда текстом.
- `prefers-reduced-motion`: отключить zoom/fade/rail transitions, оставить мгновенную смену.
- Контраст 4.5:1 для 12 px; проверить amber/green/red.

### 5.8. Motion

- 150–200 ms, `--janosik-ease-out`.
- Открытие/закрытие: fade + 2% zoom, 180 ms; на mobile — fade/slide 200 ms.
- Смена rail/pane: opacity 120 ms; без slide.
- Badge: один pulse при новом pending, не повторять циклично; reduced-motion off.
- Approve/Reject: мгновенная смена статуса + toast; без конфетти.

### 5.9. Состояния

| Состояние | Спека |
|---|---|
| Loading | Skeleton только для list/detail; label; не сбрасывать фильтры |
| Empty pending | «No approvals waiting» + «View decided» + «Open policy» (A) |
| Empty all | «No approvals on this board yet» + «How agents ask for approval» |
| Error list | Inline banner + Retry + сохранённые фильтры |
| Error detail | Inline banner + Retry; не оставлять orphan |
| Permission | Скрыть раздел; для M/V — read-only count + «Ask a board admin»; никогда generic load error |
| Expiry | Countdown; в момент expiry — badge Expired, действия disabled, авто-refetch |
| Offline | Banner «Нет соединения — решение не отправлено», черновик сохраняется |
| Dirty | Точка/подпись «Unsaved changes»; X/Esc/overlay → ConfirmDialog |
| CAS conflict | Banner + «Reload policy» + сохранить черновик |
| Save error | Banner + Retry; не терять draft |
| Reverted/failed run | Одна строка статуса, без пустого rollback-блока |
| Long plan | «Technical details» collapsed; hash copy; impact сверху |

### 5.10. Копирайт

- «Apply DELETE_CARD (1 command)» → «Release bot wants to delete “Pending me”».
- «Board-level request» → «Card was deleted by this approval».
- «Retry» (refresh) → «Refresh».
- «1 commands» → «1 command».
- «Version 1» → «Policy v1 · saved by Audit Admin, 3 min ago».
- «Using defaults» с AlertTriangle → «Safe defaults are active» с success/muted.
- «Pause is separate from policy» → ссылка «Open live controls».
- «Only a signed-in board admin can decide or resume» → для M/V: «You can watch. A board admin decides and pauses.»
- Технические ключи (`member.invite`) — только в «Show technical keys».
- Reject: «Reject» + обязательное поле «Reason for rejection».

---

## 6. Таблица контролов: сейчас → предлагается

| # | Контрол | Сейчас | Предлагается | Поведение / состояние | Права | Тест |
|---|---|---|---|---|---|---|
| 1 | Bot в шапке (`agents-trigger`) | Ссылка `/agents` | Удалить из шапки | — | A/M/V | Нет второй Bot |
| 2 | Bot в шапке (`agent-control-trigger`) | Модал + badge | Единственная точка входа | badge `99+`, pulse только при новом | A/M/V | badge = pending count |
| 3 | Шестерёнка | Board Settings | Оставить | — | A | не меняется |
| 4 | Close X | 16×16 | 32×32 / 44 mobile | dirty → confirm; focus → trigger | все | Tab/Esc |
| 5 | Overlay / Esc | Закрывает | Закрывает clean; dirty → confirm | сохранять draft | все | dirty close |
| 6 | Rail Inbox | Вкладка Approvals | Первый пункт rail с count | admin; M/V — read-only count | A/M/V | 403 не показывается |
| 7 | Rail Live | Вкладка Pause | Второй пункт rail | все | A/M/V | — |
| 8 | Rail Runs | Вкладка Runs | Третий пункт rail | все | A/M/V | — |
| 9 | Rail Policy | Вкладка Policy | Убрать; ссылка в Board Settings | admin | A | policy в settings |
| 10 | Pending/All фильтр | 2 pill, неверный count | «Needs / Decided / All» + counts из одного source | — | A | chip = 1 при 8 total |
| 11 | Search approvals | Нет | Поиск по card/summary/agent | debounce 200 | A | — |
| 12 | Refresh approvals | Нет | Кнопка Refresh | сохранять фильтр/выбор | A | SSE off |
| 13 | Approval row | Summary + `#card` | Card title + human sentence + agent + TTL | selected left bar | A | — |
| 14 | Approve | Inline form | Sticky decision bar | confirm impact; comment optional | A | expired disabled |
| 15 | Reject | Inline form | Sticky decision bar | reason required | A | empty reason blocked |
| 16 | Decision confirm | `Одобрить план` | «Approve plan» + impact recap | submitting/aria-busy | A | — |
| 17 | Decision cancel | Cancel | Cancel | возвращает bar | A | — |
| 18 | After decision | Auto-switch All | Остаться, статус + «Next pending» | не двигать список | A | filter stable |
| 19 | Expiry | Lazy detail | Countdown + auto-refetch | expired → disabled | A | DB expiry |
| 20 | Orphan detail | Возможен | Держать detail привязанным к строке | если row исчез — banner + next | A | ошибка decision |
| 21 | Cancel request | Нет | «Cancel request» в overflow | confirm; API cancel | A | cancelled |
| 22 | Copy hash | Нет | Copy + «Integrity» | clipboard + toast | A | — |
| 23 | Card/session/run links | Текст/UUID | Links | deep link/карточка | A | — |
| 24 | Plan block | JSON | Impact + diff; JSON collapsed | long plan | A | — |
| 25 | Board pause | Без confirm | ConfirmDialog + reason | reason required/optional | A | 0→1 dialog |
| 26 | Board resume | Игнорирует reason | Без поля reason; reason не показывать | — | A | body без reason |
| 27 | Pause session | Inline form | Reuse `AgentActionDialog` | reason, submitting | A | — |
| 28 | Resume session | Кнопка | Reuse `AgentActionDialog` | reason optional | A | — |
| 29 | End session | Нет | Overflow «End session» | confirm; release claims | A | session ended |
| 30 | Session row | Token UUID | Token name, current card/run, age | — | A/M/V | — |
| 31 | Sessions header | Active (4) со stale | «Live 1 · Stale 3» | — | A/M/V | stale count |
| 32 | Refresh sessions | «Retry» | «Refresh» | — | A/M/V | copy |
| 33 | Token hint | Текст | Link «Account → API keys» | — | A/M/V | href |
| 34 | Run status/kind/time | 3 select | Оставить, 11–12 px | — | A/M/V | — |
| 35 | Run token filter | Free text | Combobox с именами | search/clear | A/M/V | — |
| 36 | Run session filter | Free text | Combobox | search/clear | A/M/V | — |
| 37 | Clear filters | Нет | «Clear all» | disabled если пусто | A/M/V | — |
| 38 | Run row | ID + «1 commands» | Human summary + actor | selected | A/M/V | grammar |
| 39 | Load more | 50 heuristic | API total/cursor | «50 of N» | A/M/V | — |
| 40 | Run detail error | Text | Banner + Retry | — | A/M/V | — |
| 41 | Authorization | UUID | Links approval/hash | copy | A | — |
| 42 | Commands | Type + JSON preimage | Before→after diff | raw collapsed | A | — |
| 43 | Rollback card | Всегда | Только applicable | failed/reverted — строка | A | — |
| 44 | Revert button | Outline | Danger outline | disabled reason tooltip | A | — |
| 45 | Revert confirm | Blue | Danger + impact/conflicts | double confirm? | A | color |
| 46 | Policy destructive | Select | Radio cards | — | A (settings) | — |
| 47 | Policy triggers | 17 raw checkboxes | Grouped, destructive covered/disabled | «Show keys» | A | inert fixed |
| 48 | Policy limits | 3 steppers + duplicate cards | 3 steppers + helper | dirty | A | value |
| 49 | Policy save | Enabled always | Disabled clean; dirty status | CAS/reload | A | no-op save |
| 50 | Policy reset | В футере | Overflow «…» + confirm | disabled defaults | A | defaults |
| 51 | Policy close | Теряет draft | Confirm discard | — | A | draft kept |
| 52 | `/agents` stats | waiting from sessions | Pending approvals count | link to inbox | A/M/V | 1 vs 0 |
| 53 | `/agents` empty | Нет CTA | «Create API key» + docs | — | all | CTA |
| 54 | Bell | Только invitations | Approval attention + deep link | unread badge | all | pending appears |
| 55 | Account token actions | Pause/Stop all/Revoke | Keep + link to sessions | — | owner | — |

---

## 7. План реализации

### 7.1. Фазы

| Фаза | Объём | Оценка |
|---|---|---|
| **P0. Правда и безопасность** | Скрыть/оградить Approvals для M/V; единый pending count + badge 99+; expiry auto-refresh; не оставлять orphan; dirty guard для policy; focus return; close 32 | 3–4 дня |
| **P1. Shell** | Rail Inbox/Live/Runs, header/footer, full-screen mobile, tablist/arrow keys, 44 px targets, deep link | 3–4 дня |
| **P2. Inbox** | Список/деталь, human summary, impact/diff, decision bar, cancel/copy/links, empty/error/permission | 4–5 дней |
| **P3. Live + Runs** | Группировка сессий, end/reuse dialog, board pause confirm, run filters/combobox, diff, rollback confirm | 4–5 дней |
| **P4. Policy → Board Settings** | Секция Agents & automation, dirty/CAS/reload, inert controls, remove tab | 3–4 дня |
| **P5. Global truth** | `/agents` pending inbox + bell attention + Account links + badge sync | 2–3 дня |
| **Тесты/визуал** | unit/browser/mobile/a11y, скриншоты 1440/1024/390 | 3 дня |
| **Итого** | | **18–24 человеко-дня** |

Порядок можно ужать: P0+P1 дают 80% пользы за 6–8 дней.

### 7.2. Файлы и компоненты

| Файл | Изменение |
|---|---|
| `ui/src/components/agent-control/AgentControlDialog.tsx` | Новый shell: rail, header, footer, 1120 px, full-screen mobile, deep link |
| `.../AgentControlButton.tsx` | Один вход, badge из pending-count, 99+, `aria-label` по роли |
| `.../approval/ApprovalInbox.tsx` | Новый: фильтры, поиск, refresh, list |
| `.../approval/ApprovalDetail.tsx` | Новый: impact/diff/integrity/history/links |
| `.../approval/DecisionBar.tsx` | Новый: reject reason, approve comment, sticky |
| `.../live/LivePanel.tsx` | Заменяет `PausePanel`; board banner + session groups |
| `.../live/SessionRow.tsx` | Токен-имя, current card/run, pause/resume/end |
| `.../runs/RunsPanel.tsx` | Refactor: filters, list, detail |
| `.../runs/RunFilters.tsx` | Combobox token/session, clear |
| `.../runs/RunDetail.tsx` | Diff, links, rollback |
| `ui/src/components/board/BoardSettingsDialog.tsx` | Новая секция Agents & automation / top switch |
| `ui/src/components/board/settings/AgentPolicySettings.tsx` | Перенос `PolicyPanel`, dirty/CAS |
| `ui/src/components/agents/AgentsPage.tsx` | Pending approvals inbox, CTA, stats |
| `ui/src/components/agents/use-agent-sessions.ts` | Pending count, filters |
| `ui/src/components/account/ApiTokensSection.tsx` | Ссылки в `/agents`, не дублировать board pause |
| `ui/src/components/Header.tsx` | Удалить второй Bot; один `AgentConsoleButton` |
| `ui/src/components/NotificationsBell.tsx` | Attention items + approval deep link |
| `ui/src/api/client.ts` | count endpoint, deep-link params |
| `shared/src/api.ts` | `ApprovalListResponse`/`pendingCount`; attention DTO |
| `backend/src/approvals/*` | `GET .../approvals/count?status=pending` или `total`; aggregated `/agents` count |
| `ui/src/locales/{ru,en}/translation.json` | Новые ключи, переписать старые |
| Тесты | `AgentControlDialog.test.tsx`, `PausePanel.test.tsx`, `RunsPanel.test.tsx`, `PolicyPanel.test.tsx`, e2e `agents/*`, `security/agent-control.spec.ts` |

### 7.3. Состояние, запросы, API

- `usePendingApprovalCount(boardId)` — один запрос, SSE-инвалидация, `99+`.
- `useApprovalInbox(boardId, filter)` — список + total + `nextCursor`; не `rows.length`.
- `useNow` + таймер на `expiresAt`: при истечении — refetch detail/list, disabled actions.
- `selectedApprovalId` хранить вместе с filter; если строка исчезла — не оставлять orphan, показать «This request is no longer pending» + next.
- `usePolicyDraft(policy)` — baseline, dirty, `reload()`, CAS error, discard confirm.
- `useAgentSessions` — группировка по token, stale/live counts, end.
- Deep link: `useSearchParams` в BoardRoute; открыть модал после загрузки доски; проверить membership.
- SSE: approval frame обновляет строку статусом, а не только revision; run.reverted — list+detail; agent — sessions.
- Backend: count endpoint (не тянуть 50 строк ради badge); aggregated pending by board для `/agents`; attention feed для bell.
- Не менять модель approval/plan hash/CAS; только транспорт и read-model.

### 7.4. Тесты

**Unit**
- MEMBER/VIEWER: Approvals недоступен, нет Retry-ловушки; read-only count.
- Pending chip = pending count во всех фильтрах; badge 99+.
- Expiry: пока модал открыт, статус меняется, Approve disabled, detail не orphan.
- Policy: dirty close confirm; Save disabled clean; CAS reload сохраняет draft; destructive checkbox disabled/covered.
- Runs: detail error Retry; grammar 1 command; filter combobox.
- Tabs: role/tablist, arrows, focus return.

**Browser/E2E**
- Admin: approve/reject/cancel/consume/expire; decision history; links.
- Member/Viewer: no approvals tab, no 403; pause read-only; runs read-only.
- Pause: confirm, reason, resume body; stale count; end session.
- Runs: filters, pagination, conflict, rollback confirm, danger color.
- Policy: dirty, CAS, reset, reload; moved to Board Settings.
- `/agents` + bell: pending count matches board; deep link.
- Mobile 390: full-screen, no horizontal scroll, 44 px, one pane, sticky footer.
- A11y: keyboard-only, focus visible, aria-live, contrast (axe).

**Visual**
- 1440/1024/390; RU (длинные строки) и EN; dark/light; 320.

### 7.5. Риски и откат

| Риск | Митигация |
|---|---|
| Перенос policy ломает привычку и тесты | Фаза P4, feature flag `agentPolicyInSettings`; старый tab скрыт, не удалён |
| Скрытие Inbox у M/V выглядит регрессией | Дать read-only count + «A board admin decides»; добавить count endpoint |
| Count endpoint = N+1 | Один агрегированный запрос на `/agents`; кэш 5–10 s; SSE-инвалидация |
| SSE-обрыв | Fallback poll 15–30 s + manual Refresh |
| Мобильный one-pane ломает deep link | Back stack в state; URL хранит tab/id |
| Длинные RU-строки | Тест 390/320; max 2 строки; ellipsis + title |
| Контраст зелёного/красного | Тёмные варианты токенов или тёмный текст; axe |
| Потеря preimage-приватности | Не менять серверный `includePlan`/preimage guard |
| Rollback confirm | Не менять атомарность; только UI |

### 7.6. Что не менять

- Серверный lifecycle approval: exact hash, one-time consume, TTL, CAS, PAT/session-only guards.
- Атомарность rollback и audit-run.
- Права: decide/revert/policy — только ADMIN JWT; session end — ADMIN или owner PAT.
- Preimage/diff — только ADMIN browser.
- Токены и их scope/pause/stop-all.
- Тестовые id, где возможно (`agent-control-trigger`, `approval-*`, `run-*`).
- Темные токены и общий визуальный язык.

---

## 8. Что удалить, переместить, оставить

### Удалить

- Второй Bot-icon из шапки доски.
- Вкладку Policy из agent-модала (после переноса).
- Auto-switch `setFilter("all")` после решения.
- Сырой JSON как основной вид плана и preimage.
- 10 px uppercase у статусов/мета.
- `#` перед названием карточки.
- Кнопку «Retry» в роли Refresh.
- Повтор «Blocked by board pause» в каждой строке.
- Дублирующий блок Effective limits (оставить helper в полях).
- Мёртвые чекбоксы destructive-действий (или disabled «covered»).
- Dead read-only ветку PolicyPanel (если policy уезжает).

### Переместить

- Policy → Board Settings → Agents & automation.
- Кросс-бордовые approvals → `/agents` inbox.
- Все сессии/токены → `/agents` + Account.
- Token pause/stop-all/kill → Account (оставить), с ссылками из board-модала.
- Глобальный `/agents` — из шапки в шапку консоли/Account.

### Оставить

- Exact plan hash, статусы, TTL, risk.
- Approve/Reject с комментарием.
- Board/session pause с семантикой in-flight/403/claims.
- Runs timeline/preimage/conflicts/rollback.
- Policy CAS и серверные лимиты.
- SSE, скелетоны, empty/error.
- Тёмную тему и токены.

---

## 9. Ограничения аудита

1. **Runtime vs code-read.** Runtime: 1440/1024/390 в Chromium, dark; 8 approvals; 7 runs; 4 sessions; ADMIN/MEMBER/VIEWER; focus/keyboard; dirty close; CAS через API; expiry через DB; mobile sizes. Code-read: >50 approvals, failed run, SSE disconnect, 320 px, light theme, Safari/Firefox, screen reader, real touch, parallel browser tabs.
2. **Фикстура.** Доска осталась «New board»: PATCH названия у boards нет, переименование делается командой; это не дефект agent-control. Два токена «Audit agent worker» появились из-за повторного seed; UI допускает одинаковые имена токенов.
3. **CAS** воспроизведён обновлением policy через API, а не двумя настоящими вкладками; UI-поведение (ошибка, отсутствие reload) при этом настоящее.
4. **Скриншоты after** — статический макет на тех же токенах, не production-код; размеры/отступы нужно проверить после реализации.
5. **Светлая тема** не аудировалась построчно; структура та же, но контраст 10 px и зелёных кнопок требует отдельной проверки.
6. **Не проверялись** производительность при 100+ approvals, 1000+ runs, SSE reconnect, Safari iOS safe-area, экранный диктор, reduced-motion в реальном браузере.
7. **Исходники, тесты и docs не изменялись.** Одноразовые аккаунты/доска созданы через публичный API; чужие данные не затрагивались.

---

## Приложение. Индекс скриншотов

| Файл | Что показывает |
|---|---|
| `before-01-header-two-bots.png` | Две одинаковые Bot-иконки, badge, анимированная шестерёнка |
| `before-02-desktop-approvals-pending.png` | Approval inbox: очередь + деталь, 10 px мета, raw JSON |
| `before-03-approvals-count-bug.png` | «Pending 8» при 1 pending; аннотация |
| `before-04-approval-consumed.png` | Consumed: UUID карточки, Expires, Run UUID |
| `before-05-approval-expired-click.png` | Expired после клика: toast, orphan detail |
| `before-06-member-approvals-error.png` | MEMBER: 403 → generic error + Retry |
| `before-07-pause.png` | Pause: board card, 4 сессии (3 stale), Retry |
| `before-08-board-paused.png` | Board paused: повтор в каждой строке, reason рядом с Resume |
| `before-09-runs.png` | Runs: raw token/session filters, «1 commands» |
| `before-10-run-conflict.png` | Run detail: conflict preview |
| `before-11-revert-confirm.png` | Revert confirm: синяя кнопка |
| `before-12-policy.png` | Policy top: effective limits, destructive select, raw keys |
| `before-13-policy-dirty.png` | Dirty 42 vs Effective 100, Save enabled |
| `before-14-policy-cas-conflict.png` | CAS error без Reload, Save за экраном |
| `before-15-policy-discarded.png` | После закрытия: 100, без confirm |
| `before-16-agents-zero-waiting.png` | `/agents`: 0 waiting при pending |
| `before-17-account-api-keys.png` | Account: token pause/stop-all, эталон строк |
| `before-18-board-settings-reference.png` | Board Settings: нативный shell, footer |
| `before-19-mobile-shell-annotated.png` | 390: 366×736, tabs 24/40, close 16 |
| `before-20-mobile-policy.png` | 390 policy: длинный скролл без футера |
| `before-21-tablet-approvals.png` | 1024: две панели, теснота |
| `before-22-approval-approved.png` | Approved hint/meta |
| `before-23-approval-rejected.png` | Rejected + comment |
| `before-24-approval-cancelled.png` | Cancelled: «Not decided» + Decided + Expires |
| `before-25-session-pause-form.png` | Inline session pause reason |
| `before-26-approval-before-expiry.png` | До expiry: Pending, Approve доступен |
| `before-27-run-ready.png` | Applied run, rollback ready |
| `after-01-desktop-inbox.png` | Предложенный Inbox: rail, impact, diff, sticky decision |
| `after-02-desktop-live.png` | Предложенный Live: board banner, session groups, end |
| `after-03-desktop-policy.png` | Policy в Board Settings: dirty footer, grouped triggers |
| `after-04-mobile-inbox.png` | 390: full-screen inbox, nav 44 |
| `after-05-mobile-detail.png` | 390: detail + sticky decision bar |

---

**Итог одной фразой.** Серверная часть agent-control уже взрослая; проблема не в том, что она не умеет, а в том, что модал не показывает это честно и по-яносиковски: три разных счётчика, вкладка с гарантированным 403, потерянные черновики, истёкшие approvals с активной кнопкой и мобильный shell, который не является ни Board Settings, ни Account. Сначала — правда и безопасность (P0), затем — один rail Inbox/Live/Runs и перенос policy в Board Settings.
