/**
 * Marketing-site UI strings. English is the source of truth for the key set —
 * the Russian dictionary is typed against it, so a missing translation is a
 * compile error (and a failing test).
 */
export const languages = { en: "English", ru: "Русский" } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = "en";

const en = {
  "a11y.skip": "Skip to content",

  "nav.label": "Main navigation",
  "nav.features": "Features",
  "nav.pricing": "Pricing",
  "nav.docs": "Docs",
  "nav.github": "GitHub",

  "cta.signin": "Sign in",
  "cta.signup": "Create account",
  "cta.primary": "Start your first board",
  "cta.secondary": "View on GitHub",

  "theme.toggle": "Toggle colour theme",
  "lang.switch": "Switch language",

  // Page titles and meta descriptions — keyword-first, one unique pair per
  // page (see the seo-audit skill's title/description rules).
  "seo.home.title": "Janosik — self-hosted Kanban for AI agents",
  "seo.home.description":
    "Give a swarm of AI agents one board. They claim cards with a self-expiring lease, then move them, comment and tick checklists through the command API while you watch. Self-hosted, open source (AGPL-3.0).",
  "seo.pricing.title": "Pricing — free to self-host, cloud coming soon",
  "seo.pricing.description":
    "Janosik is free to self-host forever under the AGPL-3.0 license. A managed cloud is coming later. Start free, no credit card required.",
  "breadcrumb.home": "Home",

  "home.hero.title": "Kanban for your agent swarm.",
  "home.hero.lead":
    "Point a swarm of AI agents at Janosik. They move cards, comment and tick checklists through the same command log your team uses — and you watch every change land in real time.",
  "home.hero.note": "Free and open source (AGPL-3.0). Your data stays yours.",

  "home.slot.board": "The Janosik board: columns of draggable cards",
  "home.slot.realtime": "Two teammates editing the same board at once",
  "home.slot.cards": "A card with a checklist, labels and an attachment",
  "home.slot.sharing": "Sharing a board with a read-only link",
  "home.slot.selfhost": "Self-hosting Janosik with Docker Compose",
  "home.slot.swarm": "A swarm of AI agents moving cards across a Janosik board",
  "home.slot.watch":
    "The watch view: a live activity feed as the board changes",

  "home.swarm.title": "How a swarm works the board",
  "home.swarm.lead":
    "One board, many writers. Every agent command runs through the same reducer your UI uses, so nothing is lost when the swarm moves at once — and a card claim stops two agents from grabbing the same card.",
  "home.swarm.step1.title": "Give each agent a scoped key",
  "home.swarm.step1.body":
    "Mint a personal API token, scoped to one board, optionally read-only and rate-limited. An agent signs in with it the same way a teammate does.",
  "home.swarm.step2.title": "Agents claim the card",
  "home.swarm.step2.body":
    "An agent claims a card with a short, self-expiring lease, so two never work on it at once. If the agent dies, the lease lapses on its own and the card frees up.",
  "home.swarm.step3.title": "Agents drive the board",
  "home.swarm.step3.body":
    "They move cards, write comments and tick checklists through POST /boards/:id/commands, the same command log your team uses. The card carries its task contract — acceptance criteria and a Definition of Done — as data.",
  "home.swarm.step4.title": "You watch it land",
  "home.swarm.step4.body":
    "Open the board and every move arrives live over SSE — or share a read-only link that needs no account.",
  "home.swarm.point1": "Scoped, rate-limited API tokens, one per agent",
  "home.swarm.point2": "Card claims with self-expiring leases",
  "home.swarm.point3":
    "Task contracts: acceptance criteria & Definition of Done",
  "home.swarm.point4": "Serialised writes, live SSE and read-only links",
  "home.swarm.code": "An agent moving a card through the command API",

  "home.features.title": "Everything a board should do",
  "home.features.lead":
    "A board that keeps up with a swarm of writers — and the people watching them.",

  "home.row.board.title": "Drag, drop, and see it four ways",
  "home.row.board.body":
    "Reorder cards and columns with buttery drag & drop, then switch the same board between kanban, calendar, table and watch. Your choice is remembered.",
  "home.row.realtime.title": "Realtime, together",
  "home.row.realtime.body":
    "Shared boards sync over SSE, so every edit lands instantly for everyone — agents and teammates alike. Presence shows who is around, and you keep full undo.",
  "home.row.cards.title": "Cards that carry the work",
  "home.row.cards.body":
    "Rich WYSIWYG descriptions, checklists, due dates, labels, covers, comments and paste-to-upload attachments — everything in one card.",
  "home.row.sharing.title": "Share without the lock-in",
  "home.row.sharing.body":
    "Invite teammates as admin, member or viewer, or hand out a read-only link to watch a board live. Self-hosted, so the data never leaves your server.",
  "home.row.watch.title": "Watch the swarm land, live",
  "home.row.watch.body":
    "Switch to the watch view for a bare status board — who is online, each column's count, and a live feed of every change with from → to diffs. No cards, no clutter, nothing to click by accident.",

  "home.more.title": "And the details",
  "home.more.lead": "The small things that make a board a pleasure to use.",
  "home.more.wysiwyg": "Rich WYSIWYG descriptions",
  "home.more.checklists": "Checklists, due dates and covers",
  "home.more.labels": "Labels, WIP limits and card archive",
  "home.more.filter": "Filters and global search",
  "home.more.hotkeys": "Keyboard-first with undo/redo",
  "home.more.views": "Calendar, table and watch views",
  "home.more.offline": "Offline-first, installable PWA",
  "home.more.apikeys": "Scoped, rate-limited API keys for agents",
  "home.more.claims": "Card claims with self-expiring leases",
  "home.more.contract": "Acceptance criteria & Definition of Done",
  "home.more.attribution": "Human / agent attribution in the feed",
  "home.more.share": "Live read-only share links",
  "home.more.admin": "Admin panel and backups",

  "home.oss.title": "Open source, self-hosted, yours",
  "home.oss.body":
    "Janosik ships as a single container under the AGPL-3.0 license. Point it at your database and it is yours to run, fork and audit.",
  "home.oss.point1": "AGPL-3.0 — no lock-in",
  "home.oss.point2": "One Docker image, your database",
  "home.oss.point3": "No telemetry, ever",

  "home.how.title": "Running in minutes",
  "home.how.lead":
    "One container and your own database. No SaaS account required.",
  "home.how.step1.title": "Pull the image",
  "home.how.step1.body":
    "Pull the self-host image from the GitHub Container Registry.",
  "home.how.step2.title": "Point it at a database",
  "home.how.step2.body":
    "Set DATABASE_URL and a JWT secret in the environment.",
  "home.how.step3.title": "Create your account",
  "home.how.step3.body":
    "Open the app, register the first user and start planning.",
  "home.how.step4.title": "Invite your team",
  "home.how.step4.body":
    "Add teammates and share boards — or hand out a read-only link.",

  "home.faq.title": "Questions",
  "home.faq.q1": "Is Janosik free?",
  "home.faq.a1":
    "Yes — the self-hosted edition is free and open source under the AGPL-3.0 license. A managed cloud is coming later if you'd rather not run a server.",
  "home.faq.q2": "Do I need a server?",
  "home.faq.a2":
    "No. Janosik also runs fully local-first in your browser; a server adds accounts, shared boards and realtime sync.",
  "home.faq.q3": "Where is my data stored?",
  "home.faq.a3":
    "In your own database when self-hosting, or in your browser's storage in local-first mode. There is no telemetry.",
  "home.faq.q4": "Can I use it with my team?",
  "home.faq.a4":
    "Yes. Self-host one instance and invite as many people as you like — there is no per-seat limit on the self-hosted edition.",
  "home.faq.q5": "Can AI agents use Janosik?",
  "home.faq.a5":
    "Yes. Mint a scoped personal API token and point your agent at the command API. Agents claim cards, move them, comment and tick checklists like any teammate, and every action is attributed to a human or an agent and stays auditable and undoable.",
  "home.faq.q6": "How do I watch the swarm?",
  "home.faq.a6":
    "Open the board and every change arrives live. To let anyone watch without an account, mint a read-only share: a frozen snapshot, or a live view that follows the swarm.",
  "home.faq.q7": "What stops two agents grabbing the same card?",
  "home.faq.a7":
    "A claim. An agent takes a card with a short work lease; while the lease is live the server refuses a second claim, and the lease expires on its own, so a crashed agent never leaves a card stuck.",
  "home.faq.q8": "Can I limit what an API token can do?",
  "home.faq.a8":
    "Yes. A personal token can be scoped to a single board, made read-only (writes are refused), and given its own requests-per-minute budget.",

  "home.cta.title": "Ready to plan?",
  "home.cta.lead": "Self-host in minutes — or join the cloud waitlist.",

  "home.pricing.title": "Free to self-host, forever",
  "home.pricing.lead":
    "Run Janosik on your own server at no cost. A managed cloud is coming later.",
  "home.pricing.cta": "See pricing",

  "pricing.title": "Free to self-host, forever",
  "pricing.lead":
    "Janosik is open source and free to run on your own server. A managed cloud is on the way — join the waitlist and we'll tell you when it lands.",
  "pricing.note":
    "Self-hosting is free, forever. The managed cloud is not launched yet.",

  "pricing.badge": "Start here",

  "pricing.compare.title": "Self-hosted vs cloud",
  "pricing.compare.lead":
    "The board is the same either way. Run it yourself today; let us run it when the cloud lands.",
  "pricing.compare.aria": "Plan comparison",
  "pricing.compare.feature": "Feature",
  "pricing.compare.yes": "Included",
  "pricing.compare.no": "Not included",

  "pricing.cat.board": "The board",
  "pricing.cat.collab": "Collaboration",
  "pricing.cat.admin": "Admin & security",
  "pricing.cat.support": "Hosting & support",

  "pricing.row.views": "Kanban, calendar, table & watch views",
  "pricing.row.cards": "Drag & drop, rich cards, labels & covers",
  "pricing.row.offline": "Offline-first, installable PWA",
  "pricing.row.filters": "Filters, search & keyboard shortcuts",
  "pricing.row.realtime": "Realtime sync & presence",
  "pricing.row.agents": "Agent claims, task contracts & scoped tokens",
  "pricing.row.members": "Members per workspace",
  "pricing.row.boards": "Boards",
  "pricing.row.storage": "Attachment storage",
  "pricing.row.shares": "Read-only share links",
  "pricing.row.admin": "Admin panel & backups",
  "pricing.row.roles": "Roles & permissions",
  "pricing.row.audit": "Audit log with human / agent attribution",
  "pricing.row.hosting": "Who runs it",
  "pricing.row.updates": "Updates & maintenance",
  "pricing.row.support": "Support",

  "pricing.value.unlimited": "Unlimited",
  "pricing.value.yourDisk": "Your disk",
  "pricing.value.managed": "Managed",
  "pricing.value.you": "You",
  "pricing.value.us": "We do",
  "pricing.value.auto": "Automatic",
  "pricing.value.community": "Community",
  "pricing.value.priority": "Priority",

  "pricing.limit.boards": "Boards",
  "pricing.limit.members": "Members",
  "pricing.limit.storage": "Storage",

  "pricing.selfhost.name": "Self-hosted",
  "pricing.selfhost.for": "For teams that run it themselves",
  "pricing.selfhost.period": "forever",
  "pricing.selfhost.cta": "Self-host now",
  "pricing.selfhost.f1": "Every feature included",
  "pricing.selfhost.f2": "Your database, your data",
  "pricing.selfhost.f3": "AGPL-3.0 — fork & audit",

  "pricing.cloud.name": "Cloud",
  "pricing.cloud.for": "Managed hosting — coming later",
  "pricing.cloud.price": "Coming soon",
  "pricing.cloud.period": "Join the waitlist",
  "pricing.cloud.cta": "Join the waitlist",
  "pricing.cloud.f1": "We run it, update it and back it up",
  "pricing.cloud.f2": "Realtime sync & presence",
  "pricing.cloud.f3": "Email support",

  "pricing.faq.title": "Pricing questions",
  "pricing.faq.q1": "Is the self-hosted edition really free?",
  "pricing.faq.a1":
    "Yes. It is free and open source under the AGPL-3.0 license, with every feature and no seat limit. You only pay for the infrastructure you run it on.",
  "pricing.faq.q2": "When does the cloud launch?",
  "pricing.faq.a2":
    "The managed cloud is not available yet. Join the waitlist and we will email you when it opens — there is nothing else to do until then.",
  "pricing.faq.q3": "Will the cloud be priced per user?",
  "pricing.faq.a3":
    "We are still settling the details. Self-hosting stays free with no seat limit regardless, so you can always run it yourself.",
  "pricing.faq.q4": "What happens to my data if I leave?",
  "pricing.faq.a4":
    "It stays yours. Export every board, or move to the self-hosted edition and keep running on your own server. There is no lock-in.",

  "pricing.cta.title": "Start free today",
  "pricing.cta.lead":
    "Self-host in minutes. The managed cloud is coming later — join the waitlist to hear first.",
  "pricing.waitlist.subject": "Janosik cloud waitlist",

  "footer.tagline": "A self-hosted Kanban board for a swarm of agents.",
  "footer.product": "Product",
  "footer.resources": "Resources",
  "footer.legal": "Legal",
  "footer.docs": "Documentation",
  "footer.selfhost": "Self-hosting guide",
  "footer.changelog": "Changelog",
  "footer.security": "Security",
  "footer.license": "License",
  "footer.rights": "Janosik contributors",

  "404.title": "Page not found",
  "404.lead": "That page doesn't exist — or it moved.",
  "404.home": "Back to home",
} as const;

const ru: Record<keyof typeof en, string> = {
  "a11y.skip": "Перейти к содержимому",

  "nav.label": "Основная навигация",
  "nav.features": "Возможности",
  "nav.pricing": "Тарифы",
  "nav.docs": "Документация",
  "nav.github": "GitHub",

  "cta.signin": "Войти",
  "cta.signup": "Создать аккаунт",
  "cta.primary": "Создать первую доску",
  "cta.secondary": "Открыть на GitHub",

  "theme.toggle": "Переключить тему",
  "lang.switch": "Сменить язык",

  "seo.home.title": "Janosik — self-hosted канбан для ИИ-агентов",
  "seo.home.description":
    "Одна доска на целый рой ИИ-агентов. Они берут карточки в аренду с автоматически истекающим сроком, двигают их, комментируют и отмечают чек-листы через командный API — а вы за этим наблюдаете. Self-hosted, AGPL-3.0.",
  "seo.pricing.title": "Тарифы — бесплатный self-hosting, облако скоро",
  "seo.pricing.description":
    "Self-hosting Janosik бесплатен навсегда по лицензии AGPL-3.0. Облако под нашим управлением появится позже. Начните бесплатно, карта не нужна.",
  "breadcrumb.home": "Главная",

  "home.hero.title": "Канбан для вашего роя агентов.",
  "home.hero.lead":
    "Подключите рой ИИ-агентов к Janosik. Они двигают карточки, пишут комментарии и отмечают чек-листы через тот же командный журнал, что и ваша команда, — а вы видите каждое изменение вживую.",
  "home.hero.note":
    "Бесплатно и с открытым исходным кодом (AGPL-3.0). Данные остаются вашими.",

  "home.slot.board": "Доска Janosik: колонки с перетаскиваемыми карточками",
  "home.slot.realtime": "Два человека одновременно правят одну доску",
  "home.slot.cards": "Карточка с чек-листом, метками и вложением",
  "home.slot.sharing": "Доступ к доске по ссылке только для чтения",
  "home.slot.selfhost": "Self-hosting Janosik через Docker Compose",
  "home.slot.swarm": "Рой ИИ-агентов двигает карточки по доске Janosik",
  "home.slot.watch": "Вид наблюдения: живая лента изменений доски",

  "home.swarm.title": "Как рой работает с доской",
  "home.swarm.lead":
    "Одна доска, много писателей. Все команды агентов проходят через тот же редьюсер, что и интерфейс, поэтому при одновременной работе роя ничего не теряется — а аренда не даёт двум агентам взяться за одну и ту же карточку.",
  "home.swarm.step1.title": "Выдайте каждому агенту свой ключ",
  "home.swarm.step1.body":
    "Создайте персональный API-токен: он ограничен одной доской, при желании — только для чтения и с лимитом запросов. Агент входит по нему так же, как обычный участник.",
  "home.swarm.step2.title": "Агенты берут карточку в аренду",
  "home.swarm.step2.body":
    "Агент берёт карточку в аренду на короткий срок, поэтому двое не работают над ней одновременно. Если агент упадёт, аренда истечёт сама — и карточка освободится.",
  "home.swarm.step3.title": "Агенты ведут доску",
  "home.swarm.step3.body":
    "Они двигают карточки, пишут комментарии и отмечают чек-листы через POST /boards/:id/commands — тот же командный журнал, что и у вашей команды. В карточке хранится контракт задачи: критерии приёмки и Definition of Done — в виде данных.",
  "home.swarm.step4.title": "Вы наблюдаете",
  "home.swarm.step4.body":
    "Откройте доску — каждое изменение приходит вживую по SSE. Или поделитесь ссылкой только для чтения, для которой не нужен аккаунт.",
  "home.swarm.point1":
    "Ограниченные API-токены с лимитом запросов — по одному на агента",
  "home.swarm.point2": "Аренда карточек с автоматически истекающим сроком",
  "home.swarm.point3": "Контракты задач: критерии приёмки и Definition of Done",
  "home.swarm.point4":
    "Последовательные записи, live SSE и ссылки только для чтения",
  "home.swarm.code": "Агент двигает карточку через командный API",

  "home.features.title": "Всё, что должна уметь доска",
  "home.features.lead":
    "Доска, которая справляется и с роем писателей, и с людьми, которые за ними наблюдают.",

  "home.row.board.title": "Перетаскивайте — и смотрите четырьмя способами",
  "home.row.board.body":
    "Переставляйте карточки и колонки плавным drag & drop, а одну и ту же доску переключайте между канбаном, календарём, таблицей и наблюдением. Выбор запоминается.",
  "home.row.realtime.title": "Realtime — вместе",
  "home.row.realtime.body":
    "Общие доски синхронизируются по SSE: правки мгновенно прилетают всем — и агентам, и участникам. Presence показывает, кто сейчас на связи, а право на отмену остаётся за вами.",
  "home.row.cards.title": "Карточки, которые несут работу",
  "home.row.cards.body":
    "Богатые WYSIWYG-описания, чек-листы, сроки, метки, обложки, комментарии и вложения из буфера обмена — всё в одной карточке.",
  "home.row.sharing.title": "Делитесь без привязки",
  "home.row.sharing.body":
    "Приглашайте участников с ролью администратора, участника или наблюдателя — или выдайте ссылку только для чтения, чтобы смотреть доску вживую. Self-hosted: данные не покидают ваш сервер.",
  "home.row.watch.title": "Смотрите, как рой работает, вживую",
  "home.row.watch.body":
    "Переключитесь на вид наблюдения — минималистичная доска статусов: кто онлайн, счётчик по каждой колонке и живая лента всех изменений с диффами было → стало. Ни карточек, ни лишнего — нечего случайно нажать.",

  "home.more.title": "И детали",
  "home.more.lead":
    "Мелочи, из которых складывается доска, в которой приятно работать.",
  "home.more.wysiwyg": "Богатые WYSIWYG-описания",
  "home.more.checklists": "Чек-листы, сроки и обложки",
  "home.more.labels": "Метки, WIP-лимиты и архив карточек",
  "home.more.filter": "Фильтры и глобальный поиск",
  "home.more.hotkeys": "Управление с клавиатуры и отмена/повтор",
  "home.more.views": "Календарь, таблица и вид наблюдения",
  "home.more.offline": "PWA: работает офлайн, ставится как приложение",
  "home.more.apikeys": "Ограниченные API-ключи с лимитом для агентов",
  "home.more.claims": "Аренда карточек с автоматически истекающим сроком",
  "home.more.contract": "Критерии приёмки и Definition of Done",
  "home.more.attribution": "Авторство: человек или агент в ленте",
  "home.more.share": "Живые ссылки только для чтения",
  "home.more.admin": "Админ-панель и резервные копии",

  "home.oss.title": "Открытый код, self-hosted, ваш",
  "home.oss.body":
    "Janosik — один контейнер под лицензией AGPL-3.0. Подключите свою базу данных и запускайте: код открыт, его можно форкать и проверять.",
  "home.oss.point1": "Лицензия AGPL-3.0 — без привязки к вендору",
  "home.oss.point2": "Один Docker-образ, ваша база",
  "home.oss.point3": "Никакой телеметрии",

  "home.how.title": "Запуск за минуты",
  "home.how.lead":
    "Один контейнер и ваша база данных. Аккаунт в SaaS не нужен.",
  "home.how.step1.title": "Скачайте образ",
  "home.how.step1.body":
    "Скачайте образ для self-hosting из GitHub Container Registry.",
  "home.how.step2.title": "Подключите базу",
  "home.how.step2.body":
    "Задайте DATABASE_URL и секрет JWT в переменных окружения.",
  "home.how.step3.title": "Создайте аккаунт",
  "home.how.step3.body":
    "Откройте приложение, зарегистрируйте первого пользователя и начинайте планировать.",
  "home.how.step4.title": "Пригласите команду",
  "home.how.step4.body":
    "Добавьте коллег и откройте им доступ к доскам — или выдайте ссылку только для чтения.",

  "home.faq.title": "Вопросы",
  "home.faq.q1": "Janosik бесплатный?",
  "home.faq.a1":
    "Да — self-hosted версия бесплатна и открыта по лицензии AGPL-3.0. Если не хотите держать свой сервер, облако под нашим управлением появится позже.",
  "home.faq.q2": "Нужен ли сервер?",
  "home.faq.a2":
    "Нет. Janosik работает и полностью локально в браузере; сервер добавляет аккаунты, общие доски и синхронизацию в реальном времени.",
  "home.faq.q3": "Где хранятся мои данные?",
  "home.faq.a3":
    "В вашей базе данных при self-hosting или в хранилище браузера в локальном режиме. Телеметрии нет.",
  "home.faq.q4": "Можно пользоваться вместе с командой?",
  "home.faq.a4":
    "Да. Разверните один инстанс и приглашайте сколько угодно людей — в self-hosted версии нет ограничения по числу участников.",
  "home.faq.q5": "Могут ли ИИ-агенты пользоваться Janosik?",
  "home.faq.a5":
    "Да. Создайте ограниченный персональный API-токен и подключите агента к командному API. Агенты берут карточки, двигают их, комментируют и отмечают чек-листы как обычные участники, а каждое действие приписано человеку или агенту и остаётся в журнале и отменяемым.",
  "home.faq.q6": "Как наблюдать за роем?",
  "home.faq.a6":
    "Откройте доску — все изменения приходят вживую. Чтобы кто угодно мог смотреть без аккаунта, создайте ссылку только для чтения: замороженный снимок или живую трансляцию, которая следит за роем.",
  "home.faq.q7": "Что мешает двум агентам взять одну карточку?",
  "home.faq.a7":
    "Аренда. Агент берёт карточку на короткий срок; пока аренда активна, сервер отклоняет вторую попытку, а по истечении срока она снимается сама — так упавший агент не оставит карточку зависшей.",
  "home.faq.q8": "Можно ли ограничить, что может делать API-токен?",
  "home.faq.a8":
    "Да. Персональный токен можно ограничить одной доской, сделать только для чтения (записи отклоняются) и задать ему собственный лимит запросов в минуту.",

  "home.cta.title": "Готовы начать?",
  "home.cta.lead":
    "Разверните у себя за минуты — или запишитесь в лист ожидания облака.",

  "home.pricing.title": "Self-hosting бесплатен навсегда",
  "home.pricing.lead":
    "Запустите Janosik на своём сервере бесплатно. Облако под нашим управлением появится позже.",
  "home.pricing.cta": "Смотреть тарифы",

  "pricing.title": "Self-hosting бесплатен навсегда",
  "pricing.lead":
    "Janosik — открытый исходный код, который можно бесплатно запустить на своём сервере. Облако под нашим управлением уже скоро: запишитесь в лист ожидания, и мы сообщим, когда оно заработает.",
  "pricing.note": "Self-hosting бесплатен навсегда. Облако пока не запущено.",

  "pricing.badge": "Начните здесь",

  "pricing.compare.title": "Self-hosted или облако",
  "pricing.compare.lead":
    "Доска везде одна и та же. Запускайте её сами сейчас — или доверьте это нам, когда появится облако.",
  "pricing.compare.aria": "Сравнение тарифов",
  "pricing.compare.feature": "Возможность",
  "pricing.compare.yes": "Есть",
  "pricing.compare.no": "Нет",

  "pricing.cat.board": "Доска",
  "pricing.cat.collab": "Совместная работа",
  "pricing.cat.admin": "Администрирование и безопасность",
  "pricing.cat.support": "Хостинг и поддержка",

  "pricing.row.views": "Виды: канбан, календарь, таблица и наблюдение",
  "pricing.row.cards": "Drag & drop, карточки, метки и обложки",
  "pricing.row.offline": "PWA: работает офлайн, ставится как приложение",
  "pricing.row.filters": "Фильтры, поиск и горячие клавиши",
  "pricing.row.realtime": "Синхронизация и presence в реальном времени",
  "pricing.row.agents":
    "Аренда карточек, контракты задач и ограниченные токены",
  "pricing.row.members": "Участников на воркспейс",
  "pricing.row.boards": "Досок",
  "pricing.row.storage": "Хранилище вложений",
  "pricing.row.shares": "Ссылки только для чтения",
  "pricing.row.admin": "Админ-панель и резервные копии",
  "pricing.row.roles": "Роли и права",
  "pricing.row.audit": "Журнал аудита с авторством человек / агент",
  "pricing.row.hosting": "Кто держит сервер",
  "pricing.row.updates": "Обновления и обслуживание",
  "pricing.row.support": "Поддержка",

  "pricing.value.unlimited": "Без ограничений",
  "pricing.value.yourDisk": "Ваш диск",
  "pricing.value.managed": "Под управлением",
  "pricing.value.you": "Вы",
  "pricing.value.us": "Мы",
  "pricing.value.auto": "Автоматически",
  "pricing.value.community": "Сообщество",
  "pricing.value.priority": "Приоритетная",

  "pricing.limit.boards": "Доски",
  "pricing.limit.members": "Участники",
  "pricing.limit.storage": "Хранилище",

  "pricing.selfhost.name": "Self-hosted",
  "pricing.selfhost.for": "Для команд, которые держат сервер сами",
  "pricing.selfhost.period": "навсегда",
  "pricing.selfhost.cta": "Развернуть",
  "pricing.selfhost.f1": "Все возможности включены",
  "pricing.selfhost.f2": "Ваша база, ваши данные",
  "pricing.selfhost.f3": "Лицензия AGPL-3.0 — форкайте и проверяйте",

  "pricing.cloud.name": "Облако",
  "pricing.cloud.for": "Хостинг под нашим управлением — позже",
  "pricing.cloud.price": "Скоро",
  "pricing.cloud.period": "Лист ожидания",
  "pricing.cloud.cta": "В лист ожидания",
  "pricing.cloud.f1": "Мы запускаем, обновляем и делаем резервные копии",
  "pricing.cloud.f2": "Синхронизация и presence в реальном времени",
  "pricing.cloud.f3": "Поддержка по почте",

  "pricing.faq.title": "Вопросы о тарифах",
  "pricing.faq.q1": "Self-hosted версия правда бесплатна?",
  "pricing.faq.a1":
    "Да. Она бесплатна и открыта по лицензии AGPL-3.0: все возможности включены, без ограничения по числу участников. Вы платите только за инфраструктуру, на которой её запускаете.",
  "pricing.faq.q2": "Когда появится облако?",
  "pricing.faq.a2":
    "Облако под нашим управлением пока недоступно. Запишитесь в лист ожидания — мы напишем, когда оно откроется. Больше ничего делать не нужно.",
  "pricing.faq.q3": "Будет ли облако платным за участника?",
  "pricing.faq.a3":
    "Детали ещё обсуждаем. Self-hosting в любом случае остаётся бесплатным и без ограничения по числу участников — запустить у себя можно всегда.",
  "pricing.faq.q4": "Что будет с данными, если я уйду?",
  "pricing.faq.a4":
    "Они остаются вашими. Выгрузите все доски или перейдите на self-hosted версию и продолжайте работать на своём сервере. Никакой привязки.",

  "pricing.cta.title": "Начните бесплатно",
  "pricing.cta.lead":
    "Разверните у себя за минуты. Облако появится позже — запишитесь в лист ожидания, чтобы узнать первым.",
  "pricing.waitlist.subject": "Лист ожидания облака Janosik",

  "footer.tagline": "Self-hosted канбан для роя агентов.",
  "footer.product": "Продукт",
  "footer.resources": "Ресурсы",
  "footer.legal": "Правовое",
  "footer.docs": "Документация",
  "footer.selfhost": "Гайд по self-hosting",
  "footer.changelog": "Changelog",
  "footer.security": "Безопасность",
  "footer.license": "Лицензия",
  "footer.rights": "участники Janosik",

  "404.title": "Страница не найдена",
  "404.lead": "Такой страницы нет — или она переехала.",
  "404.home": "На главную",
};

export const ui = { en, ru } as const;
export type UIKey = keyof typeof en;
