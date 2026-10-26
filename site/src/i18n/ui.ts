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

  "home.hero.eyebrow": "Self-hosted · Offline-first · Open source",
  "home.hero.title": "Kanban that feels crafted.",
  "home.hero.lead":
    "Janosik is a fast, self-hosted Kanban board — Trello-class drag & drop, calendar and table views, realtime sync and obsessive micro-detail. Run it yourself or let us host it.",
  "home.hero.note":
    "Free and open source (MIT). No lock-in — your data stays yours.",

  "home.features.title": "Everything a board should do",
  "home.features.lead":
    "Built for teams who want a board that gets out of the way.",
  "home.features.dnd.title": "Drag & drop, undo/redo",
  "home.features.dnd.body":
    "Reorder cards and columns with buttery drag & drop, WIP limits and a full undo/redo history.",
  "home.features.views.title": "Board, calendar, table",
  "home.features.views.body":
    "Three views of the same data — plan by board, by date, or in a dense table.",
  "home.features.realtime.title": "Realtime collaboration",
  "home.features.realtime.body":
    "Shared boards sync over SSE: everyone sees edits instantly, with an offline-first fallback.",
  "home.features.media.title": "Rich cards",
  "home.features.media.body":
    "Markdown descriptions, checklists, labels, attachments and paste-to-upload media.",
  "home.features.offline.title": "Offline-first PWA",
  "home.features.offline.body":
    "Installable, works offline, and backs itself up to IndexedDB automatically.",
  "home.features.i18n.title": "i18n & theming",
  "home.features.i18n.body":
    "English and Russian out of the box, light/dark themes and full keyboard support.",

  "home.how.title": "Running in minutes",
  "home.how.lead":
    "One container, your own database. No SaaS account required.",
  "home.how.step1.title": "Pull the image",
  "home.how.step1.body":
    "Ship the self-host image from GitHub Container Registry.",
  "home.how.step2.title": "Point it at a database",
  "home.how.step2.body":
    "Set DATABASE_URL and a JWT secret in the environment.",
  "home.how.step3.title": "Create your account",
  "home.how.step3.body":
    "Open the app, register the first user and start planning.",

  "home.faq.title": "Questions",
  "home.faq.q1": "Is Janosik free?",
  "home.faq.a1":
    "Yes — the self-hosted edition is free and open source under the MIT license. A hosted plan is available if you'd rather not run a server.",
  "home.faq.q2": "Do I need a server?",
  "home.faq.a2":
    "No. Janosik also runs fully local-first in your browser; a server adds accounts, shared boards and realtime sync.",
  "home.faq.q3": "Where is my data stored?",
  "home.faq.a3":
    "In your own database when self-hosting, or in your browser's storage in local-first mode. There is no telemetry.",

  "home.cta.title": "Ready to plan?",
  "home.cta.lead": "Start with the hosted plan or self-host in minutes.",

  "pricing.title": "Simple pricing",
  "pricing.lead":
    "Free to self-host, forever. Pay only if you want us to run it.",
  "pricing.note":
    "Detailed plans, limits and checkout arrive with billing (coming soon).",
  "pricing.free.name": "Self-hosted",
  "pricing.free.price": "$0",
  "pricing.free.period": "forever",
  "pricing.free.body": "Run Janosik on your own infrastructure.",
  "pricing.hosted.name": "Hosted",
  "pricing.hosted.price": "Coming soon",
  "pricing.hosted.period": "",
  "pricing.hosted.body": "We run it for you — no server to manage.",
  "pricing.enterprise.name": "Enterprise",
  "pricing.enterprise.price": "Let's talk",
  "pricing.enterprise.period": "",
  "pricing.enterprise.body": "SSO, audit and support for larger teams.",
  "pricing.cta.free": "Self-host now",
  "pricing.cta.hosted": "Join the waitlist",
  "pricing.cta.enterprise": "Contact us",

  "footer.tagline": "A self-hosted, offline-first Kanban board.",
  "footer.product": "Product",
  "footer.resources": "Resources",
  "footer.legal": "Legal",
  "footer.docs": "Documentation",
  "footer.selfhost": "Self-hosting guide",
  "footer.changelog": "Changelog",
  "footer.security": "Security",
  "footer.license": "MIT license",
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

  "home.hero.eyebrow": "Self-hosted · Offline-first · Open source",
  "home.hero.title": "Канбан, сделанный с любовью к деталям.",
  "home.hero.lead":
    "Janosik — быстрый self-hosted канбан: drag & drop уровня Trello, виды календаря и таблицы, realtime-синхронизация и внимание к микро-деталям. Разверните у себя или доверьте хостинг нам.",
  "home.hero.note":
    "Бесплатно и с открытым исходным кодом (MIT). Без вендор-лока — данные ваши.",

  "home.features.title": "Всё, что должна уметь доска",
  "home.features.lead":
    "Для команд, которым нужна доска, не мешающая работать.",
  "home.features.dnd.title": "Drag & drop, undo/redo",
  "home.features.dnd.body":
    "Перетаскивайте карточки и колонки, ставьте WIP-лимиты и откатывайте любые изменения.",
  "home.features.views.title": "Доска, календарь, таблица",
  "home.features.views.body":
    "Три представления одних данных — планируйте по доске, по датам или в плотной таблице.",
  "home.features.realtime.title": "Realtime-совместная работа",
  "home.features.realtime.body":
    "Общие доски синхронизируются по SSE: все видят правки мгновенно, с offline-first фолбэком.",
  "home.features.media.title": "Богатые карточки",
  "home.features.media.body":
    "Markdown-описания, чек-листы, метки, вложения и вставка медиа из буфера.",
  "home.features.offline.title": "Offline-first PWA",
  "home.features.offline.body":
    "Устанавливается, работает офлайн и автоматически бэкапится в IndexedDB.",
  "home.features.i18n.title": "i18n и темы",
  "home.features.i18n.body":
    "Английский и русский из коробки, светлая и тёмная темы, полная поддержка клавиатуры.",

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

  "home.faq.title": "Вопросы",
  "home.faq.q1": "Janosik бесплатный?",
  "home.faq.a1":
    "Да — self-hosted версия бесплатна и открыта по лицензии MIT. Если не хотите держать сервер, есть хостинг-план.",
  "home.faq.q2": "Нужен ли сервер?",
  "home.faq.a2":
    "Нет. Janosik работает и полностью локально в браузере; сервер добавляет аккаунты, общие доски и realtime-синхронизацию.",
  "home.faq.q3": "Где хранятся мои данные?",
  "home.faq.a3":
    "В вашей базе данных при self-hosting или в хранилище браузера в локальном режиме. Телеметрии нет.",

  "home.cta.title": "Готовы планировать?",
  "home.cta.lead": "Начните с хостинг-плана или разверните у себя за минуты.",

  "pricing.title": "Простые тарифы",
  "pricing.lead":
    "Self-hosting бесплатен навсегда. Платите только за наш хостинг.",
  "pricing.note":
    "Детальные тарифы, лимиты и оплата появятся вместе с биллингом (скоро).",
  "pricing.free.name": "Self-hosted",
  "pricing.free.price": "$0",
  "pricing.free.period": "навсегда",
  "pricing.free.body": "Запустите Janosik на своей инфраструктуре.",
  "pricing.hosted.name": "Hosted",
  "pricing.hosted.price": "Скоро",
  "pricing.hosted.period": "",
  "pricing.hosted.body": "Мы держим сервер за вас — управлять нечем.",
  "pricing.enterprise.name": "Enterprise",
  "pricing.enterprise.price": "Обсудим",
  "pricing.enterprise.period": "",
  "pricing.enterprise.body": "SSO, аудит и поддержка для крупных команд.",
  "pricing.cta.free": "Развернуть",
  "pricing.cta.hosted": "В лист ожидания",
  "pricing.cta.enterprise": "Связаться",

  "footer.tagline": "Self-hosted канбан, работающий офлайн.",
  "footer.product": "Продукт",
  "footer.resources": "Ресурсы",
  "footer.legal": "Правовое",
  "footer.docs": "Документация",
  "footer.selfhost": "Гайд по self-hosting",
  "footer.changelog": "Changelog",
  "footer.security": "Безопасность",
  "footer.license": "Лицензия MIT",
  "footer.rights": "участники Janosik",

  "404.title": "Страница не найдена",
  "404.lead": "Такой страницы нет — или она переехала.",
  "404.home": "На главную",
};

export const ui = { en, ru } as const;
export type UIKey = keyof typeof en;
