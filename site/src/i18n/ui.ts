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

  "theme.toggle": "Toggle color theme",
  "lang.switch": "Switch language",

  // Page titles and meta descriptions — keyword-first, one unique pair per
  // page (see the seo-audit skill's title/description rules).
  "seo.home.title": "Janosik — self-hosted Kanban for AI agents",
  "seo.home.description":
    "Give your AI agents one shared board. They reserve cards, move tasks, add comments and update checklists through the API. Free to self-host under AGPL-3.0.",
  "seo.pricing.title":
    "Pricing — free self-hosted edition, cloud not yet available",
  "seo.pricing.description":
    "Janosik is free to self-host under the AGPL-3.0 license. The managed cloud is not available yet. Run it on your own server.",
  "breadcrumb.home": "Home",

  "home.hero.title": "Kanban for your agent swarm.",
  "home.hero.lead":
    "Connect your AI agents to Janosik. They move cards, add comments and update checklists through the API. Your team sees changes as they happen.",
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
    "One board for your whole team of agents. Board commands use the same reducer as the UI to keep changes consistent. Temporary card reservations help agents coordinate who works on each task.",
  "home.swarm.step1.title": "Give each agent a scoped key",
  "home.swarm.step1.body":
    "Create a personal API token for one board. You can make it read-only and set a request limit. The agent uses this token to access the board.",
  "home.swarm.step2.title": "Agents reserve cards",
  "home.swarm.step2.body":
    "An agent reserves a card for a limited time. Another member cannot reserve it until the reservation is released or expires. If the agent stops working, the card becomes available again when the time runs out.",
  "home.swarm.step3.title": "Agents drive the board",
  "home.swarm.step3.body":
    "Agents move cards and update checklists through the command API, and add comments through the REST API. Each card can also store acceptance criteria and a Definition of Done.",
  "home.swarm.step4.title": "See changes as they happen",
  "home.swarm.step4.body":
    "Open the board to see changes in real time over SSE, or share a read-only link that does not require an account.",
  "home.swarm.point1": "Scoped, rate-limited API tokens, one per agent",
  "home.swarm.point2": "Cards reserved while an agent works",
  "home.swarm.point3":
    "Task details: acceptance criteria and Definition of Done",
  "home.swarm.point4": "Consistent writes, live updates and read-only links",
  "home.swarm.code": "An agent moving a card through the command API",

  "home.features.title": "A board for your team's work",
  "home.features.lead":
    "A shared board for AI agents and the people who work with them.",

  "home.row.board.title": "Move cards and switch between four views",
  "home.row.board.body":
    "Reorder cards and columns with smooth drag and drop. Switch between kanban, calendar, table and watch views; Janosik remembers your choice.",
  "home.row.realtime.title": "Everyone sees changes as they happen",
  "home.row.realtime.body":
    "Shared boards sync over SSE, so edits appear for agents and teammates in real time. See who is online, and undo your changes.",
  "home.row.cards.title": "Everything for a task, in one card",
  "home.row.cards.body":
    "Formatted descriptions, checklists, due dates, labels, covers and comments. Paste files or images directly into a card to attach them.",
  "home.row.sharing.title": "Share boards and keep control of your data",
  "home.row.sharing.body":
    "Invite teammates as admins, members or viewers, or share a read-only link to the board. When you host Janosik yourself, your board data stays on your server.",
  "home.row.watch.title": "Follow the board in real time",
  "home.row.watch.body":
    "Switch to watch view to see who is online, how many cards are in each column, and a live feed showing what changed. Cards and editing controls are hidden.",

  "home.more.title": "More ways to stay organized",
  "home.more.lead": "Tools for keeping work organized and easy to follow.",
  "home.more.wysiwyg": "Rich-text descriptions",
  "home.more.checklists": "Checklists, due dates and covers",
  "home.more.labels": "Labels, WIP limits and card archive",
  "home.more.filter": "Filters and global search",
  "home.more.hotkeys": "Keyboard-first with undo/redo",
  "home.more.views": "Calendar, table and watch views",
  "home.more.offline": "Installable PWA; saving changes requires a connection",
  "home.more.apikeys": "Scoped, rate-limited API keys for agents",
  "home.more.claims": "Temporary card reservations for agents",
  "home.more.contract": "Acceptance criteria & Definition of Done",
  "home.more.attribution":
    "History shows whether a person or agent made each change",
  "home.more.share": "Live read-only share links",
  "home.more.admin": "Admin panel and backups",

  "home.oss.title": "Open source. Self-hosted. Under your control.",
  "home.oss.body":
    "Run Janosik in a single container with your own database. AGPL-3.0 lets you run, modify and audit the source code.",
  "home.oss.point1": "AGPL-3.0 — no lock-in",
  "home.oss.point2": "One Docker image, your database",
  "home.oss.point3": "No telemetry, ever",

  "home.how.title": "Running in minutes",
  "home.how.lead":
    "One container and your own database. No SaaS account required.",
  "home.how.step1.title": "Pull the image",
  "home.how.step1.body":
    "Get Janosik's container image from GitHub Container Registry.",
  "home.how.step2.title": "Point it at a database",
  "home.how.step2.body":
    "Set DATABASE_URL and a JWT secret in the environment.",
  "home.how.step3.title": "Create your account",
  "home.how.step3.body":
    "Open the app, create your account and start planning.",
  "home.how.step4.title": "Invite your team",
  "home.how.step4.body":
    "Add teammates and share boards — or hand out a read-only link.",

  "home.faq.title": "Questions",
  "home.faq.q1": "Is Janosik free?",
  "home.faq.a1":
    "Yes — the self-hosted edition is free and open source under the AGPL-3.0 license. The managed cloud is not available yet; email us if you'd like to hear about it.",
  "home.faq.q2": "Do I need a server?",
  "home.faq.a2":
    "Yes. Janosik runs on a server that you access from your browser. You can host it on your own computer or a dedicated server.",
  "home.faq.q3": "Where is my data stored?",
  "home.faq.a3":
    "Boards are stored in your PostgreSQL database. Attachments and profile photos are stored on your server. There is no telemetry.",
  "home.faq.q4": "Can I use it with my team?",
  "home.faq.a4":
    "Yes. Self-host one instance and invite as many people as you like — there is no per-seat limit on the self-hosted edition.",
  "home.faq.q5": "Can AI agents use Janosik?",
  "home.faq.a5":
    "Yes. Create a personal API token for the board and connect your agent to the API. Agents can move cards, add comments and update checklists. Board commands support undo, and the activity history identifies changes made by a person or an agent.",
  "home.faq.q6": "How do I watch the swarm?",
  "home.faq.a6":
    "Open the board to see changes in real time. To let people view it without an account, create a read-only link to a snapshot or to the live board.",
  "home.faq.q7": "What stops two agents grabbing the same card?",
  "home.faq.a7":
    "An agent reserves a card for a limited time. The server will not let another agent reserve it while that reservation is active. If the agent stops responding, the reservation expires automatically.",
  "home.faq.q8": "Can I limit what an API token can do?",
  "home.faq.a8":
    "Yes. A personal token can be restricted to one board, made read-only and given a separate per-minute request limit.",

  "home.cta.title": "Ready to plan?",
  "home.cta.lead":
    "Run Janosik on your own server. Email us if you'd like to hear about the managed cloud.",

  "home.pricing.title": "Free to self-host, forever",
  "home.pricing.lead":
    "Run Janosik on your own server at no cost. The managed cloud is not available yet.",
  "home.pricing.cta": "See pricing",

  "pricing.title": "Free to run on your own server",
  "pricing.lead":
    "Janosik is open source and free to run on your own server. The managed cloud is not available yet.",
  "pricing.note":
    "The license is free. You pay for your own server and infrastructure.",

  "pricing.badge": "Available now",

  "pricing.compare.title": "Self-hosted vs cloud",
  "pricing.compare.lead":
    "The self-hosted edition includes every feature and is available today. The cloud column describes the planned managed service; it is not available yet.",
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
  "pricing.row.offline":
    "Installable PWA; saving changes requires a connection",
  "pricing.row.filters": "Filters, search & keyboard shortcuts",
  "pricing.row.realtime": "Realtime sync & presence",
  "pricing.row.agents": "Agent claims, task contracts & scoped tokens",
  "pricing.row.members": "Board members",
  "pricing.row.boards": "Boards",
  "pricing.row.storage": "Attachment storage",
  "pricing.row.shares": "Read-only share links",
  "pricing.row.admin": "Admin panel & backups",
  "pricing.row.roles": "Roles & permissions",
  "pricing.row.audit": "Activity history with person or agent labels",
  "pricing.row.hosting": "Who runs it",
  "pricing.row.updates": "Updates & maintenance",
  "pricing.row.support": "Support",

  "pricing.value.unlimited": "Unlimited",
  "pricing.value.yourDisk": "Your disk",
  "pricing.value.managed": "Cloud storage",
  "pricing.value.you": "You",
  "pricing.value.us": "We do",
  "pricing.value.auto": "Automatic",
  "pricing.value.community": "Community",
  "pricing.value.priority": "Priority",

  "pricing.limit.boards": "Boards",
  "pricing.limit.members": "Members",
  "pricing.limit.storage": "Storage",

  "pricing.selfhost.name": "Self-hosted",
  "pricing.selfhost.for": "For teams hosting Janosik on their own servers",
  "pricing.selfhost.period": "forever",
  "pricing.selfhost.cta": "Self-host now",
  "pricing.selfhost.f1": "Every feature included",
  "pricing.selfhost.f2": "Your database, your data",
  "pricing.selfhost.f3": "AGPL-3.0 — fork & audit",

  "pricing.cloud.name": "Cloud",
  "pricing.cloud.for": "Managed hosting",
  "pricing.cloud.price": "Not available yet",
  "pricing.cloud.period": "Contact us about the launch",
  "pricing.cloud.cta": "Email us about the launch",
  "pricing.cloud.f1": "We run it, update it and back it up",
  "pricing.cloud.f2": "Realtime sync & presence",
  "pricing.cloud.f3": "Email support",

  "pricing.faq.title": "Pricing questions",
  "pricing.faq.q1": "Is the self-hosted edition really free?",
  "pricing.faq.a1":
    "Yes. It is free and open source under the AGPL-3.0 license, with every feature and no seat limit. You only pay for the infrastructure you run it on.",
  "pricing.faq.q2": "Is the managed cloud available?",
  "pricing.faq.a2":
    "Not yet. Email us if you would like to hear about the managed cloud.",
  "pricing.faq.q3": "Will the cloud be priced per user?",
  "pricing.faq.a3":
    "We have not set the pricing yet. The self-hosted edition will remain free with no per-user fee.",
  "pricing.faq.q4": "Can I export my data or move it to another server?",
  "pricing.faq.a4":
    "Yes. Export your boards and import them into another Janosik instance. To move a whole installation, back up the database and uploaded files and restore them on the new server.",

  "pricing.cta.title": "Run Janosik on your own server",
  "pricing.cta.lead":
    "Host Janosik on your own server today. Email us if you would like to hear about the managed cloud.",
  "pricing.waitlist.subject": "Janosik managed cloud",

  "footer.tagline": "A self-hosted Kanban board for AI agents and their teams.",
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

  "seo.home.title": "Janosik — канбан для ИИ-агентов на вашем сервере",
  "seo.home.description":
    "Общая доска для команды ИИ-агентов. Они резервируют карточки, перемещают задачи, добавляют комментарии и обновляют чек-листы через API. Бесплатно на своём сервере по лицензии AGPL-3.0.",
  "seo.pricing.title": "Тарифы Janosik — бесплатная версия для своего сервера",
  "seo.pricing.description":
    "Janosik можно бесплатно разместить на своём сервере по лицензии AGPL-3.0. Облачная версия пока недоступна.",
  "breadcrumb.home": "Главная",

  "home.hero.title": "Канбан для вашего роя агентов.",
  "home.hero.lead":
    "Подключите ИИ-агентов к Janosik. Они перемещают карточки, оставляют комментарии и обновляют чек-листы через API. Ваша команда видит изменения в реальном времени.",
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
    "Одна доска для всей команды агентов. Команды доски обрабатываются тем же редьюсером, что и действия в интерфейсе. Временное резервирование помогает агентам распределять задачи.",
  "home.swarm.step1.title": "Выдайте каждому агенту свой ключ",
  "home.swarm.step1.body":
    "Создайте для агента персональный API-токен с доступом к одной доске. При необходимости запретите запись и задайте лимит запросов. Агент подключается с этим токеном.",
  "home.swarm.step2.title": "Агенты резервируют карточки",
  "home.swarm.step2.body":
    "Агент резервирует карточку на ограниченное время. Другой участник сможет зарезервировать её после освобождения или истечения срока. Если агент прекратит работу, карточка снова станет доступной, когда срок закончится.",
  "home.swarm.step3.title": "Агенты ведут доску",
  "home.swarm.step3.body":
    "Агенты перемещают карточки и обновляют чек-листы через API команд, а комментарии добавляют через REST API. В карточке также можно задать критерии приёмки и условия завершения задачи (Definition of Done).",
  "home.swarm.step4.title": "Вы наблюдаете",
  "home.swarm.step4.body":
    "Откройте доску, чтобы видеть изменения в реальном времени по SSE. Или поделитесь ссылкой только для чтения — для просмотра аккаунт не нужен.",
  "home.swarm.point1":
    "API-токены с доступом к выбранной доске и лимитом запросов",
  "home.swarm.point2": "Временное резервирование карточек агентами",
  "home.swarm.point3": "Критерии приёмки и условия завершения задач",
  "home.swarm.point4":
    "Согласованные изменения, обновления в реальном времени и ссылки для чтения",
  "home.swarm.code": "Агент перемещает карточку через API команд",

  "home.features.title": "Всё, что должна уметь доска",
  "home.features.lead":
    "Общая доска для ИИ-агентов и людей, которые с ними работают.",

  "home.row.board.title":
    "Перемещайте карточки и выбирайте удобный режим просмотра",
  "home.row.board.body":
    "Перемещайте карточки и колонки перетаскиванием. Переключайтесь между канбаном, календарём, таблицей и режимом наблюдения — Janosik запомнит ваш выбор.",
  "home.row.realtime.title": "Изменения сразу видны всей команде",
  "home.row.realtime.body":
    "Общие доски синхронизируются по SSE: агенты и участники видят изменения в реальном времени. Статус участников показывает, кто сейчас на доске. Свои изменения можно отменить.",
  "home.row.cards.title": "Всё по задаче — в одной карточке",
  "home.row.cards.body":
    "Форматируемые описания, чек-листы, сроки, метки, обложки и комментарии. Файлы и изображения можно добавлять из буфера обмена.",
  "home.row.sharing.title": "Делитесь досками, сохраняя контроль над данными",
  "home.row.sharing.body":
    "Приглашайте администраторов, участников и наблюдателей или делитесь ссылкой только для чтения. При размещении на своём сервере данные хранятся у вас.",
  "home.row.watch.title": "Следите за доской в реальном времени",
  "home.row.watch.body":
    "В режиме наблюдения видны участники на доске, число карточек в каждой колонке и лента изменений с тем, что было и что стало. Карточки и элементы управления скрыты.",

  "home.more.title": "Другие возможности",
  "home.more.lead": "Инструменты для организации задач и работы с доской.",
  "home.more.wysiwyg": "Описания с форматированием",
  "home.more.checklists": "Чек-листы, сроки и обложки",
  "home.more.labels": "Метки, WIP-лимиты и архив карточек",
  "home.more.filter": "Фильтры и глобальный поиск",
  "home.more.hotkeys": "Управление с клавиатуры, отмена и повтор действий",
  "home.more.views": "Календарь, таблица и режим наблюдения",
  "home.more.offline": "Установка как приложение; для сохранения нужна сеть",
  "home.more.apikeys": "API-ключи с доступом к одной доске и лимитом запросов",
  "home.more.claims": "Временное резервирование карточек агентами",
  "home.more.contract": "Критерии приёмки и условия завершения задач",
  "home.more.attribution":
    "В истории видно, кто внёс изменение: человек или агент",
  "home.more.share":
    "Ссылки только для чтения: на снимок или текущую версию доски",
  "home.more.admin": "Админ-панель и резервные копии",

  "home.oss.title": "Открытый исходный код и ваши данные",
  "home.oss.body":
    "Запустите контейнер Janosik и подключите свою базу данных. Лицензия AGPL-3.0 позволяет использовать, изменять и проверять исходный код.",
  "home.oss.point1": "Лицензия AGPL-3.0 — без привязки к вендору",
  "home.oss.point2": "Один Docker-образ, ваша база",
  "home.oss.point3": "Никакой телеметрии",

  "home.how.title": "Запуск за минуты",
  "home.how.lead":
    "Один контейнер и ваша база данных. Аккаунт в облачном сервисе не нужен.",
  "home.how.step1.title": "Скачайте образ",
  "home.how.step1.body":
    "Загрузите образ Janosik из GitHub Container Registry.",
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
    "Да. Версию Janosik для своего сервера можно бесплатно использовать по лицензии AGPL-3.0. Облачная версия пока недоступна.",
  "home.faq.q2": "Нужен ли сервер?",
  "home.faq.a2":
    "Да. Janosik работает на сервере, к которому вы подключаетесь из браузера. Его можно разместить на своём компьютере или отдельном сервере.",
  "home.faq.q3": "Где хранятся мои данные?",
  "home.faq.a3":
    "Доски хранятся в вашей базе PostgreSQL, а вложения и фотографии профиля — в хранилище сервера. Телеметрия не используется.",
  "home.faq.q4": "Можно пользоваться вместе с командой?",
  "home.faq.a4":
    "Да. Установите Janosik на своём сервере и приглашайте команду: в этой версии нет ограничения по числу участников.",
  "home.faq.q5": "Могут ли ИИ-агенты пользоваться Janosik?",
  "home.faq.a5":
    "Да. Создайте персональный API-токен для доски и подключите агента к API. Он сможет перемещать карточки, оставлять комментарии и обновлять чек-листы. Команды доски поддерживают отмену; в истории активности видно, какие изменения внесены человеком, а какие — агентом.",
  "home.faq.q6": "Как наблюдать за роем?",
  "home.faq.a6":
    "Откройте доску, чтобы видеть изменения в реальном времени. Для просмотра без аккаунта создайте ссылку только для чтения: она покажет снимок доски или будет отображать новые изменения.",
  "home.faq.q7": "Что мешает двум агентам взять одну карточку?",
  "home.faq.a7":
    "Временное резервирование. Пока карточка закреплена за одним агентом, сервер не даст другому зарезервировать её. Если агент перестанет отвечать, резервирование истечёт автоматически.",
  "home.faq.q8": "Можно ли ограничить, что может делать API-токен?",
  "home.faq.a8":
    "Да. Для токена можно выбрать одну доску, запретить операции записи и установить отдельный лимит запросов в минуту.",

  "home.cta.title": "Готовы начать?",
  "home.cta.lead":
    "Запустите Janosik на своём сервере. Если вам нужна облачная версия, напишите нам.",

  "home.pricing.title": "Janosik бесплатно на своём сервере",
  "home.pricing.lead":
    "Разместите Janosik на своём сервере бесплатно. Облачная версия пока недоступна.",
  "home.pricing.cta": "Смотреть тарифы",

  "pricing.title": "Janosik бесплатно на своём сервере",
  "pricing.lead":
    "Janosik можно бесплатно запустить на своём сервере по лицензии AGPL-3.0. Облачная версия пока недоступна.",
  "pricing.note":
    "Лицензия бесплатна. Сервер и инфраструктуру вы оплачиваете самостоятельно.",

  "pricing.badge": "Доступно сейчас",

  "pricing.compare.title": "Свой сервер или облачная версия",
  "pricing.compare.lead":
    "Версия для своего сервера включает все возможности и доступна уже сейчас. В колонке облачной версии описан планируемый сервис — он пока недоступен.",
  "pricing.compare.aria": "Сравнение тарифов",
  "pricing.compare.feature": "Возможность",
  "pricing.compare.yes": "Есть",
  "pricing.compare.no": "Нет",

  "pricing.cat.board": "Доска",
  "pricing.cat.collab": "Совместная работа",
  "pricing.cat.admin": "Администрирование и безопасность",
  "pricing.cat.support": "Хостинг и поддержка",

  "pricing.row.views": "Канбан, календарь, таблица и режим наблюдения",
  "pricing.row.cards": "Перетаскивание карточек, метки и обложки",
  "pricing.row.offline": "Установка как приложение; для сохранения нужна сеть",
  "pricing.row.filters": "Фильтры, поиск и горячие клавиши",
  "pricing.row.realtime":
    "Синхронизация и статусы участников в реальном времени",
  "pricing.row.agents":
    "Резервирование карточек, критерии задач и токены с ограниченным доступом",
  "pricing.row.members": "Участники доски",
  "pricing.row.boards": "Количество досок",
  "pricing.row.storage": "Хранилище вложений",
  "pricing.row.shares": "Ссылки только для чтения",
  "pricing.row.admin": "Админ-панель и резервные копии",
  "pricing.row.roles": "Роли и права",
  "pricing.row.audit": "История действий с указанием автора: человек или агент",
  "pricing.row.hosting": "Кто размещает приложение",
  "pricing.row.updates": "Обновления и обслуживание",
  "pricing.row.support": "Поддержка",

  "pricing.value.unlimited": "Без ограничений",
  "pricing.value.yourDisk": "На вашем сервере",
  "pricing.value.managed": "Облачное хранилище",
  "pricing.value.you": "Вы",
  "pricing.value.us": "Мы",
  "pricing.value.auto": "Автоматически",
  "pricing.value.community": "Сообщество",
  "pricing.value.priority": "Приоритетная",

  "pricing.limit.boards": "Доски",
  "pricing.limit.members": "Участники",
  "pricing.limit.storage": "Хранилище",

  "pricing.selfhost.name": "На своём сервере",
  "pricing.selfhost.for":
    "Для команд, которые размещают Janosik самостоятельно",
  "pricing.selfhost.period": "навсегда",
  "pricing.selfhost.cta": "Развернуть",
  "pricing.selfhost.f1": "Все возможности включены",
  "pricing.selfhost.f2": "Ваша база, ваши данные",
  "pricing.selfhost.f3":
    "AGPL-3.0: используйте, изменяйте и проверяйте исходный код",

  "pricing.cloud.name": "Облако",
  "pricing.cloud.for": "Хостинг и обслуживание приложения",
  "pricing.cloud.price": "Пока недоступно",
  "pricing.cloud.period": "Напишите нам о запуске",
  "pricing.cloud.cta": "Написать нам",
  "pricing.cloud.f1":
    "Мы размещаем и обновляем Janosik, создаём резервные копии данных",
  "pricing.cloud.f2": "Синхронизация и статусы участников в реальном времени",
  "pricing.cloud.f3": "Поддержка по электронной почте",

  "pricing.faq.title": "Вопросы о тарифах",
  "pricing.faq.q1": "Версия для своего сервера действительно бесплатна?",
  "pricing.faq.a1":
    "Да. Она распространяется по лицензии AGPL-3.0, включает все возможности и не ограничивает число участников. Вы оплачиваете только сервер и другую инфраструктуру, на которой её запускаете.",
  "pricing.faq.q2": "Доступна ли облачная версия?",
  "pricing.faq.a2": "Пока нет. Напишите нам, если вам нужна облачная версия.",
  "pricing.faq.q3":
    "Будет ли оплата облачной версии зависеть от числа участников?",
  "pricing.faq.a3":
    "Цена облачной версии ещё не определена. Версия для своего сервера останется бесплатной и без платы за каждого участника.",
  "pricing.faq.q4":
    "Можно ли экспортировать данные и перенести их на другой сервер?",
  "pricing.faq.a4":
    "Да. Экспортируйте доски и импортируйте их в другой экземпляр Janosik. Для переноса всей установки сохраните базу данных и загруженные файлы, затем восстановите их на новом сервере.",

  "pricing.cta.title": "Запустите Janosik на своём сервере",
  "pricing.cta.lead":
    "Разместите Janosik на своём сервере. Если вам нужен облачный вариант, напишите нам.",
  "pricing.waitlist.subject": "Облачная версия Janosik",

  "footer.tagline": "Канбан на своём сервере для ИИ-агентов и их команд.",
  "footer.product": "Продукт",
  "footer.resources": "Ресурсы",
  "footer.legal": "Правовая информация",
  "footer.docs": "Документация",
  "footer.selfhost": "Руководство по установке на свой сервер",
  "footer.changelog": "Список изменений",
  "footer.security": "Безопасность",
  "footer.license": "Лицензия",
  "footer.rights": "участники Janosik",

  "404.title": "Страница не найдена",
  "404.lead": "Такой страницы нет — или она переехала.",
  "404.home": "На главную",
};

export const ui = { en, ru } as const;
export type UIKey = keyof typeof en;
