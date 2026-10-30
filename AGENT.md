Ты — опытный full‑stack разработчик, специализирующийся на React, TypeScript, Tailwind CSS и современных библиотеках компонентов.

**ЯЗЫК ОТВЕТОВ: всегда отвечай пользователю только на русском языке.** Общение с пользователем (отчёты, вопросы) — на русском; комментарии и JSDoc в коде — только на английском. Код, идентификаторы и технические термины — на английском. Твоя задача — создать веб‑приложение «клон Trello» с премиальным дизайном, поддержкой тёмной и светлой тем, адаптивностью и drag‑and‑drop. Работай строго итерациями. После завершения каждой итерации останавливайся и выводи подробный отчёт о том, что сделано, какие файлы изменены/созданы и как это проверить. Жди моей команды для продолжения (я вручную делаю /compact).

В начале каждой итерации используй плагин `@juicesharp/rpiv-todo` для планирования задач этой итерации. Отмечай выполненные пункты по мере работы. После завершения итерации снова вызови плагин, чтобы показать, что всё выполнено, и остановись.

## Общие требования

- **Стек**: React 18, TypeScript, Tailwind CSS, Vite.
- **Библиотека компонентов**: shadcn/ui (`https://ui.shadcn.com/docs/components`) — используй её как основу, но кастомизируй под указанную ниже дизайн‑систему.
- **Иконки**: lucide‑react.
- **Анимированные иконки (шапка и подобные заметные места)**: бери готовые
  компоненты с `https://lucide-animated.com/` — **не рисуй анимации сам**.
  Установка: `npx shadcn@latest add "https://lucide-animated.com/r/<name>.json"`
  (файл ложится в `src/components/ui/<name>.tsx`; если CLI создаст папку
  `@/` — перенеси файл в `src/components/ui/` вручную). Использование:
  `<SearchIcon size={20} />` — анимация срабатывает на hover, `size`
  поддерживается. Каталог всех иконок: `https://lucide-animated.com/llms.txt`.
- **Состояние и данные**: localStorage для хранения всех данных. Структура должна быть расширяемой (например, массив досок, каждая доска содержит колонки, каждая колонка — карточки).
- **Drag‑and‑drop**: используй `@dnd-kit/core` и `@dnd-kit/sortable` для перемещения карточек между колонками и изменения порядка колонок.
- **Адаптивность**: приложение должно корректно отображаться на мобильных (с горизонтальной прокруткой колонок), планшетах и десктопах.
- **Дизайн**: современный, премиальный, без «грязных» оттенков. Все компоненты должны следовать единому стилю.

## Дизайн‑система (цветовые токены)

Внедри следующие цвета через CSS‑переменные и Tailwind config. Они должны применяться автоматически в зависимости от выбранной темы (`dark` / `light`).

| Роль | Тёмная тема | Светлая тема |
| ------ | ------------- | -------------- |
| Фон приложения | `#0a0a0f` | `#f4f5f6` |
| Фон карточек/колонок | `#14141e` | `#ffffff` |
| Hover‑элементы | `#1e1e2e` | `#eaecee` |
| Основной текст | `#e8e8f0` | `#1a1a24` |
| Второстепенный текст | `#8888a0` | `#5c5c70` |
| Главный акцент (Brand) | `#7c3aed` | `#6d28d9` |
| Второй акцент | `#06b6d4` | `#0891b2` |
| Успех (Done) | `#10b981` | `#059669` |
| Предупреждение (In Progress) | `#f59e0b` | `#d97706` |
| Опасность (High) | `#ef4444` | `#dc2626` |
| Границы / разделители | `#2a2a3a` | `#e2e8f0` |

- Никаких чисто белых фонов в светлой теме и унылых серых в тёмной.
- Переключение темы должно сохраняться в localStorage.
- Предусмотри плавный переход цветов при смене темы (CSS transition на background-color, color и border-color).

## Функциональные требования

1. **Доска** (одна доска по умолчанию, но данные хранятся в виде массива досок для будущего расширения).
2. **Колонки**: создание, редактирование названия, удаление, изменение порядка (drag‑and‑drop горизонтально).
3. **Карточки**: создание в колонке, редактирование текста, удаление, перемещение между колонками и внутри колонки (drag‑and‑drop вертикально и горизонтально).
4. **Метки**: каждая карточка может иметь цветную метку (выбор из предустановленных: акцент, бирюзовый, зелёный, жёлтый, красный) — необязательно, но желательно для премиальности.
5. Всё должно работать с localStorage: при перезагрузке страницы данные восстанавливаются.

## Требования к коду

- Чистый, самодокументированный код. Названия переменных, функций и компонентов должны говорить сами за себя.
- Комментарии (на английском) только там, где логика неочевидна или есть сложные нестандартные решения.
- Используй функциональные компоненты и хуки.
- Типизация TypeScript: избегай `any`, используй интерфейсы и типы.
- Следуй принципам DRY, KISS и Single Responsibility.
- Tailwind: используй утилиты, но не создавай громоздкие классы‑комбинации. Выноси повторяющиеся стили в компоненты или `@apply` в CSS файле при необходимости.
- Для shadcn/ui: установи компоненты через CLI и кастомизируй их в соответствии с дизайн‑токенами (измени CSS переменные в `globals.css`).
- Структура проекта: предложи разумную организацию папок (components, hooks, types, utils, store).

### File naming

React components and their test files use PascalCase (e.g. `BoardContext.tsx`); everything else — utils, stores, hook siblings, config — uses kebab-case (e.g. `board-reducer.ts`, `use-undo-history.ts`). Existing deviations are accepted as-is and should not be renamed just to comply.

### Сброс состояния диалога (TASK-21.11 — обязательное правило)

Draft‑состояние диалога (значение формы, строка поиска, inline‑подтверждение)
сбрасывается **только ремаунтом**, а не эффектом по `open` и не вручную в
`onOpenChange`. Держи draft в дочернем компоненте, отрисованном внутри
`DialogContent`/`PopoverContent`: Radix размонтирует этот подузел при
закрытии, поэтому каждое открытие монтирует чистый экземпляр — тот же
эффект, что и смена `key` у stateful‑элемента (образец: `key={card.id}` у
`DescriptionEditor` в `CardDialog`).
Такой сброс нельзя забыть или рассинхронизировать (отдельной ветки сброса
нет), и он сохраняет анимацию закрытия. Для элемента **внутри** диалога,
который должен пересоздаваться по условию (например, при переполнении),
используй явный `key`. Отклонение допустимо только для диалога, который
действительно слишком дорого перемонтировать или который обязан хранить
состояние между открытиями; тогда `open`‑reset разрешён, но с английским
комментарием‑обоснованием.

### Виртуализация больших списков (TASK-139 — обязательное правило)

Колонки доски, строки таблицы и неограниченные списки календаря монтируют
**только окно вокруг скролла**, а не все карточки (доска — предел 12×200 =
2400 карточек; поля нет — это ~68k DOM и ~1.1 GB heap).

- В `SortableContext items` уходит **полный** список id, даже когда строки не
  смонтированы; дроп по карточке вне окна должен находить её реальный индекс.
- Значения, уходящие в dnd-kit (`items`, `sensors`, `measuring`), обязаны быть
  стабильными — новый массив/объект ломает `memo` и DnD (см. §1.2 ROADMAP).
- Размер строки — часть контракта окна: у карточек 92px + зона 8px
  (`CARD_ROW_HEIGHT`), у компактной карточки TASK-142 — 48px + зона 8px
  (`COMPACT_CARD_ROW_HEIGHT`), у таблицы оценка `TABLE_ROW_ESTIMATE`. Меняешь
  высоту карточки/строки (или класс `h-12`/`h-[92px]` в `CardItem`) — обнови
  эти константы, spacer-геометрию `ColumnView` и тесты окна.
- Месячную сетку календаря **не** виртуализируем (42 bounded-ячейки), окно —
  только у неограниченных списков: unscheduled-панель, недельные ячейки,
  day-panel. Для окна есть готовые тесты: `*.virtualization.test.tsx`.

## Детерминизм редьюсера (TASK-21.7a — обязательное правило)

`boardReducer` — чистая функция от `(state, action)`. Экшен **полностью
сериализуем**: всё, что редьюсер записывает в доску, приходит в payload.

- Редьюсер **не вызывает** `createId()`, `Date.now()`, `Math.random()` и не
  читает `localStorage`. Проверка: `grep -c "createId()\|Date.now()"
  src/store/board-reducer.ts` → **0**.
- Время даёт вызывающая сторона: `at` в каждом board-scoped экшене (из него
  берутся `updatedAt`, `createdAt`, `archivedAt` и время событий активности).
- Id того, что экшен **создаёт**, генерирует вызывающая сторона и кладёт в
  payload под именем с префиксом `new`: `newCardId`, `newColumnId`,
  `newChecklistId`, `newItemId`, `newCardIds[]`, плюс `activityIds[]` для
  событий активности. Префикс `new` отличает создаваемый id от ссылки на
  существующую сущность (`cardId`, `columnId`).
- Экшены **абсолютны, не относительны**: `SET_CARD_LABEL {on}`, а не
  `TOGGLE_*`. Toggle самообратен только пока никто не влез — вдвоём это
  гонка, и инверсию по нему не вычислить.
- Экшен должен быть **обратимым по себе**: в payload лежит позиция, с
  которой он забирает (`fromIndex`), и позиция, в которую кладёт. Инверсию
  считает `invert(before, action)` в `src/store/invert.ts`; новый экшен без
  инверсии **не компилируется** (`never`-проверка полноты union'а).
- Третий аргумент `options?: { withActivity?: boolean }` меняет только то,
  что редьюсер *записывает рядом* (лента активности), но не сами данные:
  клиент зовёт с `true` (по умолчанию), сервер — с `false` (§7.4.1).

### Undo (TASK-21.7d) — три правила без исключений

- **Инверсия возвращает состояние побайтово**, включая `updatedAt` доски и
  карточки и ленту активности. Поля, которые ставит только `invert()`:
  `boardUpdatedAt`, `cardUpdatedAt`, `cardActivity` (лента, какой инверсия
  её нашла), `inverse: true`.
- **Undo нельзя отклонить.** Коллекционные гварды (`LIMITS`, WIP-лимит)
  проверяются только для команд **без** `inverse: true`: инверсия не
  добавляет нового контента, она возвращает только что убранный. Отказ
  undo = молчаливый Ctrl+Z и потерянные данные; колонка, вышедшая за
  лимит, — состояние, которое приложение уже умеет показывать.
- **Каждое нажатие Ctrl+Z что-то меняет.** Шаг, чья команда ничего не
  изменила, выбрасывается из истории, и отмена идёт к следующему шагу.
- Как следствие: **UI не имеет права молча не сработать.** Если команда
  может быть отклонена гвардом (не-инверсия: композер, drag, восстановление
  из архива) — элемент либо `disabled` со счётчиком/тултипом, либо тост.

Зачем: одна и та же команда одинаково применяется на клиенте, на сервере и
в property-тесте; ретрай не порождает дубликат; undo — инверсная команда, а
не откат снапшота.

## Тесты

- Пиши тесты **только на важный функционал**:
  - логика перемещения карточек и колонок (reducer или чистые функции);
  - утилиты работы с localStorage (сохранение/загрузка, обработка ошибок);
  - базовый рендер главных компонентов (доска отображается, колонки и карточки рендерятся).
- Используй Vitest + React Testing Library.
- Не пиши тесты на стили, адаптивность или тривиальные вещи.

## Итерации (примерный план — выполняй по порядку)

### Итерация 1: Инициализация проекта и дизайн‑система

- Создай проект Vite + React + TypeScript.
- Установи Tailwind, настрой конфиг с цветами из таблицы (тёмная/светлая темы через CSS‑переменные).
- Инициализируй shadcn/ui и добавь базовые компоненты: Button, Input, Textarea, Card, Dialog, DropdownMenu, Tooltip (если нужны).
- Настрой переключение темы (тёмная/светлая) с сохранением выбора в localStorage.
- Создай базовую структуру приложения: пустую доску с заголовком.

### Итерация 2: Модель данных и localStorage

- Определи TypeScript‑типы: Board, Column, Card, Label.
- Создай утилиты для загрузки/сохранения данных в localStorage.
- Реализуй контекст или хук для управления состоянием доски (начальное состояние, действия).
- Покажи статические данные: одна доска с тремя колонками и несколькими карточками для визуальной проверки.

### Итерация 3: Рендер колонок и карточек

- Создай компоненты Column и Card, используя shadcn/ui Card и кастомные стили.
- Отобрази колонки горизонтально, карточки вертикально внутри колонок.
- Добавь возможность создавать новую колонку (кнопка "+").
- Реализуй добавление карточки в колонку (по кнопке или по Enter в textarea).

### Итерация 4: Drag‑and‑drop карточек

- Интегрируй `@dnd-kit/core` и `@dnd-kit/sortable`.
- Реализуй перемещение карточек внутри колонки (вертикальный dnd).
- Реализуй перемещение карточек между колонками (с автоопределением новой позиции).
- Обнови состояние и localStorage после перемещения.

### Итерация 5: Drag‑and‑drop колонок

- Добавь возможность горизонтального перемещения колонок (изменение порядка).
- Обеспечь корректную работу dnd при совместном использовании для колонок и карточек.

### Итерация 6: Редактирование и удаление

- Добавь редактирование названия колонки (двойной клик или через меню).
- Добавь редактирование текста карточки (двойной клик или модальное окно).
- Добавь удаление колонок и карточек с подтверждением.
- Добавь цветные метки на карточки (выбор через выпадающее меню).

### Итерация 7: Полировка, адаптивность и тесты

- Проработай адаптивность: на мобильных колонки занимают ~80% ширины экрана и прокручиваются горизонтально.
- Добавь плавные анимации при появлении/удалении элементов (можно CSS transitions или framer‑motion, если уместно).
- Напиши тесты на критичный функционал (перемещение карточек, утилиты localStorage, рендер доски).
- Проверь, что все shadcn/ui компоненты корректно отображаются в обеих темах.
- Убедись, что код чистый и самодокументированный.

**Важно**: после каждой итерации выводи отчёт: что сделано, какие файлы изменены, как проверить вручную, и останавливайся. Я затем выполню `/compact` и дам команду продолжать.

## Быстрый запуск окружения (dev)

Порядок важен: **сначала `.env`, потом БД** — dev-compose читает `POSTGRES_*`
из `backend/.env` и без него не поднимется.

```bash
nvm install && nvm use                  # репо пинит версию в .nvmrc (Node 24)

cp backend/.env.example backend/.env    # задать JWT_SECRET (openssl rand -hex 32)
docker compose -f backend/docker-compose.yml up -d   # postgres :5433 (+redis :6379)
npm run prisma:deploy -w backend        # миграции
npm run build:backend
npm run start -w backend                # API :3000
npm run dev                             # UI :5173 (/api проксируется на :3000)
```

- **Dev UI всегда в server-режиме** (`isApiEnabled()` = true вне `MODE=test`):
  показывает **экран логина**, «демо-доска без входа» недоступна. Local-only
  (без API) живёт только в unit-тестах. Регистрация открыта по умолчанию
  (`ALLOW_REGISTRATION=true`) — аккаунт заводится прямо в UI.
- **Мастер (`/admin`)** — отдельный от пользователя аккаунт, только через CLI
  (первый становится `OWNER`); без TTY пароль берётся из `ADMIN_PASSWORD`:
  `ADMIN_PASSWORD='…' npm run admin:create -w backend -- --email me@example.com`.
- **Сайт (Astro + Starlight)** — отдельный dev-сервер, порт 4321. В dev
  приложение НЕ под `/app/` (это путь self-host образа), поэтому две
  перекрёстные ссылки (сайт↔приложение) надо нацелить вручную, иначе ловишь 404:
  сайт → приложение (`Sign in`/`Create account` задают `PUBLIC_APP_URL`) и
  приложение → сайт (меню Help → Documentation задаёт `VITE_SITE_URL` в UI):
  `PUBLIC_APP_URL=http://localhost:5173 npm run dev:site` и
  `VITE_SITE_URL=http://localhost:4321/ npm run dev`.
- **Email выключен по умолчанию** (log-mode: коды пишутся в лог сервера,
  регистрация само-верифицируется — ничего не отправляется). Песочница Mailpit:
  `docker run -d --name janosik-mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 axllent/mailpit`
  (SMTP `localhost:1025`, веб-ящик <http://localhost:8025>); включается в
  `/admin` → Email service (пресет «Mailpit (sandbox)»).

### WSL: фоновые процессы (важно для агентов)

Процесс, запущенный из одноразового `wsl.exe … &`/`nohup`, **убивается** при
завершении сессии (WSL гасит всё дерево процессов). Держи серверы в открытом
терминале или поднимай через **systemd** (`systemd-run`/unit + `systemctl`),
иначе они не переживут следующий `wsl.exe`-вызов, а хот-релоад — перезапуск.

### MCP (`mcp/`, `@janosik/mcp`)

Отдельный MCP-сервер отдаёт доску агенту (70 tools) по персональному API-ключу.
Нужны `JANOSIK_URL` (origin инстанса, напр. `http://localhost:3000`) и
`JANOSIK_TOKEN` (`jnk_…`; создаётся в UI: Account → API keys). Требует
**запущенного API**. Поведение агента задаёт скилл `skills/janosik`. Сборка —
`npm run build:mcp`; подробности в `README.md` и `mcp/README.md`.

### Agent-ready карточка (TASK-157, Слой 0)

Формат карточки, который рой агентов читает без человека (конвенции, без
схемы; источник — скилл `skills/janosik`):

- **Описание по секциям:** `## Why` → `## Scope` → `## Acceptance criteria`
  (чек-боксы) → `## Out of scope` → `## Verify` (точная команда/проверка).
- **Чек-лист `Definition of Done`** — пункты «сделано, когда…»; карточка
  Done только когда все отмечены (неотмеченные объясняются комментарием).
- **Типизированные комментарии** с префиксом-видом: `[status]`, `[question]`,
  `[blocker]`, `[evidence]`, `[handoff]` — тред становится машиночитаемым.
- **Зарезервированные метки состояния:** `agent:blocked`, `agent:needs-human`,
  `agent:verified` — фильтр «что делает рой» одним взглядом.

Схема и команды (claim с лизингом, `acceptanceCriteria`/`definitionOfDone`,
`actorType`) — в TASK-157 §7.17.

## Команды (monorepo, после TASK-22)

Репозиторий — npm workspaces: `ui/` (фронт), `shared/` (`@janosik/shared`,
без build-степа), `backend/` (`@janosik/backend`, NestJS — с TASK-23).
Гейты гоняются и с корня (скрипты-делегаты), и из пакета:

```bash
npm install            # на корне: ставит и линкует workspaces
npm test               # корень: тесты ui + shared
npm run dev -w ui      # vite dev :5173, /api проксируется на backend :3000
npm test -w ui         # только фронт-тесты
npm test -w shared     # только тесты shared
npm run test:coverage  # корень: покрытие ui + shared (пороги 88/83/91/93)
npm run build -w ui    # tsc -b (типчекает и shared) + vite build
npm run lint           # корень: ESLint по ui, shared и backend
npm run format:check   # Prettier по всему репо
npm run size -w ui     # бюджеты бандла (6 записей)
```

Внутри `shared/` алиасов `@/` нет — только относительные импорты; фронт
импортит пакет как `@janosik/shared` (alias в vite/tsconfig/vitest).

**Tailwind и `shared/`:** утилиты, записанные только в классах `shared/`
(карты `LABEL_COLOR_CHIP`/`LABEL_COLOR_DOT` и т.п.), не попадут в CSS
автоматически — Vite-root это `ui/`. В `ui/src/index.css` стоит
`@source "../../shared/src"`; при добавлении новых токенов туда проверяй
собранный CSS (в тестах это не ловится — «метки без цвета» так и вылезли,
TASK-30.2 fix).

### UI: серверный режим (с TASK-29)

- Режим включается окружением: `VITE_API_URL` (default `/api/v1`).
  В сборках/dev UI **живёт с сервера**; в vitest (`MODE=test`) режим
  выключен — компонентные тесты остаются локальными (localStorage), а
  серверный путь покрыт интеграционными с fake-сервером на общем
  `boardReducer` (`ui/src/test/fake-server.ts`).
- Ключевые файлы: `ui/src/api/client.ts` (fetch, access-токен в памяти,
  single-flight refresh, retry 401, `ApiError.offline/conflict/field`),
  `ui/src/auth/AuthContext.tsx` + `components/auth/LoginPage.tsx`,
  `ui/src/store/server-sync.ts` (FIFO-очередь на доску, коалесинг
  quiet-правок), `ui/src/store/board-diff.ts` (dead-пометка чужих правок
  при focus-refetch; `activity` — клиентское поле, агрегат его не несёт:
  при сравнении срезается, и `RESTORE_BOARD` переносит локальный фид на
  восстановленные карточки), серверный режим внутри `store/BoardContext.tsx`
  (гидратация, откаты, `ifMatchVersions` для undo текста, миграция
  `janosik-boards` → `POST /boards/import`, REST create/delete/import).
- **В серверном режиме localStorage для досок не пишется** (изоляция
  аккаунтов на общем браузере), авто-бэкапы выключены. Undo остаётся
  клиентским: инверсия уезжает командой, отказ → обратный откат + тост.
- Команды уходят `fetch` с `keepalive: true` (и в юзер-клиенте, и в
  админском редакторе контента): уже отправленная команда досылается
  браузером даже если страницу перезагрузили/закрыли сразу после
  действия — иначе reload в момент запроса молча терял правку (нашли
  Playwright-смоуком TASK-43).
- **Участники и роли (TASK-35):** модалка `BoardMembersDialog` из шапки
  (рядом со свитчером; только серверный режим) — инвайт по email, смена
  роли, `expiresAt` для VIEWER, исключение; `UserAvatar` (инициалы +
  детерминированный цвет, хелперы в `ui/src/utils/avatar.ts`). Роль
  вызывающего — `roleOf(boardId)` из `GET /boards`; **read-only принцип:**
  VIEWER не получает мутирующих афордансов вообще (`DndBoard` с
  `NO_SENSORS`, композеры/меню/инлайн-редакторы и футер карточки скрыты,
  `CardDialog` — read-only описание/метки/чек-листы/срок), при этом сервер
  всё равно отвечает 403. Последний ADMIN защищён и в UI (disabled +
  `title`-причина). Ошибки API (404/409/403/offline) — тосты.
- **Инвайты опциональны (TASK-35 addendum):** `POST /boards/:id/members`
  создаёт pending-строку `BoardMember` (`acceptedAt: null`) — доступа она
  не даёт (`MembershipGuard` → 403, `GET /boards` её не показывает).
  Приглашённый отвечает из колокольчика в шапке (`NotificationsBell`:
  бейдж-счётчик, акцентный цвет, панель с бордой/пригласившим/ролью/сроком,
  Принять/Отклонить) через `GET /invitations`, `POST /invitations/:id/accept`
  и `…/decline`; после accept нужен `refreshBoards()` из `useBoardActions()`,
  чтобы борда появилась в свитчере без перезагрузки. Фильтры `acceptedAt`
  обязаны быть в каждом запросе, где строка `BoardMember` означает доступ
  (listBoards/listMembers/last-ADMIN/admin-owner), а создатели membership
  (`createBoard`, import) пишут `acceptedAt`.
- **Presence и атрибуция (TASK-36):** `ui/src/store/board-live.tsx` — три
  внешних стора на `useSyncExternalStore` (`presence`/`attribution`/
  `members`), принадлежат `BoardProvider` (dispose на logout; вне
  провайдера — пустой fallback, как у `useAuth`). Мост зовёт `setPresence`
  и `flagForeign` (attribution с `highlight` на 2 с); локальный dispatch
  штампует текущего юзера по `cardIdsTouchedBy(action)`; гидратация и
  focus-refetch «сеют» авторов из `Card.lastActorId`; каталог участников —
  `GET /boards/:id/members` (имена для офлайн-авторов). UI: `PresenceStack`
  в шапке (≤5 аватаров + «+N» → popover с ролями; solo — скрыт), аватар +
  время на карточке и в таблице (только чужое), кольцо 2 с в цвете автора
  (`janosik-foreign-ring`/`-dot`/`-row` в `index.css`;
  `prefers-reduced-motion` → статичные точки/заливка), имя + аватар в ленте
  (`boardId` в `CardActivityFeed`). Ключи `presence.*`, `card.changedBy`.
- Локальные диалоги/черновики — по правилу «сброс только ремаунтом».

### Backend (с TASK-23)

```bash
docker compose -f backend/docker-compose.yml up -d
                       # postgres 16 на localhost:5433 (БД janosik + janosik_test);
                       # креды берутся из backend/.env (POSTGRES_*), в compose их нет
npm test -w backend    # unit + e2e (e2e = migrate deploy + supertest
                       # против TEST_DATABASE_URL, не dev-БД)
npm run build:backend  # prisma generate + tsc + tsc-alias
npm run prisma:deploy -w backend   # накатить миграции на dev-БД
```

- Env-переменные backend валидируются **envalid** (`backend/src/config/env.ts`),
  слои: `.env` → `.env.${NODE_ENV}` → `.env.local` (позже перезаписывает).
  В тестовом прогоне (jest ставит NODE_ENV=test) `DATABASE_URL`
  автоматически подменяется на `TEST_DATABASE_URL`.
  `JWT_SECRET` обязателен (≥32 симв.) — без него процесс не стартует.
- `backend/.env` — секреты и DATABASE_URL, в git не попадает
  (шаблон: `backend/.env.example`); CI поднимает свой postgres-сервис.
- Импорты внутри backend — через алиас `@/` → `src/` (в tsconfig paths,
  jest moduleNameMapper, tsc-alias на билде).
- **Auth живой (TASK-24):** register/login/refresh/logout/me под
  `/api/v1/auth`; access JWT в теле ответа, refresh — httpOnly-кука
  (sha256-hash в БД, ротация, реюз revoked отзывает все сессии юзера).
  Клиент сериализует ротацию **между табами** через Web Locks
  (`REFRESH_LOCK`, `ui/src/api/client.ts`): два таба с одной кукой иначе
  предъявляют один и тот же токен, и сервер справедливо отзывает все
  сессии («all sessions revoked» в логе). Устаревший boot-refresh не
  затирает более поздний login/register — `sessionEpoch` в `ApiClient`
  (иначе медленный refresh 401 выкидывал только что вошедшего юзера).
- **Boards живые (TASK-25):** полная схема §7.3 в Prisma (soft-delete
  `deletedAt` + `version`), boards CRUD + membership
  (ADMIN/MEMBER/VIEWER + `expiresAt`, last-ADMIN защищён) под
  MembershipGuard, агрегат `GET /boards/:id` = модель фронта,
  import/export через `@janosik/shared` (симлинк `backend/src/shared`).
- **Commands живые (TASK-26/27/29):** `POST /boards/:id/commands` — команда
  редьюсера (колонки, карточки, метки, чек-листы + board-level
  `RENAME_BOARD`/`ARCHIVE_BOARD`/`UNARCHIVE_BOARD`), идемпотентная по
  `commandId`; строгий `validate` из shared → `400 {field}`, WIP/лимиты →
  `409 {conflict:"wip"}`, `ifMatch` → `409 {conflict:"version"}`; команды
  одной доски сериализуются `FOR UPDATE`. `ifMatchVersions` (TASK-29) —
  позаписные предусловия (`card:<id>` → version) для undo текста; archive/
  unarchive доски — ADMIN в сервисе. `GET ?since=<seq>` — дельта-догон;
  per-action writers зеркалят `boardReducer` в таблицы §7.3 (контрактный
  e2e). Метки доски упорядочены `Label.position` (отклонение от §7.3,
  миграция TASK-27); `RESTORE_LABEL` восстанавливает m2m по `assignments`.
  `GET /boards` отдаёт `role` вызывающего (ADMIN-only действия UI).
  **Жёсткость входа (TASK-30.2):** `referencedEntityIds` + проверка
  владения в транзакции — client-supplied id, живущий на другой доске, →
  `409` (иначе upsert по глобальному id переписал бы чужую строку);
  `MAX_COMMAND_BYTES` 2 MB на команду (`413`), json-body явно 5 MB
  (`useBodyParser`, иначе большие `RESTORE_*` падают в парсере); вложенная
  валидация restore-снапшотов по `LIMITS` (описание, cover, чек-листы).
  Контракт undo зафиксирован e2e через `invert` (`commands-undo.e2e`):
  агрегат после инверсии deep-equal состоянию до команды.
- **Realtime живой (TASK-30):** `GET /boards/:id/events` — SSE
  (`@Sse`), событие всегда `{type:"command", seq, action, actorId, touches}`
  (`touches` — метки записанных сущностей, TASK-30.1); keep-alive
  `data: ping` раз в 25 с; роли — включая VIEWER. Рассылку делает
  `RealtimeService` (`backend/src/realtime/`, in-memory Subject на доску),
  публикация — **после коммита** транзакции и только для новых `commandId`
  (в `CommandsService.apply`; повтор ничего не рассылает). Подключение
  race-free: буфер живых → дельта `listSince(since)` → дренаж буфера с
  дедупом по `seq`. `GET /boards/:id` несёт заголовок `X-Board-Seq` —
  `seq`, который отражает агрегат (агрегат + max(seq) читаются в одной
  транзакции `REPEATABLE READ`); клиент берёт базу через
  `api.getBoardSnapshot()`.
- **UI-мост — в ленивом чанке** (`ui/src/store/realtime.ts`, динамический
  импорт; в `size-limit` у чанка своя строка — 6 KB gzip, TASK-30.1):
  `fetch`-ридер `text/event-stream` с `Authorization` (EventSource
  и ticket не нужны, токен не в URL), парсер + backoff 1→30 с + `wakeNow`
  по `online` + стоп на 401/403/404. `createRealtimeBridge` держит `seq` /
  `ownSeq` / `deferred`-очередь: чужие команды применяются тем же
  `boardReducer`, а undo-шаги помечаются foreign по `touchedEntityIds()`
  из серверного `touches` (дифф доски на этом пути не считается); своё эхо
  пропускается только при `seq ≤ ownSeq`, поэтому команда **другого таба
  того же аккаунта** применяется; события при in-flight командах
  откладываются и дренажатся после ack (`settled()` из dispatch/undo) —
  LWW без rebase, §7.5 это допускает. Focus refetch остаётся fallback и
  обновляет resume point. `presence` (TASK-36) проходит мимо seq-дедупа и
  буфера: ростер приходит первым кадром подключения, изменения и heartbeat
  — сразу; `activity` (TASK-37) — так же мимо seq: `CommentsService`
  публикует кадр после коммита, мост раздаёт его в `ActivityStore`
  (`board-live.tsx`), компоненты открытой карточки перечитывают первую
  страницу по REST. Кадр несёт только id комментария (`detail`).
- **Присутствие и атрибуция (TASK-36):** `PresenceService`
  (`backend/src/realtime/presence.service.ts`) — сессии per
  `(boardId, clientId)` с дедупом по юзеру (две вкладки — один аватар),
  бродкаст на join/leave, heartbeat 30 с, sweep каждые 15 с дропает сессии
  без пинга старше `PRESENCE_TTL_MS` (60 с). `GET /boards/:id/events?client=<tab>`
  принимает tab-идентификатор (стабилен на вкладку — переподключение не
  мигает аватаром), `POST /boards/:id/presence {clientId}` — heartbeat из UI
  (20 с и на `visibilitychange`; `MembershipGuard`, неизвестный id — no-op
  204). Writers штампуют `Card.lastActorId` ровно там, где `updatedAt`
  (чистые reorder'ы — нет); агрегат отдаёт поле; контрактные e2e снимают
  его `stripAttribution()` (`backend/test/support/attribution.ts`) и
  проверяют штамп отдельным describe'ом.
- **Playwright-смоуки:** после TASK-30 нельзя ждать `networkidle` — SSE
  держит соединение открытым, и idle не наступает; используй
  `waitUntil: "domcontentloaded"`. Живой смоук realtime — `realtime.mjs`
  (два браузера + второй таб + догон после `setOffline`).
- **Activity/Comments живые (TASK-28, UI TASK-37):** `GET /boards/:id/activity` и
  `GET /cards/:id/activity` — слияние Command-лога и `Activity`-строк
  составным курсором (newest-first, `?limit=` ≤ 100); member-события
  (invite/role/expiry/remove) со снапшот-`details`; команды несут
  display-снапшот `Command.details` (`{detail, changes:[{field,from,to}]}`,
  пишется в `commands.service` через `command-details.ts`) — UI-история
  рисует дифф «было → стало», посимвольные `UPDATE_CARD` сворачиваются в
  `ui/src/utils/history-fold.ts`. Комментарии REST:
  `POST/GET /cards/:id/comments`, `DELETE /comments/:id` (только автор,
  `LIMITS.comment` = 10000, soft-delete); запись дополнительно публикует
  SSE-кадр `type:"activity"`. Доступ — `CardAccessGuard` (card/comment →
  board). UI: секция Activity последней в диалоге, сегментные табы
  Comments/History в стиле переключателя видов доски (`CardActivity`); 
  композер — компактный MDXEditor (`CommentEditor.tsx`, ленивый чанк,
  тулбар B/I/S/code/списки/ссылка), сабмит Save или Ctrl/Cmd+Enter, Cancel
  сбрасывает черновик; тела комментариев рендерит тот же markdown-вьюер
  (flush-вариант), голые URL оборачивает `autolinkMarkdown` из
  `utils/linkify.ts`. История: команды несут снапшот `Command.details`,
  коммент-строки — текст в `Activity.details` (пишут `comments.service`,
  читает `readCommentSnapshot` в `activity.service`) → дифф
  `Comment: — → текст` / `текст → —`; дифф рендерится половинами
  «было → стало» с word-diff-подсветкой (`utils/diff-words.ts`):
  изменённый фрагмент выделен (удалённое — красным зачёркнутым,
  добавленное — зелёным), неизменный контекст схлопывается в «…»;
  бэкендский `clip` снапшотов поднят 280 → `LIMITS.description`, так что
  в БД хранятся полные значения. Чужой комментарий перевешивает «морду»
  карточки (TASK-36 attribution): SSE-фрейм `comment_added` ставит
  attribution с кольцом в `BoardContext.onActivity`, сервер пишет
  `Card.lastActorId` в `comments.service.create` — после перезагрузки
  видно то же лицо. Описание карточки
  коммитится один раз за сессию печати — на blur из редактора, смене
  карточки или закрытии диалога (staging-draft в `CardDialog`), а не на
  каждую паузу. Свежесть истории: `CommitStore` (`store/commit-store.ts`)
  публикует затронутые карточки после ack своих команд (и undo/redo) —
  `CardHistory` перечитывает фид по нему, иначе оптимистичный `updatedAt`
  триггерит фетч до коммита и запись появляется «на шаг позже». Копирование
  `?card=`-ссылки
  из шапки. Диалог карточки ставит `key={card.id}` на
  секцию — смена карточки сбрасывает локальный стейт, а не «переезжает».
- **Приоритет карточки (TASK-45):** `Card.priority` (`shared`: `CARD_PRIORITIES`
  blocker…lowest, дефолт `medium`, поле хранится только когда отличается).
  Команда `SET_CARD_PRIORITY` идёт всем общим контуром (редьюсер → invert →
  validate → writers: **важно — тип надо добавить в оба свитча**
  `command-writers.ts`: роутер `writeAction` и `writeCardAction`, иначе
  сервер молча запишет no-op); Prisma-колонка + миграция. UI: селект в
  диалоге (`CardPriority`), бейдж `PriorityBadge` на морде только для
  не-medium, опциональная колонка TableView с сортировкой по рангу
  (`utils/priority.ts` — иконки/цвета/лейблы), фасет `priorities` в
  `utils/filter.ts` + FilterBar; история — предложение
  `activity.priority-set` с локализованным именем уровня (`HistoryValue`
  локализует половины, дифф для priority выключен).
- **Связи карточек (TASK-46):** `CardLink { id, type: blocks|relates_to|duplicates, targetCardId }`
  живёт на карточке-источнике (directional), вторая сторона вычисляется
  сканом (`utils/links.ts` → `cardLinkIndex`, WeakMap-кэш по
  `linkSignature` — строка из link-строк + archivedAt + множества id;
  пересоздавать индекс на каждый `board.cards` ломает изоляцию рендеров).
  Гварды редьюсера: self-link, дубль неупорядоченной пары,
  `LIMITS.linksPerCard = 50`, циклы `blocks` (DFS). **Dangling-tolerant:**
  удаление цели оставляет строку, undo удаления оживляет её — потребители
  скипают missing cards. `DUPLICATE_CARD`/`DUPLICATE_COLUMN` копируют
  `links: undefined`. Prisma `CardLink` (soft-delete, FK RESTRICT, без
  version): ADD — upsert, REMOVE — `updateMany`; e2e-`wipe()` обязан
  чистить `cardLink` ПЕРЕД `cardLabel` (FK), а контрактный сьют
  глушит троттлер патчем `ThrottlerGuard.prototype.canActivate`
  (`overrideProvider(APP_GUARD)` не работает). UI: секция `CardLinks` в
  диалоге (автокомплит-саджесты, 5 Jira-фразировок → 3 wire-типа, клавиши,
  тост на цикл, переход по `?card=`); секция НЕ `key=`-ится (remount в
  Radix-портале осиротает старый DOM) — сброс пикера при смене карточки
  через render-phase паттерн «adjust state when a prop changes»; бейджи на
  морде (`card-links-badge`, красный `card-blocked-badge`), фасеты
  `blocked`/`hasLinks` в фильтрах, история/команды в `CardHistory`.
- **Вложения и аватары (TASK-47):** `Attachment` (soft-delete, FK
  RESTRICT) + blob-файлы на диске в `UPLOAD_DIR` (дефолт `data/uploads`,
  git-игнор; jest cwd=backend → `backend/data/`, тесты чистят его в
  afterAll). storedName = UUID + sanitized ext (защита от traversal),
  fileName = basename без control-символов ≤200; allowlist mime
  (`ATTACHMENT_MIME_ALLOWLIST`, 25MB×20/карточка; аватар 2MB,
  image/*). REST вне командного контура (как комменты — undo не
  покрывает): гвард по `cardId` ИЛИ `attachmentId` в
  `card-access.guard.ts`; удаление — uploader или board ADMIN. Скачивание
  браузером только через auth-запрос (fetch → Blob → object URL,
  `requestRaw` с 401-refresh-retry) — прямые `<a href>` не работают
  (cookie + сторонний origin). Денормализация `Card.attachmentCount`
  (инкремент/декремент в той же транзакции, omitted при 0) + activity
  `attachment_added/deleted` (snake_case, НЕ в `CARD_ACTIVITY_TYPES`,
  detail=attachmentId). `User.avatarPath` течёт сквозь
  auth-user.mapper/presence join/roster/updateUser — при добавлении
  полей юзера не забывать все три точки. Aватарный object URL
  module-кэшируется по userId+avatarPath (`use-avatar-object-url.ts`) —
  иначе каждый ререндер дёргает fetch. Эндпоинт аватара отдаёт
  `immutable` на год, а URL не меняется между загрузками — клиент
  обязан версионировать запрос (`fetchUserAvatar(userId, avatarPath)` →
  `?v=storedName`), иначе вторая смена аватара показывает старую
  картинку из HTTP-кэша браузера (фикс — PR #87). e2e-wipe:
  `attachment.deleteMany()` перед `cardLink` (FK-порядок).
- **Markdown-поверхности:** лимит комментария 10k (`LIMITS.comment`,
  колонка `Comment.text` — `@db.Text`); композер — premium-Save слева +
  тихий Cancel рядом, оба дисейблятся на пустом черновике (Cancel — чтобы
  не мигал remount-reset); в вьюерах (`CommentBody`, `DescriptionEditor`
  readOnly) `emojify` (`utils/emoji.ts`) превращает `:shortcode:` и
  ASCII-эмотиконы в эмодзи, не трогая код и URL; в редакторе текст
  остаётся сырым.
  Остальные модули: users — заглушка; `/health` живой (пингует БД).
- **Мастер-контур живой (TASK-43):** `AdminUser` — отдельная от `User`
  сущность с ролью `AdminRole` (`OWNER` управляет мастерами из панели,
  `OPERATOR` — нет). Вход мастера — `/api/v1/admin/auth/*` со своими
  cookie (`admin_refresh_token`, `Path=/api/v1/admin/auth`) и JWT-audience
  `janosik-admin`; юзер-токен в `/admin` и мастер-токен в юзер-API
  отклоняются на уровне стратегий. Пароли argon2id, lockout 5/15 мин,
  каждое действие — в `AdminAuditLog`. Создание мастеров — только CLI:
  `npm run admin:create -w backend -- --email x [--display-name y] [--owner]`
  (пароль — скрытый prompt или `ADMIN_PASSWORD`), `admin:passwd`,
  `admin:list`; публичного HTTP-пути создания мастера нет.
  Панель `/admin` в UI — ленивый чанк, свой `AdminApiClient`/`AdminAuthProvider`;
  таблицы отдают контент без `passwordHash`/`tokenHash`/сырых refresh-токенов.
  Модерация: блок юзера (`disabledAt` — вход/refresh 403, access-токены
  умирают сразу), ревок сессий/API-токенов (в т.ч. по одной сессии),
  архив/soft-delete доски и карточки, удаление комментария, создание
  юзера с одноразовым паролем. Страницы панели: дашборд (+runtime:
  версия/uptime/латентность БД), юзеры, доски, карточки, комментарии,
  сессии, API-токены, журнал команд, аудит, мастера. Таблицы панели —
  **schema-first**: колонки называются полями Prisma (`Board.id`,
  `BoardMember.userId`, `Card.columnId`, `Comment.authorId`, …), внешние
  ключи показываются айди (имя/email — только подпись рядом с чипом),
  агрегатных счётчиков нет. Поиск ищет по этим FK-айди (борда — по
  owner/member `userId`, карточка — по `boardId`/`columnId`, комментарий
  — по `cardId`/`authorId`/`boardId`, сессии/токены — по `userId`, аудит —
  по `adminId`/`targetId`), потому что имена/названия не уникальны.
  Таблицы живут в собственном скролл-вьюпорте (`Table` maxHeight от
  `100vh`) со sticky-шапкой: горизонтальный скроллбар виден в панели,
  а не внизу длинной страницы. **Контент доски**
  (`/admin/boards/:id/content`) создаётся командами через командный лог
  от имени владельца (`POST /admin/boards/:id/commands`, actor = первый
  ADMIN, аудит `board.command`) — прямых записей в таблицы контента нет.
  Любая секретная строка (пароль, токен) в ответах и логах не появляется.

### Git-процесс (обязательное правило)

- **Любая новая работа — в отдельной ветке от `main`** (`feat/…`, `fix/…`,
  `chore/…`), не напрямую в `main`. Коммит(ы) в ветку, push ветки, PR;
  мерж в `main` — только по явной команде пользователя.
- Коммитить/пушить/мержить — только когда пользователь явно попросил
  (или подтвердил предложенный план).

### Pre-commit (husky)

При каждом коммите: `npx tsc -b ui` (типчек ui вместе с shared, без
vite-сборки — её делает CI) + `lint-staged` (`.lintstagedrc.mjs`: prettier по
стейдженным файлам + eslint по workspaces без `--fix`, чтобы коммит не
переписывал нестейдженные файлы). Хук ставится автоматически через
`prepare: husky`.

