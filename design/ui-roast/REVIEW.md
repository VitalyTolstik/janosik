# UI/UX teardown Janosik — «90 дней, и это всё?»

**База:** `main` = `a858c75`  
**Характер:** read-only UI/UX review. Исходники, тесты и docs не менялись. В рабочем дереве присутствуют незакоммиченные изменения параллельных потоков — они не трогались и в выводах не использовались как рабочее состояние продукта.  
**Стенд:** отдельная БД `janosik_test_ui_review`, API `127.0.0.1:3400`, UI `127.0.0.1:4440`, Chrome через Playwright.  
**Экраны:** 1440×900, 1024×768, 390×844 (touch).  
**Скриншоты:** `design/ui-roast/screenshots/` (63 файла).  
**Что проверено руками:** регистрация, пустое состояние, создание доски/колонок/карточек, карточка целиком, комментарии, поиск, виды, drag & drop + undo, архив/восстановление, участники/роли/viewer, presence/realtime, аккаунт, агенты/approval, мобильный layout, axe-core.  
**Что не перепрогонялось:** весь e2e-сьют, OAuth, реальная SMTP-доставка, импорт больших JSON, конфликты одновременного редактирования. Где вывод сделан только по коду, это указано.

> **Техническое примечание.** При первом запуске backend Prisma `prestart` применил последнюю миграцию (`20261110120000_task_166_9_attention_notifications`) к dev-БД `janosik` до того, как процесс переключился на review-БД. Пользовательские данные не читались и не менялись; в dev-схеме появилась attention-таблица. Весь дальнейший прогон шёл только против `janosik_test_ui_review`.

> **Дедупликация.** Редактирование своего комментария уже описано в `docs/TASK-176-admin-connections.md` (176.2). Потеря черновика, touch-only удаление, attention-inbox, self-leave, счётчик свитчера, share-edit и per-board export уже перечислены в TASK-177 / project-gaps (`ROADMAP.md` §7.27). Ниже — не «открытия», а подтверждение на живом UI и ответ на вопрос, почему это всё ещё видно пользователю через 90 дней.

---

## 1. Вердикт

За 90 дней здесь построили взрослый agent-control, SSE, watch-стену и аккуратный board-shell — а потом остановились ровно перед вторым человеком. Комментарий нельзя отредактировать, `@mention` не существует, колокольчик не показывает attention-события, поиск не находит обсуждения, а на touch кнопка удаления комментария невидима, но нажимается. Это не набор случайных багов: почти всё уже есть в API, TASK-176 или TASK-177, но не доведено до кнопки. Системный паттерн — **API-first, UI last mile**: сервер умеет больше, чем человек может нажать; продукт отлично продаёт агента и доску, но базовые human-collaboration primitives — edit, mention, inbox, leave, draft, search — отсутствуют или спрятаны. Поэтому «вы серьёзно?» — справедливый вопрос не к качеству кода, а к продуктовой приоритизации.

---

## 2. Top 20 «вы серьёзно?»

| # | Находка | Класс | Sev | Surface | Доказательство | Ожидаемая реакция |
|---:|---|---|---|---|---|---|
| 1 | **Свой комментарий нельзя отредактировать.** Есть только Delete. | BASIC MISSING | P1 | Card → Comments | `design/ui-roast/screenshots/08-comment-hover-1440.png`; `ui/src/components/board/CardComments.tsx:600-612` — только `comment-delete`; `backend/src/comments/comments.controller.ts:46-93` — POST/GET/DELETE, без PATCH; живой `PATCH /api/v1/comments/...` вернул `404`. Уже TASK-176.2. | «Мне что, удалять комментарий и писать заново, теряя тред?» |
| 2 | **@mention — просто текст.** Нет автодополнения, нет уведомления, нет получателя. | BASIC MISSING | P1 | Comments / notifications | `26-mobile-mention-nothing-390.png`, `36-mention-comment-1440.png`, `37-mention-no-notification-1440.png`: после ввода `@Rita` — 0 вариантов; после комментария с `@Boris` у Бориса `unreadCount: 0`, бейдж 0. В `ui/src`/`shared/src` нет mention-кода; attention-типы — только approval/agent/claim/quota/token (`shared/src/api.ts:1489`). | «Я упомянул коллегу — он об этом никогда не узнает». |
| 3 | **Колокольчик — это «Invitations», а не inbox.** Attention API существует, UI его не вызывает. | BROKEN / BURIED | P1 | Header → bell | `22-bell-no-invitations-1440.png`: после revoke токена API вернул `unreadCount: 1`, а UI — бейдж 0 и «Invitations (0) / No invitations». `NotificationsBell.tsx:56` грузит только `api.listInvitations()`; `ui/src/api/client.ts:933` — только invitations; при этом `backend/src/notifications/notifications.controller.ts:37-90` уже умеет list/read/read-all/settings. Уже TASK-177.6 (G-16). | «Сервер мне пишет, а интерфейс говорит: нет приглашений». |
| 4 | **Поиск не ищет комментарии и вложения.** | BASIC MISSING | P2 | Global search | `11-search-comment-miss-1440.png` — «XYZZYCOMMENT» → «Nothing found»; `60-search-attachment-miss-1440.png` — «launch-proof» → «Nothing found». `ui/src/utils/filter.ts:447-452` — только title/description/label/checklist; `GlobalSearch.tsx:39,153` — cap 20. При этом backend `boards.service.ts:383-414` уже ищет по комментариям для MCP. | «Я точно помню, что это обсуждали, но продукт — нет». |
| 5 | **На touch кнопка удаления комментария невидима, но является hit-target.** | BROKEN | P2 | Mobile comments | `25-mobile-comment-no-delete-390.png`, `52-mobile-invisible-delete-opened-confirm.png`: computed `opacity: 0`, `pointer-events: auto`, размер 22×22; тап в пустое место открыл «Delete this comment?». `CardComments.tsx:608` — `opacity-0 group-hover:opacity-100` без `no-hover`; для сравнения `BoardSwitcher.tsx:456` использует `no-hover:opacity-100`. Уже TASK-177.8 (G-12). | «Я тапнул в пустоту и получил подтверждение удаления». |
| 6 | **Черновик комментария исчезает при закрытии карточки.** | BROKEN | P1 | Card dialog | `58-comment-draft-before-close-1440.png` → `59-comment-draft-lost-1440.png`: после Close/переоткрытия редактор пуст (`"\n"`). `CardComments.tsx:96` — локальный `draft`; диалог размонтирует секцию. Уже TASK-177.3 (G-04). | «Я закрыл карточку, чтобы посмотреть доску, и потерял текст». |
| 7 | **`/agents` показывает `0 waiting approval`, когда на доске висит approval.** | INCONSISTENT | P2 | Agents / board control | `49-agent-control-approval-1440.png` — Pending 1; `50-agents-session-1440.png` и `51-agent-detail-1440.png` — `0 WAITING APPROVAL`. `AgentsPage.tsx:78` считает `session.status`, а не approval-запросы; ссылки на approval с `/agents` нет. | «Агент ждёт разрешения, а обзор говорит: всё чисто». |
| 8 | **Участник не может выйти из доски.** | BASIC MISSING | P2 | Members | `55-viewer-members-no-leave-1440.png`: у VIEWER только Close, кнопки Leave — 0. `BoardMembersDialog.tsx` не содержит leave; API — только удаление участника админом. Уже TASK-177.2 (G-02). | «Меня пригласили навсегда?» |
| 9 | **Первый борд создаётся как «New board» без запроса имени; в свитчере — с запросом.** | INCONSISTENT | P2 | Onboarding | `05-empty-board-1440.png` — заголовок «New board»; `App.tsx:87` вызывает `addBoard(t("board.switcher.new"), ...)`; в свитчере создание идёт через inline-input. Шаблонов/примеров нет. | «Первый экран нового продукта называет мой проект “Новая доска”». |
| 10 | **A11y: чекбокс пункта чек-листа без доступного имени; progressbar без имени.** | BROKEN | P2 | Card → Checklists | axe: `button-name` critical, `aria-progressbar-name` serious; `CardChecklists.tsx:283` — `role="progressbar"` без `aria-label`; `:317` — `aria-pressed` без имени. Скриншот карточки: `40-dark-card-1440.png`. | «Скринридер говорит “кнопка” — какую задачу я отмечаю?» |
| 11 | **Фокус не возвращается после закрытия карточки.** | BROKEN | P2 | Keyboard / dialog | После Escape `document.activeElement` = `BODY`; focus-trap внутри диалога при этом работает. `CardDialog.tsx:769` — DialogContent без явного `onCloseAutoFocus`. | «Я закрыл карточку и потерял место в списке». |
| 12 | **Контраст ниже AA, особенно в тёмной теме и редакторе.** | POLISH / A11Y | P2 | Theme / description editor | axe: 3 violation-ноды в light, 5 в dark; `Block type` — 1.89:1, «No cards yet» — 3.05:1, tab — 4.09:1, label chip — 4.19:1. `39-dark-board-1440.png`, `40-dark-card-1440.png`. | «Тёмная тема красивая, но серый текст на сером не читается». |
| 13 | **Нет `h1`, два `main`, `<li>` вне списка.** | POLISH / A11Y | P3 | Semantics | axe: `page-has-heading-one`, `landmark-no-duplicate-main`, `listitem`. `BoardTitle.tsx:43` — `h2`; `CardDialog.tsx:1149` — `<main>` внутри диалога; insert-zone — `<li>` без списка. | «Screen reader: где заголовок страницы и какой main главный?» |
| 14 | **Счётчик карточек в свитчере включает архив.** | INCONSISTENT | P3 | Board switcher | `56-switcher-count-includes-archived-1440.png`: на доске 3 активные карточки, в свитчере — 4. `BoardSwitcher.tsx:438` — `Object.keys(b.cards).length`. Уже TASK-177.8 (G-11). | «Где четвёртая карточка?» |
| 15 | **Лейбл на карточке обрезается и прячется под hover-кнопками.** | POLISH | P3 | Board card | `34-presence-two-users-1440.png` — «LAUNC…» обрезан; `15-card-dragged-1440.png` — hover-иконки archive/duplicate стоят в той же области. `CardItem.tsx:477-503`: title `w-3/4`, labels `overflow-hidden` + mask. | «Метка есть, но прочитать её нельзя». |
| 16 | **Пустой `/agents` не предлагает создать API-ключ.** | BURIED | P3 | Agents empty | `21-agents-empty-1440.png`: текст «When an agent starts a session with a personal API token…», но CTA/ссылки на Account → API keys нет. | «И что мне теперь делать?» |
| 17 | **Удаление комментария нельзя отменить, confirm не показывает текст.** | POLISH | P3 | Comments | `52-mobile-invisible-delete-opened-confirm.png`: generic «Delete this comment? / This cannot be undone». Нет undo, нет цитаты/превью. `ui/src/locales/en/translation.json` — `comment.deleteDescription`. | «Я удалил не тот комментарий — и даже не вижу какой». |
| 18 | **Safe-area не задан, а PWA-мета — `black-translucent`.** | POLISH | P3 | Mobile shell/dialogs | `ui/index.html:12` — viewport без `viewport-fit=cover`; `apple-mobile-web-app-status-bar-style=black-translucent`; в `ui/src` нет ни одного `env(safe-area-inset-*)`. На 390×844 эмуляции не проявляется; это **код-риск для standalone iPhone**, не runtime-наблюдение. | «На реальном iPhone надо проверить, не уезжает ли Close под вырез». |
| 19 | **Нет массовых действий с карточками.** | BASIC MISSING | P3 | Board | Только «Archive all cards» в меню колонки; multi-select/move/delete для карточек нет. Для Linear/Jira-класса это ожидаемо; для Trello-класса — частично простительно. | «Почистить 30 карточек — 30 раз открыть меню?» |
| 20 | **Share-ссылку нельзя отредактировать; revoke без confirm; per-board export нет.** | BURIED / POLISH | P3 | Share / Data | `53-share-dialog-1440.png`: в строке только Copy/Embed/Refresh/Revoke; Edit нет. `ShareDialog.tsx:352-368` — Revoke без подтверждения. `DataMenu.tsx:85-95` экспортирует все доски, не текущую. Уже TASK-177.1/177.7 (G-01, G-14). | «Создал ссылку с комментариями — теперь удаляй и создавай заново». |

**P0 не ставил:** подтверждённой потери данных без подтверждения или полного отказа basic-flow не нашёл. Но P1 здесь четыре, и три из них — про второго человека, а не про код.

---

## 3. Journey-by-journey

### 3.1. First-run / onboarding

**Что работает**
- Регистрация, логин, авто-верификация при выключенной почте; при включённой — код-гейт с 6-значными полями (код и e2e есть, вручную проверен только no-mail режим).
- Пустое состояние честное: «No board yet», одна primary-кнопка `New board` (`04-empty-state-1440.png`).
- После создания доски виден `Add column`; после колонки — `Add a card`. До первой карточки — два очевидных действия, без docs.
- 390 px проверялся на board/card/account; login/register смотрел только на 1440.

**Что не так**
- `New board` из пустого состояния сразу создаёт доску с именем «New board» (`05-empty-board-1440.png`), тогда как создание из свитчера спрашивает имя. Новый пользователь попадает на безымянную доску и должен догадаться кликнуть по заголовку.
- Нет шаблона/примеров колонок/чек-листа первого запуска. Пустая доска — это большой серый лист с пунктирным `Add column`.
- Заголовок доски — `h2`, а не `h1`; для скринридера это не «страница доски».
- Название доски редактируется кликом по заголовку, но affordance невидим: ни карандаша, ни меню Rename рядом.

**Вывод:** новый пользователь *может* дойти до первой карточки без документации, но первый запуск ощущается как «база с плюсиком», а не как продукт, который ведёт за руку. Это не блокер, это P2-онбординг.

### 3.2. Board shell

**Что работает**
- Rename доски, switcher, archive/restore/delete — всё проходит; удаление архивированной доски требует подтверждения.
- Archive/restore карточки: контекстное меню → Archive, затем Data & backups → Card archive → Restore → выбор колонки. Меню восстановления показывает WIP-причины, это хорошо (`45-card-archive-restore-menu-1440.png`).
- Board settings: workflow-редактор с матрицей переходов, глобальными переходами, initial/done, проверкой карточки (`17-board-settings-1440.png`). Это сильно.
- Members/roles: invite по email, Admin/Member/Viewer, live-понижение до Viewer; у Viewer исчезают composer/undo/share (`31-members-invite-1440.png`, `38-partner-viewer-live-1440.png`).
- Share link: live/snapshot, TTL, comments/attachments flags, embed (`53-share-dialog-1440.png`). Create/revoke есть.
- Views: Board/Calendar/Table/Watch; Table с колонками (сортировка — e2e, не повторял), Calendar показывает due-даты, Watch — live-feed с диффами (`12-table-view-1440.png`, `13-calendar-view-1440.png`, `14-watch-view-1440.png`).
- Presence и realtime: два аватара, карточка Бориса появилась у Риты без reload (`34-presence-two-users-1440.png`, `35-realtime-card-1440.png`).
- Ошибка загрузки: `Could not load your boards` + Retry, retry восстанавливает доску (`57-board-load-error-1440.png`).

**Что сломано/чего нет**
- Счётчик карточек в свитчере врёт: включает архивные (4 при 3 активных). Пользователь не понимает, куда делась карточка.
- Нет self-leave для MEMBER/VIEWER; у VIEWER диалог Members — read-only список с Close.
- Share-ссылку нельзя отредактировать; revoke не подтверждается.
- Нет per-board export: Data → Export выгружает все доски.
- Нет bulk-actions; только «Archive all cards» на колонку.
- Лейбл на карточке обрезан/перекрыт hover-иконками.

**Вывод:** shell и board-management — сильная часть. Проблемы начинаются там, где доской пользуется кто-то кроме её админа.

### 3.3. Card core loop

**Что работает**
- Создание карточки inline, открытие, title, description (MDX), priority, due date, assignee, labels, checklist, attachments, links, duplicate, archive/restore, drag между колонками, undo.
- `Ship the launch` получил description, High, due, assignee, label, checklist 0/1 и attachment; всё пережило reload.
- Drag To do → In progress сработал; Undo вернул карточку (`15-card-dragged-1440.png`).
- Контекстное меню: Open, Move to, Labels, Due date, Priority, Assignee, Link card, Cover, Checklists, Add comment, Copy link, Open in new tab, Duplicate, Archive (`16-card-context-menu-1440.png`). Это хороший набор.
- Архив карточки и restore в выбранную колонку работают.
- Deep-link `?card=` открывает диалог; закрытие убирает param.

**Что не так**
- Комментарии — отдельная история (ниже): нет edit/mention/draft safety.
- Нет массовых действий.
- A11y карточки: чекбокс пункта чек-листа без имени, progressbar без имени, focus не возвращается после закрытия.
- На карточке в board-виде лейбл живёт в той же зоне, что hover-кнопки archive/duplicate; при наведении метаданные исчезают.
- `Block type` в редакторе описания — 1.89:1, визуально почти placeholder-заглушка.

**Вывод:** card core — почти полный. Именно поэтому отсутствие edit/mention в комментариях ощущается не как «не сделали», а как «забыли включить».

### 3.4. Comments

**Что работает**
- Markdown-композер, Save/Cancel, Ctrl/Cmd+Enter, kind-picker (Note/Blocker/Handoff и т.д.), optimistic send, лимит, удаление своих с подтверждением.
- Пагинация «Show older» по 50; realtime-код на SSE; пустое состояние — композер.
- Удаление своего комментария на десктопе работает, но кнопка появляется только по hover.

**Что сломано/чего нет**
- **Edit отсутствует** и на UI, и в API: `PATCH` → 404. Уже TASK-176.2.
- **Mention отсутствует полностью**: `@Rita` — plain text, 0 автодополнений; у получателя 0 уведомлений.
- **Draft loss**: закрыл карточку — черновик исчез. P1 по TASK-177.3.
- **Touch delete**: кнопка `opacity: 0`, но `pointer-events: auto`; тап в пустоту открывает confirm. Это худший вариант: не «спрятано», а «невидимо, но активно».
- **Нет undo** после удаления; confirm не показывает текст комментария.
- **Счётчик Comments** (по коду) считается по загруженной странице (50), а не по всем; на 80 комментариях бейдж соврёт (G-05).
- **Поиск** не находит текст комментария; вложения — тоже.

**Вывод:** комментарии выглядят как Jira-light, но в них нет главного социального слоя — edit, mention, notification. Это не «polish», это половина функции.

### 3.5. Collaboration

**Что работает**
- Invite по email → bell → Accept → доска появляется без reload.
- Роли Admin/Member/Viewer; live-понижение до Viewer; у Viewer исчезают composer, undo/redo, share; сервер тоже отказывает.
- Presence: два аватара; realtime-карточка от второго пользователя пришла без reload.
- Realtime-конфликты и stale-edit покрыты существующими e2e (не перепрогонял вручную).

**Что сломано/чего нет**
- **Нельзя выйти из доски.** Viewer видит только Close; MEMBER — тоже. Приглашение фактически бессрочное, пока админ не удалит.
- **Нет mention/assignment/due-уведомлений.** Даже при наличии @ в тексте.
- **Нет watchers/follow карточки.** Нельзя подписаться на изменения.
- **Pending invitation нельзя изменить/продлить** (G-07); share revoke без confirm (G-08).
- **Approvals живут в board-модалке**, а глобальный `/agents` говорит 0 — два экрана расходятся.

**Вывод:** пригласить и дать роль — работает; жить в доске вдвоём — не совсем. Борис не может ни упомянуть, ни получить уведомление, ни уйти.

### 3.6. Search and navigation

**Что работает**
- Ctrl/Cmd+K, глобальный поиск по card title/description/labels/checklists и board titles, подсветка, keyboard arrows/Enter.
- Card hit открывает `?card=`; board hit переключает доску; archived badge; empty state «Nothing found».
- Board filter bar хранит query/facets в URL; deep links и back/forward для card dialog обрабатываются.
- На 390 поиск и фильтры не текут.

**Что не работает**
- **Комментарии и вложения не индексируются.** Placeholder и hint прямо перечисляют только title/description/labels/checklists (`translation.json:1165`), то есть UI честно признаётся в ограничении.
- **Cap 20 до группировки**: board-hit может исчезнуть, если карточных хитов уже 20 (`GlobalSearch.tsx:39,153`; G-17).
- **Нет saved views/filters**; фильтр живёт в URL, но именованных представлений нет.
- **Нет поиска по комментариям/файлам из board filter** — тот же набор полей.
- **Нет комментариев как deep-link**: нельзя дать ссылку на конкретный комментарий.

**Вывод:** поиск хорош для «найти карточку», но не для «найти, что мы обсуждали». Для collaborative-продукта это P2.

### 3.7. Notifications / inbox

**Что работает**
- Bell = Invitations: badge, список, Accept/Decline, expiry, polling on focus/30s; после accept доска появляется.
- Invitation errors (expired/gone/offline) локализованы.

**Что не работает**
- **Attention inbox полностью отсутствует в UI.** Backend `GET /users/me/notifications`, `read-all`, `read/:id` и `notification-settings` уже есть; клиент их не вызывает.
- Проверка: создал и отозвал PAT → API `unreadCount: 1`, тип `token.revoked`; UI — бейдж 0, панель «Invitations (0) / No invitations» (`22-bell-no-invitations-1440.png`).
- **Mark read/unread/read-all** отсутствуют, потому что нет inbox.
- **Mention/assignment/due** не генерятся; attention-типы ограничены approval/agent/claim/quota/token (`shared/src/api.ts:1489`).
- **Jump to object** для attention невозможен; для invitation — только accept.
- **Notification settings**: в профиле есть только digest-чекбокс; `notifyAttention` не выведен.

**Вывод:** это самый громкий разрыв для «agent-first» продукта. Агент может ждать approval, а человек не увидит attention, если не откроет именно доску и не нажмёт bot-иконку.

### 3.8. Account / settings

**Что работает**
- Profile: avatar upload/color, display name, email, member since.
- Preferences: language, time format, light/dark theme, board background; всё сохраняется.
- Security: смена пароля с current password; сервер отзывает другие сессии и PAT.
- API keys: create, scopes, board scope, read-only, rate limit, expiry, pause/resume, revoke; plaintext один раз (`20-account-tokens-1440.png`).
- Data & privacy: export JSON, delete account с подтверждением email+пароля, 7-дневное окно (`20-account-data-1440.png`).
- Email change — код и UI есть; вручную не проходил.

**Что не так**
- **Нет списка активных сессий/устройств и per-session revoke.** Есть только «сменить пароль — отзовёт остальные». Для self-host продукта это странно: security-раздел выглядит недоделанным (`54-account-security-1440.png`).
- **Нет per-board export**: Export выгружает все доски; обещание «board data» в DataMenu не совпадает.
- **Notification preferences неполные**: digest есть, attention — нет.
- Нет CSV/импорта из Trello/Jira/Notion; только JSON-бэкап. Для migration story это P3.

**Вывод:** account/data rights — выше среднего; sessions и notification prefs — нет.

### 3.9. Agent control

**Что работает**
- `/agents`: список токенов/сессий, live/stale, heartbeat, фильтры, session detail, Pause/End/Open board (`50-agents-session-1440.png`, `51-agent-detail-1440.png`).
- Board → Agent control: Approvals, Pause & sessions, Runs & rollback, Policy & limits; pending count на иконке; approval с plan hash, риском, destructive-меткой, Approve/Reject (`49-agent-control-approval-1440.png`).
- Реальный сценарий: PAT → agent session → `DELETE_CARD` → 409 `approval_required` → Pending 1 на доске; plan hash и JSON видны. Это лучший кусок продукта.
- Pause/End, run rollback, policy — есть; часть проверена существующими e2e, не вручную.

**Что не так**
- **`/agents` показывает 0 waiting approval при Pending 1.** Счётчик считает статус сессии, а не approval-запросы; ссылки на approval нет. Человек, который живёт на `/agents`, пропустит destructive-запрос.
- **Approval доступен только из board header**; глобального approval-inbox нет. На 390 иконка bot — ещё один безымянный (визуально) значок в куче.
- **Пустой `/agents` не ведёт к созданию ключа** — тупик для первого запуска агента.
- **Нет attention-уведомления** о pending approval (см. 3.7).

**Вывод:** human-control loop *внутри доски* понятен и даже красив. Между `/agents` и доской — разрыв; для agent-first продукта это критично.

### 3.10. Mobile 390 px

**Что работает**
- Нет горизонтального overflow страницы: `scrollWidth = innerWidth = 390` на board/card/switcher/account.
- Header 89 px, в две строки; view tabs, filters, search помещаются.
- Card dialog 366×812, контент скроллится, title/close остаются сверху (`24-mobile-card-top-390.png`, `25-mobile-comment-no-delete-390.png`).
- Touch drag/calendar/table покрыты существующим e2e (`e2e/tests/app/mobile/layout.spec.ts`, `touch-views.spec.ts`); вручную проверял layout и комментарии.
- Board switcher на touch показывает archive-кнопку (`27-mobile-switcher-390.png`), потому что там есть `no-hover`.

**Что сломано**
- **Комментарий: невидимая кнопка удаления** (см. #5). Это главный mobile-баг.
- **Mention**: на touch после `@` — 0 вариантов (`26-mobile-mention-nothing-390.png`).
- **Лейбл на карточке** обрезается по правому краю (`23-mobile-board-390.png`).
- **Safe area — риск, не проверено на реальном iPhone**: `apple-mobile-web-app-status-bar-style=black-translucent`, viewport без `viewport-fit=cover`, `env(safe-area-inset-*)` в коде нет. В 390×844 эмуляции выреза нет, поэтому это код-риск, а не наблюдение.
- **Много icon-only кнопок** в шапке; на 390 они жмутся, tooltips недоступны, а часть (bot, share) неочевидна без знания продукта.

**Вывод:** layout-инженерия хорошая; touch-affordance — нет. Один `no-hover`-класс отделяет «нормально» от «невидимая удалялка».

### 3.11. Accessibility

**Что работает**
- Focus trap в карточке: 12 Tab-нажатий остаются внутри dialog.
- Карточка открывается с клавиатуры: focus на dnd-wrapper + Enter/Space → диалог.
- Icon buttons в основном имеют `aria-label`; lazy icons не ломают имена.
- `prefers-reduced-motion` покрыт CSS (не проверял визуально в браузере).
- Skeleton/error/retry/scroll-lock — есть.

**Что сломано (axe-core 4.10 на живом UI)**
- **`button-name` critical**: чекбокс пункта чек-листа — `<button aria-pressed>` без имени (`CardChecklists.tsx:317`).
- **`aria-progressbar-name` serious**: progressbar чек-листа без имени (`CardChecklists.tsx:283`).
- **Focus return**: после Escape activeElement = `BODY`, не карточка/триггер.
- **Contrast**: 3 violating nodes в light, 5 в dark; `Block type` 1.89:1, empty placeholder 3.05:1, active tab 4.09:1, label 4.19:1, activity tab 4.16:1.
- **`page-has-heading-one`**: нет h1; board title — h2.
- **`landmark-no-duplicate-main`**: `<main>` доски + `<main>` внутри CardDialog (`CardDialog.tsx:1149`).
- **`listitem`**: insert-zone `<li>` вне `ul/ol`.

**Вывод:** база лучше, чем у многих Kanban; но карточка — центральный объект — имеет critical unnamed control и теряет фокус. Это не «мелочь для галочки», это ежедневный сценарий.

### 3.12. States and polish

**Что работает**
- Загрузка доски: skeleton; ошибка: «Could not load your boards» + Retry; retry восстанавливает.
- Optimistic updates: карточка/перетаскивание/комментарий; rollback при ошибке (код).
- Disabled states: Save/Cancel комментария, upload 20 files, WIP, формы.
- Destructive confirms: board delete/archive, card archive/delete, comment delete, account delete.
- Toasts, dark/light, 1024 layout, reduced motion CSS.

**Что не так**
- Draft loss — P1.
- Invisible touch delete — P1/P2.
- Лживые счётчики: свитчер (архив), `/agents` (approval), Comments badge (страница).
- `/agents` empty без CTA; board empty без шаблона.
- Нет undo после delete comment; confirm без текста.
- Label overlap; contrast; safe-area.
- `Block type` в редакторе — почти невидимый placeholder.

**Вывод:** состояний много и они аккуратные; но данные/действия местами врут или теряются. Полировка не должна идти раньше edit/mention/inbox.

---

## 4. Table-stakes checklist

> `Pass/Partial/Fail` — по совокупности ручного прогона, кода и существующих e2e. Где сценарий не запускался руками, это сказано в причине; я не выдаю чтение кода за клик.

### Onboarding
| Пункт | Статус | Причина |
|---|---|---|
| Регистрация / логин | **Pass** | Форма, валидация, ошибки; no-mail авто-верификация. |
| Email verification | **Pass** | Код-гейт есть; вручную проверен только no-mail режим. |
| Пустое состояние | **Pass** | Понятный CTA «New board». |
| Первая доска с именем | **Partial** | Создаётся «New board» без запроса имени; в свитчере — с запросом. |
| Первая колонка/карточка | **Pass** | Add column → Add a card; inline composer. |
| Шаблон/пример | **Fail** | Нет; пустая доска — только пунктирный Add column. |
| Rename доски | **Partial** | Работает клик по h2, но affordance невидим. |

### Board
| Пункт | Статус | Причина |
|---|---|---|
| Create/switch/rename | **Pass** | Switcher, inline title, reload. |
| Archive/restore/delete | **Pass** | Подтверждения, archived section, restore. |
| Members/invite/accept | **Pass** | Bell, accept/decline, live board. |
| Roles/permissions | **Pass** | Admin/Member/Viewer; viewer read-only live. |
| Self-leave | **Fail** | Нет кнопки/API для MEMBER/VIEWER. |
| Share create/revoke | **Pass** | UI-контролы live/snapshot, TTL, flags, embed; вручную не создавал, e2e есть. |
| Share edit | **Fail** | Только create/revoke/refresh; Edit нет. |
| Board settings/workflow | **Pass** | Матрица, global transitions, initial/done. |
| Search/filter | **Partial** | Filters URL; search не включает comments/attachments. |
| Views | **Pass** | Board/Calendar/Table/Watch. |
| Presence/realtime | **Pass** | 2 аватара; card live без reload. |
| Bulk actions | **Partial** | Archive all per column; multi-select нет. |

### Card
| Пункт | Статус | Причина |
|---|---|---|
| Create/open/edit title | **Pass** | Inline + dialog. |
| Description | **Pass** | MDX, autosave, conflict tests. |
| Assignee/due/priority | **Pass** | Все три, reload. |
| Labels | **Pass** | Picker/create; но chip обрезается на board. |
| Checklists | **Pass** | Add/toggle; a11y unnamed toggle. |
| Links | **Pass** | Link card + suggestions; code/e2e, вручную не создавал. |
| Attachments | **Pass** | Upload/download/delete, 20 cap. |
| Move/drag/undo | **Pass** | Drag observed; Undo returned card. |
| Archive/restore/delete | **Pass** | Context menu + archive restore to column. |
| Duplicate | **Pass** | Пункт в контекстном меню; вручную не запускал, e2e есть. |
| Deep link `?card=` | **Pass** | Opens dialog; close clears param. |

### Comments
| Пункт | Статус | Причина |
|---|---|---|
| Write/send | **Pass** | Markdown, optimistic, Ctrl+Enter. |
| Edit own | **Fail** | Нет UI/API; PATCH 404. |
| Delete own | **Partial** | Desktop hover works; touch invisible but tappable. |
| Mentions | **Fail** | `@` — plain text; no picker/notification. |
| Notifications | **Fail** | No mention/assignment/due; attention inbox not wired. |
| Attachments in comment | **Partial** | Markdown media есть; отдельного composer-attachment UX не проверял. |
| Realtime | **Pass** | SSE code + existing e2e; observed card realtime. |
| Empty/loading/error | **Partial** | Composer/empty/skeleton; error toast. |
| Draft safety | **Fail** | Закрыл карточку — текст исчез. |
| Undo delete | **Fail** | Confirm says cannot be undone. |
| Search comments | **Fail** | Global/board search only title/description/labels/checklists. |

### Collaboration
| Пункт | Статус | Причина |
|---|---|---|
| Invite/accept/decline | **Pass** | Bell + live board. |
| Role changes | **Pass** | Live promotion/demotion; server enforcement. |
| Viewer restrictions | **Pass** | No composer/undo/share; API 403. |
| Presence | **Pass** | 2 avatars. |
| Live card updates | **Pass** | Observed without reload. |
| Conflict handling | **Pass** | Existing e2e; not manually duplicated. |
| Self-leave | **Fail** | No Leave. |
| Watchers/follow | **Fail** | No card/board subscription. |

### Search/navigation
| Пункт | Статус | Причина |
|---|---|---|
| Ctrl/Cmd+K global | **Pass** | Cards/boards, keyboard, highlights. |
| Board filter | **Pass** | URL state, facets; code/e2e, вручную не гонял. |
| Comments/attachments | **Fail** | Not indexed. |
| Deep links | **Pass** | `?card=`; filters in URL. |
| Back/forward | **Pass** | Dialog closes with URL; code + existing tests. |
| Empty results | **Pass** | «Nothing found.» |
| Cap/grouping | **Partial** | 20 before grouping; board hits can disappear (G-17). |

### Notifications
| Пункт | Статус | Причина |
|---|---|---|
| Invitations | **Pass** | Badge/list/accept/decline. |
| Attention inbox | **Fail** | API exists; no UI. |
| Mark read/read-all | **Fail** | No UI. |
| Mention/assignment/due | **Fail** | Not generated. |
| Jump to object | **Partial** | Invitation → board; attention → nowhere. |
| Notification prefs | **Partial** | Digest only; notifyAttention absent. |

### Account
| Пункт | Статус | Причина |
|---|---|---|
| Profile/avatar/name | **Pass** | Upload/color/name. |
| Password | **Pass** | Current+new+repeat; revokes sessions/PAT. |
| Email change | **Pass** | Code/UI exists; not manual. |
| API keys | **Pass** | Scopes, board, read-only, rate, expiry, pause, revoke. |
| Sessions list/revoke | **Fail** | Only password-change revokes all. |
| Theme/language/time | **Pass** | Light/dark, EN/RU, 12/24h. |
| Export | **Partial** | Account JSON and all boards; no per-board. |
| Delete account | **Pass** | Email+password proof, 7-day copy. |
| Import | **Pass** | JSON import в Data; вручную не импортировал, только UI/код. |

### Agents
| Пункт | Статус | Причина |
|---|---|---|
| `/agents` list/detail | **Pass** | Sessions, heartbeat, filters, pause/end. |
| Approvals | **Partial** | Excellent board modal; `/agents` says 0; no global entry. |
| Pause/policy/runs | **Pass** | Dialog + session controls; existing e2e. |
| Run rollback | **Pass** | UI present; not manually tested. |
| Discoverability | **Partial** | Bot icon; empty state no key CTA. |
| Attention for approval | **Fail** | No in-app notification; only board badge. |

### Mobile
| Пункт | Статус | Причина |
|---|---|---|
| 390 layout/overflow | **Pass** | `scrollWidth = 390`; dialogs fit. |
| Card dialog/sticky header | **Pass** | 366×812; close visible while scrolling. |
| Touch drag | **Pass** | Existing mobile e2e; not manual. |
| Touch destructive controls | **Fail** | Comment delete opacity 0 / pointer-events auto. |
| Mention on touch | **Fail** | No picker. |
| Safe area | **Partial** | Нет `env(safe-area-inset-*)`; PWA-мета `black-translucent`; не проверено на реальном iPhone. |
| Label/metadata | **Partial** | Label chip clipped; hover actions overlay. |

### Accessibility
| Пункт | Статус | Причина |
|---|---|---|
| Keyboard open/close | **Partial** | Card opens with Enter; focus returns to BODY. |
| Dialog focus trap | **Pass** | 12 Tabs stay inside. |
| Icon names | **Partial** | Mostly labeled; checklist toggle unnamed. |
| Contrast | **Fail** | 3 light / 5 dark violations; Block type 1.89:1. |
| Headings/landmarks | **Fail** | No h1; duplicate main; li outside list. |
| Reduced motion | **Pass** | CSS media queries; not visually verified. |
| Screen-reader progress | **Partial** | Progressbar no name. |

### States
| Пункт | Статус | Причина |
|---|---|---|
| Loading skeletons | **Pass** | Board/comments/agents code; e2e. |
| Error/retry | **Pass** | `57-board-load-error-1440.png`; retry works. |
| Empty states | **Partial** | Board empty no template; agents empty no CTA; search no hint. |
| Toasts | **Pass** | Code + observed patterns. |
| Optimistic updates | **Pass** | Card DnD/comment; rollback code. |
| Disabled states | **Pass** | Save/Cancel, upload cap, WIP. |
| Destructive confirm | **Partial** | Most confirm; share revoke does not. |
| Draft safety | **Fail** | Comment draft lost. |
| Double submit | **Pass** | Comment send disabled while sending; code. |
| Scroll lock/z-index | **Partial** | Dialogs lock; label vs hover actions overlap. |

---

## 5. Quick wins (10 маленьких, высокий эффект)

1. **`no-hover:opacity-100` на comment-delete** и превью текста в confirm. Один класс + копирайт; убирает невидимую удалялку и страх «что я удаляю».
2. **Черновик комментария — module-level map + confirm on close.** S; закрывает P1 data loss (TASK-177.3).
3. **Подключить колокольчик к уже существующему attention API**: badge, list, read/read-all, deep-link. Новый backend не нужен; только клиент и UI.
4. **Считать approvals на `/agents`** и дать ссылку в board approval dialog. Один запрос + один счётчик; убирает «0 waiting» при Pending 1.
5. **CTA «Create API key» в пустом `/agents`** (ссылка на Account → API keys). Убирает тупик первого агента.
6. **Empty-state create board → prompt имени**, как в свитчере. Один reuse существующего input.
7. **A11y-фиксы на карточке**: `aria-label` на чекбокс пункта, `aria-label` на progressbar, вернуть фокус на карточку после close.
8. **Контрастные токены**: `Block type`, `No cards yet`, active tab, label chip, activity tab. Axe уже даёт точные пары.
9. **Счётчик свитчера — только активные карточки**; убрать archived из `Object.keys(b.cards).length`. Одна строка.
10. **Поиск по комментариям/вложениям** через уже существующий backend `searchCards` (comments) + filename-поле. Не «полный поиск», но закрывает «мы это обсуждали».

---

## 6. Product decisions

1. **Mentions: входят в продукт или нет?** Если да — нужен парсер, user-picker, права, канал доставки, настройки. Если нет — убрать `@` из маркетинга/копирайта и не создавать ложных ожиданий.
2. **Edit comment: навсегда или окно 15 минут?** Нужен `editedAt`, история, кто может (только автор — TASK-176.2), что видит админ. Без решения API не появляется.
3. **Один inbox или два?** Сейчас bell = invitations, а attention API — отдельная сущность. Нужен один колокольчик с секциями или два разных входа. Read/read-all и deep-link — часть решения.
4. **Approvals: board-scoped или global?** Если агент может ждать approval, человек должен видеть его в `/agents` и в bell, а не только в board-модалке. Кто получает? Что при expiry?
5. **«Delete forever»: true purge или retention + Recently deleted?** TASK-177 предлагает оставить soft-delete и убрать слово «permanently». Это влияет на copy, restore и admin.
6. **Self-leave и last-admin guard.** MEMBER/VIEWER должны уходить; последний ADMIN — нет. Нужен `DELETE /boards/:id/members/me` + Activity/SSE.
7. **Bulk actions: нужны ли вообще?** Если целевой пользователь — Trello-класс, можно отложить; если Linear/Jira-класс — multi-select обязателен.
8. **PWA/mobile: safe-area, install, offline.** Сейчас нет `env(safe-area-inset-*)`; на notched iPhone это не «полировка», а обрезанные кнопки.

---

## 7. What is actually good

- **Agent control** — лучший кусок: plan hash, risk, destructive badge, approve/reject, pause, runs/policy/rollback. Это не «ещё один Kanban»; это реальная human-in-the-loop система.
- **Watch view** — редкая вещь: live-feed с диффами, roster, agent activity и retention; не декорация, а рабочий инструмент наблюдателя.
- **Realtime/presence** — второе окно видит карточку без reload; два аватара; live-понижение роли применяется на лету.
- **Board/card shell** — drag & drop, undo, archive/restore, deep links, views, filters в URL, error/retry. Это взрослая инженерия.
- **Roles/permissions** — VIEWER реально read-only, сервер это подтверждает; last-admin guard.
- **Account/data rights** — export, delete account с proof, PAT scopes/rate/expiry/pause. Для self-host это выше среднего.
- **Дизайн** — цельная типографика, тёмная тема, 1024/390 без page-overflow; диалоги аккуратные.
- **Честные docs** — user guide и TASK-177 сами перечисляют часть ограничений; продукт не притворяется, что всего хватает.

---

## 8. If you fix only 10 things

1. **Edit own comment** (P1, TASK-176.2): PATCH + editedAt + inline edit + SSE + marker.
2. **Mentions + attention inbox** (P1): `@` picker, notification rows, bell badge, read/read-all, deep-link to card/approval.
3. **Draft safety** (P1, TASK-177.3): не терять текст при close/error; confirm или module-level draft.
4. **Mobile comment delete** (P1/P2): `no-hover` visibility, confirm с текстом, touch-target ≥44 px.
5. **Search comments/attachments** (P2): подключить существующий backend search + filename; показать «искали также в обсуждениях».
6. **Agent approval truth** (P2): `/agents` считает approvals, ведёт в board dialog/bell; pending badge sync.
7. **Self-leave board** (P2, TASK-177.2): `DELETE members/me`, кнопка, last-admin guard, Activity/SSE.
8. **A11y карточки** (P2): имена чекбокса/progressbar, возврат фокуса, контраст `Block type`/empty/tab/label.
9. **First-run** (P2): имя доски при создании, шаблон/пример колонок, заметный rename.
10. **Honest counters + metadata** (P3): switcher active-only, Comments «50 of N», `/agents` approvals, label chip не под hover-иконками.

---

## Приложение: ключевые скриншоты

| Файл | Что показывает |
|---|---|
| `01-login-1440.png`, `02-register-1440.png` | Логин/регистрация. |
| `04-empty-state-1440.png`, `05-empty-board-1440.png` | Первый запуск и «New board». |
| `06-board-populated-1440.png` | Доска с колонками. |
| `07-card-dialog-top-1440.png`, `09-comments-no-edit-1440.png` | Карточка и комментарии без Edit. |
| `08-comment-hover-1440.png` | Только Delete по hover. |
| `10-search-card-hit-1440.png`, `11-search-comment-miss-1440.png`, `60-search-attachment-miss-1440.png` | Поиск card hit vs comment/attachment miss. |
| `12-table-view-1440.png`, `13-calendar-view-1440.png`, `14-watch-view-1440.png` | Views. |
| `15-card-dragged-1440.png`, `16-card-context-menu-1440.png` | Drag/undo, контекстное меню. |
| `17-board-settings-1440.png` | Workflow settings. |
| `18-board-switcher-1440.png`, `56-switcher-count-includes-archived-1440.png` | Свитчер и лживый счётчик. |
| `19-account-profile-1440.png`, `20-account-*.png`, `54-account-security-1440.png` | Аккаунт, токены, data, security. |
| `21-agents-empty-1440.png` | Пустой /agents без CTA. |
| `22-bell-no-invitations-1440.png` | Bell «No invitations» при attention unread=1. |
| `23-mobile-board-390.png` … `29-mobile-account-data-390.png` | Mobile layout. |
| `25-mobile-comment-no-delete-390.png`, `52-mobile-invisible-delete-opened-confirm.png` | Невидимая удалялка и confirm. |
| `26-mobile-mention-nothing-390.png` | @ без вариантов. |
| `30-…`–`38-…` | Приглашение, роли, presence, realtime, mention без уведомления, viewer. |
| `39-dark-board-1440.png`, `40-dark-card-1440.png` | Тёмная тема/контраст. |
| `41-board-1024.png`–`44-account-1024.png` | 1024. |
| `45-…`, `46-…`, `47-…` | Archive/restore карточки и доски. |
| `48-…`–`51-…` | Agent pending, approval, /agents, session detail. |
| `53-share-dialog-1440.png` | Share dialog. |
| `55-viewer-members-no-leave-1440.png` | Viewer не может выйти. |
| `57-board-load-error-1440.png` | Error/retry. |
| `58-comment-draft-before-close-1440.png`, `59-comment-draft-lost-1440.png` | Потеря черновика. |
