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
  "cta.primary": "Get started",
  "cta.secondary": "View on GitHub",

  "theme.toggle": "Toggle colour theme",
  "lang.switch": "Switch language",

  "home.hero.title": "Kanban that feels crafted.",
  "home.hero.lead":
    "Janosik is a fast, self-hosted board — Trello-class drag & drop, calendar and table views, realtime sync and obsessive micro-detail. Run it yourself, or let us host it.",
  "home.hero.note":
    "Free and open source (AGPL-3.0). No lock-in — your data stays yours.",

  "home.slot.board": "The Janosik board: columns of draggable cards",
  "home.slot.realtime": "Two teammates editing the same board at once",
  "home.slot.cards": "A card with a checklist, labels and an attachment",
  "home.slot.sharing": "Sharing a board with a read-only link",
  "home.slot.selfhost": "Self-hosting Janosik with Docker Compose",

  "home.features.title": "Everything a board should do",
  "home.features.lead":
    "Built for teams who want a board that gets out of the way.",

  "home.row.board.title": "Drag, drop, and see it three ways",
  "home.row.board.body":
    "Reorder cards and columns with buttery drag & drop, then switch the same board between kanban, calendar and table — your choice is remembered.",
  "home.row.realtime.title": "Realtime, together",
  "home.row.realtime.body":
    "Shared boards sync over SSE, so every edit lands instantly for everyone. Presence shows who is here, and undo stays yours.",
  "home.row.cards.title": "Cards that carry the work",
  "home.row.cards.body":
    "WYSIWYG descriptions, checklists, due dates, labels, covers, comments and paste-to-upload attachments — everything in one card.",
  "home.row.sharing.title": "Share without the lock-in",
  "home.row.sharing.body":
    "Invite teammates as admin, member or viewer, or hand out a read-only link. Self-hosted, so the data never leaves your server.",

  "home.more.title": "And the details",
  "home.more.lead": "The small things that make a board pleasant to live in.",
  "home.more.wysiwyg": "WYSIWYG card descriptions",
  "home.more.checklists": "Checklists, due dates and covers",
  "home.more.labels": "Labels, WIP limits and card archive",
  "home.more.filter": "Filters and global search",
  "home.more.hotkeys": "Keyboard-first with undo/redo",
  "home.more.views": "Calendar and table views",
  "home.more.offline": "Offline-first, installable PWA",
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
    "Ship the self-host image from GitHub Container Registry.",
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
    "Yes — the self-hosted edition is free and open source under the AGPL-3.0 license. A hosted plan is available if you'd rather not run a server.",
  "home.faq.q2": "Do I need a server?",
  "home.faq.a2":
    "No. Janosik also runs fully local-first in your browser; a server adds accounts, shared boards and realtime sync.",
  "home.faq.q3": "Where is my data stored?",
  "home.faq.a3":
    "In your own database when self-hosting, or in your browser's storage in local-first mode. There is no telemetry.",
  "home.faq.q4": "Can I use it with my team?",
  "home.faq.a4":
    "Yes. Self-host one instance and invite as many people as you like — there is no per-seat limit on the self-hosted edition.",

  "home.cta.title": "Ready to plan?",
  "home.cta.lead": "Start with the hosted plan or self-host in minutes.",

  "home.pricing.title": "Free to self-host, forever",
  "home.pricing.lead":
    "Run Janosik on your own server at no cost — or let us host it, starting free.",
  "home.pricing.cta": "See pricing",

  "pricing.title": "Simple, honest pricing",
  "pricing.lead":
    "Free to self-host, forever. Pay only if you'd rather we run it — and start free either way.",
  "pricing.note":
    "Hosted plans are launching soon. Prices shown are indicative and may change before launch — join the waitlist to lock in early-access pricing.",

  "pricing.billing.aria": "Billing period",
  "pricing.billing.monthly": "Monthly",
  "pricing.billing.annual": "Annual",
  "pricing.billing.save": "2 months free",

  "pricing.compare.title": "Compare plans",
  "pricing.compare.lead":
    "The board is the same everywhere — the limits, controls and support differ.",
  "pricing.compare.aria": "Plan comparison",
  "pricing.compare.feature": "Feature",
  "pricing.compare.yes": "Included",
  "pricing.compare.no": "Not included",

  "pricing.cat.board": "The board",
  "pricing.cat.collab": "Collaboration",
  "pricing.cat.admin": "Admin & security",
  "pricing.cat.support": "Hosting & support",

  "pricing.row.views": "Kanban, calendar & table views",
  "pricing.row.cards": "Drag & drop, rich cards, labels & covers",
  "pricing.row.offline": "Offline-first, installable PWA",
  "pricing.row.filters": "Filters, search & keyboard shortcuts",
  "pricing.row.realtime": "Realtime sync & presence",
  "pricing.row.members": "Members per workspace",
  "pricing.row.boards": "Boards",
  "pricing.row.storage": "Attachment storage",
  "pricing.row.shares": "Read-only share links",
  "pricing.row.admin": "Admin panel & backups",
  "pricing.row.roles": "Roles & permissions",
  "pricing.row.audit": "Audit log",
  "pricing.row.sso": "Single sign-on (SSO)",
  "pricing.row.onprem": "Self-hosted / air-gapped",
  "pricing.row.hosting": "Who runs it",
  "pricing.row.updates": "Updates & maintenance",
  "pricing.row.support": "Support",
  "pricing.row.sla": "Uptime SLA",

  "pricing.value.unlimited": "Unlimited",
  "pricing.value.yourDisk": "Your disk",
  "pricing.value.custom": "Custom",
  "pricing.value.you": "You",
  "pricing.value.us": "We do",
  "pricing.value.youOrUs": "You or us",
  "pricing.value.auto": "Automatic",
  "pricing.value.managed": "Managed",
  "pricing.value.community": "Community",
  "pricing.value.email": "Email",
  "pricing.value.priority": "Priority",
  "pricing.value.dedicated": "Dedicated + SLA",
  "pricing.value.storage.free": "100 MB",
  "pricing.value.storage.pro": "10 GB / user",
  "pricing.value.storage.team": "100 GB",

  "pricing.limit.boards": "Boards",
  "pricing.limit.members": "Members",
  "pricing.limit.storage": "Storage",

  "pricing.selfhost.name": "Self-hosted",
  "pricing.selfhost.for": "For teams that run it themselves",
  "pricing.selfhost.periodM": "forever",
  "pricing.selfhost.periodY": "forever",
  "pricing.selfhost.cta": "Self-host now",
  "pricing.selfhost.f1": "Every feature included",
  "pricing.selfhost.f2": "Your database, your data",
  "pricing.selfhost.f3": "AGPL-3.0 — fork & audit",

  "pricing.free.name": "Hosted Free",
  "pricing.free.for": "For trying Janosik with a small team",
  "pricing.free.periodM": "forever",
  "pricing.free.periodY": "forever",
  "pricing.free.cta": "Join the waitlist",
  "pricing.free.f1": "Realtime sync & presence",
  "pricing.free.f2": "Offline-first, installable PWA",
  "pricing.free.f3": "Community support",

  "pricing.pro.name": "Pro",
  "pricing.pro.badge": "Most popular",
  "pricing.pro.for": "For growing teams that plan every day",
  "pricing.pro.periodM": "per user / month",
  "pricing.pro.periodY": "per user / year",
  "pricing.pro.cta": "Join the waitlist",
  "pricing.pro.f1": "Everything in Hosted Free",
  "pricing.pro.f2": "Realtime sync & presence",
  "pricing.pro.f3": "Email support",

  "pricing.team.name": "Team",
  "pricing.team.for": "For teams that need controls and support",
  "pricing.team.periodM": "per user / month",
  "pricing.team.periodY": "per user / year",
  "pricing.team.cta": "Join the waitlist",
  "pricing.team.f1": "Everything in Pro",
  "pricing.team.f2": "SSO & audit log",
  "pricing.team.f3": "Priority support",

  "pricing.enterprise.name": "Enterprise",
  "pricing.enterprise.title": "Running at scale?",
  "pricing.enterprise.body":
    "Deploy on your own terms — on-prem, air-gapped or fully managed — with SAML SSO, an audit trail, an uptime SLA and a named engineer.",
  "pricing.enterprise.periodM": "Let's talk",
  "pricing.enterprise.periodY": "Let's talk",
  "pricing.enterprise.cta": "Contact us",
  "pricing.enterprise.point1": "On-prem or air-gapped deployment",
  "pricing.enterprise.point2": "SAML SSO, audit log & data residency",
  "pricing.enterprise.point3": "Uptime SLA and a dedicated support engineer",

  "pricing.faq.title": "Pricing questions",
  "pricing.faq.q1": "Is the self-hosted edition really free?",
  "pricing.faq.a1":
    "Yes. It is free and open source under the AGPL-3.0 license, with every feature and no seat limit. You only pay for the infrastructure you run it on.",
  "pricing.faq.q2": "What is the difference between self-hosted and hosted?",
  "pricing.faq.a2":
    "It is the same board. Self-hosted runs on your server with your database; hosted runs on ours, so there is nothing for you to install, update or back up.",
  "pricing.faq.q3": "How does per-user pricing work?",
  "pricing.faq.a3":
    "Paid hosted plans are billed per active member, monthly or annually. Read-only viewers and share links are free, and you can add or remove members at any time.",
  "pricing.faq.q4": "Is there a free trial?",
  "pricing.faq.a4":
    "The hosted Free plan is the trial — no credit card, no time limit. Upgrade to Pro or Team only when you outgrow its limits.",
  "pricing.faq.q5": "Can I change or cancel my plan?",
  "pricing.faq.a5":
    "Yes, at any time. Downgrades and cancellations take effect at the end of the billing period, and you can export all of your data first.",
  "pricing.faq.q6": "Do you offer discounts?",
  "pricing.faq.a6":
    "Yes — for non-profits, education and open-source projects. Get in touch and we will sort something out.",
  "pricing.faq.q7": "What happens to my data if I leave?",
  "pricing.faq.a7":
    "It stays yours. Export every board, or move to the self-hosted edition and keep running on your own server. There is no lock-in.",

  "pricing.cta.title": "Start free today",
  "pricing.cta.lead":
    "Self-host in minutes, or join the hosted waitlist — either way you start at no cost.",
  "pricing.waitlist.subject": "Janosik hosted waitlist",
  "pricing.contact.subject": "Janosik Enterprise",

  "footer.tagline": "A self-hosted, offline-first Kanban board.",
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
  "cta.primary": "Начать",
  "cta.secondary": "Открыть на GitHub",

  "theme.toggle": "Переключить тему",
  "lang.switch": "Сменить язык",

  "home.hero.title": "Канбан, сделанный с любовью к деталям.",
  "home.hero.lead":
    "Janosik — быстрый self-hosted канбан: drag & drop уровня Trello, виды календаря и таблицы, realtime-синхронизация и внимание к микро-деталям. Разверните у себя или доверьте хостинг нам.",
  "home.hero.note":
    "Бесплатно и с открытым исходным кодом (AGPL-3.0). Без вендор-лока — данные ваши.",

  "home.slot.board": "Доска Janosik: колонки с перетаскиваемыми карточками",
  "home.slot.realtime": "Два человека одновременно правят одну доску",
  "home.slot.cards": "Карточка с чек-листом, метками и вложением",
  "home.slot.sharing": "Доступ к доске по ссылке только для чтения",
  "home.slot.selfhost": "Self-hosting Janosik через Docker Compose",

  "home.features.title": "Всё, что должна уметь доска",
  "home.features.lead":
    "Для команд, которым нужна доска, не мешающая работать.",

  "home.row.board.title": "Перетаскивайте и смотрите тремя способами",
  "home.row.board.body":
    "Переставляйте карточки и колонки плавным drag & drop, а одну и ту же доску переключайте между канбаном, календарём и таблицей — выбор запоминается.",
  "home.row.realtime.title": "Realtime — вместе",
  "home.row.realtime.body":
    "Общие доски синхронизируются по SSE: правки прилетают всем мгновенно. Presence показывает, кто на месте, а undo остаётся вашим.",
  "home.row.cards.title": "Карточки, которые несут работу",
  "home.row.cards.body":
    "WYSIWYG-описания, чек-листы, сроки, метки, обложки, комментарии и вложения из буфера — всё в одной карточке.",
  "home.row.sharing.title": "Делитесь без вендор-лока",
  "home.row.sharing.body":
    "Приглашайте участников как админа, участника или наблюдателя, либо выдавайте ссылку только для чтения. Self-hosted — данные не покидают ваш сервер.",

  "home.more.title": "И детали",
  "home.more.lead": "Мелочи, из которых складывается приятная доска.",
  "home.more.wysiwyg": "WYSIWYG-описания карточек",
  "home.more.checklists": "Чек-листы, сроки и обложки",
  "home.more.labels": "Метки, WIP-лимиты и архив карточек",
  "home.more.filter": "Фильтры и глобальный поиск",
  "home.more.hotkeys": "Клавиатура и undo/redo",
  "home.more.views": "Виды календаря и таблицы",
  "home.more.offline": "Offline-first PWA с установкой",
  "home.more.admin": "Админ-панель и бэкапы",

  "home.oss.title": "Открытый код, self-hosted, ваш",
  "home.oss.body":
    "Janosik — один контейнер под лицензией AGPL-3.0. Подключите свою базу — и им можно управлять, форкать и проверять.",
  "home.oss.point1": "Лицензия AGPL-3.0 — без вендор-лока",
  "home.oss.point2": "Один Docker-образ, ваша база",
  "home.oss.point3": "Никакой телеметрии",

  "home.how.title": "Запуск за минуты",
  "home.how.lead": "Один контейнер и ваша база данных. Аккаунт SaaS не нужен.",
  "home.how.step1.title": "Скачайте образ",
  "home.how.step1.body":
    "Возьмите self-host образ из GitHub Container Registry.",
  "home.how.step2.title": "Подключите базу",
  "home.how.step2.body":
    "Задайте DATABASE_URL и секрет JWT в переменных окружения.",
  "home.how.step3.title": "Создайте аккаунт",
  "home.how.step3.body":
    "Откройте приложение, зарегистрируйте первого пользователя и планируйте.",
  "home.how.step4.title": "Пригласите команду",
  "home.how.step4.body":
    "Добавьте коллег и откройте им доски — или выдайте ссылку только для чтения.",

  "home.faq.title": "Вопросы",
  "home.faq.q1": "Janosik бесплатный?",
  "home.faq.a1":
    "Да — self-hosted версия бесплатна и открыта по лицензии AGPL-3.0. Если не хотите держать сервер, есть хостинг-план.",
  "home.faq.q2": "Нужен ли сервер?",
  "home.faq.a2":
    "Нет. Janosik работает и полностью локально в браузере; сервер добавляет аккаунты, общие доски и realtime-синхронизацию.",
  "home.faq.q3": "Где хранятся мои данные?",
  "home.faq.a3":
    "В вашей базе данных при self-hosting или в хранилище браузера в локальном режиме. Телеметрии нет.",
  "home.faq.q4": "Можно использовать с командой?",
  "home.faq.a4":
    "Да. Разверните один инстанс и приглашайте сколько угодно людей — на self-hosted версии нет лимита по числу участников.",

  "home.cta.title": "Готовы планировать?",
  "home.cta.lead": "Начните с хостинг-плана или разверните у себя за минуты.",

  "home.pricing.title": "Self-hosting бесплатен навсегда",
  "home.pricing.lead":
    "Разверните Janosik на своём сервере бесплатно — или доверьте хостинг нам, начав с бесплатного плана.",
  "home.pricing.cta": "Смотреть тарифы",

  "pricing.title": "Простые и честные тарифы",
  "pricing.lead":
    "Self-hosting бесплатен навсегда. Платите только за наш хостинг — и начните бесплатно в любом случае.",
  "pricing.note":
    "Хостинг-планы скоро запустятся. Указанные цены ориентировочные и могут измениться до запуска — запишитесь в лист ожидания, чтобы зафиксировать цены раннего доступа.",

  "pricing.billing.aria": "Период оплаты",
  "pricing.billing.monthly": "Ежемесячно",
  "pricing.billing.annual": "Ежегодно",
  "pricing.billing.save": "2 месяца в подарок",

  "pricing.compare.title": "Сравнение планов",
  "pricing.compare.lead":
    "Доска везде одинаковая — различаются лимиты, управление и поддержка.",
  "pricing.compare.aria": "Сравнение тарифов",
  "pricing.compare.feature": "Возможность",
  "pricing.compare.yes": "Есть",
  "pricing.compare.no": "Нет",

  "pricing.cat.board": "Доска",
  "pricing.cat.collab": "Совместная работа",
  "pricing.cat.admin": "Администрирование и безопасность",
  "pricing.cat.support": "Хостинг и поддержка",

  "pricing.row.views": "Виды: канбан, календарь и таблица",
  "pricing.row.cards": "Drag & drop, карточки, метки и обложки",
  "pricing.row.offline": "Offline-first PWA с установкой",
  "pricing.row.filters": "Фильтры, поиск и горячие клавиши",
  "pricing.row.realtime": "Realtime-синхронизация и presence",
  "pricing.row.members": "Участников на воркспейс",
  "pricing.row.boards": "Досок",
  "pricing.row.storage": "Хранилище вложений",
  "pricing.row.shares": "Ссылки только для чтения",
  "pricing.row.admin": "Админ-панель и бэкапы",
  "pricing.row.roles": "Роли и права",
  "pricing.row.audit": "Журнал аудита",
  "pricing.row.sso": "Единый вход (SSO)",
  "pricing.row.onprem": "Self-hosted / air-gapped",
  "pricing.row.hosting": "Кто держит сервер",
  "pricing.row.updates": "Обновления и обслуживание",
  "pricing.row.support": "Поддержка",
  "pricing.row.sla": "SLA по доступности",

  "pricing.value.unlimited": "Без лимита",
  "pricing.value.yourDisk": "Ваш диск",
  "pricing.value.custom": "По запросу",
  "pricing.value.you": "Вы",
  "pricing.value.us": "Мы",
  "pricing.value.youOrUs": "Вы или мы",
  "pricing.value.auto": "Автоматически",
  "pricing.value.managed": "Под управлением",
  "pricing.value.community": "Сообщество",
  "pricing.value.email": "Почта",
  "pricing.value.priority": "Приоритетная",
  "pricing.value.dedicated": "Выделенная + SLA",
  "pricing.value.storage.free": "100 МБ",
  "pricing.value.storage.pro": "10 ГБ / участника",
  "pricing.value.storage.team": "100 ГБ",

  "pricing.limit.boards": "Доски",
  "pricing.limit.members": "Участники",
  "pricing.limit.storage": "Хранилище",

  "pricing.selfhost.name": "Self-hosted",
  "pricing.selfhost.for": "Для команд, которые держат сервер сами",
  "pricing.selfhost.periodM": "навсегда",
  "pricing.selfhost.periodY": "навсегда",
  "pricing.selfhost.cta": "Развернуть",
  "pricing.selfhost.f1": "Все возможности включены",
  "pricing.selfhost.f2": "Ваша база, ваши данные",
  "pricing.selfhost.f3": "Лицензия AGPL-3.0 — форкайте и проверяйте",

  "pricing.free.name": "Hosted Free",
  "pricing.free.for": "Чтобы попробовать Janosik небольшой командой",
  "pricing.free.periodM": "навсегда",
  "pricing.free.periodY": "навсегда",
  "pricing.free.cta": "В лист ожидания",
  "pricing.free.f1": "Realtime-синхронизация и presence",
  "pricing.free.f2": "Offline-first PWA с установкой",
  "pricing.free.f3": "Поддержка сообщества",

  "pricing.pro.name": "Pro",
  "pricing.pro.badge": "Популярный",
  "pricing.pro.for": "Для растущих команд, планирующих каждый день",
  "pricing.pro.periodM": "за участника / мес",
  "pricing.pro.periodY": "за участника / год",
  "pricing.pro.cta": "В лист ожидания",
  "pricing.pro.f1": "Всё из Hosted Free",
  "pricing.pro.f2": "Realtime-синхронизация и presence",
  "pricing.pro.f3": "Поддержка по почте",

  "pricing.team.name": "Team",
  "pricing.team.for": "Для команд, которым нужны контроль и поддержка",
  "pricing.team.periodM": "за участника / мес",
  "pricing.team.periodY": "за участника / год",
  "pricing.team.cta": "В лист ожидания",
  "pricing.team.f1": "Всё из Pro",
  "pricing.team.f2": "SSO и журнал аудита",
  "pricing.team.f3": "Приоритетная поддержка",

  "pricing.enterprise.name": "Enterprise",
  "pricing.enterprise.title": "Масштаб крупной компании?",
  "pricing.enterprise.body":
    "Разворачивайте на своих условиях — on-prem, air-gapped или под нашим управлением — с SAML SSO, журналом аудита, SLA по доступности и выделенным инженером.",
  "pricing.enterprise.periodM": "Обсудим",
  "pricing.enterprise.periodY": "Обсудим",
  "pricing.enterprise.cta": "Связаться",
  "pricing.enterprise.point1": "Развёртывание on-prem или air-gapped",
  "pricing.enterprise.point2": "SAML SSO, журнал аудита и хранение данных",
  "pricing.enterprise.point3": "SLA по доступности и выделенный инженер",

  "pricing.faq.title": "Вопросы о тарифах",
  "pricing.faq.q1": "Self-hosted версия правда бесплатна?",
  "pricing.faq.a1":
    "Да. Она бесплатна и открыта по лицензии AGPL-3.0, со всеми возможностями и без лимита мест. Вы платите только за инфраструктуру, на которой её запускаете.",
  "pricing.faq.q2": "Чем отличается self-hosted от hosted?",
  "pricing.faq.a2":
    "Доска одна и та же. Self-hosted работает на вашем сервере с вашей базой; hosted — на нашем, так что вам не нужно ничего ставить, обновлять и бэкапить.",
  "pricing.faq.q3": "Как работает оплата за участника?",
  "pricing.faq.a3":
    "Платные хостинг-планы оплачиваются за активного участника — ежемесячно или ежегодно. Наблюдатели и ссылки только для чтения бесплатны, а участников можно добавлять и убирать в любой момент.",
  "pricing.faq.q4": "Есть бесплатный пробный период?",
  "pricing.faq.a4":
    "Бесплатный hosted-план и есть пробный период — без карты и без ограничения по времени. Переходите на Pro или Team, только когда упрётесь в его лимиты.",
  "pricing.faq.q5": "Можно сменить или отменить план?",
  "pricing.faq.a5":
    "Да, в любой момент. Понижение и отмена вступают в силу в конце расчётного периода, а данные можно сначала выгрузить.",
  "pricing.faq.q6": "Есть скидки?",
  "pricing.faq.a6":
    "Да — для НКО, образования и open-source проектов. Напишите нам, и мы что-нибудь придумаем.",
  "pricing.faq.q7": "Что будет с данными, если я уйду?",
  "pricing.faq.a7":
    "Они остаются вашими. Выгрузите все доски или перейдите на self-hosted версию и продолжайте работать на своём сервере. Вендор-лока нет.",

  "pricing.cta.title": "Начните бесплатно",
  "pricing.cta.lead":
    "Разверните у себя за минуты или запишитесь в лист ожидания хостинга — в любом случае старт бесплатный.",
  "pricing.waitlist.subject": "Лист ожидания Janosik (хостинг)",
  "pricing.contact.subject": "Janosik Enterprise",

  "footer.tagline": "Self-hosted канбан, работающий офлайн.",
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
